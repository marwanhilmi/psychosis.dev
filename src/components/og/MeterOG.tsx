const ZONES = [
  { label: 'SANE', from: 0, to: 20, color: '#2d6e2d' },
  { label: 'QUIRKY', from: 20, to: 40, color: '#8b6914' },
  { label: 'UNHINGED', from: 40, to: 60, color: '#cc7700' },
  { label: 'DERANGED', from: 60, to: 80, color: '#cc3f00' },
  { label: 'FULL PSYCHOSIS', from: 80, to: 100, color: '#d42020' },
] as const

// ── SVG geometry helpers (matches PsychosisMeter.tsx) ──────────────────────

const SWEEP = 100
const HALF_SWEEP = SWEEP / 2

function valueToAngle(value: number): number {
  const clamped = Math.max(0, Math.min(100, value))
  return -HALF_SWEEP + (clamped / 100) * SWEEP
}

function toXY(px: number, py: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: px + r * Math.sin(rad), y: py - r * Math.cos(rad) }
}

function arcPath(px: number, py: number, r: number, startDeg: number, endDeg: number) {
  const s = toXY(px, py, r, startDeg)
  const e = toXY(px, py, r, endDeg)
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`
}

// ── Build the meter SVG string (shapes only, no <text>) ───────────────────

function buildMeterSvg(score: number): string {
  const W = 480
  const H = 380
  const bezelR = 12
  const faceTop = 18
  const faceBottom = 240
  const faceLeft = 18
  const faceRight = W - 18
  const panelTop = faceBottom
  const panelBottom = H - 18
  const px = W / 2
  const py = faceBottom - 10
  const arcR = 175
  const tickOuter = arcR
  const needleAngle = valueToAngle(score)
  const adjY = panelTop + (panelBottom - panelTop) / 2 + 4
  const screws = [
    [faceLeft + 22, panelTop + (panelBottom - panelTop) / 2],
    [faceRight - 22, panelTop + (panelBottom - panelTop) / 2],
  ]

  // Tick marks
  const tickLines: string[] = []
  for (let i = 0; i <= 50; i++) {
    const val = i * 2
    const angle = valueToAngle(val)
    const isMajor = val % 20 === 0
    const isMid = val % 10 === 0
    const len = isMajor ? 16 : isMid ? 10 : 5
    const p1 = toXY(px, py, tickOuter, angle)
    const p2 = toXY(px, py, tickOuter - len, angle)
    const sw = isMajor ? 1.8 : isMid ? 1.2 : 0.6
    tickLines.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#1a1a1a" stroke-width="${sw}"/>`)
  }

  // Color bands
  const bands = ZONES.map(
    (z) =>
      `<path d="${arcPath(px, py, arcR - 12, valueToAngle(z.from), valueToAngle(z.to))}" fill="none" stroke="${z.color}" stroke-width="14" opacity="0.65"/>`,
  ).join('')

  // Panel ridges
  const ridgeLines: string[] = []
  for (let i = 0; i < 20; i++) {
    const y = panelTop + 12 + i * 5.5
    if (y <= panelBottom - 12) {
      ridgeLines.push(
        `<line x1="${faceLeft + 20}" y1="${y}" x2="${faceRight - 20}" y2="${y}" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>`,
      )
    }
  }

  // Screws
  const screwSvg = screws
    .map(
      ([sx, sy]) => `
    <circle cx="${sx}" cy="${sy}" r="7" fill="url(#screw-grad)" stroke="#666" stroke-width="0.8"/>
    <line x1="${sx - 3.5}" y1="${sy}" x2="${sx + 3.5}" y2="${sy}" stroke="#555" stroke-width="1"/>
    <line x1="${sx}" y1="${sy - 3.5}" x2="${sx}" y2="${sy + 3.5}" stroke="#555" stroke-width="1"/>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bezel-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a3a3a"/><stop offset="20%" stop-color="#2a2a2a"/>
      <stop offset="80%" stop-color="#1a1a1a"/><stop offset="100%" stop-color="#222"/>
    </linearGradient>
    <linearGradient id="face-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#faf8f2"/><stop offset="100%" stop-color="#f0ebe0"/>
    </linearGradient>
    <linearGradient id="panel-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d8d3c8"/><stop offset="100%" stop-color="#c8c3b8"/>
    </linearGradient>
    <radialGradient id="screw-grad" cx="40%" cy="35%">
      <stop offset="0%" stop-color="#aaa"/><stop offset="60%" stop-color="#777"/><stop offset="100%" stop-color="#555"/>
    </radialGradient>
  </defs>

  <!-- Outer bezel -->
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="${bezelR + 4}" fill="url(#bezel-fill)" stroke="#111" stroke-width="2"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="${bezelR + 2}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- White face -->
  <rect x="${faceLeft}" y="${faceTop}" width="${faceRight - faceLeft}" height="${faceBottom - faceTop}" rx="4" fill="url(#face-fill)"/>
  <rect x="${faceLeft}" y="${faceTop}" width="${faceRight - faceLeft}" height="${faceBottom - faceTop}" rx="4" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>

  <!-- Color bands -->
  ${bands}

  <!-- Scale arc -->
  <path d="${arcPath(px, py, arcR, -HALF_SWEEP, HALF_SWEEP)}" fill="none" stroke="#1a1a1a" stroke-width="1.5"/>

  <!-- Tick marks -->
  ${tickLines.join('\n  ')}

  <!-- Needle -->
  <g transform="rotate(${needleAngle}, ${px}, ${py})">
    <line x1="${px}" y1="${py + 12}" x2="${px}" y2="${py - arcR + 22}" stroke="#cc1111" stroke-width="1.8"/>
    <polygon points="${px},${py - arcR + 20} ${px - 2.5},${py - arcR + 40} ${px + 2.5},${py - arcR + 40}" fill="#cc1111"/>
    <line x1="${px}" y1="${py}" x2="${px}" y2="${py + 12}" stroke="#333" stroke-width="3"/>
  </g>

  <!-- Pivot -->
  <circle cx="${px}" cy="${py}" r="8" fill="#222" stroke="#444" stroke-width="1.5"/>
  <circle cx="${px}" cy="${py}" r="3" fill="#111"/>

  <!-- Lower panel -->
  <rect x="${faceLeft}" y="${panelTop}" width="${faceRight - faceLeft}" height="${panelBottom - panelTop}" rx="4" fill="url(#panel-fill)"/>
  ${ridgeLines.join('\n  ')}
  <rect x="${faceLeft}" y="${panelTop}" width="${faceRight - faceLeft}" height="${panelBottom - panelTop}" rx="4" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>
  <line x1="${faceLeft}" y1="${panelTop}" x2="${faceRight}" y2="${panelTop}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>

  <!-- Screws -->
  ${screwSvg}

  <!-- Adjustment hole -->
  <circle cx="${px}" cy="${adjY}" r="6" fill="#222" stroke="#444" stroke-width="1"/>
  <line x1="${px - 3}" y1="${adjY}" x2="${px + 3}" y2="${adjY}" stroke="#666" stroke-width="1.5"/>
</svg>`
}

function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
  return `data:image/svg+xml;base64,${btoa(encoded)}`
}

function truncateAfterSecondSentence(text: string): string {
  const sentenceEnd = /[.!?]/g
  let count = 0
  let match: RegExpExecArray | null
  while ((match = sentenceEnd.exec(text)) !== null) {
    count++
    if (count === 2) return text.slice(0, match.index + 1)
  }
  return text
}

// ── OG component ───────────────────────────────────────────────────────────

function getZone(score: number) {
  return ZONES.find((z) => score >= z.from && score < z.to) ?? ZONES[ZONES.length - 1]
}

interface MeterOGProps {
  username: string
  score: number
  zone: string
  diagnosis?: string | null
}

export default function MeterOG({ username, score, zone, diagnosis }: MeterOGProps) {
  const zoneData = getZone(score)
  const meterDataUrl = svgToDataUrl(buildMeterSvg(score))

  return (
    <div
      tw="flex flex-col w-full h-full p-16"
      style={{
        background: 'radial-gradient(ellipse at bottom, #1a1000 0%, #0a0a0a 60%)',
        fontFamily: 'monospace',
      }}
    >
      {/* Top bar: eye + branding */}
      <div tw="flex items-center justify-between mb-6">
        <div tw="flex items-center gap-4">
          <svg width="48" height="30" viewBox="0 0 80 50">
            <path d="M5 25 Q40 -8 75 25 Q40 58 5 25Z" fill="none" stroke="#ff4f00" strokeWidth="3" />
            <circle cx="40" cy="25" r="12" fill="none" stroke="#ff4f00" strokeWidth="2.5" />
            <circle cx="40" cy="25" r="5" fill="#ff4f00" />
          </svg>
          <div tw="flex items-baseline">
            <div tw="text-2xl font-bold text-white tracking-tight">PSYCHOSIS</div>
            <div tw="text-2xl font-bold text-[#ff4f00] tracking-tight">METER</div>
          </div>
        </div>
        <div tw="text-lg text-[#444] tracking-widest uppercase">LLM Psychosis Detection</div>
      </div>

      {/* Main content: meter + info */}
      <div tw="flex items-center justify-center flex-1" style={{ gap: 48 }}>
        {/* Left: meter image + scale labels */}
        <div tw="flex flex-col items-center" style={{ width: 480 }}>
          <img src={meterDataUrl} width={480} height={380} alt="Psychosis meter" />

          {/* Scale bar + numbers rendered in JSX (SVG text doesn't render in data URL) */}
          <div tw="flex w-full mt-2" style={{ paddingLeft: 18, paddingRight: 18 }}>
            {ZONES.map((z) => (
              <div key={z.label} tw="flex flex-col items-center" style={{ flex: 1 }}>
                <div tw="flex w-full" style={{ height: 6, background: z.color, opacity: 0.7 }} />
                <div tw="text-xs mt-1 tracking-wider uppercase" style={{ color: z.color, fontSize: 9 }}>
                  {z.label === 'FULL PSYCHOSIS' ? 'PSYCHOSIS' : z.label}
                </div>
              </div>
            ))}
          </div>
          <div tw="flex w-full justify-between mt-1" style={{ paddingLeft: 18, paddingRight: 18 }}>
            {[0, 20, 40, 60, 80, 100].map((v) => (
              <div key={v} tw="text-xs text-[#666]">
                {v}
              </div>
            ))}
          </div>
        </div>

        {/* Right: username + score + diagnosis */}
        <div tw="flex flex-col" style={{ maxWidth: 500, gap: 16 }}>
          <div tw="text-5xl font-bold text-white">{username}</div>

          {/* Score + zone badge */}
          <div tw="flex items-center" style={{ gap: 16 }}>
            <div tw="text-7xl font-bold" style={{ color: zoneData.color }}>
              {score}
            </div>
            <div
              tw="px-5 py-2 text-xl font-bold tracking-widest uppercase"
              style={{
                color: zoneData.color,
                border: `3px solid ${zoneData.color}`,
                background: `${zoneData.color}15`,
              }}
            >
              {zone.replace('_', ' ')}
            </div>
          </div>

          {/* Diagnosis */}
          {diagnosis && (
            <div
              tw="flex mt-2 px-5 py-4"
              style={{ borderLeft: `4px solid ${zoneData.color}`, background: '#141414', borderRadius: 4 }}
            >
              <div tw="text-base text-[#aaa] leading-relaxed">{truncateAfterSecondSentence(diagnosis)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
