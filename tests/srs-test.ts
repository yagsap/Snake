/**
 * The spaced-repetition schedule, tested as behaviour rather than assumed:
 * promotion lengthens the gap, a miss brings it back, mastery requires
 * surviving a real gap, and selection prefers what is due.
 */
import {
  demote, isDue, isMastered, overdueBy, promote, seedKnown,
} from '../src/game/progression'
import { chooseTarget } from '../src/game/spawn'
import { Rng } from '../src/core/rng'
import type { CharStat } from '../src/core/storage'

let fails = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} - ${name}`)
  if (!cond) fails++
}
const DAY = 86_400_000
const now = 1_800_000_000_000

// --- promotion lengthens the interval, monotonically ---
const s: CharStat = { ok: 0, err: 0 }
const gaps: number[] = []
let t = now
for (let i = 0; i < 6; i++) {
  promote(s, t)
  gaps.push((s.due as number) - t)
  t = s.due as number
}
ok('six promotions produce six intervals', gaps.length === 6)
ok('intervals strictly increase', gaps.every((g, i) => i === 0 || g > (gaps[i - 1] as number)))
ok('first interval is minutes, not days', (gaps[0] as number) < DAY)
ok('last interval is many weeks', (gaps[5] as number) >= 30 * DAY)
ok('box caps at the top rung', s.box === 5)

// --- a miss demotes and brings it back within the session ---
const before = s.box as number
demote(s, t)
ok('miss demotes one rung', s.box === before - 1)
ok('miss makes it due within minutes', (s.due as number) - t <= 60_000)

// --- due logic ---
ok('unseen character is due', isDue(undefined, now))
ok('character due in the past is due', isDue({ ok: 1, err: 0, box: 1, due: now - 1 }, now))
ok('character due in the future is not', !isDue({ ok: 1, err: 0, box: 1, due: now + DAY }, now))
ok('unseen sorts as maximally overdue', overdueBy(undefined, now) > overdueBy({ ok: 1, err: 0, due: now - 99 * DAY }, now))

// --- mastery now requires surviving a real gap ---
const fresh: CharStat = { ok: 0, err: 0 }
promote(fresh, now)
promote(fresh, now)   // same instant: not due, earns nothing
promote(fresh, now)
promote(fresh, now)
ok('four answers in one session cannot climb the ladder', fresh.box === 0)
ok('cramming a character is NOT mastery', !isMastered(fresh))
// ...but coming back each time it falls due does master it
let ft = now
for (let i = 0; i < 4; i++) {
  ft = (fresh.due as number) + 1
  promote(fresh, ft)
}
ok('returning when due DOES climb the ladder', (fresh.box as number) >= 3)
ok('surviving to the multi-day rung IS mastery', isMastered(fresh))
ok('legacy save with no box still uses the hit rule', isMastered({ ok: 3, err: 0 }))

// --- "I already know this" seeding ---
const known: CharStat = { ok: 0, err: 0 }
seedKnown(known, now)
ok('known char is not due immediately', !isDue(known, now))
ok('known char is not yet claimed as mastered', !isMastered(known))
ok('known char reaches mastery with one confirmed recall', (() => {
  promote(known, now + 7 * DAY)
  return isMastered(known)
})())

// --- selection prefers what is due ---
const table = { あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o' }
const stats: Record<string, CharStat> = {
  あ: { ok: 9, err: 0, box: 5, due: now + 30 * DAY },
  い: { ok: 9, err: 0, box: 5, due: now + 30 * DAY },
  う: { ok: 9, err: 0, box: 5, due: now + 30 * DAY },
  え: { ok: 1, err: 3, box: 0, due: now - 2 * DAY },  // overdue and shaky
  お: { ok: 9, err: 0, box: 5, due: now + 30 * DAY },
}
const picks: Record<string, number> = {}
const rng = new Rng(42)
for (let i = 0; i < 300; i++) {
  const p = chooseTarget(table, stats, rng, null, now)
  if (p) picks[p] = (picks[p] ?? 0) + 1
}
ok('the one due character is chosen every time', picks['え'] === 300)

// with nothing due, it falls back to a sensible spread rather than stalling
const allFuture: Record<string, CharStat> = Object.fromEntries(
  Object.keys(table).map((c) => [c, { ok: 5, err: 0, box: 5, due: now + 30 * DAY }]),
)
const spread = new Set<string>()
for (let i = 0; i < 200; i++) {
  const p = chooseTarget(table, allFuture, rng, null, now)
  if (p) spread.add(p)
}
ok('nothing due still yields a playable spread', spread.size >= 4)

console.log(fails ? `\n${fails} FAILURES` : '\nall good')
process.exit(fails ? 1 : 0)
