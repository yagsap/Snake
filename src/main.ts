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
import {
  load,
  recordAnswer,
  save,
  saveNow,
  type SaveData,
} from './core/storage'
import {
  buildTable,
  LANGUAGES,
  numeralValue,
  setNamesFor,
  type CharTable,
} from './data/scripts'
import { BOARD, CELL, JUICE, THEME } from './game/config'
import {
  CAMPAIGNS,
  dailySeed,
  dateKey,
  layoutCells,
  levelChars,
  tableFromChars,
  type LevelSpec,
  type WordEntry,
} from './game/levels'
import { MODES, type Mode } from './game/modes'
import { botTurn } from './game/bot'
import {
  comboMultiplier,
  hitsToMaster,
  isDue,
  isMastered,
  seedKnown,
} from './game/progression'
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
  PlaceView,
  ParentView,
  type WeekSummary,
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
  /** Cue is a spoken keyword and the answer is its first letter. */
  phonics: boolean
  /** Cue is a quantity of dots and the answer is the numeral for it. */
  counting: boolean
  /** Cue is a whole WORD; the child segments it and eats the letters. */
  blending: boolean
  /** Cap on body length; undefined leaves the classic unbounded snake. */
  maxLength?: number
  /** Narrow the board after a miss — see WorldOptions.scaffold. */
  scaffold: boolean
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
    phonics: false,
    counting: false,
    blending: false,
    scaffold: false,
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

/**
 * Which levels are allowed to defeat the player.
 *
 * Only boss levels. A learn level exists to teach a letter, and a child who
 * gets three wrong in a row needs the problem narrowed, not the run taken
 * away — the board already does the narrowing, because a wrongly-bitten tile
 * is removed and not replaced, so five choices become four, then three, then
 * the answer alone. Ending the level on top of that punishes exactly the
 * child the app is for. Misses still cost the star, and the schedule still
 * records every one of them honestly.
 */
const isBoss = (level: LevelSpec): boolean => level.kind === 'gauntlet'

/** Body cap for learn levels — see WorldOptions.maxLength. */
const LEARN_MAX_LENGTH = 8

/** Levels reuse the Mode shape — rules are rules, endless or campaign. */
function levelMode(level: LevelSpec): Mode {
  return {
    id: 'drift', // id is only used by endless persistence; harmless here
    label: level.title,
    blurb: '',
    paceScale: level.paceScale,
    scoreScale: level.kind === 'gauntlet' ? 1.5 : 1,
  }
}

function levelRun(level: LevelSpec, index: number): RunConfig {
  return {
    table: level.table ?? tableFromChars(data.lang, level.chars),
    mode: levelMode(level),
    ...(isBoss(level) ? {} : { maxLength: LEARN_MAX_LENGTH }),
    scaffold: !isBoss(level),
    words: level.words ?? null,
    reverse: level.kind === 'reverse',
    earOnly: level.kind === 'ear',
    phonics: level.kind === 'phonics',
    counting: level.kind === 'count',
    blending: level.kind === 'blend',
    // Stones are a boss-level hazard. In a learn level they are one more way
    // to lose that has nothing to do with reading a character.
    obstacles: level.layout && isBoss(level) ? layoutCells(level.layout) : null,
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

/** Characters in the current focus, and how they stand. */
function focusStats(): {
  total: number
  mastered: number
  due: number
  fresh: number
} {
  const t = buildTable(data.lang, data.setName)
  const chars = Object.keys(t)
  const now = Date.now()
  let mastered = 0
  let due = 0
  let fresh = 0
  for (const c of chars) {
    const s = data.stats[c]
    if (s && isMastered(s)) mastered++
    // "Due" means a character ALREADY MET that has fallen due — never-seen
    // ones are counted separately. Conflating the two made every character
    // due on day one, which read as a 71-item review backlog before the
    // player had seen a single one.
    if (!s || s.box === undefined) fresh++
    else if (isDue(s, now)) due++
  }
  return { total: chars.length, mastered, due, fresh }
}

/** How many overdue reviews justify interrupting the ladder for a drill. */
const REVIEW_THRESHOLD = 6

/** The next level the player has not cleared, or -1 when the ladder is done. */
function nextLevelIndex(): number {
  return CAMPAIGNS[data.lang].findIndex((l) => !data.campaign[l.id]?.cleared)
}

/**
 * The one button. A player who opens the app has one sensible next move,
 * and the app should know what it is: clear the review queue if anything is
 * due, otherwise carry on down the campaign, otherwise just play. Making the
 * player choose between Levels, Endless and Daily before every session is
 * how sessions get postponed.
 */
function continueRun(): void {
  const levels = CAMPAIGNS[data.lang]
  const next = nextLevelIndex()
  const { due } = focusStats()
  /**
   * THE LADDER IS THE DEFAULT. A learner climbs it a row at a time — first
   * the vowels, then the k row, then a boss made of the lookalikes among
   * them — and that structure is the product. Review only interrupts it once
   * a real backlog of already-learned characters has fallen due; the earlier
   * version treated never-seen characters as "due" and therefore sent every
   * new player to endless mode, leaving the ladder unreachable.
   */
  if (due >= REVIEW_THRESHOLD) {
    startRun(endlessRun())
    return
  }
  if (next >= 0) startRun(levelRun(levels[next] as LevelSpec, next))
  else startRun(endlessRun())
}

const goalText = (r: RunConfig, w: World): string => {
  if (!r.level) return ''
  const done = r.words ? w.wordsDone : w.eaten
  const goal = `${done}/${r.level.goal.count}`
  // The miss budget is only enforced on boss levels now. Showing "miss 4/3" on
  // a level that cannot be failed advertises a rule that is not running, and
  // tells a child they have already lost something they have not.
  if (!isBoss(r.level)) return goal
  return `${goal} · miss ${w.mistakes}/${r.level.goal.maxMisses}`
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
      tones.startMusic()

      const w = new World({
        table: r.table,
        stats: data.stats,
        mode: r.mode,
        ...(r.words ? { words: r.words } : {}),
        ...(r.obstacles ? { obstacles: r.obstacles } : {}),
        ...(r.maxLength !== undefined ? { maxLength: r.maxLength } : {}),
        scaffold: r.scaffold,
        reverse: r.reverse,
        ...(r.seed !== undefined ? { seed: r.seed } : {}),
        // The daily is the same test for everyone: selection must not read
        // this player's history. (It is still recorded — see WorldOptions.)
        ...(r.daily ? { neutral: true } : {}),
      })
      world = w

      const showCue = (target: string, sound: string) => {
        diag?.mark('cue')
        tones.duck()
        if (r.blending && w.word) {
          /**
           * Blending. The child hears the whole word and has to break it into
           * sounds themselves — which is the act of reading, and the reason
           * this cue speaks the word rather than the letter it currently
           * wants. The board already holds the word's letters and the target
           * walks through them, so one cue covers the whole word.
           */
          hud.setCue(w.word.w)
          speech.speak(w.word.w)
        } else if (r.counting) {
          /**
           * A quantity, not a word. Silent on purpose: speaking "three" and
           * asking for 三 is one more listening task, where showing three dots
           * and asking for 三 is subitizing — the actual early-maths skill,
           * and the only cue in the game a child can answer without hearing
           * anything at all.
           */
          const n = numeralValue(data.lang, target)
          if (n === null) hud.setCue(sound)
          else hud.setCueDots(n)
        } else if (r.phonics) {
          /**
           * Phonics: the cue is a WORD, and the child eats the letter it
           * starts with. The word is spoken and also shown — a child who
           * cannot read yet is working from the sound anyway, and one who can
           * gets the letter-to-word link that is the whole lesson. Unlike the
           * other cues this speaks `sound`, not the glyph: saying "A" gives
           * the letter's NAME, which is the thing phonics exists to replace.
           */
          hud.setCue(sound)
          speech.speak(sound)
        } else if (r.reverse) {
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
          renderer.sprites.cheer(c.x, c.y)
          renderer.cheerItems()
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
          // A parent's only real question is whether this is being used and
          // whether it is working; nothing recorded WHEN anything happened.
          recordAnswer(data, dateKey(), item.ch, true)
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
          // The eaten character itself is thrown clear — the reward is the
          // glyph, so the glyph is what the eye gets to follow.
          renderer.fx.glyphPop(
            c.x, c.y,
            run?.reverse ? w.soundOf(item.ch) || item.ch : item.ch,
            THEME.washi, CELL * 0.7, v.x, v.y,
          )
          renderer.shock(c.x, c.y, CELL * 0.5)
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
          recordAnswer(data, dateKey(), target || item.ch, false)
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
          renderer.fx.glyphPop(
            c.x, c.y, item.ch, THEME.shuSoft, CELL * 0.62, -v.x, -v.y,
          )
          // A miss hits harder than a hit: the whole board flinches.
          renderer.shock(c.x, c.y, CELL * 0.85)
          renderer.fx.ring(c.x, c.y, THEME.shu, JUICE.wrongRingLife)
          renderer.fx.burst(c.x, c.y, THEME.shuSoft, 8, 200, v.x, v.y)
          // The teaching moment: what you bit, and what was wanted.
          renderer.fx.text(
            c.x, c.y,
            `${item.ch} ${r.table[item.ch] ?? ''}`,
            THEME.shu, JUICE.correctionLife,
          )
          if (target && !r.words) {
            /**
             * Point at the character that was wanted, where it actually sits.
             * The old correction printed "wanted さ" beside the tile the
             * player bit by mistake — which puts the answer in the one place
             * on the board their eye should NOT be learning to associate it
             * with. Now the real さ rears up and waves across the board, with
             * its sound alongside it, so the correction attaches to the shape.
             */
            const want = w.items.find((i) => i.ch === target)
            if (want) {
              const wc = renderer.centerOf(want)
              renderer.callOut(want.x, want.y)
              renderer.fx.text(
                wc.x, wc.y + CELL * 0.85,
                `${target} ${targetSound}`,
                THEME.washi, JUICE.correctionLife, 15,
              )
            } else {
              renderer.fx.text(
                c.x, c.y + 24,
                `wanted ${target} ${targetSound}`,
                THEME.washi, JUICE.correctionLife, 13,
              )
            }
          }
          if (r.level && isBoss(r.level) && w.mistakes > r.level.goal.maxMisses) {
            finishLevel(r, w, false)
          }
        }),

        w.events.on('death', ({ score, eaten }) => {
          const head = w.snake[0]
          if (head) {
            renderer.sprites.panic(
              head.x * CELL + CELL / 2,
              head.y * CELL + CELL / 2,
            )
          }
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

    },

    exit() {
      for (const d of disposers) d()
      tones.stopMusic()
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
        /**
         * One short line, in words a five-year-old hears every day. The old
         * copy — "too many misses — study the chart and try again" — is a
         * sentence written for the developer: it names a screen the child
         * cannot find and tells them to study. The card also speaks itself,
         * because the child this is addressed to cannot read it.
         */
        detail: cleared
          ? `${w.score} points`
          : w.alive
            ? 'Nearly! Have another go.'
            : 'Oops, you bumped into yourself.',
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
  let firstEver = false
  return {
    name: 'ready',
    drawsBelow: true,
    enter() {
      firstEver = Object.keys(data.stats).length === 0
      // The one-line tutorial, shown only before anyone's very first bite.
      if (firstEver) {
        renderer.fx.text(
          BOARD.size / 2, CELL * 2,
          'eat the character you hear', THEME.gold,
          JUICE.readySeconds + 1, 18,
        )
      }
    },
    exit() {
      // The steering hint belongs to the moment the snake actually MOVES.
      // Fired from play.enter it burned most of its life behind a frozen
      // countdown — the first-ever player read it while nothing could move,
      // then lost it a second into the only part where it applies.
      if (firstEver) {
        renderer.fx.text(
          BOARD.size / 2, BOARD.size * 0.72,
          'drag anywhere to steer', THEME.washi, 3.5, 17,
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
      if (left <= 0) skipReady(false)
    },
  }
}

/**
 * End the countdown and let the run begin. `impatient` marks the tap path:
 * the numeral on screen is still fading at the very point "go" would land,
 * so the tap gets the sound without the pile-up. On natural expiry the last
 * numeral has already died and "go" lands on a clear board.
 */
function skipReady(impatient: boolean): void {
  if (scenes.top?.name !== 'ready') return
  scenes.pop()
  goJuice(!impatient)
}

/** The "go" beat that releases a run into motion. */
function goJuice(withText = true): void {
  if (withText) {
    renderer.fx.text(BOARD.size / 2, BOARD.size / 2, 'go', THEME.jadeBright, 0.5, 44)
  }
  tones.go()
}

/** Every fresh start runs through here: play scene plus the countdown. */
function startRun(r: RunConfig): void {
  scenes.replaceAll(makePlayScene(r))
  scenes.push(makeReadyScene())
}

/**
 * Step two of onboarding: mark what you already read. Seeded characters go in
 * one rung below mastery — a claim the schedule will make them confirm in a
 * week — so a returning learner is never asked to prove ん on day one, but
 * nothing is taken purely on trust either.
 */
function makePlaceScene(): Scene {
  return {
    name: 'place',
    enter() {
      placeView.open(buildTable(data.lang, data.setName), data.lang)
    },
    exit() {
      placeView.close()
    },
  }
}

function makeMenuScene(message?: string): Scene {
  return {
    name: 'menu',
    enter() {
      menuView.show(data, message ?? menuResultLine())
      const f = focusStats()
      const ni = nextLevelIndex()
      const nl = ni >= 0 ? CAMPAIGNS[data.lang][ni] : undefined
      menuView.renderFocus(data, {
        total: f.total,
        mastered: f.mastered,
        due: f.due,
        reviewThreshold: REVIEW_THRESHOLD,
        next: nl
          ? {
              index: ni,
              title: nl.title,
              // Only the NEW characters here: the focus card is a promise
              // about what you are about to learn, not an inventory.
              chars: levelChars(data.lang, ni).fresh.slice(0, 8).join(''),
            }
          : null,
      })
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
  onContinue() {
    continueRun()
  },
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
  scenes.replaceAll(makePlaceScene())
})

const placeView = new PlaceView((known) => {
  const now = Date.now()
  for (const ch of known) {
    const s = data.stats[ch] ?? { ok: 0, err: 0 }
    seedKnown(s, now)
    data.stats[ch] = s
  }
  data.focus = { lang: data.lang, setName: data.setName, startedAt: now }
  save(data)
  const first = CAMPAIGNS[data.lang][0]
  if (first) startRun(levelRun(first, 0))
  else startRun(endlessRun())
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
// The end card speaks itself — see LevelEndView.speak.
levelEndView.speak = (t) => speech.sayUI(t)

const parentView = new ParentView(
  () => {
    if (scenes.top?.name === 'parent') scenes.pop()
  },
  () => resetProgress(),
)

const chartView = new ChartView({
  onSpeak: (ch) => speech.speak(ch),
  onParent() {
    if (!scenes.has('parent')) scenes.push(makeParentScene())
  },
  onClose() {
    if (scenes.top?.name === 'chart') scenes.pop()
  },
  onReset: () => resetProgress(),
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
  onMusic(on) {
    data.music = on
    tones.musicOn = on
    if (on) tones.startMusic()
    else tones.stopMusic()
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

/**
 * The last seven days of practice, assembled for the parent corner.
 *
 * "Practised" counts DISTINCT characters, not answers: forty attempts at the
 * same letter is not forty letters, and a parent reading this deserves the
 * honest number. Confusions come from the pairs the child actually mixed up,
 * which the game has been recording all along for its own spawn logic and has
 * never shown to anyone.
 */
function weekSummary(): WeekSummary {
  const perDay: number[] = []
  const labels: string[] = []
  const chars = new Set<string>()
  let correct = 0
  let wrong = 0
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const log = data.history[dateKey(d)]
    perDay.push(log ? log.correct + log.wrong : 0)
    labels.push('SMTWTFS'[d.getDay()] as string)
    if (!log) continue
    correct += log.correct
    wrong += log.wrong
    for (const c of log.chars) chars.add(c)
  }

  // Only pairs where BOTH characters belong to what is being learned now —
  // a Greek confusion is not useful to a parent looking at hiragana.
  const table = buildTable(data.lang, data.setName)
  const pairs: Array<{ a: string; b: string; n: number }> = []
  for (const [ch, stat] of Object.entries(data.stats)) {
    if (!(ch in table) || !stat.confused) continue
    for (const [other, n] of Object.entries(stat.confused)) {
      if (!(other in table) || n < 2) continue
      // Deduplicate: a/b and b/a are one confusion, not two.
      if (pairs.some((p) => p.a === other && p.b === ch)) continue
      pairs.push({ a: ch, b: other, n })
    }
  }
  pairs.sort((x, y) => y.n - x.n)

  return { practiced: chars.size, correct, wrong, perDay, labels, confusions: pairs }
}

/**
 * Clear this language's progress. Reached only from the parent corner, and
 * only after a hold — twice, since the door is gated too.
 */
function resetProgress(): void {
  if (!confirm(`Clear your ${LANGUAGES[data.lang].name} progress?`)) return
  // Every set of the language, not just the visible table — the confirm names
  // the language, so that is what gets cleared.
  for (const set of Object.values(LANGUAGES[data.lang].sets)) {
    for (const ch of Object.keys(set)) delete data.stats[ch]
  }
  save(data)
  if (scenes.top?.name === 'parent') parentView.open(weekSummary())
  if (scenes.has('chart')) {
    const table = buildTable(data.lang, data.setName)
    chartView.open(data, run && scenes.has('play') ? run.table : table)
  }
}

function makeParentScene(): Scene {
  return {
    name: 'parent',
    drawsBelow: true,
    enter() {
      parentView.open(weekSummary())
    },
    exit() {
      parentView.close()
    },
  }
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
          skipReady(true)
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
        // 'ready' counts as play here: the countdown leaves a fully visible,
        // correctly-labelled pause button on screen, and a control that is
        // enabled but inert is worse than one that is absent.
        if ((top === 'play' || top === 'ready') && world?.alive) {
          scenes.push(makePauseScene())
        } else if (top === 'pause') scenes.pop()
        break
      case 'learn':
        if (top === 'chart') scenes.pop()
        else if (
          top === 'pause' ||
          top === 'menu' ||
          ((top === 'play' || top === 'ready') && world?.alive)
        ) {
          scenes.push(makeChartScene(run && scenes.has('play') ? run.table : table))
        }
        break
      case 'escape':
        if (top === 'chart' || top === 'pause' || top === 'campaign') scenes.pop()
        else if ((top === 'play' || top === 'ready') && world?.alive) {
          scenes.push(makePauseScene())
        }
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
  if ((top === 'play' || top === 'ready') && world?.alive) {
    scenes.push(makePauseScene())
  } else if (top === 'pause') scenes.pop()
  // Never leave the button focused: bindInput deliberately lets a focused
  // BUTTON keep Space and Enter, so a lingering focus here silently kills
  // the taught replay-the-cue key for the rest of the run.
  pauseBtn.blur()
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
    // 'ready' too: rAF suspends while hidden so the countdown does NOT
    // expire, and without this the player returned to ~1s of clock and a
    // snake moving a heartbeat later, with pause unreachable until it ran
    // out. Pausing over the countdown resumes it deliberately instead.
    const top = scenes.top?.name
    if ((top === 'play' || top === 'ready') && world?.alive) {
      scenes.push(makePauseScene())
    }
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
tones.musicOn = data.music
chartView.syncSettings(data)
hud.setSealHidden(!data.showRomaji && !!speech.current)
syncVoices()
/**
 * Touch anything and it tells you what it is.
 *
 * This app is for children learning to read, and every label on it is
 * written in words they cannot read yet. Rather than pretend otherwise, any
 * control speaks itself when touched — which turns the whole interface into
 * something a pre-reader can explore by ear, and costs one listener.
 *
 * `data-say` overrides the visible text where the visible text would read
 * badly aloud ("All levels · 6/42" is a mouthful; "All levels" is not). The
 * fallback strips the score-ish tail after a middle dot for the same reason.
 * Cue and glyph elements are excluded: they belong to the LESSON, and having
 * the interface voice read the answer in English would hand it over.
 */
function wireSpeakOnTouch(): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        'button, .lvl, .chip, .pill, [data-say]',
      )
      // Never during play. The steering pad is made of buttons, and having
      // the interface announce "up arrow" every time a child steers would be
      // both maddening and a way to talk over the cue they are trying to hear.
      // `.missChip` carries data-say with the LESSON character in it, so the
      // English interface voice would read a kana aloud — the exact case this
      // function excludes elsewhere. Those chips get their own handler below,
      // in the voice of the language being learned.
      if (!el || el.matches('.missChip')) return
      if (el.closest('#seal, .glyph, .chart, #playScr')) return
      const said = el.dataset['say'] ?? el.textContent ?? ''
      speech.sayUI(said.split('·')[0] as string)
    },
    { passive: true },
  )
}
wireSpeakOnTouch()

/**
 * Tapping a missed character on the end card replays it — in the language
 * being learned, which is the whole point of a review chip. Delegated, because
 * the chips are rebuilt with the card every time it opens.
 */
document.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement | null)?.closest<HTMLElement>('.missChip')
  const ch = chip?.dataset['say']
  if (ch) speech.speak(ch)
})

// Read the clip manifest once at boot. It touches no AudioContext, so it is
// safe before a user gesture; absent or empty simply means every cue uses
// speech synthesis, which is the shipping state today.
void speech.clips.load(import.meta.env.BASE_URL)

scenes.push(data.onboarded ? makeMenuScene() : makeOnboardScene())
loop.start()

// Dev-only debug handle: lets tooling (and a curious console) inspect the live
// world. Stripped from production builds — import.meta.env.DEV is compile-time.
if (import.meta.env.DEV) {
  Object.defineProperty(window, '__snake', {
    get: () => ({ world, scenes, data, run, renderer, loop }),
  })
}
