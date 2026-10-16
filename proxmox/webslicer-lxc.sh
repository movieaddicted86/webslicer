#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# WebSlicer – Proxmox VE helper script
#
# Creates a Debian 12 LXC container on the Proxmox host and installs WebSlicer
# (PrusaSlicer engine + web UI) as a systemd service inside it.
#
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/robert-nwaoko/webslicer/main/proxmox/webslicer-lxc.sh)"
# or from a local checkout:
#   bash proxmox/webslicer-lxc.sh
#
# Non-interactive example:
#   CTID=120 HOSTNAME=webslicer DISK=12 CORES=4 RAM=4096 STORAGE=local-lvm BRIDGE=vmbr0 YES=1 bash proxmox/webslicer-lxc.sh
#
# Variables (all optional):
#   CTID, HOSTNAME, DISK (GB), CORES, RAM (MB), SWAP (MB), STORAGE, BRIDGE,
#   IP (dhcp or CIDR e.g. 192.168.1.50/24), GW, VLAN, PASSWORD, SSHKEY (path),
#   UNPRIVILEGED (1/0), TEMPLATE_STORAGE, WEBSLICER_REPO, WEBSLICER_BRANCH,
#   WEBSLICER_PORT, PRUSASLICER_VERSION, PRUSASLICER_URL, YES=1 (skip prompts)
# ---------------------------------------------------------------------------
set -euo pipefail

msg()  { echo -e "\e[1;34m==>\e[0m $*"; }
ok()   { echo -e "\e[1;32m ✔\e[0m $*"; }
die()  { echo -e "\e[1;31m ✖ $*\e[0m" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root on the Proxmox host."
command -v pct >/dev/null 2>&1 || die "pct not found – this script must run on a Proxmox VE host."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
REPO_ROOT=""
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/../package.json" ] && [ -f "${SCRIPT_DIR}/install.sh" ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

WEBSLICER_REPO="${WEBSLICER_REPO:-https://github.com/robert-nwaoko/webslicer.git}"
WEBSLICER_BRANCH="${WEBSLICER_BRANCH:-main}"
WEBSLICER_PORT="${WEBSLICER_PORT:-8080}"
PRUSASLICER_VERSION="${PRUSASLICER_VERSION:-2.9.6}"
PRUSASLICER_URL="${PRUSASLICER_URL:-}"
INSTALL_URL="${WEBSLICER_REPO%.git}"
INSTALL_URL="${INSTALL_URL/github.com/raw.githubusercontent.com}/${WEBSLICER_BRANCH}/proxmox/install.sh"

NEXTID="$(pvesh get /cluster/nextid 2>/dev/null || echo 100)"
CTID="${CTID:-}"
HOSTNAME="${HOSTNAME_CT:-${HOSTNAME:-webslicer}}"
[ "$HOSTNAME" = "$(hostname)" ] && HOSTNAME="webslicer"
DISK="${DISK:-10}"
CORES="${CORES:-2}"
RAM="${RAM:-3072}"
SWAP="${SWAP:-512}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
GW="${GW:-}"
VLAN="${VLAN:-}"
PASSWORD="${PASSWORD:-}"
SSHKEY="${SSHKEY:-}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
YES="${YES:-0}"

ask() { # ask VAR "prompt" default
  local var="$1" prompt="$2" def="$3" val
  if [ "$YES" = "1" ]; then eval "$var=\"\${$var:-$def}\""; return; fi
  if command -v whiptail >/dev/null 2>&1 && [ -t 0 ]; then
    val="$(whiptail --inputbox "$prompt" 10 60 "${!var:-$def}" --title "WebSlicer LXC" 3>&1 1>&2 2>&3)" || die "Cancelled."
  else
    read -r -p "$prompt [${!var:-$def}]: " val
  fi
  eval "$var=\"\${val:-\${$var:-$def}}\""
}

ask CTID "Container ID" "$NEXTID"
ask HOSTNAME "Hostname" "$HOSTNAME"
ask DISK "Disk size (GB)" "$DISK"
ask CORES "CPU cores" "$CORES"
ask RAM "RAM (MB)" "$RAM"
ask BRIDGE "Network bridge" "$BRIDGE"
ask IP "IP address (dhcp or CIDR)" "$IP"
if [ "$IP" != "dhcp" ]; then ask GW "Gateway" "$GW"; fi
if [ -z "$STORAGE" ]; then
  mapfile -t STORES < <(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  [ "${#STORES[@]}" -gt 0 ] || die "No storage with 'rootdir' content found."
  STORAGE="${STORES[0]}"
  ask STORAGE "Container storage (available: ${STORES[*]})" "$STORAGE"
fi
if [ -z "$PASSWORD" ] && [ "$YES" != "1" ]; then
  if command -v whiptail >/dev/null 2>&1 && [ -t 0 ]; then
    PASSWORD="$(whiptail --passwordbox "Root password for the container (empty = random)" 10 60 --title "WebSlicer LXC" 3>&1 1>&2 2>&3)" || true
  else
    read -r -s -p "Root password for the container (empty = random): " PASSWORD; echo
  fi
fi
[ -n "$PASSWORD" ] || PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)"

pct status "$CTID" >/dev/null 2>&1 && die "CT $CTID already exists."

# --- template -----------------------------------------------------------------
msg "Looking for Debian 12 template"
pveam update >/dev/null 2>&1 || true
TEMPLATE="$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/ {print $2}' | sort -V | tail -n1)"
[ -n "$TEMPLATE" ] || die "debian-12-standard template not available (pveam available)."
if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg "Downloading $TEMPLATE to $TEMPLATE_STORAGE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi
TEMPLATE_REF="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"

# --- create -------------------------------------------------------------------
NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
[ "$IP" != "dhcp" ] && [ -n "$GW" ] && NET="${NET},gw=${GW}"
[ -n "$VLAN" ] && NET="${NET},tag=${VLAN}"
ARGS=(
  "$CTID" "$TEMPLATE_REF"
  --hostname "$HOSTNAME"
  --cores "$CORES" --memory "$RAM" --swap "$SWAP"
  --rootfs "${STORAGE}:${DISK}"
  --net0 "$NET"
  --unprivileged "$UNPRIVILEGED"
  --features "nesting=1"
  --onboot 1
  --ostype debian
  --password "$PASSWORD"
  --tags "webslicer;3dprinting"
  --description "WebSlicer – web based slicer (PrusaSlicer engine). Port ${WEBSLICER_PORT}."
)
[ -n "$SSHKEY" ] && [ -f "$SSHKEY" ] && ARGS+=(--ssh-public-keys "$SSHKEY")

msg "Creating LXC $CTID ($HOSTNAME, ${CORES} cores, ${RAM} MB, ${DISK} GB on ${STORAGE})"
pct create "${ARGS[@]}"
ok "container created"

msg "Starting container"
pct start "$CTID"
for i in $(seq 1 30); do
  if pct exec "$CTID" -- bash -c "getent hosts deb.debian.org >/dev/null 2>&1"; then break; fi
  sleep 2
done
pct exec "$CTID" -- bash -c "apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null"

# --- install ------------------------------------------------------------------
ENVS="WEBSLICER_REPO=${WEBSLICER_REPO} WEBSLICER_BRANCH=${WEBSLICER_BRANCH} WEBSLICER_PORT=${WEBSLICER_PORT} PRUSASLICER_VERSION=${PRUSASLICER_VERSION}"
[ -n "$PRUSASLICER_URL" ] && ENVS="$ENVS PRUSASLICER_URL=${PRUSASLICER_URL}"
if [ -n "$REPO_ROOT" ]; then
  msg "Pushing local sources from $REPO_ROOT into the container"
  TARBALL="$(mktemp --suffix=.tar.gz)"
  tar -C "$REPO_ROOT" --exclude=node_modules --exclude='*/node_modules' --exclude=dist --exclude='*/dist' --exclude=data --exclude=.git -czf "$TARBALL" .
  pct push "$CTID" "$TARBALL" /root/webslicer-src.tar.gz
  pct push "$CTID" "${REPO_ROOT}/proxmox/install.sh" /root/webslicer-install.sh
  rm -f "$TARBALL"
  pct exec "$CTID" -- bash -c "env $ENVS WEBSLICER_SRC=/root/webslicer-src.tar.gz bash /root/webslicer-install.sh"
else
  msg "Running installer from $INSTALL_URL"
  pct exec "$CTID" -- bash -c "curl -fsSL '$INSTALL_URL' -o /root/webslicer-install.sh && env $ENVS bash /root/webslicer-install.sh"
fi

CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
echo
ok "WebSlicer installed in CT $CTID"
echo "    URL:           http://${CT_IP:-<container-ip>}:${WEBSLICER_PORT}"
echo "    Root password: ${PASSWORD}"
echo "    Update later:  pct exec $CTID -- bash /root/webslicer-install.sh"
echo "    Logs:          pct exec $CTID -- journalctl -u webslicer -f"
