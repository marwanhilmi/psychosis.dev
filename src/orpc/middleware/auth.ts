import { os, ORPCError } from '@orpc/server'
import { auth } from '#/lib/auth'

interface BaseContext {
  headers: Headers
}

export const publicProcedure = os.$context<BaseContext>()

const authMiddleware = os.$context<BaseContext>().middleware(async ({ context, next }) => {
  const session = await auth.api.getSession({
    headers: context.headers,
  })

  if (!session?.session || !session?.user) {
    throw new ORPCError('UNAUTHORIZED', { message: 'You must be signed in' })
  }

  return next({
    context: {
      session: session.session,
      user: session.user,
    },
  })
})

export const protectedProcedure = publicProcedure.use(authMiddleware)
