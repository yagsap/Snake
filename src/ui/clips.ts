import type { LangId } from '../data/scripts'

/**
 * Recorded voice clips, with speech synthesis as the fallback.
 *
 * Text-to-speech is good enough to say "apple" or "あ", and not good enough
 * for the thing the English content most needs: an isolated phoneme. Ask any
 * engine for /b/ and it says "buh", inventing a vowel that is not in the
 * letter — which quietly teaches the wrong thing in exactly the levels meant
 * to teach reading. A recorded human voice is also the clearest production
 * gap between this and the best children's apps.
 *
 * No clips ship yet. This layer exists so that adding them later is dropping
 * files into `public/clips/` and listing them in the manifest — no code
 * change, no release coupling, and every character that has no clip keeps
 * working through TTS exactly as it does today. That fallback is the normal
 * case, not an error path, so it must stay silent and cheap.
 *
 * MANIFEST-DRIVEN, deliberately. The obvious design is to request a clip and
 * fall back when it 404s, but that fires a failed network request for every
 * character on every cue — noisy in the console, wasteful in the app shell,
 * and it makes "no clips at all" the slowest possible configuration. One
 * small manifest tells us what exists before we ask for anything.
 */

/** Where clips and their manifest live, relative to the app's base URL. */
const DIR = 'clips'

interface Manifest {
  /** Keys present in `public/clips/`, without the file extension. */
  clips: string[]
  /** File extension for every clip, e.g. "m4a". */
  ext?: string
}

/**
 * A filesystem-safe, unambiguous key for a piece of spoken text.
 *
 * Codepoints rather than the characters themselves: "A" and "a" collide on a
 * case-insensitive filesystem, and kana, Devanagari and hanzi in filenames
 * survive neither every toolchain nor every zip. `en/0061` is ugly to read
 * and impossible to get wrong.
 */
export function clipKey(lang: LangId, text: string): string {
  const cps = [...text].map((c) => c.codePointAt(0)?.toString(16).padStart(4, '0'))
  return `${lang}/${cps.join('-')}`
}

/** A key for a named cue that is not a character, e.g. an English phoneme. */
export function namedClipKey(lang: LangId, name: string): string {
  return `${lang}/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

export class Clips {
  /** Keys the manifest says exist. Empty until `load` resolves, and empty
   *  forever if there is no manifest — both mean "always fall back". */
  private available = new Set<string>()
  private ext = 'm4a'
  private readonly buffers = new Map<string, AudioBuffer>()
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>()
  private ctx: AudioContext | null = null
  private base = ''

  /** 0 mutes clips entirely; the caller still falls back to TTS. */
  volume = 1

  /**
   * Read the manifest. Safe to call before any user gesture: it touches no
   * AudioContext. A missing or malformed manifest is not an error — it is
   * the shipping configuration today — so it resolves quietly with nothing.
   */
  async load(baseUrl: string): Promise<void> {
    this.base = baseUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${this.base}/${DIR}/manifest.json`, { cache: 'force-cache' })
      if (!res.ok) return
      const m = (await res.json()) as Manifest
      if (!m || !Array.isArray(m.clips)) return
      if (typeof m.ext === 'string' && m.ext) this.ext = m.ext
      for (const k of m.clips) if (typeof k === 'string') this.available.add(k)
    } catch {
      // Offline, absent, or not JSON. All of these mean: use TTS.
    }
  }

  /** Does a recording exist for this key? */
  has(key: string): boolean {
    return this.available.has(key)
  }

  /**
   * Play a clip. Returns false when there is nothing to play, which is the
   * caller's signal to speak instead.
   *
   * Returning a boolean rather than a promise is deliberate: the cue path is
   * called from a game event and must decide synchronously whether it still
   * owes the player a spoken cue. A clip that exists but has not been decoded
   * yet starts decoding and reports false, so the player hears TTS this time
   * and the recording from the next — never silence.
   */
  play(key: string): boolean {
    if (this.volume <= 0 || !this.available.has(key)) return false
    const buf = this.buffers.get(key)
    if (!buf) {
      void this.fetchBuffer(key)
      return false
    }
    const ctx = this.ensure()
    if (!ctx) return false
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = this.volume
    src.connect(gain).connect(ctx.destination)
    src.start()
    return true
  }

  /** Warm the clips a run is about to need, so the first cue is not a miss. */
  preload(keys: readonly string[]): void {
    for (const k of keys) {
      if (this.available.has(k) && !this.buffers.has(k)) void this.fetchBuffer(k)
    }
  }

  private async fetchBuffer(key: string): Promise<AudioBuffer | null> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const job = (async () => {
      try {
        const res = await fetch(`${this.base}/${DIR}/${key}.${this.ext}`)
        if (!res.ok) throw new Error(String(res.status))
        const bytes = await res.arrayBuffer()
        const ctx = this.ensure()
        if (!ctx) return null
        const buf = await ctx.decodeAudioData(bytes)
        this.buffers.set(key, buf)
        return buf
      } catch {
        // Listed but unfetchable: drop it so we stop trying and TTS takes over
        // permanently rather than retrying on every single cue.
        this.available.delete(key)
        return null
      } finally {
        this.pending.delete(key)
      }
    })()
    this.pending.set(key, job)
    return job
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
}
