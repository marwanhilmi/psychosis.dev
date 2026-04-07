/**
 * Cloudflare Cache API layer for GitHub API responses.
 * Caches successful (200) responses with endpoint-specific TTLs.
 */

// ─── TTL by URL pattern ────────────────────────────────────────────────────────

const TTL_RULES: Array<{ pattern: RegExp; ttl: number }> = [
  { pattern: /\/repos\/[^/]+\/[^/]+\/commits\/[0-9a-f]{7,40}$/, ttl: 86400 }, // individual commit — immutable
  { pattern: /\/repos\/[^/]+\/[^/]+\/stats\/contributors/, ttl: 1800 },
  { pattern: /\/repos\/[^/]+\/[^/]+\/pulls/, ttl: 900 },
  { pattern: /\/repos\/[^/]+\/[^/]+\/commits\?/, ttl: 600 },
  { pattern: /\/users\/[^/]+\/repos/, ttl: 300 },
  { pattern: /\/user\/repos/, ttl: 300 },
  { pattern: /\/graphql/, ttl: 300 },
]

const DEFAULT_TTL = 600

function getTtlForUrl(url: string): number {
  for (const rule of TTL_RULES) {
    if (rule.pattern.test(url)) return rule.ttl
  }
  return DEFAULT_TTL
}

// ─── Hashing ────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

// ─── Cache key ──────────────────────────────────────────────────────────────────

async function buildCacheKey(url: string, headers: Record<string, string>, body?: string): Promise<Request> {
  let cacheKeyUrl = url

  // Authenticated requests: append token hash so different users don't share cached results
  const auth = headers.Authorization ?? headers.authorization
  if (auth) {
    const tokenHash = await sha256Hex(auth)
    const sep = cacheKeyUrl.includes('?') ? '&' : '?'
    cacheKeyUrl += `${sep}_token=${tokenHash}`
  }

  // GraphQL POST: hash the body to differentiate queries
  if (body) {
    const bodyHash = await sha256Hex(body)
    const sep = cacheKeyUrl.includes('?') ? '&' : '?'
    cacheKeyUrl += `${sep}_body_hash=${bodyHash}`
  }

  // Cache API requires a Request; always use GET (Cache API ignores POST by default)
  return new Request(cacheKeyUrl)
}

// ─── Main entry point ───────────────────────────────────────────────────────────

export async function cachedGithubFetch(
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  // Graceful fallback: caches.default may be unavailable in local dev
  let cache: Cache | undefined
  try {
    cache = (caches as unknown as { default: Cache }).default
  } catch {
    // no Cache API available — fall through to direct fetch
  }

  const cacheKey = cache ? await buildCacheKey(url, headers, body) : undefined

  // 1. Check cache
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey)
    if (cached) {
      console.log(`[github-cache] HIT  ${url}`)
      return cached
    }
  }

  console.log(`[github-cache] MISS ${url}`)

  // 2. Fetch from GitHub
  const fetchInit: RequestInit = { headers }
  if (body) {
    fetchInit.method = 'POST'
    fetchInit.body = body
  }
  const res = await fetch(url, fetchInit)

  // 3. Cache successful responses only (not 202, not errors)
  if (res.status === 200 && cache && cacheKey) {
    const ttl = getTtlForUrl(url)
    const responseToCache = new Response(res.clone().body, {
      status: res.status,
      headers: new Headers(res.headers),
    })
    responseToCache.headers.set('Cache-Control', `s-maxage=${ttl}`)
    await cache.put(cacheKey, responseToCache)
  }

  return res
}
