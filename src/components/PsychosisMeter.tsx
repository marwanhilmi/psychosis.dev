import { useEffect, useRef, useState } from 'react'

const ZONES = [
  { label: 'SANE', from: 0, to: 20, color: '#2d6e2d' },
  { label: 'QUIRKY', from: 20, to: 40, color: '#8b6914' },
  { label: 'UNHINGED', from: 40, to: 60, color: '#cc7700' },
  { label: 'DERANGED', from: 60, to: 80, color: '#cc3f00' },
  { label: 'FULL PSYCHOSIS', from: 80, to: 100, color: '#d42020' },
] as const

const SWEEP = 100 // total degrees of arc sweep
const HALF_SWEEP = SWEEP / 2

/** Map 0-100 to needle angle: -50 to +50 degrees from vertical */
function valueToAngle(value: number): number {
  const clamped = Math.max(0, Math.min(100, value))
  return -HALF_SWEEP + (clamped / 100) * SWEEP
}

/**
 * Convert polar to cartesian where 0deg = straight up, positive = clockwise.
 * Origin at (px, py), radius r.
 */
function toXY(px: number, py: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: px + r * Math.sin(rad),
    y: py - r * Math.cos(rad),
  }
}

/** SVG arc path from startAngle to endAngle (our coordinate system) */
function arcPath(px: number, py: number, r: number, startDeg: number, endDeg: number) {
  const s = toXY(px, py, r, startDeg)
  const e = toXY(px, py, r, endDeg)
  const sweep = endDeg - startDeg
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`
}

interface PsychosisMeterProps {
  value: number
  sublabel?: string
  animate?: boolean
  username?: string
}

export function PsychosisMeter({ value, sublabel, animate = true, username }: PsychosisMeterProps) {
  const [displayValue, setDisplayValue] = useState(animate ? 0 : value)
  const [needleAngle, setNeedleAngle] = useState(animate ? -HALF_SWEEP : valueToAngle(value))
  const rafRef = useRef<number>(0)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!animate) {
      setDisplayValue(value)
      setNeedleAngle(valueToAngle(value))
      return
    }

    const duration = 2400
    const startVal = 0
    const endVal = value
    const startA = -HALF_SWEEP
    const endA = valueToAngle(value)

    startRef.current = 0

    function tick(timestamp: number) {
      if (!startRef.current) startRef.current = timestamp
      const elapsed = timestamp - startRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Mechanical overshoot bounce
      const eased = progress < 1 ? 1 - Math.pow(1 - progress, 3) * Math.cos(progress * Math.PI * 1.2) : 1

      setDisplayValue(Math.round(startVal + (endVal - startVal) * eased))
      setNeedleAngle(startA + (endA - startA) * eased)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, animate])

  // Geometry — rectangular meter, landscape
  const W = 480
  const H = 380
  const bezelR = 12
  const faceTop = 18
  const faceBottom = 240
  const faceLeft = 18
  const faceRight = W - 18
  const panelTop = faceBottom
  const panelBottom = H - 18

  // Pivot point — bottom center of face
  const px = W / 2
  const py = faceBottom - 10
  const arcR = 175 // radius of the main scale arc
  const tickOuter = arcR
  const numberR = arcR + 18

  const currentZone = ZONES.find((z) => displayValue >= z.from && displayValue < z.to) ?? ZONES[ZONES.length - 1]

  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ filter: 'drop-shadow(0 8px 30px rgba(0,0,0,0.5))' }}>
        <defs>
          {/* Subtle noise for vintage paper feel */}
          <filter id="paper-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" />
            <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
            <feBlend in="SourceGraphic" in2="gray" mode="multiply" result="blend" />
            <feComponentTransfer in="blend">
              <feFuncA type="linear" slope="1" />
            </feComponentTransfer>
          </filter>

          {/* Inner shadow for recessed face */}
          <filter id="face-inset" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="blur" />
            <feOffset dx="0" dy="3" result="off" />
            <feFlood floodColor="#000" floodOpacity="0.15" result="color" />
            <feComposite in="color" in2="off" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="shadow" />
            </feMerge>
          </filter>

          {/* Bezel gradient — brushed metal */}
          <linearGradient id="bezel-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="20%" stopColor="#2a2a2a" />
            <stop offset="80%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#222" />
          </linearGradient>

          {/* Face gradient — warm off-white */}
          <linearGradient id="face-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#faf8f2" />
            <stop offset="100%" stopColor="#f0ebe0" />
          </linearGradient>

          {/* Panel texture gradient */}
          <linearGradient id="panel-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d8d3c8" />
            <stop offset="100%" stopColor="#c8c3b8" />
          </linearGradient>

          {/* Screw gradient */}
          <radialGradient id="screw-grad" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#aaa" />
            <stop offset="60%" stopColor="#777" />
            <stop offset="100%" stopColor="#555" />
          </radialGradient>

          {/* Needle shadow */}
          <filter id="needle-shadow">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur" />
            <feOffset dx="1" dy="2" result="off" />
            <feFlood floodColor="#000" floodOpacity="0.25" result="color" />
            <feComposite in="color" in2="off" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* === OUTER BEZEL === */}
        <rect
          x="4"
          y="4"
          width={W - 8}
          height={H - 8}
          rx={bezelR + 4}
          fill="url(#bezel-fill)"
          stroke="#111"
          strokeWidth="2"
        />
        {/* Bezel highlight */}
        <rect
          x="6"
          y="6"
          width={W - 12}
          height={H - 12}
          rx={bezelR + 2}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />

        {/* === WHITE FACE === */}
        <rect
          x={faceLeft}
          y={faceTop}
          width={faceRight - faceLeft}
          height={faceBottom - faceTop}
          rx="4"
          fill="url(#face-fill)"
          filter="url(#face-inset)"
        />
        {/* Thin border around face */}
        <rect
          x={faceLeft}
          y={faceTop}
          width={faceRight - faceLeft}
          height={faceBottom - faceTop}
          rx="4"
          fill="none"
          stroke="rgba(0,0,0,0.1)"
          strokeWidth="0.5"
        />

        {/* === COLOR BANDS for each zone === */}
        {ZONES.map((zone) => (
          <path
            key={zone.label}
            d={arcPath(px, py, arcR - 12, valueToAngle(zone.from), valueToAngle(zone.to))}
            fill="none"
            stroke={zone.color}
            strokeWidth="14"
            opacity="0.65"
          />
        ))}

        {/* === SCALE ARC (thin black line on top) === */}
        <path d={arcPath(px, py, arcR, -HALF_SWEEP, HALF_SWEEP)} fill="none" stroke="#1a1a1a" strokeWidth="1.5" />

        {/* === TICK MARKS === */}
        {Array.from({ length: 51 }).map((_, i) => {
          const val = i * 2
          const angle = valueToAngle(val)
          const isMajor = val % 20 === 0
          const isMid = val % 10 === 0
          const len = isMajor ? 16 : isMid ? 10 : 5
          const p1 = toXY(px, py, tickOuter, angle)
          const p2 = toXY(px, py, tickOuter - len, angle)

          return (
            <line
              key={val}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#1a1a1a"
              strokeWidth={isMajor ? 1.8 : isMid ? 1.2 : 0.6}
            />
          )
        })}

        {/* === NUMBERS === */}
        {[0, 20, 40, 60, 80, 100].map((val) => {
          const angle = valueToAngle(val)
          const pos = toXY(px, py, numberR, angle)
          return (
            <text
              key={val}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#1a1a1a"
              fontSize="20"
              fontFamily="'Times New Roman', 'Georgia', serif"
              fontWeight="400"
            >
              {val}
            </text>
          )
        })}

        {/* === CENTER LABEL === */}
        <text
          x={px}
          y={py - 55}
          textAnchor="middle"
          fill="#1a1a1a"
          fontSize="16"
          fontFamily="'Times New Roman', 'Georgia', serif"
          fontWeight="700"
          textDecoration="underline"
          letterSpacing="0.05em"
        >
          {'P'}
        </text>
        {/* "P" for Psychosis — like "V" for Volts in the reference */}
        <text
          x={px}
          y={py - 30}
          textAnchor="middle"
          fill="#1a1a1a"
          fontSize="9"
          fontFamily="'Space Mono', monospace"
          letterSpacing="0.1em"
        >
          LLM PSYCHOSIS
        </text>

        {/* === NEEDLE === */}
        <g
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transformOrigin: `${px}px ${py}px`,
          }}
          filter="url(#needle-shadow)"
        >
          {/* Needle body — thin red line like the reference */}
          <line x1={px} y1={py + 12} x2={px} y2={py - arcR + 22} stroke="#cc1111" strokeWidth="1.8" />
          {/* Needle tip — slightly wider */}
          <polygon
            points={`${px},${py - arcR + 20} ${px - 2.5},${py - arcR + 40} ${px + 2.5},${py - arcR + 40}`}
            fill="#cc1111"
          />
          {/* Counter-weight (back of needle) */}
          <line x1={px} y1={py} x2={px} y2={py + 12} stroke="#333" strokeWidth="3" />
        </g>

        {/* === PIVOT CIRCLE === */}
        <circle cx={px} cy={py} r="8" fill="#222" stroke="#444" strokeWidth="1.5" />
        <circle cx={px} cy={py} r="3" fill="#111" />

        {/* === TEXTURED LOWER PANEL === */}
        <rect
          x={faceLeft}
          y={panelTop}
          width={faceRight - faceLeft}
          height={panelBottom - panelTop}
          rx="4"
          fill="url(#panel-fill)"
        />
        {/* Horizontal ridges / grooves — like the reference */}
        {Array.from({ length: 20 }).map((_, idx) => {
          const y = panelTop + 12 + idx * 5.5
          if (y > panelBottom - 12) return null
          return (
            <line
              key={y}
              x1={faceLeft + 20}
              y1={y}
              x2={faceRight - 20}
              y2={y}
              stroke="rgba(0,0,0,0.12)"
              strokeWidth="1"
            />
          )
        })}
        {/* Panel border */}
        <rect
          x={faceLeft}
          y={panelTop}
          width={faceRight - faceLeft}
          height={panelBottom - panelTop}
          rx="4"
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          strokeWidth="0.5"
        />

        {/* Dividing line between face and panel */}
        <line x1={faceLeft} y1={panelTop} x2={faceRight} y2={panelTop} stroke="rgba(0,0,0,0.2)" strokeWidth="1" />

        {/* === SCREWS === */}
        {[
          [faceLeft + 22, panelTop + (panelBottom - panelTop) / 2],
          [faceRight - 22, panelTop + (panelBottom - panelTop) / 2],
        ].map(([sx, sy]) => (
          <g key={`${sx}-${sy}`}>
            <circle cx={sx} cy={sy} r="7" fill="url(#screw-grad)" stroke="#666" strokeWidth="0.8" />
            {/* Phillips cross */}
            <line x1={sx - 3.5} y1={sy} x2={sx + 3.5} y2={sy} stroke="#555" strokeWidth="1" />
            <line x1={sx} y1={sy - 3.5} x2={sx} y2={sy + 3.5} stroke="#555" strokeWidth="1" />
          </g>
        ))}

        {/* === ADJUSTMENT HOLE (center of panel) === */}
        <circle
          cx={px}
          cy={panelTop + (panelBottom - panelTop) / 2 + 4}
          r="6"
          fill="#222"
          stroke="#444"
          strokeWidth="1"
        />
        <line
          x1={px - 3}
          y1={panelTop + (panelBottom - panelTop) / 2 + 4}
          x2={px + 3}
          y2={panelTop + (panelBottom - panelTop) / 2 + 4}
          stroke="#666"
          strokeWidth="1.5"
        />

        {/* === USERNAME in lower panel === */}
        {username && (
          <text
            x={px}
            y={panelBottom - 16}
            textAnchor="middle"
            fill="#1a1a1a"
            fontSize="16"
            fontFamily="'Space Mono', monospace"
            fontWeight="700"
            letterSpacing="0.05em"
          >
            {username}
          </text>
        )}

        {/* === BOTTOM LABELS (like "GME PM89" and "CLASS 2.5") === */}
        <text
          x={faceLeft + 50}
          y={faceBottom - 14}
          textAnchor="start"
          fill="#555"
          fontSize="9"
          fontFamily="'Space Mono', monospace"
          letterSpacing="0.08em"
        >
          PSYCHOSISMETER PM-69
        </text>
        <text
          x={faceRight - 50}
          y={faceBottom - 14}
          textAnchor="end"
          fill="#555"
          fontSize="9"
          fontFamily="'Space Mono', monospace"
          letterSpacing="0.08em"
        >
          {'CLASS \u221E \u2126'}
        </text>
      </svg>

      {/* Sublabel */}
      {sublabel && (
        <p className="mt-3 text-center font-mono text-xs tracking-[0.15em] text-[#666] uppercase">{sublabel}</p>
      )}

      {/* Zone badge */}
      <div className="mt-4 flex justify-center">
        <span
          className="rounded-sm px-4 py-1.5 font-mono text-sm font-bold tracking-widest uppercase"
          style={{
            color: currentZone.color,
            border: `2px solid ${currentZone.color}`,
            background: `${currentZone.color}15`,
          }}
        >
          {currentZone.label}
        </span>
      </div>
    </div>
  )
}
