import { CELL, FONTS, JUICE } from '../game/config'
import { clamp01, easeOutCubic, easeOutQuint } from '../core/time'

/**
 * Transient visual effects.
 *
 * Everything here is presentation-only: effects read simulation state but
 * never write it, and the simulation runs identically with the whole system
 * switched off. That is what lets the reduced-motion setting be a real
 * setting rather than a second code path.
 *
 * Effects age in seconds (never in frames) and are drawn from their own
 * normalised 0..1 life, so they look the same at any refresh rate.
 */

interface Base {
  x: number
  y: number
  age: number
  life: number
}

interface Ring extends Base {
  kind: 'ring'
  color: string
  radius: number
  width: number
}

interface Text extends Base {
  kind: 'text'
  text: string
  color: string
  size: number
  rise: number
}

interface Particle extends Base {
  kind: 'particle'
  vx: number
  vy: number
  size: number
  color: string
  spin: number
  rotation: number
}

type Effect = Ring | Text | Particle

/** Gravity for debris, in render units per second squared. */
const GRAVITY = 900
/** Air drag time constant. */
const DRAG_TAU = 0.55

export class FxSystem {
  private effects: Effect[] = []
  /** 0 disables all effects (reduced motion); 1 is full. */
  intensity = 1

  get count(): number {
    return this.effects.length
  }

  clear(): void {
    this.effects.length = 0
  }

  ring(x: number, y: number, color: string, life: number, radius = CELL * 1.6): void {
    if (this.intensity <= 0) return
    this.effects.push({
      kind: 'ring',
      x,
      y,
      age: 0,
      life,
      color,
      radius,
      width: 3,
    })
  }

  text(
    x: number,
    y: number,
    text: string,
    color: string,
    life: number = JUICE.scorePopupLife,
    size: number = CELL * 0.5,
  ): void {
    // Text popups carry information (the right answer, the points earned), so
    // they survive reduced motion — only their travel is suppressed.
    this.effects.push({
      kind: 'text',
      x,
      y,
      age: 0,
      life,
      text,
      color,
      size,
      rise: this.intensity > 0 ? CELL * 1.2 : CELL * 0.35,
    })
  }

  /**
   * A burst of debris. Directional bias (`dirX`/`dirY`) throws the spray the
   * way the snake was heading, which reads as the impact having a direction
   * instead of being an omnidirectional pop.
   */
  burst(
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    dirX = 0,
    dirY = 0,
  ): void {
    if (this.intensity <= 0) return
    const n = Math.round(count * this.intensity)
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.6
      const v = speed * (0.5 + Math.random() * 0.8)
      this.effects.push({
        kind: 'particle',
        x,
        y,
        age: 0,
        life: 0.45 + Math.random() * 0.45,
        vx: Math.cos(angle) * v + dirX * speed * 0.55,
        vy: Math.sin(angle) * v + dirY * speed * 0.55,
        size: CELL * (0.08 + Math.random() * 0.13),
        color,
        spin: (Math.random() - 0.5) * 14,
        rotation: Math.random() * Math.PI,
      })
    }
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i] as Effect
      e.age += dt
      if (e.age >= e.life) {
        // Swap-and-pop: removing from the middle of an array is O(n), and the
        // draw order of debris is not something anyone can perceive.
        const last = this.effects.pop() as Effect
        if (i < this.effects.length) this.effects[i] = last
        continue
      }
      if (e.kind === 'particle') {
        const drag = Math.exp(-dt / DRAG_TAU)
        e.vy += GRAVITY * dt
        e.vx *= drag
        e.vy *= drag
        e.x += e.vx * dt
        e.y += e.vy * dt
        e.rotation += e.spin * dt
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (const e of this.effects) {
      const t = clamp01(e.age / e.life)
      switch (e.kind) {
        case 'ring': {
          const eased = easeOutQuint(t)
          ctx.strokeStyle = e.color
          ctx.globalAlpha = 1 - t
          ctx.lineWidth = e.width * (1 - t) + 1
          ctx.beginPath()
          ctx.arc(e.x, e.y, CELL * 0.3 + eased * e.radius, 0, Math.PI * 2)
          ctx.stroke()
          break
        }
        case 'text': {
          // Fade late, so the text is fully legible for most of its life.
          ctx.globalAlpha = 1 - t * t * t
          ctx.fillStyle = e.color
          ctx.font = `600 ${e.size}px ${FONTS.mono}`
          ctx.fillText(e.text, e.x, e.y - easeOutCubic(t) * e.rise)
          break
        }
        case 'particle': {
          ctx.globalAlpha = 1 - t * t
          ctx.fillStyle = e.color
          ctx.save()
          ctx.translate(e.x, e.y)
          ctx.rotate(e.rotation)
          ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size)
          ctx.restore()
          break
        }
      }
    }
    ctx.globalAlpha = 1
  }
}

/**
 * A one-shot full-screen colour wash. Kept separate from the particle list
 * because there is only ever one, and it draws over everything.
 */
export class Flash {
  private age = 0
  private life = 0
  private color = '#fff'
  private peak = 0
  intensity = 1

  fire(color: string, peak = 0.35, life = JUICE.flashDuration): void {
    if (this.intensity <= 0) return
    this.color = color
    this.peak = peak * this.intensity
    this.life = life
    this.age = 0
  }

  update(dt: number): void {
    if (this.life > 0) this.age += dt
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.life <= 0 || this.age >= this.life) return
    const t = this.age / this.life
    // Instant on, quick off: a flash that fades *in* is a glow, not a hit.
    ctx.globalAlpha = this.peak * (1 - t) * (1 - t)
    ctx.fillStyle = this.color
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
  }

  clear(): void {
    this.life = 0
  }
}
