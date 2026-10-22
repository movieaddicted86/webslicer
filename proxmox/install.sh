#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# WebSlicer native installer / updater for Debian 12/13 (and Ubuntu 22.04+).
# Runs inside the LXC container or VM. Idempotent: re-run (or type `update`)
# to update WebSlicer and PrusaSlicer.
#
# Environment overrides (persisted in /etc/webslicer/installer.env):
#   WEBSLICER_REPO      git URL of the WebSlicer sources
#   WEBSLICER_BRANCH    branch/tag to check out (default: main)
#   WEBSLICER_PORT      HTTP port (default: 8080)
#   PRUSASLICER_VERSION PrusaSlicer version (default: installer default)
#   PRUSASLICER_URL     explicit AppImage URL (overrides version/arch detection)
#   PRUSASLICER_SHA256  SHA-256 of that AppImage (required for a custom URL or version)
# Not persisted:
#   WEBSLICER_SRC       use a local source tree instead of git (dir or .tar.gz)
#   WEBSLICER_DIR       install dir (default: /opt/webslicer)
#   WEBSLICER_DATA      data dir (default: /var/lib/webslicer)
#   WEBSLICER_UID       uid of the service user on first install (default: 1050)
#   NODE_MAJOR          Node.js major version from NodeSource (default: 22)
#
# Output: step lines start with "==> " (begin) and " ✔ " (done) so that the
# Proxmox helper can show them as progress while sending the rest to a log.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

# Debian LXC templates set LANG=en_US.UTF-8 without generating it; avoid perl/apt warnings.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
export DEBIAN_FRONTEND=noninteractive
export NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

DEFAULT_PRUSASLICER_VERSION="2.9.6"
# SHA-256 of the default AppImage of DEFAULT_PRUSASLICER_VERSION (S4); a different version or a
# custom PRUSASLICER_URL needs PRUSASLICER_SHA256, otherwise the installer warns.
DEFAULT_PRUSASLICER_SHA256_x86_64="903765126127d99144f06bbac58857d4cc684d9b30c2884a4cc7e2ecb7a7fab8"
DEFAULT_PRUSASLICER_SHA256_aarch64="8c4fa98ad9b07878b3ebfbb7e2ccdfd1bdf6fa307b87ba74dde3d07b4103b19a"
SETTINGS=/etc/webslicer/installer.env

# Settings of a previous install (only for variables not given explicitly)
if [ -f "$SETTINGS" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      WEBSLICER_REPO | WEBSLICER_BRANCH | WEBSLICER_PORT | PRUSASLICER_VERSION | PRUSASLICER_URL | PRUSASLICER_SHA256)
        [ -z "${!key:-}" ] && export "$key=$value" ;;
    esac
  done <"$SETTINGS"
fi

PIN_PRUSASLICER="${PRUSASLICER_VERSION:+1}"
WEBSLICER_REPO="${WEBSLICER_REPO:-https://github.com/movieaddicted86/webslicer.git}"
WEBSLICER_BRANCH="${WEBSLICER_BRANCH:-main}"
WEBSLICER_SRC="${WEBSLICER_SRC:-}"
WEBSLICER_PORT="${WEBSLICER_PORT:-8080}"
WEBSLICER_DIR="${WEBSLICER_DIR:-/opt/webslicer}"
WEBSLICER_DATA="${WEBSLICER_DATA:-/var/lib/webslicer}"
WEBSLICER_UID="${WEBSLICER_UID:-1050}"
PRUSASLICER_VERSION="${PRUSASLICER_VERSION:-$DEFAULT_PRUSASLICER_VERSION}"
PRUSASLICER_URL="${PRUSASLICER_URL:-}"
PRUSASLICER_DIR="/opt/prusaslicer"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_USER="webslicer"

msg() { echo -e "\e[1;34m==>\e[0m $*"; }
ok() { echo -e "\e[1;32m ✔\e[0m $*"; }
die() {
  echo -e "\e[1;31m ✖ $*\e[0m" >&2
  exit 1
}

trap 'die "Failed (line ${LINENO}): ${BASH_COMMAND}"' ERR
[ "$(id -u)" -eq 0 ] || die "Run as root."
UPDATE=0
[ -d "${WEBSLICER_DIR}/server" ] && UPDATE=1

# --- OS -----------------------------------------------------------------------
msg "Installing base packages"
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl git gnupg tar xz-utils locales >/dev/null
# generate the locale the template advertises so interactive shells stay quiet as well
if [ -f /etc/locale.gen ]; then
  want="$(sed -n 's/^LANG=//p' /etc/default/locale 2>/dev/null | tr -d '"')"
  want="${want:-en_US.UTF-8}"
  if ! locale -a 2>/dev/null | grep -qi "^${want//-/}$\|^${want}$"; then
    sed -i "s/^# *\(${want} .*\)/\1/" /etc/locale.gen
    grep -q "^${want} " /etc/locale.gen || echo "${want} UTF-8" >>/etc/locale.gen
    locale-gen >/dev/null 2>&1 || true
  fi
fi
ok "Base packages"

# --- Node.js -------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt 20 ]; then
  msg "Installing Node.js ${NODE_MAJOR}"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

# --- PrusaSlicer -----------------------------------------------------------------
ARCH="$(uname -m)"
CUSTOM_URL=0
if [ -n "$PRUSASLICER_URL" ]; then
  CUSTOM_URL=1
else
  case "$ARCH" in
    x86_64) PRUSASLICER_URL="https://github.com/gneiss15/PrusaSlicer.AppImage/releases/download/${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-x86_64_GN.AppImage" ;;
    aarch64) PRUSASLICER_URL="https://github.com/davidk/PrusaSlicer-ARM.AppImage/releases/download/version_${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-aarch64-full.AppImage" ;;
    *) die "Unsupported architecture $ARCH" ;;
  esac
fi
# S4: pin the checksum of the default release; an explicit PRUSASLICER_SHA256 wins, anything else
# (other version, custom URL) is downloaded unverified with a warning in the log.
if [ -n "${PRUSASLICER_SHA256:-}" ]; then
  EXPECTED_SHA="$PRUSASLICER_SHA256"
elif [ "$CUSTOM_URL" = 0 ] && [ "$PRUSASLICER_VERSION" = "$DEFAULT_PRUSASLICER_VERSION" ]; then
  case "$ARCH" in
    x86_64) EXPECTED_SHA="$DEFAULT_PRUSASLICER_SHA256_x86_64" ;;
    aarch64) EXPECTED_SHA="$DEFAULT_PRUSASLICER_SHA256_aarch64" ;;
    *) EXPECTED_SHA="" ;;
  esac
else
  EXPECTED_SHA=""
  msg "WARNING: AppImage download without PRUSASLICER_SHA256 – it is not verified"
fi
if [ ! -f "${PRUSASLICER_DIR}/VERSION" ] || [ "$(cat "${PRUSASLICER_DIR}/VERSION")" != "${PRUSASLICER_VERSION}" ]; then
  msg "Downloading PrusaSlicer ${PRUSASLICER_VERSION}"
  TMP="$(mktemp -d)"
  curl -fsSL --retry 3 -o "${TMP}/PrusaSlicer.AppImage" "$PRUSASLICER_URL" || die "Download of ${PRUSASLICER_URL} failed"
  if [ -n "$EXPECTED_SHA" ]; then
    ACTUAL_SHA="$(sha256sum "${TMP}/PrusaSlicer.AppImage" | cut -d' ' -f1)"
    [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "PrusaSlicer checksum mismatch: expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}"
    ok "PrusaSlicer checksum verified"
  fi
  chmod +x "${TMP}/PrusaSlicer.AppImage"
  (cd "$TMP" && ./PrusaSlicer.AppImage --appimage-extract >/dev/null)
  rm -rf "${PRUSASLICER_DIR}"
  mv "${TMP}/squashfs-root" "${PRUSASLICER_DIR}"
  echo "${PRUSASLICER_VERSION}" >"${PRUSASLICER_DIR}/VERSION"
  # GUI-only resources are not needed for CLI slicing
  R="${PRUSASLICER_DIR}/usr/resources"
  rm -rf "$R/localization" "$R/fonts" "$R/shapes" "$R/icons" "$R/workflows" "$R/web" "$R/applications" "$R/udev" \
    "$R/data/printer_gantries" "${PRUSASLICER_DIR}/usr/share/locale"
  rm -rf "$TMP"
fi
HOME=/tmp "${PRUSASLICER_DIR}/AppRun" --help 2>/dev/null | head -n1 | grep -q PrusaSlicer || die "PrusaSlicer does not start"
ok "PrusaSlicer ${PRUSASLICER_VERSION}"

# --- Service user / dirs --------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  # fixed uid so a bind-mounted library can be prepared on the host (unprivileged LXC: 100000 + uid)
  if getent passwd "$WEBSLICER_UID" >/dev/null || getent group "$WEBSLICER_UID" >/dev/null; then
    useradd --system --home "$WEBSLICER_DATA" --shell /usr/sbin/nologin "$SERVICE_USER"
  else
    groupadd --gid "$WEBSLICER_UID" "$SERVICE_USER"
    useradd --uid "$WEBSLICER_UID" --gid "$WEBSLICER_UID" --no-create-home --home-dir "$WEBSLICER_DATA" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
fi
mkdir -p "$WEBSLICER_DATA" "$WEBSLICER_DATA/library" "$WEBSLICER_DIR"
# do not chown a bind-mounted library recursively (it may be a NAS share)
find "$WEBSLICER_DATA" -mindepth 1 -maxdepth 1 ! -name library -exec chown -R "$SERVICE_USER:$SERVICE_USER" {} +
chown "$SERVICE_USER:$SERVICE_USER" "$WEBSLICER_DATA" "$WEBSLICER_DATA/library" 2>/dev/null || true

# --- Sources ---------------------------------------------------------------------
msg "Fetching WebSlicer sources"
if [ -n "$WEBSLICER_SRC" ]; then
  rm -rf "${WEBSLICER_DIR:?}"/* "${WEBSLICER_DIR}"/.[!.]* 2>/dev/null || true
  if [ -d "$WEBSLICER_SRC" ]; then
    cp -a "${WEBSLICER_SRC}/." "$WEBSLICER_DIR/"
  else
    tar -xzf "$WEBSLICER_SRC" -C "$WEBSLICER_DIR" --strip-components=1
  fi
elif [ -d "${WEBSLICER_DIR}/.git" ]; then
  # the tree belongs to the service user; tell git that root may operate on it
  GIT=(git -c "safe.directory=${WEBSLICER_DIR}" -C "$WEBSLICER_DIR")
  "${GIT[@]}" remote set-url origin "$WEBSLICER_REPO"
  "${GIT[@]}" fetch -q --depth 1 origin "$WEBSLICER_BRANCH"
  "${GIT[@]}" checkout -q -f FETCH_HEAD
else
  rm -rf "${WEBSLICER_DIR:?}"
  git clone -q --depth 1 --branch "$WEBSLICER_BRANCH" "$WEBSLICER_REPO" "$WEBSLICER_DIR"
fi
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "${WEBSLICER_DIR}/package.json" | head -n1)"
ok "WebSlicer ${VERSION:-sources}"

# --- Licence ---------------------------------------------------------------------
# S6: the licence and the third-party notices stay with the installed sources and in the doc dir
mkdir -p /usr/share/doc/webslicer
for doc in LICENSE THIRD_PARTY_NOTICES.md; do
  [ -f "${WEBSLICER_DIR}/${doc}" ] && cp "${WEBSLICER_DIR}/${doc}" /usr/share/doc/webslicer/
done

# --- Build -------------------------------------------------------------------------
msg "Building WebSlicer (takes a few minutes)"
cd "$WEBSLICER_DIR"
rm -rf node_modules/.cache
npm ci --loglevel=error >/dev/null
npm run build --silent >/dev/null
npm prune --omit=dev --loglevel=error >/dev/null
chown -R "$SERVICE_USER:$SERVICE_USER" "$WEBSLICER_DIR"
ok "Built WebSlicer ${VERSION}"

# --- Config, systemd, update command -----------------------------------------------
msg "Configuring service"
mkdir -p /etc/webslicer
if [ ! -f /etc/webslicer/webslicer.env ]; then
  cat >/etc/webslicer/webslicer.env <<EOF
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
else
  sed -i "s/^PORT=.*/PORT=${WEBSLICER_PORT}/" /etc/webslicer/webslicer.env
  grep -q '^LIBRARY_DIR=' /etc/webslicer/webslicer.env || echo "LIBRARY_DIR=${WEBSLICER_DATA}/library" >>/etc/webslicer/webslicer.env
fi

{
  echo "WEBSLICER_REPO=${WEBSLICER_REPO}"
  echo "WEBSLICER_BRANCH=${WEBSLICER_BRANCH}"
  echo "WEBSLICER_PORT=${WEBSLICER_PORT}"
  [ -n "$PIN_PRUSASLICER" ] && echo "PRUSASLICER_VERSION=${PRUSASLICER_VERSION}"
  [ -n "$PRUSASLICER_URL" ] && [ -n "$PIN_PRUSASLICER" ] && echo "PRUSASLICER_URL=${PRUSASLICER_URL}"
  [ -n "${PRUSASLICER_SHA256:-}" ] && echo "PRUSASLICER_SHA256=${PRUSASLICER_SHA256}"
} >"$SETTINGS"

cat >/etc/systemd/system/webslicer.service <<EOF
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

# `update` inside the container: newest installer from the repository (local copy as fallback)
RAW_URL="${WEBSLICER_REPO%.git}"
RAW_URL="${RAW_URL/github.com/raw.githubusercontent.com}/${WEBSLICER_BRANCH}/proxmox/install.sh"
cat >/usr/bin/update <<EOF
#!/usr/bin/env bash
# Update WebSlicer and PrusaSlicer (generated by the WebSlicer installer)
set -e
if curl -fsSL "${RAW_URL}" -o /root/webslicer-install.sh.new; then
  mv /root/webslicer-install.sh.new /root/webslicer-install.sh
fi
exec bash /root/webslicer-install.sh "\$@"
EOF
chmod +x /usr/bin/update
ok "Service configured"

msg "Starting WebSlicer"
systemctl daemon-reload
systemctl enable -q webslicer
systemctl restart webslicer
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${WEBSLICER_PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if curl -fsS "http://127.0.0.1:${WEBSLICER_PORT}/api/health" >/dev/null 2>&1; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ "$UPDATE" = 1 ]; then ok "Updated to WebSlicer ${VERSION}: http://${IP:-<host>}:${WEBSLICER_PORT}"; else ok "WebSlicer is running: http://${IP:-<host>}:${WEBSLICER_PORT}"; fi
else
  journalctl -u webslicer --no-pager -n 30 >&2
  die "WebSlicer service failed to start"
fi
