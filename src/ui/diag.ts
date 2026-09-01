/**
 * On-device diagnostics, enabled by adding ?debug to the URL.
 *
 * Every performance problem in this game so far was diagnosed on a desktop
 * with a bot, and the bot could not reproduce what a person on a phone was
 * feeling — it never bit a wrong character, and it never swiped. This exists
 * so a report comes with numbers from the device that has the problem instead
 * of another guess from the machine that does not.
 *
 * It separates the three things a player cannot tell apart, all of which feel
 * like "lag":
 *   - RENDER   the browser missed frames (long frame times)
 *   - SIM      the snake was late leaving a cell (the simulation stalled)
 *   - INPUT    the turn arrived late, or was dropped by the buffer
 *
 * and then ATTRIBUTES each long frame to whatever the game did just before
 * it, so "the main thread blocked" becomes "the main thread blocked on this".
 */

import { speechBridgeError } from './native'

const STYLE = 'position:fixed;z-index:99;left:6px;top:58px;padding:6px 8px;' +
  'background:rgba(10,14,28,.88);color:#D7F0E0;font:500 10px/1.45 ui-monospace,monospace;' +
  'border:1px solid #2A3660;border-radius:6px;pointer-events:none;white-space:pre'

const BTN_ROW = 'display:flex;gap:6px;margin-top:5px;pointer-events:auto'
const BTN = 'font:500 13px ui-monospace,monospace;padding:3px 9px;border-radius:5px;' +
  'border:1px solid #2A3660;background:#1C2541;color:#D7F0E0'

/** A long frame is blamed on anything the game did within this window. */
const BLAME_WINDOW = 450

/**
 * Kill-switches for the A/B hunt. Each toggle silences one subsystem at
 * runtime so the player can watch the stall counter with it off. Whatever
 * toggle stops the stalls names the culprit — measured on the exact device
 * that has the problem, with no rebuild between experiments.
 */
export interface DiagSwitches {
  onSpeech(on: boolean): void
  onTones(on: boolean): void
  onHaptics(on: boolean): void
  onFx(on: boolean): void
}

export class Diag {
  /** Opt-in only: ?debug on the URL. Costs nothing when off. */
  static get enabled(): boolean {
    return /[?&]debug\b/.test(location.search)
  }

  private el: HTMLElement
  private fps = 0
  private frameTimes: number[] = []
  private longFrames = 0
  /** TRUE frame gap, measured here — the loop's dt is clamped and would lie. */
  private worstFrame = 0
  private lastFrameAt = 0
  /** Time spent inside our own update+render, as opposed to between frames. */
  private worstWork = 0
  private workTimes: number[] = []

  private worstMove = 0
  private moveStalls = 0
  private moves = 0
  private lastMove = 0

  private turns = 0
  private turnsDropped = 0
  private worstInput = 0
  private pendingInput = 0

  /** Recent game actions, newest last, for blaming long frames on. */
  private marks: Array<{ t: number; tag: string }> = []
  /** tag -> [times blamed, worst ms blamed]. */
  private blame = new Map<string, [number, number]>()

  private since = performance.now()

  private readout: HTMLElement

  constructor(switches?: DiagSwitches) {
    this.el = document.createElement('div')
    this.el.setAttribute('style', STYLE)
    this.readout = document.createElement('div')
    this.readout.textContent = 'diag: warming up'
    this.el.appendChild(this.readout)

    if (switches) {
      const row = document.createElement('div')
      row.setAttribute('style', BTN_ROW)
      const mk = (
        label: string,
        act: (on: boolean) => void,
        momentary = false,
      ) => {
        let on = true
        const b = document.createElement('button')
        b.setAttribute('style', BTN)
        const paint = () => {
          b.textContent = label
          b.style.opacity = on ? '1' : '0.35'
          b.style.borderColor = on ? '#2A3660' : '#E63B2E'
        }
        paint()
        b.addEventListener('pointerdown', (e) => {
          e.stopPropagation()
          e.preventDefault()
          if (!momentary) on = !on
          act(on)
          paint()
        })
        row.appendChild(b)
      }
      mk('↺', () => this.reset(), true)
      mk('🗣', (on) => switches.onSpeech(on))
      mk('🎵', (on) => switches.onTones(on))
      mk('📳', (on) => switches.onHaptics(on))
      mk('✨', (on) => switches.onFx(on))
      this.el.appendChild(row)
    }
    document.body.appendChild(this.el)
  }

  /** Zero every counter, so each toggle experiment starts a fresh count. */
  private reset(): void {
    this.fps = 0
    this.frameTimes = []
    this.longFrames = 0
    this.worstFrame = 0
    this.worstWork = 0
    this.workTimes = []
    this.worstMove = 0
    this.moveStalls = 0
    this.moves = 0
    this.lastMove = 0
    this.turns = 0
    this.turnsDropped = 0
    this.worstInput = 0
    this.blame.clear()
    this.since = performance.now()
  }

  /** Record that the game just did something that might cost a frame. */
  mark(tag: string): void {
    const t = performance.now()
    this.marks.push({ t, tag })
    // Keep only what could still be blamed for an upcoming frame.
    while (this.marks.length && t - (this.marks[0] as { t: number }).t > BLAME_WINDOW) {
      this.marks.shift()
    }
  }

  /**
   * Called at the end of every rendered frame. Times itself; the loop's dt is
   * clamped and would understate a stall.
   *
   * `workStart` is when OUR code began this frame, which is the whole point:
   * if work is small while the gap is huge, the time was not spent in this
   * game at all and no amount of optimising it would help. That distinction
   * is invisible from a frame counter alone.
   */
  frame(workStart: number): void {
    const now = performance.now()
    const work = workStart ? now - workStart : 0
    if (work > this.worstWork) this.worstWork = work
    this.workTimes.push(work)
    if (this.lastFrameAt) {
      const gap = now - this.lastFrameAt
      this.fps++
      this.frameTimes.push(gap)
      if (gap > 34) {
        this.longFrames++
        if (gap > this.worstFrame) this.worstFrame = gap
        this.blameFor(this.lastFrameAt, gap)
      }
    }
    this.lastFrameAt = now
    if (now - this.since > 1000) this.flush()
  }

  /**
   * Blame a long frame on whatever happened while it was being missed —
   * anything marked between the previous frame and now. Nothing in the window
   * means the main thread was taken by something outside the game.
   */
  private blameFor(frameStart: number, gap: number): void {
    let found = false
    for (const m of this.marks) {
      if (m.t >= frameStart - 16 && m.t <= frameStart + gap) {
        found = true
        const cur = this.blame.get(m.tag) ?? [0, 0]
        this.blame.set(m.tag, [cur[0] + 1, Math.max(cur[1], gap)])
      }
    }
    if (!found) {
      const cur = this.blame.get('(outside)') ?? [0, 0]
      this.blame.set('(outside)', [cur[0] + 1, Math.max(cur[1], gap)])
    }
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
    this.mark('touch')
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

  /**
   * A run started or the simulation was deliberately suspended (pause, the
   * study chart): the gap to the next move is not a stall, it is the player
   * taking a break — one paused reading measured as a +1928ms "stall" until
   * the player explained it. Forgetting the last move keeps breaks out of
   * the numbers.
   */
  resetRun(): void {
    this.lastMove = 0
  }

  private flush(): void {
    const f = this.frameTimes.sort((a, b) => a - b)
    const p95 = f[Math.floor(f.length * 0.95)] ?? 0
    // Worst-case figures are cumulative: the hitch ten seconds ago is exactly
    // what the player is trying to report, so it must not scroll away.
    const top = [...this.blame.entries()]
      .sort((a, b) => b[1][0] - a[1][0])
      .slice(0, 3)
      .map(([tag, [n, worst]]) => `${tag} ${n}x/${worst.toFixed(0)}ms`)
      .join('  ')
    const w = this.workTimes.sort((a, b) => a - b)
    const w95 = w[Math.floor(w.length * 0.95)] ?? 0
    this.readout.textContent =
      `RENDER ${this.fps}fps p95 ${p95.toFixed(0)}ms worst ${this.worstFrame.toFixed(0)}ms long ${this.longFrames}\n` +
      `OURCODE p95 ${w95.toFixed(1)}ms worst ${this.worstWork.toFixed(0)}ms\n` +
      `SIM    moves ${this.moves} stalls ${this.moveStalls} worst +${this.worstMove.toFixed(0)}ms\n` +
      `INPUT  turns ${this.turns} dropped ${this.turnsDropped} worst ${this.worstInput.toFixed(0)}ms\n` +
      `BLAME  ${top || '(nothing yet)'}` +
      (speechBridgeError.message ? `\nSPEECH-ERR ${speechBridgeError.message}` : '')
    this.frameTimes = []
    this.workTimes = []
    this.fps = 0
    this.since = performance.now()
  }
}
