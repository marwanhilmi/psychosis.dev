#!/usr/bin/env node --experimental-strip-types
/**
 * CLI wrapper for the debug analysis API.
 * Requires the dev server to be running (`vp dev`).
 *
 * Usage:
 *   node scripts/debug-analyze.ts <github-username> [--repos <n>] [--repo owner/name ...] [--json] [--verbose] [--port <port>]
 *
 * Examples:
 *   node scripts/debug-analyze.ts torvalds
 *   node scripts/debug-analyze.ts myuser --repos 3 --verbose
 *   node scripts/debug-analyze.ts myuser --repo myuser/my-app myuser/my-lib
 *   node scripts/debug-analyze.ts myuser --json
 *   node scripts/debug-analyze.ts myuser --port 5175
 */

// ─── CLI Colors ──────────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

const ZONE_COLORS: Record<string, (s: string) => string> = {
  SANE: green,
  QUIRKY: yellow,
  UNHINGED: yellow,
  DERANGED: red,
  FULL_PSYCHOSIS: magenta,
}

function getZone(score: number): string {
  if (score < 20) return 'SANE'
  if (score < 40) return 'QUIRKY'
  if (score < 60) return 'UNHINGED'
  if (score < 80) return 'DERANGED'
  return 'FULL_PSYCHOSIS'
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 5)
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
  if (score >= 70) return red(bar)
  if (score >= 40) return yellow(bar)
  return green(bar)
}

// ─── Args ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const username = args.find((a) => !a.startsWith('--'))
const maxRepos = Number(args[args.indexOf('--repos') + 1]) || 5
const jsonOutput = args.includes('--json')
const verbose = args.includes('--verbose')
const port = Number(args[args.indexOf('--port') + 1]) || 5173
const selectedRepos: string[] = []
const repoIdx = args.indexOf('--repo')
if (repoIdx !== -1) {
  for (let i = repoIdx + 1; i < args.length && !args[i].startsWith('--'); i++) {
    selectedRepos.push(args[i])
  }
}

if (!username) {
  console.error(
    'Usage: node scripts/debug-analyze.ts <github-username> [--repos <n>] [--repo owner/name ...] [--json] [--verbose] [--port <port>]',
  )
  process.exit(1)
}

const BASE_URL = `http://localhost:${port}`

// ─── Types (mirroring debug-analysis.ts result) ─────────────────────────────────

interface DebugSignal {
  key: string
  score: number
  details: Record<string, unknown>
}

interface DebugAnalysisResult {
  signals: DebugSignal[]
  defaultWeights: Record<string, number>
  baseScore: number
  bonusPoints: number
  fullPsychosisFloor: number
  bonusReasons: string[]
  finalScore: number
  zone: string
  totalCommits: number
  contributors: Array<{
    login: string
    totalCommits: number
    totalAdditions: number
    totalDeletions: number
    isBot: boolean
  }>
  aiToolBreakdown: Record<string, number>
  aiCoAuthorCount: number
  perRepo: Array<{
    repo: string
    commits: number
    prs: number
    contributorCount: number
    stars: number
  }>
  logs: string[]
  elapsedMs: number
  rateLimit: { remaining: number; limit: number; reset: string } | null
  commitMessages: string[]
  commitTimeDistribution: number[]
}

type ApiResponse = { ok: true; result: DebugAnalysisResult } | { ok: false; error: string; logs?: string[] }

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const log = (...a: unknown[]) => {
    if (!jsonOutput) console.log(...a)
  }

  log(bold('\n══════════════════════════════════════════════════════'))
  log(bold('  PSYCHOSISMETER — Debug Analysis'))
  log(bold('══════════════════════════════════════════════════════\n'))
  log(`  ${bold('User:')}      ${cyan(username!)}`)
  if (selectedRepos.length > 0) {
    log(`  ${bold('Repos:')}     ${selectedRepos.join(', ')}`)
  } else {
    log(`  ${bold('Max repos:')} ${maxRepos}`)
  }
  log(`  ${bold('Server:')}    ${BASE_URL}`)
  log('')

  // Check server is reachable
  try {
    await fetch(`${BASE_URL}/`, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
  } catch {
    console.error(red(`Cannot reach dev server at ${BASE_URL}. Is it running? (vp dev)`))
    process.exit(1)
  }

  log(dim('  Sending analysis request...'))
  const startMs = Date.now()

  const payload: Record<string, unknown> = { username }
  if (selectedRepos.length > 0) {
    payload.selectedRepos = selectedRepos
  } else {
    payload.maxRepos = maxRepos
  }

  const res = await fetch(`${BASE_URL}/api/debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok && res.status !== 500) {
    console.error(red(`  Server returned ${res.status}: ${res.statusText}`))
    process.exit(1)
  }

  const data = (await res.json()) as ApiResponse
  const clientElapsed = Date.now() - startMs

  if (!data.ok) {
    console.error(red(`\n  Analysis failed: ${data.error}\n`))
    if (data.logs && data.logs.length > 0) {
      console.log(dim('  Server logs:'))
      for (const l of data.logs) console.log(dim(`    ${l}`))
    }
    process.exit(1)
  }

  const result = data.result

  // ─── JSON mode ──────────────────────────────────────────────────────────────
  if (jsonOutput) {
    const weights = result.defaultWeights
    const activeWeightTotal = result.signals.reduce((sum, sig) => sum + (weights[sig.key] ?? 0), 0)

    const output = {
      username,
      score: result.finalScore,
      zone: result.zone,
      baseScore: result.baseScore,
      bonusPoints: result.bonusPoints,
      fullPsychosisFloor: result.fullPsychosisFloor,
      bonusReasons: result.bonusReasons,
      elapsedMs: result.elapsedMs,
      totalCommits: result.totalCommits,
      signals: Object.fromEntries(
        result.signals.map((s) => [
          s.key,
          {
            score: s.score,
            weight: weights[s.key] ?? 0,
            weighted: activeWeightTotal > 0 ? (s.score * (weights[s.key] ?? 0)) / activeWeightTotal : 0,
            details: s.details,
          },
        ]),
      ),
      contributors: result.contributors,
      aiToolBreakdown: result.aiToolBreakdown,
      perRepo: result.perRepo,
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  // ─── Pretty print ──────────────────────────────────────────────────────────

  // Compute weighted score
  const weights = result.defaultWeights
  const activeWeightTotal = result.signals.reduce((sum, sig) => sum + (weights[sig.key] ?? 0), 0)
  const finalScore = result.finalScore
  const zone = result.zone || getZone(finalScore)
  const zoneColor = ZONE_COLORS[zone] ?? dim

  // Signals
  const ghSignalKeys = new Set([
    'aiToolAttribution',
    'volumeVelocity',
    'commitBurstiness',
    'diffSizeAnomaly',
    'commitMsgSimilarity',
    'markdownDensity',
    'commitMsgFormality',
    'commitMsgLength',
    'commitTimeEntropy',
  ])

  const ghSignals = result.signals
    .filter((s) => ghSignalKeys.has(s.key))
    .sort((a, b) => b.score * (weights[b.key] ?? 0) - a.score * (weights[a.key] ?? 0))
  const otherSignals = result.signals.filter((s) => !ghSignalKeys.has(s.key))

  log(bold('\n══════════════════════════════════════════════════════'))
  log(bold('  SIGNAL BREAKDOWN'))
  log(bold('══════════════════════════════════════════════════════\n'))

  log(cyan('  GitHub Signals:\n'))
  for (const sig of ghSignals) {
    const w = weights[sig.key] ?? 0
    const weighted = activeWeightTotal > 0 ? (sig.score * w) / activeWeightTotal : 0
    log(`  ${scoreBar(sig.score)} ${bold(sig.key.padEnd(24))} ${dim(`w=${w}`)} → ${yellow(weighted.toFixed(2))}`)

    if (verbose) {
      for (const [k, v] of Object.entries(sig.details)) {
        const val =
          v == null
            ? String(v)
            : typeof v === 'object'
              ? JSON.stringify(v)
              : typeof v === 'string'
                ? v
                : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint'
                  ? String(v)
                  : '[unprintable]'
        log(`${''.padStart(42)}${dim(`${k}: ${val}`)}`)
      }
      log('')
    }
  }

  if (otherSignals.length > 0) {
    log(dim('\n  X / Cross-platform Signals (no data):'))
    for (const sig of otherSignals) {
      const w = weights[sig.key] ?? 0
      log(`  ${scoreBar(sig.score)} ${dim(sig.key.padEnd(24))} ${dim(`w=${w}`)}`)
    }
  }

  // Result
  log(bold('\n══════════════════════════════════════════════════════'))
  log(bold('  RESULT'))
  log(bold('══════════════════════════════════════════════════════\n'))

  log(`  ${bold('Score:')}  ${zoneColor(String(finalScore))} / 100`)
  log(`  ${bold('Zone:')}   ${zoneColor(zone)}`)
  if (result.bonusPoints > 0 || result.fullPsychosisFloor > 0) {
    log(
      `  ${bold('Base:')}   ${result.baseScore} + ${result.bonusPoints} satire bonus${
        result.fullPsychosisFloor > 0 ? `, floor ${result.fullPsychosisFloor}` : ''
      }`,
    )
    for (const reason of result.bonusReasons) {
      log(`           ${dim(`• ${reason}`)}`)
    }
  }
  log(
    `  ${bold('Time:')}   ${(result.elapsedMs / 1000).toFixed(1)}s server + ${((clientElapsed - result.elapsedMs) / 1000).toFixed(1)}s network`,
  )
  log('')

  // Contributor breakdown
  if (result.contributors.length > 0) {
    log(bold('── Contributor Breakdown ────────────────────────────'))
    const sorted = [...result.contributors].sort((a, b) => b.totalAdditions - a.totalAdditions)
    const totalAdds = sorted.reduce((sum, c) => sum + c.totalAdditions, 0)
    for (const cs of sorted.slice(0, 15)) {
      const pct = totalAdds > 0 ? ((cs.totalAdditions / totalAdds) * 100).toFixed(1) : '0'
      const botTag = cs.isBot ? red(' [BOT]') : ''
      log(
        `    ${cs.login.padEnd(24)} ${cyan(`${pct}%`.padStart(6))} additions  (${cs.totalCommits} commits, +${cs.totalAdditions}/-${cs.totalDeletions})${botTag}`,
      )
    }
    log('')
  }

  // AI tool breakdown
  const tools = Object.entries(result.aiToolBreakdown)
  if (tools.length > 0) {
    log(bold('── AI Tool Attribution ─────────────────────────────'))
    log(
      `    ${result.aiCoAuthorCount} / ${result.totalCommits} commits (${((result.aiCoAuthorCount / result.totalCommits) * 100).toFixed(1)}%)`,
    )
    for (const [tool, count] of tools.sort((a, b) => b[1] - a[1])) {
      log(`    ${yellow(tool.padEnd(16))} ${count} mentions`)
    }
    log('')
  }

  // Per-repo summary
  log(bold('── Per-Repo Summary ────────────────────────────────'))
  for (const rs of result.perRepo) {
    log(
      `    ${rs.repo.padEnd(35)} ${String(rs.commits).padStart(4)} commits  ${String(rs.prs).padStart(3)} PRs  ${String(rs.contributorCount).padStart(2)} contributors  ★ ${rs.stars}`,
    )
  }
  log('')

  // Execution log
  if (verbose && result.logs.length > 0) {
    log(bold('── Execution Log ──────────────────────────────────'))
    for (const l of result.logs) log(dim(`    ${l}`))
    log('')
  }

  // Rate limit
  if (result.rateLimit) {
    const rl = result.rateLimit
    log(dim(`  Rate limit: ${rl.remaining}/${rl.limit} remaining, resets ${rl.reset}`))
  }
}

main().catch((err) => {
  console.error(red(`\nFatal error: ${err instanceof Error ? err.message : String(err)}`))
  process.exit(1)
})
