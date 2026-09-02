import type { SaveData } from '../core/storage'
import { CAMPAIGNS, KIND_LABEL, dateKey, type LevelSpec, levelChars } from '../game/levels'
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
      return `<button class="chip ${id === data.lang ? 'on' : ''}" data-lang="${id}"><b>${native}</b><span>${english}</span></button>`
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
        const glyphs = lvl.words
          ? lvl.words.map((e) => e.w).slice(0, 4).join(' ')
          : cap(fresh, 10) +
            (revised.length ? `<em>+${cap(revised, 8)}</em>` : '')
        return `<button class="lvl ${cls}" data-i="${i}">
          <span class="num">${i + 1}</span>
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

  constructor(onNext: () => void, onRetry: () => void, onMenu: () => void) {
    $('lvlNextBtn').addEventListener('click', onNext)
    $('lvlRetryBtn').addEventListener('click', onRetry)
    $('lvlMenuBtn').addEventListener('click', onMenu)
  }

  show(stats: LevelEndStats): void {
    $('lvlEndTitle').textContent = stats.cleared
      ? stats.perfect ? 'perfect clear' : 'level clear'
      : 'level failed'
    $('lvlEndTitle').classList.toggle('gold', stats.cleared && stats.perfect)
    $('lvlEndName').textContent = stats.levelTitle
    $('lvlEndDetail').textContent = stats.detail
    const learn = $('lvlEndLearn')
    learn.textContent = stats.receipt
    learn.hidden = !stats.receipt
    $('lvlNextBtn').hidden = !(stats.cleared && stats.hasNext)
    $('lvlRetryBtn').textContent = stats.cleared ? 'replay' : 'retry'
    this.root.hidden = false
  }

  hide(): void {
    this.root.hidden = true
  }
}

// ---------------------------------------------------------------- chart --

export interface ChartCallbacks {
  onSpeak(ch: string): void
  onReset(): void
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
    $('resetBtn').addEventListener('click', () => cb.onReset())
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
      return `<button class="chip" data-lang="${id}"><b>${native}</b><span>${english}</span></button>`
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
