/**
 * Phonics cues a WORD, not a letter name.
 *   1. the phonics level is reachable on the ladder
 *   2. the cue spoken is the keyword ("apple"), never the letter ("A")
 *   3. the correct tile is the letter that keyword starts with
 *   4. ordinary letter levels are UNAFFECTED — still "ay", not "apple"
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] })
  const fail = []
  const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); if (!c) fail.push(n) }
  const p = await b.newPage()
  p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); fail.push('pageerror') })

  await p.evaluateOnNewDocument(() => {
    window.__spoken = []
    const orig = speechSynthesis.speak.bind(speechSynthesis)
    speechSynthesis.speak = (u) => { window.__spoken.push(u.text); return orig(u) }
    // A to E cleared, so the ladder's next rung is the phonics level.
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'en', setName: 'capitals',
      campaign: {},
    }))
  })
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1100)

  const btn = await p.evaluate(() => document.getElementById('continueBtn').textContent)
  // Sounds now LEAD the English ladder rather than following letter names.
  ok('English opens on the phonics level', /Level 1 · sounds: A to E/.test(btn), btn)

  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(3000)

  const run = await p.evaluate(() => ({
    kind: window.__snake.run?.level?.kind,
    table: window.__snake.run?.table,
    cue: document.getElementById('cueText')?.textContent ?? null,
    spoken: window.__spoken.slice(),
    target: window.__snake.world?.items?.find((i) => i.correct)?.ch ?? null,
  }))
  ok('running a phonics level', run.kind === 'phonics', `kind=${run.kind}`)
  ok('its table maps letters to keywords', run.table?.A === 'apple',
     `A=${run.table?.A} B=${run.table?.B}`)

  const KEYWORDS = ['apple', 'ball', 'cat', 'dog', 'egg']
  const said = run.spoken.filter((t) => t && t.trim())
  const saidWords = said.filter((t) => KEYWORDS.includes(t))
  const saidLetters = said.filter((t) => /^[A-E]$/.test(t))
  ok('the cue speaks a keyword', saidWords.length > 0, `spoken: ${JSON.stringify(said.slice(-4))}`)
  ok('the cue NEVER speaks the bare letter', saidLetters.length === 0,
     saidLetters.length ? `leaked: ${saidLetters.join(',')}` : 'no letter names spoken')
  ok('the correct tile is the keyword\'s first letter',
     run.target !== null && run.cue !== null
       ? String(run.cue).toUpperCase().startsWith(run.target) : false,
     `cue="${run.cue}" target=${run.target}`)

  // Letter NAMES still exist and must be untouched by the phonics table —
  // they simply moved late in the ladder, after the sounds are secure.
  const BEFORE_NAMES = [
    'en-sounds-a-to-e','en-count-to-five','en-all-ten-numbers','en-how-many',
    'en-sounds-f-to-j','en-blend-first-words','en-sounds-k-to-o',
    'en-blend-more-words','en-the-bee-family','en-sounds-p-to-t',
    'en-blend-pots-and-pins','en-sounds-u-to-z','en-blend-all-the-way-to-z',
    'en-mirror-shapes','en-animals','en-fruit-and-veg','en-colours',
  ]
  await p.evaluateOnNewDocument((ids) => {
    window.__spoken = []
    const orig = speechSynthesis.speak.bind(speechSynthesis)
    speechSynthesis.speak = (u) => { window.__spoken.push(u.text); return orig(u) }
    const campaign = {}
    for (const id of ids) campaign[id] = { cleared: true }
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'en', setName: 'capitals', campaign,
    }))
  }, BEFORE_NAMES)
  await p.goto('http://localhost:5199/?names=1', { waitUntil: 'networkidle2' })
  await sleep(900)
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(3400)
  const plain = await p.evaluate(() => ({
    kind: window.__snake.run?.level?.kind,
    title: window.__snake.run?.level?.title,
    A: window.__snake.run?.table?.A,
    spoken: window.__spoken.filter((t) => t && t.trim()),
  }))
  ok('a letter-name level still teaches letter names',
     plain.kind === 'chapter' && plain.A === 'ay',
     `"${plain.title}" kind=${plain.kind} A=${plain.A}`)
  ok('and it speaks letters, not keywords',
     plain.spoken.length > 0 && plain.spoken.every((t) => /^[A-Z]$/.test(t)),
     `spoken: ${JSON.stringify(plain.spoken.slice(-4))}`)

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close()
  process.exit(fail.length ? 1 : 0)
})()
