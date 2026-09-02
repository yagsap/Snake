import { FONTS } from '../game/config'

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

export function metricsFor(
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
export function glyph(
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

/** Drop the measured metrics — call when webfonts finish loading, since
 *  anything measured before then described the fallback face. */
export function clearMetricsCache(): void {
  metricsCache.clear()
}
