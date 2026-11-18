#!/bin/bash
# Run on your Mac:  bash deploy/deploy.sh root@YOUR.VPS.IP your.domain.com you@email.com
# Copies the app + database to /opt/leadyard on the VPS and sets up HTTPS (Caddy), the web service,
# and the daily ingestion timer. Without a domain it uses https://<ip>.sslip.io (free, real certificate).
set -euo pipefail
TARGET="${1:?usage: deploy.sh user@host [domain] [admin-email]}"; IP="${TARGET#*@}"
HOST="${2:-$(echo "$IP" | tr . -).sslip.io}"
cd "$(dirname "$0")/.."
[ -f data/leadyard.db ] && python3 - <<'PY'
import sqlite3; c = sqlite3.connect("data/leadyard.db"); c.execute("PRAGMA wal_checkpoint(TRUNCATE)"); c.close()
PY
ssh "$TARGET" 'mkdir -p /opt/leadyard/data'
# Never overwrite a live server database with the local copy (pipeline notes live there).
DBX=""; ssh "$TARGET" 'test -f /opt/leadyard/data/leadyard.db' && DBX="--exclude data/leadyard.db --exclude data/pdf_seen.json --exclude data/geocode_cache.json" && echo "Server already has a database: keeping it."
rsync -az --info=progress2 --exclude node_modules --exclude .venv --exclude .env --exclude '__pycache__' --exclude '.pytest_cache' \
  --exclude 'data/*.db-wal' --exclude 'data/*.db-shm' --exclude data/.ingest.lock $DBX ./ "$TARGET:/opt/leadyard/"
ssh "$TARGET" "bash /opt/leadyard/deploy/remote_setup.sh '$HOST' '${3:-}'"
