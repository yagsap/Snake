import { BOARD, CELL, THEME } from '../game/config'

/**
 * Sumi sprites — the game's little inhabitants.
 *
 * Round blots of 墨 sumi ink with two bright eyes, born from the same brush
 * that draws the characters. They are deliberately ORIGINAL: the obvious
 * reference is Ghibli's susuwatari, and shipping a recognisable copy of those
 * would be someone else's trademark on your storefront. These belong to the
 * game's own ink-and-washi world instead, which is also a tighter fit — the
 * board is a page, so its creatures are drops of ink.
 *
 * They appear at exactly two moments and never otherwise: they mob the board
 * when you master a character, and they scatter in a panic when you die. An
 * earlier version had them ambling in during every cue, and ambient decoration
 * on a screen you are trying to READ is worse than nothing — it competed with
 * the characters for attention and said nothing when it arrived. Restricting
 * them to the two emotional peaks turns them from wallpaper into punctuation.
 * Nothing here touches the simulation, and reduced motion silences it all.
 */

const W = BOARD.size
const TWO_PI = Math.PI * 2

type Mood = 'idle' | 'cheer' | 'panic'

interface Sprite {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** Bounce phase, so a group never moves in lockstep. */
  phase: number
  /** Seconds left before it wanders off; Infinity for resident sprites. */
  life: number
  mood: Mood
}

export class Sprites {
  private list: Sprite[] = []
  private clock = 0
  /** 0 disables everything, matching the reduced-motion preference. */
  intensity = 1

  clear(): void {
    this.list.length = 0
  }

  /** A sprite ambles in from the nearest edge and hangs about. */
  peek(): void {
    if (this.intensity <= 0 || this.list.length >= 4) return
    const edge = Math.floor(Math.random() * 4)
    const along = Math.random() * W
    const m = CELL * 0.6
    const x = edge === 0 ? m : edge === 1 ? W - m : along
    const y = edge === 2 ? m : edge === 3 ? W - m : along
    this.list.push({
      x, y,
      vx: (Math.random() - 0.5) * 22,
      vy: (Math.random() - 0.5) * 22,
      r: CELL * (0.34 + Math.random() * 0.1),
      phase: Math.random() * TWO_PI,
      life: 6 + Math.random() * 6,
      mood: 'idle',
    })
  }

  /** Mastery: the whole crowd hops, and a couple more turn up to watch. */
  cheer(x: number, y: number): void {
    if (this.intensity <= 0) return
    for (const s of this.list) {
      s.mood = 'cheer'
      s.life = Math.max(s.life, 2.5)
      s.vx += (x - s.x) * 0.35
      s.vy += (y - s.y) * 0.35 - 40
    }
    for (let i = this.list.length; i < 5; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * CELL * 3,
        y: y + (Math.random() - 0.5) * CELL * 3,
        vx: (Math.random() - 0.5) * 60,
        vy: -30 - Math.random() * 60,
        r: CELL * (0.32 + Math.random() * 0.1),
        phase: Math.random() * TWO_PI,
        life: 2.2,
        mood: 'cheer',
      })
    }
  }

  /** Death: everyone bolts for the edges, eyes wide. */
  panic(x: number, y: number): void {
    if (this.intensity <= 0) return
    // They burst OUT of the wreck rather than wandering in from the edges: a
    // scatter only reads as a scatter if you can see where it started, and
    // the thing that just happened happened right here.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TWO_PI + Math.random() * 0.5
      this.list.push({
        x: x + Math.cos(a) * CELL * 0.5,
        y: y + Math.sin(a) * CELL * 0.5,
        vx: Math.cos(a) * (300 + Math.random() * 220),
        vy: Math.sin(a) * (300 + Math.random() * 220) - 90,
        r: CELL * (0.3 + Math.random() * 0.14),
        phase: Math.random() * TWO_PI,
        life: 1.6 + Math.random() * 0.9,
        mood: 'panic',
      })
    }
    for (const s of this.list) {
      s.mood = 'panic'
      s.life = Math.min(s.life, 2.5)
    }
  }

  update(dt: number): void {
    this.clock += dt
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i] as Sprite
      s.life -= dt
      if (s.life <= 0) {
        this.list.splice(i, 1)
        continue
      }
      s.x += s.vx * dt
      s.y += s.vy * dt
      // Drag: a panicked sprite keeps its momentum longer than a curious one.
      const drag = Math.exp(-dt / (s.mood === 'panic' ? 0.7 : 0.35))
      s.vx *= drag
      s.vy *= drag
      if (s.mood === 'idle') {
        // Idle wander, so they never sit perfectly still.
        s.vx += (Math.random() - 0.5) * 40 * dt
        s.vy += (Math.random() - 0.5) * 40 * dt
        s.x = Math.max(CELL * 0.4, Math.min(W - CELL * 0.4, s.x))
        s.y = Math.max(CELL * 0.4, Math.min(W - CELL * 0.4, s.y))
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.intensity <= 0) return
    for (const s of this.list) {
      // Squash on the bounce: the whole personality is in this one curve.
      const bounce = s.mood === 'idle'
        ? Math.sin(this.clock * 5 + s.phase) * 0.09
        : Math.sin(this.clock * 15 + s.phase) * 0.18
      const rx = s.r * (1 - bounce)
      const ry = s.r * (1 + bounce)
      const fade = Math.min(1, s.life)

      ctx.globalAlpha = fade * 0.95
      // A blot, not a circle: three overlapping arcs give it a wobbly,
      // hand-inked edge that a perfect circle never has.
      ctx.fillStyle = '#0B0F1E'
      ctx.beginPath()
      ctx.ellipse(s.x, s.y, rx, ry, 0, 0, TWO_PI)
      ctx.ellipse(s.x - rx * 0.5, s.y + ry * 0.3, rx * 0.55, ry * 0.5, 0, 0, TWO_PI)
      ctx.ellipse(s.x + rx * 0.5, s.y + ry * 0.25, rx * 0.5, ry * 0.45, 0, 0, TWO_PI)
      ctx.fill()
      // A jade rim. Ink-dark on an ink-dark board is invisible — the first
      // version of these was drawing perfectly and could not be seen at all.
      // The rim borrows the snake's own colour, so they read as belonging to
      // it rather than as UI stuck on top.
      ctx.strokeStyle = 'rgba(154,209,178,.5)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Eyes. Wide in panic, squeezed shut mid-cheer — the mood reads from
      // across the board even at this size.
      const ex = rx * 0.36
      const eyeR = s.r * (s.mood === 'panic' ? 0.44 : 0.34)
      ctx.fillStyle = THEME.washi
      if (s.mood === 'cheer' && bounce > 0) {
        ctx.fillRect(s.x - ex - eyeR, s.y - eyeR * 0.2, eyeR * 2, s.r * 0.1)
        ctx.fillRect(s.x + ex - eyeR, s.y - eyeR * 0.2, eyeR * 2, s.r * 0.1)
      } else {
        ctx.beginPath()
        ctx.arc(s.x - ex, s.y - ry * 0.1, eyeR, 0, TWO_PI)
        ctx.arc(s.x + ex, s.y - ry * 0.1, eyeR, 0, TWO_PI)
        ctx.fill()
        ctx.fillStyle = '#12172B'
        ctx.beginPath()
        ctx.arc(s.x - ex, s.y - ry * 0.1, eyeR * 0.45, 0, TWO_PI)
        ctx.arc(s.x + ex, s.y - ry * 0.1, eyeR * 0.45, 0, TWO_PI)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }
}
