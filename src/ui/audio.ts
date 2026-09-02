import { LANGUAGES, type LangId } from '../data/scripts'
import { Clips, clipKey } from './clips'
import { nativeSpeak, nativeSpeakAvailable, nativeWarmup } from './native'

/**
 * Speech (the cue) and synthesised tones (the feedback).
 *
 * Everything here subscribes to game events from the outside; the simulation
 * never calls into audio directly.
 */

/** How loud the ambient bed sits. Deliberately low: it is a room tone, not
 *  a soundtrack, and the spoken cue must always win. */
const MUSIC_LEVEL = 0.055

/** A pentatonic scale — any two notes sound consonant together, which is what
 *  lets the wandering voices drift without ever clashing. */
const PENTATONIC = [196, 220, 262, 294, 330, 392, 440] as const

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

  /** Recorded-voice layer; empty until clips ship. See src/ui/clips.ts. */
  readonly clips = new Clips()

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
      if (nativeSpeakAvailable() && this.warmedVoice !== `native:${this.lang}`) {
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
    // A recorded human voice when one exists for this exact cue, TTS when it
    // does not. `play` answers synchronously and reports false for a clip it
    // has not decoded yet, so the player hears synthesis this time and the
    // recording next — the one thing that must never happen here is silence.
    if (this.clips.play(clipKey(this.lang, text))) return
    // In the app: our own native bridge, which holds one audio session open
    // forever and does all speech work off the main thread. A second device
    // A/B showed even the webview engine paying a per-utterance session
    // transition inside an app shell; this path pays it once, at launch.
    if (nativeSpeak(text, this.lang)) return
    if (!this.voice) return
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

  /**
   * Speak an INTERFACE label — a button, a card, a level name.
   *
   * Deliberately separate from `speak`, which uses the voice of the language
   * being learned: a Japanese voice reading "All levels" is not help, it is
   * noise. This is the app talking to the child in the language they already
   * speak, so a player who cannot read a single word on the screen can still
   * find out what everything does by touching it.
   *
   * It never cancels and never queues behind the cue. UI speech happens on
   * menus, where nothing else is talking; treating it as interruptible chatter
   * rather than content is what keeps it from fighting the lesson.
   */
  sayUI(text: string): void {
    const say = text.trim()
    if (!say || this.muted) return
    if (nativeSpeak(say, 'en')) return
    const voice = this.uiVoice()
    if (!voice) return
    const u = new SpeechSynthesisUtterance(say)
    u.voice = voice
    u.lang = voice.lang
    // A shade slower than an adult would read it, and no slower — children
    // tune out speech that sounds like it is being spelled at them.
    u.rate = 0.92
    speechSynthesis.speak(u)
  }

  private uiVoiceCache: SpeechSynthesisVoice | null = null

  /** An English voice, chosen from the FULL list rather than `available`,
   *  which only ever holds voices for the language being learned. */
  private uiVoice(): SpeechSynthesisVoice | null {
    if (this.uiVoiceCache) return this.uiVoiceCache
    const all = speechSynthesis.getVoices()
    this.uiVoiceCache =
      all.find((v) => v.lang.toLowerCase().startsWith('en') && v.localService) ??
      all.find((v) => v.lang.toLowerCase().startsWith('en')) ??
      null
    return this.uiVoiceCache
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
  private keepAlive: OscillatorNode | null = null
  enabled = true

  /**
   * Create the context ahead of time, from a user gesture (the Play click).
   * Creating it lazily on the first eat cost a measured ~100ms hitch on the
   * exact frame the first reward landed.
   *
   * It also parks an inaudible oscillator on the destination, forever. iOS
   * suspends an idle audio context and reactivating it is a media-server
   * round trip on the main thread — the same stall mechanism the on-device
   * A/B convicted the speech plugin of. A context that is never idle never
   * pays it; the running silence costs no audible output and no measurable
   * CPU.
   */
  warmup(): void {
    const ctx = this.ensure()
    if (!ctx || this.keepAlive) return
    try {
      const osc = ctx.createOscillator()
      const mute = ctx.createGain()
      mute.gain.value = 0
      osc.connect(mute)
      mute.connect(ctx.destination)
      osc.start()
      this.keepAlive = osc
    } catch {
      /* keep-alive is best-effort */
    }
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

  /**
   * The ambient bed: two slow sine voices drifting through a pentatonic
   * scale, plus a low drone.
   *
   * Generated rather than shipped. A music file would mean licensing, a
   * download, and a decoder; a handful of oscillators means none of those and
   * never repeats audibly. The pentatonic scale is chosen so any two notes
   * sounding together are consonant — which is what lets voices drift freely
   * without ever needing to agree.
   *
   * It ducks hard under speech. The cue IS the game; music that competes with
   * the thing the player is straining to hear is worse than silence.
   */
  private bed: { gain: GainNode; stop: () => void } | null = null
  musicOn = true

  startMusic(): void {
    if (!this.musicOn || this.bed) return
    const ctx = this.ensure()
    if (!ctx) return
    try {
      const out = ctx.createGain()
      out.gain.value = 0
      out.connect(ctx.destination)
      // Fade in over four seconds: music that arrives suddenly is noticed,
      // and this is meant to be felt rather than heard.
      out.gain.linearRampToValueAtTime(MUSIC_LEVEL, ctx.currentTime + 4)

      const nodes: OscillatorNode[] = []
      // A drone a couple of octaves down holds the whole thing together.
      const drone = ctx.createOscillator()
      const dg = ctx.createGain()
      drone.type = 'sine'
      drone.frequency.value = 98 // G2
      dg.gain.value = 0.5
      drone.connect(dg).connect(out)
      drone.start()
      nodes.push(drone)

      // Two wandering voices. Each waits a different, irrational-ish time
      // between notes so the pair never settles into a loop.
      for (let v = 0; v < 2; v++) {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = 'sine'
        g.gain.value = 0
        osc.connect(g).connect(out)
        osc.start()
        nodes.push(osc)
        const step = (): void => {
          if (!this.bed) return
          const t = ctx.currentTime
          const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)] as number
          osc.frequency.setValueAtTime(note * (v === 0 ? 1 : 2), t)
          g.gain.cancelScheduledValues(t)
          g.gain.setValueAtTime(0, t)
          g.gain.linearRampToValueAtTime(0.5, t + 1.2)
          g.gain.linearRampToValueAtTime(0, t + 3.4)
          this.bedTimers.push(
            setTimeout(step, 3200 + Math.random() * 2600 + v * 900),
          )
        }
        this.bedTimers.push(setTimeout(step, 600 + v * 2100))
      }

      this.bed = {
        gain: out,
        stop: () => {
          for (const n of nodes) {
            try {
              n.stop()
            } catch {
              /* already stopped */
            }
          }
        },
      }
    } catch {
      /* music is garnish; never worth taking the run down for */
    }
  }

  stopMusic(): void {
    for (const t of this.bedTimers) clearTimeout(t)
    this.bedTimers.length = 0
    const bed = this.bed
    this.bed = null
    if (!bed || !this.ctx) return
    const t = this.ctx.currentTime
    bed.gain.gain.cancelScheduledValues(t)
    bed.gain.gain.setValueAtTime(bed.gain.gain.value, t)
    bed.gain.gain.linearRampToValueAtTime(0, t + 0.6)
    setTimeout(() => bed.stop(), 800)
  }

  private bedTimers: Array<ReturnType<typeof setTimeout>> = []

  /** Duck the bed under a spoken cue, then let it breathe back in. */
  duck(seconds = 1.6): void {
    const ctx = this.ctx
    if (!this.bed || !ctx) return
    const g = this.bed.gain.gain
    const t = ctx.currentTime
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(MUSIC_LEVEL * 0.18, t + 0.12)
    g.linearRampToValueAtTime(MUSIC_LEVEL, t + seconds)
  }

  /** One soft tick per countdown number. */
  count(): void {
    this.play(523, 0.07, 'sine', 0.05)
  }

  /** The countdown resolving into play. */
  go(): void {
    this.play(784, 0.09)
    this.play(1046, 0.16, 'sine', 0.07, 0.07)
  }

  mastered(): void {
    // Brighter and higher than the multiplier: mastering a character is the
    // game's biggest moment and deserves its own sound.
    this.play(659, 0.09)
    this.play(880, 0.09, 'sine', 0.08, 0.07)
    this.play(1319, 0.3, 'sine', 0.07, 0.14)
  }
}
