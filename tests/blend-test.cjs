/**
 * Blending: the child hears a WORD and eats its letters in order.
 *   1. English now opens with sounds, not letter names
 *   2. a blend level cues the whole word, not the current letter
 *   3. its table is the phonics one, so a correction reads "c cat"
 *   4. eating in order advances through the word
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
    speechSynthesis.speak = (u) => { window.__said.push(u.text); return orig(u) }
    const cleared = {}
    for (const id of ['en-sounds-a-to-e','en-count-to-five','en-all-ten-numbers',
                      'en-how-many','en-sounds-f-to-j'])
      cleared[id] = { cleared: true }
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'en', setName: 'capitals', campaign: cleared,
    }))
  })
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1100)

  const first = await p.evaluate(() => {
    const C = window.__snake
    return { first: C.data ? null : null }
  })
  const ladder = await p.evaluate(() => {
    document.getElementById('campBtn').click()
    const rows = [...document.querySelectorAll('#campList .lvl')].slice(0, 2)
    return rows.map((r) => r.querySelector('b')?.textContent)
  })
  ok('English opens with SOUNDS, not letter names',
     /sounds/i.test(ladder[0] || ''), JSON.stringify(ladder))
  await p.evaluate(() => document.getElementById('campClose').click())
  await sleep(400)

  const btn = await p.evaluate(() => document.getElementById('continueBtn').textContent)
  ok('the ladder offers the blending level', /blend/i.test(btn), btn)

  await p.evaluate(() => { window.__said.length = 0 })
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(3400)

  const st = await p.evaluate(() => {
    const w = window.__snake.world
    return {
      kind: window.__snake.run?.level?.kind,
      word: w?.word?.w ?? null,
      target: w?.items.find((i) => i.correct)?.ch ?? null,
      cue: document.getElementById('cueText')?.textContent ?? '',
      said: window.__said.filter((t) => t && t.trim()),
      tableA: window.__snake.run?.table?.A ?? null,
      onBoard: w?.items.map((i) => i.ch).join('') ?? '',
    }
  })
  ok('running a blend level', st.kind === 'blend', `kind=${st.kind}`)
  ok('the cue is the whole word', st.word && st.cue === st.word,
     `word="${st.word}" cue="${st.cue}"`)
  ok('and the whole word is spoken, not the letter',
     st.said.includes(st.word || ''), JSON.stringify(st.said))
  ok('the first target is the word\'s first letter',
     st.word && st.target === st.word[0], `word=${st.word} target=${st.target}`)
  ok('the table is the phonics one', st.tableA === 'apple', `A=${st.tableA}`)

  // Eat the word in order.
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
  await sleep(14000)
  await p.evaluate(() => clearInterval(window.__drv))
  const done = await p.evaluate(() => ({
    wordsDone: window.__snake.world?.wordsDone ?? 0,
    idx: window.__snake.world?.wordIndex ?? 0,
  }))
  ok('words get completed by eating letters in order', done.wordsDone >= 1,
     `${done.wordsDone} words done`)

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close(); process.exit(fail.length ? 1 : 0)
})()
