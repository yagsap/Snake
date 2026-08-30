/**
 * Composition root.
 *
 * Everything is wired here and only here: the world simulates, the renderer
 * draws, views render DOM, and this file is the one place that knows about
 * all of them. The scene stack decides who updates and who draws each frame;
 * the fixed-timestep loop decides when.
 */
import { FIXED_DT, GameLoop } from './core/loop'
import { bindInput, DIR_VECTORS, type Dir } from './core/input'
import { SceneStack, type Scene } from './core/scene'
import { load, save, saveNow, type SaveData } from './core/storage'
import { buildTable, LANGUAGES, setNamesFor, type CharTable } from './data/scripts'
import { JUICE, THEME } from './game/config'
import { MODES } from './game/modes'
import { comboMultiplier } from './game/progression'
import { World } from './game/world'
import { Renderer } from './render/renderer'
import { HitStop } from './render/camera'
import { Speech, Tones } from './ui/audio'
import { Hud } from './ui/hud'
import { ChartView, GameOverView, MenuView } from './ui/menus'
import { haptic, initNativeChrome } from './ui/native'

const data: SaveData = load()
let table: CharTable = buildTable(data.lang, data.setName)

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new Renderer(canvas)
renderer.setMotion(!data.reducedMotion)
const hitStop = new HitStop()
const speech = new Speech(data.lang, data.voices)
const tones = new Tones()
const hud = new Hud()
const scenes = new SceneStack()

let world: World | null = null

const playScr = document.getElementById('playScr') as HTMLElement
const pauseBtn = document.getElementById('pauseBtn') as HTMLElement

// ------------------------------------------------------------------ scenes --

/**
 * The running game. Owns the world's event subscriptions for its lifetime —
 * they are created in enter() and disposed in exit(), so a quit run cannot
 * leave handlers firing into dead UI.
 */
function makePlayScene(): Scene {
  const disposers: Array<() => void> = []

  return {
    name: 'play',
    enter() {
      playScr.hidden = false
      pauseBtn.textContent = '‖ pause'
      hud.reset()
      renderer.reset()
      hitStop.clear()

      const w = new World({ table, stats: data.stats, mode: MODES[data.mode] })
      world = w
      // Subscriptions land before reset(): reset emits the first 'spawned',
      // and the opening cue must not be lost.

      disposers.push(
        w.events.on('spawned', ({ target, sound }) => {
          // If no voice resolved, the sound MUST be shown — a mute '♪' would
          // make the target unknowable.
          hud.setCue(data.showRomaji || !speech.current ? sound : '♪')
          hud.pulseSeal()
          speech.speak(target)
        }),

        w.events.on('eat', ({ item, award, streak, score }) => {
          const c = renderer.centerOf(item)
          const wasMult = comboMultiplier(streak - 1)
          const isMult = comboMultiplier(streak)

          hud.setScore(score)
          hud.setStreak(streak)
          renderer.popEat()
          renderer.camera.addTrauma(JUICE.traumaOnEat)
          const v = DIR_VECTORS[w.input.current]
          renderer.fx.ring(c.x, c.y, THEME.jade, JUICE.ringLife)
          renderer.fx.burst(c.x, c.y, THEME.jadeBright, 10, 240, v.x, v.y)
          renderer.fx.text(c.x, c.y, `+${award.points}`, THEME.jadeBright)
          if (award.speedBonus > 0) {
            renderer.fx.text(c.x, c.y + 20, `fast +${award.speedBonus}`, THEME.gold, 0.8, 13)
          }
          if (isMult > wasMult) {
            haptic.multiplier()
            tones.multiplierUp()
            renderer.flash.fire(THEME.jade, 0.12)
            renderer.fx.text(c.x, c.y - 26, `×${isMult}`, THEME.gold, 1.1, 26)
          } else {
            haptic.eat()
            tones.eat(streak)
          }
        }),

        w.events.on('wrong', ({ item, target, targetSound }) => {
          const c = renderer.centerOf(item)
          hud.setStreak(0)
          renderer.popWrong()
          renderer.camera.addTrauma(JUICE.traumaOnWrong)
          renderer.flash.fire(THEME.shu, 0.18)
          hitStop.request(JUICE.hitStopWrong)
          haptic.wrong()
          tones.wrong()
          const v = DIR_VECTORS[w.input.current]
          renderer.fx.ring(c.x, c.y, THEME.shu, JUICE.wrongRingLife)
          renderer.fx.burst(c.x, c.y, THEME.shuSoft, 8, 200, v.x, v.y)
          // The teaching moment: what you bit, and what you should have bitten.
          renderer.fx.text(
            c.x, c.y,
            `${item.ch} ${table[item.ch] ?? ''}`,
            THEME.shu, JUICE.correctionLife,
          )
          if (target) {
            renderer.fx.text(
              c.x, c.y + 24,
              `wanted ${target} ${targetSound}`,
              THEME.washi, JUICE.correctionLife, 13,
            )
          }
        }),

        w.events.on('death', ({ score, eaten }) => {
          renderer.camera.addTrauma(JUICE.traumaOnDeath)
          renderer.flash.fire(THEME.shu, 0.3)
          hitStop.request(JUICE.hitStopDeath)
          haptic.death()
          tones.death()

          const isRecord = score > data.bestScore
          data.bestScore = Math.max(data.bestScore, score)
          data.bestEaten = Math.max(data.bestEaten, eaten)
          save(data)

          // Let the death sink in before the card: the crash the player just
          // made is information, and covering it instantly hides the lesson.
          // The timer is owned by this scene (cleared on exit) and checks
          // world identity, so quit/restart inside the window can't race it,
          // and an overlay pushed meanwhile is popped rather than orphaning
          // the card.
          const timer = setTimeout(() => {
            if (world !== w || !scenes.has('play') || scenes.has('gameover')) return
            while (scenes.top && scenes.top.name !== 'play') scenes.pop()
            scenes.push(makeGameOverScene(isRecord))
          }, 700)
          disposers.push(() => clearTimeout(timer))
        }),
      )

      disposers.push(() => w.events.clear())
      w.reset()
      loop.resync()
    },

    exit() {
      for (const d of disposers) d()
      world = null
      playScr.hidden = true
    },

    update(dt) {
      if (hitStop.active) return
      world?.update(dt)
    },

    render(alpha, dt) {
      if (!world) return
      hud.update(dt)
      renderer.update(dt)
      renderer.draw(world, world.renderAlpha(alpha * FIXED_DT), {
        paused: scenes.has('pause'),
        dimmed: scenes.has('gameover'),
      })
    },
  }
}

/**
 * Pause overlay. It draws nothing itself — the play scene below keeps drawing
 * (drawsBelow) and adds the veil when it sees this scene on the stack. One
 * draw per frame instead of two.
 */
function makePauseScene(): Scene {
  return {
    name: 'pause',
    drawsBelow: true,
    enter() {
      pauseBtn.textContent = '▶ resume'
    },
    exit() {
      pauseBtn.textContent = '‖ pause'
      loop.resync()
    },
  }
}

/** The study chart, over either the menu or a paused game. */
function makeChartScene(): Scene {
  return {
    name: 'chart',
    drawsBelow: true,
    enter() {
      chartView.open(data, table)
    },
    exit() {
      chartView.close()
      loop.resync()
    },
  }
}

function makeGameOverScene(isRecord: boolean): Scene {
  return {
    name: 'gameover',
    drawsBelow: true, // the final board stays visible, dimmed, behind the card
    enter() {
      const w = world
      if (!w) return
      // Characters missed this run, worst-first — the review row.
      const missed = [...w.runErrors.entries()]
        .filter(([ch]) => ch in table)
        .sort((a, b) => b[1] - a[1])
        .map(([ch]) => ({ ch, sound: table[ch] ?? '' }))
      gameOverView.show({
        score: w.score,
        eaten: w.eaten,
        bestStreak: w.bestStreak,
        mistakes: w.mistakes,
        isRecord,
        missed,
      })
    },
    exit() {
      gameOverView.hide()
    },
  }
}

function makeMenuScene(message?: string): Scene {
  return {
    name: 'menu',
    enter() {
      menuView.show(data, message)
    },
    exit() {
      menuView.hide()
    },
  }
}

// ------------------------------------------------------------------- views --

const menuView = new MenuView({
  onLang(lang) {
    data.lang = lang
    data.setName = setNamesFor(lang)[0] ?? ''
    table = buildTable(data.lang, data.setName)
    speech.setLanguage(lang)
    syncVoices()
    save(data)
    menuView.render(data)
  },
  onSet(setName) {
    data.setName = setName
    table = buildTable(data.lang, data.setName)
    save(data)
    menuView.render(data)
  },
  onMode(mode) {
    data.mode = mode
    save(data)
    menuView.render(data)
  },
  onPlay: startRun,
  onLearn() {
    scenes.push(makeChartScene())
  },
})

const chartView = new ChartView({
  onSpeak: (ch) => speech.speak(ch),
  onClose() {
    if (scenes.top?.name === 'chart') scenes.pop()
  },
  onReset() {
    if (!confirm(`Clear your ${LANGUAGES[data.lang].name} progress?`)) return
    // Every set of the language, not just the visible table — the confirm
    // names the language, so that is what gets cleared.
    for (const set of Object.values(LANGUAGES[data.lang].sets)) {
      for (const ch of Object.keys(set)) delete data.stats[ch]
    }
    save(data)
    if (scenes.top?.name === 'chart') {
      chartView.open(data, table) // re-render with cleared stats
    }
  },
  onVoice(name) {
    speech.choose(name)
    save(data)
    syncVoices()
    if (world?.target) speech.speak(world.target)
  },
  onShowRomaji(show) {
    data.showRomaji = show
    hud.setSealHidden(!show && !!speech.current)
    if (world?.target) {
      hud.setCue(show || !speech.current ? (table[world.target] ?? '—') : '♪')
    }
    save(data)
  },
  onReducedMotion(reduced) {
    data.reducedMotion = reduced
    renderer.setMotion(!reduced)
    save(data)
  },
})

const gameOverView = new GameOverView(
  () => {
    // Again: tear the whole stack down and start a fresh run.
    scenes.replaceAll(makePlayScene())
  },
  () => {
    scenes.replaceAll(makeMenuScene(runSummary()))
  },
  (ch) => speech.speak(ch),
)

function runSummary(): string | undefined {
  return world ? `run: ${world.score} · best ${data.bestScore}` : undefined
}

function syncVoices(): void {
  chartView.setVoices(speech.voices, speech.current, LANGUAGES[data.lang].name)
}

function startRun(): void {
  scenes.replaceAll(makePlayScene())
}

// ------------------------------------------------------------------- input --

bindInput(canvas, {
  onTurn(dir: Dir) {
    if (scenes.top?.name === 'play') world?.turn(dir)
  },
  onAction(action) {
    const top = scenes.top?.name
    switch (action) {
      case 'replay-cue':
      case 'tap':
        if ((top === 'play' || top === 'pause') && world?.target) {
          hud.pulseSeal()
          speech.speak(world.target)
        }
        break
      case 'pause':
        // Never pause a dead world: the death timeout is about to bring up
        // the game-over card, and a pause pushed in that window would orphan it.
        if (top === 'play' && world?.alive) scenes.push(makePauseScene())
        else if (top === 'pause') scenes.pop()
        break
      case 'learn':
        if (top === 'chart') scenes.pop()
        else if (top === 'pause' || top === 'menu' || (top === 'play' && world?.alive)) {
          scenes.push(makeChartScene())
        }
        break
      case 'escape':
        if (top === 'chart' || top === 'pause') scenes.pop()
        else if (top === 'play' && world?.alive) scenes.push(makePauseScene())
        break
    }
  },
  isBlocked: () => {
    // 'pause' stays unblocked so space/tap can replay the cue — a paused
    // screen is exactly where a learner studies the sound. Turns are still
    // gated per-action above (onTurn checks the top scene is 'play').
    const top = scenes.top?.name
    return top !== 'play' && top !== 'pause'
  },
})

document.getElementById('pauseBtn')?.addEventListener('click', () => {
  const top = scenes.top?.name
  if (top === 'play' && world?.alive) scenes.push(makePauseScene())
  else if (top === 'pause') scenes.pop()
})

document.getElementById('quitBtn')?.addEventListener('click', () => {
  const summary = runSummary()
  if (scenes.has('play')) scenes.replaceAll(makeMenuScene(summary))
})

document.getElementById('seal')?.addEventListener('click', () => {
  if (world?.target) {
    hud.pulseSeal()
    speech.speak(world.target)
  }
})

// Auto-pause when the tab loses focus. A game the player is not looking at
// must not keep killing them; this was the prototype's worst timing bug.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (scenes.top?.name === 'play' && world?.alive) scenes.push(makePauseScene())
    saveNow(data)
  }
})
addEventListener('pagehide', () => saveNow(data))

speech.onVoicesChanged = syncVoices

// -------------------------------------------------------------------- loop --

const loop = new GameLoop({
  update(dt) {
    hitStop.update(dt)
    scenes.update(dt)
  },
  render(alpha, dt) {
    scenes.render(alpha, dt)
  },
})

initNativeChrome()
chartView.syncSettings(data)
hud.setSealHidden(!data.showRomaji && !!speech.current)
syncVoices()
scenes.push(makeMenuScene())
loop.start()

// Dev-only debug handle: lets tooling (and a curious console) inspect the live
// world. Stripped from production builds — import.meta.env.DEV is compile-time.
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__snake', {
    get: () => ({ world, scenes, data }),
  })
}
