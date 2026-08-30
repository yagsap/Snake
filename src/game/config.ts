/**
 * Every tunable number in the game, in one place.
 *
 * Magic numbers scattered through the code are not just untidy — they make
 * the game untunable. You cannot ask "is the difficulty ramp too steep?" if
 * the ramp is three subtractions buried in a collision branch. Anything a
 * designer would want to twist lives here, named, with the unit in the name
 * or the comment. Durations are in SECONDS throughout; the prototype mixed
 * seconds, milliseconds and per-frame multipliers in the same expressions.
 */

export const BOARD = {
  /** Cells per side. The board is square. */
  cells: 16,
  /** Internal render resolution in CSS pixels. Scaled to fit by CSS. */
  size: 640,
} as const

/** Size of one cell in render units. */
export const CELL = BOARD.size / BOARD.cells

export const SNAKE = {
  startLength: 3,
  /**
   * Segments popped on a wrong bite. The head advances that move, so the NET
   * shrink is one less than this — 2 pops = the "costs a segment" in the hint.
   */
  wrongBitePenalty: 2,
  /** Never shrink below this — otherwise a bad streak ends the run silently. */
  minLength: 2,
} as const

export const PACE = {
  /** Seconds per move at the start of a run. */
  startInterval: 0.24,
  /** Hard floor. Below roughly this, human reaction time stops being the limit. */
  minInterval: 0.085,
  /**
   * Characters eaten for the interval to close ~63% of the gap to the floor.
   * The prototype stepped the speed down 10 ms every 5 points and then stopped
   * dead at 150 ms, so the game got no harder after ~25 points. An exponential
   * approach keeps tightening forever while never becoming unplayable, and it
   * changes on *every* eat rather than every fifth, so the ramp is felt as
   * pressure rather than as five discrete lurches.
   */
  rampConstant: 18,
} as const

export const SCORING = {
  /** Points for a correct bite before multipliers. */
  base: 10,
  /** Correct bites per multiplier step. */
  comboStep: 4,
  maxMultiplier: 5,
  /** Extra points available for answering fast, scaled by time remaining. */
  maxSpeedBonus: 15,
  /**
   * Seconds of full-value answering time before the speed bonus starts to
   * decay. This is the risk/reward axis: the bonus rewards crossing the board
   * directly, which is exactly the move that runs you into your own tail.
   */
  bonusWindow: 3.0,
  /** Seconds the bonus takes to fade from full to zero after the window. */
  bonusFade: 4.0,
} as const

export const SPAWN = {
  /** Wrong characters placed alongside the target. */
  distractors: 4,
  /**
   * Weighting for target selection — a light spaced-repetition bias.
   * weight = max(floor, 1 + errorWeight*misses - masteryWeight*hits)
   */
  errorWeight: 3,
  masteryWeight: 0.5,
  floorWeight: 0.3,
  /** Hits before a character is considered solid in the study chart. */
  masteredAt: 3,
} as const

/**
 * Juice. All decay constants are time constants in seconds (see time.damp),
 * never per-frame multipliers.
 */
export const JUICE = {
  /** Screen shake, using a trauma model: offset scales with trauma squared. */
  traumaOnEat: 0.16,
  traumaOnWrong: 0.55,
  traumaOnDeath: 1.0,
  /** Seconds for trauma to decay to ~37%. */
  traumaTau: 0.35,
  /** Peak shake offset in render units at trauma = 1. */
  shakeAmplitude: 26,
  /** Peak rotation in radians at trauma = 1. A little roll sells the impact. */
  shakeRotation: 0.035,

  /**
   * Hit-stop: freeze the simulation for a few real milliseconds on impact
   * while rendering continues. It reads as weight — the frame the player is
   * looking at is held still long enough to be seen.
   */
  hitStopWrong: 0.11,
  hitStopDeath: 0.22,

  /** Squash-and-stretch on the head when eating. */
  eatPopDuration: 0.34,
  eatPopScale: 0.42,

  /** Full-screen colour flash. */
  flashDuration: 0.28,

  /** Seconds an eaten tile's "+N" score popup stays up. */
  scorePopupLife: 0.9,
  ringLife: 0.55,
  wrongRingLife: 0.7,
  /** How long the correct answer stays legible after a wrong bite. */
  correctionLife: 1.6,
} as const

export const THEME = {
  indigo: '#1C2541',
  indigoLight: '#243055',
  grid: '#2A3660',
  washi: '#F1EDE3',
  mist: '#8A93AD',
  jade: '#9AD1B2',
  jadeBright: '#D7F0E0',
  jadeDeep: '#4F8C6E',
  shu: '#E63B2E',
  shuSoft: '#F4A79F',
  gold: '#E8C46A',
  ink: '#1A2138',
} as const

/** Character-set-agnostic font stacks, mirrored from the stylesheet. */
export const FONTS = {
  glyph:
    "'Zen Kaku Gothic New','Noto Sans SC','Noto Sans Devanagari','Hiragino Sans','PingFang SC','Kohinoor Devanagari','Devanagari Sangam MN','Noto Sans JP','Segoe UI',sans-serif",
  display: "'Zen Old Mincho','Hiragino Mincho ProN',serif",
  mono: "'IBM Plex Mono',ui-monospace,monospace",
} as const
