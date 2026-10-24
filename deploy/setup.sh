#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server and is safe to run again on every deploy.
#   LEKS_HOST=example.org bash setup.sh
set -euo pipefail
: "${LEKS_HOST:?LEKS_HOST is required}"
: "${SERVER_IP:?SERVER_IP is required}"
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
# Calls: media over TCP 7881 and UDP 50000-50200, TURN on UDP 3478.
ufw allow 7881/tcp >/dev/null
ufw allow 50000:50200/udp >/dev/null
ufw allow 3478/udp >/dev/null
ufw --force enable >/dev/null

# Keys only, no passwords.
if ! grep -q '^PasswordAuthentication no' /etc/ssh/sshd_config.d/50-leks.conf 2>/dev/null; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/50-leks.conf
  systemctl reload ssh || true
fi

mkdir -p /opt/leks
cd /opt/leks
random() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
if [ ! -f .env ]; then
  umask 077
  echo "POSTGRES_PASSWORD=$(random 40)" > .env
fi
grep -q '^LIVEKIT_API_KEY=' .env || echo "LIVEKIT_API_KEY=API$(random 12)" >> .env
grep -q '^LIVEKIT_API_SECRET=' .env || echo "LIVEKIT_API_SECRET=$(random 48)" >> .env
# The host may change (for example when a domain is connected); keep the rest.
grep -v -e '^LEKS_HOST=' -e '^SERVER_IP=' .env > .env.new || true
echo "LEKS_HOST=$LEKS_HOST" >> .env.new
echo "SERVER_IP=$SERVER_IP" >> .env.new
mv .env.new .env
chmod 600 .env
