#!/usr/bin/env bash
# Provision a fresh Ubuntu 22.04/24.04 Vultr box to run the Questr collage API.
# Run as root on the box:  bash server/setup.sh
#
# Idempotent-ish: safe to re-run to pick up code/deps changes.
set -euo pipefail

REPO="${REPO:-https://github.com/ljo3/questr.git}"
APP_DIR=/opt/questr
ENV_DIR=/etc/questr

echo "▶ Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git ufw debian-keyring debian-archive-keyring apt-transport-https curl

echo "▶ Creating service user + dirs…"
id questr >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin questr
mkdir -p "$APP_DIR" "$ENV_DIR"

echo "▶ Fetching code…"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

echo "▶ Python venv + deps…"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/server/requirements.txt"
chown -R questr:questr "$APP_DIR"

echo "▶ Env file…"
if [ ! -f "$ENV_DIR/questr.env" ]; then
  cp "$APP_DIR/server/questr.env.example" "$ENV_DIR/questr.env"
  chmod 600 "$ENV_DIR/questr.env"
  echo "  ⚠ Edit $ENV_DIR/questr.env with your real secrets, then restart the service."
fi

echo "▶ systemd service…"
cp "$APP_DIR/server/questr-api.service" /etc/systemd/system/questr-api.service
systemctl daemon-reload
systemctl enable --now questr-api

echo "▶ Installing Caddy (auto-HTTPS reverse proxy)…"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi
cp "$APP_DIR/server/Caddyfile" /etc/caddy/Caddyfile
echo "  ⚠ Edit /etc/caddy/Caddyfile — set your hostname (e.g. <dashed-ip>.sslip.io) — then: systemctl reload caddy"

echo "▶ Firewall (allow SSH + HTTP/HTTPS)…"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80,443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

echo
echo "✅ Base setup done."
echo "   1. Edit $ENV_DIR/questr.env       (secrets)  → systemctl restart questr-api"
echo "   2. Edit /etc/caddy/Caddyfile       (hostname) → systemctl reload caddy"
echo "   3. Test:  curl https://<your-host>/healthz"
