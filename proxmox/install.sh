#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# WebSlicer native installer for Debian 12/13 (and Ubuntu 22.04+).
# Runs inside the LXC container / VM. Idempotent: re-run to update.
#
# Environment overrides:
#   WEBSLICER_REPO      git URL of the WebSlicer sources (default below)
#   WEBSLICER_BRANCH    branch/tag to check out (default: main)
#   WEBSLICER_SRC       use a local source tree instead of git (path to a dir or .tar.gz)
#   WEBSLICER_PORT      HTTP port (default: 8080)
#   WEBSLICER_DIR       install dir (default: /opt/webslicer)
#   WEBSLICER_DATA      data dir (default: /var/lib/webslicer)
#   PRUSASLICER_VERSION PrusaSlicer version (default: 2.9.6)
#   PRUSASLICER_URL     explicit AppImage URL (overrides version/arch detection)
#   NODE_MAJOR          Node.js major version from NodeSource (default: 22)
# ---------------------------------------------------------------------------
set -euo pipefail

WEBSLICER_REPO="${WEBSLICER_REPO:-https://github.com/robert-nwaoko/webslicer.git}"
WEBSLICER_BRANCH="${WEBSLICER_BRANCH:-main}"
WEBSLICER_SRC="${WEBSLICER_SRC:-}"
WEBSLICER_PORT="${WEBSLICER_PORT:-8080}"
WEBSLICER_DIR="${WEBSLICER_DIR:-/opt/webslicer}"
WEBSLICER_DATA="${WEBSLICER_DATA:-/var/lib/webslicer}"
PRUSASLICER_VERSION="${PRUSASLICER_VERSION:-2.9.6}"
PRUSASLICER_URL="${PRUSASLICER_URL:-}"
PRUSASLICER_DIR="/opt/prusaslicer"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_USER="webslicer"

msg()  { echo -e "\e[1;34m==>\e[0m $*"; }
ok()   { echo -e "\e[1;32m ✔\e[0m $*"; }
die()  { echo -e "\e[1;31m ✖ $*\e[0m" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root."
export DEBIAN_FRONTEND=noninteractive

msg "Installing base packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git gnupg tar xz-utils >/dev/null
ok "base packages"

# --- Node.js -----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 20 ]; then
  msg "Installing Node.js ${NODE_MAJOR} (NodeSource)"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v), npm $(npm -v)"

# --- PrusaSlicer -------------------------------------------------------------
ARCH="$(uname -m)"
if [ -z "$PRUSASLICER_URL" ]; then
  case "$ARCH" in
    x86_64)  PRUSASLICER_URL="https://github.com/gneiss15/PrusaSlicer.AppImage/releases/download/${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-x86_64_GN.AppImage" ;;
    aarch64) PRUSASLICER_URL="https://github.com/davidk/PrusaSlicer-ARM.AppImage/releases/download/version_${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-aarch64-full.AppImage" ;;
    *) die "Unsupported architecture $ARCH" ;;
  esac
fi
if [ ! -f "${PRUSASLICER_DIR}/VERSION" ] || [ "$(cat "${PRUSASLICER_DIR}/VERSION")" != "${PRUSASLICER_VERSION}" ]; then
  msg "Downloading PrusaSlicer ${PRUSASLICER_VERSION} AppImage"
  TMP="$(mktemp -d)"
  curl -fL --retry 3 --progress-bar -o "${TMP}/PrusaSlicer.AppImage" "$PRUSASLICER_URL"
  chmod +x "${TMP}/PrusaSlicer.AppImage"
  (cd "$TMP" && ./PrusaSlicer.AppImage --appimage-extract >/dev/null)
  rm -rf "${PRUSASLICER_DIR}"
  mv "${TMP}/squashfs-root" "${PRUSASLICER_DIR}"
  echo "${PRUSASLICER_VERSION}" > "${PRUSASLICER_DIR}/VERSION"
  # GUI-only resources are not needed for CLI slicing
  R="${PRUSASLICER_DIR}/usr/resources"
  rm -rf "$R/localization" "$R/fonts" "$R/shapes" "$R/icons" "$R/workflows" "$R/web" "$R/applications" "$R/udev"          "$R/data/printer_gantries" "${PRUSASLICER_DIR}/usr/share/locale"
  rm -rf "$TMP"
fi
HOME=/tmp "${PRUSASLICER_DIR}/AppRun" --help | head -n1 || die "PrusaSlicer does not start"
ok "PrusaSlicer at ${PRUSASLICER_DIR}"

# --- Service user / dirs ------------------------------------------------------
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$WEBSLICER_DATA" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$WEBSLICER_DATA" "$WEBSLICER_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$WEBSLICER_DATA"

# --- Sources -----------------------------------------------------------------
msg "Fetching WebSlicer sources"
if [ -n "$WEBSLICER_SRC" ]; then
  rm -rf "${WEBSLICER_DIR:?}"/* "${WEBSLICER_DIR}"/.[!.]* 2>/dev/null || true
  if [ -d "$WEBSLICER_SRC" ]; then
    cp -a "${WEBSLICER_SRC}/." "$WEBSLICER_DIR/"
  else
    tar -xzf "$WEBSLICER_SRC" -C "$WEBSLICER_DIR" --strip-components=1
  fi
elif [ -d "${WEBSLICER_DIR}/.git" ]; then
  git -C "$WEBSLICER_DIR" fetch --depth 1 origin "$WEBSLICER_BRANCH"
  git -C "$WEBSLICER_DIR" checkout -q FETCH_HEAD
else
  rm -rf "${WEBSLICER_DIR:?}"
  git clone --depth 1 --branch "$WEBSLICER_BRANCH" "$WEBSLICER_REPO" "$WEBSLICER_DIR"
fi
ok "sources in ${WEBSLICER_DIR}"

# --- Build -------------------------------------------------------------------
msg "Building WebSlicer (npm ci && npm run build)"
cd "$WEBSLICER_DIR"
rm -rf node_modules/.cache
npm ci --no-audit --no-fund --loglevel=error
npm run build
npm prune --omit=dev --no-audit --no-fund --loglevel=error
chown -R "$SERVICE_USER:$SERVICE_USER" "$WEBSLICER_DIR"
ok "build complete"

# --- Config + systemd ---------------------------------------------------------
mkdir -p /etc/webslicer
if [ ! -f /etc/webslicer/webslicer.env ]; then
cat > /etc/webslicer/webslicer.env <<EOF
PORT=${WEBSLICER_PORT}
HOST=0.0.0.0
DATA_DIR=${WEBSLICER_DATA}
LIBRARY_DIR=${WEBSLICER_DATA}/library
PRUSASLICER_BIN=${PRUSASLICER_DIR}/AppRun
WEB_DIST=${WEBSLICER_DIR}/web/dist
MAX_JOBS=2
NODE_ENV=production
HOME=${WEBSLICER_DATA}
EOF
fi

cat > /etc/systemd/system/webslicer.service <<EOF
[Unit]
Description=WebSlicer – web based 3D printing slicer (PrusaSlicer engine)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${WEBSLICER_DIR}
EnvironmentFile=/etc/webslicer/webslicer.env
ExecStart=$(command -v node) ${WEBSLICER_DIR}/server/dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${WEBSLICER_DATA}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable -q webslicer
systemctl restart webslicer
sleep 2
if systemctl is-active -q webslicer; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  ok "WebSlicer is running: http://${IP:-<host>}:${WEBSLICER_PORT}"
else
  journalctl -u webslicer --no-pager -n 30
  die "service failed to start"
fi
