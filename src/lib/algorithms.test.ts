import { describe, expect, it } from 'vitest'
import { analyzeCrossPlatformSignals, combinePlatformScores } from './combined-algorithm'
import { analyzeGithubSignals } from './github-algorithm'
import { analyzeXSignals } from './x-algorithm'
import type { TweetSignals } from './x-indexer'

describe('GitHub algorithm', () => {
  it('produces a strong GitHub-only subscore from saturated signals', () => {
    const timestamps = Array.from({ length: 12 }, (_, index) => new Date(2026, 0, 1, 12, 0, index * 10).toISOString())
    const commitMessages = Array.from({ length: 12 }, () => 'feat(core): implement AI-generated orchestration layer')

    const result = analyzeGithubSignals({
      raw: {
        commitMessages,
        prTitles: [],
        commitTimestamps: timestamps,
        aiCoAuthorCount: 12,
        aiToolBreakdown: { cursor: 8, claude: 4 },
        commitDiffStats: timestamps.map((timestamp) => ({
          additions: 1200,
          deletions: 80,
          filesChanged: 24,
          timestamp,
        })),
        contributorStats: [
          {
            login: 'robot-dev',
            totalCommits: 12,
            totalAdditions: 12000,
            totalDeletions: 400,
            isBot: false,
            weeklyData: [
              { week: 1, additions: 100, deletions: 10, commits: 1 },
              { week: 2, additions: 120, deletions: 10, commits: 1 },
              { week: 3, additions: 130, deletions: 12, commits: 1 },
              { week: 4, additions: 5000, deletions: 30, commits: 5 },
            ],
          },
        ],
        markdownStats: {
          totalFilesInTree: 100,
          markdownFilesInTree: 45,
          markdownPercent: 45,
          commitsWithMarkdown: 10,
          totalCommitsAnalyzed: 12,
          markdownChurnRate: 83.3,
          markdownAdditions: 3000,
          totalAdditions: 9000,
          markdownAdditionPercent: 33.3,
        },
      },
      totalCommits: 12,
      commitMessages,
      commitTimeDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 12 : 0)),
      avgCommitMsgLength: 240,
    })

    expect(result.hasData).toBe(true)
    expect(result.signals.aiToolAttribution).toBe(100)
    expect(result.signals.commitMsgLength).toBe(100)
    expect(result.subscore).toBeGreaterThanOrEqual(82)
  })
})

describe('X algorithm', () => {
  it('computes an X-only subscore without GitHub data', () => {
    const tweetSignals: TweetSignals = {
      tweetCount: 24,
      avgTweetLength: 220,
      postingHourDistribution: Array.from({ length: 24 }, () => 1),
      avgEngagementCount: 0.5,
      threadRatio: 0.6,
      aiArtifactCount: 18,
      tweetTexts: [
        'Here is a comprehensive overview of the future of agentic development.',
        'Additionally, it is worth noting that leverage remains the key unlock.',
      ],
    }

    const result = analyzeXSignals(tweetSignals)

    expect(result.hasData).toBe(true)
    expect(result.signals.tweetFormality).toBeGreaterThan(60)
    expect(result.signals.postingRegularity).toBeGreaterThan(90)
    expect(result.signals.aiArtifactDensity).toBeGreaterThan(20)
    expect(result.subscore).toBeGreaterThan(40)
  })
})

describe('combined scoring', () => {
  it('uses platform subscores independently and combines them when both are present', () => {
    const github = analyzeGithubSignals({
      raw: {
        commitMessages: ['feat: improve shared agent workflow', 'feat: improve shared agent workflow'],
        prTitles: [],
        commitTimestamps: [
          new Date(2026, 0, 1, 12, 0, 0).toISOString(),
          new Date(2026, 0, 1, 12, 1, 0).toISOString(),
          new Date(2026, 0, 1, 12, 2, 0).toISOString(),
        ],
        aiCoAuthorCount: 2,
        aiToolBreakdown: { cursor: 2 },
        commitDiffStats: [
          { additions: 200, deletions: 20, filesChanged: 8, timestamp: new Date(2026, 0, 1, 12, 0, 0).toISOString() },
        ],
        contributorStats: [
          {
            login: 'dev',
            totalCommits: 3,
            totalAdditions: 400,
            totalDeletions: 30,
            isBot: false,
            weeklyData: [
              { week: 1, additions: 50, deletions: 5, commits: 1 },
              { week: 2, additions: 55, deletions: 5, commits: 1 },
              { week: 3, additions: 300, deletions: 20, commits: 3 },
            ],
          },
        ],
      },
      totalCommits: 3,
      commitMessages: [
        'feat: improve shared agent workflow',
        'feat: improve shared agent workflow',
        'feat: improve shared agent workflow',
      ],
      commitTimeDistribution: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 3 : 0)),
      avgCommitMsgLength: 160,
    })

    const x = analyzeXSignals({
      tweetCount: 12,
      avgTweetLength: 180,
      postingHourDistribution: Array.from({ length: 24 }, () => 1),
      avgEngagementCount: 1,
      threadRatio: 0.4,
      aiArtifactCount: 10,
      tweetTexts: [
        'Here is a comprehensive overview of our shared workflow.',
        'Additionally, shared workflow improvements continue.',
      ],
    })

    const cross = analyzeCrossPlatformSignals(github.samples.commitMessages, x.samples.tweetTexts)

    const githubOnly = combinePlatformScores({
      github,
      x: analyzeXSignals({
        tweetCount: 0,
        avgTweetLength: 0,
        postingHourDistribution: Array.from({ length: 24 }, () => 0),
        avgEngagementCount: 0,
        threadRatio: 0,
        aiArtifactCount: 0,
        tweetTexts: [],
      }),
      cross: analyzeCrossPlatformSignals([], []),
    })

    const xOnly = combinePlatformScores({
      github: analyzeGithubSignals({
        raw: {
          commitMessages: [],
          prTitles: [],
          commitTimestamps: [],
          aiCoAuthorCount: 0,
          aiToolBreakdown: {},
          commitDiffStats: [],
          contributorStats: [],
        },
        totalCommits: 0,
        commitMessages: [],
        commitTimeDistribution: Array.from({ length: 24 }, () => 0),
        avgCommitMsgLength: 0,
      }),
      x,
      cross: analyzeCrossPlatformSignals([], []),
    })

    const combined = combinePlatformScores({ github, x, cross })

    expect(githubOnly.score).toBe(github.subscore)
    expect(xOnly.score).toBe(x.subscore)
    expect(combined.weightsUsed.github).toBeDefined()
    expect(combined.weightsUsed.x).toBeDefined()
    expect(combined.weightsUsed.cross).toBeDefined()
    expect(combined.score).toBeGreaterThan(0)
  })
})
