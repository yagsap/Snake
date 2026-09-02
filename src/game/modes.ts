/**
 * Game modes.
 *
 * The board always wraps. Lethal edges were once a third mode and the rule on
 * every boss level, and they were removed: they are a difficulty axis that has
 * nothing to do with reading a character. Dying to the border punishes a
 * steering slip, and it did so hardest on exactly the levels built from the
 * shapes a learner most often confuses — so the levels that most needed
 * attention on the glyphs were the ones spending it on the wall instead.
 *
 * What is left is the axis that IS the game: pace. `gale` ramps the speed
 * twice as fast, which shortens the time you have to recognise a character
 * without adding a second way to lose.
 */
export type ModeId = 'drift' | 'gale'

export interface Mode {
  readonly id: ModeId
  readonly label: string
  /** One line shown under the mode picker. */
  readonly blurb: string
  /** Multiplier on the pace ramp. >1 tightens the interval faster. */
  readonly paceScale: number
  /** Multiplier on points earned, to pay for the added risk. */
  readonly scoreScale: number
}

export const MODES: Readonly<Record<ModeId, Mode>> = {
  drift: {
    id: 'drift',
    label: 'drift',
    blurb: 'the steady pace · learn without dying',
    paceScale: 1,
    scoreScale: 1,
  },
  gale: {
    id: 'gale',
    label: 'gale',
    blurb: 'speeds up twice as fast',
    paceScale: 2,
    scoreScale: 2,
  },
}

export const MODE_IDS = Object.keys(MODES) as ModeId[]

export const isModeId = (v: unknown): v is ModeId =>
  typeof v === 'string' && v in MODES
