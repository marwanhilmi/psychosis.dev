import { type RefObject, useState, useCallback, useEffect } from 'react'
import { toBlob } from 'html-to-image'

interface ShareButtonsProps {
  shareText: string
  shareUrl: string
  ogImageUrl?: string
  captureRef?: RefObject<HTMLElement | null>
}

export function ShareButtons({ shareText, shareUrl, ogImageUrl, captureRef }: ShareButtonsProps) {
  const [copied, setCopied] = useState<'link' | 'image' | null>(null)

  const handleShareX = useCallback(() => {
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank')
  }, [shareText])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied('link')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = shareUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied('link')
      setTimeout(() => setCopied(null), 2000)
    }
  }, [shareUrl])

  const handleCopyImage = useCallback(async () => {
    try {
      let blob: Blob | null = null

      // Capture from DOM if ref provided
      if (captureRef?.current) {
        blob = await toBlob(captureRef.current, {
          pixelRatio: 2,
          backgroundColor: '#0a0a0a',
        })
      }

      // Fallback: fetch OG image
      if (!blob && ogImageUrl) {
        const res = await fetch(ogImageUrl)
        blob = await res.blob()
      }

      if (!blob) return

      // Try clipboard API (Chrome/Edge)
      if (navigator.clipboard && 'write' in navigator.clipboard) {
        // Clipboard API requires image/png
        const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
        setCopied('image')
        setTimeout(() => setCopied(null), 2000)
      } else {
        // Fallback: trigger download
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'psychosismeter.png'
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {
      // Last resort: download from OG URL
      if (ogImageUrl) {
        const a = document.createElement('a')
        a.href = ogImageUrl
        a.download = 'psychosismeter.png'
        a.click()
      }
    }
  }, [captureRef, ogImageUrl])

  const showCopyImage = !!(captureRef || ogImageUrl)
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: 'PSYCHOSISMETER',
        text: shareText,
        url: shareUrl,
      })
    } catch {
      // User cancelled or share failed — no action needed
    }
  }, [shareText, shareUrl])

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      {/* Share on X */}
      <button
        onClick={handleShareX}
        className="flex items-center gap-2 whitespace-nowrap rounded-sm border-2 border-[var(--ultra-orange)] bg-[var(--ultra-orange)] px-4 py-2.5 font-mono text-sm font-bold tracking-wider text-black uppercase transition-all hover:bg-[var(--ultra-orange-dim)] hover:shadow-[0_0_30px_rgba(255,79,0,0.3)] sm:px-6"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share
      </button>

      {/* Copy Link */}
      <button
        onClick={handleCopyLink}
        className="flex items-center gap-2 whitespace-nowrap rounded-sm border-2 border-[#333] px-4 py-2.5 font-mono text-sm font-bold tracking-wider text-[#888] uppercase transition-all hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)] sm:px-6"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {copied === 'link' ? 'Copied!' : 'Copy Link'}
      </button>

      {/* Copy Image */}
      {showCopyImage && (
        <button
          onClick={handleCopyImage}
          className="flex items-center gap-2 whitespace-nowrap rounded-sm border-2 border-[#333] px-4 py-2.5 font-mono text-sm font-bold tracking-wider text-[#888] uppercase transition-all hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)] sm:px-6"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copied === 'image' ? 'Copied!' : 'Copy Image'}
        </button>
      )}

      {/* Native Share */}
      {canNativeShare && (
        <button
          onClick={handleNativeShare}
          className="flex items-center justify-center rounded-sm border-2 border-[#333] px-3 py-2.5 text-[#888] transition-all hover:border-[var(--ultra-orange)] hover:text-[var(--ultra-orange)]"
          title="Share"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
    </div>
  )
}

async function convertToPng(blob: Blob): Promise<Blob> {
  const img = new Image()
  const url = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  URL.revokeObjectURL(url)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}
