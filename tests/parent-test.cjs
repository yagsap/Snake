/**
 * The parent corner.
 *   1. it is NOT reachable by tapping — the door needs a deliberate hold
 *   2. reset is no longer one tap from a child
 *   3. the weekly view reports honest numbers from recorded history
 *   4. settings moved behind the gate and still work
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
  p.on('dialog', async (d) => { await d.dismiss() })

  const today = new Date()
  const key = (back) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    const p2 = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`
  }
  const history = {}
  history[key(0)] = { chars: ['あ','い','う'], correct: 9, wrong: 2 }
  history[key(2)] = { chars: ['あ','か','き'], correct: 6, wrong: 3 }
  history[key(5)] = { chars: ['さ','し'], correct: 4, wrong: 4 }
  history['2019-01-01'] = { chars: ['x'], correct: 99, wrong: 99 } // must be pruned/ignored

  await p.evaluateOnNewDocument((h) => {
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'ja', setName: 'hiragana', history: h,
      stats: {
        'し': { ok: 3, err: 6, confused: { 'さ': 5 } },
        'き': { ok: 4, err: 3, confused: { 'さ': 3 } },
      },
    }))
  }, history)
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1100)

  // Open the chart, where the door lives.
  await p.evaluate(() => document.getElementById('menuLearnBtn').click())
  await sleep(700)
  const noReset = await p.evaluate(() => !!document.querySelector('#learn #resetBtn'))
  ok('reset is no longer on the child-reachable chart screen', !noReset)

  // A TAP must not open it.
  await p.evaluate(() => {
    const el = document.getElementById('parentBtn')
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await sleep(600)
  ok('a tap does not open the parent corner',
     await p.evaluate(() => document.getElementById('parentScr').hidden))

  // A 3-second hold must.
  await p.evaluate(() => {
    document.getElementById('parentBtn')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  await sleep(3600)
  const opened = await p.evaluate(() => ({
    open: !document.getElementById('parentScr').hidden,
    text: document.getElementById('weekBox')?.textContent?.replace(/\s+/g, ' ').trim(),
    bars: document.querySelectorAll('#weekBox .bars i').length,
    filled: document.querySelectorAll('#weekBox .bars i:not(.none)').length,
    hasSettings: !!document.querySelector('#parentScr #voiceSel'),
    hasReset: !!document.querySelector('#parentScr #resetBtn'),
  }))
  ok('a three-second hold opens it', opened.open)
  // Not just present in the DOM — actually the thing on screen. It is opened
  // from the chart, which is its own stacking layer, and the first version of
  // this screen opened flawlessly and rendered UNDERNEATH it.
  const onTop = await p.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return !!el?.closest('#parentScr')
  })
  ok('and it is actually the screen the parent sees', onTop)
  ok('settings moved behind the gate', opened.hasSettings)
  ok('reset lives behind the gate', opened.hasReset)
  ok('seven days of bars, three with practice',
     opened.bars === 7 && opened.filled === 3, `${opened.bars} bars, ${opened.filled} filled`)
  // 3 days seeded: {あいう} + {あかき} + {さし} = あいうかきさし = 7 distinct
  ok('practised counts DISTINCT characters, not answers',
     /7 characters practised/.test(opened.text || ''), opened.text)
  ok('answers and accuracy reported', /28 answers · 68% right/.test(opened.text || ''),
     opened.text)
  ok('it names the pairs actually being confused',
     /Still mixing up/.test(opened.text || '') && /し/.test(opened.text || ''),
     opened.text)

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close(); process.exit(fail.length ? 1 : 0)
})()
