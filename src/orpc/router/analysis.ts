import * as z from 'zod'
import { ORPCError } from '@orpc/server'
import { publicProcedure, protectedProcedure } from '#/orpc/middleware/auth'
import { db } from '#/db'
import { analysisJobs, psychosisScores, user } from '#/db/schema'
import { eq, desc, or } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'

export const trigger = protectedProcedure.handler(async ({ context }) => {
  const userId = context.user.id

  const [userData] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  const githubUsername = userData?.name

  const conditions = [eq(psychosisScores.userId, userId)]
  if (githubUsername) conditions.push(eq(psychosisScores.targetGithub, githubUsername))

  const [existing] = await db
    .select()
    .from(psychosisScores)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .orderBy(desc(psychosisScores.createdAt))
    .limit(1)

  const instanceId = `self-${userId}-${nanoid(8)}`

  await db.insert(analysisJobs).values({
    id: instanceId,
    type: 'self',
    userId,
    targetGithub: githubUsername ?? null,
    status: 'queued',
  })

  await env.ANALYSIS_WORKFLOW.create({
    id: instanceId,
    params: {
      type: 'self',
      jobId: instanceId,
      userId,
      existingScoreId: existing?.id,
      githubUsername: githubUsername ?? undefined,
    },
  })

  return { status: 'processing' as const, jobId: instanceId }
})

export const jobStatus = publicProcedure.input(z.object({ jobId: z.string() })).handler(async ({ input }) => {
  const [job] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, input.jobId))

  if (!job) {
    throw new ORPCError('NOT_FOUND', { message: 'Job not found' })
  }

  return {
    status: job.status,
    currentStep: job.currentStep,
    totalSteps: job.totalSteps,
    completedSteps: job.completedSteps,
    scoreId: job.scoreId,
    error: job.error,
  }
})

export const getMyScore = protectedProcedure.handler(async ({ context }) => {
  const [score] = await db
    .select()
    .from(psychosisScores)
    .where(eq(psychosisScores.userId, context.user.id))
    .orderBy(desc(psychosisScores.createdAt))
    .limit(1)

  return score ?? null
})

export const getScore = publicProcedure.input(z.object({ id: z.string() })).handler(async ({ input }) => {
  const [score] = await db.select().from(psychosisScores).where(eq(psychosisScores.id, input.id))

  if (!score) {
    throw new ORPCError('NOT_FOUND', { message: 'Score not found' })
  }

  return score
})
