import { clamp } from './algorithm-utils'
import type { GithubAnalysisResult, GithubSignalScores } from './github-algorithm'
import type { XAnalysisResult, XSignalScores } from './x-algorithm'

export interface CrossPlatformSignalScores {
  styleConsistency: number
  vocabularyDiversity: number
}

const CROSS_PLATFORM_SIGNAL_WEIGHTS: Record<keyof CrossPlatformSignalScores, number> = {
  styleConsistency: 0.65,
  vocabularyDiversity: 0.35,
}

interface CrossPlatformAnalysisResult {
  signals: CrossPlatformSignalScores
  subscore: number
  hasData: boolean
}

export interface CombinedWeightsUsed {
  github?: number
  x?: number
  cross?: number
}

export interface CombinedBreakdown {
  github: { signals: GithubSignalScores; subscore: number } | null
  x: { signals: XSignalScores; subscore: number } | null
  cross: { signals: CrossPlatformSignalScores; subscore: number } | null
  combined: {
    score: number
    zone: Zone
    weightsUsed: CombinedWeightsUsed
  }
}

export type Zone = 'SANE' | 'QUIRKY' | 'UNHINGED' | 'DERANGED' | 'FULL_PSYCHOSIS'

function getZone(score: number): Zone {
  if (score < 20) return 'SANE'
  if (score < 40) return 'QUIRKY'
  if (score < 60) return 'UNHINGED'
  if (score < 80) return 'DERANGED'
  return 'FULL_PSYCHOSIS'
}

function computeCrossPlatformSubscore(signals: CrossPlatformSignalScores): number {
  const totalWeight = Object.values(CROSS_PLATFORM_SIGNAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
  if (totalWeight === 0) return 0

  const weightedTotal = (
    Object.entries(CROSS_PLATFORM_SIGNAL_WEIGHTS) as Array<[keyof CrossPlatformSignalScores, number]>
  ).reduce((sum, [key, weight]) => sum + signals[key] * weight, 0)

  return clamp(Math.round(weightedTotal / totalWeight))
}

export function analyzeCrossPlatformSignals(
  commitMessages: string[],
  tweetTexts: string[],
): CrossPlatformAnalysisResult {
  if (commitMessages.length === 0 || tweetTexts.length === 0) {
    return {
      signals: { styleConsistency: 0, vocabularyDiversity: 0 },
      subscore: 0,
      hasData: false,
    }
  }

  const getWords = (texts: string[]) =>
    new Set(
      texts
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3),
    )

  const commitWords = getWords(commitMessages)
  const tweetWords = getWords(tweetTexts)

  let overlap = 0
  for (const word of commitWords) {
    if (tweetWords.has(word)) overlap++
  }

  const jaccardSimilarity = overlap / (commitWords.size + tweetWords.size - overlap || 1)
  const styleConsistency = clamp(jaccardSimilarity * 300)

  const allWords = [...commitWords, ...tweetWords]
  const uniqueRatio = new Set(allWords).size / (allWords.length || 1)
  const vocabularyDiversity = clamp(uniqueRatio > 0.7 ? (uniqueRatio - 0.7) * 300 : 0)

  const signals: CrossPlatformSignalScores = {
    styleConsistency,
    vocabularyDiversity,
  }

  return {
    signals,
    subscore: computeCrossPlatformSubscore(signals),
    hasData: true,
  }
}

export function combinePlatformScores(input: {
  github: GithubAnalysisResult
  x: XAnalysisResult
  cross: CrossPlatformAnalysisResult
}): { score: number; zone: Zone; weightsUsed: CombinedWeightsUsed } {
  const activeInputs: Array<{ score: number; weight: number; key: keyof CombinedWeightsUsed }> = []

  if (input.github.hasData) activeInputs.push({ key: 'github', score: input.github.subscore, weight: 0.65 })
  if (input.x.hasData) activeInputs.push({ key: 'x', score: input.x.subscore, weight: input.github.hasData ? 0.25 : 1 })
  if (input.github.hasData && input.x.hasData && input.cross.hasData) {
    activeInputs.push({ key: 'cross', score: input.cross.subscore, weight: 0.1 })
  }

  if (activeInputs.length === 0) {
    return { score: 0, zone: getZone(0), weightsUsed: {} }
  }

  const totalWeight = activeInputs.reduce((sum, entry) => sum + entry.weight, 0)
  const score = clamp(
    Math.round(activeInputs.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight),
  )
  const weightsUsed = Object.fromEntries(activeInputs.map((entry) => [entry.key, entry.weight / totalWeight]))

  return {
    score,
    zone: getZone(score),
    weightsUsed,
  }
}

export function buildCombinedBreakdown(input: {
  github: GithubAnalysisResult
  x: XAnalysisResult
  cross: CrossPlatformAnalysisResult
  combined: { score: number; zone: Zone; weightsUsed: CombinedWeightsUsed }
}): CombinedBreakdown {
  return {
    github: input.github.hasData ? { signals: input.github.signals, subscore: input.github.subscore } : null,
    x: input.x.hasData ? { signals: input.x.signals, subscore: input.x.subscore } : null,
    cross: input.cross.hasData ? { signals: input.cross.signals, subscore: input.cross.subscore } : null,
    combined: input.combined,
  }
}
