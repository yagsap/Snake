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
