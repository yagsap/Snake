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

  // Swipe. Tracked by pointerId so a stray second finger cannot hijack the
  // gesture midway and produce a turn the player never made.
  let startX = 0
  let startY = 0
  let activeId: number | null = null

  const onPointerDown = (e: PointerEvent) => {
    if (activeId !== null) return
    activeId = e.pointerId
    startX = e.clientX
    startY = e.clientY
    // Capture the pointer so the matching pointerup reaches this surface even
    // when the finger lifts outside it — fast swipes routinely end off-canvas,
    // and without capture those swipes were silently dropped.
    try {
      surface.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return
    activeId = null
    if (handlers.isBlocked()) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) {
      handlers.onAction('tap')
      return
    }
    handlers.onTurn(
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? 'right'
          : 'left'
        : dy > 0
          ? 'down'
          : 'up',
    )
  }
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === activeId) activeId = null
  }

  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointerup', onPointerUp)
  surface.addEventListener('pointercancel', onPointerCancel)
  disposers.push(() => {
    surface.removeEventListener('pointerdown', onPointerDown)
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
      if (!handlers.isBlocked()) handlers.onTurn(dir)
    }
    btn.addEventListener('pointerdown', onDown)
    disposers.push(() => btn.removeEventListener('pointerdown', onDown))
  }

  return () => {
    for (const d of disposers) d()
  }
}
