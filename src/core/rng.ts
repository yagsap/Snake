/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Math.random() cannot be seeded, which means a run can never be reproduced.
 * That matters for more than replays: when a spawn looks wrong or a difficulty
 * ramp feels off, being able to replay the exact sequence is the difference
 * between debugging and guessing. Every random decision in the game goes
 * through an Rng instance; none call Math.random directly.
 */
export class Rng {
  private state: number

  constructor(seed: number = (Date.now() ^ 0x9e3779b9) >>> 0) {
    this.seed = seed
    this.state = seed >>> 0
  }

  /** The seed this generator was created with, for logging or replay. */
  readonly seed: number

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }

  /** A random element, or undefined for an empty array. */
  pick<T>(arr: readonly T[]): T | undefined {
    return arr.length ? arr[this.int(arr.length)] : undefined
  }

  /** In-place Fisher-Yates. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const a = arr[i] as T
      const b = arr[j] as T
      arr[i] = b
      arr[j] = a
    }
    return arr
  }

  /**
   * Weighted pick. Weights must be non-negative and the same length as items.
   * Falls back to the last item if floating-point drift undershoots.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T | undefined {
    if (!items.length) return undefined
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return this.pick(items)
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0)
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }
}
