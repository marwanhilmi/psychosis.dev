export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

export function shannonEntropy(distribution: number[]): number {
  const total = distribution.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  const probs = distribution.map((value) => value / total).filter((value) => value > 0)
  return -probs.reduce((sum, value) => sum + value * Math.log2(value), 0)
}

export function computeWeightedAverage(total: number, count: number): number {
  return count > 0 ? total / count : 0
}

export function getTrigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '')
  const trigrams = new Set<string>()

  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.substring(i, i + 3))
  }

  return trigrams
}

export function trigramJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const trigram of a) {
    if (b.has(trigram)) intersection++
  }

  return intersection / (a.size + b.size - intersection)
}
