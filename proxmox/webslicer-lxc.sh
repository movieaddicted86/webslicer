#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# WebSlicer – Proxmox VE helper script
#
# Creates a Debian LXC container and installs WebSlicer (PrusaSlicer engine +
# web UI) as a systemd service. Interactive (whiptail) with "Default" and
# "Advanced" settings, in the style of the community-scripts helpers.
#
# On the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/movieaddicted86/webslicer/main/proxmox/webslicer-lxc.sh)"
# Run the same command inside an existing WebSlicer LXC to update it (or type `update`).
#
# Non-interactive (all optional):
#   YES=1 CTID=120 HOSTNAME=webslicer DISK=12 CORES=4 RAM=4096 STORAGE=local-lvm \
#   TEMPLATE_STORAGE=local BRIDGE=vmbr0 IP=dhcp GW= VLAN= PASSWORD= SSHKEY=/root/.ssh/id_ed25519.pub \
#   UNPRIVILEGED=1 OS_VERSION=12 LIBRARY_PATH=/mnt/nas/3d WEBSLICER_PORT=8080 VERBOSE=no \
#   bash proxmox/webslicer-lxc.sh
# ---------------------------------------------------------------------------
set -Eeuo pipefail

APP="WebSlicer"
NSAPP="webslicer"
WEBSLICER_REPO="${WEBSLICER_REPO:-https://github.com/movieaddicted86/webslicer.git}"
WEBSLICER_BRANCH="${WEBSLICER_BRANCH:-main}"
RAW_BASE="${WEBSLICER_REPO%.git}"
RAW_BASE="${RAW_BASE/github.com/raw.githubusercontent.com}/${WEBSLICER_BRANCH}"
INSTALL_URL="${RAW_BASE}/proxmox/install.sh"
SERVICE_UID=1050 # uid of the webslicer user inside the container (see install.sh)

# ---- defaults (can be preset through the environment) ------------------------
var_cpu="${CORES:-2}"
var_ram="${RAM:-3072}"
var_swap="${SWAP:-512}"
var_disk="${DISK:-10}"
var_os_version="${OS_VERSION:-12}"
var_unprivileged="${UNPRIVILEGED:-1}"
var_hostname="${HOSTNAME_CT:-webslicer}"
var_bridge="${BRIDGE:-vmbr0}"
var_ip="${IP:-dhcp}"
var_gw="${GW:-}"
var_ip6="${IP6:-none}"
var_vlan="${VLAN:-}"
var_mtu="${MTU:-}"
var_mac="${MAC:-}"
var_dns="${DNS:-}"
var_searchdomain="${SEARCHDOMAIN:-}"
var_password="${PASSWORD:-}"
var_sshkey="${SSHKEY:-}"
var_ssh="${SSH:-no}"
var_tags="${TAGS:-webslicer;3dprinting}"
var_port="${WEBSLICER_PORT:-8080}"
var_prusaslicer="${PRUSASLICER_VERSION:-}"
var_library="${LIBRARY_PATH:-}"
var_storage="${STORAGE:-}"
var_tstorage="${TEMPLATE_STORAGE:-}"
var_ctid="${CTID:-}"
VERBOSE="${VERBOSE:-no}"
YES="${YES:-0}"
# the shell variable HOSTNAME is set by bash itself; only use an explicit HOSTNAME override
if [ -n "${HOSTNAME:-}" ] && [ "${HOSTNAME}" != "$(hostname 2>/dev/null)" ]; then var_hostname="$HOSTNAME"; fi

# ---- look & feel ------------------------------------------------------------------
YW=$'\033[33m'
GN=$'\033[1;92m'
RD=$'\033[01;31m'
BL=$'\033[36m'
BGN=$'\033[4;92m'
DGN=$'\033[32m'
CL=$'\033[m'
BOLD=$'\033[1m'
TAB="  "
CM="${TAB}✔️${TAB}"
CROSS="${TAB}✖️${TAB}"
INFO="${TAB}💡${TAB}"
BACKTITLE="Proxmox VE Helper Script – ${APP}"
LOG="/tmp/${NSAPP}-install-$(date +%Y%m%d-%H%M%S).log"
START_LOG="${LOG%.log}-start-debug.log"
SPINNER_PID=""
CURRENT_STEP=""

header_info() {
  clear 2>/dev/null || true
  cat <<'EOF'
 __        __   _      ____  _ _
 \ \      / /__| |__  / ___|| (_) ___ ___ _ __
  \ \ /\ / / _ \ '_ \ \___ \| | |/ __/ _ \ '__|
   \ V  V /  __/ |_) | ___) | | | (_|  __/ |
    \_/\_/ \___|_.__/ |____/|_|_|\___\___|_|

EOF
  echo -e "${TAB}${BL}3D printing slicer in the browser – PrusaSlicer engine${CL}\n"
}

spinner() {
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  while :; do
    printf "\r\033[K${TAB}${YW}%s${CL}  %s" "${frames:i++%${#frames}:1}" "$1"
    sleep 0.1
  done
}
stop_spinner() {
  if [ -n "$SPINNER_PID" ] && kill -0 "$SPINNER_PID" 2>/dev/null; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
  fi
  SPINNER_PID=""
  printf "\r\033[K"
}
msg_info() {
  stop_spinner
  CURRENT_STEP="$1"
  if [ "$VERBOSE" = "yes" ] || [ ! -t 1 ]; then
    echo -e "${INFO}${YW}$1${CL}"
  else
    spinner "$1" &
    SPINNER_PID=$!
  fi
}
msg_ok() {
  stop_spinner
  echo -e "${CM}${GN}$1${CL}"
}
msg_error() {
  stop_spinner
  echo -e "${CROSS}${RD}$1${CL}"
}
# run a command; output goes to the log unless verbose
run() {
  if [ "$VERBOSE" = "yes" ]; then "$@" 2>&1 | tee -a "$LOG"; else "$@" >>"$LOG" 2>&1; fi
}

on_error() {
  local code=$? line=$1
  stop_spinner
  msg_error "Failed${CURRENT_STEP:+: ${CURRENT_STEP}} (line ${line}, exit code ${code})"
  if [ -s "$LOG" ]; then
    echo -e "${TAB}${YW}Last lines of ${LOG}:${CL}"
    tail -n 20 "$LOG" | sed "s/^/${TAB}${TAB}/"
  fi
  failure_hints
  exit "$code"
}
failure_hints() {
  [ -n "${CT_CREATED:-}" ] || return 0
  echo
  if [ -z "${CT_STARTED:-}" ]; then
    echo -e "${TAB}The container ${var_ctid} was created but does not start."
    echo -e "${TAB}Show the LXC error:    ${BL}pct start ${var_ctid} --debug 1${CL}"
  else
    echo -e "${TAB}The container ${var_ctid} is running but the installation failed."
    echo -e "${TAB}Retry the install:     ${BL}pct exec ${var_ctid} -- bash -c \"\$(curl -fsSL ${INSTALL_URL})\"${CL}"
  fi
  echo -e "${TAB}Or remove it with:     ${BL}pct stop ${var_ctid}; pct destroy ${var_ctid}${CL}"
}
# Print the ERROR lines of an LXC debug start log (the real reason behind "Failed to spawn container")
show_start_error() {
  [ -s "$START_LOG" ] || return 0
  local errs
  errs="$(grep -E '(^|[[:space:]])ERROR[[:space:]]+' "$START_LOG" | sed -E 's/^(.*[[:space:]])?ERROR[[:space:]]+//' |
    grep -v -e 'sync_wait' -e '__lxc_start' | tail -n 8)"
  [ -n "$errs" ] || errs="$(grep -iE 'error|fail' "$START_LOG" | tail -n 8)"
  [ -n "$errs" ] || return 0
  echo -e "${TAB}${YW}LXC reports:${CL}"
  printf '%s\n' "$errs" | sed "s/^/${TAB}${TAB}/"
  if grep -q 'Exec format error' "$START_LOG"; then
    echo -e "${TAB}${YW}The container's binaries do not match the host architecture (${HOST_ARCH}) – wrong template.${CL}"
  fi
  echo -e "${TAB}${DGN}Full debug log: ${START_LOG}${CL}"
}
trap 'on_error $LINENO' ERR
trap 'stop_spinner' EXIT
trap 'stop_spinner; echo; msg_error "Aborted"; exit 130' INT

exit_script() {
  stop_spinner
  clear 2>/dev/null || true
  echo -e "${CROSS}${RD}User exited script${CL}\n"
  exit 0
}

# whiptail helpers (fall back to the default value when non-interactive)
ask_input() { # ask_input "title" "text" "default" → stdout
  if [ "$YES" = "1" ]; then
    echo "$3"
    return
  fi
  whiptail --backtitle "$BACKTITLE" --title "$1" --inputbox "$2" 10 64 "$3" 3>&1 1>&2 2>&3
}
ask_yesno() { # ask_yesno "title" "text" default(yes|no) → 0 = yes
  if [ "$YES" = "1" ]; then [ "$3" = "yes" ]; return; fi
  local defno=()
  [ "$3" = "no" ] && defno=(--defaultno)
  whiptail --backtitle "$BACKTITLE" --title "$1" "${defno[@]}" --yesno "$2" 12 64
}

# ---- update when run inside an existing WebSlicer container -----------------------
if ! command -v pct >/dev/null 2>&1; then
  if [ -d /opt/webslicer/server ]; then
    header_info
    [ "$(id -u)" -eq 0 ] || {
      msg_error "Run as root"
      exit 1
    }
    msg_info "Downloading the installer"
    curl -fsSL "$INSTALL_URL" -o /root/webslicer-install.sh
    msg_ok "Downloaded the installer"
    stream_install() { bash /root/webslicer-install.sh; }
  else
    echo "This script must run on a Proxmox VE host (pct not found)." >&2
    exit 1
  fi
fi

# Run install.sh (locally or in the container) and turn its "==> " / " ✔ " lines into progress.
stream_steps() {
  local line clean
  while IFS= read -r line; do
    echo "$line" >>"$LOG"
    clean="$(printf '%s' "$line" | sed 's/\x1b\[[0-9;]*m//g')"
    case "$clean" in
      "==> "*) msg_info "${clean#==> }" ;;
      " ✔ "*) msg_ok "${clean# ✔ }" ;;
      *"✖ "*) msg_error "${clean#*✖ }" ;;
      *) if [ "$VERBOSE" = "yes" ]; then echo "${TAB}${TAB}${clean}"; fi ;;
    esac
  done
  stop_spinner
  return 0
}

if ! command -v pct >/dev/null 2>&1; then
  UPDATE_RC=0
  stream_install 2>&1 | stream_steps || UPDATE_RC=$?
  if [ "$UPDATE_RC" -ne 0 ]; then
    msg_error "Update failed – last lines of ${LOG}:"
    tail -n 20 "$LOG" | sed "s/^/${TAB}${TAB}/"
    exit 1
  fi
  echo -e "\n${TAB}${GN}${APP} has been updated.${CL}\n"
  exit 0
fi

# ---- checks -----------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || {
  echo "Run as root on the Proxmox host." >&2
  exit 1
}
command -v whiptail >/dev/null 2>&1 || [ "$YES" = "1" ] || {
  echo "whiptail is required (apt install whiptail) or run with YES=1." >&2
  exit 1
}
PVE_VER="$(pveversion 2>/dev/null | sed -n 's#^pve-manager/\([0-9]*\)\..*#\1#p')"
if [ -n "$PVE_VER" ] && [ "$PVE_VER" -lt 8 ]; then
  echo "Proxmox VE 8 or newer is required (found ${PVE_VER})." >&2
  exit 1
fi
HOST_ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$HOST_ARCH" in
  amd64 | x86_64) HOST_ARCH=amd64 ;;
  arm64 | aarch64) HOST_ARCH=arm64 ;;
  *)
    echo "Unsupported architecture." >&2
    exit 1
    ;;
esac

header_info
if [ "$YES" != "1" ]; then
  whiptail --backtitle "$BACKTITLE" --title "${APP} LXC" --yesno "This will create a new ${APP} LXC container. Proceed?" 10 58 || exit_script
fi

# ---- helpers for settings ---------------------------------------------------------------
# newest Debian template for the host architecture (pveam also lists templates of other architectures)
latest_template() {
  pveam available --section system 2>/dev/null |
    awk -v re="^debian-$1-standard_.*_${HOST_ARCH}[.]tar" '$2 ~ re {print $2}' | sort -V | tail -n1
}
next_ctid() { pvesh get /cluster/nextid 2>/dev/null || echo 100; }
ctid_in_use() { pct status "$1" >/dev/null 2>&1 || qm status "$1" >/dev/null 2>&1; }
storages_for() { # content type → "name|type|avail_kib" lines
  pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1"|"$2"|"$6}'
}
human() { awk -v k="$1" 'BEGIN { g=k/1024/1024; if (g>=1024) printf "%.1f TB", g/1024; else printf "%.1f GB", g }'; }
select_storage() { # content type, purpose text, preset → stdout
  local content="$1" purpose="$2" preset="$3" lines=() menu=() first=""
  mapfile -t lines < <(storages_for "$content")
  [ "${#lines[@]}" -gt 0 ] || {
    echo "No active storage with content '${content}' found." >&2
    return 2
  }
  if [ -n "$preset" ]; then
    printf '%s\n' "${lines[@]}" | cut -d'|' -f1 | grep -qx "$preset" || {
      echo "Storage '${preset}' does not support '${content}'." >&2
      return 2
    }
    echo "$preset"
    return
  fi
  first="${lines[0]%%|*}"
  if [ "${#lines[@]}" -eq 1 ] || [ "$YES" = "1" ]; then
    echo "$first"
    return
  fi
  local l name type avail on=ON
  for l in "${lines[@]}"; do
    IFS='|' read -r name type avail <<<"$l"
    menu+=("$name" "$(printf '%-10s free %s' "$type" "$(human "$avail")")" "$on")
    on=OFF
  done
  whiptail --backtitle "$BACKTITLE" --title "Storage pools" --radiolist \
    "Which storage pool should be used for the ${purpose}?\n(Space to select, Enter to confirm)" 18 66 8 "${menu[@]}" 3>&1 1>&2 2>&3
}
bridges() {
  local d found=0
  for d in /sys/class/net/vmbr* /sys/class/net/vnet*; do
    [ -e "$d" ] || continue
    echo "${d##*/}"
    found=1
  done
  [ "$found" = 1 ] || echo vmbr0
}

default_settings() {
  var_ctid="${var_ctid:-$(next_ctid)}"
  echo -e "${TAB}${BOLD}Using default settings${CL}"
  show_settings
}

show_settings() {
  echo -e "${TAB}🖥️  Operating system:   ${BGN}Debian ${var_os_version}${CL}"
  echo -e "${TAB}📦  Container type:     ${BGN}$([ "$var_unprivileged" = 1 ] && echo Unprivileged || echo Privileged)${CL}"
  echo -e "${TAB}🆔  Container ID:       ${BGN}${var_ctid}${CL}"
  echo -e "${TAB}🏠  Hostname:           ${BGN}${var_hostname}${CL}"
  echo -e "${TAB}💾  Disk:               ${BGN}${var_disk} GB${CL}"
  echo -e "${TAB}🧠  CPU cores / RAM:    ${BGN}${var_cpu} / ${var_ram} MB${CL}"
  echo -e "${TAB}🌉  Bridge / IPv4:      ${BGN}${var_bridge} / ${var_ip}${var_gw:+ gw ${var_gw}}${var_vlan:+ vlan ${var_vlan}}${CL}"
  echo -e "${TAB}🔐  Root login:         ${BGN}$([ -n "$var_password" ] && echo password || echo 'console autologin')$([ -n "$var_sshkey" ] && echo ' + SSH key')${CL}"
  echo -e "${TAB}🌐  Web port:           ${BGN}${var_port}${CL}"
  [ -n "$var_library" ] && echo -e "${TAB}📁  Library mount:      ${BGN}${var_library}${CL}"
  echo
}

advanced_settings() {
  local v
  # OS version (only offer versions with an available template)
  local os_menu=() d12 d13
  d12="$(latest_template 12)"
  d13="$(latest_template 13)"
  [ -n "$d12" ] && os_menu+=("12" "Debian 12 Bookworm (tested)" "$([ "$var_os_version" = 12 ] && echo ON || echo OFF)")
  [ -n "$d13" ] && os_menu+=("13" "Debian 13 Trixie" "$([ "$var_os_version" = 13 ] && echo ON || echo OFF)")
  [ -z "$d12" ] && [ -n "$d13" ] && var_os_version=13
  if [ "${#os_menu[@]}" -gt 3 ]; then
    var_os_version="$(whiptail --backtitle "$BACKTITLE" --title "Operating system" --radiolist "Choose the Debian version" 12 58 2 "${os_menu[@]}" 3>&1 1>&2 2>&3)" || exit_script
  fi

  if whiptail --backtitle "$BACKTITLE" --title "Container type" --yesno "Create an UNPRIVILEGED container? (recommended)" 10 58; then var_unprivileged=1; else var_unprivileged=0; fi

  while :; do
    v="$(whiptail --backtitle "$BACKTITLE" --title "Root password" --passwordbox "Set a root password (leave blank for automatic login on the console)" 10 58 3>&1 1>&2 2>&3)" || exit_script
    if [ -z "$v" ]; then
      var_password=""
      break
    fi
    if [[ "$v" == *" "* ]]; then
      whiptail --backtitle "$BACKTITLE" --msgbox "The password must not contain spaces." 8 50
      continue
    fi
    if [ "${#v}" -lt 5 ]; then
      whiptail --backtitle "$BACKTITLE" --msgbox "The password must have at least 5 characters." 8 50
      continue
    fi
    local v2
    v2="$(whiptail --backtitle "$BACKTITLE" --title "Root password" --passwordbox "Repeat the password" 10 58 3>&1 1>&2 2>&3)" || exit_script
    if [ "$v" = "$v2" ]; then
      var_password="$v"
      break
    fi
    whiptail --backtitle "$BACKTITLE" --msgbox "Passwords do not match." 8 50
  done

  while :; do
    v="$(ask_input "Container ID" "Set the container ID" "${var_ctid:-$(next_ctid)}")" || exit_script
    if ! [[ "$v" =~ ^[0-9]+$ ]] || [ "$v" -lt 100 ]; then
      whiptail --backtitle "$BACKTITLE" --msgbox "The ID must be a number ≥ 100." 8 50
    elif ctid_in_use "$v"; then
      whiptail --backtitle "$BACKTITLE" --msgbox "ID ${v} is already in use." 8 50
    else
      var_ctid="$v"
      break
    fi
  done

  while :; do
    v="$(ask_input "Hostname" "Set the hostname" "$var_hostname")" || exit_script
    v="${v,,}"
    if [[ "$v" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
      var_hostname="$v"
      break
    fi
    whiptail --backtitle "$BACKTITLE" --msgbox "Invalid hostname (letters, digits and dashes)." 8 54
  done

  while :; do
    v="$(ask_input "Disk size" "Disk size in GB (minimum 8)" "$var_disk")" || exit_script
    [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 8 ] && {
      var_disk="$v"
      break
    }
    whiptail --backtitle "$BACKTITLE" --msgbox "Enter a number of GB ≥ 8." 8 50
  done
  while :; do
    v="$(ask_input "CPU cores" "Number of CPU cores (more cores = faster slicing of large models)" "$var_cpu")" || exit_script
    [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 1 ] && {
      var_cpu="$v"
      break
    }
  done
  while :; do
    v="$(ask_input "RAM" "RAM in MB (minimum 2048, large models need 4096+)" "$var_ram")" || exit_script
    [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 2048 ] && {
      var_ram="$v"
      break
    }
    whiptail --backtitle "$BACKTITLE" --msgbox "Enter at least 2048 MB." 8 50
  done

  local bmenu=() b
  for b in $(bridges); do bmenu+=("$b" "" "$([ "$b" = "$var_bridge" ] && echo ON || echo OFF)"); done
  if [ "${#bmenu[@]}" -gt 3 ]; then
    var_bridge="$(whiptail --backtitle "$BACKTITLE" --title "Network bridge" --radiolist "Choose the network bridge" 14 50 6 "${bmenu[@]}" 3>&1 1>&2 2>&3)" || exit_script
  else
    var_bridge="$(ask_input "Network bridge" "Network bridge" "$var_bridge")" || exit_script
  fi

  while :; do
    v="$(ask_input "IPv4" "IPv4 address with CIDR (e.g. 192.168.1.50/24) or 'dhcp'" "$var_ip")" || exit_script
    if [ "$v" = "dhcp" ] || [[ "$v" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then
      var_ip="$v"
      break
    fi
    whiptail --backtitle "$BACKTITLE" --msgbox "Use 'dhcp' or an address like 192.168.1.50/24." 8 56
  done
  if [ "$var_ip" != "dhcp" ]; then
    while :; do
      v="$(ask_input "Gateway" "IPv4 gateway" "$var_gw")" || exit_script
      [[ "$v" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && {
        var_gw="$v"
        break
      }
      whiptail --backtitle "$BACKTITLE" --msgbox "Enter a gateway address like 192.168.1.1." 8 56
    done
  else
    var_gw=""
  fi
  var_ip6="$(whiptail --backtitle "$BACKTITLE" --title "IPv6" --radiolist "IPv6 configuration" 13 50 4 \
    none "No IPv6" "$([ "$var_ip6" = none ] && echo ON || echo OFF)" \
    auto "SLAAC" "$([ "$var_ip6" = auto ] && echo ON || echo OFF)" \
    dhcp "DHCPv6" "$([ "$var_ip6" = dhcp ] && echo ON || echo OFF)" 3>&1 1>&2 2>&3)" || exit_script
  var_vlan="$(ask_input "VLAN" "VLAN tag (leave blank for none)" "$var_vlan")" || exit_script
  var_mtu="$(ask_input "MTU" "Interface MTU (leave blank for default)" "$var_mtu")" || exit_script
  var_mac="$(ask_input "MAC address" "MAC address (leave blank for automatic)" "$var_mac")" || exit_script
  var_dns="$(ask_input "DNS server" "DNS server IP (leave blank to use the host settings)" "$var_dns")" || exit_script
  var_searchdomain="$(ask_input "DNS search domain" "DNS search domain (leave blank to use the host settings)" "$var_searchdomain")" || exit_script

  v="$(ask_input "SSH key" "Path to a public SSH key file for root (leave blank for none)" "$var_sshkey")" || exit_script
  if [ -n "$v" ] && [ ! -f "$v" ]; then
    whiptail --backtitle "$BACKTITLE" --msgbox "File ${v} not found – no SSH key will be installed." 8 60
    v=""
  fi
  var_sshkey="$v"
  if [ -n "$var_password" ] && ask_yesno "SSH" "Allow root login over SSH with the password?" "no"; then var_ssh=yes; else var_ssh=no; fi

  while :; do
    v="$(ask_input "Web port" "Port of the WebSlicer web interface" "$var_port")" || exit_script
    [[ "$v" =~ ^[0-9]+$ ]] && [ "$v" -ge 1 ] && [ "$v" -le 65535 ] && {
      var_port="$v"
      break
    }
  done

  if ask_yesno "Model library" "Mount a directory of the Proxmox host (e.g. a NAS share) as the WebSlicer model library?\n\nSTL/3MF files placed there can be opened in WebSlicer, projects and G-code can be saved there." "no"; then
    while :; do
      v="$(ask_input "Model library" "Host directory to mount (must exist)" "${var_library:-/mnt/pve/}")" || exit_script
      [ "$v" != "/" ] && v="${v%/}"
      [ -d "$v" ] && {
        var_library="$v"
        break
      }
      whiptail --backtitle "$BACKTITLE" --msgbox "Directory ${v} does not exist on the host." 8 60
    done
  else
    var_library=""
  fi

  var_prusaslicer="$(ask_input "PrusaSlicer" "PrusaSlicer version (leave blank for the installer default)" "$var_prusaslicer")" || exit_script
  var_tags="$(ask_input "Tags" "Proxmox tags (separated by ;)" "$var_tags")" || exit_script
  if ask_yesno "Verbose mode" "Show the full output of all installation steps?" "no"; then VERBOSE=yes; else VERBOSE=no; fi

  echo -e "${TAB}${BOLD}Using advanced settings${CL}"
  show_settings
  whiptail --backtitle "$BACKTITLE" --title "Ready" --yesno "Ready to create the ${APP} LXC with these settings?" 10 58 || exit_script
}

# ---- choose settings ---------------------------------------------------------------
if [ "$YES" = "1" ]; then
  default_settings
else
  CHOICE="$(whiptail --backtitle "$BACKTITLE" --title "Settings" --menu "Choose an option:" 13 58 3 \
    "1" "Default settings" \
    "2" "Advanced settings" \
    "3" "Exit" 3>&1 1>&2 2>&3)" || exit_script
  case "$CHOICE" in
    1)
      header_info
      default_settings
      ;;
    2)
      header_info
      advanced_settings
      ;;
    *) exit_script ;;
  esac
fi
var_ctid="${var_ctid:-$(next_ctid)}"
if [ -n "$var_library" ]; then
  [ "$var_library" != "/" ] && var_library="${var_library%/}"
  [ -d "$var_library" ] || {
    msg_error "Library directory ${var_library} does not exist on the host"
    exit 1
  }
fi
if ctid_in_use "$var_ctid"; then
  msg_error "Container ID ${var_ctid} is already in use"
  exit 1
fi

pick_storage() { # content purpose preset → stdout; cancel → exit_script, error → exit 1
  local out rc=0
  out="$(select_storage "$@")" || rc=$?
  [ "$rc" -eq 0 ] && {
    echo "$out"
    return 0
  }
  [ "$rc" -eq 1 ] && exit_script
  exit 1
}
var_storage="$(pick_storage rootdir "container disk" "$var_storage")"
var_tstorage="$(pick_storage vztmpl "LXC templates" "$var_tstorage")"
echo -e "${TAB}💽  Container storage:  ${BGN}${var_storage}${CL}"
echo -e "${TAB}📀  Template storage:   ${BGN}${var_tstorage}${CL}\n"
echo -e "${TAB}${DGN}Log file: ${LOG}${CL}\n"

# ---- template ------------------------------------------------------------------------
msg_info "Updating the template list"
run pveam update || true
TEMPLATE="$(latest_template "$var_os_version")"
[ -n "$TEMPLATE" ] || {
  msg_error "No Debian ${var_os_version} template for ${HOST_ARCH} available"
  exit 1
}
msg_ok "Template ${TEMPLATE}"
if ! pveam list "$var_tstorage" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg_info "Downloading the LXC template"
  run pveam download "$var_tstorage" "$TEMPLATE"
  msg_ok "Downloaded the LXC template"
fi

# ---- create ------------------------------------------------------------------------------
NET="name=eth0,bridge=${var_bridge},ip=${var_ip}"
[ -n "$var_gw" ] && NET+=",gw=${var_gw}"
[ "$var_ip6" != "none" ] && NET+=",ip6=${var_ip6}"
[ -n "$var_vlan" ] && NET+=",tag=${var_vlan}"
[ -n "$var_mtu" ] && NET+=",mtu=${var_mtu}"
[ -n "$var_mac" ] && NET+=",hwaddr=${var_mac}"
DESC="<div align='center'><h2>WebSlicer</h2><p>3D printing slicer in the browser (PrusaSlicer engine)</p><p><a href='${WEBSLICER_REPO%.git}'>GitHub</a> · update: type <code>update</code> in the console</p></div>"
ARGS=(
  "$var_ctid" "${var_tstorage}:vztmpl/${TEMPLATE}"
  --hostname "$var_hostname"
  --cores "$var_cpu" --memory "$var_ram" --swap "$var_swap"
  --rootfs "${var_storage}:${var_disk}"
  --net0 "$NET"
  --unprivileged "$var_unprivileged"
  --features "nesting=1"
  --onboot 1
  --ostype debian
  --timezone host
  --tags "$var_tags"
  --description "$DESC"
)
[ -n "$var_password" ] && ARGS+=(--password "$var_password")
[ -n "$var_sshkey" ] && ARGS+=(--ssh-public-keys "$var_sshkey")
[ -n "$var_dns" ] && ARGS+=(--nameserver "$var_dns")
[ -n "$var_searchdomain" ] && ARGS+=(--searchdomain "$var_searchdomain")

msg_info "Creating LXC container ${var_ctid}"
run pct create "${ARGS[@]}"
CT_CREATED=1
msg_ok "Created LXC container ${var_ctid} (${var_hostname})"

if [ -n "$var_library" ]; then
  msg_info "Mounting the model library"
  run pct set "$var_ctid" -mp0 "${var_library},mp=/var/lib/webslicer/library"
  msg_ok "Mounted ${var_library} as model library"
fi

start_ct() { # start the container; on failure keep an LXC debug log for show_start_error
  run pct start "$var_ctid" && return 0
  pct start "$var_ctid" --debug 1 >"$START_LOG" 2>&1 || true
  pct status "$var_ctid" 2>/dev/null | grep -q running
}
msg_info "Starting the container"
if ! start_ct; then
  stop_spinner
  if [ -n "$var_library" ]; then
    msg_error "The container does not start with the model library mount"
    show_start_error
    msg_info "Retrying without the model library mount"
    run pct set "$var_ctid" -delete mp0
    if start_ct; then
      msg_ok "Started without the model library"
      LIB_FAILED="$var_library"
      var_library=""
    else
      msg_error "The container does not start either without the library mount"
      show_start_error
      false
    fi
  else
    msg_error "The container does not start"
    show_start_error
    false
  fi
fi
[ -n "${LIB_FAILED:-}" ] || msg_ok "Started the container"
CT_STARTED=1
msg_info "Waiting for the network"
for _ in $(seq 1 30); do
  pct exec "$var_ctid" -- bash -c "getent hosts deb.debian.org >/dev/null 2>&1" && break
  sleep 2
done
pct exec "$var_ctid" -- bash -c "getent hosts deb.debian.org >/dev/null 2>&1" || {
  msg_error "The container has no network / DNS"
  false
}
msg_ok "Container is running, network is up"

msg_info "Customizing the container"
if [ -z "$var_password" ]; then
  # automatic root login on the Proxmox console (like the community-scripts)
  run pct exec "$var_ctid" -- bash -c 'mkdir -p /etc/systemd/system/container-getty@1.service.d && printf "[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin root --noclear --keep-baud tty%%I 115200,38400,9600 \$TERM\n" > /etc/systemd/system/container-getty@1.service.d/override.conf && systemctl daemon-reload && systemctl restart container-getty@1.service'
fi
if [ "$var_ssh" = "yes" ]; then
  run pct exec "$var_ctid" -- bash -c "sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && systemctl restart ssh"
fi
run pct exec "$var_ctid" -- bash -c "export LANG=C.UTF-8; apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null"
msg_ok "Customized the container"

# ---- install WebSlicer (progress from install.sh) ----------------------------------------
ENVS=(LANG=C.UTF-8 LC_ALL=C.UTF-8 "WEBSLICER_REPO=${WEBSLICER_REPO}" "WEBSLICER_BRANCH=${WEBSLICER_BRANCH}" "WEBSLICER_PORT=${var_port}")
[ -n "$var_prusaslicer" ] && ENVS+=("PRUSASLICER_VERSION=${var_prusaslicer}")
[ -n "${PRUSASLICER_URL:-}" ] && ENVS+=("PRUSASLICER_URL=${PRUSASLICER_URL}")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
REPO_ROOT=""
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/../package.json" ] && [ -f "${SCRIPT_DIR}/install.sh" ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
if [ -n "$REPO_ROOT" ]; then
  msg_info "Copying the local WebSlicer sources"
  TARBALL="$(mktemp --suffix=.tar.gz)"
  tar -C "$REPO_ROOT" --exclude=node_modules --exclude='*/node_modules' --exclude=dist --exclude='*/dist' \
    --exclude=data --exclude=.git --exclude=library -czf "$TARBALL" .
  run pct push "$var_ctid" "$TARBALL" /root/webslicer-src.tar.gz
  run pct push "$var_ctid" "${REPO_ROOT}/proxmox/install.sh" /root/webslicer-install.sh
  rm -f "$TARBALL"
  ENVS+=("WEBSLICER_SRC=/root/webslicer-src.tar.gz")
  msg_ok "Copied the local sources"
else
  run pct exec "$var_ctid" -- curl -fsSL "$INSTALL_URL" -o /root/webslicer-install.sh
fi

# "|| rc=$?" keeps the ERR trap quiet; with pipefail $? is the exit code of install.sh
INSTALL_RC=0
pct exec "$var_ctid" -- env "${ENVS[@]}" bash /root/webslicer-install.sh 2>&1 | stream_steps || INSTALL_RC=$?
if [ "$INSTALL_RC" -ne 0 ]; then
  stop_spinner
  msg_error "The installation inside the container failed"
  echo -e "${TAB}${YW}Last lines of ${LOG}:${CL}"
  tail -n 20 "$LOG" | sed "s/^/${TAB}${TAB}/"
  failure_hints
  exit 1
fi

if [ -n "$var_library" ]; then
  LIB_TEST="/var/lib/webslicer/library/.webslicer-write-test"
  if ! pct exec "$var_ctid" -- su -s /bin/sh webslicer -c "touch '${LIB_TEST}' && rm -f '${LIB_TEST}'" >>"$LOG" 2>&1; then
    HOST_UID="$([ "$var_unprivileged" = 1 ] && echo $((100000 + SERVICE_UID)) || echo "$SERVICE_UID")"
    case "$(stat -f -c %T "$var_library" 2>/dev/null)" in
      cifs | smb2 | smb3)
        LIB_HINT="The model library is read-only for WebSlicer. ${var_library} is a CIFS/SMB share:
      ownership comes from the mount options – mount it with uid=${HOST_UID},gid=${HOST_UID}
      (for a Proxmox storage: pvesm set <storage> --options uid=${HOST_UID},gid=${HOST_UID}, then remount)" ;;
      nfs*)
        LIB_HINT="The model library is read-only for WebSlicer. ${var_library} is an NFS export:
      allow writes for uid/gid ${HOST_UID} on the NAS (or map all users to an account that may write)" ;;
      *)
        LIB_HINT="The model library is read-only for WebSlicer. Make it writable for uid ${HOST_UID}:
      chown ${HOST_UID}:${HOST_UID} ${var_library}   (and any subfolders WebSlicer should save into)" ;;
    esac
  fi
fi
if [ -n "${LIB_FAILED:-}" ]; then
  LIB_HINT="The container did not start with ${LIB_FAILED} mounted, so WebSlicer was installed without
      a model library (see the LXC error above and ${START_LOG}).
      Add it later with:  pct set ${var_ctid} -mp0 ${LIB_FAILED},mp=/var/lib/webslicer/library"
fi

# ---- summary ------------------------------------------------------------------------------
CT_IP="$(pct exec "$var_ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
echo
msg_ok "Completed successfully!"
echo
echo -e "${TAB}🚀  ${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${TAB}🌐  Access it using the following URL:"
echo -e "${TAB}${TAB}${BGN}http://${CT_IP:-<container-ip>}:${var_port}${CL}"
echo
echo -e "${TAB}🔄  Update:   ${BL}pct exec ${var_ctid} -- update${CL}  (or type ${BL}update${CL} in the container console)"
echo -e "${TAB}📜  Logs:     ${BL}pct exec ${var_ctid} -- journalctl -u webslicer -f${CL}"
echo -e "${TAB}🗒️   Install log: ${LOG}"
[ -z "$var_password" ] && echo -e "${TAB}🔐  Root login: automatic on the Proxmox console (no password set)"
[ -n "${LIB_HINT:-}" ] && echo -e "\n${TAB}${YW}⚠️  ${LIB_HINT}${CL}"
echo
