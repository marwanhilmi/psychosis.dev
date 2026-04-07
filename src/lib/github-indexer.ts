import { db } from '#/db'
import { account, indexedRepos, repoMetadata } from '#/db/schema'
import { desc, eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cachedGithubFetch } from '#/lib/github-cache'

// ─── Interfaces ──────────────────────────────────────────────────────────────────

export interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: { date: string; name?: string; email?: string } | null
    committer: { name?: string; email?: string } | null
  }
  author?: { login: string } | null
  committer?: { login: string } | null
}

interface GitHubPR {
  title: string
  body: string | null
}

export interface GitHubContributorStats {
  author: { login: string; id: number } | null
  total: number
  weeks: Array<{ w: number; a: number; d: number; c: number }>
}

interface GitHubCommitDetail {
  sha: string
  stats: { additions: number; deletions: number; total: number }
  files?: Array<{ filename: string; additions: number; deletions: number }>
}

export interface GithubRepoCandidate {
  fullName: string
  pushedAt: string
  stars: number
  source: 'owned' | 'contributed'
  contributionCount?: number
}

export interface CommitDiffStat {
  additions: number
  deletions: number
  filesChanged: number
  timestamp: string
}

export interface MarkdownStats {
  totalFilesInTree: number
  markdownFilesInTree: number
  markdownPercent: number
  commitsWithMarkdown: number
  totalCommitsAnalyzed: number
  markdownChurnRate: number
  markdownAdditions: number
  totalAdditions: number
  markdownAdditionPercent: number
}

export interface ContributorStat {
  login: string
  totalCommits: number
  totalAdditions: number
  totalDeletions: number
  isBot: boolean
  weeklyData: Array<{ week: number; additions: number; deletions: number; commits: number }>
}

export interface EnhancedRawData {
  commitMessages: string[]
  prTitles: string[]
  commitTimestamps: string[]
  aiCoAuthorCount: number
  aiToolBreakdown: Record<string, number>
  commitDiffStats: CommitDiffStat[]
  contributorStats: ContributorStat[]
  markdownStats?: MarkdownStats
}

// ─── AI Tool Detection Constants ─────────────────────────────────────────────────

const AI_COAUTHOR_PATTERN =
  /co-authored-by:.*\b(cursor|copilot|claude|anthropic|openai|codex|codeium|tabnine|amazon.?q|windsurf|cline|aider|devin|gemini|sourcegraph)\b/i

const AI_COMMIT_MSG_PATTERN =
  /^(generated|created|implemented|refactored|updated|added|fixed|built)\s+(by|with|using|via)\s+(ai|claude|copilot|cursor|gpt|chatgpt|codex|llm)/i

const AI_BOT_LOGINS = new Set([
  'cursor-ai',
  'copilot',
  'github-copilot',
  'devin-ai',
  'codeium-bot',
  'sweep-ai',
  'codex',
  'openai-codex',
])

const AI_BOT_EMAIL_PATTERNS = [/cursor/i, /copilot/i, /anthropic/i, /openai/i, /codeium/i, /devin/i, /\bai[-.]bot\b/i]

const AI_TOOL_NAMES = [
  'cursor',
  'copilot',
  'claude',
  'anthropic',
  'openai',
  'codex',
  'codeium',
  'tabnine',
  'windsurf',
  'cline',
  'aider',
  'devin',
  'gemini',
  'sourcegraph',
  'amazon q',
] as const

function buildGithubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'psychosismeter',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function githubFetch(url: string, token: string, body?: string): Promise<Response> {
  const headers = buildGithubHeaders(token)
  const res = await cachedGithubFetch(url, headers, body)
  if (res.status === 403 || res.status === 429) {
    const resetHeader = res.headers.get('x-ratelimit-reset')
    const resetMs = resetHeader ? Number(resetHeader) * 1000 - Date.now() : 5000
    const waitMs = Math.min(Math.max(resetMs, 1000), 30000)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return cachedGithubFetch(url, headers, body)
  }
  return res
}

export async function fetchCommits(fullName: string, token: string): Promise<GitHubCommit[]> {
  const allCommits: GitHubCommit[] = []
  let page = 1
  const maxPages = 2 // 200 commits max

  while (page <= maxPages) {
    const res = await githubFetch(`https://api.github.com/repos/${fullName}/commits?per_page=100&page=${page}`, token)
    if (!res.ok) break

    const commits = (await res.json()) as GitHubCommit[]
    if (commits.length === 0) break

    allCommits.push(...commits)
    page++
  }

  return allCommits
}

export async function fetchPRs(fullName: string, token: string): Promise<GitHubPR[]> {
  const res = await githubFetch(`https://api.github.com/repos/${fullName}/pulls?state=all&per_page=50`, token)
  if (!res.ok) return []
  return (await res.json()) as GitHubPR[]
}

export async function fetchContributorStats(fullName: string, token: string): Promise<GitHubContributorStats[]> {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await githubFetch(`https://api.github.com/repos/${fullName}/stats/contributors`, token)
    if (res.status === 202) {
      // GitHub is computing stats — wait and retry
      await new Promise((resolve) => setTimeout(resolve, 2000))
      continue
    }
    if (!res.ok) return []
    return (await res.json()) as GitHubContributorStats[]
  }
  return []
}

export async function fetchCommitDetails(
  fullName: string,
  shas: string[],
  token: string,
): Promise<GitHubCommitDetail[]> {
  const capped = shas.slice(0, 25)
  const results: GitHubCommitDetail[] = []

  // Fetch in parallel batches of 5 to avoid overwhelming rate limits
  for (let i = 0; i < capped.length; i += 5) {
    const batch = capped.slice(i, i + 5)
    const batchResults = await Promise.all(
      batch.map(async (sha) => {
        try {
          const res = await githubFetch(`https://api.github.com/repos/${fullName}/commits/${sha}`, token)
          if (!res.ok) return null
          const detail = (await res.json()) as GitHubCommitDetail
          return detail
        } catch {
          return null
        }
      }),
    )
    for (const r of batchResults) {
      if (r) results.push(r)
    }
  }

  return results
}

export async function fetchUserOwnedRepos(username: string, token: string, limit = 5): Promise<GithubRepoCandidate[]> {
  const res = await githubFetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed&type=owner`,
    token,
  )
  if (!res.ok) return []

  const repos = (await res.json()) as Array<{
    full_name: string
    pushed_at: string
    stargazers_count: number
    private?: boolean
  }>

  return repos
    .filter((repo) => !repo.private)
    .slice(0, limit)
    .map((repo) => ({
      fullName: repo.full_name,
      pushedAt: repo.pushed_at,
      stars: repo.stargazers_count,
      source: 'owned',
    }))
}

// ─── GraphQL Fetch ──────────────────────────────────────────────────────────────

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

const REPO_DATA_QUERY = `
query($owner: String!, $name: String!, $cursor: String, $includePRs: Boolean!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              message
              authoredDate
              author { name email user { login } }
              committer { name email user { login } }
              additions
              deletions
              changedFilesIfAvailable
            }
          }
        }
      }
    }
    pullRequests(first: 50, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) @include(if: $includePRs) {
      nodes { title body }
    }
  }
}
`

const USER_CONTRIBUTED_REPOS_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 20) {
        repository {
          nameWithOwner
          pushedAt
          stargazerCount
          isPrivate
          owner { login }
        }
        contributions(first: 1) { totalCount }
      }
      pullRequestContributionsByRepository(maxRepositories: 20) {
        repository {
          nameWithOwner
          pushedAt
          stargazerCount
          isPrivate
          owner { login }
        }
        contributions(first: 1) { totalCount }
      }
    }
  }
}
`

interface GQLCommitNode {
  oid: string
  message: string
  authoredDate: string
  author: { name: string | null; email: string | null; user: { login: string } | null }
  committer: { name: string | null; email: string | null; user: { login: string } | null }
  additions: number
  deletions: number
  changedFilesIfAvailable: number | null
}

interface GQLRepoDataResponse {
  data?: {
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null }
            nodes: GQLCommitNode[]
          }
        }
      } | null
      pullRequests?: { nodes: Array<{ title: string; body: string | null }> }
    } | null
  }
  errors?: Array<{ message: string }>
}

interface GQLContributionRepoNode {
  repository: {
    nameWithOwner: string
    pushedAt: string
    stargazerCount: number
    isPrivate: boolean
    owner: { login: string }
  }
  contributions: { totalCount: number }
}

interface GQLUserContributedReposResponse {
  data?: {
    user: {
      contributionsCollection: {
        commitContributionsByRepository: GQLContributionRepoNode[]
        pullRequestContributionsByRepository: GQLContributionRepoNode[]
      }
    } | null
  }
  errors?: Array<{ message: string }>
}

function gqlCommitToRest(node: GQLCommitNode): GitHubCommit {
  return {
    sha: node.oid,
    commit: {
      message: node.message,
      author: { date: node.authoredDate, name: node.author.name ?? undefined, email: node.author.email ?? undefined },
      committer: { name: node.committer.name ?? undefined, email: node.committer.email ?? undefined },
    },
    author: node.author.user ? { login: node.author.user.login } : null,
    committer: node.committer.user ? { login: node.committer.user.login } : null,
  }
}

function gqlCommitToDetail(node: GQLCommitNode): GitHubCommitDetail {
  return {
    sha: node.oid,
    stats: {
      additions: node.additions,
      deletions: node.deletions,
      total: node.additions + node.deletions,
    },
    files:
      node.changedFilesIfAvailable != null
        ? Array.from({ length: node.changedFilesIfAvailable }, () => ({ filename: '', additions: 0, deletions: 0 }))
        : undefined,
  }
}

/**
 * Fetch commits, PRs, and commit details for a repo in 1-2 GraphQL calls.
 * Falls back to REST on any GraphQL failure (e.g. unauthenticated, token lacks scope).
 */
export async function fetchRepoDataGraphQL(
  fullName: string,
  token: string,
): Promise<{ commits: GitHubCommit[]; prs: GitHubPR[]; commitDetails: GitHubCommitDetail[] } | null> {
  // GraphQL requires authentication
  if (!token) return null

  const [owner, name] = fullName.split('/')
  if (!owner || !name) return null

  const allCommitNodes: GQLCommitNode[] = []
  let prs: GitHubPR[] = []
  let cursor: string | null = null
  const maxPages = 2

  for (let page = 0; page < maxPages; page++) {
    const body = JSON.stringify({
      query: REPO_DATA_QUERY,
      variables: { owner, name, cursor, includePRs: page === 0 },
    })

    const res = await githubFetch(GITHUB_GRAPHQL_URL, token, body)
    if (!res.ok) return null

    const json = (await res.json()) as GQLRepoDataResponse
    if (json.errors?.length || !json.data?.repository?.defaultBranchRef) return null

    const history = json.data.repository.defaultBranchRef.target.history
    allCommitNodes.push(...history.nodes)

    // Grab PRs from the first page only
    if (page === 0 && json.data.repository.pullRequests) {
      prs = json.data.repository.pullRequests.nodes.map((pr) => ({ title: pr.title, body: pr.body }))
    }

    if (!history.pageInfo.hasNextPage) break
    cursor = history.pageInfo.endCursor
  }

  const commits = allCommitNodes.map(gqlCommitToRest)
  const commitDetails = allCommitNodes.slice(0, 25).map(gqlCommitToDetail)

  return { commits, prs, commitDetails }
}

export async function fetchUserContributedRepos(
  username: string,
  token: string,
  limit = 5,
): Promise<GithubRepoCandidate[]> {
  if (token) {
    const body = JSON.stringify({
      query: USER_CONTRIBUTED_REPOS_QUERY,
      variables: {
        login: username,
        from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      },
    })

    const res = await githubFetch(GITHUB_GRAPHQL_URL, token, body)
    if (res.ok) {
      const json = (await res.json()) as GQLUserContributedReposResponse
      if (!json.errors?.length && json.data?.user) {
        const merged = new Map<string, GithubRepoCandidate>()
        const addNode = (node: GQLContributionRepoNode) => {
          if (node.repository.isPrivate) return
          if (node.repository.owner.login.toLowerCase() === username.toLowerCase()) return

          const existing = merged.get(node.repository.nameWithOwner)
          const contributionCount = node.contributions.totalCount
          if (existing) {
            existing.contributionCount = (existing.contributionCount ?? 0) + contributionCount
            return
          }

          merged.set(node.repository.nameWithOwner, {
            fullName: node.repository.nameWithOwner,
            pushedAt: node.repository.pushedAt,
            stars: node.repository.stargazerCount,
            source: 'contributed',
            contributionCount,
          })
        }

        for (const node of json.data.user.contributionsCollection.commitContributionsByRepository) addNode(node)
        for (const node of json.data.user.contributionsCollection.pullRequestContributionsByRepository) addNode(node)

        return [...merged.values()]
          .sort(
            (a, b) =>
              (b.contributionCount ?? 0) - (a.contributionCount ?? 0) ||
              new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
          )
          .slice(0, limit)
      }
    }
  }

  const eventsRes = await githubFetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
    token,
  )
  if (!eventsRes.ok) return []

  const events = (await eventsRes.json()) as Array<{
    type: string
    created_at: string
    repo?: { name: string }
  }>

  const contributed = new Map<string, GithubRepoCandidate>()
  for (const event of events) {
    const fullName = event.repo?.name
    if (!fullName) continue
    const [owner] = fullName.split('/')
    if (!owner || owner.toLowerCase() === username.toLowerCase()) continue
    if (!['PushEvent', 'PullRequestEvent', 'PullRequestReviewEvent'].includes(event.type)) continue

    const existing = contributed.get(fullName)
    if (existing) {
      existing.contributionCount = (existing.contributionCount ?? 0) + 1
      if (event.created_at > existing.pushedAt) existing.pushedAt = event.created_at
      continue
    }

    contributed.set(fullName, {
      fullName,
      pushedAt: event.created_at,
      stars: 0,
      source: 'contributed',
      contributionCount: 1,
    })
  }

  return [...contributed.values()]
    .sort(
      (a, b) =>
        (b.contributionCount ?? 0) - (a.contributionCount ?? 0) ||
        new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
    )
    .slice(0, limit)
}

const MARKDOWN_EXTENSIONS = /\.(md|mdx|markdown)$/i

function isMarkdownFile(filename: string): boolean {
  return MARKDOWN_EXTENSIONS.test(filename)
}

interface GitHubTree {
  sha: string
  tree: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>
  truncated: boolean
}

export async function fetchRepoTree(
  fullName: string,
  headSha: string,
  token: string,
): Promise<{ totalFiles: number; markdownFiles: number }> {
  try {
    const res = await githubFetch(`https://api.github.com/repos/${fullName}/git/trees/${headSha}?recursive=1`, token)
    if (!res.ok) return { totalFiles: 0, markdownFiles: 0 }

    const tree = (await res.json()) as GitHubTree
    const blobs = tree.tree.filter((t) => t.type === 'blob')
    const markdownBlobs = blobs.filter((t) => isMarkdownFile(t.path))
    return { totalFiles: blobs.length, markdownFiles: markdownBlobs.length }
  } catch {
    return { totalFiles: 0, markdownFiles: 0 }
  }
}

export function computeMarkdownStats(
  commitDetails: GitHubCommitDetail[],
  treeData: { totalFiles: number; markdownFiles: number },
): MarkdownStats {
  let commitsWithMarkdown = 0
  let markdownAdditions = 0
  let totalAdditions = 0

  for (const detail of commitDetails) {
    const files = detail.files ?? []
    totalAdditions += detail.stats.additions
    let hasMd = false
    for (const f of files) {
      if (isMarkdownFile(f.filename)) {
        hasMd = true
        markdownAdditions += f.additions
      }
    }
    if (hasMd) commitsWithMarkdown++
  }

  const totalCommitsAnalyzed = commitDetails.length
  return {
    totalFilesInTree: treeData.totalFiles,
    markdownFilesInTree: treeData.markdownFiles,
    markdownPercent: treeData.totalFiles > 0 ? (treeData.markdownFiles / treeData.totalFiles) * 100 : 0,
    commitsWithMarkdown,
    totalCommitsAnalyzed,
    markdownChurnRate: totalCommitsAnalyzed > 0 ? (commitsWithMarkdown / totalCommitsAnalyzed) * 100 : 0,
    markdownAdditions,
    totalAdditions,
    markdownAdditionPercent: totalAdditions > 0 ? (markdownAdditions / totalAdditions) * 100 : 0,
  }
}

function detectAiToolInText(text: string): string | null {
  const lower = text.toLowerCase()
  for (const tool of AI_TOOL_NAMES) {
    if (lower.includes(tool)) return tool.split(' ')[0]
  }
  return null
}

function isAiBotLogin(login: string): boolean {
  if (AI_BOT_LOGINS.has(login.toLowerCase())) return true
  if (/\b(bot|ai-agent|copilot)\b/i.test(login)) return true
  return false
}

function isAiBotEmail(email: string | undefined): boolean {
  if (!email) return false
  return AI_BOT_EMAIL_PATTERNS.some((p) => p.test(email))
}

export function computeMetadata(
  commits: GitHubCommit[],
  prs: GitHubPR[],
  contributorStatsRaw: GitHubContributorStats[] = [],
  commitDetails: GitHubCommitDetail[] = [],
  markdownStats?: MarkdownStats,
) {
  const commitMessages = commits.map((c) => c.commit.message)
  const avgMsgLength =
    commitMessages.length > 0 ? commitMessages.reduce((sum, m) => sum + m.length, 0) / commitMessages.length : 0

  // Commit time distribution (24 hour buckets)
  const hourBuckets: number[] = Array.from({ length: 24 }, () => 0)
  const commitTimestamps: string[] = []
  for (const c of commits) {
    const date = c.commit.author?.date
    if (date) {
      const hour = new Date(date).getUTCHours()
      hourBuckets[hour]++
      commitTimestamps.push(date)
    }
  }

  // Count AI artifacts in commit messages (legacy compat)
  let aiArtifactCount = 0
  const aiPatterns = [
    /as an ai/i,
    /i'd be happy to/i,
    /here's a comprehensive/i,
    /let me elaborate/i,
    /it's worth noting/i,
    /in conclusion/i,
    /leverage/i,
    /utilize/i,
    /facilitate/i,
    /delve/i,
    /straightforward/i,
  ]
  for (const msg of commitMessages) {
    for (const pattern of aiPatterns) {
      if (pattern.test(msg)) aiArtifactCount++
    }
  }

  const prBodies = prs.map((p) => [p.title, p.body ?? ''].join(' '))
  for (const body of prBodies) {
    for (const pattern of aiPatterns) {
      if (pattern.test(body)) aiArtifactCount++
    }
  }

  // ─── AI Tool Attribution Detection ──────────────────────────────────────────
  let aiCoAuthorCount = 0
  const aiToolBreakdown: Record<string, number> = {}

  const bumpTool = (tool: string) => {
    const key = tool.toLowerCase()
    aiToolBreakdown[key] = (aiToolBreakdown[key] ?? 0) + 1
  }

  for (const c of commits) {
    const msg = c.commit.message
    let attributed = false

    // 1. Co-authored-by trailers
    const coAuthorMatch = msg.match(AI_COAUTHOR_PATTERN)
    if (coAuthorMatch) {
      attributed = true
      bumpTool(coAuthorMatch[1])
    }

    // 2. Commit message mentions AI tool explicitly
    if (AI_COMMIT_MSG_PATTERN.test(msg)) {
      const tool = detectAiToolInText(msg)
      if (tool) {
        attributed = true
        bumpTool(tool)
      }
    }

    // 3. Author/committer is a known AI bot account
    if (c.author?.login && isAiBotLogin(c.author.login)) {
      attributed = true
      bumpTool(c.author.login)
    }
    if (c.committer?.login && isAiBotLogin(c.committer.login)) {
      attributed = true
      bumpTool(c.committer.login)
    }

    // 4. Git author/committer email matches AI tool patterns
    if (isAiBotEmail(c.commit.author?.email)) {
      attributed = true
    }
    if (isAiBotEmail(c.commit.committer?.email)) {
      attributed = true
    }

    if (attributed) aiCoAuthorCount++
  }

  // ─── Commit Diff Stats ────────────────────────────────────────────────────
  const commitDiffStats: CommitDiffStat[] = commitDetails.map((d) => {
    const commit = commits.find((c) => c.sha === d.sha)
    return {
      additions: d.stats.additions,
      deletions: d.stats.deletions,
      filesChanged: d.files?.length ?? 0,
      timestamp: commit?.commit.author?.date ?? '',
    }
  })

  // ─── Contributor Stats ────────────────────────────────────────────────────
  const contributorStats: ContributorStat[] = contributorStatsRaw
    .filter((cs) => cs.author !== null)
    .map((cs) => ({
      login: cs.author!.login,
      totalCommits: cs.total,
      totalAdditions: cs.weeks.reduce((sum, w) => sum + w.a, 0),
      totalDeletions: cs.weeks.reduce((sum, w) => sum + w.d, 0),
      isBot: isAiBotLogin(cs.author!.login),
      weeklyData: cs.weeks
        .filter((w) => w.c > 0)
        .map((w) => ({ week: w.w, additions: w.a, deletions: w.d, commits: w.c })),
    }))

  const rawData: EnhancedRawData = {
    commitMessages: commitMessages.slice(0, 50),
    prTitles: prs.map((p) => p.title).slice(0, 20),
    commitTimestamps,
    aiCoAuthorCount,
    aiToolBreakdown,
    commitDiffStats,
    contributorStats,
    markdownStats,
  }

  return {
    totalCommits: commits.length,
    totalPrs: prs.length,
    avgCommitMsgLength: Math.round(avgMsgLength * 100) / 100,
    commitTimeDistribution: JSON.stringify(hourBuckets),
    aiArtifactCount,
    rawData: JSON.stringify(rawData),
  }
}

export async function indexRepos(userId: string) {
  // Get GitHub access token
  const [ghAccount] = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))

  if (!ghAccount?.accessToken) {
    return [] // No GitHub connected — skip indexing
  }

  const token = ghAccount.accessToken

  // Get repos to index
  const repos = await db.select().from(indexedRepos).where(eq(indexedRepos.userId, userId))

  // Process repos in parallel (up to 3 concurrent to stay within rate limits)
  const indexRepo = async (repo: (typeof repos)[number]): Promise<{ repoId: string; status: string }> => {
    // Skip recently indexed repos (within last 30 minutes)
    if (repo.indexStatus === 'done' && repo.lastIndexedAt) {
      const ageMs = Date.now() - repo.lastIndexedAt.getTime()
      if (ageMs < 30 * 60 * 1000) {
        return { repoId: repo.id, status: 'skipped' }
      }
    }

    try {
      // Mark as indexing
      await db.update(indexedRepos).set({ indexStatus: 'indexing' }).where(eq(indexedRepos.id, repo.id))

      // GraphQL only — no REST fallback (too expensive)
      const [gqlData, contribStats] = await Promise.all([
        fetchRepoDataGraphQL(repo.fullName, token),
        fetchContributorStats(repo.fullName, token),
      ])

      if (!gqlData) {
        console.warn(`[indexRepos] GraphQL failed for ${repo.fullName}, skipping`)
        await db.update(indexedRepos).set({ indexStatus: 'failed' }).where(eq(indexedRepos.id, repo.id))
        return { repoId: repo.id, status: 'failed' }
      }

      const { commits, prs, commitDetails: commitDetailData } = gqlData

      // Tree fetch is independent of commit details — run after we have headSha
      const headSha = commits[0]?.sha ?? ''
      const treeData = headSha
        ? await fetchRepoTree(repo.fullName, headSha, token)
        : { totalFiles: 0, markdownFiles: 0 }
      const markdownStats = computeMarkdownStats(commitDetailData, treeData)
      const metadata = computeMetadata(commits, prs, contribStats, commitDetailData, markdownStats)
      const [existingMetadata] = await db
        .select({ id: repoMetadata.id })
        .from(repoMetadata)
        .where(eq(repoMetadata.repoId, repo.id))
        .orderBy(desc(repoMetadata.createdAt))
        .limit(1)

      if (existingMetadata) {
        await db.update(repoMetadata).set(metadata).where(eq(repoMetadata.id, existingMetadata.id))
      } else {
        await db.insert(repoMetadata).values({
          id: nanoid(),
          repoId: repo.id,
          ...metadata,
        })
      }

      await db
        .update(indexedRepos)
        .set({ indexStatus: 'done', lastIndexedAt: new Date() })
        .where(eq(indexedRepos.id, repo.id))

      return { repoId: repo.id, status: 'done' }
    } catch {
      await db.update(indexedRepos).set({ indexStatus: 'failed' }).where(eq(indexedRepos.id, repo.id))

      return { repoId: repo.id, status: 'failed' }
    }
  }

  // Process in batches of 3 to respect GitHub rate limits
  const results: Array<{ repoId: string; status: string }> = []
  for (let i = 0; i < repos.length; i += 3) {
    const batch = repos.slice(i, i + 3)
    const batchResults = await Promise.all(batch.map(indexRepo))
    results.push(...batchResults)
  }

  return results
}
