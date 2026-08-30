import { BOARD, CELL, FONTS, JUICE, THEME } from '../game/config'
import { SCORING } from '../game/config'
import type { Item, World } from '../game/world'
import { clamp01, countdown, easeOutBack, easeOutCubic, lerp } from '../core/time'
import { speedBonusFactor } from '../game/progression'
import { Camera } from './camera'
import { Flash, FxSystem } from './fx'
import { createBackground, drawWalls } from './background'

const W = BOARD.size
const TWO_PI = Math.PI * 2

/**
 * Glyph metrics cache.
 *
 * `measureText` is not free, and the draw loop measures every tile and every
 * body segment, every frame, at a size that changes continuously during entry
 * animations. Font metrics scale linearly with size, so measuring each
 * character once at a reference size and scaling the result is exact for
 * scalable fonts and removes the per-frame cost entirely.
 */
const REF_SIZE = 100
const metricsCache = new Map<string, { width: number; asc: number; desc: number }>()

function metricsFor(
  ctx: CanvasRenderingContext2D,
  ch: string,
): { width: number; asc: number; desc: number } {
  const cached = metricsCache.get(ch)
  if (cached) return cached
  ctx.save()
  ctx.font = `700 ${REF_SIZE}px ${FONTS.glyph}`
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText(ch)
  const entry = {
    width: m.width / REF_SIZE,
    asc: (m.actualBoundingBoxAscent || REF_SIZE * 0.7) / REF_SIZE,
    desc: (m.actualBoundingBoxDescent || REF_SIZE * 0.1) / REF_SIZE,
  }
  ctx.restore()
  metricsCache.set(ch, entry)
  return entry
}

/**
 * Draw a character optically centred in a box, shrinking to fit.
 *
 * Canvas `textBaseline: 'middle'` centres on the font's line box, not on the
 * ink. For CJK and Devanagari the two are noticeably different, and glyphs
 * drift off-centre inside their tiles. Measuring the actual ink bounds and
 * offsetting from the alphabetic baseline centres what the eye actually sees.
 */
function glyph(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  size: number,
  maxWidth?: number,
  maxHeight?: number,
): void {
  const m = metricsFor(ctx, ch)
  let s = size
  if (maxWidth && m.width * s > maxWidth) s = maxWidth / m.width
  // Clamp the ink HEIGHT too. Devanagari ascenders and descenders run well
  // past the em box — width-only fitting let them spill out of every
  // container we ever drew. Both clamps together make containment a
  // guarantee of this function, not a hope about the font.
  const inkH = m.asc + m.desc
  if (maxHeight && inkH * s > maxHeight) s = maxHeight / inkH
  if (s < 1) return
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${s}px ${FONTS.glyph}`
  ctx.fillText(ch, x, y + ((m.asc - m.desc) * s) / 2)
  ctx.textBaseline = 'middle'
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Blend two '#rrggbb' colours. Returns hex, not rgb(): the recoil wash blends
 * an already-blended body colour a second time, so the output format must be
 * parseable as an input — rgb() fed back in parsed as NaN and the body
 * vanished for the length of the recoil.
 */
function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const A = parse(a)
  const B = parse(b)
  return `#${A.map((v, i) =>
    Math.round(lerp(v, B[i] ?? v, t)).toString(16).padStart(2, '0'),
  ).join('')}`
}

export interface RenderOptions {
  /** Draw the pause veil over the board. */
  paused: boolean
  /** Dim everything — used behind the game-over card. */
  dimmed: boolean
}

export class Renderer {
  readonly camera = new Camera()
  readonly fx = new FxSystem()
  readonly flash = new Flash()

  private ctx: CanvasRenderingContext2D
  private background: HTMLCanvasElement
  private dpr: number

  /** 0..1, decaying. Drives head squash-and-stretch after an eat. */
  private eatPop = 0
  /** 0..1, decaying. Drives the recoil after a wrong bite. */
  private recoil = 0
  private clock = 0
  /**
   * Body gradient colours, cached per snake length. mixHex allocates arrays
   * and strings; at 60fps times every segment that churn is real GC pressure
   * on phones, and the colours only change when the snake grows or shrinks.
   */
  private bodyColors: string[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    // Cap DPR at 2: beyond that the pixel cost grows quadratically for a
    // difference nobody can see on a board made of flat colour.
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = W * this.dpr
    canvas.height = W * this.dpr
    this.background = createBackground(this.dpr)
    // Metrics measured before the webfonts arrive describe the fallback font.
    // Flush the cache when loading settles so glyphs re-centre correctly.
    document.fonts?.addEventListener('loadingdone', () => metricsCache.clear())
  }

  /** Apply the reduced-motion preference across every effect system at once. */
  setMotion(enabled: boolean): void {
    const v = enabled ? 1 : 0
    this.camera.intensity = v
    this.fx.intensity = v
    this.flash.intensity = v
  }

  reset(): void {
    this.fx.clear()
    this.flash.clear()
    this.camera.reset()
    this.eatPop = 0
    this.recoil = 0
  }

  // ----------------------------------------------------------- reactions --

  popEat(): void {
    this.eatPop = 1
  }

  popWrong(): void {
    this.recoil = 1
  }

  /**
   * View-only animation, driven by REAL time so juice keeps breathing during
   * hit-stop and while the game is paused.
   */
  update(realDt: number): void {
    this.clock += realDt
    this.camera.update(realDt)
    this.fx.update(realDt)
    this.flash.update(realDt)
    this.eatPop = countdown(this.eatPop, realDt / JUICE.eatPopDuration)
    this.recoil = countdown(this.recoil, realDt / 0.45)
  }

  // ---------------------------------------------------------------- draw --

  draw(world: World, alpha: number, opts: RenderOptions): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.drawImage(this.background, 0, 0, W, W)

    ctx.save()
    this.camera.apply(ctx, W / 2, W / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (!world.mode.wrap) drawWalls(ctx, this.dangerNear(world))
    this.drawObstacles(world)
    this.drawItems(world)
    this.drawSnake(world, alpha)
    this.fx.draw(ctx)

    ctx.restore()

    this.flash.draw(ctx, W, W)
    if (opts.dimmed) {
      ctx.fillStyle = 'rgba(28,37,65,.72)'
      ctx.fillRect(0, 0, W, W)
    } else if (opts.paused) {
      ctx.fillStyle = 'rgba(28,37,65,.72)'
      ctx.fillRect(0, 0, W, W)
      ctx.fillStyle = THEME.washi
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 42px ${FONTS.display}`
      ctx.fillText('paused', W / 2, W / 2)
    }
  }

  /** 0..1 — how close the head is to a lethal edge, for the wall glow. */
  private dangerNear(world: World): number {
    const head = world.snake[0]
    if (!head) return 0
    const d = Math.min(
      head.x,
      head.y,
      BOARD.cells - 1 - head.x,
      BOARD.cells - 1 - head.y,
    )
    return clamp01(1 - d / 3)
  }

  /** Stones: lethal cells drawn as dark rocks so the rule is visible. */
  private drawObstacles(world: World): void {
    const ctx = this.ctx
    for (const cell of world.obstacles) {
      const x = (cell % BOARD.cells) * CELL
      const y = Math.floor(cell / BOARD.cells) * CELL
      const pad = 3
      ctx.fillStyle = 'rgba(0,0,0,.4)'
      roundRect(ctx, x + pad + 1.5, y + pad + 2.5, CELL - pad * 2, CELL - pad * 2, 7)
      ctx.fill()
      ctx.fillStyle = '#151B30'
      roundRect(ctx, x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7)
      ctx.fill()
      ctx.strokeStyle = THEME.grid
      ctx.lineWidth = 1.5
      roundRect(ctx, x + pad + 2, y + pad + 2, CELL - pad * 2 - 4, CELL - pad * 2 - 4, 5)
      ctx.stroke()
      // one moss fleck so a stone reads as a stone, not a hole
      ctx.fillStyle = 'rgba(154,209,178,.28)'
      ctx.beginPath()
      ctx.arc(x + CELL * 0.32, y + CELL * 0.3, 1.6, 0, TWO_PI)
      ctx.fill()
    }
  }

  private drawItems(world: World): void {
    const ctx = this.ctx
    for (const it of world.items) {
      // Entry animation: overshoot then settle. A tile that simply appears is
      // easy to miss; one that pops draws the eye to the new question.
      const grow = clamp01(it.age / 0.26)
      const scale = easeOutBack(grow)
      const bob = Math.sin(this.clock * 1.9 + it.phase) * 1.6
      // Pull edge-cell glyphs a few pixels inboard: a glyph centred in a
      // boundary cell has its ink flush against the canvas edge, where the
      // bob, the shadow, or a font's optimistic metrics get it cropped.
      // Interior cells are untouched — the clamp only bites on the rim.
      const margin = CELL / 2 + 3
      const x = Math.min(W - margin, Math.max(margin, it.x * CELL + CELL / 2))
      const y = Math.min(W - margin, Math.max(margin, it.y * CELL + CELL / 2 + bob))

      // No card behind the character: a box can be overflowed by a tall
      // script (Devanagari ascenders escaped it on every phone font tried),
      // but a bare glyph has nothing to escape. The shadow lifts it off the
      // wave field, and dropping the card bought room for much bigger ink.
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,.55)'
      // Blur cost grows with radius squared and this runs per glyph per
      // frame on phone GPUs; 3 reads the same at cell size as 8 did.
      ctx.shadowBlur = 3
      ctx.shadowOffsetY = 2
      ctx.fillStyle = THEME.washi
      if (world.reverse) {
        // Reverse level: tiles show the SOUND; the cue shows the glyph.
        glyph(ctx, world.soundOf(it.ch), x, y, CELL * 0.46 * scale, CELL, CELL)
      } else {
        // A full cell of ink: with no card to fit inside, readability is the
        // only constraint that matters, especially at phone sizes.
        glyph(ctx, it.ch, x, y, CELL * 0.88 * scale, CELL, CELL)
      }
      ctx.restore()
    }
  }

  /**
   * The speed-bonus clock, drawn as a shrinking arc around the snake's HEAD.
   *
   * The bonus is the game's whole risk/reward axis — cross the board fast and
   * get paid, or play it safe and get less. A reward the player cannot see
   * draining is not a decision, it is a surprise, so the timer is on the board
   * rather than in the HUD where nobody looks mid-run. It circles the head,
   * not the target: around the target it answered the question for anyone who
   * watched for the ring, which gutted the discrimination the game exists to
   * teach. Around the head it reads as "your bonus, draining" — and the head
   * is where the player's eye already lives.
   */
  private drawUrgency(x: number, y: number, world: World): void {
    if (!world.alive) return
    const factor = speedBonusFactor(world.targetAge)
    if (factor <= 0) return
    const ctx = this.ctx
    const r = CELL * 0.72
    // Gold while the full bonus holds, cooling to red as it fades.
    ctx.strokeStyle =
      world.targetAge <= SCORING.bonusWindow
        ? THEME.gold
        : mixHex(THEME.shu, THEME.gold, factor)
    ctx.globalAlpha = 0.35 + 0.5 * factor
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TWO_PI * factor)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private drawSnake(world: World, alpha: number): void {
    const ctx = this.ctx
    const { snake, prevSnake, mode } = world
    const len = snake.length
    if (!len) return

    const cellCenter = (v: number) => v * CELL + CELL / 2
    const wrapPx = (v: number) => ((v % W) + W) % W

    /**
     * Interpolated positions.
     *
     * Each rendered index slides from where its index sat last move to where
     * it sits now, which for a shifting body means "one link forward along the
     * tube" — the tube flows rather than teleporting a cell at a time.
     *
     * In wrap mode a segment can cross the board edge mid-move. Lerping the
     * raw grid coordinates would send it sprinting back across the whole board
     * instead. Nudging the previous coordinate to the nearer wrapped copy
     * first makes the short way round the short way in pixels too.
     */
    const pts = snake.map((s, i) => {
      const p = prevSnake[i]
      if (!p) return { x: cellCenter(s.x), y: cellCenter(s.y) }
      let ox = p.x
      let oy = p.y
      if (mode.wrap) {
        if (s.x - ox > BOARD.cells / 2) ox += BOARD.cells
        else if (ox - s.x > BOARD.cells / 2) ox -= BOARD.cells
        if (s.y - oy > BOARD.cells / 2) oy += BOARD.cells
        else if (oy - s.y > BOARD.cells / 2) oy -= BOARD.cells
      }
      const x = lerp(ox, s.x, alpha) * CELL + CELL / 2
      const y = lerp(oy, s.y, alpha) * CELL + CELL / 2
      return mode.wrap ? { x: wrapPx(x), y: wrapPx(y) } : { x, y }
    })

    // Nearest wrapped copy of `to`, relative to `from`.
    const nearest = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
      x: to.x - from.x > W / 2 ? to.x - W : from.x - to.x > W / 2 ? to.x + W : to.x,
      y: to.y - from.y > W / 2 ? to.y - W : from.y - to.y > W / 2 ? to.y + W : to.y,
    })

    /** Draw one body link, splitting it into two strokes across a wrap seam. */
    const link = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (!mode.wrap || Math.hypot(a.x - b.x, a.y - b.y) <= CELL * 1.6) {
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        return
      }
      const b2 = nearest(a, b)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b2.x, b2.y)
      ctx.stroke()
      const a2 = nearest(b, a)
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(a2.x, a2.y)
      ctx.stroke()
    }

    /** Copies of a point just off the opposite edges, so wrapping looks seamless. */
    const mirrors = (p: { x: number; y: number }) => {
      const out = [p]
      if (!mode.wrap) return out
      if (p.x < CELL) out.push({ x: p.x + W, y: p.y })
      if (p.x > W - CELL) out.push({ x: p.x - W, y: p.y })
      if (p.y < CELL) out.push({ x: p.x, y: p.y + W })
      if (p.y > W - CELL) out.push({ x: p.x, y: p.y - W })
      return out
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Body, tail-first so the head overlaps everything behind it. A wrong bite
    // washes the body toward vermilion for as long as the recoil lasts.
    if (this.bodyColors.length !== len) {
      this.bodyColors = Array.from({ length: len }, (_, i) =>
        mixHex(THEME.jade, THEME.jadeDeep, (i / Math.max(1, len - 1)) * 0.8),
      )
    }
    const bodyTint = this.recoil > 0 ? easeOutCubic(this.recoil) * 0.55 : 0
    for (let i = len - 1; i >= 1; i--) {
      const k = i / Math.max(1, len - 1)
      const base = this.bodyColors[i] as string
      ctx.strokeStyle = bodyTint > 0 ? mixHex(base, THEME.shu, bodyTint) : base
      ctx.lineWidth = lerp(CELL * 0.74, CELL * 0.42, k)
      link(pts[i] as { x: number; y: number }, pts[i - 1] as { x: number; y: number })
    }

    // Specular highlight along the spine.
    ctx.strokeStyle = 'rgba(255,255,255,.10)'
    for (let i = len - 1; i >= 1; i--) {
      ctx.lineWidth = lerp(CELL * 0.22, CELL * 0.08, i / Math.max(1, len - 1))
      link(pts[i] as { x: number; y: number }, pts[i - 1] as { x: number; y: number })
    }

    // Earned characters, carried on the body — the run doubles as a record of
    // what you got right.
    ctx.fillStyle = THEME.ink
    for (let i = 1; i < len; i++) {
      const seg = snake[i]
      if (!seg?.ch) continue
      for (const m of mirrors(pts[i] as { x: number; y: number })) {
        glyph(ctx, seg.ch, m.x, m.y, CELL * 0.5, CELL * 0.6, CELL * 0.66)
      }
    }

    this.drawHead(pts[0] as { x: number; y: number }, world, mirrors)
  }

  private drawHead(
    head: { x: number; y: number },
    world: World,
    mirrors: (p: { x: number; y: number }) => Array<{ x: number; y: number }>,
  ): void {
    const ctx = this.ctx
    const dir = world.input.current
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0

    /**
     * Squash and stretch — the oldest trick in animation.
     *
     * Volume is conserved: the head stretches along its direction of travel by
     * exactly as much as it squashes across it. Scaling both axes up just
     * makes a bigger circle; scaling them opposite ways makes it read as an
     * elastic body absorbing an impact.
     */
    const pop = easeOutCubic(this.eatPop)
    const stretch = 1 + pop * JUICE.eatPopScale
    const squash = 1 / stretch
    const r = CELL * 0.44

    for (const h of mirrors(head)) {
      this.drawUrgency(h.x, h.y, world)
      ctx.save()
      ctx.translate(h.x, h.y)
      // Rotate into the direction of travel so squash and stretch align with
      // it, then scale, then draw everything in the head's local frame.
      ctx.rotate(Math.atan2(dy, dx))
      ctx.scale(stretch, squash)

      ctx.fillStyle = THEME.jadeBright
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TWO_PI)
      ctx.fill()

      ctx.fillStyle = THEME.jade
      ctx.beginPath()
      ctx.arc(-r * 0.35, 0, r * 0.62, 0, TWO_PI)
      ctx.fill()

      // Eyes, offset forward and to each side of the travel axis.
      const ex = r * 0.36
      const ey = r * 0.39
      ctx.fillStyle = THEME.ink
      ctx.beginPath()
      ctx.arc(ex, ey, CELL * 0.075, 0, TWO_PI)
      ctx.arc(ex, -ey, CELL * 0.075, 0, TWO_PI)
      ctx.fill()
      ctx.fillStyle = THEME.washi
      ctx.beginPath()
      ctx.arc(ex + 1.5, ey, CELL * 0.028, 0, TWO_PI)
      ctx.arc(ex + 1.5, -ey, CELL * 0.028, 0, TWO_PI)
      ctx.fill()

      // Tongue flick, on a slow cycle. Idle motion keeps the snake feeling
      // alive on the frames where nothing is happening.
      if (Math.floor(this.clock * 1.1) % 3 === 0) {
        ctx.strokeStyle = THEME.shu
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(r, 0)
        ctx.lineTo(r + CELL * 0.28, 0)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  /** Board-space centre of a tile, for placing effects at a collision. */
  centerOf(item: Item): { x: number; y: number } {
    return { x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2 }
  }

  get element(): HTMLCanvasElement {
    return this.canvas
  }
}
