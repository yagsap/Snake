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

/** How many distractor slots the player's own confusion history may claim. */
const PERSONAL_CAP = 2

/**
 * Distractors: the player's OWN confusions first, static lookalikes second,
 * filler after.
 *
 * The static CONFUSE table is a guess about which characters look alike to
 * everyone; the stats' confusion matrix is a record of which characters look
 * alike to YOU. Ranking your recorded mix-ups first (counting both
 * directions of a pair — biting さ when asked for き and biting き when
 * asked for さ are the same confusion) turns every question about a shaky
 * character into targeted discrimination practice. Capped at PERSONAL_CAP
 * slots: a board made entirely of nemeses is a wall, not a lesson — the
 * remaining slots keep the static lookalikes and honest filler in play.
 *
 * Characters whose romanisation matches the target are excluded outright. In
 * "both" mode あ and ア are both a valid reading of "a", and an unwinnable
 * question teaches nothing except that the game is unfair.
 */
export function chooseDistractors(
  table: CharTable,
  target: string,
  stats: Record<string, CharStat>,
  rng: Rng,
  count: number,
): string[] {
  const targetSound = table[target]
  const eligible = (c: string) => c !== target && table[c] !== targetSound

  const confusion = new Map<string, number>()
  const mine = stats[target]?.confused
  if (mine) {
    for (const [c, n] of Object.entries(mine)) {
      if (c in table && eligible(c)) confusion.set(c, n)
    }
  }
  for (const c of Object.keys(table)) {
    const n = stats[c]?.confused?.[target]
    if (n && eligible(c)) confusion.set(c, (confusion.get(c) ?? 0) + n)
  }
  const personal = [...confusion.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(PERSONAL_CAP, count))
    .map(([c]) => c)

  const chosen = [...personal]
  const taken0 = new Set(chosen)
  const lookalikes = rng.shuffle(
    confusablesOf(target).filter(
      (c) => c in table && eligible(c) && !taken0.has(c),
    ),
  )
  chosen.push(...lookalikes.slice(0, count - chosen.length))

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
