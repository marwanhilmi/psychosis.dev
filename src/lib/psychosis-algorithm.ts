import Anthropic from '@anthropic-ai/sdk'
import { db } from '#/db'
import { indexedRepos, psychosisScores, repoMetadata } from '#/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { computeWeightedAverage } from './algorithm-utils'
import {
  analyzeCrossPlatformSignals,
  buildCombinedBreakdown,
  combinePlatformScores,
  type CombinedBreakdown,
  type Zone,
} from './combined-algorithm'
import { aggregateEnhancedRawData, analyzeGithubSignals } from './github-algorithm'
import type { EnhancedRawData, GitHubCommit, GitHubContributorStats, GithubRepoCandidate } from './github-indexer'
import {
  fetchContributorStats,
  fetchRepoDataGraphQL,
  fetchRepoTree,
  fetchUserContributedRepos,
  fetchUserOwnedRepos,
  computeMarkdownStats,
  computeMetadata,
} from './github-indexer'
import { analyzeXSignals } from './x-algorithm'

const SYSTEM_PROMPT = `You are the PSYCHOSISMETER, a Clockwork Orange-themed AI diagnostic tool that detects "LLM Psychosis" — the degree to which a human's digital output has been contaminated by AI language model patterns.

Given platform-level scoring breakdowns and sample text, write a darkly comedic diagnosis using Nadsat slang from A Clockwork Orange. Be specific about data patterns you found. Reference actual examples from the provided text.

Respond with JSON in this exact format:
{
  "diagnosis": "Your diagnosis text here (under 200 words, use Nadsat slang)",
  "indicators": ["indicator 1", "indicator 2", "indicator 3", "indicator 4"]
}

Nadsat terms to use: viddy (see/watch), horrorshow (great/excellent), devotchka (girl), droog (friend), gulliver (head), lewdies (people), moloko (milk), poogly (scared), rassoodock (mind), slooshy (hear/listen), tolchock (hit), ultra-violence, veck (man), yarbles (balls/guts).`

function parseDiagnosisResponse(text: string): { diagnosis: string; indicators: string[] } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { diagnosis?: string; indicators?: string[] }
      return {
        diagnosis: parsed.diagnosis ?? text,
        indicators: Array.isArray(parsed.indicators) ? parsed.indicators : [],
      }
    }
  } catch {
    // Ignore parse failures and fall through to raw text.
  }

  return { diagnosis: text, indicators: [] }
}

export async function generateDiagnosis(
  anthropicApiKey: string,
  score: number,
  zone: Zone,
  breakdown: CombinedBreakdown,
  sampleCommits: string[],
  sampleTweets: string[],
  ai: Ai,
): Promise<{ diagnosis: string; indicators: string[] }> {
  const userPrompt = JSON.stringify({
    score,
    zone,
    breakdown,
    sampleCommitMessages: sampleCommits.slice(0, 20),
    sampleTweets: sampleTweets.slice(0, 20),
  })

  try {
    const client = new Anthropic({ apiKey: anthropicApiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    return parseDiagnosisResponse(text)
  } catch {
    try {
      const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 512,
      })

      const text = typeof response === 'string' ? response : 'response' in response ? response.response : ''
      return parseDiagnosisResponse(text ?? '')
    } catch {
      return {
        diagnosis: `Well well well, my little droog. Your rassoodock reads at ${score}/100 on the psychosis scale. The digital moloko has done its work on your gulliver — viddy your own commits and tweets if you dare. A real horrorshow case, this one.`,
        indicators: [
          'Analysis signals detected but narrative generation failed',
          `Score: ${score}/100 — Zone: ${zone}`,
          breakdown.github ? `GitHub subscore: ${breakdown.github.subscore}` : 'GitHub data unavailable',
          breakdown.x ? `X subscore: ${breakdown.x.subscore}` : 'X data unavailable',
        ],
      }
    }
  }
}

function matchesActorLogin(login: string | undefined | null, actorLogin: string): boolean {
  return !!login && login.toLowerCase() === actorLogin.toLowerCase()
}

export function filterCommitsForActor(commits: GitHubCommit[], actorLogin: string): GitHubCommit[] {
  return commits.filter(
    (commit) =>
      matchesActorLogin(commit.author?.login, actorLogin) || matchesActorLogin(commit.committer?.login, actorLogin),
  )
}

export function filterContributorStatsForActor(
  contributorStats: GitHubContributorStats[],
  actorLogin: string,
): GitHubContributorStats[] {
  return contributorStats.filter((stat) => matchesActorLogin(stat.author?.login, actorLogin))
}

function dedupeReposByFullName(repos: GithubRepoCandidate[]): GithubRepoCandidate[] {
  const deduped = new Map<string, GithubRepoCandidate>()
  for (const repo of repos) {
    const existing = deduped.get(repo.fullName)
    if (!existing) {
      deduped.set(repo.fullName, repo)
      continue
    }

    deduped.set(repo.fullName, {
      ...existing,
      stars: Math.max(existing.stars, repo.stars),
      pushedAt: existing.pushedAt > repo.pushedAt ? existing.pushedAt : repo.pushedAt,
      contributionCount: Math.max(existing.contributionCount ?? 0, repo.contributionCount ?? 0),
      source: existing.source === 'owned' || repo.source === 'owned' ? 'owned' : 'contributed',
    })
  }

  return [...deduped.values()]
}

export async function buildPublicGithubAnalysis(
  targetGithub: string | undefined,
  githubToken: string,
  selectedRepos?: string[],
) {
  if (!targetGithub) {
    return analyzeGithubSignals({
      raw: aggregateEnhancedRawData([]),
      totalCommits: 0,
      commitMessages: [],
      commitTimeDistribution: Array.from({ length: 24 }, () => 0),
      avgCommitMsgLength: 0,
    })
  }

  let totalCommitCount = 0
  let totalCommitMessageChars = 0
  const aggregatedTimeDist: number[] = Array.from({ length: 24 }, () => 0)
  const allCommitMessages: string[] = []
  const allEnhancedRaw: EnhancedRawData[] = []

  const [ownedRepos, contributedRepos] = await Promise.all([
    fetchUserOwnedRepos(targetGithub, githubToken, selectedRepos ? 100 : 5),
    fetchUserContributedRepos(targetGithub, githubToken, selectedRepos ? 100 : 5),
  ])
  const allRepos = dedupeReposByFullName([...ownedRepos, ...contributedRepos])
  const repos = (selectedRepos ? allRepos.filter((r) => selectedRepos.includes(r.fullName)) : allRepos).slice(0, 10)

  const processRepo = async (repo: (typeof repos)[number]) => {
    // GraphQL only — no REST fallback (too expensive)
    const [gqlData, contributorStats] = await Promise.all([
      fetchRepoDataGraphQL(repo.fullName, githubToken),
      fetchContributorStats(repo.fullName, githubToken),
    ])

    if (!gqlData) {
      console.warn(`[buildPublicGithubAnalysis] GraphQL failed for ${repo.fullName}, skipping`)
      return null
    }

    const { commits, commitDetails: commitDetailData } = gqlData

    const actorCommits = filterCommitsForActor(commits, targetGithub)
    if (actorCommits.length === 0) return null

    const actorContributorStats = filterContributorStatsForActor(contributorStats, targetGithub)
    const headSha = commits[0]?.sha ?? actorCommits[0]?.sha ?? ''

    const treeData = headSha
      ? await fetchRepoTree(repo.fullName, headSha, githubToken)
      : { totalFiles: 0, markdownFiles: 0 }

    const markdownStats = computeMarkdownStats(commitDetailData, treeData)
    return computeMetadata(actorCommits, [], actorContributorStats, commitDetailData, markdownStats)
  }

  // Process repos in parallel batches of 3 to respect rate limits
  for (let i = 0; i < repos.length; i += 3) {
    const batch = repos.slice(i, i + 3)
    const results = await Promise.all(batch.map((repo) => processRepo(repo).catch(() => null)))

    for (const meta of results) {
      if (!meta) continue

      totalCommitCount += meta.totalCommits
      totalCommitMessageChars += meta.avgCommitMsgLength * meta.totalCommits

      if (meta.commitTimeDistribution) {
        const dist = JSON.parse(meta.commitTimeDistribution) as number[]
        dist.forEach((value, index) => {
          aggregatedTimeDist[index] += value
        })
      }

      if (meta.rawData) {
        const raw = JSON.parse(meta.rawData) as EnhancedRawData
        allCommitMessages.push(...(raw.commitMessages ?? []))
        allEnhancedRaw.push(raw)
      }
    }
  }

  return analyzeGithubSignals({
    raw: aggregateEnhancedRawData(allEnhancedRaw),
    totalCommits: totalCommitCount,
    commitMessages: allCommitMessages,
    commitTimeDistribution: aggregatedTimeDist,
    avgCommitMsgLength: computeWeightedAverage(totalCommitMessageChars, totalCommitCount),
  })
}

export async function buildStoredGithubAnalysis(userId: string) {
  const repos = await db.select().from(indexedRepos).where(eq(indexedRepos.userId, userId))

  let totalCommitCount = 0
  let totalCommitMessageChars = 0
  const aggregatedTimeDist: number[] = Array.from({ length: 24 }, () => 0)
  const allCommitMessages: string[] = []
  const allEnhancedRaw: EnhancedRawData[] = []

  for (const repo of repos) {
    const [meta] = await db
      .select()
      .from(repoMetadata)
      .where(eq(repoMetadata.repoId, repo.id))
      .orderBy(desc(repoMetadata.createdAt))
      .limit(1)

    if (!meta) continue

    totalCommitCount += meta.totalCommits ?? 0
    totalCommitMessageChars += (meta.avgCommitMsgLength ?? 0) * (meta.totalCommits ?? 0)

    if (meta.commitTimeDistribution) {
      const dist = JSON.parse(meta.commitTimeDistribution) as number[]
      dist.forEach((value, index) => {
        aggregatedTimeDist[index] += value
      })
    }

    if (meta.rawData) {
      const raw = JSON.parse(meta.rawData) as EnhancedRawData
      allCommitMessages.push(...(raw.commitMessages ?? []))
      if (raw.commitTimestamps) {
        allEnhancedRaw.push(raw)
      }
    }
  }

  return analyzeGithubSignals({
    raw: aggregateEnhancedRawData(allEnhancedRaw),
    totalCommits: totalCommitCount,
    commitMessages: allCommitMessages,
    commitTimeDistribution: aggregatedTimeDist,
    avgCommitMsgLength: computeWeightedAverage(totalCommitMessageChars, totalCommitCount),
  })
}

export function computeScoring(input: {
  githubAnalysis: ReturnType<typeof analyzeGithubSignals>
  xAnalysis: ReturnType<typeof analyzeXSignals>
}) {
  const crossAnalysis = analyzeCrossPlatformSignals(
    input.githubAnalysis.samples.commitMessages,
    input.xAnalysis.samples.tweetTexts,
  )
  const combined = combinePlatformScores({
    github: input.githubAnalysis,
    x: input.xAnalysis,
    cross: crossAnalysis,
  })
  const breakdown = buildCombinedBreakdown({
    github: input.githubAnalysis,
    x: input.xAnalysis,
    cross: crossAnalysis,
    combined,
  })

  return { combined, breakdown, crossAnalysis }
}

export async function persistScore(input: {
  startedAtMs: number
  existingId?: string
  userId?: string
  targetGithub?: string
  targetX?: string
  source: 'self' | 'reported'
  score: number
  zone: Zone
  diagnosis: string
  indicators: string[]
  breakdown: CombinedBreakdown
  githubDataUsed: boolean
  xDataUsed: boolean
}) {
  const generationMs = Date.now() - input.startedAtMs
  const scoreId = input.existingId ?? nanoid()

  const values = {
    userId: input.userId ?? null,
    targetGithub: input.targetGithub ?? null,
    targetX: input.targetX ?? null,
    source: input.source,
    score: input.score,
    zone: input.zone,
    diagnosis: input.diagnosis,
    indicators: JSON.stringify(input.indicators),
    breakdown: JSON.stringify(input.breakdown),
    githubDataUsed: input.githubDataUsed,
    xDataUsed: input.xDataUsed,
    generationMs,
    modelVersion: 'claude-haiku-4-5-20251001',
  }

  if (input.existingId) {
    await db
      .update(psychosisScores)
      .set({ ...values, createdAt: sql`(unixepoch())` })
      .where(eq(psychosisScores.id, input.existingId))
  } else {
    await db.insert(psychosisScores).values({ id: scoreId, ...values })
  }

  return { id: scoreId, score: input.score, zone: input.zone }
}
