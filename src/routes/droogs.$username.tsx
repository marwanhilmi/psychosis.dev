import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import { PsychosisMeter } from '#/components/PsychosisMeter'
import { ShareButtons } from '#/components/ShareButtons'
import { client } from '#/orpc/client'

export const Route = createFileRoute('/droogs/$username')({
  component: DroogPage,
  head: ({ params }) => ({
    meta: [
      { title: `${params.username} — PSYCHOSISMETER` },
      { property: 'og:title', content: `${params.username}'s Psychosis Score` },
      { property: 'og:description', content: 'How cooked is their digital brain?' },
      { property: 'og:url', content: `https://psychosis.dev/droogs/${encodeURIComponent(params.username)}` },
      {
        property: 'og:image',
        content: `https://psychosis.dev/og/droog?username=${encodeURIComponent(params.username)}`,
      },
      { property: 'og:image:width', content: '2400' },
      { property: 'og:image:height', content: '1260' },
      { property: 'og:image:type', content: 'image/png' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: `${params.username}'s Psychosis Score` },
      { name: 'twitter:description', content: 'How cooked is their digital brain?' },
      {
        name: 'twitter:image',
        content: `https://psychosis.dev/og/droog?username=${encodeURIComponent(params.username)}`,
      },
    ],
  }),
})

interface DroogData {
  scoreId: string
  score: number
  zone: string
  diagnosis: string | null
  indicators: string | null
  breakdown: string | null
  githubDataUsed: boolean
  xDataUsed: boolean
  generationMs: number | null
  modelVersion: string | null
  createdAt: Date | null
  userId: string | null
  userName: string
  userImage: string | null
  targetGithub: string | null
  targetX: string | null
}

interface FetchState {
  droog: DroogData | null
  loading: boolean
  error: string
}

function DroogPage() {
  const { username } = Route.useParams()
  const [state, setState] = useState<FetchState>({ droog: null, loading: true, error: '' })
  const { droog, loading, error } = state
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setState({ droog: null, loading: true, error: '' })
    client.droogs
      .get({ username })
      .then((data) => setState({ droog: data as DroogData, loading: false, error: '' }))
      .catch(() => setState({ droog: null, loading: false, error: 'Droog not found' }))
  }, [username])

  const shareText = droog
    ? `${droog.userName}'s LLM Psychosis Score: ${droog.score}/100 — ${droog.zone}\n\nCheck your own score:\n\n${typeof window !== 'undefined' ? window.location.origin : ''}`
    : ''
  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const ogImageUrl = `/og/droog?username=${encodeURIComponent(username)}`

  if (loading) {
    return (
      <main className="page-wrap flex min-h-screen flex-col items-center justify-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-[var(--eyelash)] border-t-[var(--ultra-orange)]" />
        <p className="mt-3 font-mono text-xs text-[#666]">Loading droog profile...</p>
      </main>
    )
  }

  if (error || !droog) {
    return (
      <main className="page-wrap flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="font-mono text-sm text-[var(--needle-red)]">{error || 'Not found'}</p>
        <Link
          to="/droogs"
          className="font-mono text-xs text-[var(--ultra-orange)] transition-colors hover:text-[var(--milk)]"
        >
          &larr; Back to droogs
        </Link>
      </main>
    )
  }

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center px-4 py-12">
      {/* Header */}
      <header className="rise-in mb-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-3">
          {droog.userImage ? (
            <img src={droog.userImage} alt={droog.userName} className="h-12 w-12 rounded-full border border-[#333]" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#333] bg-[#1a1a1a] font-mono text-lg text-[#666]">
              {droog.userName[0]?.toUpperCase()}
            </div>
          )}
          {droog.targetGithub ? (
            <a
              href={`https://github.com/${droog.targetGithub}`}
              target="_blank"
              rel="noopener noreferrer"
              className="display-title text-3xl font-bold text-[var(--milk)] transition-colors hover:text-[var(--ultra-orange)]"
            >
              {droog.userName}
            </a>
          ) : (
            <h1 className="display-title text-3xl font-bold text-[var(--milk)]">{droog.userName}</h1>
          )}
        </div>
        <p className="kicker text-sm">{droog.userId ? 'Self Diagnosis' : 'Reported Profile'}</p>
      </header>

      {/* Meter + Diagnosis (capture target) */}
      <div ref={resultRef} className="w-full max-w-xl rounded-sm p-6" style={{ backgroundColor: '#0a0a0a' }}>
        <div className="rise-in" style={{ animationDelay: '200ms' }}>
          <PsychosisMeter value={droog.score} username={droog.userName} />
        </div>

        {droog.diagnosis && (
          <div
            className="rise-in brutalist-card mx-auto mt-10 max-w-lg rounded-sm p-6"
            style={{ animationDelay: '400ms' }}
          >
            <h2 className="kicker mb-3">Diagnosis</h2>
            <p className="font-display text-lg leading-relaxed text-[var(--milk)]">{droog.diagnosis}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="rise-in mt-8 flex flex-col items-center gap-4" style={{ animationDelay: '600ms' }}>
        <ShareButtons shareText={shareText} shareUrl={shareUrl} ogImageUrl={ogImageUrl} captureRef={resultRef} />

        <div className="mt-2 flex items-center gap-4">
          <Link
            to="/droogs"
            className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
          >
            &larr; All droogs
          </Link>
          <Link
            to="/"
            className="font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
          >
            Get your own score
          </Link>
        </div>
      </div>
    </main>
  )
}
