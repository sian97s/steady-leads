#!/bin/bash
# Daily job: ingest every source, then refresh lead scores. Run by the systemd timer.
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
"$PY" engine/ingest.py "$@"; rc=$?
node src/rescore.js || rc=1
exit $rc
