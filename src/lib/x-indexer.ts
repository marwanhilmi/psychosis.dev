import { db } from '#/db'
import { account, indexedTweets } from '#/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { fetchUserTweets, type XTweet } from './x-client'

export interface TweetSignals {
  tweetCount: number
  avgTweetLength: number
  postingHourDistribution: number[]
  avgEngagementCount: number
  threadRatio: number
  aiArtifactCount: number
  tweetTexts: string[] // sample for AI analysis
}

export function emptyTweetSignals(): TweetSignals {
  return {
    tweetCount: 0,
    avgTweetLength: 0,
    postingHourDistribution: Array.from({ length: 24 }, () => 0),
    avgEngagementCount: 0,
    threadRatio: 0,
    aiArtifactCount: 0,
    tweetTexts: [],
  }
}

export function computeTweetSignals(tweets: XTweet[]): TweetSignals {
  if (tweets.length === 0) {
    return emptyTweetSignals()
  }

  const avgLength = tweets.reduce((sum, t) => sum + t.text.length, 0) / tweets.length
  const avgEngagementCount =
    tweets.reduce((sum, t) => sum + t.likeCount + t.retweetCount + t.replyCount, 0) / tweets.length

  // Posting hour distribution
  const hourBuckets: number[] = Array.from({ length: 24 }, () => 0)
  for (const t of tweets) {
    const hour = new Date(t.createdAt).getUTCHours()
    hourBuckets[hour]++
  }

  // Thread detection (replies to self)
  const threads = tweets.filter((t) => t.text.startsWith('@'))
  const threadRatio = threads.length / tweets.length

  // AI artifact detection
  let aiArtifactCount = 0
  const aiPatterns = [
    /as an ai/i,
    /i'd be happy to/i,
    /here's a comprehensive/i,
    /let me elaborate/i,
    /it's worth noting/i,
    /in conclusion/i,
    /delve/i,
    /tapestry/i,
    /landscape/i,
    /leverage/i,
    /utilize/i,
    /facilitate/i,
    /straightforward/i,
    /comprehensive overview/i,
    /^\d+\.\s/m, // numbered lists in tweets
    /furthermore/i,
    /additionally/i,
  ]

  for (const t of tweets) {
    for (const pattern of aiPatterns) {
      if (pattern.test(t.text)) aiArtifactCount++
    }
  }

  return {
    tweetCount: tweets.length,
    avgTweetLength: Math.round(avgLength * 100) / 100,
    postingHourDistribution: hourBuckets,
    avgEngagementCount: Math.round(avgEngagementCount * 100) / 100,
    threadRatio: Math.round(threadRatio * 1000) / 1000,
    aiArtifactCount,
    tweetTexts: tweets.slice(0, 50).map((t) => t.text),
  }
}

export async function indexTweets(userId: string, bearerToken: string): Promise<TweetSignals> {
  // Get X account info from better-auth
  const [xAccount] = await db
    .select({ accessToken: account.accessToken, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'twitter')))

  // Use user's OAuth token if available, otherwise fall back to app bearer token
  const token = xAccount?.accessToken ?? bearerToken
  const xUserId = xAccount?.accountId

  if (!xUserId) {
    return computeTweetSignals([])
  }

  const tweets = await fetchUserTweets(token, xUserId, 800)

  // Store raw tweets in indexed_tweets
  if (tweets.length > 0) {
    // Delete old tweets for this user and insert fresh
    await db.delete(indexedTweets).where(eq(indexedTweets.userId, userId))

    const batchSize = 50
    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize)
      await db.insert(indexedTweets).values(
        batch.map((t) => ({
          id: nanoid(),
          userId,
          tweetId: t.id,
          text: t.text,
          createdAtX: new Date(t.createdAt),
          metrics: JSON.stringify({
            likes: t.likeCount,
            retweets: t.retweetCount,
            replies: t.replyCount,
          }),
        })),
      )
    }
  }

  return computeTweetSignals(tweets)
}
