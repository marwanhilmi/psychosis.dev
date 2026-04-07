import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from 'cloudflare:workers'
import { db } from '#/db'
import { analysisJobs, reports } from '#/db/schema'
import { eq, sql } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { indexRepos } from '#/lib/github-indexer'
import { indexTweets, computeTweetSignals, emptyTweetSignals, type TweetSignals } from '#/lib/x-indexer'
import { lookupUserByUsernameOrThrow, fetchUserTweets } from '#/lib/x-client'
import { analyzeXSignals } from '#/lib/x-algorithm'
import {
  buildPublicGithubAnalysis,
  buildStoredGithubAnalysis,
  computeScoring,
  generateDiagnosis,
  persistScore,
} from '#/lib/psychosis-algorithm'
import { FEATURES } from '#/lib/feature-flags'
import type { GithubAnalysisResult } from '#/lib/github-algorithm'

interface AnalysisParams {
  type: 'self' | 'report'
  jobId: string
  userId?: string
  existingScoreId?: string
  githubUsername?: string
  reportId?: string
  targetGithub?: string
  targetX?: string
  selectedRepos?: string[]
}

async function updateJobProgress(
  jobId: string,
  status: string,
  currentStep: string,
  completedSteps: number,
  totalSteps: number,
) {
  await db
    .update(analysisJobs)
    .set({ status, currentStep, completedSteps, totalSteps, updatedAt: sql`(unixepoch())` })
    .where(eq(analysisJobs.id, jobId))
}

async function failJob(jobId: string, error: string) {
  await db
    .update(analysisJobs)
    .set({ status: 'failed', error, updatedAt: sql`(unixepoch())` })
    .where(eq(analysisJobs.id, jobId))
}

export class AnalysisWorkflow extends WorkflowEntrypoint<Env, AnalysisParams> {
  async run(event: WorkflowEvent<AnalysisParams>, step: WorkflowStep) {
    const params = event.payload
    const { jobId } = params
    const startedAtMs = Date.now()
    const totalSteps = 4

    try {
      // Step 1: Index GitHub repos
      const githubAnalysis = await step.do(
        'index-github-repos',
        { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '300 seconds' },
        async () => {
          await updateJobProgress(jobId, 'indexing_repos', 'Indexing GitHub repos...', 0, totalSteps)

          if (params.type === 'self' && params.userId) {
            await indexRepos(params.userId)
            return await buildStoredGithubAnalysis(params.userId)
          }

          return await buildPublicGithubAnalysis(params.targetGithub, env.GITHUB_TOKEN || '', params.selectedRepos)
        },
      )

      // Step 2: Index tweets
      const tweetSignals = await step.do(
        'index-tweets',
        { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '60 seconds' },
        async () => {
          await updateJobProgress(jobId, 'indexing_tweets', 'Analyzing tweets...', 1, totalSteps)

          if (params.type === 'self' && params.userId) {
            if (!FEATURES.X_ENABLED) return emptyTweetSignals()
            return await indexTweets(params.userId, env.X_BEARER_TOKEN)
          }

          if (params.targetX && env.X_BEARER_TOKEN) {
            const xUser = await lookupUserByUsernameOrThrow(env.X_BEARER_TOKEN, params.targetX)
            const tweets = await fetchUserTweets(env.X_BEARER_TOKEN, xUser.id, 800)
            return computeTweetSignals(tweets)
          }

          return emptyTweetSignals()
        },
      )

      // Step 3: Score and generate diagnosis
      const diagnosisResult = await step.do(
        'score-and-diagnose',
        { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '30 seconds' },
        async () => {
          await updateJobProgress(jobId, 'scoring', 'Computing psychosis signals...', 2, totalSteps)

          const xAnalysis = analyzeXSignals(tweetSignals as TweetSignals)
          const { combined, breakdown } = computeScoring({
            githubAnalysis: githubAnalysis as GithubAnalysisResult,
            xAnalysis,
          })

          await updateJobProgress(jobId, 'diagnosing', 'Generating diagnosis...', 2, totalSteps)

          const { diagnosis, indicators } = await generateDiagnosis(
            env.ANTHROPIC_API_KEY,
            combined.score,
            combined.zone,
            breakdown,
            (githubAnalysis as GithubAnalysisResult).samples.commitMessages,
            xAnalysis.samples.tweetTexts,
            env.AI,
          )

          return {
            score: combined.score,
            zone: combined.zone,
            diagnosis,
            indicators,
            breakdown,
            githubDataUsed: (githubAnalysis as GithubAnalysisResult).hasData,
            xDataUsed: xAnalysis.hasData,
          }
        },
      )

      // Step 4: Persist results
      const result = await step.do(
        'persist-results',
        { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' }, timeout: '10 seconds' },
        async () => {
          await updateJobProgress(jobId, 'persisting', 'Saving results...', 3, totalSteps)

          const scoreResult = await persistScore({
            startedAtMs,
            existingId: params.existingScoreId,
            userId: params.type === 'self' ? params.userId : undefined,
            targetGithub: params.targetGithub ?? params.githubUsername,
            targetX: params.targetX,
            source: params.type === 'self' ? 'self' : 'reported',
            score: diagnosisResult.score,
            zone: diagnosisResult.zone as 'SANE' | 'QUIRKY' | 'UNHINGED' | 'DERANGED' | 'FULL_PSYCHOSIS',
            diagnosis: diagnosisResult.diagnosis,
            indicators: diagnosisResult.indicators,
            breakdown: diagnosisResult.breakdown,
            githubDataUsed: diagnosisResult.githubDataUsed,
            xDataUsed: diagnosisResult.xDataUsed,
          })

          // Update the job as done
          await db
            .update(analysisJobs)
            .set({
              status: 'done',
              scoreId: scoreResult.id,
              currentStep: 'Complete',
              completedSteps: totalSteps,
              totalSteps,
              updatedAt: sql`(unixepoch())`,
            })
            .where(eq(analysisJobs.id, jobId))

          // Update associated report if this is a report-type job
          if (params.type === 'report' && params.reportId) {
            await db
              .update(reports)
              .set({ status: 'done', scoreId: scoreResult.id })
              .where(eq(reports.id, params.reportId))
          }

          return scoreResult
        },
      )

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await failJob(jobId, message)

      if (params.type === 'report' && params.reportId) {
        await db.update(reports).set({ status: 'failed' }).where(eq(reports.id, params.reportId))
      }

      throw error
    }
  }
}
