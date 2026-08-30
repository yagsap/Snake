import type { Rng } from '../core/rng'
import type { CharStat } from '../core/storage'
import { confusablesOf, type CharTable } from '../data/scripts'
import { SPAWN } from './config'

/**
 * Choosing what to put on the board.
 *
 * Two separate jobs, deliberately kept apart: which character to *ask* for,
 * and which characters to surround it with. The first is a teaching decision
 * (ask more often about what you keep getting wrong); the second is a
 * difficulty decision (surround it with the things you actually mix it up
 * with). The prototype fused both into one function with a loop that could
 * spin forever when the pools ran dry.
 */

const statOf = (stats: Record<string, CharStat>, ch: string): CharStat =>
  stats[ch] ?? { ok: 0, err: 0 }

/**
 * Weighted target selection — a light spaced-repetition bias. Misses raise a
 * character's odds sharply, hits lower them gently, and the floor guarantees
 * even a mastered character still comes round occasionally so it does not
 * quietly rot out of the rotation.
 */
export function chooseTarget(
  table: CharTable,
  stats: Record<string, CharStat>,
  rng: Rng,
  avoid: string | null,
): string | null {
  let chars = Object.keys(table)
  if (!chars.length) return null
  // Never ask the same thing twice in a row — the answer is still on screen.
  if (avoid && chars.length > 1) chars = chars.filter((c) => c !== avoid)

  const weights = chars.map((c) => {
    const s = statOf(stats, c)
    return Math.max(
      SPAWN.floorWeight,
      1 + SPAWN.errorWeight * s.err - SPAWN.masteryWeight * s.ok,
    )
  })
  return rng.weighted(chars, weights) ?? (chars[0] as string)
}

/**
 * Distractors: confusable lookalikes first, filler after.
 *
 * Characters whose romanisation matches the target are excluded outright. In
 * "both" mode あ and ア are both a valid reading of "a", and an unwinnable
 * question teaches nothing except that the game is unfair.
 */
export function chooseDistractors(
  table: CharTable,
  target: string,
  rng: Rng,
  count: number,
): string[] {
  const targetSound = table[target]
  const eligible = (c: string) => c !== target && table[c] !== targetSound

  const lookalikes = rng.shuffle(
    confusablesOf(target).filter((c) => c in table && eligible(c)),
  )
  const chosen = lookalikes.slice(0, count)

  if (chosen.length < count) {
    const taken = new Set(chosen)
    const filler = rng.shuffle(
      Object.keys(table).filter((c) => eligible(c) && !taken.has(c)),
    )
    chosen.push(...filler.slice(0, count - chosen.length))
  }
  return chosen
}

/**
 * Free cells, as a shuffled list.
 *
 * The prototype rejection-sampled: pick a random cell, retry if occupied. That
 * is fine on an empty board and unbounded on a full one — a long snake late in
 * a run makes the retry loop take arbitrarily long, and a genuinely full board
 * hangs the tab. Enumerating and shuffling is O(cells) once, always terminates,
 * and tells the caller honestly how much room is actually left.
 */
export function freeCells(
  cells: number,
  occupied: ReadonlySet<number>,
  rng: Rng,
): number[] {
  const free: number[] = []
  const total = cells * cells
  for (let i = 0; i < total; i++) if (!occupied.has(i)) free.push(i)
  return rng.shuffle(free)
}
