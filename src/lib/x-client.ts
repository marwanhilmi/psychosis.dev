export interface XTweet {
  id: string
  text: string
  authorId: string
  authorUsername: string
  createdAt: string
  likeCount: number
  retweetCount: number
  replyCount: number
}

interface XApiResponse {
  data?: Array<{
    id: string
    text: string
    author_id: string
    created_at: string
    public_metrics: {
      like_count: number
      retweet_count: number
      reply_count: number
      impression_count: number
    }
  }>
  includes?: {
    users?: Array<{ id: string; username: string; name: string }>
  }
  meta?: { result_count: number; next_token?: string }
}

interface XUserResponse {
  data?: { id: string; username: string; name: string }
}

const BASE_URL = 'https://api.x.com/2'

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

export async function fetchUserTweets(bearerToken: string, userId: string, maxTweets: number = 800): Promise<XTweet[]> {
  const allTweets: XTweet[] = []
  let paginationToken: string | undefined

  while (allTweets.length < maxTweets) {
    const params = new URLSearchParams({
      max_results: String(Math.min(100, maxTweets - allTweets.length)),
      'tweet.fields': 'created_at,public_metrics,author_id',
      expansions: 'author_id',
      'user.fields': 'username',
    })

    if (paginationToken) {
      params.set('pagination_token', paginationToken)
    }

    const response = await fetchWithRateLimit(bearerToken, `${BASE_URL}/users/${userId}/tweets?${params}`)

    if (!response.ok) break

    const data: XApiResponse = await response.json()
    const tweets = transformTweets(data)
    allTweets.push(...tweets)

    paginationToken = data.meta?.next_token
    if (!paginationToken) break
  }

  return allTweets
}

export async function lookupUserByUsernameOrThrow(
  bearerToken: string,
  username: string,
): Promise<{ id: string; username: string }> {
  const response = await fetchWithRateLimit(
    bearerToken,
    `${BASE_URL}/users/by/username/${encodeURIComponent(username)}`,
  )

  if (response.status === 404) {
    throw new Error(`X user "${username}" not found`)
  }

  if (response.status === 401) {
    throw new Error('X lookup unauthorized. Check X_BEARER_TOKEN.')
  }

  if (response.status === 403) {
    const body = await readErrorBody(response)
    throw new Error(`X lookup forbidden.${body ? ` ${body}` : ''}`)
  }

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(`X lookup failed with status ${response.status}.${body ? ` ${body}` : ''}`)
  }

  const data: XUserResponse = await response.json()
  if (!data.data) {
    throw new Error(`X lookup returned no user data for "${username}"`)
  }

  return { id: data.data.id, username: data.data.username }
}

function transformTweets(data: XApiResponse): XTweet[] {
  if (!data.data) return []

  const usersById = new Map((data.includes?.users ?? []).map((u) => [u.id, u.username]))

  return data.data.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    authorUsername: usersById.get(tweet.author_id) ?? 'unknown',
    createdAt: tweet.created_at,
    likeCount: tweet.public_metrics.like_count,
    retweetCount: tweet.public_metrics.retweet_count,
    replyCount: tweet.public_metrics.reply_count,
  }))
}

async function fetchWithRateLimit(bearerToken: string, url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  })

  if (response.status === 429) {
    const resetHeader = response.headers.get('x-rate-limit-reset')
    const resetMs = resetHeader ? Number(resetHeader) * 1000 - Date.now() : 5000
    const waitMs = Math.min(Math.max(resetMs, 1000), 30000)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })
  }

  return response
}
