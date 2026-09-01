import type { SaveData } from '../core/storage'
import { CAMPAIGNS, KIND_LABEL, type LevelSpec } from '../game/levels'
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

export interface MenuCallbacks {
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
    $('campBtn').textContent =
      cleared > 0 ? `Levels · ${cleared}/${levels.length}` : 'Levels'
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
    $('campTitle').textContent = `${LANGUAGES[data.lang].name} levels`
    this.listEl.innerHTML = this.levels
      .map((lvl, i) => {
        const st = data.campaign[lvl.id]
        const prev = i === 0 ? null : this.levels[i - 1]
        const unlocked = i === 0 || (prev && data.campaign[prev.id]?.cleared)
        const cls = !unlocked ? 'locked' : st?.perfect ? 'perfect' : st?.cleared ? 'cleared' : ''
        const state = !unlocked ? '🔒' : st?.perfect ? '★' : st?.cleared ? '✓' : ''
        return `<button class="lvl ${cls}" data-i="${i}">
          <span class="num">${i + 1}</span>
          <span class="meta"><b>${lvl.title}</b><i>${KIND_LABEL[lvl.kind]}</i></span>
          <span class="state">${state}</span>
        </button>`
      })
      .join('')
    this.root.hidden = false
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
}

export class GameOverView {
  private root = $('overScr')

  constructor(onAgain: () => void, onMenu: () => void, onSpeak: (ch: string) => void) {
    $('againBtn').addEventListener('click', onAgain)
    $('overMenuBtn').addEventListener('click', onMenu)
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-say]')
      if (el) onSpeak(el.dataset.say as string)
    })
  }

  show(stats: GameOverStats): void {
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
