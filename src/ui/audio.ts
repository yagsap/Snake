import { LANGUAGES, type LangId } from '../data/scripts'
import { isNativeApp, nativeSpeak, nativeWarmup } from './native'

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
  /** Diagnostic kill-switch: silences BOTH engines without touching state. */
  muted = false
  private voice: SpeechSynthesisVoice | null = null
  private available: SpeechSynthesisVoice[] = []
  private warmedVoice: string | null = null
  /** Utterance in flight, referenced so Chrome's GC cannot eat its events. */
  private currentU: SpeechSynthesisUtterance | null = null
  /** Newest cue waiting for the engine to free up (coalesced, never queued). */
  private pendingText: string | null = null
  private pendingSince = 0

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
   *
   * The utterance is REAL text at volume 0, not whitespace: WebKit
   * short-circuits empty/whitespace utterances without ever touching the
   * engine, which made a ' ' warmup a no-op exactly where it mattered (iOS).
   * The language's own word for "snake" is short, always valid, and silent.
   */
  warmup(): void {
    // Warm the engine that will actually speak: the webview engine whenever
    // it has a voice, the native fallback when it does not.
    if (!this.voice) {
      if (isNativeApp && this.warmedVoice !== `native:${this.lang}`) {
        this.warmedVoice = `native:${this.lang}`
        nativeWarmup(this.lang)
      }
      return
    }
    const voice = this.voice
    if (!voice || this.warmedVoice === voice.name) return
    this.warmedVoice = voice.name
    const u = new SpeechSynthesisUtterance(LANGUAGES[this.lang].word)
    u.voice = voice
    u.lang = voice.lang
    u.volume = 0
    u.rate = 2
    // If the browser refuses (no user activation yet, engine error), un-latch
    // so a later gesture retries instead of trusting warmth that never
    // happened — iOS grants activation on pointerUP/keydown, not pointerdown,
    // and a mis-latched warmup here was exactly how the lag came back.
    u.onerror = () => {
      if (this.warmedVoice === voice.name) this.warmedVoice = null
      this.finish(u)
    }
    // Same finish path as a real cue: a cue that lands while the warmup is
    // still sounding parks in pendingText and must drain when it ends.
    u.onend = () => this.finish(u)
    this.currentU = u
    speechSynthesis.speak(u)
  }

  /** An utterance ended or failed: release it and play the waiting cue. */
  private finish(u: SpeechSynthesisUtterance): void {
    if (this.currentU === u) this.currentU = null
    const next = this.pendingText
    this.pendingText = null
    if (next) this.speakNow(next)
  }

  /**
   * Forget that the engine was warmed. Called when the app is backgrounded:
   * the OS may unload the voice while we are hidden, and the next foreground
   * gesture should quietly re-prime it rather than trust stale warmth.
   */
  chill(): void {
    this.warmedVoice = null
  }

  speak(text: string): void {
    if (!text || this.muted) return
    // The WEBVIEW engine first, in the app too. The device A/B test showed
    // the native plugin's audio-session churn stalling frames, while the
    // same phone's Safari data had the web engine nearly free — Safari
    // manages its speech session sanely. Native remains the fallback for
    // languages the webview has no voice for.
    if (!this.voice) {
      nativeSpeak(text, this.lang)
      return
    }
    // Deferred a tick: TTS engine startup is main-thread work on several
    // platforms, and the frame it would otherwise share is the one drawing
    // the eat feedback. One frame of cue latency is imperceptible; a hitch
    // on the reward frame is not.
    setTimeout(() => {
      if (speechSynthesis.speaking || speechSynthesis.pending) {
        /**
         * COALESCE, never cancel(). cancel-then-speak on every eat is
         * blocking IPC to the speech daemon — the recurring mid-run hitch —
         * and WebKit is known to drop the new utterance outright when the
         * two are called back to back. The newest cue simply replaces any
         * waiting one and plays the moment the engine frees up; stale cues
         * are dropped, so fast eaters always hear the current question.
         */
        if (this.pendingText === null) this.pendingSince = performance.now()
        this.pendingText = text
        // Failsafe: end events are lost on some platforms. If a cue has been
        // waiting unreasonably long, the engine is wedged — the old cancel
        // path is then better than going silent for the rest of the run.
        if (performance.now() - this.pendingSince > 1500) {
          this.pendingText = null
          speechSynthesis.cancel()
          this.speakNow(text)
        }
        return
      }
      this.speakNow(text)
    }, 0)
  }

  private speakNow(text: string): void {
    const voice = this.voice
    if (!voice) return
    const u = new SpeechSynthesisUtterance(
      // A trailing ideographic stop makes ja/zh voices read a bare character
      // with sentence intonation instead of clipping it.
      /^(ja|zh)/.test(voice.lang) ? `${text}。` : text,
    )
    u.voice = voice
    u.lang = voice.lang
    u.rate = 0.9
    u.onend = () => this.finish(u)
    u.onerror = () => this.finish(u)
    this.currentU = u
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
