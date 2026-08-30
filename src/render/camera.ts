import { JUICE } from '../game/config'
import { clamp01, damp } from '../core/time'

/**
 * Screen shake, on a trauma model.
 *
 * Naive shake sets an offset and multiplies it down each frame. Two problems:
 * the per-frame decay is frame-rate dependent, and picking a fresh random
 * offset every frame produces a buzz that reads as a rendering fault rather
 * than as impact.
 *
 * The trauma model (Squirrel Eiserloh, GDC 2016) fixes both. Events add
 * *trauma*, a 0..1 scalar that decays in real time; the actual shake is
 * trauma **squared**, so small events barely register while big ones dominate,
 * and shake tails off smoothly instead of stopping dead. Offsets are sampled
 * from smooth noise rather than white noise, so the camera swings rather than
 * vibrates. Rotation matters as much as translation — a slight roll is most of
 * what sells the hit.
 */

/** Cheap smooth 1-D noise in roughly [-1, 1]. Deterministic in `t`. */
function noise(seed: number, t: number): number {
  return (
    Math.sin(t * 10.1 + seed * 7.3) * 0.5 +
    Math.sin(t * 17.7 + seed * 3.1) * 0.3 +
    Math.sin(t * 29.3 + seed * 11.7) * 0.2
  )
}

export class Camera {
  /** 0..1. Events add to it; it decays on its own. */
  trauma = 0
  private clock = 0
  /** Set from the reduced-motion preference; scales all camera movement. */
  intensity = 1

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount)
  }

  update(dt: number): void {
    this.clock += dt
    this.trauma = damp(this.trauma, dt, JUICE.traumaTau)
    if (this.trauma < 0.001) this.trauma = 0
  }

  /** Push the shake transform. Caller is responsible for save/restore. */
  apply(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
    if (this.trauma <= 0 || this.intensity <= 0) return
    const shake = this.trauma * this.trauma * this.intensity
    const dx = JUICE.shakeAmplitude * shake * noise(1, this.clock)
    const dy = JUICE.shakeAmplitude * shake * noise(2, this.clock)
    const rot = JUICE.shakeRotation * shake * noise(3, this.clock)

    // Rotate about the board's centre, not the origin, or the whole board
    // swings out of frame instead of rolling in place.
    ctx.translate(centerX + dx, centerY + dy)
    ctx.rotate(rot)
    ctx.translate(-centerX, -centerY)
  }

  reset(): void {
    this.trauma = 0
  }
}

/**
 * Hit-stop: hold the simulation still for a few real milliseconds on impact.
 *
 * The frame where something lands is the frame the player most wants to read,
 * and at 60 fps it is on screen for 16 ms. Freezing time briefly lets that
 * frame be seen, and the resumption reads as weight. It is applied as a global
 * time scale on the loop, so rendering — and therefore the shake and the
 * particles — keeps running through the freeze.
 */
export class HitStop {
  private remaining = 0

  request(seconds: number): void {
    this.remaining = Math.max(this.remaining, seconds)
  }

  /** Advance using REAL time; hit-stop must not freeze its own countdown. */
  update(realDt: number): void {
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - realDt)
  }

  get active(): boolean {
    return this.remaining > 0
  }

  clear(): void {
    this.remaining = 0
  }
}
