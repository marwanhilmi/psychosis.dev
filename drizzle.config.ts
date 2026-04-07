import { defineConfig } from 'drizzle-kit'
import fs from 'node:fs'
import path from 'node:path'

function findLocalD1Database(): string {
  const d1Dir = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  try {
    const files = fs
      .readdirSync(d1Dir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(d1Dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) {
      throw new Error('No local D1 database found. Run `vp dev` first to initialize wrangler.')
    }
    return path.join(d1Dir, files[0].name)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('No .wrangler directory found. Run `vp dev` first to initialize wrangler.')
    }
    throw e
  }
}

const isRemote = process.env.DB_REMOTE === 'true'

export default defineConfig(
  isRemote
    ? {
        out: './drizzle',
        schema: './src/db/schema.ts',
        dialect: 'sqlite',
        driver: 'd1-http',
        tablesFilter: ['!_cf_*', '!d1_migrations'],
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : {
        out: './drizzle',
        schema: './src/db/schema.ts',
        dialect: 'turso',
        tablesFilter: ['!_cf_*', '!d1_migrations'],
        dbCredentials: {
          url: `file:${findLocalD1Database()}`,
        },
      },
)
