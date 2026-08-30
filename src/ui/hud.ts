import { SCORING } from '../game/config'
import { comboMultiplier, untilNextMultiplier } from '../game/progression'

/**
 * The in-game HUD.
 *
 * DOM writes are the most expensive thing a per-frame update can do, so every
 * field caches its last written value and only touches the DOM on change.
 * The score itself animates — it counts up to the true value rather than
 * snapping — because a number the eye can see moving is one the player
 * actually notices growing.
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el as T
}

export class Hud {
  private scoreEl = $('score')
  private streakEl = $('streak')
  private multEl = $('mult')
  private cueEl = $('cueText')
  private sealEl = $('seal')
  private goalEl = $('goalLine')
  private wordEl = $('wordLine')
  private lastGoalText = ''

  private shownScore = 0
  private targetScore = 0
  private lastStreakText = ''
  private lastMultText = ''

  reset(): void {
    this.shownScore = 0
    this.targetScore = 0
    this.scoreEl.textContent = '0'
    this.setStreak(0)
  }

  setScore(score: number): void {
    this.targetScore = score
  }

  setStreak(streak: number): void {
    const mult = comboMultiplier(streak)
    const until = untilNextMultiplier(streak)
    const streakText = String(streak)
    const multText =
      mult >= SCORING.maxMultiplier
        ? `×${mult} max`
        : mult > 1
          ? `×${mult} · ${until} to ×${mult + 1}`
          : `${until} to ×2`
    if (streakText !== this.lastStreakText) {
      this.streakEl.textContent = streakText
      this.lastStreakText = streakText
    }
    if (multText !== this.lastMultText) {
      this.multEl.textContent = multText
      this.multEl.classList.toggle('hot', mult > 1)
      this.lastMultText = multText
    }
  }

  setCue(text: string): void {
    this.cueEl.textContent = text
  }

  /** Big-glyph styling for reverse levels, where the cue IS the character. */
  setCueGlyph(on: boolean): void {
    this.sealEl.classList.toggle('glyph-cue', on)
  }

  /** Level goal readout, e.g. "7/12 · miss 1/3". Empty string hides it. */
  setGoal(text: string): void {
    if (text === this.lastGoalText) return
    this.lastGoalText = text
    this.goalEl.textContent = text
    this.goalEl.hidden = !text
  }

  /**
   * Word-level progress strip: the word's characters with the eaten part
   * highlighted. Data comes from our own tables, never user input.
   */
  setWord(word: string | null, index: number): void {
    if (!word) {
      this.wordEl.hidden = true
      this.wordEl.innerHTML = ''
      return
    }
    this.wordEl.hidden = false
    this.wordEl.innerHTML = [...word]
      .map((ch, i) => {
        const cls = i < index ? 'done' : i === index ? 'now' : 'todo'
        return `<span class="${cls}">${ch}</span>`
      })
      .join('')
  }

  /** Pulse the seal — visual confirmation that the cue just played. */
  pulseSeal(): void {
    this.sealEl.classList.remove('pulse')
    void this.sealEl.offsetWidth // restart the CSS animation
    this.sealEl.classList.add('pulse')
  }

  setSealHidden(hidden: boolean): void {
    this.sealEl.classList.toggle('hidden-cue', hidden)
  }

  /** Per-frame: run the count-up. Cheap when idle — one comparison. */
  update(dt: number): void {
    if (this.shownScore === this.targetScore) return
    const diff = this.targetScore - this.shownScore
    // Close ~90% of the gap per quarter second, minimum 1 point per frame.
    const step = Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 9)))
    this.shownScore +=
      Math.sign(diff) * Math.min(step, Math.abs(diff))
    this.scoreEl.textContent = String(this.shownScore)
  }
}
