import { BOARD } from './config'
import type { LangId } from '../data/scripts'
import { LANGUAGES, PHONICS_EN } from '../data/scripts'
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

export type LevelKind =
  | 'chapter'
  | 'gauntlet'
  | 'words'
  | 'reverse'
  | 'ear'
  | 'phonics'

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
  /**
   * An explicit table, overriding the merge of the language's sets. Phonics
   * needs this: it maps the same letters to different cues ("apple", not
   * "ay"), and the merge is last-one-wins, so registering it as a set would
   * rewrite those letters for every other level too.
   */
  table?: CharTable
  words?: readonly WordEntry[]
  goal: LevelGoal
  paceScale: number
  /** Optional obstacle layout, by name. */
  layout?: LayoutName
}

/**
 * A picture for each kind of level.
 *
 * The word "gauntlet" is unreadable to a five-year-old and "boss" barely
 * better; a trophy is not. These are not decoration — they are the only part
 * of a level row a pre-reader can use to tell one kind of challenge from
 * another, alongside the characters themselves.
 */
export const KIND_ICON: Record<LevelKind, string> = {
  chapter: '✏️',
  gauntlet: '🏆',
  words: '📖',
  reverse: '🔁',
  ear: '👂',
  phonics: '🔊',
}

export const KIND_LABEL: Record<LevelKind, string> = {
  chapter: 'learn',
  gauntlet: 'boss',
  words: 'words',
  reverse: 'recall',
  ear: 'listen',
  phonics: 'sounds',
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
  title, kind: 'chapter', chars, goal: G(12, 3), paceScale: 0.8, ...opts,
})
const gauntlet = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'gauntlet', chars, goal: G(10, 2), paceScale: 1.2, ...opts,
})
const words = (title: string, list: readonly WordEntry[], opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'words', chars: [...new Set(list.flatMap((e) => [...e.w]))].join(''),
  words: list, goal: G(5, 3), paceScale: 0.9, ...opts,
})
const phonics = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'phonics', chars,
  table: Object.fromEntries(
    [...chars].map((c) => [c, PHONICS_EN[c] as string]),
  ),
  goal: G(10, 3), paceScale: 0.7, ...opts,
})
const reverse = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'reverse', chars, goal: G(12, 3), paceScale: 0.75, ...opts,
})
const ear = (title: string, chars: string, opts: Partial<Draft> = {}): Draft => ({
  title, kind: 'ear', chars, goal: G(12, 4), paceScale: 0.85, ...opts,
})

const JA: Draft[] = [
  chapter('first vowels', 'あいうえお', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('count to five', '一二三四五', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '六七八九十〇一二三四五', { goal: G(12, 3), paceScale: 0.8 }),
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
  words('animals', [
    { w: 'ねこ', gloss: 'cat' }, { w: 'いぬ', gloss: 'dog' },
    { w: 'とり', gloss: 'bird' }, { w: 'うま', gloss: 'horse' },
    { w: 'さる', gloss: 'monkey' }, { w: 'くま', gloss: 'bear' },
    { w: 'きつね', gloss: 'fox' }, { w: 'うさぎ', gloss: 'rabbit' },
  ]),
  reverse('recall: first half', 'あいうえおかきくけこさしすせそたちつてとなにぬねの'),
  chapter('w, wo, n', 'わをんやゆよらりるれろ'),
  words('more words', [
    { w: 'やま', gloss: 'mountain' }, { w: 'はな', gloss: 'flower' },
    { w: 'ほし', gloss: 'star' }, { w: 'ゆき', gloss: 'snow' },
    { w: 'くも', gloss: 'cloud' }, { w: 'かわ', gloss: 'river' },
    { w: 'とり', gloss: 'bird' }, { w: 'うみ', gloss: 'sea' },
    { w: 'もり', gloss: 'forest' }, { w: 'むし', gloss: 'insect' },
  ]),
  ear('the full syllabary', 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん', { goal: G(15, 4) }),
  gauntlet('every lookalike', 'るろれわねめぬあおさきちはほま', { goal: G(15, 2), paceScale: 1.3, layout: 'box' }),
  words('the menagerie', [
    { w: 'かめ', gloss: 'turtle' }, { w: 'さる', gloss: 'monkey' },
    { w: 'とら', gloss: 'tiger' }, { w: 'りす', gloss: 'squirrel' },
    { w: 'くま', gloss: 'bear' }, { w: 'うし', gloss: 'cow' },
  ], { goal: G(6, 3) }),
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
  ear('by ear: katakana', 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン', { goal: G(15, 4) }),
  gauntlet('the final exam', 'シツソンクケタワウフヌスコユチテルレ', { goal: G(15, 2), paceScale: 1.3, layout: 'box' }),
  words('menagerie II', [
    { w: 'コアラ', gloss: 'koala' }, { w: 'ゴリラ', gloss: 'gorilla' },
    { w: 'ライオン', gloss: 'lion' }, { w: 'クジラ', gloss: 'whale' },
    { w: 'ラクダ', gloss: 'camel' }, { w: 'キリン', gloss: 'giraffe' },
  ], { goal: G(6, 3) }),
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
  ], { }),
]

const RU: Draft[] = [
  chapter('familiar friends', 'АКМОТЕ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('count to five', '12345', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '6789012345', { goal: G(12, 3), paceScale: 0.8 }),
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
  ], { }),
]

const HI: Draft[] = [
  chapter('vowels I', 'अआइईउऊ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('count to five', '१२३४५', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '६७८९०१२३४५', { goal: G(12, 3), paceScale: 0.8 }),
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
  ], { }),
]

const EN: Draft[] = [
  chapter('A to E', 'ABCDE', { goal: G(10, 3), paceScale: 0.7 }),
  phonics('sounds: A to E', 'ABCDE'),
  chapter('count to five', '12345', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '6789012345', { goal: G(12, 3), paceScale: 0.8 }),
  chapter('F to J', 'FGHIJABCDE'),
  gauntlet('the bee family', 'BCDEGPTVZ', { goal: G(12, 2) }),
  chapter('K to O', 'KLMNOFGHIJ', { layout: 'garden' }),
  phonics('sounds: F to O', 'FGHIJKLMNO'),
  words('first words', [
    { w: 'CAT', gloss: 'cat' }, { w: 'DOG', gloss: 'dog' },
    { w: 'BED', gloss: 'bed' }, { w: 'FIG', gloss: 'fig' },
    { w: 'HEN', gloss: 'hen' }, { w: 'JAM', gloss: 'jam' },
  ]),
  chapter('P to T', 'PQRSTKLMNO'),
  gauntlet('mirror shapes', 'OQPRBDUV'),
  chapter('U to Z', 'UVWXYZPQRST', { layout: 'torii' }),
  phonics('sounds: P to Z', 'PQRSTUVWXYZ'),
  words('animals', [
    { w: 'FOX', gloss: 'fox' }, { w: 'OWL', gloss: 'owl' },
    { w: 'PIG', gloss: 'pig' }, { w: 'COW', gloss: 'cow' },
    { w: 'FROG', gloss: 'frog' }, { w: 'GOAT', gloss: 'goat' },
    { w: 'BEAR', gloss: 'bear' }, { w: 'DUCK', gloss: 'duck' },
  ]),
  reverse('recall: A to Z', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  ear('by ear: A to Z', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', { goal: G(15, 4) }),
  words('longer words', [
    { w: 'BIRD', gloss: 'bird' }, { w: 'FISH', gloss: 'fish' },
    { w: 'HORSE', gloss: 'horse' }, { w: 'PLANT', gloss: 'plant' },
    { w: 'MUSIC', gloss: 'music' }, { w: 'CLOUD', gloss: 'cloud' },
    { w: 'SNAKE', gloss: 'you' },
  ]),
  words('fruit and veg', [
    { w: 'PLUM', gloss: 'plum' }, { w: 'PEAR', gloss: 'pear' },
    { w: 'CORN', gloss: 'corn' }, { w: 'LIME', gloss: 'lime' },
    { w: 'MANGO', gloss: 'mango' }, { w: 'LEMON', gloss: 'lemon' },
    { w: 'GRAPE', gloss: 'grape' }, { w: 'BEAN', gloss: 'bean' },
  ]),
  words('colours', [
    { w: 'RED', gloss: 'red' }, { w: 'PINK', gloss: 'pink' },
    { w: 'BLUE', gloss: 'blue' }, { w: 'GOLD', gloss: 'gold' },
    { w: 'GREY', gloss: 'grey' }, { w: 'BLACK', gloss: 'black' },
    { w: 'WHITE', gloss: 'white' }, { w: 'BROWN', gloss: 'brown' },
  ]),
  chapter('small letters', 'abcdefghij'),
  gauntlet('b d p q', 'bdpq', { goal: G(12, 2), paceScale: 1.1 }),
  chapter('small: k to t', 'klmnopqrstabcde', { layout: 'garden' }),
  chapter('small: u to z', 'uvwxyzklmnopqrst'),
  gauntlet('small lookalikes', 'nuwmilaoce'),
  words('small words', [
    { w: 'sun', gloss: 'sun' }, { w: 'cake', gloss: 'cake' },
    { w: 'gold', gloss: 'gold' }, { w: 'wind', gloss: 'wind' },
    { w: 'lamp', gloss: 'lamp' }, { w: 'desk', gloss: 'desk' },
  ]),
  reverse('recall: a to z', 'abcdefghijklmnopqrstuvwxyz'),
  ear('by ear: a to z', 'abcdefghijklmnopqrstuvwxyz', { goal: G(15, 4) }),
  gauntlet('the whole alphabet', 'BCDEGPTVZbdpqnuwmMN', {
    goal: G(15, 2), paceScale: 1.3, layout: 'box',
  }),
]

const KO: Draft[] = [
  chapter('first consonants', 'ㄱㄴㄷㄹㅁ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('count to five', '일이삼사오', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '육칠팔구십영일이삼사오', { goal: G(12, 3), paceScale: 0.8 }),
  chapter('more consonants', 'ㅂㅅㅇㅈㅎㄱㄴㄷㄹㅁ'),
  chapter('the aspirated', 'ㅋㅌㅍㅊㄱㄷㅂㅈ', { layout: 'garden' }),
  gauntlet('one more stroke', 'ㄱㅋㄷㅌㅂㅍㅈㅊ', { goal: G(12, 2) }),
  chapter('the vowels', 'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ'),
  gauntlet('one more tick', 'ㅏㅑㅓㅕㅗㅛㅜㅠ'),
  chapter('the tense pairs', 'ㄲㄸㅃㅆㅉㄱㄷㅂㅅㅈ', { layout: 'torii' }),
  reverse('recall: the jamo', 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ'),
  ear('by ear: the jamo', 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ', { goal: G(15, 4) }),
  chapter('first syllables', '가나다라마'),
  chapter('more syllables', '바사아자하가나다라마'),
  words('first words', [
    { w: '나비', gloss: 'butterfly' }, { w: '바다', gloss: 'sea' },
    { w: '다리', gloss: 'bridge' }, { w: '소리', gloss: 'sound' },
    { w: '아기', gloss: 'baby' }, { w: '구두', gloss: 'shoes' },
    { w: '모자', gloss: 'hat' }, { w: '나무', gloss: 'tree' },
  ]),
  chapter('the o and u rows', '고노도로모보소오조초코토포호'),
  gauntlet('syllable lookalikes', '가카다타바파사자'),
  words('more words', [
    { w: '하루', gloss: 'a day' }, { w: '부모', gloss: 'parents' },
    { w: '우주', gloss: 'universe' }, { w: '기타', gloss: 'guitar' },
    { w: '도시', gloss: 'city' }, { w: '가수', gloss: 'singer' },
  ], { }),
  ear('by ear: syllables', '가나다라마바사아자차카타파하고노도로모보', { goal: G(15, 4) }),
]

const EL: Draft[] = [
  chapter('alpha to epsilon', 'ΑΒΓΔΕ', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('count to five', '12345', { goal: G(10, 3), paceScale: 0.7 }),
  chapter('all ten numbers', '6789012345', { goal: G(12, 3), paceScale: 0.8 }),
  chapter('zeta to kappa', 'ΖΗΘΙΚΑΒΓΔΕ'),
  chapter('lambda to xi', 'ΛΜΝΞΖΗΘΙΚ', { layout: 'garden' }),
  gauntlet('the i sounds', 'ΗΙΥΕΟ', { goal: G(12, 2) }),
  chapter('omicron to sigma', 'ΟΠΡΣΛΜΝΞ'),
  gauntlet('round ones', 'ΟΘΦΩΣ'),
  chapter('tau to omega', 'ΤΥΦΧΨΩΟΠΡΣ', { layout: 'torii' }),
  words('first words', [
    { w: 'ΦΩΣ', gloss: 'light' }, { w: 'ΝΕΡΟ', gloss: 'water' },
    { w: 'ΗΛΙΟΣ', gloss: 'sun' }, { w: 'ΨΑΡΙ', gloss: 'fish' },
    { w: 'ΜΗΛΟ', gloss: 'apple' }, { w: 'ΖΩΗ', gloss: 'life' },
    { w: 'ΞΥΛΟ', gloss: 'wood' }, { w: 'ΤΥΡΙ', gloss: 'cheese' },
  ]),
  reverse('recall: capitals', 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'),
  ear('by ear: capitals', 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ', { goal: G(15, 4) }),
  chapter('small: alpha to theta', 'αβγδεζηθ'),
  chapter('small: iota to pi', 'ικλμνξοπαβγδε'),
  gauntlet('small lookalikes', 'νυμθφζξ'),
  chapter('small: rho to omega', 'ρστυφχψωικλμν', { layout: 'garden' }),
  reverse('recall: small letters', 'αβγδεζηθικλμνξοπρστυφχψω'),
  ear('by ear: everything', 'αβγδεζηθικλμνξοπρστυφχψω', { goal: G(15, 4) }),
  gauntlet('every lookalike', 'νυμθφζξηιοωπρ', {
    goal: G(15, 2), paceScale: 1.3, layout: 'box',
  }),
]

const DRAFTS: Record<LangId, Draft[]> = {
  en: EN, ja: JA, zh: ZH, ru: RU, hi: HI, ko: KO, el: EL,
}

/**
 * A level's id is derived from its TITLE, not its position.
 *
 * Progress is stored per id, so index-based ids (`en-5`) meant that inserting
 * a level anywhere but the end silently handed every later level someone
 * else's cleared flag — add a numbers level at position three and a player
 * wakes up having "cleared" a boss they never saw, with the real one locked.
 * Keying on the title makes content updates safe to place where they teach
 * best. `parseCampaign` migrates saves written under the old scheme.
 */
const slug = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const CAMPAIGNS: Record<LangId, LevelSpec[]> = Object.fromEntries(
  (Object.keys(DRAFTS) as LangId[]).map((lang) => [
    lang,
    DRAFTS[lang].map((d) => ({ ...d, id: `${lang}-${slug(d.title)}` })),
  ]),
) as Record<LangId, LevelSpec[]>

/** Old index-based id for level `i`, so saved progress can be carried over. */
export function legacyLevelId(lang: LangId, index: number): string {
  return `${lang}-${index + 1}`
}

/**
 * The characters a level introduces, separated from the ones it merely revises.
 *
 * Every learn level mixes its new row into everything already met, which is
 * what makes the ladder work — but printed as one run of glyphs, level two of
 * English reads "FGHIJABCDE", and a learner cannot tell the new work from the
 * revision. Splitting them is the difference between a wall of letters and a
 * legible promise: five new, five you already have.
 */
export function levelChars(lang: LangId, index: number): {
  fresh: string[]
  revised: string[]
} {
  const levels = CAMPAIGNS[lang]
  const seen = new Set<string>()
  for (let i = 0; i < index; i++) {
    for (const c of levels[i]?.chars ?? '') seen.add(c)
  }
  const chars = [...(levels[index]?.chars ?? '')]
  return {
    fresh: chars.filter((c) => !seen.has(c)),
    revised: chars.filter((c) => seen.has(c)),
  }
}

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
