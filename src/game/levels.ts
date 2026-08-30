import { BOARD } from './config'
import type { LangId } from '../data/scripts'
import { LANGUAGES } from '../data/scripts'
import type { CharTable } from '../data/scripts'

/**
 * The level system.
 *
 * A level is pure data: which characters are in play, what the cue looks
 * like, what the board looks like, and what counts as done. The simulation
 * and renderer never branch on "what level is this" — they consume the same
 * few primitives (a table, a rules object, an optional word list, an optional
 * obstacle set), which is what keeps nineteen levels from becoming nineteen
 * code paths.
 *
 * Design intent, type by type:
 * - chapter:  the curriculum spine. One new row/group at a time, with the
 *             previous group mixed in — distractors are always something the
 *             player has actually learned, so discrimination stays honest.
 * - gauntlet: a boss made of one confusable family. The CONFUSE data turned
 *             into an arena; where the game teaches hardest.
 * - words:    eat characters IN ORDER to spell a real word; the snake's body
 *             ends up carrying it. Upgrades phonetics to meaning.
 * - reverse:  the cue is the GLYPH, the tiles are romanizations. Recognition
 *             and recall are different skills; this trains the second.
 * - ear:      voice only, no text cue. The endgame of recognition.
 */

export interface WordEntry {
  /** The word, one playable character per position, no repeats. */
  w: string
  /** English gloss, shown when the word completes. */
  gloss: string
}

export type LevelKind = 'chapter' | 'gauntlet' | 'words' | 'reverse' | 'ear'

export interface LevelGoal {
  /** Correct eats (or completed words, in a words level) needed to clear. */
  count: number
  /** Misses allowed. Exceeding this fails the level immediately. */
  maxMisses: number
}

export interface LevelSpec {
  id: string
  title: string
  kind: LevelKind
  /** Characters in play — a subset of the language's tables. */
  chars: string
  words?: readonly WordEntry[]
  goal: LevelGoal
  wrap: boolean
  paceScale: number
  /** Optional obstacle layout, by name. */
  layout?: LayoutName
}

export const KIND_LABEL: Record<LevelKind, string> = {
  chapter: 'learn',
  gauntlet: 'boss',
  words: 'words',
  reverse: 'recall',
  ear: 'listen',
}

// ---------------------------------------------------------------- layouts --
/**
 * Obstacle layouts as 16x16 ASCII maps — '#' is a stone, '.' is open.
 * Authored, not generated: a good arena is a composition, and readable
 * source is the whole point of the format. The centre band (rows 7–9) is
 * kept clear because the snake spawns there.
 */
const LAYOUT_ART = {
  garden: [
    '................',
    '..#..........#..',
    '................',
    '.....#....#.....',
    '................',
    '.#............#.',
    '................',
    '................',
    '................',
    '................',
    '.#............#.',
    '................',
    '.....#....#.....',
    '................',
    '..#..........#..',
    '................',
  ],
  torii: [
    '................',
    '................',
    '................',
    '...#........#...',
    '...#........#...',
    '...#........#...',
    '................',
    '................',
    '................',
    '................',
    '...#........#...',
    '...#........#...',
    '...#........#...',
    '................',
    '................',
    '................',
  ],
  box: [
    '................',
    '................',
    '..#####..#####..',
    '..#..........#..',
    '..#..........#..',
    '..#..........#..',
    '................',
    '................',
    '................',
    '................',
    '..#..........#..',
    '..#..........#..',
    '..#..........#..',
    '..#####..#####..',
    '................',
    '................',
  ],
} as const

export type LayoutName = keyof typeof LAYOUT_ART

/** Parse a layout into cell indices (y * cells + x). Throws on malformed art. */
export function layoutCells(name: LayoutName): Set<number> {
  const art = LAYOUT_ART[name]
  const cells = new Set<number>()
  if (art.length !== BOARD.cells) throw new Error(`layout ${name}: bad row count`)
  art.forEach((row, y) => {
    if (row.length !== BOARD.cells) throw new Error(`layout ${name}: row ${y} length`)
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') cells.add(y * BOARD.cells + x)
    }
  })
  return cells
}

// -------------------------------------------------------------- campaigns --

const G = (count: number, maxMisses: number): LevelGoal => ({ count, maxMisses })

/** Terse level builder; ids are assigned per-language below and stay stable. */
interface Draft extends Omit<LevelSpec, 'id'> {}
const chapter = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'chapter', chars, goal: G(12, 3), wrap: true, paceScale: 0.8, ...opts,
})
const gauntlet = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'gauntlet', chars, goal: G(10, 2), wrap: false, paceScale: 1.2, ...opts,
})
const words = (title: string, list: readonly WordEntry[], opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'words', chars: [...new Set(list.flatMap((e) => [...e.w]))].join(''),
  words: list, goal: G(5, 3), wrap: true, paceScale: 0.9, ...opts,
})
const reverse = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'reverse', chars, goal: G(12, 3), wrap: true, paceScale: 0.75, ...opts,
})
const ear = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'ear', chars, goal: G(12, 4), wrap: true, paceScale: 0.85, ...opts,
})

const JA: Draft[] = [
  chapter('first vowels', 'あいうえお', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('the k row', 'かきくけこあいうえお'),
  chapter('the s row', 'さしすせそかきくけこ'),
  gauntlet('sneaky three', 'さきち'),
  chapter('the t row', 'たちつてとさしすせそ', { layout: 'garden' }),
  ear('by ear: the start', 'あいうえおかきくけこ'),
  chapter('the n row', 'なにぬねのたちつてと'),
  gauntlet('round bellies', 'ぬめのあお'),
  words('first words', [
    { w: 'ねこ', gloss: 'cat' }, { w: 'いぬ', gloss: 'dog' },
    { w: 'たこ', gloss: 'octopus' }, { w: 'なつ', gloss: 'summer' },
    { w: 'うた', gloss: 'song' }, { w: 'きつね', gloss: 'fox' },
    { w: 'たぬき', gloss: 'tanuki' }, { w: 'さけ', gloss: 'salmon' },
  ]),
  chapter('the h row', 'はひふへほなにぬねの', { layout: 'torii' }),
  chapter('the m row', 'まみむめもはひふへほ'),
  gauntlet('brush cousins', 'はほまめぬ', { goal: G(10, 2) }),
  chapter('y & r rows', 'やゆよらりるれろまみむめも', { layout: 'garden' }),
  reverse('recall: first half', 'あいうえおかきくけこさしすせそたちつてとなにぬねの'),
  chapter('w, wo, n', 'わをんやゆよらりるれろ'),
  words('more words', [
    { w: 'やま', gloss: 'mountain' }, { w: 'はな', gloss: 'flower' },
    { w: 'ほし', gloss: 'star' }, { w: 'ゆき', gloss: 'snow' },
    { w: 'くも', gloss: 'cloud' }, { w: 'かわ', gloss: 'river' },
    { w: 'とり', gloss: 'bird' }, { w: 'うみ', gloss: 'sea' },
    { w: 'もり', gloss: 'forest' }, { w: 'むし', gloss: 'insect' },
  ]),
  ear('the full syllabary', 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん', { goal: G(15, 4), wrap: false }),
  gauntlet('every lookalike', 'るろれわねめぬあおさきちはほま', { goal: G(15, 2), paceScale: 1.3, layout: 'box' }),
  words('the menagerie', [
    { w: 'かめ', gloss: 'turtle' }, { w: 'さる', gloss: 'monkey' },
    { w: 'とら', gloss: 'tiger' }, { w: 'りす', gloss: 'squirrel' },
    { w: 'くま', gloss: 'bear' }, { w: 'うし', gloss: 'cow' },
  ], { goal: G(6, 3), wrap: false }),
  // The dakuten arc: each voiced row is taught against its unvoiced base,
  // because the base IS the confusion — the only difference is the dots.
  chapter('two little dots', 'がぎぐげごかきくけこ'),
  chapter('the buzzing row', 'ざじずぜぞさしすせそ'),
  chapter('the d row', 'だぢづでどたちつてと', { layout: 'garden' }),
  chapter('b & p rows', 'ばびぶべぼぱぴぷぺぽはひふへほ'),
  gauntlet('dot or circle', 'ばぱびぴぶぷべぺぼぽ', { goal: G(12, 2) }),
  words('voiced words', [
    { w: 'へび', gloss: 'snake — that’s you' }, { w: 'みず', gloss: 'water' },
    { w: 'かぜ', gloss: 'wind' }, { w: 'たまご', gloss: 'egg' },
    { w: 'めがね', gloss: 'glasses' }, { w: 'ぶた', gloss: 'pig' },
    { w: 'ねずみ', gloss: 'mouse' }, { w: 'りんご', gloss: 'apple' },
    { w: 'ぞう', gloss: 'elephant' }, { w: 'でんわ', gloss: 'telephone' },
  ]),
  ear('by ear: voiced', 'がぎぐげござじずぜぞだでどばびぶべぼぱぴぷぺぽかさたは', { goal: G(15, 4) }),
  chapter('katakana begins', 'アイウエオカキクケコ'),
  gauntlet('the infamous four', 'シツソン', { paceScale: 1.1 }),
  gauntlet('ku·ke·ta / wa·u·fu', 'クケタワウフ'),
  chapter('the s & t rows', 'サシスセソタチツテトカキクケコ'),
  chapter('n & h rows', 'ナニヌネノハヒフヘホサシスセソ', { layout: 'torii' }),
  gauntlet('needle points', 'シツソンリ'),
  chapter('m & y rows', 'マミムメモヤユヨナニヌネノ'),
  chapter('r & w rows', 'ラリルレロワヲンマミムメモ', { layout: 'garden' }),
  reverse('recall: katakana', 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'),
  words('borrowed words', [
    { w: 'カメラ', gloss: 'camera' }, { w: 'ホテル', gloss: 'hotel' },
    { w: 'ミルク', gloss: 'milk' }, { w: 'アニメ', gloss: 'anime' },
    { w: 'メロン', gloss: 'melon' }, { w: 'ピアノ', gloss: 'piano' },
    { w: 'テレビ', gloss: 'TV' }, { w: 'パンダ', gloss: 'panda' },
    { w: 'バス', gloss: 'bus' }, { w: 'ペン', gloss: 'pen' },
  ]),
  ear('by ear: katakana', 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン', { goal: G(15, 4), wrap: false }),
  gauntlet('the final exam', 'シツソンクケタワウフヌスコユチテルレ', { goal: G(15, 2), paceScale: 1.3, layout: 'box' }),
  words('menagerie II', [
    { w: 'コアラ', gloss: 'koala' }, { w: 'ゴリラ', gloss: 'gorilla' },
    { w: 'ライオン', gloss: 'lion' }, { w: 'クジラ', gloss: 'whale' },
    { w: 'ラクダ', gloss: 'camel' }, { w: 'キリン', gloss: 'giraffe' },
  ], { goal: G(6, 3), wrap: false }),
]

const ZH: Draft[] = [
  chapter('numbers I', '一二三四五', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('numbers II', '六七八九十一二三四五'),
  chapter('people', '人大天太夫小'),
  gauntlet('person or enter?', '人入大天太夫'),
  chapter('nature', '日月水火山木', { layout: 'garden' }),
  gauntlet('sun, say, eye', '日曰目白百'),
  chapter('body & mind', '口手心毛目'),
  words('first words', [
    { w: '大人', gloss: 'adult' }, { w: '山水', gloss: 'landscape' },
    { w: '人口', gloss: 'population' }, { w: '水牛', gloss: 'buffalo' },
    { w: '火山', gloss: 'volcano' }, { w: '大小', gloss: 'size' },
  ]),
  chapter('places & rank', '中国王玉土士上下'),
  gauntlet('strokes apart', '土士王玉未末己已', { layout: 'torii' }),
  chapter('things & people II', '车门马女子本白'),
  reverse('recall: the set so far', '一二三四五六七八九十人大天小日月水火山木口手心中国王土'),
  ear('by ear: everything', '一二三四五六七八九十人入大天太夫小中国王玉土士日月水火山木口手心毛目白百上下', { goal: G(15, 4) }),
  words('words II', [
    { w: '中国', gloss: 'China' }, { w: '国王', gloss: 'king' },
    { w: '女王', gloss: 'queen' }, { w: '白天', gloss: 'daytime' },
    { w: '木马', gloss: 'wooden horse' }, { w: '上山', gloss: 'climb the hill' },
  ], { wrap: false }),
]

const RU: Draft[] = [
  chapter('familiar friends', 'АКМОТЕ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('false friends', 'ВНРСУХАКМОТЕ'),
  gauntlet('lookalike pack', 'ВБНПР'),
  chapter('new shapes I', 'ГДЖЗЛВНРСУ', { layout: 'garden' }),
  words('first words', [
    { w: 'ДА', gloss: 'yes' }, { w: 'НЕТ', gloss: 'no' },
    { w: 'ДОМ', gloss: 'house' }, { w: 'КОТ', gloss: 'cat' },
    { w: 'ДВА', gloss: 'two' }, { w: 'СОК', gloss: 'juice' },
  ]),
  chapter('new shapes II', 'ИЙФЦЧГДЖЗЛ'),
  gauntlet('dots and tails', 'ИЙШЩЦЧ'),
  chapter('the last letters', 'ШЩЫЭЮЯЁИЙФ', { layout: 'torii' }),
  reverse('recall: the alphabet', 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЫЭЮЯ'),
  ear('by ear: the alphabet', 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЫЭЮЯ', { goal: G(15, 4) }),
  words('words II', [
    { w: 'МИР', gloss: 'peace / world' }, { w: 'ЛЕС', gloss: 'forest' },
    { w: 'НОС', gloss: 'nose' }, { w: 'РОТ', gloss: 'mouth' },
    { w: 'СТОЛ', gloss: 'table' }, { w: 'ХЛЕБ', gloss: 'bread' },
  ], { wrap: false }),
]

const HI: Draft[] = [
  chapter('vowels I', 'अआइईउऊ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('vowels II', 'एऐओऔअआइईउऊ'),
  gauntlet('vowel pairs', 'अआइईउऊएऐओऔ', { goal: G(12, 2) }),
  chapter('velars & palatals', 'कखगघचछजझ'),
  chapter('retroflex & dental', 'टठडढतथदधनकखगघ', { layout: 'garden' }),
  gauntlet('the flat-top four', 'टठडढतनथध'),
  chapter('labials & semivowels', 'पफबभमयरलव'),
  gauntlet('belly to belly', 'बवभमपफ'),
  chapter('sibilants & the rest', 'शषसहङञणपफबभम', { layout: 'torii' }),
  words('first words', [
    { w: 'जल', gloss: 'water' }, { w: 'घर', gloss: 'home' },
    { w: 'मन', gloss: 'mind' }, { w: 'वन', gloss: 'forest' },
    { w: 'फल', gloss: 'fruit' }, { w: 'कमल', gloss: 'lotus' },
    { w: 'बस', gloss: 'bus' }, { w: 'गज', gloss: 'elephant' },
  ]),
  reverse('recall: consonants', 'कखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह'),
  ear('by ear: everything', 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह', { goal: G(15, 4) }),
  words('words II', [
    { w: 'नमक', gloss: 'salt' }, { w: 'महल', gloss: 'palace' },
    { w: 'पवन', gloss: 'breeze' }, { w: 'रथ', gloss: 'chariot' },
    { w: 'वजन', gloss: 'weight' }, { w: 'शहद', gloss: 'honey' },
  ], { wrap: false }),
]

const DRAFTS: Record<LangId, Draft[]> = { ja: JA, zh: ZH, ru: RU, hi: HI }

export const CAMPAIGNS: Record<LangId, LevelSpec[]> = Object.fromEntries(
  (Object.keys(DRAFTS) as LangId[]).map((lang) => [
    lang,
    DRAFTS[lang].map((d, i) => ({ ...d, id: `${lang}-${i + 1}` })),
  ]),
) as Record<LangId, LevelSpec[]>

/** Build a table for an arbitrary character subset, searching all the language's sets. */
export function tableFromChars(lang: LangId, chars: string): CharTable {
  const merged: CharTable = Object.assign(
    {},
    ...Object.values(LANGUAGES[lang].sets),
  )
  const out: CharTable = {}
  for (const ch of chars) {
    const sound = merged[ch]
    if (sound !== undefined) out[ch] = sound
  }
  return out
}

// ------------------------------------------------------------------ daily --

/** Local-date key, e.g. "2026-08-31". */
export function dateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Everyone playing on the same day gets the same board. */
export function dailySeed(d = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}
