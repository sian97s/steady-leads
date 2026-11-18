#!/bin/bash
# One-time local validation run of the MERGED engine (all 22 sources, live), then rescoring and tests.
# Usage: bash ~/Desktop/LeadYaRd/app/bin/first_run.sh
set -u
cd "$(dirname "$0")/.."
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
python3 -m venv .venv && .venv/bin/pip install -q -r engine/requirements.txt pytest
npm install --no-audit --no-fund > data/npm_install.log 2>&1 || echo "npm install failed - see data/npm_install.log"
# Geocoding is left to the server's first run (1 lookup/second); this run is about validating every source.
.venv/bin/python engine/ingest.py --no-geocode --no-alert-send 2>&1 | tee data/first_run.log
node src/rescore.js 2>&1 | tee -a data/first_run.log
.venv/bin/python -m pytest tests -q -p no:cacheprovider 2>&1 | tail -3 | tee data/tests.log
date > data/FIRST_RUN_DONE
echo; echo "DONE. Tell Claude: first run finished."
