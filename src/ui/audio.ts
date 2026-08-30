import { LANGUAGES, type LangId } from '../data/scripts'
import { nativeSpeak } from './native'

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
  private warmedVoice: string | null = null

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

  /**
   * Prime the TTS engine with a silent utterance so the voice loads while the
   * player is still in the menu. A cold engine loads the voice ~300ms after
   * the first real cue and blocks the main thread for 130–280ms doing it —
   * measured as two long frames early in the first run after a reboot, felt
   * as the snake freezing. Warm engines stay warm, so this is once per voice.
   * Must be called from within a user gesture: browsers refuse speech before
   * one, exactly like audio.
   */
  warmup(): void {
    const voice = this.voice
    if (!voice || this.warmedVoice === voice.name) return
    this.warmedVoice = voice.name
    const u = new SpeechSynthesisUtterance(' ')
    u.voice = voice
    u.lang = voice.lang
    u.volume = 0
    speechSynthesis.speak(u)
  }

  speak(text: string): void {
    if (!text) return
    if (!this.voice) {
      // No webview voice for this language — try the native synthesizer.
      nativeSpeak(text, this.lang)
      return
    }
    const voice = this.voice
    // Deferred a tick: TTS engine startup is main-thread work on several
    // platforms, and the frame it would otherwise share is the one drawing
    // the eat feedback. One frame of cue latency is imperceptible; a hitch
    // on the reward frame is not.
    setTimeout(() => {
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        speechSynthesis.cancel()
      }
      const u = new SpeechSynthesisUtterance(
        // A trailing ideographic stop makes ja/zh voices read a bare character
        // with sentence intonation instead of clipping it.
        /^(ja|zh)/.test(voice.lang) ? `${text}。` : text,
      )
      u.voice = voice
      u.lang = voice.lang
      u.rate = 0.9
      speechSynthesis.speak(u)
    }, 0)
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

  /**
   * Create the context ahead of time, from a user gesture (the Play click).
   * Creating it lazily on the first eat cost a measured ~100ms hitch on the
   * exact frame the first reward landed.
   */
  warmup(): void {
    this.ensure()
  }

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
