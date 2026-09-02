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
import { BOARD, CELL, JUICE, THEME } from './game/config'
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
import { botTurn } from './game/bot'
import { comboMultiplier, hitsToMaster, isMastered } from './game/progression'
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
  OnboardView,
} from './ui/menus'
import { haptic, initNativeChrome, isNativeApp } from './ui/native'
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
const diag = Diag.enabled
  ? new Diag({
      onSpeech(on) {
        speech.muted = !on
      },
      onTones(on) {
        tones.enabled = on
      },
      onHaptics(on) {
        haptic.enabled = on
      },
      onFx(on) {
        renderer.setMotion(on && !data.reducedMotion)
      },
    })
  : null

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

/**
 * The learning receipt shown on every end card. Score is the arcade currency;
 * this line is the currency the player actually downloaded the game for —
 * each session must end with proof it moved them toward reading the script.
 */
function runReceipt(w: World): string {
  const practiced = w.runLearned.size
  if (!practiced) return ''
  const parts = [`${practiced} character${practiced === 1 ? '' : 's'} practiced`]
  if (w.runMastered.length) {
    parts.push(`${w.runMastered.slice(0, 4).join(' ')} mastered`)
  }
  const close = [...w.runLearned].filter((ch) => {
    const s = data.stats[ch]
    return s && !isMastered(s) && hitsToMaster(s) <= 2
  }).length
  if (close) parts.push(`${close} close to mastery`)
  // The nemesis line: the pair this run kept mixing up, named as a PAIR.
  // "you missed き" says study き; "you mix up き and さ" says the actual
  // problem — and the spawner is already acting on it (chooseDistractors).
  const nemesis = [...w.runConfused.entries()].sort((a, b) => b[1] - a[1])[0]
  if (nemesis && nemesis[1] >= 2) {
    const [a, b] = nemesis[0].split('→')
    parts.push(`you mix up ${a} and ${b}`)
  }
  return parts.join(' · ')
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
/** Wake ripple colours — THEME.jade as a wash. Trail is barely-there; the
 *  plunk of a landing tile is allowed to be noticed. */
const WAKE_TRAIL = 'rgba(154,209,178,.13)'
const WAKE_PLUNK = 'rgba(154,209,178,.25)'

function makePlayScene(r: RunConfig): Scene {
  const disposers: Array<() => void> = []
  /** Daily runs only: one emoji per bite, the shareable shape of the run. */
  const tape: string[] = []

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
        // The daily is the same test for everyone: selection must not read
        // this player's history. (It is still recorded — see WorldOptions.)
        ...(r.daily ? { neutral: true } : {}),
      })
      world = w

      const showCue = (target: string, sound: string) => {
        diag?.mark('cue')
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
          // Each newly-landed tile plunks into the water.
          for (const it of w.items) {
            renderer.wake.ring(
              it.x * CELL + CELL / 2, it.y * CELL + CELL / 2,
              WAKE_PLUNK, 0.9, CELL * 1.3,
            )
          }
        }),

        w.events.on('moved', () => {
          diag?.move(w.interval)
          // The wake: the cell the head just vacated ripples behind it.
          const p = w.prevSnake[0]
          if (p) {
            renderer.wake.ring(
              p.x * CELL + CELL / 2, p.y * CELL + CELL / 2,
              WAKE_TRAIL, 0.7, CELL * 0.8,
            )
          }
        }),

        // The game's biggest moment: a character joined the player for good.
        w.events.on('mastered', ({ item, ch }) => {
          const c = renderer.centerOf(item)
          haptic.multiplier()
          tones.mastered()
          renderer.flash.fire(THEME.gold, 0.08)
          renderer.fx.ring(c.x, c.y, THEME.gold, 0.8, CELL * 2.2)
          renderer.fx.burst(c.x, c.y, THEME.gold, 14, 260)
          renderer.fx.text(c.x, c.y - 48, `${ch} mastered!`, THEME.gold, 1.8, 22)
        }),

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
          diag?.mark('eat')
          if (r.daily) tape.push('🟩')
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
          if (r.daily) tape.push('🟥')
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
          lastDailyShare = r.daily ? dailyShareText(w, tape) : null
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

      // A brand-new player has never steered before; say how, where they
      // are already looking. One line, gone in seconds, never repeats.
      if (Object.keys(data.stats).length === 0) {
        renderer.fx.text(
          BOARD.size / 2, BOARD.size * 0.68,
          'drag anywhere to steer', THEME.washi, 4, 17,
        )
      }
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

/**
 * Level completion/failure.
 *
 * A CLEAR with a next level flows straight into it after a short on-board
 * celebration — no card, no button. The card interrupted the exact moment a
 * player is most willing to keep going, to ask a question ("next level?")
 * whose answer is almost always yes. Cards remain for the two real decision
 * points: failure (retry or study?) and the end of the campaign.
 */
function finishLevel(r: RunConfig, w: World, cleared: boolean): void {
  if (!r.level || scenes.has('levelend') || scenes.has('levelflow')) return
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
  const levels = CAMPAIGNS[data.lang]
  const next = cleared && r.levelIndex >= 0 ? levels[r.levelIndex + 1] : undefined
  if (cleared && next) {
    scenes.push(makeLevelFlowScene(next, r.levelIndex + 1, perfect))
  } else {
    scenes.push(makeLevelEndScene(r, w, cleared, perfect))
  }
}

/**
 * The moment between levels: the board keeps drawing (the sim stops because
 * this scene is on top), a celebration plays where the player is already
 * looking, and the next level starts itself. Quitting during the window
 * tears the timer down with the scene.
 */
function makeLevelFlowScene(next: LevelSpec, nextIndex: number, perfect: boolean): Scene {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    name: 'levelflow',
    drawsBelow: true,
    enter() {
      const cx = BOARD.size / 2
      tones.mastered()
      haptic.multiplier()
      renderer.flash.fire(perfect ? THEME.gold : THEME.jade, 0.14)
      renderer.fx.ring(cx, cx, perfect ? THEME.gold : THEME.jade, 0.9, CELL * 4)
      renderer.fx.text(cx, cx - 40, perfect ? 'perfect clear!' : 'level clear!', THEME.gold, 1.7, 34)
      renderer.fx.text(cx, cx + 4, `next: ${next.title}`, THEME.washi, 1.7, 16)
      timer = setTimeout(() => {
        if (scenes.top?.name === 'levelflow') {
          scenes.replaceAll(makePlayScene(levelRun(next, nextIndex)))
          goJuice() // after enter(): renderer.reset has run, the text survives
        }
      }, 1700)
    },
    exit() {
      clearTimeout(timer)
    },
  }
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
      // A pause is not a stall; keep the break out of the move timing.
      diag?.resetRun()
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
      diag?.resetRun()
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
        receipt: runReceipt(w),
        share: !!lastDailyShare,
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
        receipt: runReceipt(w),
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

/**
 * First launch only: one question, then straight into level 1. The menu with
 * its seven languages, sets and modes is a fine home screen and a terrible
 * first impression — a new player should be eating their first character,
 * voice speaking, within seconds of opening the app.
 */
function makeOnboardScene(): Scene {
  let demo: World | null = null
  const disposers: Array<() => void> = []
  return {
    name: 'onboard',
    enter() {
      onboardView.open()
      // The attract mode: a real game plays itself behind the language
      // picker. Wordless onboarding — a new player WATCHES the loop happen
      // (tile lands, snake eats the match) while choosing what to learn.
      // Throwaway stats, neutral deck: the demo never touches real data.
      playScr.hidden = false
      playScr.classList.add('demo')
      renderer.reset()
      const w = new World({
        table: buildTable('ja', 'hiragana'),
        stats: {},
        mode: MODES.drift,
        seed: 7,
        neutral: true,
      })
      demo = w
      disposers.push(
        w.events.on('eat', ({ item }) => {
          const c = renderer.centerOf(item)
          renderer.popEat()
          renderer.fx.ring(c.x, c.y, THEME.jade, JUICE.ringLife)
        }),
        w.events.on('moved', () => {
          const p = w.prevSnake[0]
          if (p) {
            renderer.wake.ring(
              p.x * CELL + CELL / 2, p.y * CELL + CELL / 2,
              WAKE_TRAIL, 0.7, CELL * 0.8,
            )
          }
        }),
        // One decision per MOVE, not per tick. At 60Hz against a ~0.24s
        // move the bot re-scored ~14 times per step, and with a random
        // tiebreak it could queue a second, already-stale turn into the
        // 2-deep buffer — the demo snake visibly double-turning at corners.
        w.events.on('moved', () => botTurn(w)),
        w.events.on('death', () => w.reset()),
      )
      w.reset()
      botTurn(w)
    },
    exit() {
      onboardView.close()
      for (const d of disposers) d()
      disposers.length = 0
      demo = null
      playScr.classList.remove('demo')
      playScr.hidden = true
      renderer.reset()
    },
    update(dt) {
      demo?.update(dt)
    },
    render(alpha, dt) {
      if (!demo) return
      renderer.update(dt)
      renderer.draw(demo, demo.renderAlpha(alpha * FIXED_DT), {
        paused: false,
        dimmed: false,
      })
    },
  }
}

/**
 * The fresh-run countdown — reading time, not dead time. The board below is
 * fully laid out and the first cue has already spoken, so the player spends
 * these seconds finding their target instead of waiting. A tap skips; a
 * swipe pre-queues the opening turn. Auto-advance between levels does NOT
 * count down — its celebration beat already covers the gap.
 */
function makeReadyScene(): Scene {
  let left = JUICE.readySeconds
  let shown = Number.POSITIVE_INFINITY
  return {
    name: 'ready',
    drawsBelow: true,
    enter() {
      // The one-line tutorial, shown only before anyone's very first bite.
      if (Object.keys(data.stats).length === 0) {
        renderer.fx.text(
          BOARD.size / 2, CELL * 2,
          'eat the character you hear', THEME.gold,
          JUICE.readySeconds + 1, 18,
        )
      }
    },
    update(dt) {
      left -= dt
      // The tiles must be READABLE while time is frozen — their entry
      // animation runs off item age, which the paused simulation would
      // never advance. Age is presentation state; ticking it here changes
      // nothing the simulation decides.
      if (world) for (const it of world.items) it.age += dt
      const n = Math.ceil(left)
      if (n < shown && n >= 1) {
        shown = n
        renderer.fx.text(BOARD.size / 2, BOARD.size / 2, String(n), THEME.gold, 0.85, 64)
        tones.count()
      }
      if (left <= 0) skipReady()
    },
  }
}

/** End the countdown (naturally or by tap) and let the run begin. */
function skipReady(): void {
  if (scenes.top?.name !== 'ready') return
  scenes.pop()
  goJuice()
}

/** The "go" beat that releases a run into motion. */
function goJuice(): void {
  renderer.fx.text(BOARD.size / 2, BOARD.size / 2, 'go', THEME.jadeBright, 0.5, 44)
  tones.go()
}

/** Every fresh start runs through here: play scene plus the countdown. */
function startRun(r: RunConfig): void {
  scenes.replaceAll(makePlayScene(r))
  scenes.push(makeReadyScene())
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
    startRun(endlessRun())
  },
  onCampaign() {
    scenes.push(makeCampaignScene())
  },
  onDaily() {
    startRun(dailyRun())
  },
  onLearn() {
    scenes.push(makeChartScene(table))
  },
})

const onboardView = new OnboardView((lang) => {
  data.lang = lang
  data.setName = setNamesFor(lang)[0] ?? ''
  data.onboarded = true
  table = buildTable(data.lang, data.setName)
  speech.setLanguage(lang)
  speech.warmup() // we are inside the tap: the voice loads while level 1 opens
  syncVoices()
  save(data)
  const first = CAMPAIGNS[data.lang][0]
  if (first) startRun(levelRun(first, 0))
  else scenes.replaceAll(makeMenuScene())
})

const campaignView = new CampaignView(
  (level, index) => {
    startRun(levelRun(level, index))
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
      startRun(levelRun(next, run.levelIndex + 1))
    }
  },
  () => {
    // Retry / replay
    if (run?.level) {
      startRun(levelRun(run.level, run.levelIndex))
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
  onShowPad(show) {
    data.showPad = show
    applyPadSetting()
    save(data)
  },
})

/** The pad is CSS-gated on a body class so layout reflows with it. */
function applyPadSetting(): void {
  document.body.classList.toggle('show-pad', data.showPad)
}

const gameOverView = new GameOverView(
  () => {
    if (run) startRun(run.daily ? dailyRun() : endlessRun())
  },
  () => {
    scenes.replaceAll(makeMenuScene(runSummary()))
  },
  (ch) => speech.speak(ch),
  () => void shareDailyResult(),
)

/** The finished daily's share text, rebuilt on every daily death. */
let lastDailyShare: string | null = null

/**
 * The shareable receipt of a daily run. Everyone on today's seed faced the
 * SAME questions in the same order (the neutral deck guarantees it), which
 * is what makes the numbers comparable and the tape worth reading — the
 * Wordle contract, honoured for real.
 */
function dailyShareText(w: World, tape: readonly string[]): string {
  const rows: string[] = []
  for (let i = 0; i < tape.length && i < 30; i += 10) {
    rows.push(tape.slice(i, i + 10).join(''))
  }
  if (tape.length > 30) rows.push(`… ${tape.length} bites in all`)
  return [
    `Script Snake daily · ${dateKey()}`,
    `${LANGUAGES[data.lang].name} ${data.setName} · ${w.score} pts · ` +
      `${w.eaten} eaten · best streak ${w.bestStreak}`,
    ...rows,
    'https://yagsap.github.io/Snake/',
  ].join('\n')
}

/**
 * navigator.share where the OS puts up a sheet — the sheet is its own
 * feedback, and the user dismissing it is an answer, not an error. Clipboard
 * on desktop, with the button relabelled as the confirmation.
 */
async function shareDailyResult(): Promise<void> {
  const text = lastDailyShare
  if (!text) return
  if (navigator.share) {
    try {
      await navigator.share({ text })
    } catch {
      /* sheet dismissed */
    }
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    gameOverView.noteShared('copied ✓')
  } catch {
    /* no clipboard either — leave the button as it is */
  }
}

function runSummary(): string | undefined {
  return world ? `run: ${world.score} · ${menuResultLine()}` : undefined
}

function syncVoices(): void {
  chartView.setVoices(speech.voices, speech.current, LANGUAGES[data.lang].name)
}

// ------------------------------------------------------------------- input --

// The steering surface is the WHOLE play screen, not just the canvas: the
// space under the board is a thumb zone — steer from there and no finger
// ever covers a character.
bindInput(playScr, {
  onTurn(dir: Dir) {
    const top = scenes.top?.name
    if (top !== 'play' && top !== 'ready') return
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
        // A TAP skips the countdown; SPACE does not. Space is the established
        // replay-the-cue binding, and reading time is exactly when a player
        // wants to hear the target again — launching the run instead would
        // punish the keyboard player for using the key as taught.
        if (top === 'ready' && action === 'tap') {
          skipReady()
          break
        }
        if (
          (top === 'play' || top === 'pause' || top === 'ready') &&
          world?.target &&
          !run?.reverse
        ) {
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
  onDrag(phase, x, y, dir) {
    const glow = document.getElementById('dragGlow')
    const kick = glow?.firstElementChild as HTMLElement | null
    if (!glow || !kick) return
    if (phase === 'end') {
      glow.classList.remove('on')
      return
    }
    glow.style.left = `${x}px`
    glow.style.top = `${y}px`
    glow.classList.add('on')
    if (phase === 'turn' && dir) {
      const v = DIR_VECTORS[dir]
      kick.style.transform = `translate(${v.x * 12}px, ${v.y * 12}px) scale(.8)`
      setTimeout(() => {
        kick.style.transform = 'scale(.55)'
      }, 90)
    }
  },
  isBlocked: () => {
    // 'pause' stays unblocked so space/tap can replay the cue — a paused
    // screen is exactly where a learner studies the sound. Turns are still
    // gated per-action above.
    const top = scenes.top?.name
    return top !== 'play' && top !== 'pause' && top !== 'ready'
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
// The native synthesizer has no user-activation requirement, so it can be
// primed at boot rather than waiting for the first tap.
if (isNativeApp) speech.warmup()

// -------------------------------------------------------------------- loop --

/** Start of our work this frame — update may run 0..N times before render. */
let frameT0 = 0
const loop = new GameLoop({
  update(dt) {
    if (diag && !frameT0) frameT0 = performance.now()
    scenes.update(dt)
  },
  render(alpha, dt) {
    if (diag && !frameT0) frameT0 = performance.now()
    scenes.render(alpha, dt)
    diag?.frame(frameT0)
    frameT0 = 0
  },
})

initNativeChrome()
applyPadSetting()
chartView.syncSettings(data)
hud.setSealHidden(!data.showRomaji && !!speech.current)
syncVoices()
scenes.push(data.onboarded ? makeMenuScene() : makeOnboardScene())
loop.start()

// Dev-only debug handle: lets tooling (and a curious console) inspect the live
// world. Stripped from production builds — import.meta.env.DEV is compile-time.
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__snake', {
    get: () => ({ world, scenes, data, run }),
  })
}
