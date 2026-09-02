/**
 * Frame-time probe for Script Snake.
 *
 * Launches Chrome, starts an endless run, steers the snake with a greedy bot
 * (via the dev-only window.__snake handle), and records:
 *   - every rAF-to-rAF delta
 *   - PerformanceObserver longtask entries
 *   - timing of speechSynthesis.speak/cancel calls (volume forced to 0)
 *   - game events (eat / spawned / wrong / death) for correlation
 *
 * Usage: node perf-test.js [--headed] [--seconds N] [--no-tts]
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5199/'

const headed = process.argv.includes('--headed')
const noTts = process.argv.includes('--no-tts')
const secArg = process.argv.indexOf('--seconds')
const SECONDS = secArg >= 0 ? Number(process.argv[secArg + 1]) : 60

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headed ? false : 'shell' === 'never' ? false : true,
    args: [
      '--mute-audio',
      '--window-size=600,900',
      '--disable-features=TranslateUI',
      '--no-first-run',
    ],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 560, height: 860 })

  // Instrumentation that must exist before the app boots.
  await page.evaluateOnNewDocument((noTts) => {
    window.__probe = {
      deltas: [],
      long: [],
      tasks: [],
      events: [],
      speak: [],
      cancel: [],
      started: 0,
    }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__probe.tasks.push({ t: e.startTime, d: e.duration })
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {}

    if ('speechSynthesis' in window) {
      if (noTts) {
        // Kill TTS entirely: report no voices so Speech finds none.
        speechSynthesis.getVoices = () => []
      } else {
        const s = speechSynthesis
        const origSpeak = s.speak.bind(s)
        const origCancel = s.cancel.bind(s)
        s.speak = (u) => {
          try { u.volume = 0 } catch {}
          const t0 = performance.now()
          origSpeak(u)
          window.__probe.speak.push({ t: t0, d: performance.now() - t0 })
        }
        s.cancel = () => {
          const t0 = performance.now()
          origCancel()
          window.__probe.cancel.push({ t: t0, d: performance.now() - t0 })
        }
      }
    }
  }, noTts)

  // The game now onboards fresh profiles; the probe wants the menu.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('script-snake-v2', JSON.stringify({ onboarded: true, lang: 'ja' }))
  })
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await page.waitForSelector('#continueBtn', { visible: true })
  // Let fonts land so the metrics cache is stable before measuring.
  await new Promise((r) => setTimeout(r, 1500))
  await page.click('#continueBtn')
  await page.waitForFunction(() => window.__snake && window.__snake.world)
  // Skip the ready countdown: this probe measures a running game.
  await page.evaluate(() => {
    const s = window.__snake.scenes
    if (s.top?.name === 'ready') s.pop()
  })

  // Bot + frame monitor.
  await page.evaluate(() => {
    const P = window.__probe
    P.started = performance.now()

    const CELLS = 16
    const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
    const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' }
    const DIRS = ['up', 'down', 'left', 'right']

    function botTick() {
      const s = window.__snake
      const w = s && s.world
      if (!w || !w.alive) return
      const head = w.snake[0]
      if (!head) return
      const wrap = w.mode.wrap
      const target = w.items.find((i) => i.correct)
      const occupied = new Set()
      for (let i = 0; i < w.snake.length - 1; i++) {
        const seg = w.snake[i]
        occupied.add(seg.y * CELLS + seg.x)
      }
      for (const c of w.obstacles) occupied.add(c)
      const cur = w.input.current
      let best = null
      let bestScore = -Infinity
      for (const d of DIRS) {
        if (d === OPP[cur]) continue
        let nx = head.x + VEC[d][0]
        let ny = head.y + VEC[d][1]
        if (wrap) {
          nx = (nx + CELLS) % CELLS
          ny = (ny + CELLS) % CELLS
        } else if (nx < 0 || ny < 0 || nx >= CELLS || ny >= CELLS) continue
        if (occupied.has(ny * CELLS + nx)) continue
        let sc = 0
        const item = w.items.find((i) => i.x === nx && i.y === ny)
        if (item && !item.correct) sc -= 60
        if (target) {
          let dx = Math.abs(target.x - nx)
          let dy = Math.abs(target.y - ny)
          if (wrap) {
            dx = Math.min(dx, CELLS - dx)
            dy = Math.min(dy, CELLS - dy)
          }
          sc -= dx + dy
        }
        let freedom = 0
        for (const d2 of DIRS) {
          let mx = nx + VEC[d2][0]
          let my = ny + VEC[d2][1]
          if (wrap) {
            mx = (mx + CELLS) % CELLS
            my = (my + CELLS) % CELLS
          } else if (mx < 0 || my < 0 || mx >= CELLS || my >= CELLS) continue
          if (!occupied.has(my * CELLS + mx)) freedom++
        }
        if (freedom === 0) sc -= 1000
        sc += Math.random() * 0.01
        if (sc > bestScore) {
          bestScore = sc
          best = d
        }
      }
      if (best && best !== cur) w.turn(best)
    }

    // Subscribe to world events; re-subscribe when the world is replaced.
    let lastWorld = null
    function subscribe() {
      const w = window.__snake && window.__snake.world
      if (!w || w === lastWorld) return
      lastWorld = w
      for (const k of ['eat', 'spawned', 'wrong', 'death']) {
        try {
          w.events.on(k, () => P.events.push({ t: performance.now(), k }))
        } catch {}
      }
    }
    subscribe()

    // Auto-restart after death.
    setInterval(() => {
      subscribe()
      const over = document.getElementById('overScr')
      if (over && !over.hidden) {
        const btn = document.getElementById('againBtn')
        if (btn) btn.click()
      }
    }, 400)

    let last = performance.now()
    function mon(now) {
      const d = now - last
      last = now
      P.deltas.push(d)
      if (d > 25) P.long.push({ t: now, d: Math.round(d * 10) / 10 })
      botTick()
      requestAnimationFrame(mon)
    }
    requestAnimationFrame(mon)
  })

  console.log(`running ${SECONDS}s (${headed ? 'headed' : 'headless'}, tts ${noTts ? 'OFF' : 'on'})...`)
  await new Promise((r) => setTimeout(r, SECONDS * 1000))

  const data = await page.evaluate(() => {
    const P = window.__probe
    const w = window.__snake && window.__snake.world
    return {
      deltas: P.deltas,
      long: P.long,
      tasks: P.tasks,
      events: P.events,
      speak: P.speak,
      cancel: P.cancel,
      started: P.started,
      finalScore: w ? w.score : null,
      finalLen: w ? w.snake.length : null,
      voices: 'speechSynthesis' in window ? speechSynthesis.getVoices().length : 0,
    }
  })
  await browser.close()

  // ---- analysis ----
  const ds = data.deltas.slice(30) // skip warmup
  ds.sort ; // keep original order for correlation; copy for percentiles
  const sorted = [...ds].sort((a, b) => a - b)
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length
  const over25 = ds.filter((d) => d > 25).length
  const over34 = ds.filter((d) => d > 34).length
  const over50 = ds.filter((d) => d > 50).length

  console.log(`frames: ${ds.length}  mean ${mean.toFixed(2)}ms  p50 ${pct(0.5).toFixed(1)}  p95 ${pct(0.95).toFixed(1)}  p99 ${pct(0.99).toFixed(1)}  max ${pct(1).toFixed(1)}`)
  console.log(`long frames: >25ms ${over25}  >34ms ${over34}  >50ms ${over50}   (of ${ds.length})`)
  console.log(`events: ${data.events.length} total  (eats ${data.events.filter((e) => e.k === 'eat').length}, wrong ${data.events.filter((e) => e.k === 'wrong').length}, deaths ${data.events.filter((e) => e.k === 'death').length})`)
  console.log(`speak calls: ${data.speak.length}, max ${Math.max(0, ...data.speak.map((s) => s.d)).toFixed(1)}ms; cancel calls: ${data.cancel.length}, max ${Math.max(0, ...data.cancel.map((s) => s.d)).toFixed(1)}ms; voices: ${data.voices}`)
  console.log(`longtasks: ${data.tasks.length}` + (data.tasks.length ? `  max ${Math.max(...data.tasks.map((t) => t.d)).toFixed(0)}ms` : ''))

  // Correlate long frames with events/speech in the preceding 60ms.
  const near = (t, list, win) => list.filter((e) => e.t <= t && e.t > t - win)
  let corEat = 0, corSpeak = 0, corDeath = 0, corNone = 0
  for (const lf of data.long) {
    const evs = near(lf.t, data.events, 80)
    const sps = near(lf.t, [...data.speak, ...data.cancel], 80)
    if (evs.some((e) => e.k === 'death')) corDeath++
    else if (evs.some((e) => e.k === 'eat' || e.k === 'spawned' || e.k === 'wrong')) corEat++
    else if (sps.length) corSpeak++
    else corNone++
  }
  console.log(`long-frame correlation: with eat/spawn/wrong ${corEat}, with death ${corDeath}, with speak-only ${corSpeak}, unexplained ${corNone}`)
  if (data.long.length) {
    console.log('worst 10 long frames (ms):', data.long.sort((a, b) => b.d - a.d).slice(0, 10).map((l) => l.d).join(', '))
  }
  console.log(`final: score ${data.finalScore}, snake length ${data.finalLen}`)

  require('fs').writeFileSync(
    `${__dirname}/probe-${headed ? 'headed' : 'headless'}${noTts ? '-nott' : ''}.json`,
    JSON.stringify(data),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
