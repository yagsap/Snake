/**
 * The red boundary is gone. Three claims:
 *   1. No red frame is painted around the board on any level.
 *   2. Driving the head off every edge wraps instead of killing.
 *   3. The wall-only mode is gone and an old save naming it still loads.
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

  // An old save that names the removed mode, plus a boss level unlocked —
  // the gauntlets are where the lethal border used to live.
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('script-snake-v2', JSON.stringify({
      onboarded: true, lang: 'en', setName: 'Capitals', mode: 'ink',
      campaign: { 'en-1': { cleared: true }, 'en-2': { cleared: true } },
    }))
  })
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle2' })
  await sleep(1000)

  const modes = await p.evaluate(() => {
    document.getElementById('moreBtn').click()
    return {
      ids: [...document.querySelectorAll('[data-mode]')].map((e) => e.dataset.mode),
      saved: window.__snake.data.mode,
    }
  })
  ok('the wall-only mode is gone', !modes.ids.includes('ink'), `modes: ${modes.ids.join(', ')}`)
  ok('a save naming the removed mode still loads', modes.saved === 'drift', `mode=${modes.saved}`)

  // Level 3 is "the bee family" — a gauntlet, which used to have lethal edges.
  await p.evaluate(() => document.getElementById('continueBtn').click())
  await sleep(2600)
  const lvl = await p.evaluate(() => window.__snake.run?.level?.title ?? null)
  ok('playing a former deadly-wall level', lvl !== null, `level: "${lvl}"`)

  // No red frame anywhere along the border.
  const red = await p.evaluate(() => {
    const c = document.getElementById('c')
    const g = c.getContext('2d')
    const hits = []
    const scan = (x, y, w, h, tag) => {
      const d = g.getImageData(x, y, w, h).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        // vermillion #E63B2E: strongly red-dominant
        if (d[i] > 150 && d[i] > d[i + 1] * 2.2 && d[i] > d[i + 2] * 2.2) n++
      }
      if (n) hits.push(`${tag}:${n}`)
      return n
    }
    const W = c.width, T = 10
    const total = scan(0, 0, W, T, 'top') + scan(0, W - T, W, T, 'bottom') +
                  scan(0, 0, T, W, 'left') + scan(W - T, 0, T, W, 'right')
    return { total, hits }
  })
  ok('no red frame is painted on the border', red.total === 0,
     red.hits.length ? red.hits.join(' ') : 'border clean')

  // Drive the head off all four edges and confirm it survives each time.
  const runs = []
  for (const dir of ['left', 'up', 'right', 'down']) {
    const r = await p.evaluate((d) => {
      const w = window.__snake.world
      const cells = 16
      // Park the head on the matching edge, pointing outward.
      const pos = { left: { x: 0, y: 8 }, right: { x: cells - 1, y: 8 },
                    up: { x: 8, y: 0 }, down: { x: 8, y: cells - 1 } }[d]
      w.snake.length = 1
      w.snake[0] = { x: pos.x, y: pos.y }
      w.prevSnake = [{ ...pos }]
      // `current` is a getter over `facing`; assigning to it silently does
      // nothing, which is how an earlier version of this test "passed" while
      // the snake carried on rightwards and never touched three of the edges.
      w.input.facing = d
      w.input.queue = []
      w.alive = true
      w.pendingDeath = null
      const facing = w.input.current
      const path = []
      for (let i = 0; i < 3; i++) { w.step(); const s = w.snake[0]; path.push(`${s.x},${s.y}`) }
      const h = w.snake[0]
      return { alive: w.alive, x: h.x, y: h.y, death: w.pendingDeath ?? null,
               facing, from: `${pos.x},${pos.y}`, path: path.join(' -> ') }
    }, dir)
    runs.push({ dir, ...r })
  }
  for (const r of runs) {
    const moved = r.facing === r.dir
    ok(`heading ${r.dir} off the edge wraps instead of killing`,
       r.alive && !r.death && moved,
       `facing ${r.facing} from (${r.from}) -> ${r.path}${r.death ? ' death=' + r.death : ''}`)
  }

  console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nall good')
  await b.close()
  process.exit(fail.length ? 1 : 0)
})()
