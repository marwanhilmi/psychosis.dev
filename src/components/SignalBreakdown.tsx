import { useState } from 'react'

// ─── Signal metadata ────────────────────────────────────────────────────────────

const GITHUB_SIGNAL_META: Record<string, { name: string; desc: string; weight: number }> = {
  aiToolAttribution: { name: 'AI Tool Attribution', desc: 'Co-authored-by, bot accounts, AI mentions', weight: 0.22 },
  volumeVelocity: { name: 'Volume Velocity', desc: 'Spikes in weekly additions (z-score)', weight: 0.05 },
  commitBurstiness: { name: 'Commit Burstiness', desc: 'Rapid-fire commits (< 2min gaps)', weight: 0.09 },
  diffSizeAnomaly: { name: 'Diff Size Anomaly', desc: 'Unusually large additions per commit', weight: 0.1 },
  commitMsgSimilarity: { name: 'Message Similarity', desc: 'Templated/repetitive messages', weight: 0.08 },
  markdownDensity: { name: 'Markdown Density', desc: 'High % of .md files + churn rate', weight: 0.05 },
  commitMsgFormality: { name: 'Message Formality', desc: 'Overly structured commits', weight: 0.06 },
  commitMsgLength: { name: 'Message Length', desc: 'Verbose commit messages', weight: 0.1 },
  commitTimeEntropy: { name: 'Time Entropy', desc: 'Uniform time distribution', weight: 0.03 },
}

const X_SIGNAL_META: Record<string, { name: string; desc: string; weight: number }> = {
  tweetFormality: { name: 'Tweet Formality', desc: 'Long polished tweet style', weight: 0.3 },
  engagementRatio: { name: 'Engagement Mismatch', desc: 'Long posts with weak engagement', weight: 0.2 },
  postingRegularity: { name: 'Posting Regularity', desc: 'Uniform posting hour distribution', weight: 0.15 },
  threadIntensity: { name: 'Thread Intensity', desc: 'Reply-thread heavy posting', weight: 0.15 },
  aiArtifactDensity: { name: 'AI Artifact Density', desc: 'Common LLM phrase usage', weight: 0.2 },
}

const CROSS_SIGNAL_META: Record<string, { name: string; desc: string; weight: number }> = {
  styleConsistency: { name: 'Style Consistency', desc: 'Vocabulary overlap across GitHub and X', weight: 0.65 },
  vocabularyDiversity: { name: 'Vocabulary Diversity', desc: 'Cross-platform lexical diversity', weight: 0.35 },
}

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PlatformSignals {
  signals: Record<string, number>
  subscore: number
}

interface Breakdown {
  github: PlatformSignals | null
  x: PlatformSignals | null
  cross: PlatformSignals | null
  combined: {
    score: number
    zone: string
    weightsUsed: Record<string, number>
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score < 20) return '#2d6e2d'
  if (score < 40) return '#8b6914'
  if (score < 60) return '#cc7700'
  if (score < 80) return '#cc3f00'
  return '#d42020'
}

// ─── Components ─────────────────────────────────────────────────────────────────

function SignalRow({ name, desc, score, weight }: { name: string; desc: string; score: number; weight: number }) {
  const rounded = Math.round(score)
  const weighted = Math.round(score * weight * 10) / 10

  return (
    <div className="flex items-center gap-2 rounded-sm border border-[#1a1a1a] bg-[#0d0d0d] px-3 py-2 sm:gap-3">
      <div className="w-28 shrink-0 sm:w-36">
        <div className="font-mono text-[11px] font-bold leading-tight text-[var(--milk)]">{name}</div>
        <div className="hidden font-mono text-[8px] leading-tight text-[#444] sm:block">{desc}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="h-2.5 overflow-hidden rounded-full bg-[#1a1a1a]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(1, rounded)}%`,
              backgroundColor: scoreColor(rounded),
            }}
          />
        </div>
      </div>

      <span className="w-8 shrink-0 text-right font-mono text-xs font-bold" style={{ color: scoreColor(rounded) }}>
        {rounded}
      </span>

      <span className="hidden w-12 shrink-0 text-right font-mono text-[9px] text-[#555] sm:inline">
        ×{weight.toFixed(2)}
      </span>

      <span className="hidden w-10 shrink-0 text-right font-mono text-[10px] text-[#888] sm:inline">
        {weighted.toFixed(1)}
      </span>
    </div>
  )
}

function PlatformSection({
  title,
  subscore,
  signals,
  meta,
  platformWeight,
}: {
  title: string
  subscore: number
  signals: Record<string, number>
  meta: Record<string, { name: string; desc: string; weight: number }>
  platformWeight?: number
}) {
  const signalKeys = Object.keys(meta).filter((key) => key in signals)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-bold tracking-wider text-[#666] uppercase">{title}</h3>
        <div className="flex items-center gap-2">
          {platformWeight !== undefined && (
            <span className="font-mono text-[9px] text-[#444]">{Math.round(platformWeight * 100)}% of total</span>
          )}
          <span className="font-mono text-xs font-bold" style={{ color: scoreColor(subscore) }}>
            {subscore}
          </span>
        </div>
      </div>
      <div className="space-y-1">
        {signalKeys.map((key) => (
          <SignalRow
            key={key}
            name={meta[key].name}
            desc={meta[key].desc}
            score={signals[key]}
            weight={meta[key].weight}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function SignalBreakdown({ breakdownJson }: { breakdownJson: string | null }) {
  const [open, setOpen] = useState(false)

  if (!breakdownJson) return null

  let breakdown: Breakdown
  try {
    breakdown = JSON.parse(breakdownJson) as Breakdown
  } catch {
    return null
  }

  const hasSignals = breakdown.github || breakdown.x || breakdown.cross

  if (!hasSignals) return null

  return (
    <div className="mt-8 w-full">
      <button
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center justify-center gap-2 rounded-sm border border-[#222] bg-[#0a0a0a] px-4 py-3 font-mono text-xs tracking-wider text-[#666] uppercase transition-all hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)]"
      >
        <span className="transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
          ▶
        </span>
        Signal Breakdown
        <span className="text-[10px] normal-case text-[#444] group-hover:text-[var(--ultra-orange)]/60">
          — what&apos;s making up your score
        </span>
      </button>

      {open && (
        <div className="rise-in mt-3 space-y-6 rounded-sm border border-[#1a1a1a] bg-[#0a0a0a] p-4 sm:p-6">
          {/* Header row with labels */}
          <div className="hidden items-center gap-2 px-3 sm:flex sm:gap-3">
            <div className="w-36 shrink-0" />
            <div className="min-w-0 flex-1 text-center font-mono text-[8px] text-[#444]">SCORE BAR</div>
            <span className="w-8 shrink-0 text-right font-mono text-[8px] text-[#444]">RAW</span>
            <span className="w-12 shrink-0 text-right font-mono text-[8px] text-[#444]">WEIGHT</span>
            <span className="w-10 shrink-0 text-right font-mono text-[8px] text-[#444]">WTD</span>
          </div>

          {breakdown.github && (
            <PlatformSection
              title="GitHub Signals"
              subscore={breakdown.github.subscore}
              signals={breakdown.github.signals}
              meta={GITHUB_SIGNAL_META}
              platformWeight={breakdown.combined.weightsUsed.github}
            />
          )}

          {breakdown.x && (
            <PlatformSection
              title="X Signals"
              subscore={breakdown.x.subscore}
              signals={breakdown.x.signals}
              meta={X_SIGNAL_META}
              platformWeight={breakdown.combined.weightsUsed.x}
            />
          )}

          {breakdown.cross && (
            <PlatformSection
              title="Cross-Platform"
              subscore={breakdown.cross.subscore}
              signals={breakdown.cross.signals}
              meta={CROSS_SIGNAL_META}
              platformWeight={breakdown.combined.weightsUsed.cross}
            />
          )}

          {/* Combined score summary */}
          <div className="border-t border-[#1a1a1a] pt-4 text-center">
            <span className="font-mono text-[10px] text-[#444]">Combined Score: </span>
            <span className="font-mono text-sm font-bold" style={{ color: scoreColor(breakdown.combined.score) }}>
              {breakdown.combined.score}
            </span>
            <span className="font-mono text-[10px] text-[#444]"> / 100</span>
          </div>
        </div>
      )}
    </div>
  )
}
