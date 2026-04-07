// Augment the auto-generated Env with secrets and type fixes
// that `wrangler types` cannot derive automatically.

declare namespace Cloudflare {
  interface Env {
    // Auth (better-auth)
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL: string

    // GitHub OAuth
    GITHUB_CLIENT_ID: string
    GITHUB_CLIENT_SECRET: string

    // X/Twitter OAuth 2.0
    X_CLIENT_ID: string
    X_CLIENT_SECRET: string
    X_BEARER_TOKEN: string

    // GitHub API (for debug analysis — not OAuth)
    GITHUB_TOKEN?: string

    // AI
    ANTHROPIC_API_KEY: string

    // Admin
    ADMIN_SECRET?: string

    // Assets (for OG image generation — fetches static files without external HTTP)
    ASSETS: { fetch: (req: Request | string) => Promise<Response> }
  }
}
