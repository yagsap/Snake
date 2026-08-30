/**
 * Fixed-timestep game loop with interpolated rendering.
 *
 * The prototype ran simulation on `setInterval(step, tickMs)` and drawing on
 * `requestAnimationFrame`. Two independent clocks means:
 *   - they drift apart, so the interpolation factor is a guess;
 *   - background tabs throttle setInterval to ~1 Hz but stop rAF entirely,
 *     so the snake kept crawling while nobody was watching;
 *   - changing `tickMs` meant clearInterval/setInterval, which drops the
 *     partially-elapsed tick on the floor and visibly hitches.
 *
 * This is the standard fix (Gaffer on Games, "Fix Your Timestep"): one rAF
 * loop owning real time, an accumulator draining it in constant-size chunks,
 * and a leftover fraction handed to the renderer as `alpha` so drawing can
 * interpolate between the last two simulation states.
 *
 * Simulation runs at a constant FIXED_HZ. It is deliberately NOT the same
 * thing as the snake's move rate — the snake moves on a discrete event that
 * the simulation schedules for itself (see World.moveClock). That separation
 * is what lets the game speed up smoothly without touching the loop.
 */

/** Simulation rate. Constant forever; difficulty changes the move rate, not this. */
export const FIXED_HZ = 60
export const FIXED_DT = 1 / FIXED_HZ

/**
 * Longest real-time gap we are willing to simulate in one frame. Without this
 * clamp, returning to a tab that was hidden for five minutes would try to run
 * 18,000 steps in one frame, block the main thread, produce an even bigger
 * gap next frame, and never recover — the "spiral of death".
 */
const MAX_FRAME_TIME = 0.25

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. Called 0..N times a frame. */
  update(dt: number): void
  /**
   * Draw one frame.
   * @param alpha  0..1 — how far into the *next* unsimulated step we are.
   *               Use it to interpolate, never to mutate simulation state.
   * @param dt     real seconds since the last draw, for view-only animation.
   */
  render(alpha: number, dt: number): void
}

export class GameLoop {
  private rafId = 0
  private lastTime = 0
  private accumulator = 0
  private running = false

  /**
   * Global time scale. 0 freezes the simulation while rendering continues —
   * that is exactly what hit-stop needs. Values in between give slow motion.
   */
  timeScale = 1

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.accumulator = 0
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  /**
   * Drop accumulated time without simulating it. Call after any deliberate
   * pause (tab hidden, modal open) so the game resumes where it left off
   * instead of fast-forwarding through the gap.
   */
  resync(): void {
    this.lastTime = performance.now()
    this.accumulator = 0
  }

  private frame = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.frame)

    const realDt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME)
    this.lastTime = now

    this.accumulator += realDt * this.timeScale

    // Drain in constant-size chunks. Simulation only ever sees FIXED_DT, so
    // its behaviour is identical at 30, 60 or 144 Hz — and reproducible.
    while (this.accumulator >= FIXED_DT) {
      this.cb.update(FIXED_DT)
      this.accumulator -= FIXED_DT
    }

    this.cb.render(this.accumulator / FIXED_DT, realDt)
  }
}
