#!/usr/bin/env bash
# Run the full headless validation suite (requires `npm install` for playwright).
# Starts a static server, runs all checks, tears down.
set -e
cd "$(dirname "$0")/.."
python3 -m http.server 8000 >/tmp/tsu_httpd.log 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null" EXIT
sleep 1
echo "=== validate.js (7 DoD items + render/error checks) ==="
node test/validate.js
echo
echo "=== traverse.js (level is completable end-to-end) ==="
node test/traverse.js
echo
echo "=== animcheck2.js (character animation drives skeleton) ==="
node test/animcheck2.js
echo
echo "=== springtest.js (spring launches to high platform) ==="
node test/springtest.js
echo
echo "ALL TESTS PASSED"