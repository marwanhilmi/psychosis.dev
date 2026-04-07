import * as z from 'zod'
import { ORPCError } from '@orpc/server'
import { protectedProcedure } from '#/orpc/middleware/auth'
import { db } from '#/db'
import { account, indexedRepos } from '#/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { githubFetch } from '#/lib/github-indexer'

export const list = protectedProcedure.handler(async ({ context }) => {
  // Fetch GitHub access token from better-auth account table
  const [ghAccount] = await db
    .select({ accessToken: account.accessToken, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, context.user.id), eq(account.providerId, 'github')))

  if (!ghAccount?.accessToken) {
    throw new ORPCError('BAD_REQUEST', { message: 'GitHub account not connected' })
  }

  // Fetch repos the user can access, including organization repos
  const res = await githubFetch(
    'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member,collaborator',
    ghAccount.accessToken,
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`GitHub /user/repos failed: ${res.status} ${res.statusText}`, body)
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: `GitHub API error (${res.status}): ${res.statusText}`,
    })
  }

  const repos = (await res.json()) as Array<{
    id: number
    full_name: string
    default_branch: string
    language: string | null
    stargazers_count: number
    pushed_at: string
    fork: boolean
  }>

  // Filter out forks — only show repos the user actually owns or authored
  const nonForkRepos = repos.filter((r) => !r.fork)

  // Get already-selected repos for this user
  const selected = await db
    .select({ githubRepoId: indexedRepos.githubRepoId })
    .from(indexedRepos)
    .where(eq(indexedRepos.userId, context.user.id))

  const selectedIds = new Set(selected.map((r) => r.githubRepoId))

  return nonForkRepos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    selected: selectedIds.has(r.id),
  }))
})

export const select = protectedProcedure
  .input(
    z.object({
      repos: z.array(
        z.object({
          id: z.number(),
          fullName: z.string(),
          defaultBranch: z.string().optional(),
          language: z.string().nullable().optional(),
          stars: z.number().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ input, context }) => {
    // Clear existing selections and insert new ones
    await db.delete(indexedRepos).where(eq(indexedRepos.userId, context.user.id))

    if (input.repos.length === 0) return { count: 0 }

    await db.insert(indexedRepos).values(
      input.repos.map((r) => ({
        id: nanoid(),
        userId: context.user.id,
        githubRepoId: r.id,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch ?? null,
        language: r.language ?? null,
        stars: r.stars ?? 0,
        indexStatus: 'pending' as const,
      })),
    )

    return { count: input.repos.length }
  })

export const status = protectedProcedure.handler(async ({ context }) => {
  const repos = await db
    .select({
      id: indexedRepos.id,
      fullName: indexedRepos.fullName,
      indexStatus: indexedRepos.indexStatus,
    })
    .from(indexedRepos)
    .where(eq(indexedRepos.userId, context.user.id))

  return repos
})
