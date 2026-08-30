/**
 * Writing-system data.
 *
 * A "table" maps one character to its romanisation. The compact source format
 * is `<glyph><sound>` pairs separated by spaces — every glyph here is a single
 * UTF-16 code unit, so `x[0]` / `x.slice(1)` is a safe split.
 */
const table = (src: string): CharTable =>
  Object.fromEntries(src.split(' ').map((x) => [x[0] as string, x.slice(1)]))

export type CharTable = Record<string, string>

export const HIRAGANA = table(
  'あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn',
)

export const KATAKANA = table(
  'アa イi ウu エe オo カka キki クku ケke コko サsa シshi スsu セse ソso タta チchi ツtsu テte トto ナna ニni ヌnu ネne ノno ハha ヒhi フfu ヘhe ホho マma ミmi ムmu メme モmo ヤya ユyu ヨyo ラra リri ルru レre ロro ワwa ヲwo ンn',
)

export const HANZI = table(
  '人rén 入rù 大dà 天tiān 太tài 夫fū 小xiǎo 中zhōng 国guó 我wǒ 你nǐ 他tā 好hǎo 是shì 不bù 一yī 二èr 三sān 四sì 五wǔ 六liù 七qī 八bā 九jiǔ 十shí 上shàng 下xià 日rì 曰yuē 目mù 月yuè 水shuǐ 火huǒ 山shān 口kǒu 手shǒu 毛máo 心xīn 木mù 本běn 土tǔ 士shì 女nǚ 子zǐ 马mǎ 车chē 门mén 白bái 百bǎi 王wáng 玉yù 田tián 由yóu 甲jiǎ 力lì 刀dāo 千qiān 干gān 于yú 牛niú 午wǔ 今jīn 令lìng 未wèi 末mò 己jǐ 已yǐ',
)

export const CYRILLIC = table(
  'Аa Бb Вv Гg Дd Еye Ёyo Жzh Зz Иi Йy Кk Лl Мm Нn Оo Пp Рr Сs Тt Уu Фf Хkh Цts Чch Шsh Щshch Ыɨ Эe Юyu Яya',
)

export const DEVANAGARI_VOWELS = table('अa आā इi ईī उu ऊū एe ऐai ओo औau')

export const DEVANAGARI_CONSONANTS = table(
  'कka खkha गga घgha ङṅa चca छcha जja झjha ञña टṭa ठṭha डḍa ढḍha णṇa तta थtha दda धdha नna पpa फpha बba भbha मma यya रra लla वva शśa षṣa सsa हha',
)

export interface Language {
  readonly name: string
  /** The word "snake", shown on the title. */
  readonly word: string
  /** BCP-47 prefix used to match a speech-synthesis voice. */
  readonly tts: string
  /** Native and English names, for the language picker. */
  readonly labels: readonly [native: string, english: string]
  /** Columns to lay the study chart out in. */
  readonly chartColumns: number
  readonly sets: Readonly<Record<string, CharTable>>
}

export const LANGUAGES = {
  ja: {
    name: 'Japanese',
    word: 'へび',
    tts: 'ja',
    labels: ['日本語', 'Japanese'],
    chartColumns: 5,
    sets: { hiragana: HIRAGANA, katakana: KATAKANA },
  },
  zh: {
    name: 'Chinese',
    word: '蛇',
    tts: 'zh',
    labels: ['中文', 'Chinese'],
    chartColumns: 6,
    sets: { 'hanzi (HSK 1)': HANZI },
  },
  ru: {
    name: 'Russian',
    word: 'змея',
    tts: 'ru',
    labels: ['Русский', 'Russian'],
    chartColumns: 6,
    sets: { cyrillic: CYRILLIC },
  },
  hi: {
    name: 'Hindi',
    word: 'साँप',
    tts: 'hi',
    labels: ['हिन्दी', 'Hindi'],
    chartColumns: 5,
    sets: { vowels: DEVANAGARI_VOWELS, consonants: DEVANAGARI_CONSONANTS },
  },
} as const satisfies Record<string, Language>

export type LangId = keyof typeof LANGUAGES

export const LANG_IDS = Object.keys(LANGUAGES) as LangId[]

export const isLangId = (v: unknown): v is LangId =>
  typeof v === 'string' && v in LANGUAGES

/**
 * Visually confusable groups — the distractor pool.
 *
 * This is the heart of the teaching design. Random distractors are trivially
 * ignorable: you can eat the right glyph without ever having read it, just by
 * eliminating four obviously-wrong shapes. Drawing distractors from the
 * characters a learner actually mixes up forces a real discrimination.
 *
 * Characters are unique across all scripts here, so one flat list suffices.
 */
export const CONFUSABLE_GROUPS: readonly string[] = [
  // hiragana
  'さきち', 'はほま', 'ぬめ', 'わねれ', 'るろ', 'いり', 'こに', 'あお', 'つう',
  'しも', 'たな', 'けは', 'ふら', 'くへ', 'そろ', 'ゆや', 'のめあ', 'よま',
  'んえ', 'ひへ',
  // katakana
  'シツ', 'ソン', 'クケタ', 'コユ', 'チテ', 'ナメ', 'ワウフ', 'アマ', 'ヌス',
  'ルレ', 'ミニ', 'ハヘ', 'オホ', 'サセ', 'ヨヲ', 'ラヲ', 'イト', 'エユ', 'リソ',
  // hanzi
  '人入', '大天太夫', '己已', '土士', '日曰目', '未末', '王玉', '千干于',
  '木本', '力刀', '今令', '田由甲', '白百', '手毛', '午牛', '二三', '小水',
  // cyrillic
  'ВБ', 'ИЙ', 'ШЩ', 'ПЛ', 'ЕЁ', 'ЦЧ', 'ОФ', 'ДЛ', 'ЗЭ', 'ХЖ', 'КН', 'ГТ',
  'НП', 'РВ', 'УЧ', 'АЛД', 'ЫИ',
  // devanagari
  'घध', 'भम', 'बव', 'टठ', 'डढ', 'पफ', 'गण', 'तन', 'इई', 'उऊ', 'एऐ', 'ओऔ',
  'यथ', 'शष', 'छद', 'ङड', 'खरव', 'ञज', 'अआ',
]

/**
 * Index built once at module load rather than scanned per spawn. The
 * prototype re-walked all ~90 groups on every single spawn; this is the same
 * answer in one map lookup.
 */
const CONFUSABLE_INDEX = new Map<string, string[]>()
for (const group of CONFUSABLE_GROUPS) {
  for (const ch of group) {
    let list = CONFUSABLE_INDEX.get(ch)
    if (!list) CONFUSABLE_INDEX.set(ch, (list = []))
    for (const other of group) {
      if (other !== ch && !list.includes(other)) list.push(other)
    }
  }
}

/** Characters commonly mistaken for `ch`. Empty if it has no known lookalikes. */
export const confusablesOf = (ch: string): readonly string[] =>
  CONFUSABLE_INDEX.get(ch) ?? []

/** Build the active character table for a language + set selection. */
export function buildTable(lang: LangId, setName: string): CharTable {
  const sets = LANGUAGES[lang].sets as Record<string, CharTable>
  if (setName === 'both') return Object.assign({}, ...Object.values(sets))
  return { ...(sets[setName] ?? Object.values(sets)[0] ?? {}) }
}

/** Set names for a language, plus 'both' when there is more than one. */
export function setNamesFor(lang: LangId): string[] {
  const names = Object.keys(LANGUAGES[lang].sets)
  return names.length > 1 ? [...names, 'both'] : names
}
