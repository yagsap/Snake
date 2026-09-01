import { isLangId, type LangId } from '../data/scripts'
import { isModeId, type ModeId } from '../game/modes'

/**
 * Persistence.
 *
 * Two rules the prototype broke. First, anything read back from localStorage
 * is untrusted input — it may be from an older build, hand-edited, or absent —
 * so it is validated on load rather than spread straight into live state.
 * Second, writes are debounced: the prototype called `save()` inside the
 * collision branch, so a fast run wrote a full JSON serialisation of every
 * character's stats on every bite, on the frame where the game was already
 * doing the most work.
 */

const KEY = 'script-snake-v2'
const LEGACY_KEY = 'script-snake-v1'
const WRITE_DELAY_MS = 400

/** Per-character performance, used for both the study chart and target bias. */
export interface CharStat {
  ok: number
  err: number
}

export interface LevelState {
  cleared: boolean
  perfect: boolean
}

export interface SaveData {
  stats: Record<string, CharStat>
  bestScore: number
  bestEaten: number
  /** Campaign progress by level id. */
  campaign: Record<string, LevelState>
  /** Best daily-challenge result, for today only. */
  daily: { date: string; best: number } | null
  lang: LangId
  setName: string
  mode: ModeId
  /** Remembered speech-synthesis voice name, per language. */
  voices: Record<string, string>
  /** Show the romanisation during play, or make the player go by ear alone. */
  showRomaji: boolean
  reducedMotion: boolean
  /** Has this player answered "what do you want to learn?". Gates the
   *  first-launch flow that drops a new player straight into level 1. */
  onboarded: boolean
}

const defaults = (): SaveData => ({
  stats: {},
  bestScore: 0,
  bestEaten: 0,
  campaign: {},
  daily: null,
  lang: 'ja',
  setName: 'hiragana',
  mode: 'drift',
  voices: {},
  showRomaji: true,
  reducedMotion: false,
  onboarded: false,
})

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

function parseStats(raw: unknown): Record<string, CharStat> {
  const out: Record<string, CharStat> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [ch, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    out[ch] = { ok: Math.max(0, num(v['ok'])), err: Math.max(0, num(v['err'])) }
  }
  return out
}

function parseCampaign(raw: unknown): Record<string, LevelState> {
  const out: Record<string, LevelState> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    out[id] = { cleared: bool(o['cleared'], false), perfect: bool(o['perfect'], false) }
  }
  return out
}

function parseDaily(raw: unknown): SaveData['daily'] {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o['date'] !== 'string') return null
  return { date: o['date'], best: Math.max(0, num(o['best'])) }
}

function parseVoices(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export function load(): SaveData {
  const base = defaults()
  let raw: unknown = null
  try {
    raw =
      JSON.parse(localStorage.getItem(KEY) ?? 'null') ??
      JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null')
  } catch {
    raw = null
  }
  if (!raw || typeof raw !== 'object') return base
  const d = raw as Record<string, unknown>

  return {
    stats: parseStats(d['stats']),
    bestScore: Math.max(0, num(d['bestScore'])),
    // v1 stored the eaten count under `best`; carry it forward rather than
    // silently resetting a returning player's record to zero.
    bestEaten: Math.max(0, num(d['bestEaten'], num(d['best']))),
    campaign: parseCampaign(d['campaign']),
    daily: parseDaily(d['daily']),
    lang: isLangId(d['lang']) ? d['lang'] : base.lang,
    setName: typeof d['setName'] === 'string' ? d['setName'] : base.setName,
    mode: isModeId(d['mode']) ? d['mode'] : base.mode,
    voices: parseVoices(d['voices'] ?? d['chosen']),
    showRomaji: bool(d['showRomaji'], base.showRomaji),
    reducedMotion: bool(d['reducedMotion'], base.reducedMotion),
    // Anyone with progress predates the flag and must never be asked again:
    // onboarding a returning player reads as the game forgetting them.
    onboarded:
      bool(d['onboarded'], false) ||
      Object.keys(parseStats(d['stats'])).length > 0 ||
      Math.max(0, num(d['bestScore'])) > 0,
  }
}

let writeTimer: ReturnType<typeof setTimeout> | undefined
let pending: SaveData | null = null

function flush(): void {
  if (!pending) return
  try {
    localStorage.setItem(KEY, JSON.stringify(pending))
  } catch {
    // Private browsing, quota, or a disabled store. Losing progress is bad
    // but not worth taking the run down for.
  }
  pending = null
}

/** Queue a write. Repeated calls inside the delay collapse into one. */
export function save(data: SaveData): void {
  pending = data
  clearTimeout(writeTimer)
  writeTimer = setTimeout(flush, WRITE_DELAY_MS)
}

/** Write immediately. Used when the page is going away. */
export function saveNow(data: SaveData): void {
  pending = data
  clearTimeout(writeTimer)
  flush()
}
