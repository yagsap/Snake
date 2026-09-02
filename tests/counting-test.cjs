/**
 * A counting level cues a QUANTITY, not a word.
 *   1. the seal shows dots, and exactly as many as the answer means
 *   2. it says nothing — subitizing is a silent, visual task
 *   3. eating the right numeral advances, and the dot count follows the target
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] })
  const fail = []
  const ok = (n, c, x='') => { console.log(`${c?'PASS':'FAIL'}  ${n}${x?'   '+x:''}`); if(!c) fail.push(n) }
  const p = await b.newPage()
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fail.push('pageerror') })
  await p.evaluateOnNewDocument(() => {
    window.__said = []
    const orig = speechSynthesis.speak.bind(speechSynthesis)
    // Tag every utterance with the level that was running when it happened.
    // A counting level can be CLEARED mid-test and auto-advance to an ordinary
    // level, which then speaks perfectly correctly — an earlier version of
    // this test read that as the counting cue breaking its silence.
    speechSynthesis.speak = (u) => {
      const kind = window.__snake?.run?.level?.kind ?? null
      window.__said.push({ text: u.text, kind })
      return orig(u)
    }
    // Clear everything up to the Japanese counting level so it is next.
    const cleared = {}
    for (const id of ['ja-first-vowels','ja-count-to-five','ja-all-ten-numbers'])
      cleared[id] = { cleared: true }
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'ja', setName: 'hiragana', campaign: cleared,
    }))
  })
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1100)
  const btn = await p.evaluate(() => document.getElementById('continueBtn').textContent)
  ok('the ladder offers the counting level', /how many/i.test(btn), btn)

  await p.evaluate(() => { window.__said.length = 0 })
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(3400)

  const read = () => p.evaluate(() => {
    const w = window.__snake.world
    return {
      kind: window.__snake.run?.level?.kind,
      target: w?.items.find((i) => i.correct)?.ch ?? null,
      dots: document.querySelectorAll('#cueText .dots i').length,
      text: document.getElementById('cueText')?.textContent ?? '',
      said: window.__said.filter((s) => s.kind === 'count'),
    }
  })
  const VALUE = { '一':1,'二':2,'三':3,'四':4,'五':5 }
  const a = await read()
  ok('running a counting level', a.kind === 'count', `kind=${a.kind}`)
  ok('the seal shows dots, not text', a.dots > 0 && a.text.trim() === '',
     `${a.dots} dots, text="${a.text.trim()}"`)
  ok('the dot count matches what the numeral means',
     a.target !== null && a.dots === VALUE[a.target],
     `target ${a.target} means ${VALUE[a.target]}, showed ${a.dots} dots`)
  ok('the cue is silent', a.said.length === 0, JSON.stringify(a.said.slice(0,4)))

  // Eat the right one; the next cue must track the new target.
  await p.evaluate(() => {
    window.__drv = setInterval(() => {
      const w = window.__snake.world
      if (!w || !w.alive) return
      const h = w.snake[0], t = w.items.find(i => i.correct)
      if (!h || !t) return
      const d = (x,y) => { let v=y-x; if(v>8)v-=16; if(v<-8)v+=16; return v }
      const dx = d(h.x,t.x), dy = d(h.y,t.y)
      if (Math.abs(dx) >= Math.abs(dy)) w.turn(dx>0?'right':'left')
      else w.turn(dy>0?'down':'up')
    }, 60)
  })
  await sleep(9000)
  await p.evaluate(() => clearInterval(window.__drv))
  await sleep(300)
  const c = await read()
  const eaten = await p.evaluate(() => window.__snake.world?.eaten ?? 0)
  ok('answers register on a counting level', eaten >= 2, `${eaten} eaten`)
  ok('the dots keep tracking the target',
     c.target !== null && c.dots === VALUE[c.target],
     `target ${c.target} means ${VALUE[c.target]}, showed ${c.dots} dots`)
  ok('still silent while the counting level is running',
     c.said.filter((s) => s.text && s.text.trim()).length === 0,
     JSON.stringify(c.said.slice(0, 6)))

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close(); process.exit(fail.length ? 1 : 0)
})()
