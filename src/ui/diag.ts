/**
 * On-device diagnostics, enabled by adding ?debug to the URL.
 *
 * Every performance problem in this game so far was diagnosed on a desktop
 * with a bot, and the bot could not reproduce what a person on a phone was
 * feeling — it never bit a wrong character, and it never swiped. This exists
 * so the next report comes with numbers from the device that has the problem
 * instead of another guess from the machine that does not.
 *
 * It separates the three things a player cannot tell apart, all of which feel
 * like "lag":
 *   - RENDER   the browser missed frames (long frame times)
 *   - SIM      the snake was late leaving a cell (the simulation stalled)
 *   - INPUT    the turn arrived late, or was dropped by the buffer
 */

const HIDDEN = 'position:fixed;z-index:99;left:6px;top:6px;padding:6px 8px;' +
  'background:rgba(10,14,28,.86);color:#D7F0E0;font:500 10px/1.45 ui-monospace,monospace;' +
  'border:1px solid #2A3660;border-radius:6px;pointer-events:none;white-space:pre'

export class Diag {
  /** Opt-in only: ?debug on the URL. Costs nothing when off. */
  static get enabled(): boolean {
    return /[?&]debug\b/.test(location.search)
  }

  private el: HTMLElement
  private frames: number[] = []
  private longFrames = 0
  private worstFrame = 0
  /** Move-gap excess over the interval that was in force, in ms. */
  private worstMove = 0
  private moveStalls = 0
  private moves = 0
  private lastMove = 0
  private turns = 0
  private turnsDropped = 0
  /** Pointer-event time -> turn dispatched, in ms. */
  private worstInput = 0
  private pendingInput = 0
  private since = performance.now()

  constructor() {
    this.el = document.createElement('div')
    this.el.setAttribute('style', HIDDEN)
    this.el.textContent = 'diag: warming up'
    document.body.appendChild(this.el)
  }

  /** Called once per rendered frame with the real elapsed time. */
  frame(realDt: number): void {
    const ms = realDt * 1000
    this.frames.push(ms)
    if (ms > 34) this.longFrames++
    if (ms > this.worstFrame) this.worstFrame = ms
    if (performance.now() - this.since > 1000) this.flush()
  }

  /** Called on every committed snake move, with the interval in force. */
  move(intervalSeconds: number): void {
    const now = performance.now()
    if (this.lastMove) {
      const excess = now - this.lastMove - intervalSeconds * 1000
      if (excess > 40) this.moveStalls++
      if (excess > this.worstMove) this.worstMove = excess
    }
    this.lastMove = now
    this.moves++
  }

  /** Called from the raw input event, before any game logic runs. */
  input(): void {
    this.pendingInput = performance.now()
  }

  /** Called when a turn reaches the world. `accepted` is false if buffered out. */
  turn(accepted: boolean): void {
    this.turns++
    if (!accepted) this.turnsDropped++
    if (this.pendingInput) {
      const lag = performance.now() - this.pendingInput
      if (lag > this.worstInput) this.worstInput = lag
      this.pendingInput = 0
    }
  }

  /** A run ended or started: move timing from the previous run is meaningless. */
  resetRun(): void {
    this.lastMove = 0
  }

  private flush(): void {
    const f = this.frames
    const fps = f.length
    f.sort((a, b) => a - b)
    const p95 = f[Math.floor(f.length * 0.95)] ?? 0
    // Worst-case figures are cumulative: a hitch that happened ten seconds ago
    // is exactly what the player is trying to report, so it must not scroll away.
    this.el.textContent =
      `RENDER ${fps}fps p95 ${p95.toFixed(0)}ms worst ${this.worstFrame.toFixed(0)}ms long ${this.longFrames}\n` +
      `SIM    moves ${this.moves} stalls ${this.moveStalls} worst +${this.worstMove.toFixed(0)}ms\n` +
      `INPUT  turns ${this.turns} dropped ${this.turnsDropped} worst ${this.worstInput.toFixed(0)}ms`
    this.frames = []
    this.since = performance.now()
  }
}
