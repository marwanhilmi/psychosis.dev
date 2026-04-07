import * as z from 'zod'
import { ORPCError } from '@orpc/server'
import { publicProcedure } from '#/orpc/middleware/auth'
import { db } from '#/db'
import { analysisJobs, reports, psychosisScores } from '#/db/schema'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { env } from 'cloudflare:workers'
import { githubFetch, fetchUserOwnedRepos, fetchUserContributedRepos } from '#/lib/github-indexer'
import { FEATURES } from '#/lib/feature-flags'
import { lookupUserByUsernameOrThrow } from '#/lib/x-client'

export const listRepos = publicProcedure.input(z.object({ username: z.string() })).handler(async ({ input }) => {
  const token = env.GITHUB_TOKEN || ''

  const res = await githubFetch(`https://api.github.com/users/${encodeURIComponent(input.username)}`, token)
  if (res.status === 404) {
    throw new ORPCError('BAD_REQUEST', { message: 'GitHub user not found' })
  }
  if (!res.ok) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to look up GitHub user' })
  }

  const githubUser = (await res.json()) as { type?: string }
  if (githubUser.type !== 'User') {
    throw new ORPCError('BAD_REQUEST', { message: 'Only GitHub user accounts are supported' })
  }

  const [owned, contributed] = await Promise.all([
    fetchUserOwnedRepos(input.username, token, 100),
    fetchUserContributedRepos(input.username, token, 100),
  ])

  const seen = new Map<string, (typeof owned)[0]>()
  for (const repo of [...owned, ...contributed]) {
    if (!seen.has(repo.fullName)) seen.set(repo.fullName, repo)
  }

  return [...seen.values()].map((r, i) => ({
    id: i,
    fullName: r.fullName,
    language: null as string | null,
    stars: r.stars,
    pushedAt: r.pushedAt,
    selected: i < 10,
  }))
})

export const submit = publicProcedure
  .input(
    z
      .object({
        targetGithub: z.string().optional(),
        targetX: z.string().optional(),
        selectedRepos: z.array(z.string()).optional(),
      })
      .refine((d) => d.targetGithub || d.targetX, { message: 'At least one target is required' }),
  )
  .handler(async ({ input }) => {
    const normalizedTargetX = FEATURES.X_ENABLED ? input.targetX?.replace(/^@+/, '') : undefined

    if (input.targetGithub) {
      const res = await githubFetch(
        `https://api.github.com/users/${encodeURIComponent(input.targetGithub)}`,
        env.GITHUB_TOKEN || '',
      )
      if (res.status === 404) {
        throw new ORPCError('BAD_REQUEST', { message: 'GitHub user not found' })
      }
      if (!res.ok) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to validate GitHub user' })
      }

      const githubUser = (await res.json()) as { type?: string }
      if (githubUser.type !== 'User') {
        throw new ORPCError('BAD_REQUEST', { message: 'Only GitHub usernames are supported in v1' })
      }
    }

    if (normalizedTargetX && env.X_BEARER_TOKEN) {
      try {
        await lookupUserByUsernameOrThrow(env.X_BEARER_TOKEN, normalizedTargetX)
      } catch (error) {
        throw new ORPCError('BAD_REQUEST', {
          message: error instanceof Error ? error.message : 'Failed to validate X user',
        })
      }
    }

    // Check for existing score
    const conditions = []
    if (input.targetGithub) conditions.push(eq(psychosisScores.targetGithub, input.targetGithub))
    if (normalizedTargetX) conditions.push(eq(psychosisScores.targetX, normalizedTargetX))

    const canReuseExisting = !input.selectedRepos || input.selectedRepos.length === 0

    const [existing] =
      conditions.length > 0
        ? await db
            .select()
            .from(psychosisScores)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
            .orderBy(
              desc(sql<number>`case when ${psychosisScores.source} = 'self' then 1 else 0 end`),
              desc(psychosisScores.createdAt),
            )
            .limit(1)
        : []

    if (canReuseExisting && existing) {
      if (existing.source === 'self') {
        return { status: 'done' as const, scoreId: existing.id }
      }
      const ageMs = Date.now() - (existing.createdAt instanceof Date ? existing.createdAt.getTime() : 0)
      if (ageMs < 3600000) {
        return { status: 'done' as const, scoreId: existing.id }
      }
    }

    // Find existing reported score for this target to upsert
    const [existingReported] =
      conditions.length > 0
        ? await db
            .select({ id: psychosisScores.id })
            .from(psychosisScores)
            .where(
              and(eq(psychosisScores.source, 'reported'), conditions.length === 1 ? conditions[0]! : or(...conditions)),
            )
            .orderBy(desc(psychosisScores.createdAt))
            .limit(1)
        : []

    const reportId = nanoid()
    await db.insert(reports).values({
      id: reportId,
      targetGithub: input.targetGithub ?? null,
      targetX: normalizedTargetX ?? null,
      status: 'processing',
    })

    const instanceId = `report-${reportId}`

    await db.insert(analysisJobs).values({
      id: instanceId,
      type: 'report',
      reportId,
      targetGithub: input.targetGithub ?? null,
      targetX: normalizedTargetX ?? null,
      status: 'queued',
    })

    await env.ANALYSIS_WORKFLOW.create({
      id: instanceId,
      params: {
        type: 'report',
        jobId: instanceId,
        reportId,
        targetGithub: input.targetGithub,
        targetX: normalizedTargetX,
        selectedRepos: input.selectedRepos,
        existingScoreId: existingReported?.id,
      },
    })

    return { status: 'processing' as const, jobId: instanceId }
  })

export const status = publicProcedure.input(z.object({ reportId: z.string() })).handler(async ({ input }) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, input.reportId))

  if (!report) {
    throw new ORPCError('NOT_FOUND', { message: 'Report not found' })
  }

  return { status: report.status, scoreId: report.scoreId }
})
