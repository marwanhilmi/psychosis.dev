import { drizzle } from 'drizzle-orm/d1'
import { env } from 'cloudflare:workers'
import * as schema from './schema.ts'

export const db = drizzle(env.DB, { schema })
