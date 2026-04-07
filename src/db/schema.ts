import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Better Auth Tables ─────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ─── Indexed Repos ──────────────────────────────────────────────────────────────

export const indexedRepos = sqliteTable(
  'indexed_repos',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    githubRepoId: integer('github_repo_id').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch'),
    language: text('language'),
    stars: integer('stars').default(0),
    lastIndexedAt: integer('last_indexed_at', { mode: 'timestamp' }),
    indexStatus: text('index_status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('indexed_repos_user_id_idx').on(table.userId),
    uniqueIndex('indexed_repos_user_repo_idx').on(table.userId, table.githubRepoId),
  ],
)

// ─── Repo Metadata ──────────────────────────────────────────────────────────────

export const repoMetadata = sqliteTable(
  'repo_metadata',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id')
      .notNull()
      .references(() => indexedRepos.id, { onDelete: 'cascade' }),
    totalCommits: integer('total_commits').default(0),
    totalPrs: integer('total_prs').default(0),
    totalIssues: integer('total_issues').default(0),
    avgCommitMsgLength: real('avg_commit_msg_length'),
    commitTimeDistribution: text('commit_time_distribution'),
    languageBreakdown: text('language_breakdown'),
    aiArtifactCount: integer('ai_artifact_count').default(0),
    rawData: text('raw_data'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('repo_metadata_repo_id_idx').on(table.repoId)],
)

// ─── Indexed Tweets ─────────────────────────────────────────────────────────────

export const indexedTweets = sqliteTable(
  'indexed_tweets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tweetId: text('tweet_id').notNull(),
    text: text('text').notNull(),
    createdAtX: integer('created_at_x', { mode: 'timestamp' }),
    metrics: text('metrics'),
    indexedAt: integer('indexed_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex('indexed_tweets_tweet_id_idx').on(table.tweetId),
    index('indexed_tweets_user_id_idx').on(table.userId),
  ],
)

// ─── Psychosis Scores ───────────────────────────────────────────────────────────

export const psychosisScores = sqliteTable(
  'psychosis_scores',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    targetGithub: text('target_github'),
    targetX: text('target_x'),
    source: text('source', { enum: ['self', 'reported'] })
      .notNull()
      .default('reported'),
    score: integer('score').notNull(),
    zone: text('zone').notNull(),
    diagnosis: text('diagnosis'),
    indicators: text('indicators'),
    breakdown: text('breakdown'),
    githubDataUsed: integer('github_data_used', { mode: 'boolean' }).notNull().default(false),
    xDataUsed: integer('x_data_used', { mode: 'boolean' }).notNull().default(false),
    generationMs: integer('generation_ms'),
    modelVersion: text('model_version'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('psychosis_scores_user_id_idx').on(table.userId),
    index('psychosis_scores_target_github_idx').on(table.targetGithub),
    index('psychosis_scores_created_at_idx').on(table.createdAt),
  ],
)

// ─── Reports ────────────────────────────────────────────────────────────────────

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id').references(() => user.id, { onDelete: 'set null' }),
    targetGithub: text('target_github'),
    targetX: text('target_x'),
    scoreId: text('score_id').references(() => psychosisScores.id),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('reports_reporter_id_idx').on(table.reporterId), index('reports_status_idx').on(table.status)],
)

// ─── Analysis Jobs (Workflow Progress) ──────────────────────────────────────────

export const analysisJobs = sqliteTable(
  'analysis_jobs',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['self', 'report'] }).notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    reportId: text('report_id'),
    targetGithub: text('target_github'),
    targetX: text('target_x'),
    status: text('status').notNull().default('queued'),
    currentStep: text('current_step'),
    totalSteps: integer('total_steps'),
    completedSteps: integer('completed_steps').default(0),
    scoreId: text('score_id').references(() => psychosisScores.id),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [index('analysis_jobs_user_id_idx').on(table.userId), index('analysis_jobs_status_idx').on(table.status)],
)
