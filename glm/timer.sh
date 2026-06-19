#!/usr/bin/env bash
# Run timing harness for the build task.
#   ./timer.sh start   -> records the start time (run this FIRST, before any work)
#   ./timer.sh end      -> records the end time + elapsed (run this LAST, only when the task is fully done & verified)
# Timestamps are written to ./timing.log in this folder.

set -euo pipefail
cmd="${1:-}"
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log="$dir/timing.log"
now_human="$(date '+%Y-%m-%d %H:%M:%S %z')"
now_epoch="$(date '+%s')"

case "$cmd" in
  start)
    echo "START_HUMAN=$now_human" >> "$log"
    echo "START_EPOCH=$now_epoch" >> "$log"
    echo "Recorded START at $now_human -> $log"
    ;;
  end)
    if ! grep -q '^START_EPOCH=' "$log" 2>/dev/null; then
      echo "ERROR: no START recorded. Run './timer.sh start' before beginning work." >&2
      exit 1
    fi
    start_epoch="$(grep '^START_EPOCH=' "$log" | tail -1 | cut -d= -f2)"
    elapsed=$(( now_epoch - start_epoch ))
    echo "END_HUMAN=$now_human" >> "$log"
    echo "END_EPOCH=$now_epoch" >> "$log"
    echo "ELAPSED_SECONDS=$elapsed" >> "$log"
    printf 'ELAPSED_HUMAN=%dh%02dm%02ds\n' $((elapsed/3600)) $(((elapsed%3600)/60)) $((elapsed%60)) >> "$log"
    echo "Recorded END at $now_human. Elapsed: ${elapsed}s -> $log"
    ;;
  *)
    echo "Usage: ./timer.sh {start|end}" >&2
    exit 1
    ;;
esac
