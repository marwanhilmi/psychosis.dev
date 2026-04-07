# PSYCHOSISMETER

Viral meme app that analyzes your GitHub repos and X/Twitter tweets for an "LLM Psychosis" score. Clockwork Orange themed. TanStack Start (React) on Cloudflare Workers.

## Commands

```sh
vp install          # Installs deps
vp dev              # Start dev server
vp build            # Production build
vp check            # Format + lint + typecheck
vp run deploy       # Build + wrangler deploy
```

## Stack

- **Framework:** TanStack Start + TanStack Router
- **Database:** D1 (SQLite) via Drizzle ORM
- **Auth:** better-auth (GitHub + X/Twitter social providers), sessions in D1
- **RPC:** @orpc/server + TanStack Query (batch support)
- **AI:** Anthropic Claude Haiku (primary) + Workers AI (fallback) for diagnosis generation
- **Styling:** Tailwind CSS 4 + shadcn/ui (new-york style)
- **Toolchain:** [Vite Plus](https://github.com/voidzero-dev/vite-plus) (`vp`)
- **Package Manager:** pnpm 10 via `vp install`
- **Deploy:** Cloudflare Workers (`psychosismeter`)

## Path Aliases

`#/*` and `@/*` map to `./src/*`. Prefer `#/` by convention.

## Key Patterns

- **Routes** are file-based in `src/routes/`. `routeTree.gen.ts` is auto-generated — never edit it
- **Auth** uses better-auth with GitHub + X/Twitter OAuth 2.0 social providers, sessions stored in D1
- **RPC** uses @orpc/server with public + protected procedures. Router at `src/orpc/router/`, handler at `src/routes/api.rpc.$.ts`
- **Analysis** fetches GitHub commit/PR metadata and X tweets, runs deterministic signal scoring + AI narrative generation (`src/lib/psychosis-algorithm.ts`)
- **The Meter** is an SVG analog voltmeter component (`src/components/PsychosisMeter.tsx`) with animated needle
- **Lint/format config** lives in `vite.config.ts` — do not create separate config files

## Rules

- **No dynamic imports** — always use static `import` at the top of the file. Never use `await import(...)` or `import(...)` expressions. This ensures all dependencies are statically analyzable and bundled correctly.

## Cursor Cloud specific instructions

### Toolchain setup

The global `vp` CLI is installed via `curl -fsSL https://vite.plus | bash`. It manages its own Node.js and pnpm. After install, add `$HOME/.vite-plus/bin` to `PATH`. All commands (`vp install`, `vp dev`, `vp build`, `vp lint`, `vp check`) use this global CLI.

### Dev server

Run `vp run dev` (or `vp dev`) to start the Vite dev server with HMR on `http://localhost:5173`. No Cloudflare credentials are needed. The Workers AI binding (`env.AI`) will not be available locally (calls to it will fail at runtime), but the rest of the app works fully — UI, routing, auth flow, D1 database, etc.

### Lint and format

- `vp lint` — runs ESLint (type-aware). Exits 0 when clean.
- `vp fmt --check` — checks formatting via Biome (configured in `vite.config.ts`).
- `vp check` — runs format + lint + type checks together. Note: it exits on the first failing stage.

### Build

`vp build` produces a production build in `dist/`. It does not require Cloudflare credentials.

### Tests

No test files exist yet. `vp test run` errors due to a Cloudflare Vite plugin / Vitest environment incompatibility — this is a known upstream issue, not a project bug.

### Environment variables

For local dev with full functionality, create `.dev.vars` in the project root (gitignored via `.env` pattern) with secrets from `.env.example`. Key vars: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `ANTHROPIC_API_KEY`. These are optional for rendering the UI but required for OAuth, analysis, and AI diagnosis features.
