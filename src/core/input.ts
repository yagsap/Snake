/**
 * Input buffering and device binding.
 *
 * A grid game only accepts a turn once per move. If the player taps
 * right-then-up faster than one move interval, a single `nextDir` variable
 * throws the first tap away — the input "didn't register", which players
 * read as the game being unresponsive rather than as their own timing.
 *
 * The fix is a short queue. Each queued turn is validated against the last
 * queued direction, not the currently rendered one, so a two-tap sequence
 * that is legal *as a sequence* survives even when both taps land inside the
 * same move. The queue is deliberately shallow: buffer too much and the snake
 * keeps executing turns the player has already changed their mind about.
 */

export type Dir = 'up' | 'down' | 'left' | 'right'

export interface Vec2 {
  x: number
  y: number
}

export const DIR_VECTORS: Readonly<Record<Dir, Vec2>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

/** How many turns may sit in the queue at once. Two covers a fast corner. */
const BUFFER_DEPTH = 2

export class DirectionBuffer {
  private queue: Dir[] = []

  constructor(private facing: Dir = 'right') {}

  /** The direction the snake is actually travelling right now. */
  get current(): Dir {
    return this.facing
  }

  /** The direction a new input is judged against — last queued, else current. */
  private get tail(): Dir {
    return this.queue[this.queue.length - 1] ?? this.facing
  }

  /** Returns false if the turn was rejected (reversal, duplicate, or full). */
  push(dir: Dir): boolean {
    if (this.queue.length >= BUFFER_DEPTH) return false
    const from = this.tail
    if (dir === from) return false // no-op, don't waste a buffer slot
    if (dir === OPPOSITE[from]) return false // 180s would eat your own neck
    this.queue.push(dir)
    return true
  }

  /** Called once per move: commit the next buffered turn, if any. */
  consume(): Dir {
    const next = this.queue.shift()
    if (next) this.facing = next
    return this.facing
  }

  reset(dir: Dir): void {
    this.facing = dir
    this.queue.length = 0
  }
}

// ------------------------------------------------------------- bindings --

const KEY_MAP: Readonly<Record<string, Dir>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
}

/** Minimum swipe distance in CSS pixels before it counts as a direction. */
const SWIPE_THRESHOLD = 18

export interface InputHandlers {
  onTurn(dir: Dir): void
  onAction(action: string): void
  /** Input is ignored entirely while this returns true (e.g. a modal is open). */
  isBlocked(): boolean
  /** Optional probe, called the moment a raw device event arrives. */
  onRawInput?(): void
}

/**
 * Binds keyboard, swipe and on-screen d-pad to a single handler set, and
 * returns a disposer. Returning a disposer rather than leaking listeners
 * means scenes can be torn down without stale handlers firing into them.
 */
export function bindInput(
  surface: HTMLElement,
  handlers: InputHandlers,
): () => void {
  const disposers: Array<() => void> = []

  const onKeyDown = (e: KeyboardEvent) => {
    // Never steal keys from a form control. Buttons only claim the keys that
    // activate them (space/enter); arrows and letters still reach the game,
    // so a click that leaves a button focused doesn't kill the keyboard.
    const target = e.target as HTMLElement | null
    if (target) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) && e.key !== 'Escape') return
      if (target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
    }

    const dir = KEY_MAP[e.key]
    if (dir) {
      e.preventDefault()
      handlers.onRawInput?.()
      if (!handlers.isBlocked()) handlers.onTurn(dir)
      return
    }
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (!handlers.isBlocked()) handlers.onAction('replay-cue')
        break
      // Meta actions are never gated on isBlocked: 'pause' must work while
      // paused and 'learn' must work from any screen, or the keys feel dead.
      case 'p':
      case 'P':
        handlers.onAction('pause')
        break
      case 'l':
      case 'L':
        handlers.onAction('learn')
        break
      case 'Escape':
        handlers.onAction('escape')
        break
    }
  }
  addEventListener('keydown', onKeyDown)
  disposers.push(() => removeEventListener('keydown', onKeyDown))

  /**
   * Swipe steering.
   *
   * The turn fires the instant the finger has travelled far enough, from
   * pointermove — NOT on pointerup. Waiting for the lift put the whole
   * duration of the gesture, 100-250ms of it, between the player's intent and
   * the snake reacting; on a device where every turn is a swipe that is felt
   * as the snake lagging behind the hand, and no amount of rendering work
   * fixes it because the input simply had not arrived yet.
   *
   * Firing on movement also makes steering CONTINUOUS: the anchor resets
   * after each turn, so one long drag can round several corners instead of
   * spending a whole finger-down/up cycle on a single turn.
   *
   * Tracked by pointerId so a stray second finger cannot hijack the gesture
   * midway and produce a turn the player never made.
   */
  let anchorX = 0
  let anchorY = 0
  let activeId: number | null = null
  /** Did this gesture ever cross the threshold? If not, the lift is a tap. */
  let swiped = false
  /** Last direction this gesture asked for, so a long drag in one direction
   *  re-anchors without spamming turns the snake is already committed to. */
  let lastDir: Dir | null = null

  const dirOf = (dx: number, dy: number): Dir =>
    Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'

  const onPointerDown = (e: PointerEvent) => {
    if (activeId !== null) return
    activeId = e.pointerId
    anchorX = e.clientX
    anchorY = e.clientY
    swiped = false
    lastDir = null
    // Capture the pointer so moves and the matching pointerup reach this
    // surface even when the finger leaves it — fast swipes routinely end
    // off-canvas, and without capture those swipes were silently dropped.
    try {
      surface.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId || handlers.isBlocked()) return
    const dx = e.clientX - anchorX
    const dy = e.clientY - anchorY
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return
    swiped = true
    // Re-anchor where the threshold was crossed, so the next leg of the same
    // drag is measured from here rather than from where the finger landed.
    anchorX = e.clientX
    anchorY = e.clientY
    const dir = dirOf(dx, dy)
    if (dir === lastDir) return // already asked for this on this drag
    lastDir = dir
    handlers.onRawInput?.()
    handlers.onTurn(dir)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return
    activeId = null
    if (handlers.isBlocked() || swiped) return
    // Never moved far enough to be a swipe: this was a tap (replay the cue).
    handlers.onAction('tap')
  }

  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === activeId) activeId = null
  }

  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerCancel)
  disposers.push(() => {
    surface.removeEventListener('pointerdown', onPointerDown)
    surface.removeEventListener('pointermove', onPointerMove)
    surface.removeEventListener('pointerup', onPointerUp)
    surface.removeEventListener('pointercancel', onPointerCancel)
  })

  // On-screen d-pad. Fires on pointerdown, not click: waiting for click adds
  // the browser's tap delay to every turn, which is felt as input lag.
  for (const btn of document.querySelectorAll<HTMLElement>('[data-dir]')) {
    const dir = btn.dataset.dir as Dir | undefined
    if (!dir) continue
    const onDown = (e: Event) => {
      e.preventDefault()
      handlers.onRawInput?.()
      if (!handlers.isBlocked()) handlers.onTurn(dir)
    }
    btn.addEventListener('pointerdown', onDown)
    disposers.push(() => btn.removeEventListener('pointerdown', onDown))
  }

  return () => {
    for (const d of disposers) d()
  }
}
