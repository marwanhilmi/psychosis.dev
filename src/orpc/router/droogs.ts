import * as z from 'zod'
import { ORPCError } from '@orpc/server'
import { publicProcedure } from '#/orpc/middleware/auth'
import { db } from '#/db'
import { psychosisScores, user } from '#/db/schema'
import { eq, desc, sql } from 'drizzle-orm'

export const list = publicProcedure
  .input(
    z
      .object({
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
        mode: z.enum(['self', 'reports']).default('self'),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const limit = input?.limit ?? 20
    const offset = input?.offset ?? 0
    const mode = input?.mode ?? 'self'

    if (mode === 'self') {
      // Self-diagnoses: deduplicate to latest score per user
      // Subquery to get the max (latest) score id per user
      const latestPerUser = db
        .select({
          userId: psychosisScores.userId,
          maxCreatedAt: sql<number>`MAX(${psychosisScores.createdAt})`.as('max_created_at'),
        })
        .from(psychosisScores)
        .where(eq(psychosisScores.source, 'self'))
        .groupBy(psychosisScores.userId)
        .as('latest')

      const rows = await db
        .select({
          scoreId: psychosisScores.id,
          score: psychosisScores.score,
          zone: psychosisScores.zone,
          diagnosis: psychosisScores.diagnosis,
          githubDataUsed: psychosisScores.githubDataUsed,
          xDataUsed: psychosisScores.xDataUsed,
          createdAt: psychosisScores.createdAt,
          userId: user.id,
          userName: user.name,
          userImage: user.image,
          targetGithub: psychosisScores.targetGithub,
          targetX: psychosisScores.targetX,
        })
        .from(psychosisScores)
        .innerJoin(user, eq(psychosisScores.userId, user.id))
        .innerJoin(
          latestPerUser,
          sql`${psychosisScores.userId} = ${latestPerUser.userId} AND ${psychosisScores.createdAt} = ${latestPerUser.maxCreatedAt}`,
        )
        .orderBy(desc(psychosisScores.score))
        .limit(limit)
        .offset(offset)

      return rows
    } else {
      // Reports: scores with targetGithub or targetX set, no userId
      const rows = await db
        .select({
          scoreId: psychosisScores.id,
          score: psychosisScores.score,
          zone: psychosisScores.zone,
          diagnosis: psychosisScores.diagnosis,
          githubDataUsed: psychosisScores.githubDataUsed,
          xDataUsed: psychosisScores.xDataUsed,
          createdAt: psychosisScores.createdAt,
          userId: psychosisScores.userId,
          userName: sql<string>`COALESCE(${psychosisScores.targetGithub}, ${psychosisScores.targetX}, 'unknown')`.as(
            'user_name',
          ),
          userImage: sql<string | null>`NULL`.as('user_image'),
          targetGithub: psychosisScores.targetGithub,
          targetX: psychosisScores.targetX,
        })
        .from(psychosisScores)
        .where(eq(psychosisScores.source, 'reported'))
        .orderBy(desc(psychosisScores.score))
        .limit(limit)
        .offset(offset)

      return rows
    }
  })

export const get = publicProcedure.input(z.object({ username: z.string() })).handler(async ({ input }) => {
  // Try self-diagnosis first (by user name)
  const [selfRow] = await db
    .select({
      scoreId: psychosisScores.id,
      score: psychosisScores.score,
      zone: psychosisScores.zone,
      diagnosis: psychosisScores.diagnosis,
      indicators: psychosisScores.indicators,
      breakdown: psychosisScores.breakdown,
      githubDataUsed: psychosisScores.githubDataUsed,
      xDataUsed: psychosisScores.xDataUsed,
      generationMs: psychosisScores.generationMs,
      modelVersion: psychosisScores.modelVersion,
      createdAt: psychosisScores.createdAt,
      userId: user.id,
      userName: user.name,
      userImage: user.image,
      targetGithub: psychosisScores.targetGithub,
      targetX: psychosisScores.targetX,
    })
    .from(psychosisScores)
    .innerJoin(user, eq(psychosisScores.userId, user.id))
    .where(eq(user.name, input.username))
    .orderBy(desc(psychosisScores.createdAt))
    .limit(1)

  if (selfRow) return selfRow

  // Fall back to report (by targetGithub or targetX)
  const [reportRow] = await db
    .select({
      scoreId: psychosisScores.id,
      score: psychosisScores.score,
      zone: psychosisScores.zone,
      diagnosis: psychosisScores.diagnosis,
      indicators: psychosisScores.indicators,
      breakdown: psychosisScores.breakdown,
      githubDataUsed: psychosisScores.githubDataUsed,
      xDataUsed: psychosisScores.xDataUsed,
      generationMs: psychosisScores.generationMs,
      modelVersion: psychosisScores.modelVersion,
      createdAt: psychosisScores.createdAt,
      userId: psychosisScores.userId,
      userName: sql<string>`COALESCE(${psychosisScores.targetGithub}, ${psychosisScores.targetX}, 'unknown')`.as(
        'user_name',
      ),
      userImage: sql<string | null>`NULL`.as('user_image'),
      targetGithub: psychosisScores.targetGithub,
      targetX: psychosisScores.targetX,
    })
    .from(psychosisScores)
    .where(
      sql`${psychosisScores.source} = 'reported' AND (${psychosisScores.targetGithub} = ${input.username} OR ${psychosisScores.targetX} = ${input.username})`,
    )
    .orderBy(desc(psychosisScores.createdAt))
    .limit(1)

  if (reportRow) return reportRow

  throw new ORPCError('NOT_FOUND', { message: 'Droog not found' })
})
