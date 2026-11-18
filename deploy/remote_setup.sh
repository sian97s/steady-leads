#!/bin/bash
# Runs ON the VPS (Ubuntu/Debian, as root). Idempotent. Usage: remote_setup.sh <hostname-for-https> <admin-email>
set -euo pipefail
HOST="$1"; ADMIN="${2:-}"; APP=/opt/leadyard
export DEBIAN_FRONTEND=noninteractive

# Refuse to fight another web server for ports 80/443.
if ! command -v caddy >/dev/null && ss -ltnH 'sport = :80 or sport = :443' | grep -q .; then
  echo "STOP: something else already listens on port 80/443 on this server:"; ss -ltnp 'sport = :80 or sport = :443'
  echo "Leadyard is installed at $APP and can run on 127.0.0.1:3000, but HTTPS was NOT set up. Point your existing proxy at 127.0.0.1:3000 or free the ports, then re-run."
  NO_CADDY=1
fi

apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip build-essential curl ca-certificates sqlite3 >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
if [ -z "${NO_CADDY:-}" ] && ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

id leadyard >/dev/null 2>&1 || useradd --system --home $APP --shell /usr/sbin/nologin leadyard
cd $APP
python3 -m venv .venv && .venv/bin/pip install -q -r engine/requirements.txt
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
chmod +x bin/daily.sh

if [ ! -f .env ]; then
  TOPIC=leadyard-$(head -c 12 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 14)
  cat > .env <<ENV
PORT=3000
HOST=127.0.0.1
# Source alerts (zero rows / failed / stale). Push via ntfy: subscribe to this topic in the ntfy app or https://ntfy.sh/$TOPIC
ALERT_WEBHOOK=https://ntfy.sh/$TOPIC
# Optional email alerts:
#ALERT_EMAIL_TO=
#SMTP_HOST=
#SMTP_PORT=587
#SMTP_USER=
#SMTP_PASS=
ENV
  chmod 600 .env
fi
sed -i '/^APP_PASSWORD=/d' .env
chown -R leadyard:leadyard $APP
ADMIN_NOTE="(no admin email given: create one with  cd $APP && sudo -u leadyard node src/users.js add you@example.com --admin)"
[ -n "$ADMIN" ] && ADMIN_NOTE=$(sudo -u leadyard node src/users.js add "$ADMIN" --admin)

cat > /etc/systemd/system/leadyard.service <<UNIT
[Unit]
Description=Leadyard web app
After=network.target
[Service]
User=leadyard
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/leadyard-ingest.service <<UNIT
[Unit]
Description=Leadyard daily permit ingestion
After=network-online.target
[Service]
Type=oneshot
User=leadyard
WorkingDirectory=$APP
ExecStart=$APP/bin/daily.sh
TimeoutStartSec=3h
UNIT
cat > /etc/systemd/system/leadyard-ingest.timer <<UNIT
[Unit]
Description=Run Leadyard ingestion daily at 05:30 Pacific
[Timer]
OnCalendar=*-*-* 05:30:00 America/Vancouver
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now leadyard.service leadyard-ingest.timer >/dev/null
systemctl restart leadyard.service

if [ -z "${NO_CADDY:-}" ]; then
  if ! grep -q "$HOST" /etc/caddy/Caddyfile 2>/dev/null; then
    grep -q "reverse_proxy" /etc/caddy/Caddyfile 2>/dev/null && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%s) || : > /etc/caddy/Caddyfile
    printf '\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:3000\n}\n' "$HOST" >> /etc/caddy/Caddyfile
  fi
  systemctl enable caddy >/dev/null 2>&1; systemctl reload caddy || systemctl restart caddy
  command -v ufw >/dev/null && ufw status | grep -q "Status: active" && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }
fi

# First ingest now, in the background (first run back-fills since the last stored permit; can take 20-40 min).
systemctl start --no-block leadyard-ingest.service
sleep 2
echo "------------------------------------------------------------"
[ -z "${NO_CADDY:-}" ] && echo "URL:       https://$HOST" || echo "URL:       (no HTTPS yet) app is on 127.0.0.1:3000"
echo "Login:     $ADMIN_NOTE"
echo "           You are asked to set your own password at first sign-in. Add other people in the app's Users tab."
echo "Alerts:    $(grep ^ALERT_WEBHOOK= .env | cut -d= -f2)"
echo "App:       $(systemctl is-active leadyard.service)   Timer: $(systemctl is-active leadyard-ingest.timer)"
echo "Ingest log: journalctl -u leadyard-ingest -f      Result: $APP/data/last_run.json"
echo "------------------------------------------------------------"
