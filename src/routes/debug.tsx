import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { PsychosisMeter } from '#/components/PsychosisMeter'
import { RepoPicker, type RepoItem } from '#/components/RepoPicker'
import { runDebugAnalysis, fetchDebugRepos, DebugAnalysisError } from '#/lib/debug-analysis'
import type { DebugAnalysisResult, DebugSignal, DebugRepoItem } from '#/lib/debug-analysis'
import { FEATURES } from '#/lib/feature-flags'
import { env } from 'cloudflare:workers'

// ─── Server Functions ───────────────────────────────────────────────────────────

const fetchReposFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { username: string; xUsername?: string; token?: string }) => d)
  .handler(async ({ data }) => {
    const token = data.token || env.GITHUB_TOKEN || ''
    try {
      const repos = await fetchDebugRepos(data.username, token)
      return { ok: true as const, repos }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Failed to fetch repos' }
    }
  })

const analyzeGithubFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: { username?: string; xUsername?: string; maxRepos?: number; token?: string; selectedRepos?: string[] }) => d,
  )
  .handler(async ({ data }) => {
    const token = data.token || env.GITHUB_TOKEN || ''
    try {
      const result = await runDebugAnalysis({ ...data, token, xBearerToken: env.X_BEARER_TOKEN })
      return { ok: true as const, result }
    } catch (e) {
      const logs = e instanceof DebugAnalysisError ? e.logs : []
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : 'Analysis failed',
        logs,
      }
    }
  })

export const Route = createFileRoute('/debug')({
  beforeLoad: () => {
    if (!FEATURES.DEBUG) throw redirect({ to: '/' })
  },
  head: () => ({
    meta: [{ title: 'Debug — PSYCHOSISMETER' }],
  }),
  component: DebugPage,
})

// ─── Constants ──────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { name: string; desc: string }> = {
  aiToolAttribution: { name: 'AI Tool Attribution', desc: 'Co-authored-by, bot accounts, AI mentions' },
  volumeVelocity: { name: 'Volume Velocity', desc: 'Spikes in weekly additions (z-score)' },
  commitBurstiness: { name: 'Commit Burstiness', desc: 'Rapid-fire commits (< 2min gaps)' },
  diffSizeAnomaly: { name: 'Diff Size Anomaly', desc: 'Unusually large additions per commit' },
  commitMsgSimilarity: { name: 'Message Similarity', desc: 'Templated/repetitive messages' },
  markdownDensity: { name: 'Markdown Density', desc: 'High % of .md files + churn rate in repo' },
  commitMsgFormality: { name: 'Message Formality', desc: 'Overly structured commits' },
  commitMsgLength: { name: 'Message Length', desc: 'Verbose commit messages' },
  commitTimeEntropy: { name: 'Time Entropy', desc: 'Uniform time distribution' },
  tweetFormality: { name: 'Tweet Formality', desc: 'Long polished tweet style' },
  engagementRatio: { name: 'Engagement Mismatch', desc: 'Long posts with weak engagement' },
  postingRegularity: { name: 'Posting Regularity', desc: 'Uniform posting hour distribution' },
  threadIntensity: { name: 'Thread Intensity', desc: 'Reply-thread heavy posting behavior' },
  aiArtifactDensity: { name: 'AI Artifact Density', desc: 'Common LLM phrase usage in tweets' },
  styleConsistency: { name: 'Style Consistency', desc: 'Vocabulary overlap across GitHub and X' },
  vocabularyDiversity: { name: 'Vocabulary Diversity', desc: 'Cross-platform lexical diversity' },
}

function scoreColor(score: number): string {
  if (score < 20) return '#2d6e2d'
  if (score < 40) return '#8b6914'
  if (score < 60) return '#cc7700'
  if (score < 80) return '#cc3f00'
  return '#d42020'
}

function getZone(score: number): string {
  if (score < 20) return 'SANE'
  if (score < 40) return 'QUIRKY'
  if (score < 60) return 'UNHINGED'
  if (score < 80) return 'DERANGED'
  return 'FULL PSYCHOSIS'
}

function computeDebugScore(signals: DebugSignal[], weights: Record<string, number>): number {
  const activeWeightTotal = signals.reduce((sum, signal) => sum + (weights[signal.key] ?? 0), 0)
  if (activeWeightTotal === 0) return 0

  const byKey = Object.fromEntries(signals.map((signal) => [signal.key, signal.score])) as Record<string, number>
  const baseScore =
    signals.reduce((sum, signal) => sum + signal.score * (weights[signal.key] ?? 0), 0) / activeWeightTotal

  let satireBonus = 0
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgLength >= 90) satireBonus += 5
  if (byKey.aiToolAttribution >= 90 && byKey.commitBurstiness >= 60) satireBonus += 5
  if (byKey.aiToolAttribution >= 90 && byKey.diffSizeAnomaly >= 60) satireBonus += 5
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgFormality >= 60) satireBonus += 4
  if (byKey.aiToolAttribution >= 90 && byKey.commitMsgSimilarity >= 25) satireBonus += 4
  if (byKey.aiToolAttribution >= 90 && byKey.markdownDensity >= 35) satireBonus += 3
  if (byKey.volumeVelocity >= 90 && byKey.diffSizeAnomaly >= 70) satireBonus += 3

  const adjustedScore = baseScore + Math.min(satireBonus, 3)
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

  return Math.round(Math.max(0, Math.min(100, Math.max(adjustedScore, fullPsychosisFloor))))
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

type DebugStep = 'input' | 'pick-repos' | 'analyzing' | 'result'

function DebugPage() {
  const [debugStep, setDebugStep] = useState<DebugStep>('input')
  const [username, setUsername] = useState('')
  const [xUsername, setXUsername] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [reposLoading, setReposLoading] = useState(false)
  const [debugRepos, setDebugRepos] = useState<RepoItem[]>([])
  const [error, setError] = useState('')
  const [errorLogs, setErrorLogs] = useState<string[]>([])
  const [result, setResult] = useState<DebugAnalysisResult | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const hasGithubInput = username.trim().length > 0
  const hasXInput = xUsername.trim().length > 0
  const canStart = hasGithubInput || hasXInput
  const usesDefaultWeights = useMemo(() => {
    if (!result) return true
    return result.signals.every((signal) => (weights[signal.key] ?? 0) === (result.defaultWeights[signal.key] ?? 0))
  }, [result, weights])

  const weightedScore = useMemo(() => {
    if (!result) return 0
    if (result.githubDataUsed && !result.xDataUsed) {
      if (usesDefaultWeights) return result.platformScores.github
      return computeDebugScore(result.signals, weights)
    }
    return result.platformScores.combined
  }, [result, usesDefaultWeights, weights])

  const weightsSum = useMemo(() => {
    return Object.values(weights).reduce((a, b) => a + b, 0)
  }, [weights])

  const handleFetchRepos = async () => {
    if (!canStart || reposLoading) return

    if (!hasGithubInput) {
      await handleReposConfirm([])
      return
    }

    setReposLoading(true)
    setError('')

    try {
      const response = await fetchReposFn({
        data: { username: username.trim(), xUsername: xUsername.trim() || undefined, token: token.trim() || undefined },
      })

      if (!response.ok) {
        setError(response.error)
        return
      }

      setDebugRepos(
        response.repos.map((r: DebugRepoItem, i: number) => ({
          id: r.fullName,
          fullName: r.fullName,
          language: r.language,
          stars: r.stars,
          pushedAt: r.pushedAt,
          selected: i < 5, // pre-select top 5 by push date
        })),
      )
      setDebugStep('pick-repos')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch repos')
    } finally {
      setReposLoading(false)
    }
  }

  const handleReposConfirm = async (selected: RepoItem[]) => {
    const nextErrorStep: DebugStep = hasGithubInput ? 'pick-repos' : 'input'
    setLoading(true)
    setError('')
    setErrorLogs([])
    setResult(null)
    setWeights({})
    setExpanded(new Set())
    setDebugStep('analyzing')

    try {
      const response = await analyzeGithubFn({
        data: {
          username: username.trim() || undefined,
          xUsername: xUsername.trim().replace(/^@+/, '') || undefined,
          selectedRepos: selected.map((r) => r.fullName),
          token: token.trim() || undefined,
        },
      })

      if (!response.ok) {
        setError(response.error)
        setErrorLogs(response.logs)
        setDebugStep(nextErrorStep)
        return
      }

      setResult(response.result)
      const githubWeights: Record<string, number> = {}
      for (const signal of response.result.signals) {
        githubWeights[signal.key] = response.result.defaultWeights[signal.key] ?? 0
      }
      setWeights(githubWeights)
      setDebugStep('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
      setDebugStep(nextErrorStep)
    } finally {
      setLoading(false)
    }
  }

  const updateWeight = useCallback((key: string, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetWeights = useCallback(() => {
    if (!result) return
    const defaults: Record<string, number> = {}
    for (const signal of result.signals) {
      defaults[signal.key] = result.defaultWeights[signal.key] ?? 0
    }
    setWeights(defaults)
  }, [result])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center px-4 py-8">
      <header className="rise-in mb-8 text-center">
        <h1 className="display-title mb-2 text-3xl font-bold tracking-tight text-[var(--milk)] sm:text-4xl">
          ALGORITHM <span className="text-[var(--ultra-orange)]">DEBUG</span>
        </h1>
        <p className="kicker">GitHub + X Signal Analysis</p>
      </header>

      {/* ── Input Form ─────────────────────────────────────────── */}
      <div className="rise-in w-full max-w-3xl" style={{ animationDelay: '100ms' }}>
        <div className="brutalist-card rounded-sm p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="debug-github"
                className="mb-1 block font-mono text-[10px] font-bold tracking-wider text-[#666] uppercase"
              >
                GitHub Username
              </label>
              <input
                id="debug-github"
                ref={inputRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchRepos()}
                placeholder="e.g. torvalds"
                disabled={debugStep !== 'input'}
                className="w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-3 py-2 font-mono text-sm text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)] disabled:opacity-50"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="debug-x"
                className="mb-1 block font-mono text-[10px] font-bold tracking-wider text-[#666] uppercase"
              >
                X Username <span className="text-[#444]">(optional)</span>
              </label>
              <input
                id="debug-x"
                type="text"
                value={xUsername}
                onChange={(e) => setXUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchRepos()}
                placeholder="@jack"
                disabled={debugStep !== 'input'}
                className="w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-3 py-2 font-mono text-sm text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)] disabled:opacity-50"
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="debug-token"
                className="mb-1 block font-mono text-[10px] font-bold tracking-wider text-[#666] uppercase"
              >
                Token <span className="text-[#444]">(optional)</span>
              </label>
              <input
                id="debug-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                disabled={debugStep !== 'input'}
                className="w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-3 py-2 font-mono text-sm text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)] disabled:opacity-50"
              />
            </div>
            {debugStep === 'input' ? (
              <button
                onClick={handleFetchRepos}
                disabled={!canStart || reposLoading}
                className={`shrink-0 rounded-sm border-2 px-6 py-2 font-mono text-sm font-bold tracking-wider uppercase transition-all ${
                  canStart && !reposLoading
                    ? 'border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 text-[var(--ultra-orange)] hover:bg-[var(--ultra-orange)] hover:text-black'
                    : 'cursor-not-allowed border-[#222] text-[#444]'
                }`}
              >
                {reposLoading ? 'Loading...' : hasGithubInput ? 'Fetch Repos' : 'Analyze X'}
              </button>
            ) : (
              <button
                onClick={() => {
                  setDebugStep('input')
                  setDebugRepos([])
                  setResult(null)
                  setUsername('')
                  setXUsername('')
                  setError('')
                  setErrorLogs([])
                }}
                className="shrink-0 rounded-sm border-2 border-[#333] px-6 py-2 font-mono text-sm font-bold tracking-wider text-[#666] uppercase transition-all hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)]"
              >
                Reset
              </button>
            )}
          </div>
          {error && debugStep === 'input' && (
            <div className="mt-3">
              <p className="font-mono text-sm text-[var(--needle-red)]">{error}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Repo Picker ───────────────────────────────────────── */}
      {debugStep === 'pick-repos' && (
        <div className="rise-in mt-6 flex w-full max-w-3xl flex-col items-center">
          {error && (
            <div className="mb-4 w-full max-w-2xl">
              <p className="font-mono text-sm text-[var(--needle-red)]">{error}</p>
              {errorLogs.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[10px] text-[#666]">
                    Diagnostic logs ({errorLogs.length} entries)
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-y-auto rounded-sm border border-[var(--eyelash)] bg-[#080808] p-2 font-mono text-[10px] leading-relaxed text-[#888]">
                    {errorLogs.join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}
          <RepoPicker repos={debugRepos} onConfirm={handleReposConfirm} loading={loading} />
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────── */}
      {debugStep === 'analyzing' && (
        <div className="mt-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
          <p className="mt-3 font-mono text-xs text-[#666]">
            {hasGithubInput ? 'Fetching GitHub and X data...' : 'Fetching X data...'}
          </p>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────── */}
      {debugStep === 'result' && result && (
        <div className="rise-in mt-6 w-full max-w-4xl">
          {/* Meter */}
          <PsychosisMeter
            value={weightedScore}
            sublabel={`${getZone(weightedScore)} · ${result.githubDataUsed ? `${result.totalCommits} commits · ${result.perRepo.length} repos` : 'X-only analysis'}`}
          />

          <div className="mt-4 text-center font-mono text-sm text-[#666]">
            Combined score:{' '}
            <span className="font-bold" style={{ color: scoreColor(weightedScore) }}>
              {weightedScore}
            </span>{' '}
            / 100
            <span className="ml-3 text-[10px] text-[#444]">
              ({result.githubDataUsed ? `GitHub ${result.platformScores.github}` : 'GitHub n/a'}
              {' · '}
              {result.xDataUsed ? `X ${result.platformScores.x}` : 'X n/a'})
            </span>
          </div>

          {/* ── Signal Breakdown ─────────────────────────────── */}
          {result.githubDataUsed && result.signals.length > 0 && (
            <section className="mt-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="kicker">Signal Breakdown</h2>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-xs text-[#666]">Σ = {weightsSum.toFixed(2)}</span>
                  <button
                    onClick={resetWeights}
                    className="font-mono text-[10px] tracking-wider text-[#555] uppercase transition-colors hover:text-[var(--ultra-orange)]"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {result.signals.map((signal) => (
                  <SignalRow
                    key={signal.key}
                    signal={signal}
                    weight={weights[signal.key] ?? 0}
                    onWeightChange={(v) => updateWeight(signal.key, v)}
                    isExpanded={expanded.has(signal.key)}
                    onToggle={() => toggleExpanded(signal.key)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Contributors & AI Tools ──────────────────────── */}
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {result.contributors.length > 0 && <ContributorPanel contributors={result.contributors} />}

            {Object.keys(result.aiToolBreakdown).length > 0 && (
              <AiToolPanel
                breakdown={result.aiToolBreakdown}
                aiCount={result.aiCoAuthorCount}
                totalCommits={result.totalCommits}
              />
            )}
            {result.xDataUsed && result.targetX && (
              <section className="brutalist-card rounded-sm p-4">
                <h2 className="kicker mb-1">X Profile</h2>
                <p className="font-mono text-[10px] text-[#666]">@{result.targetX}</p>
                <p className="mt-2 font-mono text-[10px] text-[#444]">X subscore: {result.platformScores.x}</p>
              </section>
            )}
          </div>

          {/* ── Time Distribution ────────────────────────────── */}
          {result.githubDataUsed && (
            <section className="mt-6">
              <HourChart distribution={result.commitTimeDistribution} />
            </section>
          )}

          {/* ── Per Repo ─────────────────────────────────────── */}
          {result.perRepo.length > 0 && (
            <section className="mt-4">
              <details className="brutalist-card rounded-sm">
                <summary className="cursor-pointer p-4 font-mono text-xs font-bold tracking-wider text-[#666] uppercase hover:text-[var(--ultra-orange)]">
                  Per-Repository Breakdown ({result.perRepo.length})
                </summary>
                <div className="border-t border-[#222] p-4">
                  <div className="space-y-1">
                    {result.perRepo.map((r) => (
                      <div key={r.repo} className="flex items-center gap-3 font-mono text-xs">
                        <span className="min-w-0 flex-1 truncate text-[var(--milk)]">{r.repo}</span>
                        <span className="text-[#666]">{r.commits}c</span>
                        <span className="text-[#666]">{r.prs}pr</span>
                        <span className="text-[#666]">{r.contributorCount}contrib</span>
                        <span className="text-[#444]">★{r.stars}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </section>
          )}

          {/* ── Sample Commits ────────────────────────────────── */}
          {result.commitMessages.length > 0 && (
            <section className="mt-2">
              <details className="brutalist-card rounded-sm">
                <summary className="cursor-pointer p-4 font-mono text-xs font-bold tracking-wider text-[#666] uppercase hover:text-[var(--ultra-orange)]">
                  Sample Commit Messages ({result.commitMessages.length})
                </summary>
                <div className="max-h-60 overflow-y-auto border-t border-[#222] p-4">
                  <div className="space-y-1">
                    {result.commitMessages.map((msg, idx) => (
                      <div key={msg.slice(0, 60) || idx} className="font-mono text-[10px] text-[#888]">
                        <span className="mr-2 inline-block w-5 text-right text-[#444]">{idx + 1}</span>
                        {msg.split('\n')[0].slice(0, 120)}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </section>
          )}

          {result.tweetTexts.length > 0 && (
            <section className="mt-2">
              <details className="brutalist-card rounded-sm">
                <summary className="cursor-pointer p-4 font-mono text-xs font-bold tracking-wider text-[#666] uppercase hover:text-[var(--ultra-orange)]">
                  Sample Tweets ({result.tweetTexts.length})
                </summary>
                <div className="max-h-60 overflow-y-auto border-t border-[#222] p-4">
                  <div className="space-y-1">
                    {result.tweetTexts.map((tweet, idx) => (
                      <div key={tweet.slice(0, 60) || idx} className="font-mono text-[10px] text-[#888]">
                        <span className="mr-2 inline-block w-5 text-right text-[#444]">{idx + 1}</span>
                        {tweet.slice(0, 160)}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </section>
          )}

          {/* ── Logs ──────────────────────────────────────────── */}
          <section className="mt-6 mb-12">
            <h2 className="kicker mb-3">Execution Log</h2>
            <pre className="max-h-48 overflow-y-auto rounded-sm border-2 border-[var(--eyelash)] bg-[#080808] p-4 font-mono text-[10px] leading-relaxed text-[#666]">
              {result.logs.map((line) => (
                <div key={line}>
                  <span className="text-[var(--ultra-orange)]">&gt;</span> {line}
                </div>
              ))}
              <div className="mt-2 border-t border-[#1a1a1a] pt-2 text-[#444]">
                Total: {(result.elapsedMs / 1000).toFixed(1)}s
                {result.rateLimit && ` · GitHub API: ${result.rateLimit.remaining}/${result.rateLimit.limit} remaining`}
              </div>
            </pre>
          </section>
        </div>
      )}

      {/* Error hint */}
      {error && debugStep === 'input' && !result && (
        <div className="rise-in mt-6 w-full max-w-3xl text-center">
          <p className="font-mono text-[10px] text-[#444]">
            Tip: Create a{' '}
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--ultra-orange)]"
            >
              fine-grained GitHub PAT
            </a>{' '}
            with &ldquo;Public Repositories (read-only)&rdquo; for 5000 req/hr. X debug also requires `X_BEARER_TOKEN`.
          </p>
        </div>
      )}

      <footer className="mt-auto pt-8 pb-4">
        <Link
          to="/"
          className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
        >
          &larr; Home
        </Link>
      </footer>
    </main>
  )
}

// ─── Signal Row ─────────────────────────────────────────────────────────────────

function SignalRow({
  signal,
  weight,
  onWeightChange,
  isExpanded,
  onToggle,
}: {
  signal: DebugSignal
  weight: number
  onWeightChange: (v: number) => void
  isExpanded: boolean
  onToggle: () => void
}) {
  const meta = SIGNAL_META[signal.key]
  const weighted = Math.round(signal.score * weight * 10) / 10

  return (
    <div className="brutalist-card rounded-sm">
      <div className="flex items-center gap-2 p-3 sm:gap-3">
        <button
          onClick={onToggle}
          className="shrink-0 font-mono text-[10px] text-[#444] transition-colors hover:text-[var(--ultra-orange)]"
        >
          {isExpanded ? '▼' : '▶'}
        </button>

        <div className="w-28 shrink-0 sm:w-36">
          <div className="font-mono text-[11px] font-bold leading-tight text-[var(--milk)]">
            {meta?.name ?? signal.key}
          </div>
          <div className="hidden font-mono text-[8px] leading-tight text-[#444] sm:block">{meta?.desc ?? ''}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="h-2.5 overflow-hidden rounded-full bg-[#1a1a1a]">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${Math.max(1, signal.score)}%`,
                backgroundColor: scoreColor(signal.score),
              }}
            />
          </div>
        </div>

        <span
          className="w-8 shrink-0 text-right font-mono text-xs font-bold"
          style={{ color: scoreColor(signal.score) }}
        >
          {Math.round(signal.score)}
        </span>

        <div className="hidden w-28 shrink-0 items-center gap-1 sm:flex">
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.01}
            value={weight}
            onChange={(e) => onWeightChange(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[#1a1a1a] accent-[var(--ultra-orange)]"
          />
          <span className="w-8 text-right font-mono text-[9px] text-[#666]">{weight.toFixed(2)}</span>
        </div>

        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-[#888]">{weighted.toFixed(1)}</span>
      </div>

      {isExpanded && (
        <div className="border-t border-[#222] bg-[#0a0a0a] p-3">
          {/* Mobile weight slider */}
          <div className="mb-3 flex items-center gap-2 sm:hidden">
            <span className="font-mono text-[9px] text-[#666]">Weight:</span>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={weight}
              onChange={(e) => onWeightChange(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[#1a1a1a] accent-[var(--ultra-orange)]"
            />
            <span className="font-mono text-[9px] text-[#666]">{weight.toFixed(2)}</span>
          </div>
          <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-[#666]">
            {JSON.stringify(signal.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Contributor Panel ──────────────────────────────────────────────────────────

function ContributorPanel({ contributors }: { contributors: DebugAnalysisResult['contributors'] }) {
  const sorted = [...contributors].sort((a, b) => b.totalCommits - a.totalCommits).slice(0, 10)
  const totalCommits = contributors.reduce((sum, c) => sum + c.totalCommits, 0)

  return (
    <section className="brutalist-card rounded-sm p-4">
      <h2 className="kicker mb-3">Contributors</h2>
      <div className="space-y-2">
        {sorted.map((c) => {
          const pct = totalCommits > 0 ? (c.totalCommits / totalCommits) * 100 : 0
          return (
            <div key={c.login} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate font-mono text-[10px] text-[var(--milk)]">
                {c.login}
                {c.isBot && <span className="ml-1 text-[var(--needle-red)]">[BOT]</span>}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a1a1a]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: c.isBot ? 'var(--needle-red)' : 'var(--ultra-orange)',
                    opacity: c.isBot ? 0.8 : 0.7,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-[#666]">{pct.toFixed(0)}%</span>
              <span className="hidden w-20 shrink-0 text-right font-mono text-[8px] text-[#444] sm:inline">
                +{c.totalAdditions.toLocaleString()} −{c.totalDeletions.toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── AI Tool Panel ──────────────────────────────────────────────────────────────

function AiToolPanel({
  breakdown,
  aiCount,
  totalCommits,
}: {
  breakdown: Record<string, number>
  aiCount: number
  totalCommits: number
}) {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a)

  return (
    <section className="brutalist-card rounded-sm p-4">
      <h2 className="kicker mb-1">AI Tool Attribution</h2>
      <p className="mb-3 font-mono text-[10px] text-[#666]">
        {aiCount} / {totalCommits} commits ({totalCommits > 0 ? ((aiCount / totalCommits) * 100).toFixed(1) : 0}%)
      </p>
      <div className="space-y-2">
        {entries.map(([tool, count]) => (
          <div key={tool} className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-mono text-[10px] capitalize text-[var(--milk)]">{tool}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1a1a1a]">
              <div
                className="h-full rounded-full bg-[var(--needle-red)]"
                style={{ width: `${(count / aiCount) * 100}%`, opacity: 0.8 }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[9px] text-[#666]">{count} commits</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Hour Distribution Chart ────────────────────────────────────────────────────

function HourChart({ distribution }: { distribution: number[] }) {
  const max = Math.max(...distribution, 1)
  const total = distribution.reduce((a, b) => a + b, 0)
  if (total === 0) return null

  return (
    <div className="brutalist-card rounded-sm p-4">
      <h3 className="kicker mb-3">Commit Time Distribution (UTC)</h3>
      <div className="flex h-16 items-end gap-px">
        {distribution.map((count, hour) => {
          const height = (count / max) * 100
          return (
            <div key={hour} className="group flex flex-1 flex-col items-center">
              <div
                className="w-full rounded-t-sm transition-opacity group-hover:opacity-100"
                style={{
                  height: `${height}%`,
                  backgroundColor: 'var(--ultra-orange)',
                  opacity: count > 0 ? 0.5 : 0.08,
                  minHeight: count > 0 ? '2px' : '1px',
                }}
                title={`${hour}:00 UTC — ${count} commits`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[7px] text-[#444]">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  )
}
