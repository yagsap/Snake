import { LANGUAGES, type LangId } from '../data/scripts'

/**
 * Speech (the cue) and synthesised tones (the feedback).
 *
 * Everything here subscribes to game events from the outside; the simulation
 * never calls into audio directly.
 */

/** Voices that tend to sound less robotic, preferred when present. */
const PREFERRED =
  /google|nanami|keita|kyoko|otoya|xiaoxiao|yunxi|tingting|milena|irina|swara|hemant|neural|natural|premium|enhanced/i

export class Speech {
  private voice: SpeechSynthesisVoice | null = null
  private available: SpeechSynthesisVoice[] = []

  /** Called whenever the usable voice list changes, so the UI can re-render. */
  onVoicesChanged: (() => void) | null = null

  constructor(
    private lang: LangId,
    /** Remembered voice-name preference per language, persisted by the caller. */
    private chosen: Record<string, string>,
  ) {
    if ('speechSynthesis' in window) {
      this.refresh()
      speechSynthesis.onvoiceschanged = () => {
        this.refresh()
        this.onVoicesChanged?.()
      }
    }
  }

  get supported(): boolean {
    return 'speechSynthesis' in window
  }

  get voices(): readonly SpeechSynthesisVoice[] {
    return this.available
  }

  get current(): SpeechSynthesisVoice | null {
    return this.voice
  }

  setLanguage(lang: LangId): void {
    this.lang = lang
    this.refresh()
  }

  choose(name: string): void {
    this.chosen[this.lang] = name
    this.refresh()
  }

  private refresh(): void {
    if (!this.supported) return
    const prefix = LANGUAGES[this.lang].tts
    this.available = speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith(prefix))
    this.available.sort(
      (a, b) =>
        Number(PREFERRED.test(b.name)) - Number(PREFERRED.test(a.name)) ||
        Number(b.localService) - Number(a.localService),
    )
    this.voice =
      this.available.find((v) => v.name === this.chosen[this.lang]) ??
      this.available[0] ??
      null
  }

  speak(text: string): void {
    if (!this.voice || !text) return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(
      // A trailing ideographic stop makes ja/zh voices read a bare character
      // with sentence intonation instead of clipping it.
      /^(ja|zh)/.test(this.voice.lang) ? `${text}。` : text,
    )
    u.voice = this.voice
    u.lang = this.voice.lang
    u.rate = 0.9
    speechSynthesis.speak(u)
  }
}

/**
 * Feedback tones via WebAudio.
 *
 * The context is created lazily on first use because browsers refuse audio
 * before a user gesture; by the time a tone is wanted the player has clicked
 * Play, so creation succeeds.
 */
export class Tones {
  private ctx: AudioContext | null = null
  enabled = true

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /**
   * One enveloped oscillator note.
   * The gain ramp to near-zero before stop avoids the click a hard cutoff makes.
   */
  play(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    gain = 0.08,
    delay = 0,
  ): void {
    if (!this.enabled) return
    const ctx = this.ensure()
    if (!ctx) return
    try {
      const t0 = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const amp = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      amp.gain.setValueAtTime(gain, t0)
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
      osc.connect(amp)
      amp.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + duration)
    } catch {
      /* audio is never worth crashing over */
    }
  }

  // Named cues, so call sites read as intent rather than as frequencies.

  eat(streak: number): void {
    // Rising pair, pitched up slightly with the streak — the sound itself
    // tells you the combo is building.
    const base = 660 * Math.pow(1.06, Math.min(streak, 12))
    this.play(base, 0.12)
    this.play(base * 4 / 3, 0.14, 'sine', 0.08, 0.09)
  }

  wrong(): void {
    this.play(180, 0.25, 'square', 0.05)
  }

  death(): void {
    this.play(140, 0.5, 'sawtooth', 0.05)
    this.play(70, 0.7, 'sawtooth', 0.04, 0.12)
  }

  multiplierUp(): void {
    this.play(523, 0.1)
    this.play(659, 0.1, 'sine', 0.08, 0.08)
    this.play(784, 0.22, 'sine', 0.08, 0.16)
  }
}
