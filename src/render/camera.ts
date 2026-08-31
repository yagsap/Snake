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
 * Removed: hit-stop.
 *
 * It held the simulation still for ~110ms on a wrong bite, on the standard
 * argument that freezing the frame of impact lets the player read it and
 * reads as weight. That argument holds for a fighting game. It does not hold
 * here, and measurement was unambiguous: every wrong bite produced a stall
 * of ~100ms and nothing else ever did. At a 136ms move interval that made
 * one move take 71% longer.
 *
 * The difference is that this snake is ALWAYS moving. Constant motion is the
 * baseline the player's eye tracks, so an interruption of it does not read as
 * emphasis — it reads as the game hanging. And the mistake is already
 * unmissable without it: red flash, screen shake, the body washing to
 * vermilion, a ring, debris, the correct answer printed for 1.6 seconds, a
 * haptic thud and a sound. Nothing was lost by taking the freeze out.
 */
