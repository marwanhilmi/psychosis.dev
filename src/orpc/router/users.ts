import * as z from 'zod'
import { publicProcedure, protectedProcedure } from '#/orpc/middleware/auth'
import { db } from '#/db'
import { user, account } from '#/db/schema'
import { eq } from 'drizzle-orm'

export const getProfile = publicProcedure.input(z.object({ userId: z.string() })).handler(async ({ input }) => {
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, input.userId))

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    image: row.image,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }
})

export const connectedAccounts = protectedProcedure.handler(async ({ context }) => {
  const accounts = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, context.user.id))

  return accounts.map((a) => a.providerId)
})
