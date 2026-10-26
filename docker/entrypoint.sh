#!/bin/sh
# ---------------------------------------------------------------------------
# Runtime entrypoint.
#
# The app itself never runs as root: the image has no `USER` line, so a plain
# `docker run` starts this script as root, which maps the runtime user, fixes the
# ownership of the data volume and drops to that user. NAS systems (Unraid) pass
# their own ids with PUID/PGID; without them the app runs as `node` (1000:1000).
#
#   docker run …                            → node (1000:1000), as before
#   docker run -e PUID=99 -e PGID=100 …     → 99:100
#   docker run --user 99:100 …              → as given; the mounts must already fit
#
# Set both ids: a missing one falls back to 1000, so `PUID=99` alone is not 99:100.
# `/data` is handed over recursively, `/library` only as a directory – a library on
# a NAS share can be huge and the app only needs the top directory; write access
# has to come from the host mount (`chown 99:100 /mnt/user/models`).
# ---------------------------------------------------------------------------
set -eu

DEFAULT_UID=1000
DEFAULT_GID=1000

log() {
  echo "entrypoint: $*" >&2
}

# Not started as root (`--user`, a rootless runtime, Kubernetes): nothing can be
# mapped or chowned and the caller owns the ids and the mount permissions.
if [ "$(id -u)" -ne 0 ]; then
  exec "$@"
fi

uid="${PUID:-$DEFAULT_UID}"
gid="${PGID:-$DEFAULT_GID}"
case "$uid" in
  '' | *[!0-9]*)
    log "PUID must be a numeric user id, got '$uid'"
    exit 1
    ;;
esac
case "$gid" in
  '' | *[!0-9]*)
    log "PGID must be a numeric group id, got '$gid'"
    exit 1
    ;;
esac

# A passwd/group entry makes `--init-groups` and anything printing a user name
# work; the numeric ids are what the files use. Entry present → let setpriv read
# the supplementary groups; absent (id below Debian's UID_MIN, or a read-only
# /etc) → run with the bare ids.
if ! getent group "$gid" >/dev/null 2>&1; then
  groupadd --gid "$gid" webslicer
fi
if getent passwd "$uid" >/dev/null 2>&1; then
  groups=--init-groups
else
  # Debian warns for ids below UID_MIN (1000) – expected for NAS ids, so the
  # warning is dropped and only a real failure is reported.
  if useradd --uid "$uid" --gid "$gid" --home-dir /tmp --no-create-home --shell /usr/sbin/nologin webslicer 2>/dev/null; then
    groups=--init-groups
  else
    log "could not create a user entry for uid $uid – continuing with the bare ids"
    groups=--clear-groups
  fi
fi

# Ownership is only touched when it differs, so a restart over an already
# prepared volume does no work.
fix_owner() {
  dir=$1
  recursive=$2
  [ -d "$dir" ] || return 0
  [ "$(stat -c '%u:%g' "$dir")" = "$uid:$gid" ] && return 0
  if [ "$recursive" = yes ]; then
    chown -R "$uid:$gid" "$dir" || log "warning: could not hand $dir over to $uid:$gid"
  else
    chown "$uid:$gid" "$dir" || log "warning: could not hand $dir over to $uid:$gid"
  fi
}

log "starting as $uid:$gid"

# A directory the app cannot write to would fail halfway through the start; say
# so before it does.
check_write() {
  dir=$1
  [ -d "$dir" ] || return 0
  setpriv --reuid="$uid" --regid="$gid" "$groups" -- test -w "$dir" ||
    log "warning: $dir is not writable for $uid:$gid – give the mount those ids on the host"
}

fix_owner "${DATA_DIR:-/data}" yes
fix_owner "${LIBRARY_DIR:-/library}" no
check_write "${DATA_DIR:-/data}"
check_write "${LIBRARY_DIR:-/library}"

exec setpriv --reuid="$uid" --regid="$gid" "$groups" -- "$@"
