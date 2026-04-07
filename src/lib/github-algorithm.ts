import type { CommitDiffStat, ContributorStat, EnhancedRawData, MarkdownStats } from './github-indexer'
import { clamp, getTrigrams, shannonEntropy, trigramJaccard } from './algorithm-utils'

export interface GithubSignalScores {
  aiToolAttribution: number
  volumeVelocity: number
  commitBurstiness: number
  diffSizeAnomaly: number
  commitMsgSimilarity: number
  commitMsgFormality: number
  commitMsgLength: number
  commitTimeEntropy: number
  markdownDensity: number
}

export const GITHUB_SIGNAL_WEIGHTS: Record<keyof GithubSignalScores, number> = {
  aiToolAttribution: 0.22,
  volumeVelocity: 0.05,
  commitBurstiness: 0.09,
  diffSizeAnomaly: 0.1,
  commitMsgSimilarity: 0.08,
  markdownDensity: 0.05,
  commitMsgFormality: 0.06,
  commitMsgLength: 0.1,
  commitTimeEntropy: 0.03,
}

interface GithubAnalysisInput {
  raw: EnhancedRawData
  totalCommits: number
  commitMessages: string[]
  commitTimeDistribution: number[]
  avgCommitMsgLength: number
}

export interface GithubAnalysisResult {
  signals: GithubSignalScores
  subscore: number
  hasData: boolean
  samples: {
    commitMessages: string[]
  }
}

function emptyEnhancedRaw(): EnhancedRawData {
  return {
    commitMessages: [],
    prTitles: [],
    commitTimestamps: [],
    aiCoAuthorCount: 0,
    aiToolBreakdown: {},
    commitDiffStats: [],
    contributorStats: [],
    markdownStats: undefined,
  }
}

export function aggregateEnhancedRawData(raws: EnhancedRawData[]): EnhancedRawData {
  if (raws.length === 0) return emptyEnhancedRaw()

  const result = emptyEnhancedRaw()
  for (const raw of raws) {
    result.commitTimestamps.push(...(raw.commitTimestamps ?? []))
    result.aiCoAuthorCount += raw.aiCoAuthorCount ?? 0
    result.commitDiffStats.push(...(raw.commitDiffStats ?? []))

    for (const [tool, count] of Object.entries(raw.aiToolBreakdown ?? {})) {
      result.aiToolBreakdown[tool] = (result.aiToolBreakdown[tool] ?? 0) + count
    }

    for (const contributorStat of raw.contributorStats ?? []) {
      const existing = result.contributorStats.find((entry) => entry.login === contributorStat.login)
      if (existing) {
        existing.totalCommits += contributorStat.totalCommits
        existing.totalAdditions += contributorStat.totalAdditions
        existing.totalDeletions += contributorStat.totalDeletions
        existing.weeklyData.push(...contributorStat.weeklyData)
        existing.isBot = existing.isBot || contributorStat.isBot
      } else {
        result.contributorStats.push({ ...contributorStat, weeklyData: [...contributorStat.weeklyData] })
      }
    }

    if (raw.markdownStats) {
      if (!result.markdownStats) {
        result.markdownStats = { ...raw.markdownStats }
      } else {
        result.markdownStats.totalFilesInTree += raw.markdownStats.totalFilesInTree
        result.markdownStats.markdownFilesInTree += raw.markdownStats.markdownFilesInTree
        result.markdownStats.commitsWithMarkdown += raw.markdownStats.commitsWithMarkdown
        result.markdownStats.totalCommitsAnalyzed += raw.markdownStats.totalCommitsAnalyzed
        result.markdownStats.markdownAdditions += raw.markdownStats.markdownAdditions
        result.markdownStats.totalAdditions += raw.markdownStats.totalAdditions
      }
    }
  }

  if (result.markdownStats) {
    const markdownStats = result.markdownStats
    markdownStats.markdownPercent =
      markdownStats.totalFilesInTree > 0
        ? (markdownStats.markdownFilesInTree / markdownStats.totalFilesInTree) * 100
        : 0
    markdownStats.markdownChurnRate =
      markdownStats.totalCommitsAnalyzed > 0
        ? (markdownStats.commitsWithMarkdown / markdownStats.totalCommitsAnalyzed) * 100
        : 0
    markdownStats.markdownAdditionPercent =
      markdownStats.totalAdditions > 0 ? (markdownStats.markdownAdditions / markdownStats.totalAdditions) * 100 : 0
  }

  return result
}

function scoreAiToolAttribution(raw: EnhancedRawData, totalCommits: number): number {
  if (totalCommits === 0) return 0

  const aiCoAuthorCount = raw.aiCoAuthorCount ?? 0
  const toolBreakdown = raw.aiToolBreakdown ?? {}
  const distinctTools = Object.keys(toolBreakdown).length

  const ratio = aiCoAuthorCount / totalCommits
  let score = ratio <= 0.3 ? (ratio / 0.3) * 80 : 80 + (ratio - 0.3) * 28.6

  if (distinctTools >= 3) score *= 1.3
  else if (distinctTools >= 2) score *= 1.15

  return clamp(score)
}

function scoreVolumeVelocity(contributorStats: ContributorStat[]): number {
  if (contributorStats.length === 0) return 0

  const weeklyAdditions = new Map<number, number>()
  for (const contributorStat of contributorStats) {
    for (const week of contributorStat.weeklyData) {
      weeklyAdditions.set(week.week, (weeklyAdditions.get(week.week) ?? 0) + week.additions)
    }
  }

  const weeks = [...weeklyAdditions.values()]
  if (weeks.length < 2) return 0

  const mean = weeks.reduce((a, b) => a + b, 0) / weeks.length
  if (mean === 0) return 0

  const variance = weeks.reduce((sum, week) => sum + (week - mean) ** 2, 0) / weeks.length
  const stdDev = Math.sqrt(variance)
  if (stdDev === 0) return 0

  const zScores = weeks.map((week) => (week - mean) / stdDev)
  const maxZ = Math.max(...zScores)

  let maxConsecutiveSpikes = 0
  let currentStreak = 0
  for (const zScore of zScores) {
    if (zScore > 1.5) {
      currentStreak++
      maxConsecutiveSpikes = Math.max(maxConsecutiveSpikes, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  let score = maxZ * 25
  if (maxConsecutiveSpikes >= 3) score *= 1.4
  else if (maxConsecutiveSpikes >= 2) score *= 1.2

  return clamp(score)
}

function scoreCommitBurstiness(commitTimestamps: string[]): number {
  if (commitTimestamps.length < 3) return 0

  const sorted = commitTimestamps
    .map((timestamp) => new Date(timestamp).getTime())
    .filter((timestamp) => !isNaN(timestamp))
    .sort((a, b) => a - b)
  if (sorted.length < 3) return 0

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] - sorted[i - 1]) / 1000)
  }

  const burstThreshold = 120
  const burstCount = gaps.filter((gap) => gap < burstThreshold).length
  const ultraBurstCount = gaps.filter((gap) => gap < 30).length

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

  return clamp(score)
}

function scoreDiffSizeAnomaly(commitDiffStats: CommitDiffStat[]): number {
  if (commitDiffStats.length === 0) return 0

  const additions = commitDiffStats.map((stat) => stat.additions)
  const avgAdditions = additions.reduce((a, b) => a + b, 0) / additions.length
  const maxAdditions = Math.max(...additions)

  let score = 0
  if (avgAdditions > 200) score = 60 + Math.min((avgAdditions - 200) / 20, 40)
  else if (avgAdditions > 50) score = ((avgAdditions - 50) / 150) * 60

  if (maxAdditions > 1000) score = Math.max(score, 80)
  else if (maxAdditions > 500) score = Math.max(score, 60)

  const avgFiles = commitDiffStats.reduce((sum, stat) => sum + stat.filesChanged, 0) / commitDiffStats.length
  if (avgFiles > 15) score = Math.max(score, 50 + Math.min((avgFiles - 15) / 2, 30))

  return clamp(score)
}

function scoreMarkdownDensity(stats: MarkdownStats | undefined): number {
  if (!stats || stats.totalFilesInTree === 0) return 0

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

  return clamp(compositionScore * 0.45 + churnScore * 0.3 + additionScore * 0.25)
}

function scoreCommitMsgSimilarity(commitMessages: string[]): number {
  if (commitMessages.length < 5) return 0

  const stripped = commitMessages.map((message) =>
    message.replace(/^(feat|fix|chore|docs|refactor|test|ci|build|perf|style)(\([^)]*\))?:\s*/i, ''),
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

  let score = (combinedSim - 0.1) * 350
  if (maxConsecutiveSim > 0.45) score += 15
  else if (maxConsecutiveSim > 0.35) score += 8

  return clamp(score)
}

function scoreGithubLegacySignals(
  commitMessages: string[],
  commitTimeDistribution: number[],
  avgCommitMsgLength: number,
): Pick<GithubSignalScores, 'commitMsgFormality' | 'commitMsgLength' | 'commitTimeEntropy'> {
  if (commitMessages.length === 0) {
    return {
      commitMsgFormality: 0,
      commitMsgLength: 0,
      commitTimeEntropy: 0,
    }
  }

  const formalityScore =
    commitMessages.reduce((sum, message) => {
      let score = 0
      if (message.includes(':')) score += 10
      if (message.length > 72) score += 15
      if (/^(feat|fix|chore|docs|refactor|test|ci|build|perf|style)\(/i.test(message)) score += 5
      if (message.split('\n').length > 2) score += 10
      return sum + score
    }, 0) / commitMessages.length

  const entropy = shannonEntropy(commitTimeDistribution)
  const maxEntropy = Math.log2(24)

  return {
    commitMsgFormality: clamp(formalityScore * 2),
    commitMsgLength: clamp((avgCommitMsgLength / 200) * 100),
    commitTimeEntropy: clamp(entropy > 3.5 ? ((entropy - 3.5) / (maxEntropy - 3.5)) * 100 : 0),
  }
}

function computeGithubSubscore(signals: GithubSignalScores): number {
  const activeWeightTotal = Object.values(GITHUB_SIGNAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
  const weightedTotal = (Object.entries(GITHUB_SIGNAL_WEIGHTS) as Array<[keyof GithubSignalScores, number]>).reduce(
    (sum, [key, weight]) => sum + signals[key] * weight,
    0,
  )
  const baseScore = activeWeightTotal > 0 ? weightedTotal / activeWeightTotal : 0

  let satireBonus = 0
  if (signals.aiToolAttribution >= 90 && signals.commitMsgLength >= 90) satireBonus += 5
  if (signals.aiToolAttribution >= 90 && signals.commitBurstiness >= 60) satireBonus += 5
  if (signals.aiToolAttribution >= 90 && signals.diffSizeAnomaly >= 60) satireBonus += 5
  if (signals.aiToolAttribution >= 90 && signals.commitMsgFormality >= 60) satireBonus += 4
  if (signals.aiToolAttribution >= 90 && signals.commitMsgSimilarity >= 25) satireBonus += 4
  if (signals.aiToolAttribution >= 90 && signals.markdownDensity >= 35) satireBonus += 3
  if (signals.volumeVelocity >= 90 && signals.diffSizeAnomaly >= 70) satireBonus += 3

  const adjustedScore = baseScore + Math.min(satireBonus, 3)

  const burstFloor =
    signals.aiToolAttribution >= 50 &&
    signals.commitBurstiness >= 95 &&
    signals.commitMsgLength >= 95 &&
    signals.commitMsgFormality >= 70
      ? 82
      : 0

  const aiSprintFloor =
    signals.aiToolAttribution >= 85 &&
    signals.commitBurstiness >= 75 &&
    signals.diffSizeAnomaly >= 75 &&
    signals.commitMsgLength >= 95
      ? 82
      : 0

  const stealthAutomationFloor =
    signals.aiToolAttribution >= 95 &&
    signals.commitMsgLength >= 95 &&
    signals.diffSizeAnomaly >= 75 &&
    signals.commitMsgSimilarity >= 55 &&
    signals.commitBurstiness < 15 &&
    signals.markdownDensity < 10
      ? 82
      : 0

  const fullPsychosisFloor = Math.max(burstFloor, aiSprintFloor, stealthAutomationFloor)

  return clamp(Math.round(Math.max(adjustedScore, fullPsychosisFloor)))
}

export function analyzeGithubSignals(input: GithubAnalysisInput): GithubAnalysisResult {
  const hasData = input.totalCommits > 0
  if (!hasData) {
    return {
      signals: {
        aiToolAttribution: 0,
        volumeVelocity: 0,
        commitBurstiness: 0,
        diffSizeAnomaly: 0,
        commitMsgSimilarity: 0,
        commitMsgFormality: 0,
        commitMsgLength: 0,
        commitTimeEntropy: 0,
        markdownDensity: 0,
      },
      subscore: 0,
      hasData: false,
      samples: { commitMessages: [] },
    }
  }

  const legacySignals = scoreGithubLegacySignals(
    input.commitMessages,
    input.commitTimeDistribution,
    input.avgCommitMsgLength,
  )

  const signals: GithubSignalScores = {
    aiToolAttribution: scoreAiToolAttribution(input.raw, input.totalCommits),
    volumeVelocity: scoreVolumeVelocity(input.raw.contributorStats),
    commitBurstiness: scoreCommitBurstiness(input.raw.commitTimestamps),
    diffSizeAnomaly: scoreDiffSizeAnomaly(input.raw.commitDiffStats),
    commitMsgSimilarity: scoreCommitMsgSimilarity(input.commitMessages),
    markdownDensity: scoreMarkdownDensity(input.raw.markdownStats),
    ...legacySignals,
  }

  return {
    signals,
    subscore: computeGithubSubscore(signals),
    hasData: true,
    samples: {
      commitMessages: input.commitMessages,
    },
  }
}
