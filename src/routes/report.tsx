import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PsychosisMeter } from '#/components/PsychosisMeter'
import { RepoPicker, type RepoItem } from '#/components/RepoPicker'
import { ShareButtons } from '#/components/ShareButtons'
import { FEATURES } from '#/lib/feature-flags'
import { client } from '#/orpc/client'

export const Route = createFileRoute('/report')({
  head: () => ({
    meta: [
      { title: 'Report a Droog — PSYCHOSISMETER' },
      { property: 'og:title', content: 'Report a Droog — PSYCHOSISMETER' },
      { property: 'og:description', content: 'Submit someone for LLM Psychosis analysis.' },
      { property: 'og:url', content: 'https://psychosis.dev/report' },
    ],
  }),
  component: ReportPage,
})

interface ScoreResult {
  score: number
  zone: string
  diagnosis: string | null
  indicators: string | null
}

type ReportStep = 'username' | 'pick-repos' | 'analyzing' | 'result'

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

function ReportPage() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<ReportStep>('username')
  const [targetGithub, setTargetGithub] = useState('')
  const [targetX, setTargetX] = useState('')
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null)
  const [scoreId, setScoreId] = useState<string | null>(null)
  const [targetName, setTargetName] = useState('')
  const [error, setError] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)

  const normalizedGithub = targetGithub.trim()
  const normalizedX = FEATURES.X_ENABLED ? targetX.trim().replace(/^@+/, '') : ''

  const handleScoreComplete = useCallback(
    async (completedScoreId: string) => {
      try {
        const score = await client.analysis.getScore({ id: completedScoreId })
        setScoreId(completedScoreId)
        setScoreResult({
          score: score.score,
          zone: score.zone,
          diagnosis: score.diagnosis,
          indicators: score.indicators,
        })
        setStep('result')
        void queryClient.invalidateQueries({ queryKey: ['droogs'] })
      } catch {
        setError('Failed to load results.')
        setStep('username')
      } finally {
        setSubmitting(false)
      }
    },
    [queryClient],
  )

  const handleJobError = useCallback(
    (msg: string) => {
      setError(msg)
      setSubmitting(false)
      setStep(normalizedGithub ? 'pick-repos' : 'username')
    },
    [normalizedGithub],
  )

  const { startPolling, progressMessage, completedSteps, totalSteps } = useJobPoller(
    handleScoreComplete,
    handleJobError,
  )

  const canLookup = (normalizedGithub || normalizedX) && !reposLoading

  const handleLookup = async () => {
    if (!canLookup) return
    setError('')
    setTargetName([normalizedGithub, normalizedX ? `@${normalizedX}` : ''].filter(Boolean).join(' + '))

    if (normalizedGithub) {
      setReposLoading(true)
      try {
        const result = await client.reports.listRepos({ username: normalizedGithub })
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
    } else {
      void handleSubmit()
    }
  }

  const handleReposConfirm = (selected: RepoItem[]) => {
    void handleSubmit(selected.map((r) => r.fullName))
  }

  const handleSubmit = async (selectedRepos?: string[]) => {
    setSubmitting(true)
    setError('')
    setStep('analyzing')

    try {
      const res = await client.reports.submit({
        targetGithub: normalizedGithub || undefined,
        targetX: normalizedX || undefined,
        selectedRepos,
      })

      if (res.status === 'done' && res.scoreId) {
        await handleScoreComplete(res.scoreId)
      } else if (res.status === 'processing' && res.jobId) {
        startPolling(res.jobId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. The machine spirits are displeased.')
      setStep(normalizedGithub ? 'pick-repos' : 'username')
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setStep('username')
    setScoreResult(null)
    setScoreId(null)
    setTargetGithub('')
    setTargetX('')
    setRepos([])
    setError('')
  }

  const droogPath = normalizedGithub ? `/droogs/${encodeURIComponent(normalizedGithub)}` : '/report'
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareText = scoreResult
    ? `${targetName}'s LLM Psychosis Score: ${scoreResult.score}/100 — ${scoreResult.zone}\n\nReport your own droogs:\n\n${origin}${droogPath}`
    : ''
  const shareUrl = `${origin}${droogPath}`

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center px-4 py-12">
      <header className="rise-in mb-12 text-center">
        <h1 className="display-title glitch-text mb-3 text-4xl font-bold tracking-tight text-[var(--milk)] sm:text-6xl">
          REPORT A <span className="text-[var(--ultra-orange)]">DROOG</span>
        </h1>
        <p className="kicker mb-2">Submit someone for analysis</p>
        <p className="font-mono text-sm text-[#555]">
          {FEATURES.X_ENABLED
            ? 'Enter a public GitHub username, X username, or both'
            : 'Enter a public GitHub username'}
        </p>
        <p className="mt-1 font-mono text-[10px] text-[#444]">
          {FEATURES.X_ENABLED
            ? 'GitHub scans owned and contributed repos. X scans public tweets.'
            : 'Scans owned and contributed repos.'}
        </p>
      </header>

      {/* Username input */}
      {step === 'username' && (
        <div className="rise-in w-full max-w-md" style={{ animationDelay: '200ms' }}>
          <div className="brutalist-card rounded-sm p-6">
            <div className="mb-4">
              <label
                htmlFor="report-github"
                className="mb-1 block font-mono text-xs font-bold tracking-wider text-[#666] uppercase"
              >
                GitHub Username
              </label>
              <input
                id="report-github"
                type="text"
                value={targetGithub}
                onChange={(e) => setTargetGithub(e.target.value)}
                placeholder="e.g. torvalds"
                className="w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-4 py-2 font-mono text-sm text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)]"
              />
            </div>

            {FEATURES.X_ENABLED && (
              <div className="mb-4">
                <label
                  htmlFor="report-x"
                  className="mb-1 block font-mono text-xs font-bold tracking-wider text-[#666] uppercase"
                >
                  X Username
                </label>
                <input
                  id="report-x"
                  type="text"
                  value={targetX}
                  onChange={(e) => setTargetX(e.target.value)}
                  placeholder="e.g. jack or @jack"
                  className="w-full rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-4 py-2 font-mono text-sm text-[var(--milk)] placeholder-[#444] outline-none transition-colors focus:border-[var(--ultra-orange)]"
                />
              </div>
            )}

            {error && <p className="mb-4 font-mono text-sm text-[var(--needle-red)]">{error}</p>}

            <button
              onClick={handleLookup}
              disabled={!canLookup}
              className={`w-full rounded-sm border-2 px-6 py-3 font-mono text-sm font-bold tracking-wider uppercase transition-all ${
                canLookup
                  ? 'border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 text-[var(--ultra-orange)] hover:bg-[var(--ultra-orange)] hover:text-black'
                  : 'cursor-not-allowed border-[#222] text-[#444]'
              }`}
            >
              {reposLoading ? 'Fetching repos...' : normalizedGithub ? 'Look Up Repos' : 'Submit for Analysis'}
            </button>
          </div>

          {reposLoading && (
            <div className="mt-6 text-center">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
              <p className="mt-2 font-mono text-[10px] text-[#444]">Fetching public repos...</p>
            </div>
          )}
        </div>
      )}

      {/* Repo Picker */}
      {step === 'pick-repos' && (
        <div className="rise-in w-full max-w-2xl" style={{ animationDelay: '100ms' }}>
          <div className="mb-4 text-center">
            <span className="font-mono text-sm text-[#666]">Repos for </span>
            <span className="font-mono text-sm font-bold text-[var(--ultra-orange)]">{targetName}</span>
          </div>
          {error && <p className="mb-4 text-center font-mono text-sm text-[var(--needle-red)]">{error}</p>}
          <RepoPicker repos={repos} onConfirm={handleReposConfirm} loading={submitting} />
          <button
            onClick={() => {
              setStep('username')
              setError('')
            }}
            className="mt-3 w-full text-center font-mono text-[10px] tracking-wider text-[#555] uppercase transition-colors hover:text-[var(--ultra-orange)]"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Analyzing state */}
      {step === 'analyzing' && (
        <div className="rise-in text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
          <p className="mt-2 font-mono text-xs text-[#666]">Running the ultra-analysis...</p>
          {progressMessage ? (
            <p className="mt-1 font-mono text-[10px] text-[var(--ultra-orange)]">{progressMessage}</p>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-[#444]">Fetching public data and running analysis...</p>
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

      {/* Results */}
      {step === 'result' && scoreResult && (
        <div className="rise-in w-full max-w-xl">
          <div ref={resultRef} className="rounded-sm p-6" style={{ backgroundColor: '#0a0a0a' }}>
            <div className="mb-4 text-center">
              <span className="font-mono text-sm text-[#666]">Report for </span>
              <span className="font-mono text-sm font-bold text-[var(--ultra-orange)]">{targetName}</span>
            </div>

            <PsychosisMeter value={scoreResult.score} />

            {scoreResult.diagnosis && (
              <div className="brutalist-card mx-auto mt-10 max-w-lg rounded-sm p-6">
                <h2 className="kicker mb-3">Diagnosis</h2>
                <p className="font-display text-lg leading-relaxed text-[var(--milk)]">{scoreResult.diagnosis}</p>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col items-center gap-4">
            <ShareButtons
              shareText={shareText}
              shareUrl={shareUrl}
              ogImageUrl={scoreId ? `/og/meter?id=${scoreId}` : undefined}
              captureRef={resultRef}
            />
            <button
              onClick={handleReset}
              className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
            >
              Report another droog
            </button>
          </div>
        </div>
      )}

      <footer className="mt-16 flex items-center gap-4">
        <Link
          to="/"
          className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
        >
          &larr; Home
        </Link>
        <Link
          to="/droogs"
          className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
        >
          View leaderboard &rarr;
        </Link>
      </footer>
    </main>
  )
}
