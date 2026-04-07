import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PsychosisMeter } from '#/components/PsychosisMeter'
import { RepoPicker, type RepoItem } from '#/components/RepoPicker'
import { ShareButtons } from '#/components/ShareButtons'
import { SignalBreakdown } from '#/components/SignalBreakdown'
import { authClient } from '#/lib/auth-client'
import { FEATURES } from '#/lib/feature-flags'
import { client } from '#/orpc/client'
import { env } from 'cloudflare:workers'

const getVersionFn = createServerFn({ method: 'GET' }).handler(async () => {
  return env.CF_VERSION_METADATA?.id ?? 'dev'
})

export const Route = createFileRoute('/')({
  component: HomePage,
  loader: () => getVersionFn(),
})

const NADSAT_QUOTES = [
  'What we need is a good old-fashioned bit of the ultra-analysis, my brothers.',
  'Viddy well, little brother. Viddy well.',
  "It's funny how the colors of the real world only seem really real when you viddy them on a screen.",
  'I was cured all right.',
  'The mind is a horrorshow thing, O my brothers.',
  'Come and get one in the yarbles, if you have any yarbles.',
] as const

interface ScoreData {
  id: string
  score: number
  zone: string
  diagnosis: string | null
  indicators: string | null
  breakdown: string | null
}

interface ProvidersState {
  list: string[]
  loading: boolean
}

const ZONES = ['SANE', 'QUIRKY', 'UNHINGED', 'DERANGED', 'FULL_PSYCHOSIS'] as const
function getZone(score: number) {
  if (score < 20) return ZONES[0]
  if (score < 40) return ZONES[1]
  if (score < 60) return ZONES[2]
  if (score < 80) return ZONES[3]
  return ZONES[4]
}

const subscribeNoop = () => () => {}
const getDebugSnapshot = () => FEATURES.DEBUG && new URLSearchParams(window.location.search).get('debug') === 'true'
const getDebugServerSnapshot = () => false

function useDebugMode() {
  return useSyncExternalStore(subscribeNoop, getDebugSnapshot, getDebugServerSnapshot)
}

type HomeStep = 'connect' | 'pick-repos' | 'analyzing' | 'result'

const ZONE_COLORS: Record<string, string> = {
  SANE: '#2d6e2d',
  QUIRKY: '#8b6914',
  UNHINGED: '#cc7700',
  DERANGED: '#cc3f00',
  FULL_PSYCHOSIS: '#d42020',
}

interface DroogEntry {
  scoreId: string
  score: number
  zone: string
  userName: string
  userImage: string | null
  targetGithub: string | null
  targetX: string | null
  githubDataUsed: boolean
  xDataUsed: boolean
}

interface JobProgress {
  message: string
  completed: number
  total: number
}

function useJobPoller(onComplete: (scoreId: string) => void, onError: (msg: string) => void) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<JobProgress>({ message: '', completed: 0, total: 0 })
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    const poll = async () => {
      try {
        const job = await client.analysis.jobStatus({ jobId })

        setProgress((prev) => ({
          message: job.currentStep ?? prev.message,
          completed: job.completedSteps ?? prev.completed,
          total: job.totalSteps ?? prev.total,
        }))

        if (job.status === 'done' && job.scoreId) {
          setJobId(null)
          onComplete(job.scoreId)
        } else if (job.status === 'failed') {
          setJobId(null)
          onError(job.error ?? 'Analysis failed. The machine spirits are displeased.')
        }
      } catch {
        // Transient poll failure — keep trying
      }
    }

    void poll()
    pollingRef.current = setInterval(poll, 2000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [jobId, onComplete, onError])

  const startPolling = useCallback((id: string) => {
    setProgress({ message: 'Queued...', completed: 0, total: 0 })
    setJobId(id)
  }, [])

  return {
    startPolling,
    progressMessage: progress.message,
    completedSteps: progress.completed,
    totalSteps: progress.total,
    isPolling: !!jobId,
  }
}

function HomePage() {
  const version = Route.useLoaderData()
  const debug = useDebugMode()
  const queryClient = useQueryClient()
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [step, setStep] = useState<HomeStep>('connect')
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [scoreData, setScoreData] = useState<ScoreData | null>(null)
  const [error, setError] = useState('')
  const [quoteIdx] = useState(() => Math.floor(Math.random() * NADSAT_QUOTES.length))
  const [debugScore, setDebugScore] = useState(50)
  const resultRef = useRef<HTMLDivElement>(null)

  const { data: topDroogs = [] } = useQuery({
    queryKey: ['droogs', 'list', { limit: 5, offset: 0, mode: 'self' }],
    queryFn: () => client.droogs.list({ limit: 5, offset: 0, mode: 'self' }) as Promise<DroogEntry[]>,
    staleTime: 60_000,
  })

  const handleScoreComplete = useCallback(
    async (completedScoreId: string) => {
      try {
        const score = await client.analysis.getScore({ id: completedScoreId })
        setScoreData({
          id: completedScoreId,
          score: score.score,
          zone: score.zone,
          diagnosis: score.diagnosis,
          indicators: score.indicators,
          breakdown: score.breakdown,
        })
        setStep('result')
        void queryClient.invalidateQueries({ queryKey: ['droogs'] })
      } catch {
        setError('Failed to load results.')
        setStep('connect')
      } finally {
        setAnalyzing(false)
      }
    },
    [queryClient],
  )

  const handleJobError = useCallback((msg: string) => {
    setError(msg)
    setAnalyzing(false)
    setStep('connect')
  }, [])

  const { startPolling, progressMessage, completedSteps, totalSteps } = useJobPoller(
    handleScoreComplete,
    handleJobError,
  )

  const isLoggedIn = !!session?.user
  const [providers, setProviders] = useState<ProvidersState>({ list: [], loading: false })
  const hasGithub = providers.list.includes('github')
  const hasX = FEATURES.X_ENABLED && providers.list.includes('twitter')
  const hasAnyConnection = hasGithub || hasX
  const showMeter = scoreData !== null || debug

  // Fetch existing score for logged-in users
  useEffect(() => {
    if (!isLoggedIn || scoreData) return
    client.analysis
      .getMyScore()
      .then((score) => {
        if (score) {
          setScoreData({
            id: score.id,
            score: score.score,
            zone: score.zone,
            diagnosis: score.diagnosis,
            indicators: score.indicators,
            breakdown: score.breakdown,
          })
          setStep('result')
        }
      })
      .catch(() => {})
  }, [isLoggedIn])

  // Fetch connected accounts when logged in
  useEffect(() => {
    if (!isLoggedIn) {
      setProviders({ list: [], loading: false })
      return
    }
    setProviders((prev) => ({ ...prev, loading: true }))
    client.users
      .connectedAccounts()
      .then((list) => setProviders({ list, loading: false }))
      .catch(() => setProviders((prev) => ({ ...prev, loading: false })))
  }, [isLoggedIn])

  const handleFetchRepos = useCallback(async () => {
    setReposLoading(true)
    setError('')
    try {
      const result = await client.repos.list()
      setRepos(
        result.map((r) => ({
          id: r.id,
          fullName: r.fullName,
          language: r.language,
          stars: r.stars,
          pushedAt: r.pushedAt,
          selected: r.selected,
        })),
      )
      setStep('pick-repos')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch repos')
    } finally {
      setReposLoading(false)
    }
  }, [])

  const startAnalysis = useCallback(
    async (result: { status: string; scoreId?: string; jobId?: string }) => {
      if (result.status === 'done' && result.scoreId) {
        await handleScoreComplete(result.scoreId)
      } else if (result.status === 'processing' && result.jobId) {
        startPolling(result.jobId)
      }
    },
    [handleScoreComplete, startPolling],
  )

  const handleAnalyzeXOnly = useCallback(async () => {
    setAnalyzing(true)
    setError('')
    setStep('analyzing')
    try {
      const result = await client.analysis.trigger()
      await startAnalysis(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. The machine spirits are displeased.')
      setStep('connect')
      setAnalyzing(false)
    }
  }, [startAnalysis])

  const handleReposConfirm = useCallback(
    async (selected: RepoItem[]) => {
      setAnalyzing(true)
      setError('')
      setStep('analyzing')
      try {
        await client.repos.select({
          repos: selected.map((r) => ({
            id: r.id as number,
            fullName: r.fullName,
            language: r.language,
            stars: r.stars,
          })),
        })
        const result = await client.analysis.trigger()
        await startAnalysis(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Analysis failed. The machine spirits are displeased.')
        setStep('pick-repos')
        setAnalyzing(false)
      }
    },
    [startAnalysis],
  )

  const handleSignOut = async () => {
    await authClient.signOut()
    setScoreData(null)
    setRepos([])
    setStep('connect')
  }

  const profileUrl =
    scoreData && session?.user && typeof window !== 'undefined'
      ? `${window.location.origin}/droogs/${encodeURIComponent(session.user.name ?? '')}`
      : ''
  const shareText =
    scoreData && session?.user
      ? `My LLM Psychosis Score: ${scoreData.score}/100 — ${scoreData.zone}\n\nHow cooked is YOUR digital brain?\n\n${profileUrl}`
      : ''
  const shareUrl = profileUrl

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center justify-center py-12">
      {/* User bar */}
      {isLoggedIn && (
        <div className="rise-in fixed top-4 right-4 z-50 flex items-center gap-3">
          <span className="font-mono text-xs text-[#666]">{session.user.name}</span>
          <button
            onClick={handleSignOut}
            className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
          >
            Sign out
          </button>
        </div>
      )}

      {/* Header */}
      <header className="rise-in mb-12 text-center" style={{ animationDelay: '0ms' }}>
        <div className="mb-6 flex justify-center">
          <EyeIcon />
        </div>

        <h1 className="display-title glitch-text mb-3 text-5xl font-bold tracking-tight text-[var(--milk)] sm:text-7xl">
          PSYCHOSIS
          <wbr />
          <span className="inline-block text-[var(--ultra-orange)]">METER</span>
        </h1>

        <p className="kicker mb-4">How cooked is your digital brain?</p>

        <p className="mx-auto max-w-lg font-mono text-sm leading-relaxed text-[#777]">
          Connect your GitHub{FEATURES.X_ENABLED ? ' and X accounts' : ' account'}. We analyze your repos
          {FEATURES.X_ENABLED ? ', commits, and tweets' : ' and commits'} through our proprietary{' '}
          <span className="text-[var(--ultra-orange)]">LLM Psychosis Detection Algorithm</span> to determine exactly how
          far gone you are.
        </p>
      </header>

      {/* Connect / Pick Repos / Analyze */}
      {!showMeter && step === 'connect' && (
        <>
          {/* Connection status badges */}
          {isLoggedIn && !providers.loading && (
            <div
              className="rise-in mb-6 flex flex-col items-center gap-3 sm:flex-row"
              style={{ animationDelay: '200ms' }}
            >
              {/* GitHub badge */}
              {hasGithub ? (
                <div className="flex items-center gap-3 rounded-sm border-2 border-[#2d6e2d] bg-[#2d6e2d]/10 px-5 py-2.5 font-mono text-xs font-bold tracking-wider text-[#4ade80] uppercase">
                  <GitHubIcon />
                  GitHub Connected
                  <CheckIcon />
                </div>
              ) : (
                <Link
                  to="/auth"
                  search={{ redirect: '/' }}
                  className="flex items-center gap-3 rounded-sm border-2 border-[var(--eyelash)] px-5 py-2.5 font-mono text-xs font-bold tracking-wider text-[var(--milk)] uppercase transition-all hover:border-[var(--milk)] hover:bg-[var(--milk)]/5"
                >
                  <GitHubIcon />
                  Link GitHub
                </Link>
              )}

              {/* X badge */}
              {FEATURES.X_ENABLED &&
                (hasX ? (
                  <div className="flex items-center gap-3 rounded-sm border-2 border-[#2d6e2d] bg-[#2d6e2d]/10 px-5 py-2.5 font-mono text-xs font-bold tracking-wider text-[#4ade80] uppercase">
                    <XIcon />X Connected
                    <CheckIcon />
                  </div>
                ) : (
                  <Link
                    to="/auth"
                    search={{ redirect: '/' }}
                    className="flex items-center gap-3 rounded-sm border-2 border-[var(--eyelash)] px-5 py-2.5 font-mono text-xs font-bold tracking-wider text-[var(--milk)] uppercase transition-all hover:border-[var(--milk)] hover:bg-[var(--milk)]/5"
                  >
                    <XIcon />
                    Link X
                  </Link>
                ))}
            </div>
          )}

          {error && <p className="mb-4 font-mono text-sm text-[var(--needle-red)]">{error}</p>}

          <div className="rise-in mb-8" style={{ animationDelay: '400ms' }}>
            {!isLoggedIn ? (
              <Link
                to="/auth"
                search={{ redirect: '/' }}
                className="relative inline-block overflow-hidden rounded-sm border-2 border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 px-10 py-4 font-mono text-lg font-bold tracking-[0.2em] text-[var(--ultra-orange)] uppercase transition-all hover:bg-[var(--ultra-orange)] hover:text-black hover:shadow-[0_0_40px_rgba(255,79,0,0.3)]"
              >
                Sign In to Analyze
              </Link>
            ) : (
              <button
                onClick={hasGithub ? handleFetchRepos : handleAnalyzeXOnly}
                disabled={!hasAnyConnection || reposLoading || providers.loading}
                className={`relative overflow-hidden rounded-sm border-2 px-10 py-4 font-mono text-lg font-bold tracking-[0.2em] uppercase transition-all ${
                  hasAnyConnection && !reposLoading
                    ? 'cta-pulse border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 text-[var(--ultra-orange)] hover:bg-[var(--ultra-orange)] hover:text-black hover:shadow-[0_0_40px_rgba(255,79,0,0.3)]'
                    : 'cursor-not-allowed border-[#222] text-[#444]'
                }`}
              >
                {providers.loading || sessionLoading
                  ? 'Loading...'
                  : reposLoading
                    ? 'Fetching repos...'
                    : 'Analyze My Psychosis'}
              </button>
            )}
          </div>
        </>
      )}

      {/* Repo Picker */}
      {!showMeter && step === 'pick-repos' && (
        <div className="rise-in mb-8" style={{ animationDelay: '100ms' }}>
          {error && <p className="mb-4 font-mono text-sm text-[var(--needle-red)]">{error}</p>}
          <RepoPicker repos={repos} onConfirm={handleReposConfirm} loading={analyzing} />
          <button
            onClick={() => setStep('connect')}
            className="mt-3 w-full text-center font-mono text-[10px] tracking-wider text-[#555] uppercase transition-colors hover:text-[var(--ultra-orange)]"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Analyzing state */}
      {!showMeter && step === 'analyzing' && (
        <div className="rise-in mb-8 text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
          <p className="font-mono text-xs text-[#666]">Running the ultra-analysis...</p>
          {progressMessage ? (
            <p className="mt-1 font-mono text-[10px] text-[var(--ultra-orange)]">{progressMessage}</p>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-[#444]">
              Indexing repos{FEATURES.X_ENABLED ? ', tweets,' : ''} and computing psychosis signals
            </p>
          )}
          {totalSteps > 0 && (
            <div className="mx-auto mt-3 w-48">
              <div className="h-1 overflow-hidden rounded-full bg-[#222]">
                <div
                  className="h-full rounded-full bg-[var(--ultra-orange)] transition-all duration-500"
                  style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                />
              </div>
              <p className="mt-1 font-mono text-[10px] text-[#444]">
                Step {completedSteps}/{totalSteps}
              </p>
            </div>
          )}
          <p className="mt-2 font-mono text-[10px] text-[#333]">You can navigate away — we&apos;ll keep working.</p>
        </div>
      )}

      {/* Debug Meter */}
      {debug && (
        <div className="rise-in w-full max-w-xl">
          <PsychosisMeter value={debugScore} sublabel={`Zone: ${getZone(debugScore)}`} />

          <div className="mx-auto mt-6 max-w-lg rounded-sm border border-dashed border-[var(--ultra-orange)]/40 bg-[var(--ultra-orange)]/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs font-bold tracking-wider text-[var(--ultra-orange)] uppercase">
                Debug Mode
              </span>
              <span className="font-mono text-lg font-bold text-[var(--milk)]">{debugScore}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={debugScore}
              onChange={(e) => setDebugScore(Number(e.target.value))}
              className="w-full accent-[var(--ultra-orange)]"
            />
            <div className="mt-2 flex justify-between font-mono text-[10px] text-[#555]">
              {ZONES.map((z) => (
                <span key={z} className={getZone(debugScore) === z ? 'text-[var(--ultra-orange)]' : ''}>
                  {z.replace('_', ' ')}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {[0, 10, 25, 45, 65, 85, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setDebugScore(v)}
                  className="rounded-sm border border-[#333] px-2 py-1 font-mono text-[10px] text-[#888] transition hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)]"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* The Meter (real results) */}
      {!debug && showMeter && scoreData && (
        <div className="rise-in w-full max-w-xl">
          <div ref={resultRef} className="rounded-sm p-6" style={{ backgroundColor: '#0a0a0a' }}>
            <PsychosisMeter value={scoreData.score} />

            {/* Diagnosis card */}
            <div className="brutalist-card mx-auto mt-10 max-w-lg rounded-sm p-6">
              <h2 className="kicker mb-3">Diagnosis</h2>
              <p className="font-display text-lg leading-relaxed text-[var(--milk)]">
                {scoreData.diagnosis ?? 'No diagnosis available.'}
              </p>
            </div>
          </div>

          {/* Signal Breakdown */}
          <SignalBreakdown breakdownJson={scoreData.breakdown} />

          {/* Share buttons */}
          <div className="mt-8 flex flex-col items-center gap-4">
            <ShareButtons
              shareText={shareText}
              shareUrl={shareUrl}
              ogImageUrl={scoreData?.id ? `/og/meter?id=${scoreData.id}` : undefined}
              captureRef={resultRef}
            />
            {session?.user?.name && (
              <Link
                to="/droogs/$username"
                params={{ username: session.user.name }}
                className="font-mono text-xs tracking-wider text-[var(--ultra-orange)] transition-colors hover:text-[var(--milk)]"
              >
                View your profile &rarr;
              </Link>
            )}
            <button
              onClick={() => {
                setScoreData(null)
                setStep('connect')
              }}
              className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
            >
              I was cured all right. Try again.
            </button>
          </div>
        </div>
      )}

      {/* Leaderboard preview */}
      {topDroogs.length > 0 && (
        <section className="rise-in mt-20 w-full max-w-xl" style={{ animationDelay: '500ms' }}>
          <div className="mb-6 text-center">
            <h2 className="font-mono text-xs font-bold tracking-[0.3em] text-[#666] uppercase">Most Cooked Droogs</h2>
          </div>

          <div className="space-y-2">
            {topDroogs.map((droog, i) => {
              const linkUsername = droog.targetGithub ?? droog.targetX ?? droog.userName

              return (
                <Link
                  key={droog.scoreId}
                  to="/droogs/$username"
                  params={{ username: linkUsername }}
                  className="brutalist-card group flex items-center gap-3 rounded-sm p-3 transition-all hover:border-[var(--ultra-orange)]"
                >
                  <span className="w-6 font-mono text-sm font-bold text-[#444]">#{i + 1}</span>

                  {droog.userImage ? (
                    <img
                      src={droog.userImage}
                      alt={droog.userName}
                      className="h-8 w-8 rounded-full border border-[#333]"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#333] bg-[#1a1a1a] font-mono text-xs text-[#666]">
                      {droog.userName[0]?.toUpperCase()}
                    </div>
                  )}

                  <span className="flex-1 truncate font-mono text-sm font-bold text-[var(--milk)] group-hover:text-[var(--ultra-orange)]">
                    {droog.userName}
                  </span>

                  <div className="text-right">
                    <span className="font-mono text-xl font-bold" style={{ color: ZONE_COLORS[droog.zone] ?? '#777' }}>
                      {droog.score}
                    </span>
                    <div
                      className="mt-0.5 rounded-sm px-1.5 py-0.5 text-center font-mono text-[8px] font-bold tracking-wider uppercase"
                      style={{
                        color: ZONE_COLORS[droog.zone] ?? '#777',
                        border: `1px solid ${ZONE_COLORS[droog.zone] ?? '#333'}`,
                      }}
                    >
                      {droog.zone.replace('_', ' ')}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="mt-4 text-center">
            <Link
              to="/droogs"
              className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
            >
              View full leaderboard &rarr;
            </Link>
          </div>
        </section>
      )}

      {/* Report someone link */}
      <div className="rise-in mt-12 text-center" style={{ animationDelay: '550ms' }}>
        <Link
          to="/report"
          className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
        >
          Report someone &rarr;
        </Link>
      </div>

      {/* Nadsat quote footer */}
      <footer className="rise-in mt-16 text-center" style={{ animationDelay: '600ms' }}>
        <blockquote className="font-display text-sm italic text-[#444]" suppressHydrationWarning>
          &ldquo;{NADSAT_QUOTES[quoteIdx]}&rdquo;
        </blockquote>
        <div className="mx-auto mt-6 flex items-center justify-center gap-2">
          <div className="the-eye" style={{ width: '0.8em', height: '0.8em', borderWidth: '2px' }} />
          <span className="font-mono text-[10px] tracking-[0.3em] text-[#333] uppercase">
            The Ludovico Technique for Software Engineers
          </span>
        </div>

        {/* Version + social links */}
        <div className="mt-8 flex items-center justify-center gap-2 opacity-40 transition hover:opacity-80">
          <span className="rounded-full border border-[#333] px-2.5 py-1 font-mono text-[10px] text-[#555]">
            v{version === 'dev' ? 'dev' : version.slice(0, 7)}
          </span>
          <a
            href="https://github.com/marwanhilmi/psychosis.dev"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[#333] p-1.5 text-[#555] transition hover:text-[#ff4f00]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
          <a
            href="https://x.com/mhilmi"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[#333] p-1.5 text-[#555] transition hover:text-[#ff4f00]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
      </footer>
    </main>
  )
}

/* --- Inline SVG Icons --- */

function EyeIcon() {
  return (
    <svg width="80" height="50" viewBox="0 0 80 50" fill="none" className="pulse-glow">
      <path d="M5 25 Q40 -8 75 25 Q40 58 5 25Z" fill="none" stroke="#ff4f00" strokeWidth="2.5" />
      <circle cx="40" cy="25" r="12" fill="none" stroke="#ff4f00" strokeWidth="2" />
      <circle cx="40" cy="25" r="5" fill="#ff4f00" />
      <line x1="22" y1="10" x2="18" y2="2" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="5" x2="30" y2="-3" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="3" x2="40" y2="-5" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
      <line x1="48" y1="5" x2="50" y2="-3" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
      <line x1="58" y1="10" x2="62" y2="2" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
