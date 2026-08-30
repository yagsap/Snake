import type { SaveData } from '../core/storage'
import {
  LANGUAGES,
  LANG_IDS,
  setNamesFor,
  type CharTable,
  type LangId,
} from '../data/scripts'
import { SPAWN } from '../game/config'
import { MODES, MODE_IDS, type ModeId } from '../game/modes'

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
        const cls = s.err > 0 ? 'weak' : s.ok >= SPAWN.masteredAt ? 'mastered' : ''
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
