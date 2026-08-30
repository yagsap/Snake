/**
 * Game modes.
 *
 * The prototype had exactly one rule set: walls always wrap. Wrapping is
 * forgiving — there is no such thing as a fatal edge, so the only pressure is
 * your own tail, and the board's border is decoration. Making the edge lethal
 * changes the shape of every decision on the board without changing a single
 * line of the learning mechanic, which is the cheapest real difficulty axis
 * available and the reason classic Snake ships both.
 */
export type ModeId = 'drift' | 'ink' | 'gale'

export interface Mode {
  readonly id: ModeId
  readonly label: string
  /** One line shown under the mode picker. */
  readonly blurb: string
  /** Do the edges wrap, or kill? */
  readonly wrap: boolean
  /** Multiplier on the pace ramp. >1 tightens the interval faster. */
  readonly paceScale: number
  /** Multiplier on points earned, to pay for the added risk. */
  readonly scoreScale: number
}

export const MODES: Readonly<Record<ModeId, Mode>> = {
  drift: {
    id: 'drift',
    label: 'drift',
    blurb: 'edges wrap · learn without dying',
    wrap: true,
    paceScale: 1,
    scoreScale: 1,
  },
  ink: {
    id: 'ink',
    label: 'ink',
    blurb: 'edges are walls · classic snake',
    wrap: false,
    paceScale: 1,
    scoreScale: 1.5,
  },
  gale: {
    id: 'gale',
    label: 'gale',
    blurb: 'walls · speeds up twice as fast',
    wrap: false,
    paceScale: 2,
    scoreScale: 2.5,
  },
}

export const MODE_IDS = Object.keys(MODES) as ModeId[]

export const isModeId = (v: unknown): v is ModeId =>
  typeof v === 'string' && v in MODES
