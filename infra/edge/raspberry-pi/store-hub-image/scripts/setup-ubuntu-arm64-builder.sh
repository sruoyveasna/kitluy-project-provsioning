#!/usr/bin/env bash
# KitLuy OS image — Ubuntu/Debian amd64 ARM64 build-host setup.
#
#   sudo bash infra/edge/raspberry-pi/store-hub-image/scripts/setup-ubuntu-arm64-builder.sh
#
# Turns an amd64 Ubuntu/Debian workstation into a host that can CROSS-BUILD the
# KitLuy Raspberry Pi arm64 images. This is the DEVELOPMENT path: the supported
# native path is an arm64 Debian / Raspberry Pi OS host
# (upstream.pin: KITLUY_RIG_NATIVE_BUILD_ARCH="arm64"). Nothing built on this
# host is hardware-certified.
#
# CONTRACT
#   idempotent      — rerunning changes nothing once the host is ready
#   fail-fast       — refuses on an unsupported host rather than guessing
#   non-destructive — installs only; removes no package, stops no service,
#                     touches no unrelated binfmt handler, prunes no container
#
# WHERE THE PACKAGE LIST COMES FROM
# ---------------------------------
# The authority is the `depends` manifest of the PINNED upstream builder, not
# this file. A hand-maintained second list would drift from the pin silently,
# and the first symptom of that drift is a build that dies 20 minutes in.
# So when a pinned checkout is present this script delegates to upstream's own
# `install_deps.sh`; the list below is the recorded fallback, captured from
# `depends` at KITLUY_RIG_COMMIT, used only when no checkout is available.
#
# Authority: mission §24 (builder pinning), §25 (build-host classification).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KITLUY_OS_IMAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PIN_FILE="${KITLUY_OS_IMAGE_ROOT}/rpi-image-gen/upstream.pin"

log()  { printf '[kitluy-arm64-setup] %s\n' "$*" >&2; }
warn() { printf '[kitluy-arm64-setup] WARNING: %s\n' "$*" >&2; }
die()  { printf '[kitluy-arm64-setup] REFUSED: %s\n' "$*" >&2; exit 1; }

# --- Host preconditions -------------------------------------------------------

[[ $(id -u) -eq 0 ]] || die "must run as root (use: sudo bash $0)"

command -v apt-get >/dev/null 2>&1 \
  || die "no apt-get — this script supports Debian/Ubuntu hosts only"

HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  x86_64)
    log "host is ${HOST_ARCH} — configuring a DEVELOPMENT CROSS-BUILD host (QEMU/binfmt required)"
    NEED_EMULATION="yes"
    ;;
  aarch64|arm64)
    log "host is ${HOST_ARCH} — native arm64 host, no emulation required"
    NEED_EMULATION="no"
    ;;
  *)
    die "unsupported host architecture '${HOST_ARCH}' (expected x86_64 or aarch64)"
    ;;
esac

# --- Recorded fallback package list ------------------------------------------
# Captured from the pinned upstream `depends` (categories: all, bootstrap,
# build) plus the cross-build prerequisites upstream documents separately in
# getting_started.adoc for amd64 hosts.
#
# NOT in this list on purpose:
#   genimage  — upstream BUILDS genimage 19 from source with its own dm-verity
#               patches (package/genimage/patches/19/). The distro genimage has
#               no verity handler, so installing it would satisfy a `command -v`
#               check with a binary that cannot produce the partition layout
#               Hub spec §6.8 requires. Worse than missing.
#   bdebstrap — likewise built from source by upstream (package/bdebstrap/).
#   debootstrap — upstream uses mmdebstrap; debootstrap is not referenced.
KITLUY_RIG_HOST_PACKAGES=(
  # bootstrap category
  python3 python3-yaml python3-debian dpkg-dev
  # build category — image assembly
  mmdebstrap debian-archive-keyring podman uidmap dbus-user-session
  zip dosfstools e2fsprogs rsync curl mtools pv btrfs-progs
  dctrl-tools uuid-runtime fdisk python3-jsonschema cryptsetup
  # build category — upstream's from-source package buildsystem
  python3-pip make build-essential autoconf automake libtool
  autopoint flex gettext pkgconf
  # KitLuy: fetching the pinned builder
  git ca-certificates
)

KITLUY_CROSS_PACKAGES=(qemu-user-static binfmt-support)

# --- binfmt pre-flight --------------------------------------------------------
# qemu-user-static's postinst registers arm64 through update-binfmts. If a
# handler of the same name is already registered by something else — most often
# `docker run --privileged tonistiigi/binfmt` — update-binfmts does not own it
# and cannot manage it, which is exactly the state that produces a host where
# ARM64 works today and silently stops working after a reboot.
#
# So a FOREIGN registration is removed first, and only then. A handler that
# update-binfmts already owns is left completely alone.
deregister_foreign_aarch64_handler() {
  local handler=/proc/sys/fs/binfmt_misc/qemu-aarch64
  [[ -e "$handler" ]] || return 0

  if [[ -e /var/lib/binfmts/qemu-aarch64 ]]; then
    log "existing qemu-aarch64 handler is managed by update-binfmts — leaving it alone"
    return 0
  fi

  log "removing a foreign (non-update-binfmts) qemu-aarch64 registration so the"
  log "packaged, reboot-persistent registration can take ownership"
  echo -1 > "$handler" 2>/dev/null \
    || warn "could not remove the existing handler; qemu-user-static may warn below"
}

# --- Install ------------------------------------------------------------------

export DEBIAN_FRONTEND=noninteractive

log "apt-get update"
apt-get update -q

if [[ "$NEED_EMULATION" == "yes" ]]; then
  deregister_foreign_aarch64_handler
  log "installing ARM64 emulation: ${KITLUY_CROSS_PACKAGES[*]}"
  apt-get install -q -y --no-install-recommends "${KITLUY_CROSS_PACKAGES[@]}"
fi

# Prefer upstream's own dependency installer when the pinned tree is present:
# it is the authority, and it is re-read rather than trusted from memory.
UPSTREAM_DIR="${KITLUY_RIG_UPSTREAM:-${KITLUY_OS_IMAGE_ROOT}/build/upstream}"
if [[ -x "${UPSTREAM_DIR}/install_deps.sh" && -f "${UPSTREAM_DIR}/depends" ]]; then
  if [[ -f "$PIN_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$PIN_FILE"
    ACTUAL_COMMIT="$(git -C "$UPSTREAM_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
    if [[ "$ACTUAL_COMMIT" != "${KITLUY_RIG_COMMIT:-}" ]]; then
      die "upstream checkout at ${UPSTREAM_DIR} is ${ACTUAL_COMMIT}, pin requires ${KITLUY_RIG_COMMIT:-unset}"
    fi
    log "upstream checkout matches the pin (${KITLUY_RIG_TAG:-?} / ${ACTUAL_COMMIT})"
  fi
  log "delegating host dependencies to the pinned upstream install_deps.sh"
  ( cd "$UPSTREAM_DIR" && ./install_deps.sh )
else
  log "no pinned upstream checkout at ${UPSTREAM_DIR} — installing the recorded list"
  log "packages: ${KITLUY_RIG_HOST_PACKAGES[*]}"
  apt-get install -q -y --no-install-recommends "${KITLUY_RIG_HOST_PACKAGES[@]}"
fi

# --- Verify -------------------------------------------------------------------
# An install that reports success but leaves the host unable to execute arm64 is
# the failure mode this whole script exists to prevent, so it is checked here
# rather than left to the first 20-minute build.

log "verifying ARM64 binfmt registration"
if [[ "$NEED_EMULATION" == "yes" ]]; then
  if [[ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]]; then
    warn "no qemu-aarch64 handler is registered."
    warn "recover with either:"
    warn "  sudo systemctl restart systemd-binfmt   (packaged, persistent)"
    warn "  docker run --privileged --rm tonistiigi/binfmt --install arm64  (temporary)"
  else
    grep -q '^enabled' /proc/sys/fs/binfmt_misc/qemu-aarch64 \
      && log "qemu-aarch64 handler: enabled" \
      || warn "qemu-aarch64 handler is registered but DISABLED"
  fi
fi

log "host setup complete."
log "verify with: bash infra/edge/raspberry-pi/store-hub-image/scripts/doctor.sh"
