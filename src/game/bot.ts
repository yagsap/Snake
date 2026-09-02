import { BOARD } from './config'
import { DIR_VECTORS, type Dir } from '../core/input'
import type { World } from './world'

/**
 * The demo pilot, promoted from the test harness so the attract mode behind
 * onboarding shows a REAL game playing itself: greedy pathing toward the
 * correct tile, wrong tiles repelled, one-step lookahead so it rarely traps
 * itself. Math.random is fine here — the demo is scenery, not simulation the
 * daily depends on.
 */
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right']
const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

export function botTurn(w: World): void {
  if (!w.alive) return
  const head = w.snake[0]
  if (!head) return
  const cells = BOARD.cells
  const wrap = w.mode.wrap
  const target = w.items.find((i) => i.correct)

  const occupied = new Set<number>()
  for (let i = 0; i < w.snake.length - 1; i++) {
    const s = w.snake[i] as { x: number; y: number }
    occupied.add(s.y * cells + s.x)
  }
  for (const c of w.obstacles) occupied.add(c)

  const cur = w.input.current
  let best: Dir | null = null
  let bestScore = -Infinity
  for (const d of DIRS) {
    if (d === OPPOSITE[cur]) continue
    const v = DIR_VECTORS[d]
    let nx = head.x + v.x
    let ny = head.y + v.y
    if (wrap) {
      nx = (nx + cells) % cells
      ny = (ny + cells) % cells
    } else if (nx < 0 || ny < 0 || nx >= cells || ny >= cells) continue
    if (occupied.has(ny * cells + nx)) continue

    let score = 0
    const item = w.items.find((i) => i.x === nx && i.y === ny)
    if (item && !item.correct) score -= 60
    if (target) {
      let dx = Math.abs(target.x - nx)
      let dy = Math.abs(target.y - ny)
      if (wrap) {
        dx = Math.min(dx, cells - dx)
        dy = Math.min(dy, cells - dy)
      }
      score -= dx + dy
    }
    let freedom = 0
    for (const d2 of DIRS) {
      const v2 = DIR_VECTORS[d2]
      let mx = nx + v2.x
      let my = ny + v2.y
      if (wrap) {
        mx = (mx + cells) % cells
        my = (my + cells) % cells
      } else if (mx < 0 || my < 0 || mx >= cells || my >= cells) continue
      if (!occupied.has(my * cells + mx)) freedom++
    }
    if (freedom === 0) score -= 1000
    score += Math.random() * 0.01
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  if (best && best !== cur) w.turn(best)
}
