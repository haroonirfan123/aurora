#!/usr/bin/env bash
# One-time server setup for an Ubuntu VM (built for Oracle Cloud Always Free).
# Run from inside the uploaded bot folder:   bash deploy/setup.sh
# Safe to run again after uploading a new version — it just updates and restarts.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=/etc/aurora-bot.env
SERVICE=aurora-bot
USER_NAME="$(whoami)"

echo "▸ Installing Node.js 22, Caddy and firewall tools…"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null

echo "▸ Opening ports 80 and 443 (Oracle images block them by default)…"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

# Free HTTPS address based on the server's IP, e.g. 129-146-1-2.sslip.io
IP="$(curl -fsS https://api.ipify.org)"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"

echo "▸ Installing bot packages…"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

if [ ! -f "$ENV_FILE" ]; then
  echo "▸ Creating $ENV_FILE (your secrets live here, not in the bot folder)…"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
CLIENT_SECRET=
DASHBOARD_ROLE_ID=
DASHBOARD_PORT=3000
DASHBOARD_HOST=127.0.0.1
DASHBOARD_URL=https://$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
EOF
  sudo chmod 600 "$ENV_FILE"
  NEW_ENV=1
fi

echo "▸ Setting up HTTPS for https://$DOMAIN …"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "▸ Registering the bot as a service (starts on boot, restarts on crash)…"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=Aurora Discord bot + dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE >/dev/null

echo
if [ "${NEW_ENV:-0}" = 1 ] || ! sudo grep -q '^DISCORD_TOKEN=.\+' "$ENV_FILE"; then
  echo "✋ Almost done! Add your secrets:"
  echo "     sudo nano $ENV_FILE"
  echo "   Fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID, CLIENT_SECRET and DASHBOARD_ROLE_ID,"
  echo "   save (Ctrl+O, Enter, Ctrl+X), then start the bot:"
  echo "     sudo systemctl restart $SERVICE"
else
  sudo systemctl restart $SERVICE
  echo "✓ Bot restarted."
fi
echo
echo "Dashboard address:  https://$DOMAIN"
echo "Add this redirect in Discord Developer Portal → OAuth2 → Redirects:"
echo "     https://$DOMAIN/callback"
echo "Live logs:  journalctl -u $SERVICE -f"
