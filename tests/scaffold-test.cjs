/**
 * A learn level must never defeat a child.
 *   1. Misses do not end a chapter level; a boss level still ends.
 *   2. Each miss narrows the board — five choices become the answer alone.
 *   3. The body plateaus, so steering load stops growing with success.
 *   4. Stones only appear in boss levels.
 *   5. Misses still cost the star, and are still recorded honestly.
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DRIVE = `(pick) => {
  const w = window.__snake.world
  if (!w || !w.alive) return
  const h = w.snake[0]
  const t = pick === 'right' ? w.items.find(i => i.correct)
                             : w.items.find(i => !i.correct)
  if (!h || !t) return
  const d = (a,b) => { let v=b-a; if(v>8)v-=16; if(v<-8)v+=16; return v }
  const dx = d(h.x,t.x), dy = d(h.y,t.y)
  if (Math.abs(dx) >= Math.abs(dy)) w.turn(dx>0?'right':'left')
  else w.turn(dy>0?'down':'up')
}`

async function play(p, pick, ms) {
  // Sample while driving. Reading counters only at the END is unreliable: a
  // learn level auto-advances when its goal is met, which resets `eaten` on a
  // fresh world and made a previous version of this test read "1 eaten" after
  // happily clearing a level.
  await p.evaluate((body, k) => {
    const fn = eval(body)
    window.__peak = { len: 0, eaten: 0, levels: 0, lastTitle: null }
    window.__drv = setInterval(() => {
      fn(k)
      const w = window.__snake.world
      const t = window.__snake.run?.level?.title ?? null
      if (!w) return
      if (t !== window.__peak.lastTitle) {
        window.__peak.lastTitle = t
        window.__peak.levels++
      }
      window.__peak.len = Math.max(window.__peak.len, w.snake.length)
      window.__peak.eaten = Math.max(window.__peak.eaten, w.eaten)
    }, 60)
  }, DRIVE, pick)
  await sleep(ms)
  await p.evaluate(() => clearInterval(window.__drv))
  await sleep(120)
  return p.evaluate(() => window.__peak)
}

;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] })
  const fail = []
  const ok = (n, c, x='') => { console.log(`${c?'PASS':'FAIL'}  ${n}${x?'   '+x:''}`); if(!c) fail.push(n) }
  const p = await b.newPage()
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fail.push('pageerror') })

  const boot = async (campaign) => {
    await p.evaluateOnNewDocument((c) => localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'en', setName: 'capitals', campaign: c,
    })), campaign)
    await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
    await sleep(1000)
    await p.evaluate(() => document.getElementById('continueBtn').click())
    await sleep(3200)
  }

  // --- a chapter level, missing on purpose over and over ---
  await boot({})
  const lvl = await p.evaluate(() => ({
    kind: window.__snake.run?.level?.kind, title: window.__snake.run?.level?.title,
    maxMisses: window.__snake.run?.level?.goal.maxMisses,
    obstacles: window.__snake.world?.obstacles?.size ?? 0,
    items: window.__snake.world?.items.length,
  }))
  // Any non-boss kind counts: English now opens on a phonics level, and the
  // rule under test is about learn levels generally, not chapters specifically.
  ok('on a learn level', lvl.kind !== 'gauntlet',
     `"${lvl.title}" kind=${lvl.kind} maxMisses=${lvl.maxMisses}`)
  ok('no stones in a learn level', lvl.obstacles === 0, `${lvl.obstacles} stones`)

  const missPeak = await play(p, 'wrong', 16000)
  const after = await p.evaluate(() => ({
    mistakes: window.__snake.world?.mistakes,
    alive: window.__snake.world?.alive,
    ended: !!document.querySelector('#lvlEndScr:not([hidden])'),
    items: window.__snake.world?.items.length,
  }))
  ok('misses exceed the old fail threshold', after.mistakes > lvl.maxMisses,
     `${after.mistakes} misses vs threshold ${lvl.maxMisses}`)
  ok('the learn level did NOT end', !after.ended && after.alive,
     `ended=${after.ended} alive=${after.alive}`)
  ok('the board narrowed toward the answer', after.items < lvl.items,
     `${lvl.items} tiles -> ${after.items}`)
  ok('narrowing bottoms out at the answer, never empty', after.items >= 1,
     `${after.items} tiles left`)

  // --- keep answering correctly: the body must plateau ---
  // The body cap is asserted deterministically in sim-test.ts instead. It
  // used to be checked here by driving a greedy chase for 34 seconds, which
  // sometimes ate four characters and could then prove nothing — a test that
  // passes or fails on how well a crude AI happens to steer is not a test.

  // --- a boss level still ends on misses ---
  await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('script-snake-v2'))
    raw.campaign = {}
    localStorage.setItem('script-snake-v2', JSON.stringify(raw))
  })
  const upto = {}
  for (const id of [
    'en-sounds-a-to-e','en-count-to-five','en-all-ten-numbers','en-how-many',
    'en-sounds-f-to-j','en-blend-first-words','en-sounds-k-to-o',
    'en-blend-more-words',
  ]) upto[id] = { cleared: true }
  await boot(upto)
  const boss = await p.evaluate(() => ({
    kind: window.__snake.run?.level?.kind, title: window.__snake.run?.level?.title,
    obstacles: window.__snake.world?.obstacles?.size ?? 0,
  }))
  ok('on a boss level', boss.kind === 'gauntlet', `"${boss.title}"`)
  await play(p, 'wrong', 12000)
  const bossEnd = await p.evaluate(() => ({
    ended: !!document.querySelector('#lvlEndScr:not([hidden])'),
    mistakes: window.__snake.world?.mistakes,
  }))
  ok('a boss level DOES still end on misses', bossEnd.ended, `misses=${bossEnd.mistakes}`)

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close(); process.exit(fail.length ? 1 : 0)
})()
