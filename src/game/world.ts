import { EventBus } from '../core/events'
import { DirectionBuffer, DIR_VECTORS, type Dir } from '../core/input'
import { Rng } from '../core/rng'
import type { CharStat } from '../core/storage'
import type { CharTable } from '../data/scripts'
import { BOARD, SNAKE, SPAWN } from './config'
import type { Mode } from './modes'
import {
  awardFor,
  demote,
  isMastered,
  moveInterval,
  promote,
  type Award,
} from './progression'
import { chooseDistractors, chooseTarget, freeCells } from './spawn'
import { confusablesOf } from '../data/scripts'
import type { WordEntry } from './levels'

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
  /** This bite pushed a character over the mastery line — celebrate it. */
  mastered: { item: Item; ch: string; sound: string }
  /** A word level advanced one character (the word is not finished yet). */
  wordProgress: { entry: WordEntry; index: number }
  /** A whole word was completed. */
  wordDone: { entry: WordEntry }
}

export interface WorldOptions {
  table: CharTable
  stats: Record<string, CharStat>
  mode: Mode
  seed?: number
  /** Word-level mode: cues are whole words, eaten character by character. */
  words?: readonly WordEntry[]
  /** Lethal stone cells (cell index = y * cells + x). */
  obstacles?: ReadonlySet<number>
  /** Presentation hint only — the simulation never branches on it. */
  reverse?: boolean
  /**
   * Neutral deck: ignore personal history when choosing targets and
   * distractors. With a fixed seed this makes the question sequence
   * identical for every player — the daily challenge's whole premise.
   * Learning stats are still RECORDED; they just don't steer selection.
   */
  neutral?: boolean
}

const idx = (x: number, y: number): number => y * BOARD.cells + x

export class World {
  readonly events = new EventBus<WorldEvents>()
  readonly rng: Rng
  readonly mode: Mode

  private table: CharTable
  private stats: Record<string, CharStat>
  /**
   * The deck stream: a SECOND rng used only for what to ask and which decoys
   * to offer. Layout randomness (free-cell shuffles, bob phases) stays on
   * `rng`, whose consumption depends on how the player plays — splitting the
   * streams means two people on the same daily seed face the identical
   * sequence of questions and decoys even as their boards diverge.
   */
  private readonly deckRng: Rng
  /** Stats consulted for target/distractor choice; {} on neutral runs. */
  private readonly selectionStats: Record<string, CharStat>

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
  /** Characters correctly eaten this run — the "practiced" half of the receipt. */
  readonly runLearned = new Set<string>()
  /** Characters whose mastery flipped during this run, in order. */
  readonly runMastered: string[] = []
  /** Confusion pairs recorded this run — unordered, keyed "a→b" with the
   *  ends sorted, so both directions of one mix-up count as one pair. */
  readonly runConfused = new Map<string, number>()

  /** Word-level state. `target` always holds the currently-needed character. */
  word: WordEntry | null = null
  wordIndex = 0
  wordsDone = 0
  private lastWord: string | null = null
  private readonly words: readonly WordEntry[] | null

  readonly obstacles: ReadonlySet<number>
  readonly reverse: boolean

  alive = true
  interval: number
  /** Time accumulated toward the next move. Also the render interpolation phase. */
  private moveClock = 0
  private lastTarget: string | null = null
  /** A death that has occurred but is held open for a saving turn to arrive. */
  private pendingDeath: DeathReason | null = null
  /** Seconds left in the late-turn forgiveness window. */
  private graceLeft = 0

  constructor(opts: WorldOptions) {
    this.table = opts.table
    this.stats = opts.stats
    this.mode = opts.mode
    this.words = opts.words?.length ? opts.words : null
    this.reverse = opts.reverse ?? false
    this.rng = new Rng(opts.seed)
    this.deckRng = new Rng((this.rng.seed ^ 0x51ab3c7) >>> 0)
    this.selectionStats = opts.neutral ? {} : opts.stats
    this.input = new DirectionBuffer('right')
    this.interval = moveInterval(0, this.mode)
    // Defensive: never let an authored layout bury the spawn row. Layouts are
    // supposed to keep it clear; if one slips, the snake wins over the stone.
    const obstacles = new Set(opts.obstacles ?? [])
    const mid = Math.floor(BOARD.cells / 2)
    for (let x = mid - SNAKE.startLength; x <= mid + 1; x++) {
      obstacles.delete(mid * BOARD.cells + x)
    }
    this.obstacles = obstacles
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
    this.prevSnake = []
    this.snapshotPrev()
    this.input.reset('right')
    this.items = []
    this.score = 0
    this.eaten = 0
    this.streak = 0
    this.bestStreak = 0
    this.mistakes = 0
    this.elapsed = 0
    this.runErrors.clear()
    this.runLearned.clear()
    this.runMastered.length = 0
    this.runConfused.clear()
    this.alive = true
    this.pendingDeath = null
    this.graceLeft = 0
    this.moveClock = 0
    this.lastTarget = null
    this.word = null
    this.wordIndex = 0
    this.wordsDone = 0
    this.lastWord = null
    this.interval = moveInterval(0, this.mode)
    this.spawn()
  }

  /** Romanization of a character, for presentation layers. */
  soundOf(ch: string): string {
    return this.table[ch] ?? ''
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

    // A death is being held open for a saving turn; nothing else moves.
    if (this.pendingDeath) {
      this.graceUpdate(dt)
      return
    }

    this.moveClock += dt
    // `while`, not `if`: a step could be long enough to owe more than one move
    // at high speed, and skipping the debt would make the snake stutter.
    while (this.alive && !this.pendingDeath && this.moveClock >= this.interval) {
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

  /**
   * Snapshot the body into the existing prevSnake array instead of mapping a
   * new one. Cloning every segment on every move handed the collector a
   * steady stream of short-lived objects, and it reclaims them by stopping
   * the world — on a phone that pause is long enough to be seen.
   */
  private snapshotPrev(): void {
    const p = this.prevSnake
    const s = this.snake
    while (p.length < s.length) p.push({ x: 0, y: 0, ch: '' })
    if (p.length > s.length) p.length = s.length
    for (let i = 0; i < s.length; i++) {
      const a = p[i] as Segment
      const b = s[i] as Segment
      a.x = b.x
      a.y = b.y
      a.ch = b.ch
    }
  }

  /** Where `dir` leads from the head, wrap applied. null = off the board. */
  private destOf(dir: Dir): { x: number; y: number } | null {
    const head = this.snake[0]
    if (!head) return null
    const v = DIR_VECTORS[dir]
    let nx = head.x + v.x
    let ny = head.y + v.y
    if (this.mode.wrap) {
      nx = (nx + BOARD.cells) % BOARD.cells
      ny = (ny + BOARD.cells) % BOARD.cells
    } else if (nx < 0 || ny < 0 || nx >= BOARD.cells || ny >= BOARD.cells) {
      return null
    }
    return { x: nx, y: ny }
  }

  /** Why moving to `dest` would kill, or null when the move is safe. */
  private fatalAt(dest: { x: number; y: number } | null): DeathReason | null {
    if (!dest) return 'wall'
    if (this.obstacles.has(idx(dest.x, dest.y))) return 'wall'

    /**
     * Self-collision, correctly.
     *
     * The last segment vacates its cell this very step unless we are growing,
     * so moving into it is legal — that is how a snake follows its own tail
     * around a tight loop. The prototype tested every segment including the
     * tail and killed you for a move that was never actually a collision.
     */
    const hit = this.items.find((i) => i.x === dest.x && i.y === dest.y)
    const growing = hit?.correct === true
    const bodyEnd = growing ? this.snake.length : this.snake.length - 1
    for (let i = 0; i < bodyEnd; i++) {
      const s = this.snake[i]
      if (s && s.x === dest.x && s.y === dest.y) return 'self'
    }
    return null
  }

  /** Execute a move already known to be safe. */
  private commitMove(dest: { x: number; y: number }): void {
    const nx = dest.x
    const ny = dest.y
    const hitIndex = this.items.findIndex((i) => i.x === nx && i.y === ny)
    const hit = hitIndex >= 0 ? this.items[hitIndex] : undefined
    const growing = hit?.correct === true

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

  private step(): void {
    this.snapshotPrev()

    let dest = this.destOf(this.input.consume())
    let reason = this.fatalAt(dest)

    /**
     * Late-turn forgiveness, part one: a turn already sitting in the buffer
     * that escapes the death is taken NOW. The player made that input in
     * time — it simply had not been consumed yet — so honouring it is not
     * mercy, it is honesty about when the input happened.
     */
    while (reason && this.input.queued > 0) {
      dest = this.destOf(this.input.consume())
      reason = this.fatalAt(dest)
    }

    if (reason !== null || !dest) {
      /**
       * Part two: hold the death open for a short grace window instead of
       * committing it (see graceUpdate). At the pace floor the difference
       * between a clean dodge and a "cheap" death is one frame of input
       * latency; a window shorter than perception but longer than that
       * latency converts the cheap deaths, and only the cheap deaths.
       */
      this.pendingDeath = reason ?? 'wall'
      this.graceLeft = SNAKE.lateTurnGrace
      return
    }

    this.commitMove(dest)
  }

  /**
   * A death is pending. A turn arriving inside the window that escapes it
   * cancels the death and executes immediately, so the rescue is felt the
   * moment the finger moves — not a move later. Fatal queued turns are
   * discarded to keep the shallow buffer open for the one that saves. The
   * snake holds still at the point of impact while the window runs: ~90ms of
   * stillness before a death reads as the thud landing, and after a rescue
   * it is far too brief to register as a pause.
   */
  private graceUpdate(dt: number): void {
    while (this.input.queued > 0) {
      const dest = this.destOf(this.input.consume())
      if (dest && !this.fatalAt(dest)) {
        this.pendingDeath = null
        this.snapshotPrev()
        this.commitMove(dest)
        this.moveClock = 0
        return
      }
    }
    this.graceLeft -= dt
    if (this.graceLeft <= 0) {
      const reason = this.pendingDeath as DeathReason
      this.pendingDeath = null
      this.die(reason)
    }
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
    const stat = this.statFor(item.ch)
    const wasMastered = isMastered(stat)
    stat.ok += 1
    // Schedule it forward: correct here buys a longer gap before it is asked
    // again, which is what turns practice into retention.
    promote(stat, Date.now())
    this.runLearned.add(item.ch)
    this.setInterval(moveInterval(this.eaten, this.mode))

    this.events.emit('eat', {
      item,
      award,
      streak: this.streak,
      score: this.score,
    })

    // After 'eat', so the celebration draws over the reward, not under it.
    if (!wasMastered && isMastered(stat)) {
      this.runMastered.push(item.ch)
      this.events.emit('mastered', {
        item,
        ch: item.ch,
        sound: this.table[item.ch] ?? '',
      })
    }

    if (this.word) {
      this.wordIndex += 1
      if (this.wordIndex >= this.word.w.length) {
        const entry = this.word
        this.wordsDone += 1
        this.events.emit('wordDone', { entry })
        this.spawn()
      } else {
        // The rest of the word is already on the board; just move the aim.
        this.target = this.word.w[this.wordIndex] ?? null
        this.targetAge = 0
        for (const it of this.items) it.correct = it.ch === this.target
        this.events.emit('wordProgress', {
          entry: this.word,
          index: this.wordIndex,
        })
      }
    } else {
      this.spawn()
    }
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
      const ts = this.statFor(target)
      ts.err += 1
      // Missed: back down a rung and due again within the minute.
      demote(ts, Date.now())
      this.runErrors.set(target, (this.runErrors.get(target) ?? 0) + 1)
    }
    this.statFor(item.ch).err += 1
    this.runErrors.set(item.ch, (this.runErrors.get(item.ch) ?? 0) + 1)

    // The confusion matrix: asked for `target`, bit `item.ch`. This pair —
    // not the two independent error counts — is what lets the spawner
    // surround a target with YOUR lookalikes next time (chooseDistractors).
    if (target && target !== item.ch) {
      const stat = this.statFor(target)
      const conf = (stat.confused ??= {})
      conf[item.ch] = (conf[item.ch] ?? 0) + 1
      const key =
        target < item.ch ? `${target}→${item.ch}` : `${item.ch}→${target}`
      this.runConfused.set(key, (this.runConfused.get(key) ?? 0) + 1)
    }

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
    const set = new Set<number>(this.obstacles)
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

  /** Pick a new target (or word) and lay it out with its distractors. */
  private spawn(): void {
    if (this.words) {
      this.spawnWord()
      return
    }
    this.items = []
    this.targetAge = 0

    const target = chooseTarget(
      this.table,
      this.selectionStats,
      this.deckRng,
      this.lastTarget,
      Date.now(),
    )
    if (!target) return
    this.target = target
    this.lastTarget = target

    const distractors = chooseDistractors(
      this.table,
      target,
      this.selectionStats,
      this.deckRng,
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

  /**
   * Lay out a whole word at once — every character of it, plus distractors —
   * so the player plans a route through the word in order. Only the currently
   * needed character is `correct`; the flags advance as the word does.
   */
  private spawnWord(): void {
    if (!this.words) return
    this.items = []
    this.targetAge = 0

    const pool = this.words.filter((e) => e.w !== this.lastWord)
    const entry =
      this.deckRng.pick(pool.length ? pool : this.words) ?? this.words[0]
    if (!entry) return
    this.word = entry
    this.lastWord = entry.w
    this.wordIndex = 0
    const wordChars = [...entry.w]
    this.target = wordChars[0] ?? null

    // Distractors: lookalikes of any character in the word first, then
    // fillers. Characters sharing a sound with any word character are
    // excluded — they would read as a decoy syllable of the answer.
    const wordSet = new Set(wordChars)
    const wordSounds = new Set(wordChars.map((c) => this.table[c]))
    const eligible = (c: string) =>
      !wordSet.has(c) && !wordSounds.has(this.table[c])
    const lookalikes: string[] = []
    for (const ch of wordChars) {
      for (const c of confusablesOf(ch)) {
        if (c in this.table && eligible(c) && !lookalikes.includes(c)) {
          lookalikes.push(c)
        }
      }
    }
    this.deckRng.shuffle(lookalikes)
    const fillers = this.deckRng.shuffle(
      Object.keys(this.table).filter(
        (c) => eligible(c) && !lookalikes.includes(c),
      ),
    )
    const distractors = [...lookalikes, ...fillers].slice(0, 3)

    const free = this.spawnCells()
    const wanted = [...wordChars, ...distractors]
    for (let i = 0; i < wanted.length && i < free.length; i++) {
      const cell = free[i] as number
      this.items.push({
        x: cell % BOARD.cells,
        y: Math.floor(cell / BOARD.cells),
        ch: wanted[i] as string,
        correct: wanted[i] === this.target,
        phase: this.rng.range(0, Math.PI * 2),
        age: 0,
      })
    }

    this.events.emit('spawned', {
      target: entry.w,
      sound: wordChars.map((c) => this.table[c] ?? '').join(''),
    })
  }
}
