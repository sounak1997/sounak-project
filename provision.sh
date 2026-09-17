#!/bin/bash
# ============================================
# Sounak Project — bare-metal provisioning
#
# Rebuilds the whole stack on a fresh Linux box:
#   nginx :80 → Express :3000 → AI service 127.0.0.1:8000 → Gemini
# Express serves the Angular dist, so everything is SAME-ORIGIN and there
# is no CORS or mixed-content problem. Keep it that way.
#
# Targets: Oracle Cloud Always Free (ARM64 Ampere) on Ubuntu 22.04/24.04
#          or Oracle Linux 9. Also still works on Amazon Linux 2023.
#
# Usage, on the NEW server:
#   git clone <your repo> ~/sounak-project && cd ~/sounak-project
#   ./provision.sh
#
# This file replaces the AMI snapshot: it IS the machine image, and unlike
# an x86 AMI it works on ARM.
# ============================================
set -euo pipefail

APP_DIR="$HOME/sounak-project"
AI_DIR="$APP_DIR/sounak-ai-service"
BE_DIR="$APP_DIR/sounak-backend"
FE_DIR="$APP_DIR/sounak-project"

# ── Detect platform ──────────────────────────
if   command -v apt-get >/dev/null; then PKG=apt
elif command -v dnf     >/dev/null; then PKG=dnf
else echo "❌ Unsupported distro (need apt or dnf)"; exit 1; fi
ARCH=$(uname -m)
echo "▶ Platform: $PKG on $ARCH"

echo "▶ 1/8  System packages"
if [ "$PKG" = apt ]; then
  sudo apt-get update -y
  sudo apt-get install -y git nginx curl build-essential
  # Ubuntu 22.04 ships Python 3.10, 24.04 ships 3.12 — both parse `str | None`
  # (that syntax needs 3.10+). Only add the PPA if we somehow have <3.10.
  sudo apt-get install -y python3 python3-venv python3-pip
  PY=python3
else
  sudo dnf update -y
  sudo dnf install -y git nginx curl gcc gcc-c++ make
  # Oracle Linux 9 and Amazon Linux 2023 both default to Python 3.9, which
  # CANNOT parse `str | None` annotations — the AI service won't import.
  sudo dnf install -y python3.11 python3.11-pip
  PY=python3.11
fi
$PY --version

echo "▶ 2/8  Node.js 22"
if ! node --version 2>/dev/null | grep -q "^v22"; then
  # NodeSource publishes arm64 builds, so this works on Ampere.
  curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | sudo -E bash - || \
  curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
  if [ "$PKG" = apt ]; then sudo apt-get install -y nodejs; else sudo dnf install -y nodejs; fi
fi
node --version && npm --version

echo "▶ 3/8  Swap (only if RAM is tight)"
# The old t3.micro had 1GB and ChromaDB's install OOM-killed the live backend
# without swap. Oracle's ARM shape gives up to 24GB, so this is usually a no-op.
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "  RAM: ${RAM_MB}MB"
if [ "$RAM_MB" -lt 2048 ] && ! swapon --show | grep -q /swapfile; then
  echo "  → creating 2GB swapfile BEFORE the pip install"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "  → plenty of RAM, skipping swap"
fi

echo "▶ 4/8  Python venv for the AI service"
cd "$AI_DIR"
$PY -m venv .venv
./.venv/bin/pip install --upgrade pip
# On ARM some wheels build from source (chromadb→onnxruntime), hence the
# build tooling installed above. This step is slow the first time.
./.venv/bin/pip install -r requirements.txt

echo "▶ 5/8  Backend deps + frontend build"
cd "$BE_DIR" && npm ci --omit=dev
cd "$FE_DIR" && npm ci
# angular.json's defaultConfiguration is "development" — a plain `ng build`
# ships an unoptimised bundle with source maps. The flag is not optional.
npx ng build --configuration production

echo "▶ 6/8  nginx"
sudo cp "$APP_DIR/nginx/sounak.conf" /etc/nginx/conf.d/sounak.conf
if [ "$PKG" = apt ]; then
  # Ubuntu's default site owns :80 and would shadow ours.
  sudo rm -f /etc/nginx/sites-enabled/default
fi
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "▶ 7/8  Firewall"
# ⚠️  ORACLE CLOUD GOTCHA: opening port 80 in the console Security List is only
# half the job. Oracle's Ubuntu/OL images ship iptables rules that REJECT
# everything except SSH, so the site stays unreachable until you do this too.
# This is the single most common "my Oracle VM won't serve traffic" cause.
if command -v iptables >/dev/null; then
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT || true
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
  if [ "$PKG" = apt ]; then
    sudo apt-get install -y iptables-persistent netfilter-persistent
    sudo netfilter-persistent save
  else
    sudo dnf install -y iptables-services || true
    sudo service iptables save || true
  fi
  echo "  ✓ ports 80/443 opened and persisted"
fi
echo "  ⚠️  Also add ingress rules for 80/443 in the Oracle console:"
echo "     Networking → VCN → Subnet → Security List → Add Ingress Rule (0.0.0.0/0)"

echo "▶ 8/8  PM2"
sudo npm install -g pm2
cd "$BE_DIR"
pm2 start server.js --name my-nodejs-backend
cd "$AI_DIR"
pm2 start ./.venv/bin/uvicorn --name sounak-ai-service --interpreter none -- \
  app.main:app --host 127.0.0.1 --port 8000
pm2 save
sudo env PATH=$PATH:$(dirname $(which node)) pm2 startup systemd -u "$USER" --hp "$HOME"

echo
echo "✅ Provisioned on $PKG/$ARCH."
echo
echo "Remaining manual steps:"
echo "  1. Copy .env into $BE_DIR and $AI_DIR"
echo "     (they're in ~/Desktop/sounak-server-backup-20260902/env/ on your laptop)"
echo "  2. pm2 restart all --update-env"
echo "  3. Whitelist this server's IP in MongoDB Atlas → Network Access"
echo "  4. On your laptop: export SOUNAK_HOST=<this-ip> before running ./deploy.sh"
