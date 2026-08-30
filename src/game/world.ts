import { EventBus } from '../core/events'
import { DirectionBuffer, DIR_VECTORS, type Dir } from '../core/input'
import { Rng } from '../core/rng'
import type { CharStat } from '../core/storage'
import type { CharTable } from '../data/scripts'
import { BOARD, SNAKE, SPAWN } from './config'
import type { Mode } from './modes'
import { awardFor, moveInterval, type Award } from './progression'
import { chooseDistractors, chooseTarget, freeCells } from './spawn'

export interface Segment {
  x: number
  y: number
  /** The character this segment was earned with, drawn on the body. */
  ch: string
}

export interface Item {
  x: number
  y: number
  ch: string
  correct: boolean
  /** Random phase so tiles don't bob in lockstep. */
  phase: number
  /** Seconds since this tile appeared. Drives its entry animation. */
  age: number
}

export type DeathReason = 'self' | 'wall'

/**
 * What the simulation announces. Note what is *not* here: no DOM nodes, no
 * canvas, no audio. The world can be stepped in a test with no document at all.
 */
export type WorldEvents = {
  spawned: { target: string; sound: string }
  eat: { item: Item; award: Award; streak: number; score: number }
  wrong: { item: Item; target: string; targetSound: string }
  death: { reason: DeathReason; score: number; eaten: number }
  /** Emitted after every committed move, for step-locked effects. */
  moved: { grew: boolean }
}

export interface WorldOptions {
  table: CharTable
  stats: Record<string, CharStat>
  mode: Mode
  seed?: number
}

const idx = (x: number, y: number): number => y * BOARD.cells + x

export class World {
  readonly events = new EventBus<WorldEvents>()
  readonly rng: Rng
  readonly mode: Mode

  private table: CharTable
  private stats: Record<string, CharStat>

  snake: Segment[] = []
  /** Positions at the last committed move, for render interpolation. */
  prevSnake: Segment[] = []
  items: Item[] = []

  readonly input: DirectionBuffer
  target: string | null = null
  /** Seconds the current target has been on the board — drives the speed bonus. */
  targetAge = 0

  score = 0
  /** Characters correctly eaten. Drives the pace ramp; also the learning stat. */
  eaten = 0
  streak = 0
  bestStreak = 0
  mistakes = 0
  elapsed = 0
  /** Characters missed in THIS run (not all-time), for the end-of-run review. */
  readonly runErrors = new Map<string, number>()

  alive = true
  interval: number
  /** Time accumulated toward the next move. Also the render interpolation phase. */
  private moveClock = 0
  private lastTarget: string | null = null

  constructor(opts: WorldOptions) {
    this.table = opts.table
    this.stats = opts.stats
    this.mode = opts.mode
    this.rng = new Rng(opts.seed)
    this.input = new DirectionBuffer('right')
    this.interval = moveInterval(0, this.mode)
    // No spawn here: reset() emits 'spawned', and the caller has not had a
    // chance to subscribe yet. The owner calls reset() once listeners exist.
  }

  /**
   * 0..1 through the current move, for render interpolation. `extra` is the
   * loop's not-yet-simulated remainder in seconds (loop alpha x FIXED_DT),
   * folded in so drawn positions track real time instead of quantizing to
   * fixed steps — without it the snake visibly micro-stutters.
   */
  renderAlpha(extra = 0): number {
    return Math.min(1, (this.moveClock + extra) / this.interval)
  }

  reset(): void {
    const mid = Math.floor(BOARD.cells / 2)
    this.snake = []
    for (let i = 0; i < SNAKE.startLength; i++) {
      this.snake.push({ x: mid - i, y: mid, ch: '' })
    }
    this.prevSnake = this.snake.map((s) => ({ ...s }))
    this.input.reset('right')
    this.items = []
    this.score = 0
    this.eaten = 0
    this.streak = 0
    this.bestStreak = 0
    this.mistakes = 0
    this.elapsed = 0
    this.runErrors.clear()
    this.alive = true
    this.moveClock = 0
    this.lastTarget = null
    this.interval = moveInterval(0, this.mode)
    this.spawn()
  }

  turn(dir: Dir): boolean {
    return this.alive ? this.input.push(dir) : false
  }

  /**
   * Advance by exactly one fixed simulation step.
   *
   * Real time drives a clock; the snake moves when the clock fills. Because
   * `dt` is constant (see GameLoop) this is deterministic: same seed and same
   * inputs give the same run, on any machine, at any refresh rate.
   */
  update(dt: number): void {
    if (!this.alive) return
    this.elapsed += dt
    this.targetAge += dt
    for (const it of this.items) it.age += dt

    this.moveClock += dt
    // `while`, not `if`: a step could be long enough to owe more than one move
    // at high speed, and skipping the debt would make the snake stutter.
    while (this.alive && this.moveClock >= this.interval) {
      this.moveClock -= this.interval
      this.step()
    }
  }

  private setInterval(next: number): void {
    // Preserve where we are within the move so a speed change does not snap
    // the snake forward or backward by a fraction of a cell.
    const phase = this.moveClock / this.interval
    this.interval = next
    this.moveClock = phase * next
  }

  private step(): void {
    this.prevSnake = this.snake.map((s) => ({ ...s }))

    const dir = this.input.consume()
    const v = DIR_VECTORS[dir]
    const head = this.snake[0]
    if (!head) return

    let nx = head.x + v.x
    let ny = head.y + v.y

    if (this.mode.wrap) {
      nx = (nx + BOARD.cells) % BOARD.cells
      ny = (ny + BOARD.cells) % BOARD.cells
    } else if (nx < 0 || ny < 0 || nx >= BOARD.cells || ny >= BOARD.cells) {
      this.die('wall')
      return
    }

    const hitIndex = this.items.findIndex((i) => i.x === nx && i.y === ny)
    const hit = hitIndex >= 0 ? this.items[hitIndex] : undefined
    const growing = hit?.correct === true

    /**
     * Self-collision, correctly.
     *
     * The last segment vacates its cell this very step unless we are growing,
     * so moving into it is legal — that is how a snake follows its own tail
     * around a tight loop. The prototype tested every segment including the
     * tail and killed you for a move that was never actually a collision.
     */
    const bodyEnd = growing ? this.snake.length : this.snake.length - 1
    for (let i = 0; i < bodyEnd; i++) {
      const s = this.snake[i]
      if (s && s.x === nx && s.y === ny) {
        this.die('self')
        return
      }
    }

    const newHead: Segment = { x: nx, y: ny, ch: '' }

    if (hit && hitIndex >= 0) {
      if (hit.correct) {
        newHead.ch = hit.ch
        this.snake.unshift(newHead)
        this.onCorrect(hit)
      } else {
        this.snake.unshift(newHead)
        this.onWrong(hit, hitIndex)
      }
    } else {
      this.snake.unshift(newHead)
      this.snake.pop()
    }

    this.events.emit('moved', { grew: growing })
  }

  private onCorrect(item: Item): void {
    // Streak first, then the award: the bite that REACHES a multiplier is the
    // bite that gets paid at it, so the gold "x2" celebration and the "+N"
    // popup beside it can never contradict each other.
    this.streak += 1
    const award = awardFor(this.streak, this.targetAge, this.mode)
    this.score += award.points
    this.eaten += 1
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.statFor(item.ch).ok += 1
    this.setInterval(moveInterval(this.eaten, this.mode))

    this.events.emit('eat', {
      item,
      award,
      streak: this.streak,
      score: this.score,
    })
    this.spawn()
  }

  private onWrong(item: Item, hitIndex: number): void {
    // Shrink, but never past the floor — a run should end because you crashed,
    // not because the snake quietly evaporated.
    for (let i = 0; i < SNAKE.wrongBitePenalty; i++) {
      if (this.snake.length > SNAKE.minLength) this.snake.pop()
    }
    this.streak = 0
    this.mistakes += 1

    const target = this.target
    if (target) {
      this.statFor(target).err += 1
      this.runErrors.set(target, (this.runErrors.get(target) ?? 0) + 1)
    }
    this.statFor(item.ch).err += 1
    this.runErrors.set(item.ch, (this.runErrors.get(item.ch) ?? 0) + 1)

    this.events.emit('wrong', {
      item,
      target: target ?? '',
      targetSound: target ? (this.table[target] ?? '') : '',
    })

    // Move the bitten distractor elsewhere instead of removing it: keeping the
    // same five options on the board means the question stays as hard as it
    // was, so a wrong guess cannot be used to narrow the field.
    this.items.splice(hitIndex, 1)
    const spot = this.firstFreeCell()
    if (spot) {
      this.items.push({
        x: spot.x,
        y: spot.y,
        ch: item.ch,
        correct: false,
        phase: this.rng.range(0, Math.PI * 2),
        age: 0,
      })
    }
  }

  private die(reason: DeathReason): void {
    this.alive = false
    this.events.emit('death', {
      reason,
      score: this.score,
      eaten: this.eaten,
    })
  }

  private statFor(ch: string): CharStat {
    let s = this.stats[ch]
    if (!s) this.stats[ch] = s = { ok: 0, err: 0 }
    return s
  }

  /**
   * Free cells with a fairness guarantee: cells the head can reach within the
   * next two moves (Manhattan distance <= 2, wrap-aware) are placed last, so
   * a tile never materializes in the snake's path on the very step it spawns
   * — that was an unavoidable wrong bite about 1.5% of the time. Near-full
   * boards still fall back to the excluded zone rather than failing to spawn.
   */
  private spawnCells(): number[] {
    const free = freeCells(BOARD.cells, this.occupied(), this.rng)
    const head = this.snake[0]
    if (!head) return free
    const danger = new Set<number>()
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue
        let x = head.x + dx
        let y = head.y + dy
        if (this.mode.wrap) {
          x = (x + BOARD.cells) % BOARD.cells
          y = (y + BOARD.cells) % BOARD.cells
        } else if (x < 0 || y < 0 || x >= BOARD.cells || y >= BOARD.cells) {
          continue
        }
        danger.add(idx(x, y))
      }
    }
    const safe = free.filter((c) => !danger.has(c))
    return safe.length ? [...safe, ...free.filter((c) => danger.has(c))] : free
  }

  private occupied(): Set<number> {
    const set = new Set<number>()
    for (const s of this.snake) set.add(idx(s.x, s.y))
    for (const i of this.items) set.add(idx(i.x, i.y))
    return set
  }

  private firstFreeCell(): { x: number; y: number } | null {
    const free = this.spawnCells()
    const cell = free[0]
    if (cell === undefined) return null
    return { x: cell % BOARD.cells, y: Math.floor(cell / BOARD.cells) }
  }

  /** Pick a new target and lay it out with its distractors. */
  private spawn(): void {
    this.items = []
    this.targetAge = 0

    const target = chooseTarget(this.table, this.stats, this.rng, this.lastTarget)
    if (!target) return
    this.target = target
    this.lastTarget = target

    const distractors = chooseDistractors(
      this.table,
      target,
      this.rng,
      Math.min(SPAWN.distractors, Math.max(0, Object.keys(this.table).length - 1)),
    )

    const free = this.spawnCells()
    const wanted = [target, ...distractors]
    // If the board is nearly full there may be fewer cells than characters.
    // Place what fits — the target is first in the list, so it always lands.
    for (let i = 0; i < wanted.length && i < free.length; i++) {
      const cell = free[i] as number
      this.items.push({
        x: cell % BOARD.cells,
        y: Math.floor(cell / BOARD.cells),
        ch: wanted[i] as string,
        correct: i === 0,
        phase: this.rng.range(0, Math.PI * 2),
        age: 0,
      })
    }

    this.events.emit('spawned', {
      target,
      sound: this.table[target] ?? '',
    })
  }
}
