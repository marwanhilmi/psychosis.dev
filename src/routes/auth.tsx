import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { authClient } from '#/lib/auth-client'
import { FEATURES } from '#/lib/feature-flags'
import { client } from '#/orpc/client'

export const Route = createFileRoute('/auth')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : '',
  }),
  head: () => ({
    meta: [
      { title: 'Sign In — PSYCHOSISMETER' },
      { property: 'og:title', content: 'Sign In — PSYCHOSISMETER' },
      { property: 'og:description', content: 'Submit yourself for analysis.' },
      { property: 'og:url', content: 'https://psychosis.dev/auth' },
    ],
  }),
  component: AuthPage,
})

function AuthPage() {
  const { data: session } = authClient.useSession()
  const { redirect } = Route.useSearch()
  const [error, setError] = useState('')
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const callbackURL = redirect || '/'
  const isLoggedIn = !!session?.user
  const hasGithub = connectedProviders.includes('github')
  const hasX = FEATURES.X_ENABLED && connectedProviders.includes('twitter')
  const hasAll = hasGithub && (hasX || !FEATURES.X_ENABLED)

  // Fetch connected accounts when logged in
  useEffect(() => {
    if (!isLoggedIn) {
      setConnectedProviders([])
      return
    }
    client.users
      .connectedAccounts()
      .then(setConnectedProviders)
      .catch(() => {})
  }, [isLoggedIn])

  // If logged in and all providers connected, redirect
  if (isLoggedIn && hasAll) {
    return <Navigate to={callbackURL} />
  }

  const handleSignIn = async (provider: 'github' | 'twitter') => {
    setError('')
    setLoading(true)
    try {
      await authClient.signIn.social({ provider, callbackURL })
    } catch {
      setError('Sign in failed. Try again.')
      setLoading(false)
    }
  }

  const handleLink = async (provider: 'github' | 'twitter') => {
    setError('')
    setLoading(true)
    try {
      await authClient.linkSocial({ provider, callbackURL })
    } catch {
      setError('Failed to link account. Try again.')
      setLoading(false)
    }
  }

  return (
    <main className="page-wrap flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="brutalist-card rounded-sm p-8">
          {/* Eye motif */}
          <div className="mb-6 flex justify-center">
            <svg width="60" height="38" viewBox="0 0 80 50" fill="none" className="pulse-glow">
              <path d="M5 25 Q40 -8 75 25 Q40 58 5 25Z" fill="none" stroke="#ff4f00" strokeWidth="2.5" />
              <circle cx="40" cy="25" r="12" fill="none" stroke="#ff4f00" strokeWidth="2" />
              <circle cx="40" cy="25" r="5" fill="#ff4f00" />
              <line x1="22" y1="10" x2="18" y2="2" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
              <line x1="32" y1="5" x2="30" y2="-3" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
              <line x1="40" y1="3" x2="40" y2="-5" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
              <line x1="48" y1="5" x2="50" y2="-3" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
              <line x1="58" y1="10" x2="62" y2="2" stroke="#ff4f00" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          {isLoggedIn ? (
            <>
              <h1 className="display-title mb-2 text-center text-2xl font-bold text-[var(--milk)]">Connect Accounts</h1>
              <p className="kicker mb-8 text-center text-sm">Link another source for deeper analysis</p>
            </>
          ) : (
            <>
              <h1 className="display-title mb-2 text-center text-2xl font-bold text-[var(--milk)]">Sign In</h1>
              <p className="kicker mb-8 text-center text-sm">Submit yourself for analysis</p>
            </>
          )}

          {error && <p className="mb-4 text-center font-mono text-sm text-[var(--needle-red)]">{error}</p>}

          <div className="flex flex-col gap-3">
            {/* GitHub */}
            {hasGithub ? (
              <div className="flex w-full items-center justify-center gap-3 rounded-sm border-2 border-[#2d6e2d] bg-[#2d6e2d]/10 px-4 py-3 font-mono text-sm font-bold tracking-wider text-[#4ade80] uppercase">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                GitHub Connected
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
              </div>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => (isLoggedIn ? handleLink('github') : handleSignIn('github'))}
                className="flex w-full items-center justify-center gap-3 rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-4 py-3 font-mono text-sm font-bold tracking-wider text-[var(--milk)] uppercase transition-all hover:border-[var(--milk)] hover:bg-[var(--milk)]/5 disabled:opacity-50"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                {isLoggedIn ? 'Link GitHub' : 'Continue with GitHub'}
              </button>
            )}

            {/* X / Twitter */}
            {FEATURES.X_ENABLED &&
              (hasX ? (
                <div className="flex w-full items-center justify-center gap-3 rounded-sm border-2 border-[#2d6e2d] bg-[#2d6e2d]/10 px-4 py-3 font-mono text-sm font-bold tracking-wider text-[#4ade80] uppercase">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  X Connected
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
                </div>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => (isLoggedIn ? handleLink('twitter') : handleSignIn('twitter'))}
                  className="flex w-full items-center justify-center gap-3 rounded-sm border-2 border-[var(--eyelash)] bg-transparent px-4 py-3 font-mono text-sm font-bold tracking-wider text-[var(--milk)] uppercase transition-all hover:border-[var(--milk)] hover:bg-[var(--milk)]/5 disabled:opacity-50"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  {isLoggedIn ? 'Link X' : 'Continue with X'}
                </button>
              ))}
          </div>

          {isLoggedIn && (
            <Link
              to={callbackURL}
              className="mt-4 block text-center font-mono text-xs tracking-wider text-[#555] transition-colors hover:text-[var(--ultra-orange)]"
            >
              Skip &rarr;
            </Link>
          )}

          <div className="mt-6 text-center font-mono text-[12px] font-bold tracking-wider text-white">
            <p>
              {isLoggedIn
                ? FEATURES.X_ENABLED
                  ? 'Connect at least one. Both gives a deeper analysis.'
                  : 'Connect your GitHub for analysis.'
                : FEATURES.X_ENABLED
                  ? 'We analyze your public repos, commits, and tweets. Nothing more.'
                  : 'We analyze public repos and commits only.'}
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
