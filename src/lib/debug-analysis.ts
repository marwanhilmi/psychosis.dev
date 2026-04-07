import {
  githubFetch,
  fetchCommits,
  fetchPRs,
  fetchContributorStats,
  fetchCommitDetails,
  fetchRepoTree,
  computeMetadata,
  computeMarkdownStats,
  fetchUserOwnedRepos,
  fetchUserContributedRepos,
} from '#/lib/github-indexer'
import type { EnhancedRawData, ContributorStat, CommitDiffStat, MarkdownStats } from '#/lib/github-indexer'
import { filterCommitsForActor, filterContributorStatsForActor } from '#/lib/psychosis-algorithm'
import {
  analyzeCrossPlatformSignals,
  buildCombinedBreakdown,
  combinePlatformScores,
  type CombinedBreakdown,
} from '#/lib/combined-algorithm'
import { aggregateEnhancedRawData, analyzeGithubSignals, GITHUB_SIGNAL_WEIGHTS } from '#/lib/github-algorithm'
import { analyzeXSignals } from '#/lib/x-algorithm'
import { computeTweetSignals, emptyTweetSignals } from '#/lib/x-indexer'
import { fetchUserTweets, lookupUserByUsernameOrThrow } from '#/lib/x-client'
// ─── Utilities ──────────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function shannonEntropy(distribution: number[]): number {
  const total = distribution.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const probs = distribution.map((v) => v / total).filter((p) => p > 0)
  return -probs.reduce((sum, p) => sum + p * Math.log2(p), 0)
}

function computeWeightedAverage(total: number, count: number): number {
  return count > 0 ? total / count : 0
}

// ─── Default Weights (mirrors psychosis-algorithm.ts) ───────────────────────────

const DEFAULT_WEIGHTS: Record<string, number> = { ...GITHUB_SIGNAL_WEIGHTS }

function getZone(score: number): string {
  if (score < 20) return 'SANE'
  if (score < 40) return 'QUIRKY'
  if (score < 60) return 'UNHINGED'
  if (score < 80) return 'DERANGED'
  return 'FULL_PSYCHOSIS'
}

function computeDebugFinalScore(signals: DebugSignal[], weights: Record<string, number>) {
  const activeWeightTotal = signals.reduce((sum, signal) => sum + (weights[signal.key] ?? 0), 0)
  if (activeWeightTotal === 0) {
    return {
      baseScore: 0,
      bonusPoints: 0,
      fullPsychosisFloor: 0,
      finalScore: 0,
      zone: getZone(0),
      bonusReasons: [] as string[],
    }
  }

  const byKey = Object.fromEntries(signals.map((signal) => [signal.key, signal.score])) as Record<string, number>
  const baseScore =
    signals.reduce((sum, signal) => sum + signal.score * (weights[signal.key] ?? 0), 0) / activeWeightTotal

  let bonusPoints = 0
  const bonusReasons: string[] = []
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgLength >= 90) {
    bonusPoints += 5
    bonusReasons.push('explicit AI attribution plus essay-length commits')
  }
  if (byKey.aiToolAttribution >= 90 && byKey.commitBurstiness >= 60) {
    bonusPoints += 5
    bonusReasons.push('rapid-fire AI commit spree')
  }
  if (byKey.aiToolAttribution >= 90 && byKey.diffSizeAnomaly >= 60) {
    bonusPoints += 5
    bonusReasons.push('industrial-scale AI diff dumps')
  }
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgFormality >= 60) {
    bonusPoints += 4
    bonusReasons.push('suspiciously polished AI prose commits')
  }
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgSimilarity >= 25) {
    bonusPoints += 4
    bonusReasons.push('templated assistant-style commit rhythm')
  }
  if (byKey.aiToolAttribution >= 90 && byKey.markdownDensity >= 35) {
    bonusPoints += 3
    bonusReasons.push('docs-heavy AI churn')
  }
  if (byKey.volumeVelocity >= 90 && byKey.diffSizeAnomaly >= 70) {
    bonusPoints += 3
    bonusReasons.push('high-velocity code flood')
  }

  const cappedBonusPoints = Math.min(bonusPoints, 3)
  const burstFloor =
    byKey.aiToolAttribution >= 50 &&
    byKey.commitBurstiness >= 95 &&
    byKey.commitMsgLength >= 95 &&
    byKey.commitMsgFormality >= 70
      ? 82
      : 0
  const aiSprintFloor =
    byKey.aiToolAttribution >= 85 &&
    byKey.commitBurstiness >= 75 &&
    byKey.diffSizeAnomaly >= 75 &&
    byKey.commitMsgLength >= 95
      ? 82
      : 0
  const stealthAutomationFloor =
    byKey.aiToolAttribution >= 95 &&
    byKey.commitMsgLength >= 95 &&
    byKey.diffSizeAnomaly >= 75 &&
    byKey.commitMsgSimilarity >= 55 &&
    byKey.commitBurstiness < 15 &&
    byKey.markdownDensity < 10
      ? 82
      : 0
  const fullPsychosisFloor = Math.max(burstFloor, aiSprintFloor, stealthAutomationFloor)

  const finalScore = clamp(Math.round(Math.max(baseScore + cappedBonusPoints, fullPsychosisFloor)))
  return {
    baseScore: clamp(Math.round(baseScore)),
    bonusPoints: cappedBonusPoints,
    fullPsychosisFloor,
    finalScore,
    zone: getZone(finalScore),
    bonusReasons,
  }
}

// ─── Debug Scoring Functions ────────────────────────────────────────────────────

export interface DebugSignal {
  key: string
  score: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: Record<string, any>
}

function debugScoreAiToolAttribution(raw: EnhancedRawData, totalCommits: number): DebugSignal {
  if (totalCommits === 0) return { key: 'aiToolAttribution', score: 0, details: { reason: 'no commits' } }

  const aiCoAuthorCount = raw.aiCoAuthorCount ?? 0
  const toolBreakdown = raw.aiToolBreakdown ?? {}
  const distinctTools = Object.keys(toolBreakdown).length
  const ratio = aiCoAuthorCount / totalCommits

  let score = ratio <= 0.3 ? (ratio / 0.3) * 80 : 80 + (ratio - 0.3) * 28.6
  let multiplier = 1
  if (distinctTools >= 3) multiplier = 1.3
  else if (distinctTools >= 2) multiplier = 1.15
  score *= multiplier

  return {
    key: 'aiToolAttribution',
    score: clamp(score),
    details: {
      aiCoAuthorCount,
      totalCommits,
      ratio: Math.round(ratio * 1000) / 1000,
      distinctTools,
      toolBreakdown,
      multiplier,
    },
  }
}

function debugScoreVolumeVelocity(contributorStats: ContributorStat[]): DebugSignal {
  if (contributorStats.length === 0)
    return { key: 'volumeVelocity', score: 0, details: { reason: 'no contributor stats' } }

  const weeklyAdditions = new Map<number, number>()
  for (const cs of contributorStats) {
    for (const w of cs.weeklyData) {
      weeklyAdditions.set(w.week, (weeklyAdditions.get(w.week) ?? 0) + w.additions)
    }
  }

  const weeks = [...weeklyAdditions.values()]
  if (weeks.length < 2)
    return { key: 'volumeVelocity', score: 0, details: { reason: 'insufficient weeks', weekCount: weeks.length } }

  const mean = weeks.reduce((a, b) => a + b, 0) / weeks.length
  if (mean === 0) return { key: 'volumeVelocity', score: 0, details: { reason: 'zero mean' } }

  const variance = weeks.reduce((sum, w) => sum + (w - mean) ** 2, 0) / weeks.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return { key: 'volumeVelocity', score: 0, details: { reason: 'zero std dev', mean } }

  const zScores = weeks.map((w) => Math.round(((w - mean) / stdDev) * 100) / 100)
  const maxZ = Math.max(...zScores)

  let maxConsecutiveSpikes = 0
  let currentStreak = 0
  for (const z of zScores) {
    if (z > 1.5) {
      currentStreak++
      maxConsecutiveSpikes = Math.max(maxConsecutiveSpikes, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  let score = maxZ * 25
  let spikeMultiplier = 1
  if (maxConsecutiveSpikes >= 3) spikeMultiplier = 1.4
  else if (maxConsecutiveSpikes >= 2) spikeMultiplier = 1.2
  score *= spikeMultiplier

  return {
    key: 'volumeVelocity',
    score: clamp(score),
    details: {
      weekCount: weeks.length,
      mean: Math.round(mean),
      stdDev: Math.round(stdDev),
      maxZ,
      maxConsecutiveSpikes,
      spikeMultiplier,
      topWeeks: [...weeklyAdditions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([week, adds]) => ({ week: new Date(week * 1000).toISOString().split('T')[0], additions: adds })),
    },
  }
}

function debugScoreCommitBurstiness(commitTimestamps: string[]): DebugSignal {
  if (commitTimestamps.length < 3)
    return {
      key: 'commitBurstiness',
      score: 0,
      details: { reason: 'insufficient timestamps', count: commitTimestamps.length },
    }

  const sorted = commitTimestamps
    .map((t) => new Date(t).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)

  if (sorted.length < 3)
    return { key: 'commitBurstiness', score: 0, details: { reason: 'insufficient valid timestamps' } }

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] - sorted[i - 1]) / 1000)
  }

  const burstThreshold = 120
  const burstCount = gaps.filter((g) => g < burstThreshold).length
  const ultraBurstCount = gaps.filter((g) => g < 30).length
  let maxBurstStreak = 0
  let currentBurstStreak = 0
  for (const gap of gaps) {
    if (gap < burstThreshold) {
      currentBurstStreak++
      maxBurstStreak = Math.max(maxBurstStreak, currentBurstStreak)
    } else {
      currentBurstStreak = 0
    }
  }
  const burstRatio = burstCount / gaps.length
  let score = burstRatio * 220
  if (ultraBurstCount > 0) score += (ultraBurstCount / gaps.length) * 140
  if (maxBurstStreak >= 10) score += 30
  else if (maxBurstStreak >= 5) score += 15

  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)]

  return {
    key: 'commitBurstiness',
    score: clamp(score),
    details: {
      totalGaps: gaps.length,
      burstCount,
      ultraBurstCount,
      burstRatio: Math.round(burstRatio * 1000) / 1000,
      maxBurstStreak,
      burstThresholdSec: burstThreshold,
      medianGapSec: Math.round(medianGap),
      shortestGaps: sortedGaps.slice(0, 5).map((g) => Math.round(g)),
    },
  }
}

function debugScoreDiffSizeAnomaly(commitDiffStats: CommitDiffStat[]): DebugSignal {
  if (commitDiffStats.length === 0) return { key: 'diffSizeAnomaly', score: 0, details: { reason: 'no diff stats' } }

  const additions = commitDiffStats.map((d) => d.additions)
  const avgAdditions = additions.reduce((a, b) => a + b, 0) / additions.length
  const maxAdditions = Math.max(...additions)

  let score = 0
  if (avgAdditions > 200) score = 60 + Math.min((avgAdditions - 200) / 20, 40)
  else if (avgAdditions > 50) score = ((avgAdditions - 50) / 150) * 60

  if (maxAdditions > 1000) score = Math.max(score, 80)
  else if (maxAdditions > 500) score = Math.max(score, 60)

  const avgFiles = commitDiffStats.reduce((sum, d) => sum + d.filesChanged, 0) / commitDiffStats.length
  if (avgFiles > 15) score = Math.max(score, 50 + Math.min((avgFiles - 15) / 2, 30))

  return {
    key: 'diffSizeAnomaly',
    score: clamp(score),
    details: {
      avgAdditions: Math.round(avgAdditions),
      maxAdditions,
      avgFilesChanged: Math.round(avgFiles * 10) / 10,
      commitCount: commitDiffStats.length,
      largestCommits: [...commitDiffStats]
        .sort((a, b) => b.additions - a.additions)
        .slice(0, 5)
        .map((d) => ({ additions: d.additions, deletions: d.deletions, files: d.filesChanged })),
    },
  }
}

function getTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '')
  const trigrams = new Set<string>()
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.substring(i, i + 3))
  }
  return trigrams
}

function trigramJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const t of a) {
    if (b.has(t)) intersection++
  }
  return intersection / (a.size + b.size - intersection)
}

function debugScoreCommitMsgSimilarity(commitMessages: string[]): DebugSignal {
  if (commitMessages.length < 5)
    return {
      key: 'commitMsgSimilarity',
      score: 0,
      details: { reason: 'insufficient messages', count: commitMessages.length },
    }

  const stripped = commitMessages.map((m) =>
    m.replace(/^(feat|fix|chore|docs|refactor|test|ci|build|perf|style)(\([^)]*\))?:\s*/i, ''),
  )
  const trigrams = stripped.map(getTrigrams)

  let totalSim = 0
  let pairs = 0
  for (let i = 1; i < trigrams.length; i++) {
    totalSim += trigramJaccard(trigrams[i - 1], trigrams[i])
    pairs++
  }
  const avgConsecutiveSim = pairs > 0 ? totalSim / pairs : 0

  let broadSim = 0
  let broadPairs = 0
  const step = Math.max(1, Math.floor(trigrams.length / 10))
  for (let i = 0; i < trigrams.length; i += step) {
    for (let j = i + step; j < trigrams.length; j += step) {
      broadSim += trigramJaccard(trigrams[i], trigrams[j])
      broadPairs++
    }
  }
  const avgBroadSim = broadPairs > 0 ? broadSim / broadPairs : 0
  const combinedSim = avgConsecutiveSim * 0.6 + avgBroadSim * 0.4
  let maxConsecutiveSim = 0
  for (let i = 1; i < trigrams.length; i++) {
    maxConsecutiveSim = Math.max(maxConsecutiveSim, trigramJaccard(trigrams[i - 1], trigrams[i]))
  }

  const similarPairs: Array<{ i: number; j: number; sim: number; a: string; b: string }> = []
  for (let i = 1; i < Math.min(trigrams.length, 30); i++) {
    const sim = trigramJaccard(trigrams[i - 1], trigrams[i])
    if (sim > 0.3) {
      similarPairs.push({
        i: i - 1,
        j: i,
        sim: Math.round(sim * 100) / 100,
        a: stripped[i - 1].slice(0, 80),
        b: stripped[i].slice(0, 80),
      })
    }
  }

  return {
    key: 'commitMsgSimilarity',
    score: clamp((combinedSim - 0.1) * 350 + (maxConsecutiveSim > 0.45 ? 15 : maxConsecutiveSim > 0.35 ? 8 : 0)),
    details: {
      messageCount: commitMessages.length,
      avgConsecutiveSim: Math.round(avgConsecutiveSim * 1000) / 1000,
      avgBroadSim: Math.round(avgBroadSim * 1000) / 1000,
      combinedSim: Math.round(combinedSim * 1000) / 1000,
      maxConsecutiveSim: Math.round(maxConsecutiveSim * 1000) / 1000,
      threshold: 0.1,
      mostSimilarPairs: similarPairs.sort((a, b) => b.sim - a.sim).slice(0, 5),
    },
  }
}

function debugScoreMarkdownDensity(stats: MarkdownStats | undefined): DebugSignal {
  if (!stats || stats.totalFilesInTree === 0) {
    return { key: 'markdownDensity', score: 0, details: { reason: 'no tree data' } }
  }

  const compositionScore =
    stats.markdownPercent > 40
      ? 80 + Math.min((stats.markdownPercent - 40) / 3, 20)
      : stats.markdownPercent > 20
        ? ((stats.markdownPercent - 20) / 20) * 80
        : stats.markdownPercent > 10
          ? ((stats.markdownPercent - 10) / 10) * 30
          : 0

  const churnScore =
    stats.markdownChurnRate > 60
      ? 70 + Math.min((stats.markdownChurnRate - 60) / 4, 30)
      : stats.markdownChurnRate > 30
        ? ((stats.markdownChurnRate - 30) / 30) * 70
        : 0

  const additionScore =
    stats.markdownAdditionPercent > 50
      ? 70 + Math.min((stats.markdownAdditionPercent - 50) / 5, 30)
      : stats.markdownAdditionPercent > 20
        ? ((stats.markdownAdditionPercent - 20) / 30) * 70
        : 0

  const combined = compositionScore * 0.45 + churnScore * 0.3 + additionScore * 0.25

  return {
    key: 'markdownDensity',
    score: clamp(combined),
    details: {
      totalFilesInTree: stats.totalFilesInTree,
      markdownFilesInTree: stats.markdownFilesInTree,
      markdownPercent: Math.round(stats.markdownPercent * 10) / 10,
      commitsWithMarkdown: stats.commitsWithMarkdown,
      totalCommitsAnalyzed: stats.totalCommitsAnalyzed,
      markdownChurnRate: Math.round(stats.markdownChurnRate * 10) / 10,
      markdownAdditions: stats.markdownAdditions,
      totalAdditions: stats.totalAdditions,
      markdownAdditionPercent: Math.round(stats.markdownAdditionPercent * 10) / 10,
      compositionScore: Math.round(compositionScore * 10) / 10,
      churnScore: Math.round(churnScore * 10) / 10,
      additionScore: Math.round(additionScore * 10) / 10,
    },
  }
}

function debugScoreGithubLegacy(
  commitMessages: string[],
  commitTimeDistribution: number[],
  avgCommitMsgLength: number,
): DebugSignal[] {
  if (commitMessages.length === 0) {
    return [
      { key: 'commitMsgFormality', score: 0, details: { reason: 'no commits' } },
      { key: 'commitMsgLength', score: 0, details: { reason: 'no commits' } },
      { key: 'commitTimeEntropy', score: 0, details: { reason: 'no commits' } },
    ]
  }

  const formalityScores = commitMessages.map((msg) => {
    let s = 0
    if (msg.includes(':')) s += 10
    if (msg.length > 72) s += 15
    if (/^(feat|fix|chore|docs|refactor|test|ci|build|perf|style)\(/i.test(msg)) s += 5
    if (msg.split('\n').length > 2) s += 10
    return s
  })
  const avgFormality = formalityScores.reduce((a, b) => a + b, 0) / formalityScores.length
  const commitMsgFormality = clamp(avgFormality * 2)

  const commitMsgLength = clamp((avgCommitMsgLength / 200) * 100)

  const entropy = shannonEntropy(commitTimeDistribution)
  const maxEntropy = Math.log2(24)
  const commitTimeEntropy = clamp(entropy > 3.5 ? ((entropy - 3.5) / (maxEntropy - 3.5)) * 100 : 0)

  return [
    {
      key: 'commitMsgFormality',
      score: commitMsgFormality,
      details: { avgFormality: Math.round(avgFormality * 100) / 100 },
    },
    {
      key: 'commitMsgLength',
      score: commitMsgLength,
      details: { avgCommitMsgLength: Math.round(avgCommitMsgLength) },
    },
    {
      key: 'commitTimeEntropy',
      score: commitTimeEntropy,
      details: {
        entropy: Math.round(entropy * 100) / 100,
        maxEntropy: Math.round(maxEntropy * 100) / 100,
        hourDistribution: commitTimeDistribution,
      },
    },
  ]
}

// ─── Public API ─────────────────────────────────────────────────────────────────

interface DebugAnalysisInput {
  username?: string
  xUsername?: string
  maxRepos?: number
  token?: string
  xBearerToken?: string
  selectedRepos?: string[] // full_name list — if provided, overrides maxRepos
}

export interface DebugAnalysisResult {
  signals: DebugSignal[]
  defaultWeights: Record<string, number>
  baseScore: number
  bonusPoints: number
  fullPsychosisFloor: number
  bonusReasons: string[]
  finalScore: number
  zone: string
  totalCommits: number
  contributors: Array<{
    login: string
    totalCommits: number
    totalAdditions: number
    totalDeletions: number
    isBot: boolean
  }>
  aiToolBreakdown: Record<string, number>
  aiCoAuthorCount: number
  perRepo: Array<{
    repo: string
    commits: number
    prs: number
    contributorCount: number
    stars: number
  }>
  logs: string[]
  elapsedMs: number
  rateLimit: { remaining: number; limit: number; reset: string } | null
  commitMessages: string[]
  tweetTexts: string[]
  commitTimeDistribution: number[]
  breakdown: CombinedBreakdown
  platformScores: {
    github: number
    x: number
    combined: number
  }
  githubDataUsed: boolean
  xDataUsed: boolean
  targetGithub: string | null
  targetX: string | null
}

export class DebugAnalysisError extends Error {
  logs: string[]
  constructor(message: string, logs: string[]) {
    super(message)
    this.name = 'DebugAnalysisError'
    this.logs = logs
  }
}

export interface DebugRepoItem {
  fullName: string
  language: string | null
  stars: number
  pushedAt: string
}

export async function fetchDebugRepos(username: string, token: string): Promise<DebugRepoItem[]> {
  const [ownedRepos, contributedRepos] = await Promise.all([
    fetchUserOwnedRepos(username, token, 100),
    fetchUserContributedRepos(username, token, 100),
  ])

  const candidates = new Map<string, { stars: number; pushedAt: string }>()
  for (const repo of [...ownedRepos, ...contributedRepos]) {
    const existing = candidates.get(repo.fullName)
    if (existing) {
      existing.stars = Math.max(existing.stars, repo.stars)
      existing.pushedAt = existing.pushedAt > repo.pushedAt ? existing.pushedAt : repo.pushedAt
    } else {
      candidates.set(repo.fullName, { stars: repo.stars, pushedAt: repo.pushedAt })
    }
  }

  if (candidates.size === 0) {
    const profileRes = await githubFetch(`https://api.github.com/users/${encodeURIComponent(username)}`, token)
    if (profileRes.status === 404) throw new Error(`GitHub user "${username}" not found`)
    if (profileRes.status === 401) throw new Error('Invalid GitHub token')
    if (profileRes.status === 403) throw new Error('GitHub rate limit exceeded')
    if (!profileRes.ok) throw new Error(`GitHub API returned ${profileRes.status}`)
  }

  const repoSummaries = await Promise.all(
    [...candidates.entries()].map(async ([fullName, summary]) => {
      const res = await githubFetch(`https://api.github.com/repos/${fullName}`, token)
      if (!res.ok) {
        return {
          fullName,
          language: null,
          stars: summary.stars,
          pushedAt: summary.pushedAt,
        }
      }

      const repo = (await res.json()) as {
        full_name: string
        language: string | null
        stargazers_count: number
        pushed_at: string
      }

      return {
        fullName: repo.full_name,
        language: repo.language,
        stars: repo.stargazers_count,
        pushedAt: repo.pushed_at,
      }
    }),
  )

  return repoSummaries.sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())
}

export async function runDebugAnalysis(input: DebugAnalysisInput): Promise<DebugAnalysisResult> {
  const startMs = Date.now()
  const logs: string[] = []
  const log = (msg: string) => logs.push(`[${((Date.now() - startMs) / 1000).toFixed(1)}s] ${msg}`)

  const { username, xUsername, maxRepos = 5, token = '' } = input

  log(
    `Analyzing github="${username ?? ''}" x="${xUsername ?? ''}" (max ${maxRepos} repos, token: ${token ? `${token.length} chars, starts with ${token.slice(0, 4)}...` : 'none'})`,
  )

  try {
    return await runDebugAnalysisInner(input, logs, log, startMs)
  } catch (e) {
    log(`Error: ${e instanceof Error ? e.message : String(e)}`)
    throw new DebugAnalysisError(e instanceof Error ? e.message : 'Analysis failed', logs)
  }
}

async function runDebugAnalysisInner(
  input: DebugAnalysisInput,
  logs: string[],
  log: (msg: string) => void,
  startMs: number,
): Promise<DebugAnalysisResult> {
  const { username, xUsername, maxRepos = 5, token = '' } = input

  if (!username && !xUsername) {
    throw new Error('At least one GitHub or X username is required')
  }

  // Pre-check GitHub rate limit only when GitHub analysis is requested.
  const rlHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'psychosismeter',
  }
  if (token) rlHeaders.Authorization = `Bearer ${token}`

  if (username) {
    try {
      const rlRes = await fetch('https://api.github.com/rate_limit', { headers: rlHeaders })

      if (rlRes.status === 401) {
        throw new Error('GitHub rejected the token (HTTP 401). Check that your PAT is correct and not expired.')
      }

      if (rlRes.status === 403) {
        const resetHeader = rlRes.headers.get('x-ratelimit-reset')
        const resetTime = resetHeader ? new Date(Number(resetHeader) * 1000).toISOString() : 'unknown'
        throw new Error(
          `GitHub API rate limit exceeded (resets at ${resetTime}).${!token ? ' Add a GitHub Personal Access Token for 5000 req/hr (unauthenticated limit is 60/hr).' : ' Even with your token, you are rate limited — try again later.'}`,
        )
      }

      if (rlRes.ok) {
        const rl = (await rlRes.json()) as {
          resources: { core: { remaining: number; limit: number; reset: number } }
        }
        const remaining = rl.resources.core.remaining
        const limit = rl.resources.core.limit
        const resetTime = new Date(rl.resources.core.reset * 1000).toISOString()
        log(
          `Rate limit: ${remaining}/${limit} remaining, resets at ${resetTime} (${limit >= 5000 ? 'authenticated ✓' : 'UNAUTHENTICATED'})`,
        )

        if (token && limit < 5000) {
          throw new Error(
            `Token was provided but GitHub reports unauthenticated rate limit (${limit}/hr). Your token may be invalid, expired, or malformed. Expected a fine-grained PAT starting with "github_pat_" or a classic token starting with "ghp_".`,
          )
        }

        if (remaining < 10) {
          throw new Error(
            `GitHub API rate limit nearly exhausted (${remaining}/${limit}). Resets at ${resetTime}. ${
              !token ? 'Add a GitHub token for 5000 req/hr.' : ''
            }`,
          )
        }
      }
    } catch (e) {
      if (e instanceof Error) {
        log(`Pre-check error: ${e.message}`)
        throw e
      }
    }
  }

  const { selectedRepos } = input

  let repos: Array<{ full_name: string; stargazers_count: number }>

  if (!username) {
    repos = []
  } else if (selectedRepos && selectedRepos.length > 0) {
    // Use pre-selected repos — skip the list fetch
    log(`Using ${selectedRepos.length} pre-selected repos`)
    repos = selectedRepos.map((name) => ({ full_name: name, stargazers_count: 0 }))
  } else {
    const reposRes = await githubFetch(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=${maxRepos}&sort=pushed&type=public`,
      token,
    )

    // Log response headers for auth diagnostics
    const rlLimit = reposRes.headers.get('x-ratelimit-limit')
    const rlRemaining = reposRes.headers.get('x-ratelimit-remaining')
    const rlReset = reposRes.headers.get('x-ratelimit-reset')
    log(`Repos response: ${reposRes.status} — x-ratelimit-limit: ${rlLimit}, remaining: ${rlRemaining}`)

    if (token && rlLimit && Number(rlLimit) < 5000) {
      throw new Error(
        `Token was provided but GitHub is not recognizing it (rate limit: ${rlLimit}/hr instead of 5000/hr). Your token may be invalid, expired, or revoked. Expected a fine-grained PAT starting with "github_pat_" or a classic token starting with "ghp_".`,
      )
    }

    if (!reposRes.ok) {
      const status = reposRes.status
      if (status === 404) throw new Error(`GitHub user "${username}" not found`)
      if (status === 401) throw new Error('Invalid GitHub token — check that your PAT is correct')
      if (status === 403) {
        const resetTime = rlReset ? new Date(Number(rlReset) * 1000).toISOString() : 'unknown'
        throw new Error(
          `GitHub rate limit exceeded (resets at ${resetTime}).${!token ? ' Add a GitHub Personal Access Token for 5000 req/hr (unauthenticated limit is 60/hr).' : ' Try again later.'}`,
        )
      }
      throw new Error(`GitHub API returned ${status}`)
    }

    repos = (await reposRes.json()) as Array<{ full_name: string; stargazers_count: number }>
    log(`Found ${repos.length} repos`)

    if (repos.length === 0) {
      throw new Error(`No public repos found for "${username}"`)
    }
  }

  const perRepo: DebugAnalysisResult['perRepo'] = []
  const allEnhancedRaw: EnhancedRawData[] = []
  let totalCommitCount = 0
  let totalCommitMessageChars = 0
  let allCommitMessages: string[] = []
  const aggregatedTimeDist: number[] = Array.from({ length: 24 }, () => 0)

  for (const repo of selectedRepos ? repos : repos.slice(0, maxRepos)) {
    try {
      log(`Fetching ${repo.full_name}...`)
      const repoStart = Date.now()

      const [allCommits, prs, contribStats] = await Promise.all([
        fetchCommits(repo.full_name, token),
        fetchPRs(repo.full_name, token),
        fetchContributorStats(repo.full_name, token),
      ])

      // Filter to target user's commits only (matching report path behavior)
      const commits = username ? filterCommitsForActor(allCommits, username) : allCommits
      if (commits.length === 0) {
        log(`  ${repo.full_name}: no commits by ${username}, skipping`)
        continue
      }
      const actorContribStats = username ? filterContributorStatsForActor(contribStats, username) : contribStats

      const headSha = allCommits[0]?.sha ?? commits[0]?.sha ?? ''
      const [commitDetailData, treeData] = await Promise.all([
        fetchCommitDetails(
          repo.full_name,
          commits.slice(0, 25).map((c) => c.sha),
          token,
        ),
        headSha ? fetchRepoTree(repo.full_name, headSha, token) : Promise.resolve({ totalFiles: 0, markdownFiles: 0 }),
      ])

      const mdStats = computeMarkdownStats(commitDetailData, treeData)
      log(
        `  ${repo.full_name}: tree ${treeData.totalFiles} files, ${treeData.markdownFiles} markdown (${Math.round(mdStats.markdownPercent)}%), churn ${Math.round(mdStats.markdownChurnRate)}%`,
      )

      const meta = computeMetadata(commits, [], actorContribStats, commitDetailData, mdStats)

      totalCommitCount += meta.totalCommits
      totalCommitMessageChars += meta.avgCommitMsgLength * meta.totalCommits

      if (meta.commitTimeDistribution) {
        const dist = JSON.parse(meta.commitTimeDistribution) as number[]
        dist.forEach((v, i) => {
          aggregatedTimeDist[i] += v
        })
      }

      if (meta.rawData) {
        const raw = JSON.parse(meta.rawData) as EnhancedRawData
        allCommitMessages.push(...(raw.commitMessages ?? []))
        allEnhancedRaw.push(raw)
      }

      perRepo.push({
        repo: repo.full_name,
        commits: commits.length,
        prs: prs.length,
        contributorCount: actorContribStats.length,
        stars: repo.stargazers_count ?? 0,
      })

      log(
        `  ${repo.full_name}: ${commits.length}/${allCommits.length} commits by ${username ?? 'all'}, ${prs.length} PRs, ${actorContribStats.length} contributors (${Date.now() - repoStart}ms)`,
      )
    } catch (e) {
      log(`  ${repo.full_name}: FAILED — ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const aggregated = aggregateEnhancedRawData(allEnhancedRaw)
  const avgCommitMsgLength = computeWeightedAverage(totalCommitMessageChars, totalCommitCount)

  let tweetTexts: string[] = []
  let xAnalysis = analyzeXSignals(emptyTweetSignals())
  if (xUsername) {
    const bearerToken = input.xBearerToken
    if (!bearerToken) {
      throw new Error('X_BEARER_TOKEN is required for X debug analysis')
    }

    log(`Fetching X tweets for @${xUsername}...`)
    const xUser = await lookupUserByUsernameOrThrow(bearerToken, xUsername)
    const tweets = await fetchUserTweets(bearerToken, xUser.id, 800)
    const tweetSignals = computeTweetSignals(tweets)
    tweetTexts = tweetSignals.tweetTexts
    xAnalysis = analyzeXSignals(tweetSignals)
    log(`Fetched ${tweetSignals.tweetCount} tweets for @${xUsername}`)
  }

  log('Scoring signals...')
  const signals: DebugSignal[] = [
    debugScoreAiToolAttribution(aggregated, totalCommitCount),
    debugScoreVolumeVelocity(aggregated.contributorStats),
    debugScoreCommitBurstiness(aggregated.commitTimestamps),
    debugScoreDiffSizeAnomaly(aggregated.commitDiffStats),
    debugScoreCommitMsgSimilarity(allCommitMessages),
    debugScoreMarkdownDensity(aggregated.markdownStats),
    ...debugScoreGithubLegacy(allCommitMessages, aggregatedTimeDist, avgCommitMsgLength),
  ]

  const githubAnalysis = analyzeGithubSignals({
    raw: aggregated,
    totalCommits: totalCommitCount,
    commitMessages: allCommitMessages,
    commitTimeDistribution: aggregatedTimeDist,
    avgCommitMsgLength,
  })
  const crossAnalysis = analyzeCrossPlatformSignals(allCommitMessages, tweetTexts)
  const combinedAnalysis = combinePlatformScores({
    github: githubAnalysis,
    x: xAnalysis,
    cross: crossAnalysis,
  })
  const breakdown = buildCombinedBreakdown({
    github: githubAnalysis,
    x: xAnalysis,
    cross: crossAnalysis,
    combined: combinedAnalysis,
  })
  const scoreMeta = computeDebugFinalScore(signals, DEFAULT_WEIGHTS)
  const finalScore = combinedAnalysis.score
  const zone = combinedAnalysis.zone

  log(`GitHub subscore: ${githubAnalysis.subscore}`)
  log(`X subscore: ${xAnalysis.subscore}`)
  log(`Combined score: ${combinedAnalysis.score}`)

  log('Analysis complete')

  let rateLimit: DebugAnalysisResult['rateLimit'] = null
  if (username) {
    try {
      const rateLimitRes = await githubFetch('https://api.github.com/rate_limit', token)
      if (rateLimitRes.ok) {
        const rl = (await rateLimitRes.json()) as {
          resources: { core: { remaining: number; limit: number; reset: number } }
        }
        rateLimit = {
          remaining: rl.resources.core.remaining,
          limit: rl.resources.core.limit,
          reset: new Date(rl.resources.core.reset * 1000).toISOString(),
        }
        log(`Rate limit: ${rateLimit.remaining}/${rateLimit.limit}`)
      }
    } catch {
      // Non-critical
    }
  }

  return {
    signals,
    defaultWeights: DEFAULT_WEIGHTS,
    baseScore: scoreMeta.baseScore,
    bonusPoints: scoreMeta.bonusPoints,
    fullPsychosisFloor: scoreMeta.fullPsychosisFloor,
    bonusReasons: scoreMeta.bonusReasons,
    finalScore,
    zone,
    totalCommits: totalCommitCount,
    contributors: aggregated.contributorStats.map((c) => ({
      login: c.login,
      totalCommits: c.totalCommits,
      totalAdditions: c.totalAdditions,
      totalDeletions: c.totalDeletions,
      isBot: c.isBot,
    })),
    aiToolBreakdown: aggregated.aiToolBreakdown,
    aiCoAuthorCount: aggregated.aiCoAuthorCount,
    perRepo,
    logs,
    elapsedMs: Date.now() - startMs,
    rateLimit,
    commitMessages: allCommitMessages.slice(0, 50),
    tweetTexts,
    commitTimeDistribution: aggregatedTimeDist,
    breakdown,
    platformScores: {
      github: githubAnalysis.subscore,
      x: xAnalysis.subscore,
      combined: combinedAnalysis.score,
    },
    githubDataUsed: githubAnalysis.hasData,
    xDataUsed: xAnalysis.hasData,
    targetGithub: username ?? null,
    targetX: xUsername ?? null,
  }
}
