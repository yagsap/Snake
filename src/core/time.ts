/**
 * Time and easing primitives.
 *
 * The single most common bug in hobby game code is writing decay as
 * `value *= 0.9` inside the render loop. That is "multiply by 0.9 once per
 * *frame*", so the effect runs twice as fast on a 120 Hz display as on a
 * 60 Hz one. Every decay in this project goes through `damp()` instead,
 * which is framed in seconds and therefore identical on any display.
 */

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

export const clamp01 = (v: number): number => clamp(v, 0, 1)

/** Inverse lerp: where does `v` sit between a and b, as 0..1? */
export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp01((v - a) / (b - a))

/**
 * Frame-rate independent exponential decay.
 *
 * `tau` is the time constant in seconds: after `tau` seconds the value has
 * fallen to ~37% (1/e) of where it started, regardless of frame rate.
 *
 *   shake = damp(shake, dt, 0.18)   // instead of  shake *= 0.82
 */
export const damp = (value: number, dt: number, tau: number): number =>
  tau <= 0 ? 0 : value * Math.exp(-dt / tau)

/**
 * Frame-rate independent approach toward a target. Same idea as damp, but
 * converging on `target` rather than on zero. Used for smoothed HUD numbers.
 */
export const approach = (
  value: number,
  target: number,
  dt: number,
  tau: number,
): number => target + (value - target) * Math.exp(-dt / tau)

/** Linear countdown toward zero, in seconds. */
export const countdown = (value: number, dt: number): number =>
  value > 0 ? Math.max(0, value - dt) : 0

// ---------------------------------------------------------------- easing --
// All easings map 0..1 -> 0..1. Named by the Penner convention.

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeInCubic = (t: number): number => t * t * t
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5)
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Overshoots past 1 then settles. The classic "pop" curve. */
export const easeOutBack = (t: number, overshoot = 1.7): number => {
  const c3 = overshoot + 1
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2)
}

/** Decaying oscillation — squash-and-stretch settle, spring recoil. */
export const easeOutElastic = (t: number, periods = 3): number => {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const p = (2 * Math.PI) / periods
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * p) + 1
}

/** Rises to 1 at t=0.5 and falls back to 0. Good for one-shot flashes. */
export const pulse = (t: number): number => Math.sin(clamp01(t) * Math.PI)
