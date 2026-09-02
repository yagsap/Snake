# Alphabet Snake

Snake, but the food is a writing system: a character is spoken aloud, and you
steer onto the glyph that matches it. Wrong bites cost body segments and teach
you the answer. Supports Japanese kana, HSK-1 hanzi, Cyrillic, and Devanagari,
with distractors drawn from visually confusable lookalikes and a light
spaced-repetition bias toward the characters you miss.

## Run it

```
npm install
npm run dev        # dev server
npm run build      # typecheck + production build to dist/
```

Pushing to `main` deploys the web build to GitHub Pages via Actions.

## iOS app

The same build ships as an iOS app through a Capacitor 8 shell in `ios/`
(SPM, no CocoaPods). After any web change: `npm run build && npx cap sync ios`,
then open `ios/App/App.xcodeproj`. Native additions (haptics, TTS fallback,
status bar) live in [src/ui/native.ts](src/ui/native.ts) and no-op on the web.
The full store-submission walkthrough is in [SHIP-IOS.md](SHIP-IOS.md).

## Tests

```sh
npm run dev     # the browser tests need the dev server on :5199
npm test        # simulation suite, then browser suite
```

`tests/sim-test.ts` and `tests/srs-test.ts` are deterministic and need no
browser: they assert the rules that decide whether the game is fair — the body
cap, the miss floor, that every learn level still shows the answer after
twelve deliberate misses, that boss levels refuse to narrow, and the whole
spaced-repetition ladder.

The `.cjs` suites drive the real app through Chrome. They cover the things
only a running app can answer: that a learn level cannot defeat a child, that
the interface speaks itself but stays silent during play, that a counting cue
shows dots and says nothing, that blending cues the whole word, and that the
parent corner is genuinely on screen rather than merely present in the DOM.

## Architecture

The project is deliberately structured to demonstrate core game-development
fundamentals. Each module's header comment explains the *why*; this is the map.

```
src/
  core/            engine — knows nothing about snakes or kana
    loop.ts        fixed-timestep loop with interpolated rendering
    time.ts        frame-rate-independent decay (damp), easings
    input.ts       2-deep direction buffer, device bindings
    scene.ts       stack-based scene machine (menu/play/pause/chart/gameover)
    rng.ts         seeded RNG (mulberry32) — reproducible runs
    events.ts      typed event bus — simulation emits facts, never touches DOM
    storage.ts     validated load, debounced save
  data/
    scripts.ts     character tables, confusable groups (indexed at load)
  game/            simulation — runs headless, no DOM required
    config.ts      every tunable number, named, units stated
    world.ts       the rules: movement, collision, bites, death
    spawn.ts       target selection (error-weighted) + distractor choice
    progression.ts difficulty & reward curves as pure functions
    modes.ts       drift (wrap) / ink (walls) / gale (walls, fast ramp)
  render/          presentation — reads simulation state, never writes it
    renderer.ts    interpolated canvas drawing, glyph metrics cache
    camera.ts      trauma-based screen shake, hit-stop
    fx.ts          particles, rings, score popups, screen flash
    background.ts  seigaiha field baked once to an offscreen canvas
  ui/
    hud.ts         change-detecting DOM writes, animated score count-up
    menus.ts       menu / study chart / game-over views
    audio.ts       speech cues + WebAudio feedback tones
  main.ts          composition root — the only file that knows everyone
```

### The fundamentals, and where to look

| Principle | Where |
|---|---|
| Fixed timestep, render interpolation, spiral-of-death clamp | `core/loop.ts` |
| Frame-rate-independent decay (`damp`, time constants in seconds) | `core/time.ts`, used by `render/camera.ts` |
| Input buffering (fast double-taps don't drop) | `core/input.ts` |
| Scene stack instead of boolean flags | `core/scene.ts`, wired in `main.ts` |
| Simulation/presentation split via events | `game/world.ts` emits; `main.ts` subscribes |
| Deterministic, seedable randomness | `core/rng.ts` |
| All tunables centralized with units | `game/config.ts` |
| Difficulty as a curve, not steps (exponential approach to a floor) | `game/progression.ts` |
| Risk/reward economy (combo multiplier + decaying speed bonus) | `game/progression.ts`, urgency ring in `renderer.ts` |
| Trauma-model screen shake (shake = trauma², smooth noise, rotation) | `render/camera.ts` |
| Hit-stop | `render/camera.ts` + `main.ts` |
| Squash-and-stretch (volume-conserving) | `renderer.ts` `drawHead` |
| Bounded spawn (no unbounded rejection sampling) | `game/spawn.ts` `freeCells` |
| Tail-cell self-collision rule (following your tail is legal) | `game/world.ts` `step` |
| Static art baked to offscreen canvas | `render/background.ts` |
| Text-metrics caching, DOM write avoidance | `renderer.ts`, `ui/hud.ts` |
| Pause on tab hide, debounced+validated persistence | `main.ts`, `core/storage.ts` |
| Accessibility: reduced motion, audio-optional play | `render/*.intensity`, `showRomaji` |

The original single-file prototype is preserved in `prototype/index.html`.
