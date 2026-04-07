import { clamp, shannonEntropy } from './algorithm-utils'
import type { TweetSignals } from './x-indexer'

export interface XSignalScores {
  tweetFormality: number
  engagementRatio: number
  postingRegularity: number
  threadIntensity: number
  aiArtifactDensity: number
}

const X_SIGNAL_WEIGHTS: Record<keyof XSignalScores, number> = {
  tweetFormality: 0.3,
  engagementRatio: 0.2,
  postingRegularity: 0.15,
  threadIntensity: 0.15,
  aiArtifactDensity: 0.2,
}

export interface XAnalysisResult {
  signals: XSignalScores
  subscore: number
  hasData: boolean
  samples: {
    tweetTexts: string[]
  }
}

function scoreTweetFormality(signals: TweetSignals): number {
  const avgLength = signals.avgTweetLength
  return clamp(avgLength > 200 ? 60 + (avgLength - 200) / 5 : (avgLength / 200) * 60)
}

function scoreEngagementRatio(signals: TweetSignals): number {
  if (signals.tweetCount === 0) return 0

  const expectedEngagement =
    signals.avgTweetLength > 180 ? 8 : signals.avgTweetLength > 120 ? 5 : signals.avgTweetLength > 60 ? 3 : 2
  const engagementGap = Math.max(expectedEngagement - Math.min(signals.avgEngagementCount, expectedEngagement), 0)
  return clamp((engagementGap / expectedEngagement) * 100)
}

function scorePostingRegularity(signals: TweetSignals): number {
  const entropy = shannonEntropy(signals.postingHourDistribution)
  const maxEntropy = Math.log2(24)
  return clamp(entropy > 3.5 ? ((entropy - 3.5) / (maxEntropy - 3.5)) * 100 : 0)
}

function scoreThreadIntensity(signals: TweetSignals): number {
  return clamp(signals.threadRatio * 140)
}

function scoreAiArtifactDensity(signals: TweetSignals): number {
  if (signals.tweetCount === 0) return 0
  return clamp((signals.aiArtifactCount / signals.tweetCount) * 35)
}

function computeXSubscore(signals: XSignalScores): number {
  const totalWeight = Object.values(X_SIGNAL_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
  if (totalWeight === 0) return 0

  const weightedTotal = (Object.entries(X_SIGNAL_WEIGHTS) as Array<[keyof XSignalScores, number]>).reduce(
    (sum, [key, weight]) => sum + signals[key] * weight,
    0,
  )

  return clamp(Math.round(weightedTotal / totalWeight))
}

export function analyzeXSignals(tweetSignals: TweetSignals): XAnalysisResult {
  if (tweetSignals.tweetCount === 0) {
    return {
      signals: {
        tweetFormality: 0,
        engagementRatio: 0,
        postingRegularity: 0,
        threadIntensity: 0,
        aiArtifactDensity: 0,
      },
      subscore: 0,
      hasData: false,
      samples: { tweetTexts: [] },
    }
  }

  const signals: XSignalScores = {
    tweetFormality: scoreTweetFormality(tweetSignals),
    engagementRatio: scoreEngagementRatio(tweetSignals),
    postingRegularity: scorePostingRegularity(tweetSignals),
    threadIntensity: scoreThreadIntensity(tweetSignals),
    aiArtifactDensity: scoreAiArtifactDensity(tweetSignals),
  }

  return {
    signals,
    subscore: computeXSubscore(signals),
    hasData: true,
    samples: {
      tweetTexts: tweetSignals.tweetTexts,
    },
  }
}
