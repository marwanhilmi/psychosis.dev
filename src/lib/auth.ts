import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { env } from 'cloudflare:workers'
import { db } from '#/db'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
    },
  },
  trustedOrigins: [env.BETTER_AUTH_URL],
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      scope: ['read:user', 'user:email'],
      mapProfileToUser: (profile) => ({
        name: profile.login,
        email: profile.email || `${profile.id}+${profile.login}@users.noreply.github.com`,
      }),
    },
    twitter: {
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      scope: ['tweet.read', 'users.read', 'offline.access'],
      mapProfileToUser: (profile) => ({
        name: (profile as Record<string, unknown>).username as string,
        email:
          ((profile as Record<string, unknown>).email as string | undefined) ||
          `${String((profile as Record<string, unknown>).id)}@x.noreply.psychosis.dev`,
      }),
    },
  },
  plugins: [tanstackStartCookies()],
})
