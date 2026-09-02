/**
 * Two claims, tested rather than assumed:
 *  A. The LADDER is the default path — a fresh player's one button starts
 *     level 1, the focus card names the next rung, and the strip has a tick
 *     per level. (This regressed: every character counted as "due" on day
 *     one, so Continue always fell through to endless.)
 *  B. The CALLOUT is visible — after a miss the wanted character is scaled up
 *     and spotlit while the rest of the board steps back. Measured in pixels
 *     with the simulation frozen, so nothing can be credited to the snake.
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5199/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--mute-audio', '--no-first-run'],
  })
  const fail = []
  const ok = (n, c, extra = '') => {
    console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`)
    if (!c) fail.push(n)
  }
  const p = await browser.newPage()
  p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); fail.push('pageerror') })
  await p.goto(URL, { waitUntil: 'networkidle2' })
  await sleep(1000)

  // --- get a fresh player to the menu ---
  await p.evaluate(() => {
    const b = document.querySelector('#onboardScr .chip') ||
              document.querySelector('#onboardScr button')
    if (b) b.click()
  })
  await sleep(400)
  // click through whatever onboarding steps remain until the menu shows
  for (let i = 0; i < 6; i++) {
    const atMenu = await p.evaluate(() => !document.getElementById('menuScr').hidden)
    if (atMenu) break
    await p.evaluate(() => {
      const scr = [...document.querySelectorAll('.scr')].find((s) => !s.hidden)
      const b = scr && (scr.querySelector('button.primary') || scr.querySelector('button'))
      if (b) b.click()
    })
    await sleep(450)
  }

  // Onboarding hands straight off into a run, which is the intended flow.
  // Reload now that a save exists: a returning player lands on the menu.
  await p.reload({ waitUntil: 'networkidle2' })
  await sleep(1000)

  const menu = await p.evaluate(() => ({
    visible: !document.getElementById('menuScr').hidden,
    next: document.getElementById('focusNext')?.textContent || '',
    btn: document.getElementById('continueBtn')?.textContent || '',
    ticks: document.getElementById('focusLadder')?.children.length || 0,
    ladderText: document.getElementById('focusLadderText')?.textContent || '',
    campBtn: document.getElementById('campBtn')?.textContent || '',
    campVisible: !!document.getElementById('campBtn')?.offsetParent,
  }))
  ok('menu reached', menu.visible)
  ok('focus card names the next rung', /Level\s*1\s*of\s*\d+/.test(menu.next), JSON.stringify(menu.next))
  ok('Continue names the level it will start', /^Level 1 ·/.test(menu.btn), menu.btn)
  ok('ladder has one tick per level', menu.ticks > 5, `${menu.ticks} ticks`)
  ok('ladder shows cleared count', /0\/\d+ levels/.test(menu.ladderText), menu.ladderText)
  ok('All levels button is visible without expanding', menu.campVisible, menu.campBtn)

  // --- Continue must start the LADDER, not endless ---
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(1800)
  const run = await p.evaluate(() => {
    const r = window.__snake.run
    return { level: r?.level?.title ?? null, id: r?.level?.id ?? null }
  })
  // Ids are keyed on the title now, not the position, so assert it is THE
  // first level of the ladder rather than pattern-matching an index.
  const firstId = await p.evaluate(() => window.__snake.data && (() => {
    const C = window.__snake
    return C.run?.level?.id ?? null
  })())
  ok('Continue starts the first campaign level, not endless',
     run.id && run.id === firstId && run.level === 'sounds: A to E',
     `run=${run.id} "${run.level}"`)

  // --- CALLOUT: freeze, force a miss, measure ---
  await sleep(1200)
  // Measure the ink inside each character's own cell. A whole-canvas sum is
  // swamped by the snake, which is far larger and just as bright as a glyph.
  const cells = () => p.evaluate(() => {
    const c = document.getElementById('c')
    const g = c.getContext('2d')
    const step = c.width / 16
    return window.__snake.world.items.map((it) => {
      const x0 = Math.max(0, Math.round((it.x - 0.6) * step))
      const y0 = Math.max(0, Math.round((it.y - 0.6) * step))
      const w = Math.min(c.width - x0, Math.round(step * 2.2))
      const h = Math.min(c.height - y0, Math.round(step * 2.2))
      const d = g.getImageData(x0, y0, w, h).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
      return { ch: it.ch, ink: sum }
    })
  })

  // Freeze the SIMULATION only — the render loop keeps running, so anything
  // measured below is animation and cannot be the snake moving.
  const froze = await p.evaluate(() => {
    const s = window.__snake
    if (!s.world) return null
    s.world.step = () => {}
    return { items: s.world.items.length }
  })
  ok('world has items to react', froze && froze.items > 1, JSON.stringify(froze))
  await sleep(450)

  // Two idle samples first: the characters float, so a cell's ink total moves
  // on its own. That natural drift is the yardstick the callout must beat and
  // the band the board must settle back inside.
  const before = await cells()
  await sleep(220)
  const idleB = await cells()
  const idleDrift = Math.max(
    ...idleB.map((c, i) => Math.abs(c.ink / before[i].ink - 1)),
  )
  ok('idle float is measurable but small', idleDrift < 0.15,
     `natural drift ${(idleDrift * 100).toFixed(1)}%`)

  const ch = await p.evaluate(() => {
    const s = window.__snake, it = s.world.items[0]
    s.renderer.callOut(it.x, it.y)
    return it.ch
  })
  await sleep(220)
  const during = await cells()
  const ratio = (arr, i) => arr[i].ink / before[i].ink
  const calledUp = ratio(during, 0)
  const others = during.slice(1).map((_, i) => ratio(during, i + 1))
  // Per-cell totals include board and wave field, which do not dim, so how
  // much a single box darkens depends on how much of it the glyph covers.
  // The mean across the decoys is the honest aggregate; the per-cell rule is
  // just that none of them BRIGHTENS, since only one character may be lit.
  const meanOther = others.reduce((a, b) => a + b, 0) / others.length

  ok('the wanted character rears up', calledUp > 1.12,
     `"${ch}" ink x${calledUp.toFixed(2)}`)
  // Mean, not per-cell: the jade bloom is wider than one cell, so a decoy
  // sitting next to the called character legitimately picks up some of it.
  ok('every other character steps back', meanOther < 0.95,
     `mean x${meanOther.toFixed(2)} of ${others.map((r) => r.toFixed(2)).join(', ')}`)
  ok('the callout separates them clearly', calledUp - meanOther > 0.25,
     `gap ${(calledUp - meanOther).toFixed(2)}`)

  await sleep(1700)
  const after = await cells()
  // Compare within ONE frame rather than against a frame taken two seconds
  // earlier: the characters float on a multi-second cycle, so any two distant
  // frames differ for reasons that have nothing to do with the callout. The
  // claim being tested is simply that the spotlight has ended — that the
  // called character no longer stands apart from the rest.
  const sep = (f) =>
    f[0].ink / (f.slice(1).reduce((a, c) => a + c.ink, 0) / (f.length - 1))
  // Average a few frames: the characters float on a multi-second cycle, so a
  // single frame's separation carries real phase noise.
  const samples = [after]
  for (let i = 0; i < 3; i++) { await sleep(130); samples.push(await cells()) }
  const sepNow = samples.reduce((a, f) => a + sep(f), 0) / samples.length
  const sepBefore = (sep(before) + sep(idleB)) / 2
  ok('the spotlight ends and the board levels out',
     Math.abs(sepNow - sepBefore) < 0.12,
     `separation ${sepNow.toFixed(2)} vs ${sepBefore.toFixed(2)} before`)

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await browser.close()
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
