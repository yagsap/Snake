#!/bin/bash
# Run the whole suite. The browser tests need the dev server:
#   npm run dev    (port 5199)
# and puppeteer-core, which is resolved from wherever it is installed.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0

echo "== simulation (deterministic, no browser) =="
for t in sim srs; do
  printf '%-12s ' "$t"
  if npx tsx "tests/$t-test.ts" >/tmp/snake-$t.log 2>&1; then echo "ok"
  else echo "FAIL — see /tmp/snake-$t.log"; FAIL=1; fi
done

if ! curl -sf -o /dev/null http://localhost:5199/; then
  echo
  echo "dev server not running on :5199 — skipping browser tests"
  exit $FAIL
fi

echo
echo "== browser =="
for t in feature ladder walls phonics scaffold counting blend audiofirst parent lang; do
  printf '%-12s ' "$t"
  if node "tests/$t-test.cjs" >/tmp/snake-$t.log 2>&1; then echo "ok"
  else echo "FAIL — see /tmp/snake-$t.log"; FAIL=1; fi
done

exit $FAIL
