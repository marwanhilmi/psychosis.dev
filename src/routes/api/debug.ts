import { createFileRoute } from '@tanstack/react-router'
import { runDebugAnalysis, DebugAnalysisError } from '#/lib/debug-analysis'
import { FEATURES } from '#/lib/feature-flags'
import { env } from 'cloudflare:workers'

export const Route = createFileRoute('/api/debug')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!FEATURES.DEBUG) {
          return Response.json({ ok: false, error: 'Not found' }, { status: 404 })
        }
        try {
          const body = (await request.json()) as {
            username?: string
            xUsername?: string
            maxRepos?: number
            token?: string
            selectedRepos?: string[]
          }

          if (!body.username && !body.xUsername) {
            return Response.json({ ok: false, error: 'github or x username is required' }, { status: 400 })
          }

          const token = body.token || env.GITHUB_TOKEN || ''
          const result = await runDebugAnalysis({
            username: body.username,
            xUsername: body.xUsername,
            maxRepos: body.maxRepos,
            token,
            xBearerToken: env.X_BEARER_TOKEN,
            selectedRepos: body.selectedRepos,
          })

          return Response.json({ ok: true, result })
        } catch (e) {
          const logs = e instanceof DebugAnalysisError ? e.logs : []
          return Response.json(
            {
              ok: false,
              error: e instanceof Error ? e.message : 'Analysis failed',
              logs,
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
