export default function HomeOG() {
  return (
    <div
      tw="flex flex-col items-center justify-center w-full h-full"
      style={{
        background: 'radial-gradient(ellipse at center, #1a1000 0%, #0a0a0a 70%)',
        fontFamily: 'monospace',
      }}
    >
      {/* Eye motif */}
      <div tw="flex items-center justify-center mb-6">
        <svg width="160" height="100" viewBox="0 0 80 50">
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

      {/* Title */}
      <div tw="flex items-baseline">
        <div tw="text-7xl font-bold tracking-tight text-white">PSYCHOSIS</div>
        <div tw="text-7xl font-bold tracking-tight text-[#ff4f00]">METER</div>
      </div>

      {/* Tagline */}
      <div tw="text-2xl text-[#777] mt-4 tracking-wider">How cooked is your digital brain?</div>

      {/* Subtitle */}
      <div tw="text-lg text-[#444] mt-6 tracking-widest">LLM PSYCHOSIS DETECTION ALGORITHM</div>
    </div>
  )
}
