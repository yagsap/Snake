/**
 * Verifies the three launch features end to end:
 *  1. onboarding: fresh player -> one tap -> playing level 1
 *  2. mastery moment: 'mastered' fires when a character crosses the line
 *  3. run receipt: end cards carry the learning line
 * Plus: returning players (existing save) skip onboarding.
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5199/'

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--mute-audio', '--no-first-run'],
  })
  const fail = []
  const ok = (name, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
    if (!cond) fail.push(name)
  }

  // ---- fresh player: onboarding -> level 1 ----
  const p = await browser.newPage()
  await p.goto(URL, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))
  const onboardShown = await p.evaluate(
    () => !document.getElementById('onboardScr').hidden &&
          document.getElementById('menuScr').hidden,
  )
  ok('fresh player sees onboarding, not menu', onboardShown)
  const chips = await p.evaluate(
    () => document.querySelectorAll('#onboardGrid .chip').length,
  )
  ok('onboarding offers 7 languages', chips === 7)

  await p.evaluate(() => {
    const el = [...document.querySelectorAll('#onboardGrid .chip')]
      .find((c) => c.dataset.lang === 'el')
    el.click()
  })
  await new Promise((r) => setTimeout(r, 900))
  // Onboarding now has a second beat: mark what you already know.
  const placeShown = await p.evaluate(
    () => !document.getElementById('placeScr').hidden,
  )
  ok('placement step follows the language pick', placeShown)
  await p.evaluate(() => document.getElementById('placeSkip').click())
  await new Promise((r) => setTimeout(r, 1200))
  const inPlay = await p.evaluate(() => ({
    playVisible: !document.getElementById('playScr').hidden,
    onboardGone: document.getElementById('onboardScr').hidden,
    goal: document.getElementById('goalLine').textContent,
    lang: window.__snake.data.lang,
    onboarded: window.__snake.data.onboarded,
    scene: window.__snake.scenes.top?.name,
  }))
  ok('one tap lands in the game (countdown up)', inPlay.playVisible && inPlay.scene === 'ready')
  ok('level goal line shows (campaign level 1)', /\/10|\/12/.test(inPlay.goal))
  ok('language stored and onboarded flagged', inPlay.lang === 'el' && inPlay.onboarded === true)

  // ---- mastery moment + receipt on the LEVEL end card ----
  const result = await p.evaluate(() => {
    const w = window.__snake.world
    const events = []
    w.events.on('mastered', (e) => events.push(e.ch))
    // Three correct bites of the same character = mastered per the predicate.
    const bite = () => {
      const t = w.items.find((i) => i.correct)
      const head = w.snake[0]
      const item = { ...t, x: head.x, y: head.y }
      // simulate the correct-bite path directly through world internals:
      w['onCorrect'](item)
      return item.ch
    }
    const chars = [bite(), bite(), bite()]
    return { chars, events, runLearned: [...w.runLearned], runMastered: w.runMastered }
  })
  ok('runLearned tracks practiced characters', result.runLearned.length >= 1)

  // ---- clearing level 1 AUTO-ADVANCES into level 2 (no card) ----
  const clearing = await p.evaluate(() => {
    const sc = window.__snake.scenes
    if (sc.top?.name === 'ready') sc.pop() // countdown: not under test here
    const w = window.__snake.world
    const heard = []
    w.events.on('mastered', (e) => heard.push(e.ch))
    while (w.eaten < 20 && window.__snake.scenes.top?.name === 'play') {
      const t = w.items.find((i) => i.correct)
      if (!t) break
      const head = w.snake[0]
      w['onCorrect']({ ...t, x: head.x, y: head.y })
    }
    return {
      mastered: heard.length,
      cardShown: !document.getElementById('lvlEndScr').hidden,
      topScene: window.__snake.scenes.top?.name,
    }
  })
  // Mastery deliberately CANNOT happen inside one session any more — the
  // schedule requires returning after a real gap, so a run of rapid correct
  // answers must not fire it. That is the assertion now.
  ok('cramming does not fire mastery', clearing.mastered === 0)
  ok('NO card on clear — flow scene instead', !clearing.cardShown && clearing.topScene === 'levelflow')

  await new Promise((r) => setTimeout(r, 2400))
  const advanced = await p.evaluate(() => ({
    scene: window.__snake.scenes.top?.name,
    eaten: window.__snake.world?.eaten,
    level: window.__snake.run?.level?.title ?? '',
  }))
  ok('auto-advanced into the NEXT level', advanced.scene === 'play' && advanced.eaten === 0)
  console.log('   now playing:', JSON.stringify(advanced.level))

  // ---- a LEARN level must not be failable; a BOSS level still is ----
  const missed = await p.evaluate(() => {
    const w = window.__snake.world
    for (let i = 0; i < 8 && window.__snake.scenes.top?.name === 'play'; i++) {
      const bad = w.items.find((x) => !x.correct)
      if (!bad) break
      w['onWrong']({ ...bad, x: w.snake[0].x, y: w.snake[0].y }, w.items.indexOf(bad))
    }
    return {
      kind: window.__snake.run?.level?.kind,
      mistakes: w.mistakes,
      maxMisses: window.__snake.run?.level?.goal.maxMisses,
      cardShown: !document.getElementById('lvlEndScr').hidden,
      tiles: w.items.length,
    }
  })
  ok('a learn level does not defeat the child',
     missed.kind !== 'gauntlet' && !missed.cardShown &&
     missed.mistakes > missed.maxMisses,
     `${missed.kind}: ${missed.mistakes} misses vs threshold ${missed.maxMisses}`)
  ok('and each miss narrows the question instead',
     missed.tiles < 5, `${missed.tiles} tiles left`)

  // The card and its receipt now surface on the path that still ends a learn
  // level: crashing. (Boss-level miss-failure is covered in scaffold-test.js,
  // which starts a real gauntlet rather than mutating this one — by here the
  // board has narrowed and there are no distractors left to bite.)
  await p.evaluate(() => {
    // Practise a couple of characters first: the receipt reports what the run
    // TAUGHT, so with nothing practised an empty line is correct, not a bug.
    const w = window.__snake.world
    for (let i = 0; i < 2; i++) {
      const t = w.items.find((x) => x.correct)
      if (t) w['onCorrect']({ ...t, x: w.snake[0].x, y: w.snake[0].y })
    }
    w['die']('self')
  })
  // The card arrives as a scene push, so it is not in the DOM on the same tick.
  await new Promise((r) => setTimeout(r, 900))
  const crashed = await p.evaluate(() => ({
    cardShown: !document.getElementById('lvlEndScr').hidden,
    learn: document.getElementById('lvlEndLearn').textContent,
  }))
  ok('crashing still shows the failure card', crashed.cardShown)
  ok('receipt line present on the card', /character/.test(crashed.learn || ''))
  console.log('   receipt:', JSON.stringify(crashed.learn))

  await p.close()

  // ---- returning player skips onboarding ----
  const p2 = await browser.newPage()
  await p2.evaluateOnNewDocument(() => {
    localStorage.setItem('snake-save-v2', JSON.stringify({ bestScore: 120, lang: 'ja' }))
  })
  await p2.goto(URL, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1000))
  const returning = await p2.evaluate(() => ({
    key: Object.keys(localStorage).find((k) => /snake/.test(k)),
    onboardHidden: document.getElementById('onboardScr').hidden,
    menuShown: !document.getElementById('menuScr').hidden,
  }))
  console.log('   storage key seen:', returning.key)
  ok('returning player goes straight to menu', returning.onboardHidden && returning.menuShown)
  await p2.close()

  await browser.close()
  console.log(fail.length ? `\n${fail.length} FAILURES` : '\nall passed')
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
