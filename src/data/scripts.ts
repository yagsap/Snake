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

/**
 * Base syllabary first, then the voiced (dakuten) and half-voiced (handakuten)
 * rows — the chart renders in source order, so the learner sees the layers.
 * All voiced kana are precomposed NFC forms: single UTF-16 code units, so the
 * `x[0]` split above stays safe. ぢ/づ (and ヂ/ヅ) share romanisations with
 * じ/ず on purpose; the spawn and word systems never place same-sound
 * characters together, so the cue is never ambiguous.
 */
export const HIRAGANA = table(
  'あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo',
)

export const KATAKANA = table(
  'アa イi ウu エe オo カka キki クku ケke コko サsa シshi スsu セse ソso タta チchi ツtsu テte トto ナna ニni ヌnu ネne ノno ハha ヒhi フfu ヘhe ホho マma ミmi ムmu メme モmo ヤya ユyu ヨyo ラra リri ルru レre ロro ワwa ヲwo ンn ガga ギgi グgu ゲge ゴgo ザza ジji ズzu ゼze ゾzo ダda ヂji ヅzu デde ドdo バba ビbi ブbu ベbe ボbo パpa ピpi プpu ペpe ポpo',
)

export const HANZI = table(
  '人rén 入rù 大dà 天tiān 太tài 夫fū 小xiǎo 中zhōng 国guó 我wǒ 你nǐ 他tā 好hǎo 是shì 不bù 一yī 二èr 三sān 四sì 五wǔ 六liù 七qī 八bā 九jiǔ 十shí 上shàng 下xià 日rì 曰yuē 目mù 月yuè 水shuǐ 火huǒ 山shān 口kǒu 手shǒu 毛máo 心xīn 木mù 本běn 土tǔ 士shì 女nǚ 子zǐ 马mǎ 车chē 门mén 白bái 百bǎi 王wáng 玉yù 田tián 由yóu 甲jiǎ 力lì 刀dāo 千qiān 干gān 于yú 牛niú 午wǔ 今jīn 令lìng 未wèi 末mò 己jǐ 已yǐ',
)

export const CYRILLIC = table(
  'Аa Бb Вv Гg Дd Еye Ёyo Жzh Зz Иi Йy Кk Лl Мm Нn Оo Пp Рr Сs Тt Уu Фf Хkh Цts Чch Шsh Щshch Ыɨ Эe Юyu Яya',
)

/** English letters, cued by their names — the game teaches the alphabet. */
/**
 * Phonics: the sound each letter MAKES, taught through a keyword.
 *
 * Letter names and letter sounds are different skills, and for a child
 * learning to read the sound is the one that matters — "bee" does not help
 * you decode "bat". So the cue for these levels speaks a whole word and the
 * child eats the letter it starts with, which is how phonics is actually
 * taught: a real word is something a speech engine pronounces correctly,
 * where an isolated sound comes out as "buh" and teaches a schwa that is not
 * there.
 *
 * Every keyword uses the letter's SHORT/hard sound, which is the one taught
 * first — cat, not city; goat, not giant. X is the exception every phonics
 * scheme makes: it is cued by the sound at the END of "box", because English
 * has no common word starting with it.
 *
 * Deliberately NOT registered as a set in LANGUAGES. `tableFromChars` merges
 * every set of a language with last-one-wins, so a phonics set keyed by the
 * same letters would quietly rewrite A from "ay" to "apple" for every English
 * level in the game. Phonics levels carry this table explicitly instead.
 */
export const PHONICS_EN = table(
  'Aapple Bball Ccat Ddog Eegg Ffish Ggoat Hhat Iinsect Jjam Kkite Lleaf Mmoon Nnest Ooctopus Ppig Qqueen Rrain Ssun Ttree Uumbrella Vvan Wweb Xbox Yyellow Zzip',
)

export const LATIN_UPPER = table(
  'Aay Bbee Csee Ddee Eee Fef Gjee Haitch Ieye Jjay Kkay Lel Mem Nen Ooh Ppee Qcue Rar Ses Ttee Uyou Vvee Wdouble-u Xex Ywhy Zzee',
)

export const LATIN_LOWER = table(
  'aay bbee csee ddee eee fef gjee haitch ieye jjay kkay lel mem nen ooh ppee qcue rar ses ttee uyou vvee wdouble-u xex ywhy zzee',
)

/**
 * Hangul letters (compatibility jamo). Consonants carry their LETTER NAMES,
 * not their bare sounds, because that is what a Korean voice actually says
 * when handed the character — the cue and the caption have to agree. Vowels
 * are named by their sound already.
 */
export const HANGUL_JAMO = table(
  'ㄱgiyeok ㄴnieun ㄷdigeut ㄹrieul ㅁmieum ㅂbieup ㅅsiot ㅇieung ㅈjieut ㅊchieut ㅋkieuk ㅌtieut ㅍpieup ㅎhieut ㄲssang-giyeok ㄸssang-digeut ㅃssang-bieup ㅆssang-siot ㅉssang-jieut ㅏa ㅑya ㅓeo ㅕyeo ㅗo ㅛyo ㅜu ㅠyu ㅡeu ㅣi ㅐae ㅔe',
)

/** Basic CV syllables: the fourteen base consonants crossed with a/o/u/i. */
export const HANGUL_SYLLABLES = table(
  '가ga 나na 다da 라ra 마ma 바ba 사sa 아a 자ja 차cha 카ka 타ta 파pa 하ha 고go 노no 도do 로ro 모mo 보bo 소so 오o 조jo 초cho 코ko 토to 포po 호ho 구gu 누nu 두du 루ru 무mu 부bu 수su 우u 주ju 추chu 쿠ku 투tu 푸pu 후hu 기gi 니ni 디di 리ri 미mi 비bi 시si 이i 지ji 치chi 키ki 티ti 피pi 히hi',
)

/** Greek letters, cued by their names. All glyphs are Greek-block code points. */
export const GREEK_UPPER = table(
  'Αalpha Βbeta Γgamma Δdelta Εepsilon Ζzeta Ηeta Θtheta Ιiota Κkappa Λlambda Μmu Νnu Ξxi Οomicron Πpi Ρrho Σsigma Τtau Υupsilon Φphi Χchi Ψpsi Ωomega',
)

export const GREEK_LOWER = table(
  'αalpha βbeta γgamma δdelta εepsilon ζzeta ηeta θtheta ιiota κkappa λlambda μmu νnu ξxi οomicron πpi ρrho σsigma τtau υupsilon φphi χchi ψpsi ωomega',
)

/**
 * Numbers.
 *
 * The cue speaks the GLYPH, not the romanisation, so a numeral is pronounced
 * by the system voice in the language being learned — which makes one set per
 * script correct for free. Where a script has its own numerals the script's
 * own are used, because those are the shapes a reader has to know: kanji for
 * Japanese and Chinese, Devanagari for Hindi, Sino-Korean syllables for
 * Korean. English, Russian and Greek share the Arabic digits, and there the
 * work is the spoken number rather than the shape — still worth a set, since
 * for a child "how do you say 7" is exactly the lesson.
 *
 * Ten or eleven entries each: enough to fill a board without repeats, short
 * enough to finish in one sitting.
 */
export const DIGITS_EN = table(
  '0zero 1one 2two 3three 4four 5five 6six 7seven 8eight 9nine',
)

export const NUMBERS_JA = table(
  '〇zero 一ichi 二ni 三san 四yon 五go 六roku 七nana 八hachi 九kyū 十jū',
)

export const NUMBERS_ZH = table(
  '〇líng 一yī 二èr 三sān 四sì 五wǔ 六liù 七qī 八bā 九jiǔ 十shí',
)

export const DIGITS_RU = table(
  '0nol 1odin 2dva 3tri 4chetyre 5pyat 6shest 7sem 8vosem 9devyat',
)

export const NUMBERS_HI = table(
  '०shunya १ek २do ३tin ४chār ५pānch ६chhah ७sāt ८āth ९nau',
)

export const NUMBERS_KO = table(
  '영yeong 일il 이i 삼sam 사sa 오o 육yuk 칠chil 팔pal 구gu 십sip',
)

export const DIGITS_EL = table(
  '0midén 1éna 2dýo 3tría 4téssera 5pénte 6éxi 7eptá 8októ 9ennéa',
)

export const DEVANAGARI_VOWELS = table('अa आā इi ईī उu ऊū एe ऐai ओo औau')

export const DEVANAGARI_CONSONANTS = table(
  'कka खkha गga घgha ङṅa चca छcha जja झjha ञña टṭa ठṭha डḍa ढḍha णṇa तta थtha दda धdha नna पpa फpha बba भbha मma यya रra लla वva शśa षṣa सsa हha',
)

export interface Language {
  readonly name: string
  /**
   * A short word in this script, shown beside the title — "snake" wherever
   * that reads well, the alphabet's own name where it would not.
   */
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
  en: {
    name: 'English',
    word: 'ABC',
    tts: 'en',
    labels: ['English', 'A–Z'],
    chartColumns: 6,
    sets: { capitals: LATIN_UPPER, small: LATIN_LOWER, numbers: DIGITS_EN },
  },
  ja: {
    name: 'Japanese',
    word: 'へび',
    tts: 'ja',
    labels: ['日本語', 'Japanese'],
    chartColumns: 5,
    sets: { hiragana: HIRAGANA, katakana: KATAKANA, numbers: NUMBERS_JA },
  },
  zh: {
    name: 'Chinese',
    word: '蛇',
    tts: 'zh',
    labels: ['中文', 'Chinese'],
    chartColumns: 6,
    sets: { 'hanzi (HSK 1)': HANZI, numbers: NUMBERS_ZH },
  },
  ru: {
    name: 'Russian',
    word: 'змея',
    tts: 'ru',
    labels: ['Русский', 'Russian'],
    chartColumns: 6,
    sets: { cyrillic: CYRILLIC, numbers: DIGITS_RU },
  },
  hi: {
    name: 'Hindi',
    word: 'साँप',
    tts: 'hi',
    labels: ['हिन्दी', 'Hindi'],
    chartColumns: 5,
    sets: { vowels: DEVANAGARI_VOWELS, consonants: DEVANAGARI_CONSONANTS, numbers: NUMBERS_HI },
  },
  ko: {
    name: 'Korean',
    word: '뱀',
    tts: 'ko',
    labels: ['한국어', 'Korean'],
    chartColumns: 6,
    sets: { letters: HANGUL_JAMO, syllables: HANGUL_SYLLABLES, numbers: NUMBERS_KO },
  },
  el: {
    name: 'Greek',
    word: 'φίδι',
    tts: 'el',
    labels: ['Ελληνικά', 'Greek'],
    chartColumns: 6,
    sets: { capitals: GREEK_UPPER, small: GREEK_LOWER, numbers: DIGITS_EL },
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
  // hiragana dakuten families — the discrimination is the dots, not the base
  'かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ',
  'ただ', 'ちぢ', 'つづ', 'てで', 'とど', 'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ',
  // katakana
  'シツ', 'ソン', 'クケタ', 'コユ', 'チテ', 'ナメ', 'ワウフ', 'アマ', 'ヌス',
  'ルレ', 'ミニ', 'ハヘ', 'オホ', 'サセ', 'ヨヲ', 'ラヲ', 'イト', 'エユ', 'リソ',
  // katakana dakuten families
  'カガ', 'キギ', 'クグ', 'ケゲ', 'コゴ', 'サザ', 'シジ', 'スズ', 'セゼ', 'ソゾ',
  'タダ', 'チヂ', 'ツヅ', 'テデ', 'トド', 'ハバパ', 'ヒビピ', 'フブプ', 'ヘベペ', 'ホボポ',
  // hanzi
  '人入', '大天太夫', '己已', '土士', '日曰目', '未末', '王玉', '千干于',
  '木本', '力刀', '今令', '田由甲', '白百', '手毛', '午牛', '二三', '小水',
  // cyrillic
  'ВБ', 'ИЙ', 'ШЩ', 'ПЛ', 'ЕЁ', 'ЦЧ', 'ОФ', 'ДЛ', 'ЗЭ', 'ХЖ', 'КН', 'ГТ',
  'НП', 'РВ', 'УЧ', 'АЛД', 'ЫИ',
  // devanagari
  'घध', 'भम', 'बव', 'टठ', 'डढ', 'पफ', 'गण', 'तन', 'इई', 'उऊ', 'एऐ', 'ओऔ',
  'यथ', 'शष', 'छद', 'ङड', 'खरव', 'ञज', 'अआ',
  // latin capitals — shape first, then the rhyming names, which are what
  // actually defeats a learner listening rather than looking
  'OQ', 'PR', 'EF', 'MN', 'VW', 'IJ', 'CG', 'BD', 'UV', 'KX', 'SZ', 'ILT',
  'BCDEGPTVZ', 'FS', 'IY', 'JK', 'QU', 'AH',
  // latin small — bdpq are the same shape rotated, the classic reversal set
  'bdpq', 'nu', 'mw', 'il', 'ao', 'ce', 'gq', 'vy', 'fj', 'hn', 'kx', 'sz',
  'bcdegptvz', 'mn', 'iy', 'rn',
  // hangul jamo — a stroke or a doubling apart
  'ㄱㅋㄲ', 'ㄷㅌㄸ', 'ㅂㅍㅃ', 'ㅅㅆㅈㅊㅉ', 'ㅇㅎ', 'ㄴㄷ', 'ㄹㄴ', 'ㅁㅂ',
  'ㅏㅑ', 'ㅓㅕ', 'ㅗㅛ', 'ㅜㅠ', 'ㅡㅣ', 'ㅐㅔ', 'ㅏㅓ', 'ㅗㅜ', 'ㅣㅏ',
  // hangul syllables — same vowel, neighbouring consonant
  '가카', '다타', '바파', '사자차', '아하', '고코', '도토', '보포', '구쿠',
  '두투', '부푸', '기키', '디티', '비피', '가나', '나다', '마바', '오호',
  // greek capitals
  'ΟΘΦΩ', 'ΕΞΣ', 'ΝΜ', 'ΧΨ', 'ΠΓΤ', 'ΒΡ', 'ΔΛΑ', 'ΙΤ', 'ΥΨ', 'ΖΞ', 'ΗΙΥ',
  'ΚΧ', 'ΟΩ',
  // greek small
  'νυ', 'ρπ', 'ζξ', 'θφ', 'εσ', 'μυ', 'κχ', 'δα', 'βθ', 'σο', 'τγ', 'λχ',
  'ηπ', 'ηιυ', 'οω', 'ψφ', 'ωμ',
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
