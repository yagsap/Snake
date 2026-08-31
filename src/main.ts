/**
 * Composition root.
 *
 * Everything is wired here and only here: the world simulates, the renderer
 * draws, views render DOM, and this file is the one place that knows about
 * all of them. The scene stack decides who updates and who draws each frame;
 * the fixed-timestep loop decides when.
 *
 * A "run" is one configured game: endless (mode pills), a campaign level, or
 * the daily seeded challenge. All three flow through the same play scene with
 * a RunConfig — levels are data, not code paths.
 */
import { FIXED_DT, GameLoop } from './core/loop'
import { bindInput, DIR_VECTORS, type Dir } from './core/input'
import { SceneStack, type Scene } from './core/scene'
import { load, save, saveNow, type SaveData } from './core/storage'
import { buildTable, LANGUAGES, setNamesFor, type CharTable } from './data/scripts'
import { CELL, JUICE, THEME } from './game/config'
import {
  CAMPAIGNS,
  dailySeed,
  dateKey,
  layoutCells,
  tableFromChars,
  type LevelSpec,
  type WordEntry,
} from './game/levels'
import { MODES, type Mode } from './game/modes'
import { comboMultiplier } from './game/progression'
import { World } from './game/world'
import { Renderer } from './render/renderer'
import { Speech, Tones } from './ui/audio'
import { Hud } from './ui/hud'
import {
  CampaignView,
  ChartView,
  GameOverView,
  LevelEndView,
  MenuView,
} from './ui/menus'
import { haptic, initNativeChrome } from './ui/native'
import { Diag } from './ui/diag'

const data: SaveData = load()
let table: CharTable = buildTable(data.lang, data.setName)

const canvas = document.getElementById('c') as HTMLCanvasElement
const renderer = new Renderer(canvas)
renderer.setMotion(!data.reducedMotion)
const speech = new Speech(data.lang, data.voices)
const tones = new Tones()
const hud = new Hud()
const scenes = new SceneStack()
/** Null unless ?debug is on the URL — see src/ui/diag.ts. */
const diag = Diag.enabled ? new Diag() : null

let world: World | null = null

const playScr = document.getElementById('playScr') as HTMLElement
const pauseBtn = document.getElementById('pauseBtn') as HTMLElement

// -------------------------------------------------------------------- runs --

interface RunConfig {
  table: CharTable
  mode: Mode
  words: readonly WordEntry[] | null
  reverse: boolean
  /** Voice-only cue: never show the romanization in the seal. */
  earOnly: boolean
  obstacles: ReadonlySet<number> | null
  level: LevelSpec | null
  levelIndex: number
  daily: boolean
  seed?: number
}

/** The run currently being played (or last played, for retry). */
let run: RunConfig | null = null

function endlessRun(): RunConfig {
  return {
    table: buildTable(data.lang, data.setName),
    mode: MODES[data.mode],
    words: null,
    reverse: false,
    earOnly: false,
    obstacles: null,
    level: null,
    levelIndex: -1,
    daily: false,
  }
}

function dailyRun(): RunConfig {
  return {
    ...endlessRun(),
    table: buildTable(data.lang, data.setName),
    mode: MODES.drift,
    daily: true,
    seed: dailySeed(),
  }
}

/** Levels reuse the Mode shape — rules are rules, endless or campaign. */
function levelMode(level: LevelSpec): Mode {
  return {
    id: 'drift', // id is only used by endless persistence; harmless here
    label: level.title,
    blurb: '',
    wrap: level.wrap,
    paceScale: level.paceScale,
    scoreScale: level.kind === 'gauntlet' ? 1.5 : 1,
  }
}

function levelRun(level: LevelSpec, index: number): RunConfig {
  return {
    table: tableFromChars(data.lang, level.chars),
    mode: levelMode(level),
    words: level.words ?? null,
    reverse: level.kind === 'reverse',
    earOnly: level.kind === 'ear',
    obstacles: level.layout ? layoutCells(level.layout) : null,
    level,
    levelIndex: index,
    daily: false,
  }
}

const goalText = (r: RunConfig, w: World): string => {
  if (!r.level) return ''
  const done = r.words ? w.wordsDone : w.eaten
  return `${done}/${r.level.goal.count} · miss ${w.mistakes}/${r.level.goal.maxMisses}`
}

// ------------------------------------------------------------------ scenes --

/**
 * The running game. Owns the world's event subscriptions for its lifetime —
 * created in enter(), disposed in exit(), so a quit run cannot leave handlers
 * firing into dead UI.
 */
function makePlayScene(r: RunConfig): Scene {
  const disposers: Array<() => void> = []

  return {
    name: 'play',
    enter() {
      run = r
      playScr.hidden = false
      pauseBtn.textContent = '‖ pause'
      hud.reset()
      hud.setCueGlyph(r.reverse)
      hud.setWord(null, 0)
      renderer.reset()
      tones.warmup() // we are inside the click that started the run

      const w = new World({
        table: r.table,
        stats: data.stats,
        mode: r.mode,
        ...(r.words ? { words: r.words } : {}),
        ...(r.obstacles ? { obstacles: r.obstacles } : {}),
        reverse: r.reverse,
        ...(r.seed !== undefined ? { seed: r.seed } : {}),
      })
      world = w

      const showCue = (target: string, sound: string) => {
        if (r.reverse) {
          // The glyph IS the question; speaking it would answer a tile.
          hud.setCue(target)
        } else if (r.earOnly) {
          hud.setCue(speech.current ? '♪' : sound)
          speech.speak(target)
        } else {
          hud.setCue(data.showRomaji || !speech.current ? sound : '♪')
          speech.speak(target)
        }
        hud.pulseSeal()
      }

      // Subscriptions land before reset(): reset emits the first 'spawned'.
      disposers.push(
        w.events.on('spawned', ({ target, sound }) => {
          showCue(target, sound)
          if (r.words && w.word) hud.setWord(w.word.w, 0)
          hud.setGoal(goalText(r, w))
        }),

        w.events.on('moved', () => diag?.move(w.interval)),

        w.events.on('wordProgress', ({ entry, index }) => {
          hud.setWord(entry.w, index)
        }),

        w.events.on('wordDone', ({ entry }) => {
          hud.setWord(entry.w, entry.w.length)
          const head = w.snake[0]
          if (head) {
            const cx = head.x * CELL + CELL / 2
            const cy = head.y * CELL + CELL / 2
            renderer.fx.text(cx, cy - 26, entry.gloss, THEME.gold, 1.4, 20)
          }
          renderer.flash.fire(THEME.jade, 0.1)
          if (r.level && w.wordsDone >= r.level.goal.count) {
            finishLevel(r, w, true)
          }
        }),

        w.events.on('eat', ({ item, award, streak, score }) => {
          const c = renderer.centerOf(item)
          const wasMult = comboMultiplier(streak - 1)
          const isMult = comboMultiplier(streak)

          hud.setScore(score)
          hud.setStreak(streak)
          hud.setGoal(goalText(r, w))
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
          // Chapter-style goals count correct eats.
          if (r.level && !r.words && w.eaten >= r.level.goal.count) {
            finishLevel(r, w, true)
          }
        }),

        w.events.on('wrong', ({ item, target, targetSound }) => {
          const c = renderer.centerOf(item)
          hud.setStreak(0)
          hud.setGoal(goalText(r, w))
          renderer.popWrong()
          renderer.camera.addTrauma(JUICE.traumaOnWrong)
          renderer.flash.fire(THEME.shu, 0.18)
          haptic.wrong()
          tones.wrong()
          const v = DIR_VECTORS[w.input.current]
          renderer.fx.ring(c.x, c.y, THEME.shu, JUICE.wrongRingLife)
          renderer.fx.burst(c.x, c.y, THEME.shuSoft, 8, 200, v.x, v.y)
          // The teaching moment: what you bit, and what was wanted.
          renderer.fx.text(
            c.x, c.y,
            `${item.ch} ${r.table[item.ch] ?? ''}`,
            THEME.shu, JUICE.correctionLife,
          )
          if (target && !r.words) {
            renderer.fx.text(
              c.x, c.y + 24,
              `wanted ${target} ${targetSound}`,
              THEME.washi, JUICE.correctionLife, 13,
            )
          }
          if (r.level && w.mistakes > r.level.goal.maxMisses) {
            finishLevel(r, w, false)
          }
        }),

        w.events.on('death', ({ score, eaten }) => {
          renderer.camera.addTrauma(JUICE.traumaOnDeath)
          renderer.flash.fire(THEME.shu, 0.3)
          haptic.death()
          tones.death()

          if (r.level) {
            // Crashing before the goal fails the level, after a beat.
            const timer = setTimeout(() => {
              if (world === w && scenes.has('play') && !scenes.has('levelend')) {
                finishLevel(r, w, false)
              }
            }, 700)
            disposers.push(() => clearTimeout(timer))
            return
          }

          const isRecord = score > data.bestScore
          data.bestScore = Math.max(data.bestScore, score)
          data.bestEaten = Math.max(data.bestEaten, eaten)
          if (r.daily) {
            const today = dateKey()
            if (!data.daily || data.daily.date !== today || score > data.daily.best) {
              data.daily = { date: today, best: score }
            }
          }
          save(data)

          // Let the death sink in before the card. The timer is owned by this
          // scene (cleared on exit) and checks world identity, so quit or
          // restart inside the window cannot race it.
          const timer = setTimeout(() => {
            if (world !== w || !scenes.has('play') || scenes.has('gameover')) return
            while (scenes.top && scenes.top.name !== 'play') scenes.pop()
            scenes.push(makeGameOverScene(isRecord, r))
          }, 700)
          disposers.push(() => clearTimeout(timer))
        }),
      )

      disposers.push(() => w.events.clear())
      diag?.resetRun()
      w.reset()
      loop.resync()
    },

    exit() {
      for (const d of disposers) d()
      world = null
      hud.setGoal('')
      hud.setWord(null, 0)
      hud.setCueGlyph(false)
      playScr.hidden = true
    },

    update(dt) {
      world?.update(dt)
    },

    render(alpha, dt) {
      if (!world) return
      hud.update(dt)
      renderer.update(dt)
      renderer.draw(world, world.renderAlpha(alpha * FIXED_DT), {
        paused: scenes.has('pause'),
        dimmed: scenes.has('gameover') || scenes.has('levelend'),
      })
    },
  }
}

/** Level completion/failure: record progress and bring up the card. */
function finishLevel(r: RunConfig, w: World, cleared: boolean): void {
  if (!r.level || scenes.has('levelend')) return
  const perfect = cleared && w.mistakes === 0
  if (cleared) {
    const prev = data.campaign[r.level.id]
    data.campaign[r.level.id] = {
      cleared: true,
      perfect: perfect || prev?.perfect === true,
    }
    save(data)
  }
  while (scenes.top && scenes.top.name !== 'play') scenes.pop()
  scenes.push(makeLevelEndScene(r, w, cleared, perfect))
}

/**
 * Pause overlay. Draws nothing itself — the play scene below keeps drawing
 * (drawsBelow) and adds the veil when it sees this scene on the stack.
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

function makeChartScene(chartTable: CharTable): Scene {
  return {
    name: 'chart',
    drawsBelow: true,
    enter() {
      chartView.open(data, chartTable)
    },
    exit() {
      chartView.close()
      loop.resync()
    },
  }
}

function makeGameOverScene(isRecord: boolean, r: RunConfig): Scene {
  return {
    name: 'gameover',
    drawsBelow: true,
    enter() {
      const w = world
      if (!w) return
      const missed = [...w.runErrors.entries()]
        .filter(([ch]) => ch in r.table)
        .sort((a, b) => b[1] - a[1])
        .map(([ch]) => ({ ch, sound: r.table[ch] ?? '' }))
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

function makeLevelEndScene(
  r: RunConfig,
  w: World,
  cleared: boolean,
  perfect: boolean,
): Scene {
  return {
    name: 'levelend',
    drawsBelow: true,
    enter() {
      const levels = CAMPAIGNS[data.lang]
      levelEndView.show({
        cleared,
        perfect,
        levelTitle: r.level?.title ?? '',
        detail: cleared
          ? `${w.score} points · ${w.mistakes} ${w.mistakes === 1 ? 'miss' : 'misses'}`
          : w.alive
            ? 'too many misses — study the chart and try again'
            : 'crashed — steady does it',
        hasNext: r.levelIndex >= 0 && r.levelIndex + 1 < levels.length,
      })
    },
    exit() {
      levelEndView.hide()
    },
  }
}

function makeCampaignScene(): Scene {
  return {
    name: 'campaign',
    drawsBelow: true,
    enter() {
      campaignView.open(data)
    },
    exit() {
      campaignView.close()
    },
  }
}

function makeMenuScene(message?: string): Scene {
  return {
    name: 'menu',
    enter() {
      menuView.show(data, message ?? menuResultLine())
    },
    exit() {
      menuView.hide()
    },
  }
}

function menuResultLine(): string {
  const parts: string[] = []
  if (data.bestScore) parts.push(`best ${data.bestScore}`)
  if (data.daily && data.daily.date === dateKey()) {
    parts.push(`daily ${data.daily.best}`)
  }
  return parts.join(' · ')
}

// ------------------------------------------------------------------- views --

const menuView = new MenuView({
  onLang(lang) {
    data.lang = lang
    data.setName = setNamesFor(lang)[0] ?? ''
    table = buildTable(data.lang, data.setName)
    speech.setLanguage(lang)
    speech.warmup()
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
  onPlay() {
    scenes.replaceAll(makePlayScene(endlessRun()))
  },
  onCampaign() {
    scenes.push(makeCampaignScene())
  },
  onDaily() {
    scenes.replaceAll(makePlayScene(dailyRun()))
  },
  onLearn() {
    scenes.push(makeChartScene(table))
  },
})

const campaignView = new CampaignView(
  (level, index) => {
    scenes.replaceAll(makePlayScene(levelRun(level, index)))
  },
  () => {
    if (scenes.top?.name === 'campaign') scenes.pop()
  },
)

const levelEndView = new LevelEndView(
  () => {
    // Next level
    const levels = CAMPAIGNS[data.lang]
    const next = run ? levels[run.levelIndex + 1] : undefined
    if (next && run) {
      scenes.replaceAll(makePlayScene(levelRun(next, run.levelIndex + 1)))
    }
  },
  () => {
    // Retry / replay
    if (run?.level) {
      scenes.replaceAll(makePlayScene(levelRun(run.level, run.levelIndex)))
    }
  },
  () => {
    scenes.replaceAll(makeMenuScene())
    scenes.push(makeCampaignScene())
  },
)

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
      chartView.open(data, run && scenes.has('play') ? run.table : table)
    }
  },
  onVoice(name) {
    speech.choose(name)
    speech.warmup()
    save(data)
    syncVoices()
    if (world?.target && !run?.reverse) speech.speak(world.target)
  },
  onShowRomaji(show) {
    data.showRomaji = show
    hud.setSealHidden(!show && !!speech.current)
    if (world?.target && run && !run.reverse && !run.earOnly) {
      hud.setCue(show || !speech.current ? (run.table[world.target] ?? '—') : '♪')
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
    if (run) scenes.replaceAll(makePlayScene(run.daily ? dailyRun() : endlessRun()))
  },
  () => {
    scenes.replaceAll(makeMenuScene(runSummary()))
  },
  (ch) => speech.speak(ch),
)

function runSummary(): string | undefined {
  return world ? `run: ${world.score} · ${menuResultLine()}` : undefined
}

function syncVoices(): void {
  chartView.setVoices(speech.voices, speech.current, LANGUAGES[data.lang].name)
}

// ------------------------------------------------------------------- input --

bindInput(canvas, {
  onTurn(dir: Dir) {
    if (scenes.top?.name !== 'play') return
    // Never inline this into the diag call: `diag?.turn(world.turn(dir))`
    // short-circuits the ARGUMENT too when diag is off, which silently
    // disabled steering for everyone without the debug flag.
    const accepted = world?.turn(dir) === true
    diag?.turn(accepted)
  },
  onAction(action) {
    const top = scenes.top?.name
    switch (action) {
      case 'replay-cue':
      case 'tap':
        if ((top === 'play' || top === 'pause') && world?.target && !run?.reverse) {
          hud.pulseSeal()
          speech.speak(run?.words && world.word ? world.word.w : world.target)
        }
        break
      case 'pause':
        // Never pause a dead world: the death timeout is about to bring up
        // its card, and a pause pushed in that window would orphan it.
        if (top === 'play' && world?.alive) scenes.push(makePauseScene())
        else if (top === 'pause') scenes.pop()
        break
      case 'learn':
        if (top === 'chart') scenes.pop()
        else if (top === 'pause' || top === 'menu' || (top === 'play' && world?.alive)) {
          scenes.push(makeChartScene(run && scenes.has('play') ? run.table : table))
        }
        break
      case 'escape':
        if (top === 'chart' || top === 'pause' || top === 'campaign') scenes.pop()
        else if (top === 'play' && world?.alive) scenes.push(makePauseScene())
        break
    }
  },
  onRawInput: () => diag?.input(),
  isBlocked: () => {
    // 'pause' stays unblocked so space/tap can replay the cue — a paused
    // screen is exactly where a learner studies the sound. Turns are still
    // gated per-action above.
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
  if (!scenes.has('play')) return
  const fromLevel = !!run?.level
  const summary = runSummary()
  scenes.replaceAll(makeMenuScene(fromLevel ? undefined : summary))
  if (fromLevel) scenes.push(makeCampaignScene())
})

document.getElementById('seal')?.addEventListener('click', () => {
  if (world?.target && !run?.reverse) {
    hud.pulseSeal()
    speech.speak(run?.words && world.word ? world.word.w : world.target)
  }
})

// Auto-pause when the tab loses focus. A game the player is not looking at
// must not keep killing them.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (scenes.top?.name === 'play' && world?.alive) scenes.push(makePauseScene())
    saveNow(data)
    // The OS may unload the TTS voice while we're hidden; re-prime it on the
    // first gesture after coming back so the reload happens behind the pause
    // screen, not on the next cue mid-run.
    speech.chill()
    armSpeechWarmup()
  }
})
addEventListener('pagehide', () => saveNow(data))

speech.onVoicesChanged = () => {
  syncVoices()
  // Voice lists arrive asynchronously (Chrome can take hundreds of ms). If a
  // gesture already happened, warm the engine now — warmup un-latches itself
  // on refusal, so calling early costs nothing.
  speech.warmup()
}

/**
 * Prime the TTS engine on the first gesture anywhere, so the voice loads
 * while the player is still reading the menu — not mid-run on the first cue.
 * pointerUP and keydown, deliberately: those are the events that actually
 * grant user activation for touch and keyboard (pointerdown does not for
 * touch, which left iOS silently unprimed). One armed pair at a time; fired
 * or not, the pair cleans itself up before the next arming.
 */
let warmupArmed = false
function armSpeechWarmup(): void {
  if (warmupArmed) return
  warmupArmed = true
  const fire = () => {
    warmupArmed = false
    removeEventListener('pointerup', fire, true)
    removeEventListener('keydown', fire, true)
    speech.warmup()
  }
  addEventListener('pointerup', fire, { once: true, capture: true })
  addEventListener('keydown', fire, { once: true, capture: true })
}
armSpeechWarmup()

// -------------------------------------------------------------------- loop --

const loop = new GameLoop({
  update(dt) {
    scenes.update(dt)
  },
  render(alpha, dt) {
    scenes.render(alpha, dt)
    diag?.frame(dt)
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
    get: () => ({ world, scenes, data, run }),
  })
}
