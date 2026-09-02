import { BOARD, CELL, FONTS, JUICE, THEME } from '../game/config'
import { SCORING } from '../game/config'
import type { Dir } from '../core/input'
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
  ctx.font = glyphFont(s)
  ctx.fillText(ch, x, y + ((m.asc - m.desc) * s) / 2)
  ctx.textBaseline = 'middle'
}

/**
 * Font shorthand strings, cached by half-pixel size.
 *
 * Assigning ctx.font builds a string AND makes the engine re-parse the
 * shorthand, and this ran for every glyph on the board and every character
 * riding the snake, every frame. Quantising to half a pixel is invisible and
 * turns thousands of fresh strings a second into a handful of reused ones.
 */
const fontCache = new Map<number, string>()
function glyphFont(size: number): string {
  const key = Math.round(size * 2) / 2
  let f = fontCache.get(key)
  if (f === undefined) {
    f = `700 ${key}px ${FONTS.glyph}`
    fontCache.set(key, f)
  }
  return f
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

/** Fixed angle of a grid direction — the heading fallback for the one frame
 *  where the neck vector degenerates (spawn, or a wrap seam edge case). */
const DIR_ANGLE: Readonly<Record<Dir, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
}
const dirAngle = (dir: Dir): number => DIR_ANGLE[dir]

export interface RenderOptions {
  /** Draw the pause veil over the board. */
  paused: boolean
  /** Dim everything — used behind the game-over card. */
  dimmed: boolean
}

export class Renderer {
  readonly camera = new Camera()
  readonly fx = new FxSystem()
  /** Water ripples, drawn UNDER the board contents: the snake's wake and the
   *  plunk of arriving tiles disturb the seigaiha field, so the "water" the
   *  art claims is there behaves like it. Fed by the composition root off
   *  world events; a second FxSystem so reduced motion silences it the same
   *  way as everything else. */
  readonly wake = new FxSystem()
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
  /** Reused interpolated-position buffer; see drawSnake. */
  private ptsBuf: Array<{ x: number; y: number }> = []
  /** Reused wrap-mirror buffer, flat x,y pairs; see drawSnake. */
  private mirrorBuf: number[] = []
  /** Reused spline-segment buffer, six numbers per stroke; see drawSnake. */
  private segBuf: number[] = []

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    // Start at the old fixed size so the board is never under-resolved: the
    // canvas lives inside a hidden screen at construction and therefore has
    // no measurable box yet. Leaving it unset would have handed the browser
    // its 300px default.
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(W * this.dpr)
    canvas.height = Math.round(W * this.dpr)
    this.background = createBackground(this.dpr)
    // A ResizeObserver, not just a window listener: the important event is the
    // canvas getting its first real size when the play screen is shown, which
    // no window resize accompanies.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(canvas)
    } else {
      addEventListener('resize', () => this.resize())
    }
    // Metrics measured before the webfonts arrive describe the fallback font.
    // Flush the cache when loading settles so glyphs re-centre correctly.
    document.fonts?.addEventListener('loadingdone', () => metricsCache.clear())
  }

  /**
   * Match the backing store to the element's ACTUAL size in device pixels.
   *
   * It used to be a fixed 640 x DPR. On a 3x phone that produced a 1280px
   * buffer displayed across roughly 1146 device pixels — a non-integer
   * downscale that the compositor had to resample on every single frame, and
   * ~20% more pixels than the screen could show. Sizing to the real box makes
   * the blit 1:1. The drawing code keeps its 640-unit coordinate space; only
   * the transform scale changes.
   */
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width) return
    // Cap the scale: past ~2x the extra pixels cost quadratically for a
    // difference nobody can see on a board made of flat colour.
    const scale = Math.min(2, (rect.width * (window.devicePixelRatio || 1)) / W)
    if (Math.abs(scale - this.dpr) < 0.01) return
    this.dpr = scale
    this.canvas.width = Math.round(W * scale)
    this.canvas.height = Math.round(W * scale)
    this.background = createBackground(scale)
  }

  /** Apply the reduced-motion preference across every effect system at once. */
  setMotion(enabled: boolean): void {
    const v = enabled ? 1 : 0
    this.camera.intensity = v
    this.fx.intensity = v
    this.wake.intensity = v
    this.flash.intensity = v
  }

  reset(): void {
    this.fx.clear()
    this.wake.clear()
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
    this.wake.update(realDt)
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

    // Ripples first: water is under everything that floats on it.
    this.wake.draw(ctx)
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
      // but a bare glyph has nothing to escape. Dropping the card also bought
      // room for much bigger ink.
      //
      // The lift off the wave field is a hand-drawn drop copy rather than
      // ctx.shadowBlur. A blurred shadow is one of the most expensive things
      // a 2-D canvas can do and this runs for every tile on every frame; two
      // fillText calls cost a fraction of one blur.
      const text = world.reverse ? world.soundOf(it.ch) : it.ch
      // Reverse level: tiles show the SOUND; the cue shows the glyph.
      const size = (world.reverse ? CELL * 0.46 : CELL * 0.88) * scale
      ctx.fillStyle = 'rgba(0,0,0,.5)'
      glyph(ctx, text, x + 1, y + 2, size, CELL, CELL)
      ctx.fillStyle = THEME.washi
      glyph(ctx, text, x, y, size, CELL, CELL)
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
    const r = CELL * 0.76
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
    // Written into a buffer that persists across frames rather than mapped
    // into a fresh array of fresh objects. At 60fps a long snake was
    // allocating well over a thousand short-lived objects a second, and the
    // collector that eventually reclaims them does so by stopping the world —
    // on a phone, exactly the kind of pause that reads as the snake lurching.
    const pts = this.ptsBuf
    if (pts.length < len) {
      while (pts.length < len) pts.push({ x: 0, y: 0 })
    } else if (pts.length > len) {
      pts.length = len
    }
    for (let i = 0; i < len; i++) {
      const s = snake[i] as { x: number; y: number }
      const out = pts[i] as { x: number; y: number }
      const p = prevSnake[i]
      if (!p) {
        out.x = cellCenter(s.x)
        out.y = cellCenter(s.y)
        continue
      }
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
      out.x = mode.wrap ? wrapPx(x) : x
      out.y = mode.wrap ? wrapPx(y) : y
    }

    // Nearest wrapped copy of coordinate `b`, as seen from `a`.
    const near = (a: number, b: number): number =>
      b - a > W / 2 ? b - W : a - b > W / 2 ? b + W : b

    /**
     * Spline geometry, built once per frame and stroked twice (body, then
     * specular). Straight strokes between grid points gave the body a visible
     * elbow at every turn — a chain of capsules, not a creature. The classic
     * midpoint construction fixes it: each interior point contributes one
     * quadratic, from the midpoint behind it to the midpoint ahead, with the
     * point itself as control. Consecutive strokes share their endpoints, so
     * the chain is a single smooth curve, and per-stroke width/colour keeps
     * the taper and gradient the old per-link version had.
     *
     * Wrap seams: each stroke's neighbours are pulled to their nearest
     * wrapped copies first, so the curve is locally continuous; a stroke
     * that then hangs off the board is re-drawn shifted by ±W (strokeSeg).
     *
     * Written tail-first into a flat reused buffer — six numbers per stroke,
     * no per-frame allocation — so both passes replay identical geometry.
     */
    const segs = this.segBuf
    for (let j = len - 1; j >= 0; j--) {
      const o = (len - 1 - j) * 6
      const p = pts[j] as { x: number; y: number }
      if (j > 0 && j < len - 1) {
        // Interior: midpoint-to-midpoint quadratic through the point.
        const a = pts[j + 1] as { x: number; y: number }
        const b = pts[j - 1] as { x: number; y: number }
        segs[o] = (p.x + near(p.x, a.x)) / 2
        segs[o + 1] = (p.y + near(p.y, a.y)) / 2
        segs[o + 2] = p.x
        segs[o + 3] = p.y
        segs[o + 4] = (p.x + near(p.x, b.x)) / 2
        segs[o + 5] = (p.y + near(p.y, b.y)) / 2
      } else {
        // End caps: half a link, straight (control point on the line), from
        // the tail tip / head centre to the first shared midpoint.
        const q = pts[j === 0 ? 1 : j - 1] ?? p
        const mx = (p.x + near(p.x, q.x)) / 2
        const my = (p.y + near(p.y, q.y)) / 2
        segs[o] = j === 0 ? mx : p.x
        segs[o + 1] = j === 0 ? my : p.y
        segs[o + 4] = j === 0 ? p.x : mx
        segs[o + 5] = j === 0 ? p.y : my
        segs[o + 2] = ((segs[o] as number) + (segs[o + 4] as number)) / 2
        segs[o + 3] = ((segs[o + 1] as number) + (segs[o + 5] as number)) / 2
      }
    }

    /** Stroke stored segment k, plus wrapped copies where it leaves the board. */
    const strokeSeg = (k: number): void => {
      const o = k * 6
      const x1 = segs[o] as number
      const y1 = segs[o + 1] as number
      const cx = segs[o + 2] as number
      const cy = segs[o + 3] as number
      const x2 = segs[o + 4] as number
      const y2 = segs[o + 5] as number
      const one = (dx: number, dy: number): void => {
        ctx.beginPath()
        ctx.moveTo(x1 + dx, y1 + dy)
        ctx.quadraticCurveTo(cx + dx, cy + dy, x2 + dx, y2 + dy)
        ctx.stroke()
      }
      one(0, 0)
      if (mode.wrap) {
        // The SAME one-cell band fillMirrors uses for the head and the
        // carried glyphs. Mirroring only once a segment had crossed the edge
        // meant a mirrored head could appear with no body and no shadow
        // beneath it for up to half a move. Copies that land off-canvas are
        // clipped and cost nothing.
        const sx =
          Math.min(x1, cx, x2) < CELL ? W : Math.max(x1, cx, x2) > W - CELL ? -W : 0
        const sy =
          Math.min(y1, cy, y2) < CELL ? W : Math.max(y1, cy, y2) > W - CELL ? -W : 0
        if (sx) one(sx, 0)
        if (sy) one(0, sy)
        if (sx && sy) one(sx, sy)
      }
    }

    /**
     * The same geometry as strokeSeg, but only ADDED to the current path —
     * the caller strokes every segment in one operation. Used by the
     * elevation shadow, where per-segment strokes would overlap and
     * double-darken at each junction.
     */
    const addSeg = (k: number): void => {
      const o = k * 6
      const x1 = segs[o] as number
      const y1 = segs[o + 1] as number
      const cx = segs[o + 2] as number
      const cy = segs[o + 3] as number
      const x2 = segs[o + 4] as number
      const y2 = segs[o + 5] as number
      const one = (dx: number, dy: number): void => {
        ctx.moveTo(x1 + dx, y1 + dy)
        ctx.quadraticCurveTo(cx + dx, cy + dy, x2 + dx, y2 + dy)
      }
      one(0, 0)
      if (mode.wrap) {
        // The SAME one-cell band fillMirrors uses for the head and the
        // carried glyphs. Mirroring only once a segment had crossed the edge
        // meant a mirrored head could appear with no body and no shadow
        // beneath it for up to half a move. Copies that land off-canvas are
        // clipped and cost nothing.
        const sx =
          Math.min(x1, cx, x2) < CELL ? W : Math.max(x1, cx, x2) > W - CELL ? -W : 0
        const sy =
          Math.min(y1, cy, y2) < CELL ? W : Math.max(y1, cy, y2) > W - CELL ? -W : 0
        if (sx) one(sx, 0)
        if (sy) one(0, sy)
        if (sx && sy) one(sx, sy)
      }
    }

    /**
     * Copies of a point just off the opposite edges, so wrapping looks
     * seamless — written as flat x,y pairs into a buffer that outlives the
     * frame, and returning how many numbers were written. The previous
     * version built a fresh array (and fresh point objects) per call, and it
     * is called for every character riding the snake on every frame.
     */
    const mbuf = this.mirrorBuf
    const fillMirrors = (x: number, y: number): number => {
      mbuf[0] = x
      mbuf[1] = y
      let n = 2
      if (!mode.wrap) return n
      if (x < CELL) { mbuf[n++] = x + W; mbuf[n++] = y }
      if (x > W - CELL) { mbuf[n++] = x - W; mbuf[n++] = y }
      if (y < CELL) { mbuf[n++] = x; mbuf[n++] = y + W }
      if (y > W - CELL) { mbuf[n++] = x; mbuf[n++] = y - W }
      return n
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
    const denom = Math.max(1, len - 1)

    /**
     * ELEVATION. The wake claims the board is water; this shadow makes the
     * snake ride ABOVE it: one flat dark pass, offset down-right, drawn
     * before everything else it belongs under. A translate is far cheaper
     * than any canvas shadow, and the offset matches the drop copies under
     * every glyph, so the whole scene agrees where the light is.
     *
     * ONE path, ONE stroke, ONE width. Stroking segment-by-segment layered
     * translucent round caps on every junction — 1-(1-.26)^2 = 45% black
     * instead of 26%, a visible chain of dark scallops down the rim that the
     * opaque body pass hides but the shadow cannot. A single stroke of the
     * whole spline composites each pixel exactly once. The width is constant
     * for the same reason a real shadow's is: it tracks height above the
     * surface, not the thickness of what casts it. The round cap at the head
     * end covers the head, so the head needs no shadow of its own — drawn
     * inside drawHead it would land ON TOP of the body, the carried glyphs
     * and the urgency ring, since that runs after all three.
     */
    ctx.save()
    ctx.translate(3, 5)
    ctx.strokeStyle = 'rgba(0,0,0,.3)'
    // NARROWER than the body's thinnest point (0.46 at the tail), never
    // wider. A shadow that outgrows its caster peeks out on the LIT side —
    // up-left of the tail, where a down-right light cannot put one. Held
    // under the minimum, the offset alone decides where it shows.
    ctx.lineWidth = CELL * 0.42
    ctx.beginPath()
    for (let k = 0; k < len; k++) addSeg(k)
    ctx.stroke()
    ctx.restore()

    for (let k = 0; k < len; k++) {
      const j = len - 1 - k
      const base = this.bodyColors[j] as string
      ctx.strokeStyle = bodyTint > 0 ? mixHex(base, THEME.shu, bodyTint) : base
      ctx.lineWidth = lerp(CELL * 0.8, CELL * 0.46, j / denom)
      strokeSeg(k)
    }

    // Specular highlight along the spine — one path, one stroke, for the
    // same reason as the shadow: per-segment strokes of a translucent colour
    // composite twice under every round cap, drawing a chain of bright
    // scallops down the spine instead of an even highlight.
    ctx.strokeStyle = 'rgba(255,255,255,.10)'
    ctx.lineWidth = CELL * 0.15
    ctx.beginPath()
    for (let k = 0; k < len; k++) addSeg(k)
    ctx.stroke()

    // Earned characters, carried on the body — the run doubles as a record of
    // what you got right.
    ctx.fillStyle = THEME.ink
    for (let i = 1; i < len; i++) {
      const seg = snake[i]
      if (!seg?.ch) continue
      const p = pts[i] as { x: number; y: number }
      const n = fillMirrors(p.x, p.y)
      for (let k = 0; k < n; k += 2) {
        glyph(ctx, seg.ch, mbuf[k] as number, mbuf[k + 1] as number,
          CELL * 0.5, CELL * 0.6, CELL * 0.66)
      }
    }

    const head = pts[0] as { x: number; y: number }

    /**
     * Heading from the neck geometry, not the input direction. The neck
     * vector interpolates through a turn — old direction at the start of the
     * move, new direction at the end — so the head carves smoothly around a
     * corner instead of snapping 90° the frame the turn commits.
     */
    const neck = pts[1]
    let angle: number
    if (neck) {
      const hdx = head.x - near(head.x, neck.x)
      const hdy = head.y - near(head.y, neck.y)
      angle = hdx || hdy ? Math.atan2(hdy, hdx) : dirAngle(world.input.current)
    } else {
      angle = dirAngle(world.input.current)
    }

    // Where the eyes look: the target tile (any of them in a word level),
    // via its nearest wrapped copy. The vector stays in board space here;
    // drawHead rotates it into the head's local frame.
    let lookX = 0
    let lookY = 0
    let hasLook = false
    for (const it of world.items) {
      if (!it.correct) continue
      lookX = near(head.x, it.x * CELL + CELL / 2) - head.x
      lookY = near(head.y, it.y * CELL + CELL / 2) - head.y
      hasLook = true
      break
    }

    const hn = fillMirrors(head.x, head.y)
    // Copy out: drawHead calls fillMirrors' buffer owner again indirectly.
    const heads: number[] = []
    for (let k = 0; k < hn; k++) heads.push(mbuf[k] as number)
    this.drawHead(heads, world, angle, hasLook, lookX, lookY)
  }

  private drawHead(
    heads: number[],
    world: World,
    angle: number,
    hasLook: boolean,
    lookX: number,
    lookY: number,
  ): void {
    const ctx = this.ctx

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
    const r = CELL * 0.47

    /**
     * Blink, on a cycle that shares no small common multiple with the tongue
     * flick, so the two idle motions never sync into a metronome. The lids
     * close and open inside ~140ms — a real blink, not a wink for the camera.
     */
    const bt = this.clock % 4.3
    const blink = bt < 0.14 ? Math.sin((bt / 0.14) * Math.PI) : 0

    /**
     * The pupils track the target tile — an eye saccade is the cheapest
     * "this creature is thinking" signal in animation, and a snake that
     * visibly looks at the character it wants is on-theme to the bone.
     * Rotate the board-space look vector into the head's local frame and
     * clamp it so the catchlight stays inside the eye.
     */
    let px = 1.5
    let py = 0
    if (hasLook) {
      const cos = Math.cos(-angle)
      const sin = Math.sin(-angle)
      const lx = lookX * cos - lookY * sin
      const ly = lookX * sin + lookY * cos
      const m = Math.hypot(lx, ly)
      if (m > 1) {
        const s = (CELL * 0.035) / m
        px = lx * s
        py = ly * s
      }
    }

    for (let k = 0; k < heads.length; k += 2) {
      const hx = heads[k] as number
      const hy = heads[k + 1] as number
      this.drawUrgency(hx, hy, world)
      ctx.save()
      ctx.translate(hx, hy)
      // Rotate into the direction of travel so squash and stretch align with
      // it, then scale, then draw everything in the head's local frame.
      ctx.rotate(angle)
      ctx.scale(stretch, squash)

      ctx.fillStyle = THEME.jadeBright
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, TWO_PI)
      ctx.fill()

      ctx.fillStyle = THEME.jade
      ctx.beginPath()
      ctx.arc(-r * 0.35, 0, r * 0.62, 0, TWO_PI)
      ctx.fill()

      // Eyes, offset forward and to each side of the travel axis; the blink
      // squashes the ink vertically in the head's local frame.
      const ex = r * 0.36
      const ey = r * 0.39
      const er = CELL * 0.075
      ctx.fillStyle = THEME.ink
      ctx.beginPath()
      ctx.ellipse(ex, ey, er, er * (1 - 0.85 * blink), 0, 0, TWO_PI)
      ctx.ellipse(ex, -ey, er, er * (1 - 0.85 * blink), 0, 0, TWO_PI)
      ctx.fill()
      if (blink < 0.5) {
        ctx.fillStyle = THEME.washi
        ctx.beginPath()
        ctx.arc(ex + px, ey + py, CELL * 0.028, 0, TWO_PI)
        ctx.arc(ex + px, -ey + py, CELL * 0.028, 0, TWO_PI)
        ctx.fill()
      }

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
