import { BOARD, CELL, THEME } from '../game/config'

/**
 * The seigaiha (青海波) wave field behind the board.
 *
 * Rendered once into an offscreen canvas at startup and blitted every frame.
 * It is a few thousand arc strokes; drawing it per frame would burn most of
 * the frame budget on pixels that never change. Baking static art into a
 * texture is the oldest optimisation in 2-D rendering and still the right one.
 */
export function createBackground(dpr: number): HTMLCanvasElement {
  const W = BOARD.size
  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = W * dpr

  const b = canvas.getContext('2d')
  if (!b) return canvas
  b.scale(dpr, dpr)

  b.fillStyle = THEME.indigo
  b.fillRect(0, 0, W, W)

  // Overlapping concentric arcs, offset every other row — the classic pattern.
  const R = CELL * 1.25
  b.lineWidth = 1
  for (let row = -1; row * R < W + R; row++) {
    const y = row * R
    const offset = (row % 2) * R
    for (let x = -R + offset; x < W + R; x += 2 * R) {
      b.fillStyle = THEME.indigo
      b.beginPath()
      b.arc(x, y, R, 0, Math.PI * 2)
      b.fill()
      for (let k = 0; k < 4; k++) {
        b.strokeStyle = `rgba(154,209,178,${0.085 - k * 0.015})`
        b.beginPath()
        b.arc(x, y, R - (k * R) / 4, 0, Math.PI * 2)
        b.stroke()
      }
    }
  }

  // Lattice dots at cell corners: enough to read the grid, not enough to
  // compete with the glyphs the player is supposed to be reading.
  b.fillStyle = 'rgba(241,237,227,0.10)'
  for (let i = 0; i <= BOARD.cells; i++) {
    for (let j = 0; j <= BOARD.cells; j++) {
      b.beginPath()
      b.arc(i * CELL, j * CELL, 1.1, 0, Math.PI * 2)
      b.fill()
    }
  }

  // Vignette, to pull the eye to the centre of the board.
  const v = b.createRadialGradient(W / 2, W / 2, W * 0.35, W / 2, W / 2, W * 0.75)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,.35)')
  b.fillStyle = v
  b.fillRect(0, 0, W, W)

  return canvas
}

/**
 * The lethal border, drawn only in wall modes.
 *
 * In a mode where the edge kills you, the edge has to *look* like it kills you.
 * A rule the player can only learn by dying to it is a bad rule; a rule the
 * board states up front is a good one.
 */
export function drawWalls(ctx: CanvasRenderingContext2D, danger: number): void {
  const W = BOARD.size
  const inset = 2
  const thickness = 5

  ctx.save()
  ctx.strokeStyle = THEME.shu
  ctx.globalAlpha = 0.45 + 0.35 * danger
  ctx.lineWidth = thickness
  ctx.strokeRect(inset, inset, W - inset * 2, W - inset * 2)

  // Corner ticks, borrowed from the seal motif, so the frame reads as drawn
  // rather than as a stray canvas outline.
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 3
  const t = CELL * 0.55
  const corners: Array<[number, number, number, number]> = [
    [inset, inset, 1, 1],
    [W - inset, inset, -1, 1],
    [inset, W - inset, 1, -1],
    [W - inset, W - inset, -1, -1],
  ]
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath()
    ctx.moveTo(cx + sx * t, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + sy * t)
    ctx.stroke()
  }
  ctx.restore()
}
