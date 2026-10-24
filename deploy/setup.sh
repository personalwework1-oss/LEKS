#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server and is safe to run again on every deploy.
#   LEKS_HOST=example.org bash setup.sh
set -euo pipefail
: "${LEKS_HOST:?LEKS_HOST is required}"
export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  apt-get install -yq docker.io docker-compose-v2 ufw unattended-upgrades fail2ban
  systemctl enable --now docker
fi

# Only SSH and the web ports are reachable from outside.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null

# Keys only, no passwords.
if ! grep -q '^PasswordAuthentication no' /etc/ssh/sshd_config.d/50-leks.conf 2>/dev/null; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/50-leks.conf
  systemctl reload ssh || true
fi

mkdir -p /opt/leks
cd /opt/leks
if [ ! -f .env ]; then
  umask 077
  echo "POSTGRES_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)" > .env
fi
# The host may change (for example when a domain is connected); keep the rest.
grep -v '^LEKS_HOST=' .env > .env.new || true
echo "LEKS_HOST=$LEKS_HOST" >> .env.new
mv .env.new .env
chmod 600 .env
