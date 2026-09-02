/**
 * A pre-reader must be able to explore the interface by ear.
 *   1. Touching a control speaks it, in ENGLISH, not the language being learned
 *   2. Level rows carry a picture and a spoken label
 *   3. Nothing speaks during play (the pad is made of buttons)
 *   4. Reset needs a deliberate hold, not one tap
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
    speechSynthesis.speak = (u) => { window.__said.push({ text: u.text, lang: u.lang }); return orig(u) }
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'ja', setName: 'hiragana',
      campaign: { 'ja-first-vowels': { cleared: true } },
    }))
  })
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1200)

  const tap = async (sel) => {
    await p.evaluate((s) => { window.__said.length = 0 }, sel)
    const el = await p.$(sel)
    if (!el) return null
    await el.tap().catch(async () => { await p.evaluate((s)=>document.querySelector(s).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})), sel) })
    await sleep(500)
    return p.evaluate(() => window.__said.slice())
  }

  const said1 = await tap('#campBtn')
  ok('touching a menu button speaks it', said1 && said1.length > 0,
     JSON.stringify(said1))
  ok('and it speaks in English, not the language being learned',
     said1 && said1.length > 0 && /^en/i.test(said1[0].lang || ''),
     said1 && said1[0] ? `lang=${said1[0].lang} text="${said1[0].text}"` : 'nothing said')

  await sleep(600)
  const rows = await p.evaluate(() => {
    const r = document.querySelector('#campList .lvl')
    return r ? { say: r.dataset.say, icon: r.querySelector('.kind')?.textContent } : null
  })
  ok('level rows carry a picture', !!rows && !!rows.icon, JSON.stringify(rows?.icon))
  ok('level rows carry a spoken label', !!rows && /^Level 1\./.test(rows.say || ''),
     JSON.stringify(rows?.say))

  const said2 = await tap('#campList .lvl')
  ok('touching a level row speaks it', said2 && said2.length > 0 && /Level 1/.test(said2[0]?.text || ''),
     JSON.stringify(said2?.[0]?.text))

  // --- nothing may speak from the steering pad during play ---
  await p.evaluate(() => { const c = document.getElementById('campClose'); if (c) c.click() })
  await sleep(500)
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(3400)
  await p.evaluate(() => { window.__said.length = 0 })
  await p.evaluate(() => {
    for (const b of document.querySelectorAll('#playScr button')) {
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    }
  })
  await sleep(400)
  const duringPlay = await p.evaluate(() => window.__said.filter((s) => /^en/i.test(s.lang || '')))
  ok('the interface stays silent during play', duringPlay.length === 0,
     duringPlay.length ? JSON.stringify(duringPlay.map(s=>s.text)) : 'silent')

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close(); process.exit(fail.length ? 1 : 0)
})()
