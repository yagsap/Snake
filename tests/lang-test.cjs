/**
 * Per-language smoke test: for each language, switch to it, open the chart,
 * play a run with the bot, and open its campaign — checking for console
 * errors, glyph rendering, spawn sanity, and unfair (same-sound) tiles.
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = 'http://localhost:5199/'

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--mute-audio', '--no-first-run'],
  })
  const langs = ['en', 'ja', 'zh', 'ru', 'hi', 'ko', 'el']
  for (const lang of langs) {
    const page = await browser.newPage()
    await page.emulate({
      viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    // Land on the menu, not on onboarding: #langGrid is the MENU's picker and
    // is never populated while the onboarding screen owns the page.
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('script-snake-v2', JSON.stringify({ onboarded: true }))
    })
    await page.goto(URL, { waitUntil: 'networkidle2' })
    await page.evaluate(() => document.getElementById('moreBtn')?.click())
    await page.waitForSelector('#langGrid .chip')
    await new Promise((r) => setTimeout(r, 1400))

    const picked = await page.evaluate((l) => {
      const chip = [...document.querySelectorAll('#langGrid .chip')].find((c) => c.dataset.lang === l)
      if (!chip) return false
      chip.click()
      return true
    }, lang)
    if (!picked) { console.log(`${lang}: CHIP NOT FOUND`); await page.close(); continue }
    await new Promise((r) => setTimeout(r, 400))

    // Chart
    await page.evaluate(() => document.getElementById('menuLearnBtn').click())
    await page.waitForSelector('.learn.show .tile')
    const chart = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.learn .tile')]
      const overflow = tiles.filter((t) => {
        const b = t.querySelector('b')
        return b && b.scrollHeight > t.clientHeight + 2
      }).length
      return { tiles: tiles.length, overflow, title: document.getElementById('learnTitle').textContent }
    })
    await page.evaluate(() => document.getElementById('learnClose').click())
    await new Promise((r) => setTimeout(r, 250))

    // Campaign list
    await page.evaluate(() => document.getElementById('campBtn').click())
    await page.waitForSelector('#campList .lvl')
    const camp = await page.evaluate(() => ({
      levels: document.querySelectorAll('#campList .lvl').length,
      first: document.querySelector('#campList .lvl .meta b')?.textContent,
    }))
    await page.evaluate(() => document.getElementById('campClose').click())
    await new Promise((r) => setTimeout(r, 250))

    // Play a run with the bot
    await page.evaluate(() => document.getElementById('playBtn').click())
    await page.waitForFunction(() => window.__snake && window.__snake.world)
    await page.evaluate(() => {
      const CELLS = 16
      const VEC = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] }
      const OPP = { up:'down', down:'up', left:'right', right:'left' }
      const DIRS = ['up','down','left','right']
      window.__bad = { sameSound: 0, noTarget: 0, eats: 0, wrong: 0 }
      const w0 = window.__snake.world
      w0.events.on('eat', () => window.__bad.eats++)
      w0.events.on('wrong', () => window.__bad.wrong++)
      setInterval(() => {
        const w = window.__snake.world
        if (!w) return
        // fairness audit: no distractor may share the target's sound
        const t = w.items.find(i => i.correct)
        if (!t) { window.__bad.noTarget++; return }
        const ts = w.soundOf(t.ch)
        for (const it of w.items) if (!it.correct && w.soundOf(it.ch) === ts) window.__bad.sameSound++
      }, 200)
      function tick() {
        const w = window.__snake.world
        if (!w || !w.alive) return
        const head = w.snake[0]; if (!head) return
        const wrap = w.mode.wrap
        const target = w.items.find(i => i.correct)
        const occ = new Set()
        for (let i=0;i<w.snake.length-1;i++) occ.add(w.snake[i].y*CELLS+w.snake[i].x)
        for (const c of w.obstacles) occ.add(c)
        const cur = w.input.current
        let best=null,bs=-Infinity
        for (const d of DIRS) {
          if (d===OPP[cur]) continue
          let nx=head.x+VEC[d][0], ny=head.y+VEC[d][1]
          if (wrap){nx=(nx+CELLS)%CELLS;ny=(ny+CELLS)%CELLS}
          else if(nx<0||ny<0||nx>=CELLS||ny>=CELLS) continue
          if (occ.has(ny*CELLS+nx)) continue
          let sc=0
          const item=w.items.find(i=>i.x===nx&&i.y===ny)
          if (item&&!item.correct) sc-=60
          if (target){let dx=Math.abs(target.x-nx),dy=Math.abs(target.y-ny)
            if(wrap){dx=Math.min(dx,CELLS-dx);dy=Math.min(dy,CELLS-dy)}
            sc-=dx+dy}
          sc+=Math.random()*0.01
          if(sc>bs){bs=sc;best=d}
        }
        if (best&&best!==cur) w.turn(best)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await new Promise((r) => setTimeout(r, 12000))
    const play = await page.evaluate(() => {
      const w = window.__snake.world
      return { ...window.__bad, score: w ? w.score : null, target: w ? w.target : null,
               cue: document.getElementById('cueText').textContent }
    })
    if (lang === 'ko' || lang === 'el' || lang === 'en') {
      // screenshot removed: times out on throttled host
    }
    console.log(
      `${lang}: chart ${chart.tiles} tiles (overflow ${chart.overflow}) "${chart.title}" | ` +
      `campaign ${camp.levels} lvls, first "${camp.first}" | ` +
      `play eats ${play.eats} wrong ${play.wrong} score ${play.score} cue "${play.cue}" | ` +
      `unfair-tiles ${play.sameSound} no-target ${play.noTarget} | errors ${errors.filter(e => !e.includes('404')).length}`,
    )
    if (errors.filter(e => !e.includes('404')).length) console.log('   ERRORS:', errors.filter(e => !e.includes('404')).slice(0,3))
    await page.close()
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
