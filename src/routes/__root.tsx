import { HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import TanStackQueryProvider from '../integrations/tanstack-query/root-provider'
import appCss from '../styles.css?url'
import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

const SITE_TITLE = 'PSYCHOSISMETER'
const SITE_DESCRIPTION = 'How cooked is your digital brain? Connect GitHub and discover your LLM Psychosis Score.'
const SITE_URL = 'https://psychosis.dev'

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: SITE_TITLE },
      { name: 'description', content: SITE_DESCRIPTION },
      { name: 'theme-color', content: '#0a0a0a' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE_TITLE },
      { property: 'og:title', content: SITE_TITLE },
      { property: 'og:description', content: SITE_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: `${SITE_URL}/og/home` },
      { property: 'og:image:width', content: '2400' },
      { property: 'og:image:height', content: '1260' },
      { property: 'og:image:type', content: 'image/png' },
      // Twitter / X
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: SITE_TITLE },
      { name: 'twitter:description', content: SITE_DESCRIPTION },
      { name: 'twitter:image', content: `${SITE_URL}/og/home` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function NotFound() {
  return (
    <main className="page-wrap flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="display-title text-6xl font-bold text-[var(--milk)]">
        4<span className="text-[var(--ultra-orange)]">0</span>4
      </h1>
      <p className="font-mono text-sm text-[#666]">This droog does not exist... yet.</p>
      <Link
        to="/"
        className="rounded-sm border-2 border-[var(--ultra-orange)] bg-[var(--ultra-orange)]/10 px-8 py-3 font-mono text-sm font-bold tracking-wider text-[var(--ultra-orange)] uppercase transition-all hover:bg-[var(--ultra-orange)] hover:text-black"
      >
        Back to the meter
      </Link>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(255,79,0,0.24)] selection:text-white">
        <TanStackQueryProvider>{children}</TanStackQueryProvider>
        <Scripts />
      </body>
    </html>
  )
}
