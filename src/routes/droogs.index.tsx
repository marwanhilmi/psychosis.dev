import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '#/orpc/client'

export const Route = createFileRoute('/droogs/')({
  head: () => ({
    meta: [
      { title: 'The Droogs — PSYCHOSISMETER' },
      { property: 'og:title', content: 'The Droogs — PSYCHOSISMETER' },
      { property: 'og:description', content: 'See who else is cooked. The LLM Psychosis leaderboard.' },
      { property: 'og:url', content: 'https://psychosis.dev/droogs' },
    ],
  }),
  component: DroogsPage,
})

interface DroogEntry {
  scoreId: string
  score: number
  zone: string
  diagnosis: string | null
  githubDataUsed: boolean
  xDataUsed: boolean
  createdAt: Date | null
  userId: string | null
  userName: string
  userImage: string | null
  targetGithub: string | null
  targetX: string | null
}

const ZONE_COLORS: Record<string, string> = {
  SANE: '#2d6e2d',
  QUIRKY: '#8b6914',
  UNHINGED: '#cc7700',
  DERANGED: '#cc3f00',
  FULL_PSYCHOSIS: '#d42020',
}

type Mode = 'self' | 'reports'

function DroogsPage() {
  const [mode, setMode] = useState<Mode>('self')
  const {
    data: droogs = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['droogs', 'list', { limit: 50, offset: 0, mode }],
    queryFn: () => client.droogs.list({ limit: 50, offset: 0, mode }) as Promise<DroogEntry[]>,
    staleTime: 60_000,
  })
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load droogs') : ''

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center px-4 py-12">
      <header className="rise-in mb-8 text-center">
        <h1 className="display-title glitch-text mb-3 text-4xl font-bold tracking-tight text-[var(--milk)] sm:text-6xl">
          THE <span className="text-[var(--ultra-orange)]">DROOGS</span>
        </h1>
        <p className="kicker mb-2">See who else is cooked</p>
      </header>

      {/* Mode tabs */}
      <div className="rise-in mb-8 flex gap-1 rounded-sm border border-[#222] p-1" style={{ animationDelay: '100ms' }}>
        <button
          onClick={() => setMode('self')}
          className={`rounded-sm px-5 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-all ${
            mode === 'self' ? 'bg-[var(--ultra-orange)] text-black' : 'text-[#666] hover:text-[var(--milk)]'
          }`}
        >
          Self Diagnoses
        </button>
        <button
          onClick={() => setMode('reports')}
          className={`rounded-sm px-5 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-all ${
            mode === 'reports' ? 'bg-[var(--ultra-orange)] text-black' : 'text-[#666] hover:text-[var(--milk)]'
          }`}
        >
          Reported
        </button>
      </div>

      <p className="mb-6 font-mono text-[11px] text-[#555]">
        {mode === 'self' ? 'Users who analyzed themselves' : 'Public profiles reported by others'}
      </p>

      {loading ? (
        <div className="mt-8 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
          <p className="mt-3 font-mono text-xs text-[#666]">Loading droogs...</p>
        </div>
      ) : error ? (
        <div className="brutalist-card rounded-sm p-8 text-center">
          <p className="font-mono text-sm text-[var(--needle-red)]">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 font-mono text-sm text-[var(--ultra-orange)] transition-colors hover:text-[var(--milk)]"
          >
            Try again
          </button>
        </div>
      ) : droogs.length === 0 ? (
        <div className="brutalist-card rounded-sm p-8 text-center">
          <p className="font-mono text-sm text-[#777]">
            {mode === 'self' ? 'No droogs analyzed yet. Be the first!' : 'No reports yet. Snitch on a droog!'}
          </p>
          <Link
            to={mode === 'self' ? '/' : '/report'}
            className="mt-4 inline-block font-mono text-sm text-[var(--ultra-orange)] transition-colors hover:text-[var(--milk)]"
          >
            {mode === 'self' ? 'Get analyzed' : 'Report someone'} &rarr;
          </Link>
        </div>
      ) : (
        <div className="w-full max-w-2xl space-y-4">
          {droogs.map((droog, i) => {
            const displayName = droog.userName
            const isReport = mode === 'reports'
            const linkUsername = isReport ? (droog.targetGithub ?? droog.targetX ?? displayName) : displayName

            return (
              <Link
                key={droog.scoreId}
                to="/droogs/$username"
                params={{ username: linkUsername }}
                className="brutalist-card group flex items-center gap-4 rounded-sm p-4 transition-all hover:border-[var(--ultra-orange)]"
              >
                {/* Rank */}
                <span className="w-8 font-mono text-lg font-bold text-[#444]">#{i + 1}</span>

                {/* Avatar */}
                {droog.userImage ? (
                  <img
                    src={droog.userImage}
                    alt={displayName}
                    className="h-10 w-10 rounded-full border border-[#333]"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#333] bg-[#1a1a1a] font-mono text-sm text-[#666]">
                    {displayName[0]?.toUpperCase()}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1">
                  <span className="font-mono text-sm font-bold text-[var(--milk)] group-hover:text-[var(--ultra-orange)]">
                    {displayName}
                  </span>
                  <div className="flex items-center gap-2">
                    {isReport && <span className="font-mono text-[10px] text-[var(--ultra-orange)]">REPORTED</span>}
                    {droog.githubDataUsed && <span className="font-mono text-[10px] text-[#555]">GitHub</span>}
                    {droog.xDataUsed && <span className="font-mono text-[10px] text-[#555]">X</span>}
                  </div>
                </div>

                {/* Score + Zone */}
                <div className="text-right">
                  <span className="font-mono text-2xl font-bold" style={{ color: ZONE_COLORS[droog.zone] ?? '#777' }}>
                    {droog.score}
                  </span>
                  <div
                    className="mt-1 rounded-sm px-2 py-0.5 text-center font-mono text-[9px] font-bold tracking-wider uppercase"
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
      )}

      <footer className="mt-16">
        <Link
          to="/"
          className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
        >
          &larr; Back to the meter
        </Link>
      </footer>
    </main>
  )
}
