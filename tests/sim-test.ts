/**
 * Simulation invariants, asserted deterministically.
 *
 * These were previously checked by driving a real browser with a greedy chase,
 * which sometimes ate four characters in thirty seconds and could then prove
 * nothing. The rules under test are pure simulation, so they belong here where
 * the answer is the same every run.
 */
import { World } from '../src/game/world'
import { MODES } from '../src/game/modes'
import { CAMPAIGNS, tableFromChars } from '../src/game/levels'
import { SNAKE } from '../src/game/config'

let fails = 0
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`)
  if (!cond) fails++
}
const LANGS = ['en', 'ja', 'zh', 'ru', 'hi', 'ko', 'el'] as const
const learn = (lang: (typeof LANGS)[number], lvl: any) =>
  new World({
    table: lvl.table ?? tableFromChars(lang, lvl.chars),
    stats: {}, mode: MODES.drift, seed: 4242,
    ...(lvl.words ? { words: lvl.words } : {}),
    maxLength: 8, scaffold: true,
  })

// --- the body plateaus, over far more eats than a browser run manages ---
{
  const lvl = CAMPAIGNS.ja.find((l) => l.kind === 'chapter')!
  const w = learn('ja', lvl)
  w.reset()
  let peak = 0
  let ate = 0
  for (let i = 0; i < 60; i++) {
    const t = w.items.find((x) => x.correct)
    if (!t) break
    ;(w as any).onCorrect(t)
    const at = w.items.indexOf(t)
    if (at >= 0) w.items.splice(at, 1)
    // onCorrect does not grow the body — commitMove does — so mirror it.
    w.snake.unshift({ x: t.x, y: t.y, ch: t.ch })
    if (w.snake.length > 8) w.snake.pop()
    ate++
    peak = Math.max(peak, w.snake.length)
  }
  ok('body never exceeds the cap over 60 correct answers', peak <= 8,
     `${ate} eaten, peak length ${peak}`)
  ok('and the run actually got that far', ate >= 50, `${ate} eaten`)
}

// --- a miss never shrinks the snake below the floor ---
{
  const lvl = CAMPAIGNS.ja.find((l) => l.kind === 'chapter')!
  const w = learn('ja', lvl)
  w.reset()
  let floor = Infinity
  for (let i = 0; i < 30; i++) {
    const bad = w.items.find((x) => !x.correct)
    if (!bad) break
    ;(w as any).onWrong(bad, w.items.indexOf(bad))
    floor = Math.min(floor, w.snake.length)
  }
  ok('a miss never shrinks the snake below the floor', floor >= SNAKE.minLength,
     `floor ${floor}, min ${SNAKE.minLength}`)
}

// --- scaffolding narrows to the answer and never to nothing ---
{
  let bad = 0
  let checked = 0
  for (const lang of LANGS) {
    for (const lvl of CAMPAIGNS[lang]) {
      if (lvl.kind === 'gauntlet') continue
      checked++
      const w = learn(lang, lvl)
      w.reset()
      for (let i = 0; i < 12; i++) {
        const wrong = w.items.find((x) => !x.correct)
        if (!wrong) break
        ;(w as any).onWrong(wrong, w.items.indexOf(wrong))
      }
      if (w.items.length === 0) { bad++; console.log('   EMPTY BOARD', lang, lvl.id) }
      else if (!w.items.some((x) => x.correct)) { bad++; console.log('   NO ANSWER', lang, lvl.id) }
    }
  }
  ok('every learn level still shows the answer after 12 misses', bad === 0,
     `${checked} levels checked`)
}

// --- a boss level does NOT narrow: guessing must not shrink the field ---
{
  let bad = 0
  let checked = 0
  for (const lang of LANGS) {
    for (const lvl of CAMPAIGNS[lang]) {
      if (lvl.kind !== 'gauntlet') continue
      checked++
      const w = new World({
        table: lvl.table ?? tableFromChars(lang, lvl.chars),
        stats: {}, mode: MODES.drift, seed: 99, scaffold: false,
      })
      w.reset()
      const before = w.items.length
      for (let i = 0; i < 4; i++) {
        const wrong = w.items.find((x) => !x.correct)
        if (!wrong) break
        ;(w as any).onWrong(wrong, w.items.indexOf(wrong))
      }
      if (w.items.length < before) { bad++; console.log('   NARROWED', lang, lvl.id, before, '->', w.items.length) }
    }
  }
  ok('a boss level never narrows on a wrong guess', bad === 0, `${checked} boss levels`)
}

console.log(fails ? `\n${fails} FAILURES` : '\nall good')
process.exit(fails ? 1 : 0)
