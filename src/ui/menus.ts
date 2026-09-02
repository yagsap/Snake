import type { SaveData } from '../core/storage'
import {
  CAMPAIGNS, KIND_ICON, KIND_LABEL, dateKey, type LevelSpec, levelChars,
} from '../game/levels'
import {
  LANGUAGES,
  LANG_IDS,
  setNamesFor,
  type CharTable,
  type LangId,
} from '../data/scripts'
import { MODES, MODE_IDS, type ModeId } from '../game/modes'
import { isMastered } from '../game/progression'

/**
 * Menu and study-chart DOM. Pure view code: it renders from state it is given
 * and reports interactions through callbacks; it never mutates game state
 * directly.
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

/** What the bullseye needs to know: where you are, and the next rung. */
export interface FocusInfo {
  total: number
  mastered: number
  due: number
  reviewThreshold: number
  next: { index: number; title: string; chars: string } | null
}

export interface MenuCallbacks {
  /** The one primary action: play the right thing for this player, now. */
  onContinue(): void
  onLang(lang: LangId): void
  onSet(setName: string): void
  onMode(mode: ModeId): void
  onPlay(): void
  onCampaign(): void
  onDaily(): void
  onLearn(): void
}

/**
 * A few real characters from the script, for the picker.
 *
 * A child choosing what to learn cannot evaluate the word "Devanagari", and
 * "हिन्दी" only helps if they can already read it. Three glyphs from the first
 * set answer the question the label cannot: THIS is what you would be
 * learning. Taken from the front of the first set, which is where every
 * campaign starts, so the sample is also literally the first lesson.
 */
export function sampleGlyphs(id: LangId, n = 3): string {
  const first = Object.values(LANGUAGES[id].sets)[0] ?? {}
  return Object.keys(first).slice(0, n).join('')
}

/**
 * Require a deliberate three-second hold before firing.
 *
 * A native confirm() is not a gate for this audience: it is one more button,
 * and a four-year-old dismisses it by hitting the bigger one. A hold cannot
 * be done by accident, because letting go cancels — and the bar filling up is
 * both the feedback for an adult and the "stop doing that" for a child.
 */
export function holdToConfirm(
  el: HTMLElement,
  idle: string,
  active: string,
  done: () => void,
  ms = 3000,
): void {
  let start = 0
  let raf = 0
  const paint = (p: number) => {
    el.style.setProperty('--hold', `${Math.round(p * 100)}%`)
    el.classList.toggle('holding', p > 0)
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    start = 0
    paint(0)
    el.textContent = idle
  }
  const tick = () => {
    if (!start) return
    const p = Math.min(1, (performance.now() - start) / ms)
    paint(p)
    if (p >= 1) {
      stop()
      done()
      return
    }
    raf = requestAnimationFrame(tick)
  }
  el.textContent = idle
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    start = performance.now()
    el.textContent = active
    raf = requestAnimationFrame(tick)
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, stop)
  }
}

export class MenuView {
  private root = $('menuScr')
  private langGrid = $('langGrid')
  private setRow = $('setRow')
  private modeRow = $('modeRow')
  private resultLine = $('resultLine')
  private snakeWord = $('snakeWord')

  constructor(private cb: MenuCallbacks) {
    $('continueBtn').addEventListener('click', () => cb.onContinue())
    const more = $('moreBtn')
    more.addEventListener('click', () => {
      const box = $('moreBox')
      box.hidden = !box.hidden
      more.textContent = box.hidden ? 'more ways to play ▾' : 'fewer options ▴'
    })
    $('playBtn').addEventListener('click', () => cb.onPlay())
    $('campBtn').addEventListener('click', () => cb.onCampaign())
    $('dailyBtn').addEventListener('click', () => cb.onDaily())
    $('menuLearnBtn').addEventListener('click', () => cb.onLearn())
  }

  show(data: SaveData, message?: string): void {
    this.root.hidden = false
    this.render(data)
    this.resultLine.textContent =
      message ??
      (data.bestScore ? `best ${data.bestScore}` : '')
  }

  hide(): void {
    this.root.hidden = true
  }

  get visible(): boolean {
    return !this.root.hidden
  }

  /**
   * The bullseye. A learner opening the app should see their goal and one
   * button, not a menu of everything the app could do — choice at the door
   * is the most reliable way to lose a session before it starts.
   */
  renderFocus(data: SaveData, f: FocusInfo): void {
    const { mastered, total, due, next } = f
    const pct = total ? Math.round((mastered / total) * 100) : 0
    $('focusName').textContent = `${LANGUAGES[data.lang].name} · ${data.setName}`
    $('focusStat').textContent = `${mastered} of ${total} mastered`
    $('focusPct').textContent = `${pct}%`

    /**
     * The next rung, named. A learner needs to see the ladder they are on and
     * the single step in front of them; "12 of 71 mastered" describes a state
     * but proposes nothing to do about it. The line below always answers "so
     * what am I about to play?", and the button repeats that answer so the two
     * can never disagree.
     */
    const levels = CAMPAIGNS[data.lang]
    const cleared = levels.filter((l) => data.campaign[l.id]?.cleared).length
    const nextEl = $('focusNext')
    const btn = $('continueBtn')
    if (due >= f.reviewThreshold) {
      nextEl.textContent = `${due} due for review`
      btn.textContent = `Review ${due} characters`
    } else if (next) {
      nextEl.innerHTML =
        `<em>Level ${next.index + 1} of ${levels.length}</em> · ${next.title}` +
        (next.chars ? ` <span class="lvlGlyphs">${next.chars}</span>` : '')
      btn.textContent = `Level ${next.index + 1} · ${next.title}`
    } else {
      nextEl.textContent = 'every level cleared — keep them sharp'
      btn.textContent = 'Endless run'
    }

    // The rungs themselves: one tick per level, filled as far as you have
    // climbed. This is the ladder made literal, and it is the one element on
    // the screen that visibly grows every single session.
    const strip = $('focusLadder')
    const span = levels.length
    strip.innerHTML = levels
      .map((l, i) => {
        const st = data.campaign[l.id]
        const cls = st?.perfect ? 'p' : st?.cleared ? 'c' : i === next?.index ? 'n' : ''
        return `<i class="${cls}"></i>`
      })
      .join('')
    $('focusLadderText').textContent = `${cleared}/${span} levels`

    const c = $<HTMLCanvasElement>('focusRing')
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== 132 * dpr) {
      c.width = 132 * dpr
      c.height = 132 * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, 132, 132)
    const R = 56
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(255,255,255,.09)'
    ctx.beginPath()
    ctx.arc(66, 66, R, 0, Math.PI * 2)
    ctx.stroke()
    if (pct > 0) {
      ctx.strokeStyle = '#9AD1B2'
      ctx.beginPath()
      ctx.arc(66, 66, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100))
      ctx.stroke()
    }
  }

  render(data: SaveData): void {
    this.snakeWord.textContent = LANGUAGES[data.lang].word

    this.langGrid.innerHTML = LANG_IDS.map((id) => {
      const [native, english] = LANGUAGES[id].labels
      return `<button class="chip ${id === data.lang ? 'on' : ''}" data-lang="${id}" data-say="${english}"><b>${native}</b><span>${english}</span><i class="sample">${sampleGlyphs(id)}</i></button>`
    }).join('')
    for (const btn of this.langGrid.querySelectorAll<HTMLElement>('[data-lang]')) {
      btn.addEventListener('click', () => this.cb.onLang(btn.dataset.lang as LangId))
    }

    this.setRow.innerHTML = setNamesFor(data.lang)
      .map(
        (n) =>
          `<button class="pill ${n === data.setName ? 'on' : ''}" data-set="${n}">${n}</button>`,
      )
      .join('')
    for (const btn of this.setRow.querySelectorAll<HTMLElement>('[data-set]')) {
      btn.addEventListener('click', () => this.cb.onSet(btn.dataset.set as string))
    }

    this.modeRow.innerHTML = MODE_IDS.map((id) => {
      const m = MODES[id]
      return `<button class="pill mode ${id === data.mode ? 'on' : ''}" data-mode="${id}" title="${m.blurb}">${m.label}</button>`
    }).join('')
    for (const btn of this.modeRow.querySelectorAll<HTMLElement>('[data-mode]')) {
      btn.addEventListener('click', () => this.cb.onMode(btn.dataset.mode as ModeId))
    }
    $('modeBlurb').textContent = MODES[data.mode].blurb

    const levels = CAMPAIGNS[data.lang]
    const cleared = levels.filter((l) => data.campaign[l.id]?.cleared).length
    $('campBtn').textContent = `All levels · ${cleared}/${levels.length}`

    // Today's daily already played: the button wears the score. An unplayed
    // daily stays a plain invitation.
    const daily = data.daily
    $('dailyBtn').textContent =
      daily && daily.date === dateKey() ? `Daily · ${daily.best}` : 'Daily run'
  }
}

// --------------------------------------------------------------- campaign --

export class CampaignView {
  private root = $('campScr')
  private listEl = $('campList')

  constructor(onPick: (level: LevelSpec, index: number) => void, onClose: () => void) {
    $('campClose').addEventListener('click', onClose)
    this.listEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (!btn || btn.classList.contains('locked')) return
      const i = Number(btn.dataset.i)
      const level = this.levels[i]
      if (level) onPick(level, i)
    })
  }

  private levels: LevelSpec[] = []

  open(data: SaveData): void {
    this.levels = CAMPAIGNS[data.lang]
    const cleared = this.levels.filter((l) => data.campaign[l.id]?.cleared).length
    $('campTitle').textContent =
      `${LANGUAGES[data.lang].name} · ${cleared}/${this.levels.length} levels`
    let current = -1
    this.listEl.innerHTML = this.levels
      .map((lvl, i) => {
        const st = data.campaign[lvl.id]
        const prev = i === 0 ? null : this.levels[i - 1]
        const unlocked = i === 0 || (prev && data.campaign[prev.id]?.cleared)
        const isNext = unlocked && !st?.cleared && current < 0
        if (isNext) current = i
        const cls = !unlocked
          ? 'locked'
          : `${st?.perfect ? 'perfect' : st?.cleared ? 'cleared' : ''}${isNext ? ' current' : ''}`
        const state = !unlocked ? '🔒' : st?.perfect ? '★' : st?.cleared ? '✓' : '▸'
        // The characters themselves, on every row. A list of titles like "the
        // s row" is only meaningful to someone who already knows the script —
        // which is nobody who needs this app. Showing さしすせそ makes the
        // ladder legible at a glance: you can see what you have taken and
        // exactly which shapes are waiting on the next rung.
        const { fresh, revised } = levelChars(data.lang, i)
        const cap = (a: string[], n: number) =>
          a.slice(0, n).join('') + (a.length > n ? '…' : '')
        // When a level introduces nothing new — a counting or listening level
        // built entirely from characters already taught — its whole set is
        // "revised", and rendering that as "+一二三四五" leaves a plus sign
        // with nothing in front of it to add to. Show them plainly instead.
        const glyphs = lvl.words
          ? lvl.words.map((e) => e.w).slice(0, 4).join(' ')
          : fresh.length === 0
            ? cap(revised, 10)
            : cap(fresh, 10) +
              (revised.length ? `<em>+${cap(revised, 8)}</em>` : '')
        // Spoken label, for a player who cannot read the row. The number
        // first, because that is how a child refers to where they are.
        const say = unlocked
          ? `Level ${i + 1}. ${lvl.title}. ${KIND_LABEL[lvl.kind]}`
          : `Level ${i + 1}. Locked.`
        return `<button class="lvl ${cls}" data-i="${i}" data-say="${say}">
          <span class="num">${i + 1}</span>
          <span class="kind" aria-hidden="true">${KIND_ICON[lvl.kind]}</span>
          <span class="meta">
            <b>${lvl.title}</b>
            <span class="lvlGlyphs">${glyphs}</span>
            <i>${KIND_LABEL[lvl.kind]}</i>
          </span>
          <span class="state">${state}</span>
        </button>`
      })
      .join('')
    this.root.hidden = false
    // Open on the rung you are standing on, not on level one. By level thirty
    // the interesting row is far off the bottom of a list this long.
    const cur = this.listEl.querySelector<HTMLElement>('.lvl.current')
    if (cur) cur.scrollIntoView({ block: 'center' })
  }

  close(): void {
    this.root.hidden = true
  }
}

// -------------------------------------------------------------- level end --

export interface LevelEndStats {
  cleared: boolean
  perfect: boolean
  levelTitle: string
  detail: string
  hasNext: boolean
  /** The learning receipt line — what this run was actually FOR. */
  receipt: string
}

export class LevelEndView {
  private root = $('lvlEndScr')
  /** Injected so this view does not have to know what the audio layer is. */
  speak: (text: string) => void = () => {}

  constructor(onNext: () => void, onRetry: () => void, onMenu: () => void) {
    $('lvlNextBtn').addEventListener('click', onNext)
    $('lvlRetryBtn').addEventListener('click', onRetry)
    $('lvlMenuBtn').addEventListener('click', onMenu)
  }

  show(stats: LevelEndStats): void {
    const title = stats.cleared
      ? stats.perfect ? 'Perfect!' : 'Well done!'
      : 'Good try!'
    $('lvlEndTitle').textContent = title
    // The card says itself out loud. An end card is the one screen a child
    // reliably meets alone, and "level failed" is a hard thing to read when
    // you cannot read — so it is now a kind sentence, spoken.
    this.speak(`${title} ${stats.detail}`)
    $('lvlEndTitle').classList.toggle('gold', stats.cleared && stats.perfect)
    $('lvlEndName').textContent = stats.levelTitle
    $('lvlEndDetail').textContent = stats.detail
    const learn = $('lvlEndLearn')
    learn.textContent = stats.receipt
    learn.hidden = !stats.receipt
    $('lvlNextBtn').hidden = !(stats.cleared && stats.hasNext)
    $('lvlRetryBtn').textContent = stats.cleared ? 'Play again' : 'Try again'
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
  }
}

// -------------------------------------------------------- parent corner --

export interface WeekSummary {
  /** Distinct characters practised in the last seven days. */
  practiced: number
  correct: number
  wrong: number
  /** Answers per day, oldest first, always seven entries. */
  perDay: number[]
  /** Day initials matching perDay. */
  labels: string[]
  /** The pairs this child actually mixes up, worst first. */
  confusions: Array<{ a: string; b: string; n: number }>
}

/**
 * The only screen in the app written for an adult.
 *
 * Parents buy this and parents decide whether it stays on the phone, and
 * until now they got nothing at all: no way to see whether it had been used
 * this week, or whether it was working. That is the entire content here —
 * plus the settings and the reset button, which are behind the same hold
 * because they are exactly what a child should not reach.
 */
export class ParentView {
  private root = $('parentScr')

  constructor(onClose: () => void, onReset: () => void) {
    $('parentClose').addEventListener('click', onClose)
    // A second gate on the destructive control itself. Belt and braces: the
    // door gate keeps children out, this one keeps a browsing adult from
    // deleting a fortnight of work with a stray tap.
    holdToConfirm($('resetBtn'), 'hold to reset', 'keep holding…', onReset)
  }

  open(w: WeekSummary): void {
    const box = $('weekBox')
    const total = w.correct + w.wrong
    const pct = total ? Math.round((w.correct / total) * 100) : 0
    const peak = Math.max(1, ...w.perDay)
    const bars = w.perDay
      .map((n) => `<i class="${n ? '' : 'none'}" style="height:${Math.round((n / peak) * 100)}%"></i>`)
      .join('')
    const days = w.labels.map((l) => `<span>${l}</span>`).join('')
    const mix = w.confusions.length
      ? `<div class="mix">Still mixing up ${w.confusions
          .slice(0, 3)
          .map((c) => `<b>${c.a}</b>/<b>${c.b}</b>`)
          .join(', ')}</div>`
      : total
        ? '<div class="mix muted">No characters are being confused right now.</div>'
        : ''
    box.innerHTML = `
      <h3>This week</h3>
      <p><span class="big">${w.practiced}</span> ${w.practiced === 1 ? 'character' : 'characters'} practised</p>
      <p class="muted">${total} ${total === 1 ? 'answer' : 'answers'}${total ? ` · ${pct}% right` : ''}</p>
      <div class="bars">${bars}</div>
      <div class="days">${days}</div>
      ${mix}`
    this.root.hidden = false
  }

  close(): void {
    this.root.hidden = true
  }
}

// ---------------------------------------------------------------- chart --

export interface ChartCallbacks {
  onSpeak(ch: string): void
  onReset(): void
  /** Open the parent corner — reached only through a deliberate hold. */
  onParent(): void
  onClose(): void
  onVoice(name: string): void
  onShowRomaji(show: boolean): void
  onReducedMotion(reduced: boolean): void
  onShowPad(show: boolean): void
  onMusic(on: boolean): void
}

export class ChartView {
  private root = $('learn')
  private chartEl = $('chart')
  private titleEl = $('learnTitle')
  private sortBtn = $('sortBtn')
  private weakFirst = false

  constructor(private cb: ChartCallbacks) {
    $('learnClose').addEventListener('click', () => cb.onClose())
    // The parent gate now guards the DOOR rather than one control, because
    // everything behind it — every setting a five-year-old would flip by
    // accident, and the one button that deletes months of their work — has
    // the same problem. See holdToConfirm.
    holdToConfirm($('parentBtn'), 'hold: grown-ups', 'keep holding…', () =>
      cb.onParent(),
    )
    this.sortBtn.addEventListener('click', () => {
      this.weakFirst = !this.weakFirst
      this.lastRender?.()
    })
    $<HTMLSelectElement>('voiceSel').addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement
      cb.onVoice(sel.value)
      sel.blur()
    })
    $<HTMLInputElement>('showSnd').addEventListener('change', (e) =>
      cb.onShowRomaji((e.target as HTMLInputElement).checked),
    )
    $<HTMLInputElement>('reduceMotion').addEventListener('change', (e) =>
      cb.onReducedMotion((e.target as HTMLInputElement).checked),
    )
    $<HTMLInputElement>('showPad').addEventListener('change', (e) =>
      cb.onShowPad((e.target as HTMLInputElement).checked),
    )
    $<HTMLInputElement>('music').addEventListener('change', (e) =>
      cb.onMusic((e.target as HTMLInputElement).checked),
    )
  }

  private lastRender: (() => void) | null = null

  get visible(): boolean {
    return this.root.classList.contains('show')
  }

  open(data: SaveData, table: CharTable): void {
    this.root.classList.add('show')
    this.lastRender = () => this.renderChart(data, table)
    this.lastRender()
  }

  close(): void {
    this.root.classList.remove('show')
  }

  syncSettings(data: SaveData): void {
    $<HTMLInputElement>('showSnd').checked = data.showRomaji
    $<HTMLInputElement>('reduceMotion').checked = data.reducedMotion
    $<HTMLInputElement>('showPad').checked = data.showPad
    $<HTMLInputElement>('music').checked = data.music
  }

  setVoices(
    voices: readonly SpeechSynthesisVoice[],
    current: SpeechSynthesisVoice | null,
    langName: string,
  ): void {
    const sel = $<HTMLSelectElement>('voiceSel')
    sel.innerHTML = voices.length
      ? voices
          .map(
            (v) =>
              `<option ${v === current ? 'selected' : ''}>${v.name}</option>`,
          )
          .join('')
      : `<option>no ${langName} voice here — text cue only</option>`
    sel.disabled = !voices.length
  }

  private renderChart(data: SaveData, table: CharTable): void {
    let chars = Object.keys(table)
    const stat = (c: string) => data.stats[c] ?? { ok: 0, err: 0 }
    if (this.weakFirst) {
      chars = [...chars].sort(
        (a, b) => stat(b).err - stat(a).err || stat(a).ok - stat(b).ok,
      )
    }
    this.chartEl.style.setProperty(
      '--cols',
      String(LANGUAGES[data.lang].chartColumns),
    )
    this.titleEl.textContent = `${LANGUAGES[data.lang].name} · ${data.setName}`
    this.chartEl.innerHTML = chars
      .map((c) => {
        const s = stat(c)
        // The shared predicate allows redemption: a character you once
        // missed CAN earn its green border back. The red border marks work
        // still owed, not a permanent record.
        const cls = isMastered(s) ? 'mastered' : s.err > 0 ? 'weak' : ''
        return `<div class="tile ${cls}" data-ch="${c}" role="button" tabindex="0"><b>${c}</b><i>${table[c]}</i>${s.err > 0 ? `<em>×${s.err}</em>` : ''}</div>`
      })
      .join('')
    for (const tile of this.chartEl.querySelectorAll<HTMLElement>('.tile')) {
      const go = () => {
        this.cb.onSpeak(tile.dataset.ch as string)
        tile.style.transform = 'scale(.95)'
        setTimeout(() => (tile.style.transform = ''), 90)
      }
      tile.addEventListener('click', go)
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      })
    }
    this.sortBtn.textContent = this.weakFirst ? 'chart order' : 'weakest first'
  }
}

// ------------------------------------------------------------ game over --

export interface GameOverStats {
  score: number
  eaten: number
  bestStreak: number
  mistakes: number
  isRecord: boolean
  /** The characters missed this run, worst first, for the "review these" row. */
  missed: Array<{ ch: string; sound: string }>
  /** The learning receipt line — what this run was actually FOR. */
  receipt: string
  /** Offer the share button (daily runs only — those are comparable). */
  share: boolean
}

export class GameOverView {
  private root = $('overScr')
  private shareBtn = $('shareBtn')

  constructor(
    onAgain: () => void,
    onMenu: () => void,
    onSpeak: (ch: string) => void,
    onShare: () => void,
  ) {
    $('againBtn').addEventListener('click', onAgain)
    $('overMenuBtn').addEventListener('click', onMenu)
    this.shareBtn.addEventListener('click', () => onShare())
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-say]')
      if (el) onSpeak(el.dataset.say as string)
    })
  }

  /** Clipboard-path feedback: relabel the share button ("copied ✓"). */
  noteShared(label: string): void {
    this.shareBtn.textContent = label
  }

  show(stats: GameOverStats): void {
    this.shareBtn.hidden = !stats.share
    this.shareBtn.textContent = 'share result'
    $('overScore').textContent = String(stats.score)
    $('overRecord').textContent = stats.isRecord ? 'new best!' : ''
    $('overDetail').textContent =
      `${stats.eaten} eaten · best streak ${stats.bestStreak} · ${stats.mistakes} ${stats.mistakes === 1 ? 'miss' : 'misses'}`
    const learn = $('overLearn')
    learn.textContent = stats.receipt
    learn.hidden = !stats.receipt
    const row = $('overMissed')
    if (stats.missed.length) {
      row.hidden = false
      row.innerHTML =
        `<span class="missLabel">review:</span>` +
        stats.missed
          .slice(0, 6)
          .map(
            (m) =>
              `<button class="missChip" data-say="${m.ch}">${m.ch} <i>${m.sound}</i></button>`,
          )
          .join('')
    } else {
      row.hidden = true
    }
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
  }

  get visible(): boolean {
    return !this.root.hidden
  }
}

// -------------------------------------------------------------- onboarding --

/**
 * The first-launch question — the ONLY question. A new player picks what they
 * want to learn and is eating their first character seconds later; sets,
 * modes and settings introduce themselves once the game has proven itself.
 */
/**
 * The placement step: tap the characters you can already read.
 *
 * Respecting what a learner already knows is the cheapest way to make an app
 * feel smart. Without it, someone who has known ん for years still gets asked
 * about it, and the first session is spent proving things they came here
 * knowing. Marked characters are seeded one rung below mastery — claimed, not
 * yet proven — so they resurface once, in a week, to be confirmed.
 */
export class PlaceView {
  private root = $('placeScr')
  private grid = $('placeGrid')
  private known = new Set<string>()

  constructor(onDone: (known: Set<string>) => void) {
    this.grid.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-ch]')
      const ch = tile?.dataset.ch
      if (!ch || !tile) return
      if (this.known.has(ch)) this.known.delete(ch)
      else this.known.add(ch)
      tile.classList.toggle('known', this.known.has(ch))
    })
    $('placeDone').addEventListener('click', () => onDone(this.known))
    $('placeSkip').addEventListener('click', () => onDone(new Set()))
  }

  open(table: CharTable, lang: LangId): void {
    this.known.clear()
    this.grid.style.setProperty('--cols', String(LANGUAGES[lang].chartColumns))
    this.grid.innerHTML = Object.keys(table)
      .map(
        (c) =>
          `<div class="tile" data-ch="${c}" role="button" tabindex="0"><b>${c}</b><i>${table[c]}</i></div>`,
      )
      .join('')
    this.root.hidden = false
  }

  close(): void {
    this.root.hidden = true
  }
}

export class OnboardView {
  private root = $('onboardScr')

  constructor(onPick: (lang: LangId) => void) {
    const grid = $('onboardGrid')
    grid.innerHTML = LANG_IDS.map((id) => {
      const [native, english] = LANGUAGES[id].labels
      return `<button class="chip" data-lang="${id}" data-say="${english}"><b>${native}</b><span>${english}</span><i class="sample">${sampleGlyphs(id)}</i></button>`
    }).join('')
    grid.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]')
      const lang = btn?.dataset.lang
      if (lang) onPick(lang as LangId)
    })
  }

  open(): void {
    this.root.hidden = false
  }

  close(): void {
    this.root.hidden = true
  }
}
