import { PACE, SCORING, SPAWN } from './config'
import type { Mode } from './modes'
import type { CharStat } from '../core/storage'
import { clamp, clamp01, invLerp } from '../core/time'

/**
 * Difficulty and reward curves.
 *
 * Both are pure functions of run state. Keeping them pure means the curve can
 * be graphed, tested and re-tuned without running the game, and it makes the
 * relationship between the two explicit: the same variable that makes the game
 * harder (`eaten`) is the one the player is being paid to increase.
 */

/**
 * Seconds per move after `eaten` characters.
 *
 * Exponential approach to a floor: big early gains, forever-diminishing later.
 * The player always feels the game tightening, but it converges instead of
 * running away.
 */
export function moveInterval(eaten: number, mode: Mode): number {
  const k = PACE.rampConstant / Math.max(0.01, mode.paceScale)
  const t = Math.exp(-eaten / k)
  return PACE.minInterval + (PACE.startInterval - PACE.minInterval) * t
}

/** 0..1 progress from starting pace to the floor. Drives HUD intensity. */
export function paceProgress(interval: number): number {
  return 1 - invLerp(PACE.minInterval, PACE.startInterval, interval)
}

/**
 * Spaced repetition — the Leitner ladder, in real time.
 *
 * Each rung is how long a correct answer buys before the character is asked
 * again. The early rungs are minutes because a character met once is not
 * learned yet; the late ones are weeks because one that survived a week is.
 * A miss knocks it down a rung and brings it back almost immediately, which
 * is the whole point: the app should spend its time on what you are about to
 * forget, not on what you already know.
 */
const BOXES_MS = [
  10 * 60_000, // 10 minutes — same session
  24 * 3_600_000, // 1 day
  3 * 24 * 3_600_000,
  7 * 24 * 3_600_000,
  21 * 24 * 3_600_000,
  60 * 24 * 3_600_000,
] as const

/** Rung a character must survive to count as mastered — a multi-day gap. */
const MASTERY_BOX = 3

/** Promote after a correct answer: up a rung, next review pushed out. */
export function promote(s: CharStat, now: number): void {
  s.box = Math.min(BOXES_MS.length - 1, (s.box ?? -1) + 1)
  s.due = now + (BOXES_MS[s.box] as number)
}

/** Demote after a miss: down a rung, back within the session. */
export function demote(s: CharStat, now: number): void {
  s.box = Math.max(0, (s.box ?? 1) - 1)
  s.due = now + 60_000
}

/** Seed a character the player says they already know, without pretending
 *  they proved it here — one rung below mastery, due in a day. */
export function seedKnown(s: CharStat, now: number): void {
  s.box = MASTERY_BOX - 1
  s.due = now + BOXES_MS[MASTERY_BOX - 1]!
}

/** Is this character due for review? Never-seen characters are always due. */
export function isDue(s: CharStat | undefined, now: number): boolean {
  return !s || s.due === undefined || s.due <= now
}

/** How overdue, in ms. Negative means not yet due. Drives review ordering. */
export function overdueBy(s: CharStat | undefined, now: number): number {
  if (!s || s.due === undefined) return Number.MAX_SAFE_INTEGER
  return now - s.due
}

/**
 * Mastery, in ONE place — the chart, the mid-run celebration and the run
 * receipt must never disagree about what "mastered" means.
 *
 * A character is mastered after `masteredAt` correct bites AND three correct
 * bites for every miss. The second clause is the redemption arc: the old rule
 * (any miss disqualifies forever) meant the characters a learner most
 * struggled with — which are exactly the ones the game exists for — could
 * never be celebrated, no matter how solid they became.
 */
export function isMastered(s: CharStat): boolean {
  // The box is the honest test: reaching MASTERY_BOX means the character was
  // recalled correctly after days away, not three times inside one lucky run.
  // The hit-count rule stays as the floor for saves that predate scheduling.
  if (s.box !== undefined) return s.box >= MASTERY_BOX
  return s.ok >= SPAWN.masteredAt && s.ok >= s.err * 3
}

/** Correct bites still needed before `isMastered` flips. 0 when it has. */
export function hitsToMaster(s: CharStat): number {
  return Math.max(0, SPAWN.masteredAt - s.ok, s.err * 3 - s.ok)
}

/** Score multiplier from the current streak of correct bites. */
export function comboMultiplier(streak: number): number {
  return clamp(
    1 + Math.floor(streak / SCORING.comboStep),
    1,
    SCORING.maxMultiplier,
  )
}

/** Correct bites still needed to reach the next multiplier, or 0 at the cap. */
export function untilNextMultiplier(streak: number): number {
  if (comboMultiplier(streak) >= SCORING.maxMultiplier) return 0
  return SCORING.comboStep - (streak % SCORING.comboStep)
}

/**
 * How much of the speed bonus survives, given how long this target has been
 * on the board. Full value inside the window, then a linear fade.
 */
export function speedBonusFactor(targetAge: number): number {
  if (targetAge <= SCORING.bonusWindow) return 1
  return clamp01(1 - (targetAge - SCORING.bonusWindow) / SCORING.bonusFade)
}

export interface Award {
  readonly points: number
  readonly multiplier: number
  readonly speedBonus: number
}

/** Points for one correct bite, broken down so the HUD can explain itself. */
export function awardFor(
  streak: number,
  targetAge: number,
  mode: Mode,
): Award {
  const multiplier = comboMultiplier(streak)
  const speedBonus = Math.round(
    SCORING.maxSpeedBonus * speedBonusFactor(targetAge),
  )
  const points = Math.round(
    (SCORING.base * multiplier + speedBonus) * mode.scoreScale,
  )
  return { points, multiplier, speedBonus }
}
