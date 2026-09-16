#!/usr/bin/env bash
# KitLuy OS image — build-host doctor.
#
#   bash infra/edge/raspberry-pi/pi-terminal-image/scripts/doctor.sh
#
# One reproducible verification path for the image build host. Reports what is
# present, what is missing, and what the host can actually DO — an arm64
# execution probe, not just a package inventory, because a host can have every
# package installed and still be unable to run an arm64 binary.
#
# Runs unprivileged. Installs nothing. Changes nothing. Prints no secret: it
# reports tool names, versions and capability states only.
#
# Exit: 0 = ready to attempt a development cross-build
#       1 = a required capability is missing (see FAIL lines)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KITLUY_OS_IMAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PIN_FILE="${KITLUY_OS_IMAGE_ROOT}/rpi-image-gen/upstream.pin"

# Minimum free space for a development image build. The Hub profile alone is a
# 4G system slot plus an 8G data partition, before the apt cache and the
# intermediate rootfs, so a host that "has some space" is not good enough.
MIN_FREE_GIB=25

PASS=0; FAIL=0; WARN=0
ok()   { printf '  PASS  %-34s %s\n' "$1" "${2:-}"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL  %-34s %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }
note() { printf '  WARN  %-34s %s\n' "$1" "${2:-}"; WARN=$((WARN + 1)); }
info() { printf '        %-34s %s\n' "$1" "${2:-}"; }
head_() { printf '\n%s\n' "$1"; }

printf '\nKitLuy OS image — build host doctor\n'

# --- Host ---------------------------------------------------------------------
head_ "HOST"
HOST_ARCH="$(uname -m)"
info "kernel" "$(uname -sr)"
info "architecture" "$HOST_ARCH"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  info "distribution" "$(. /etc/os-release && printf '%s' "$PRETTY_NAME")"
fi
info "cpus" "$(nproc 2>/dev/null || echo '?')"
info "memory" "$(free -h 2>/dev/null | awk '/^Mem:/{print $2" total, "$7" available"}')"

case "$HOST_ARCH" in
  aarch64|arm64) NEED_EMULATION="no";  info "build class" "NATIVE arm64 (supported path)" ;;
  x86_64)        NEED_EMULATION="yes"; info "build class" "DEVELOPMENT CROSS-BUILD via QEMU — not hardware-certified" ;;
  *)             NEED_EMULATION="yes"; info "build class" "UNSUPPORTED host architecture" ;;
esac

FREE_GIB="$(df -PBG "${KITLUY_OS_IMAGE_ROOT}" 2>/dev/null | awk 'NR==2{gsub(/G/,"",$4); print $4}')"
if [[ -n "${FREE_GIB:-}" && "$FREE_GIB" -ge "$MIN_FREE_GIB" ]]; then
  ok "free disk" "${FREE_GIB}G available (need ${MIN_FREE_GIB}G)"
else
  bad "free disk" "${FREE_GIB:-?}G available, need ${MIN_FREE_GIB}G"
fi

# --- Pinned builder -----------------------------------------------------------
head_ "PINNED BUILDER"
if [[ -f "$PIN_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$PIN_FILE"
  ok "upstream.pin" "${KITLUY_RIG_TAG:-?} / ${KITLUY_RIG_COMMIT:-?}"
else
  bad "upstream.pin" "missing — the build cannot be called reproducible"
fi

UPSTREAM_DIR="${KITLUY_RIG_UPSTREAM:-${KITLUY_OS_IMAGE_ROOT}/build/upstream}"
if [[ -x "${UPSTREAM_DIR}/rpi-image-gen" ]]; then
  ACTUAL="$(git -C "$UPSTREAM_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [[ "$ACTUAL" == "${KITLUY_RIG_COMMIT:-}" ]]; then
    ok "upstream checkout" "$UPSTREAM_DIR (matches pin)"
  else
    bad "upstream checkout" "$ACTUAL != pin ${KITLUY_RIG_COMMIT:-unset}"
  fi
else
  note "upstream checkout" "absent at ${UPSTREAM_DIR} — fetch it to build"
fi

# --- Container runtimes -------------------------------------------------------
# Two DIFFERENT runtimes, for two different jobs. Neither substitutes for the
# other, which is the detail most easily got wrong here:
#   podman — REQUIRED. The pinned builder runs its whole filesystem stage inside
#            `podman unshare` (bin/ns), rootless. No podman, no image.
#   docker — OPTIONAL. Used only to register binfmt and to probe arm64.
head_ "CONTAINER RUNTIMES"
if command -v podman >/dev/null 2>&1; then
  ok "podman (required by builder)" "$(podman --version 2>/dev/null | head -1)"
  if podman unshare true >/dev/null 2>&1; then
    ok "podman unshare (rootless)" "usable — the builder needs no root and no --privileged"
  else
    bad "podman unshare (rootless)" "failed — check /etc/subuid and /etc/subgid for $(id -un)"
  fi
else
  bad "podman (required by builder)" "MISSING — rpi-image-gen bin/ns cannot run"
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "docker (optional)" "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  if docker buildx version >/dev/null 2>&1; then
    info "buildx" "$(docker buildx version 2>/dev/null | awk '{print $2}')"
  fi
else
  note "docker (optional)" "unavailable — only affects the binfmt/probe convenience path"
fi

# --- ARM64 emulation ----------------------------------------------------------
head_ "ARM64 EMULATION"
if [[ "$NEED_EMULATION" == "no" ]]; then
  ok "binfmt/QEMU" "not required on a native arm64 host"
else
  if grep -q /proc/sys/fs/binfmt_misc /proc/mounts 2>/dev/null; then
    ok "binfmt_misc mounted" "$(awk '$2=="/proc/sys/fs/binfmt_misc"{print $3; exit}' /proc/mounts)"
  else
    bad "binfmt_misc mounted" "not mounted — run: sudo modprobe binfmt_misc"
  fi

  HANDLER=/proc/sys/fs/binfmt_misc/qemu-aarch64
  if [[ -e "$HANDLER" ]]; then
    if grep -q '^enabled' "$HANDLER" 2>/dev/null; then
      ok "qemu-aarch64 handler" "enabled ($(awk '/^interpreter/{print $2}' "$HANDLER"))"
    else
      bad "qemu-aarch64 handler" "registered but DISABLED"
    fi
    # Reboot persistence. A handler that update-binfmts does not own disappears
    # on reboot, and the host then fails a build it passed yesterday.
    if [[ -e /var/lib/binfmts/qemu-aarch64 ]]; then
      ok "binfmt persistence" "update-binfmts owns it — survives reboot"
    elif [[ -e /usr/lib/binfmt.d/qemu-aarch64.conf || -e /etc/binfmt.d/qemu-aarch64.conf ]]; then
      ok "binfmt persistence" "systemd-binfmt owns it — survives reboot"
    else
      note "binfmt persistence" "registration is TEMPORARY (in-kernel only) — lost on reboot; rerun setup-ubuntu-arm64-builder.sh"
    fi
  else
    bad "qemu-aarch64 handler" "not registered — arm64 binaries cannot execute"
  fi

  if command -v qemu-aarch64-static >/dev/null 2>&1; then
    ok "qemu-aarch64-static" "$(qemu-aarch64-static --version 2>/dev/null | head -1)"
  else
    note "qemu-aarch64-static" "absent on host (fine if the handler preloads its interpreter, flag F)"
  fi
fi

# --- Host tooling required by the pinned builder ------------------------------
# Derived from the pinned upstream `depends`. Split deliberately: a tool the
# builder COMPILES from source must not be reported as a host gap, and a distro
# build of it must not be reported as satisfying the requirement.
head_ "HOST TOOLING (pinned upstream depends)"
REQUIRED_TOOLS=(
  mmdebstrap dpkg-architecture python3 rsync curl grep make
  mkfs.vfat mkfs.ext4 mkfs.btrfs fdisk veritysetup uuidgen
  mtools pv zip newuidmap autoconf automake autopoint flex gettext pkg-config
  # unzip: the pinned Electron runtime ships as a .zip, and fetch-electron.sh
  # unpacks it. Without this the terminal build fails AFTER downloading 100 MB,
  # which is a slow way to learn that a package is missing.
  unzip
)
MISSING=()
for t in "${REQUIRED_TOOLS[@]}"; do
  command -v "$t" >/dev/null 2>&1 || MISSING+=("$t")
done
if [[ ${#MISSING[@]} -eq 0 ]]; then
  ok "required host tools" "all ${#REQUIRED_TOOLS[@]} present"
else
  bad "required host tools" "missing: ${MISSING[*]}"
fi

for t in mmdebstrap veritysetup mkfs.ext4 mkfs.vfat parted xz; do
  if command -v "$t" >/dev/null 2>&1; then
    case "$t" in
      mmdebstrap)  info "$t" "$(mmdebstrap --version 2>&1 | head -1)" ;;
      veritysetup) info "$t" "$(veritysetup --version 2>&1 | head -1)" ;;
      mkfs.ext4)   info "$t" "$(mkfs.ext4 -V 2>&1 | head -1)" ;;
      mkfs.vfat)   info "$t" "$(mkfs.vfat --help 2>&1 | head -1)" ;;
      parted)      info "$t" "$(parted --version 2>&1 | head -1)" ;;
      xz)          info "$t" "$(xz --version 2>&1 | head -1)" ;;
    esac
  fi
done

# genimage and bdebstrap are NOT host requirements. Upstream builds both from
# source into a per-build sysroot — genimage 19 with upstream's own dm-verity
# patches. A distro genimage has no verity handler, so reporting it as
# "satisfied" would hide the exact gap that matters for Hub spec §6.8.
head_ "BUILT-FROM-SOURCE BY THE BUILDER (not host requirements)"
info "genimage" "built by upstream package/genimage (v19 + dm-verity patches)"
info "bdebstrap" "built by upstream package/bdebstrap (v0.7.0)"
if command -v genimage >/dev/null 2>&1; then
  note "host genimage present" "$(genimage --version 2>&1 | head -1) — UNUSED; the builder uses its own patched build"
fi

# --- Capability probe ---------------------------------------------------------
# The only check here that proves anything. Everything above is inventory.
head_ "ARM64 EXECUTION PROBE"
PROBE_DONE="no"
if [[ "$NEED_EMULATION" == "no" ]]; then
  ok "arm64 execution" "native host"
  PROBE_DONE="yes"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  PROBE="$(docker run --rm --platform linux/arm64 alpine uname -m 2>/dev/null | tail -1)"
  if [[ "$PROBE" == "aarch64" ]]; then
    ok "arm64 execution (docker probe)" "linux/arm64 alpine -> aarch64"
  else
    bad "arm64 execution (docker probe)" "expected aarch64, got '${PROBE:-<none>}'"
  fi
  PROBE_DONE="yes"
fi
if [[ "$PROBE_DONE" == "no" ]]; then
  note "arm64 execution" "not probed — no docker available for the probe"
fi

# --- Release trust ------------------------------------------------------------
# Stated so a green doctor is never mistaken for a releasable build host.
head_ "RELEASE TRUST"
info "signing (BLK-005)" "OPEN — pilot/stable remain unbuildable by design"
info "artifacts from this host" "DEVELOPMENT, UNSIGNED, NOT RELEASE-ELIGIBLE"

printf '\n  %d passed, %d failed, %d warnings\n\n' "$PASS" "$FAIL" "$WARN"
if [[ $FAIL -gt 0 ]]; then
  printf '  Host is NOT ready. Run:\n    sudo bash %s/setup-ubuntu-arm64-builder.sh\n\n' \
    "infra/edge/raspberry-pi/pi-terminal-image/scripts"
  exit 1
fi
printf '  Host is ready to attempt a DEVELOPMENT cross-build.\n\n'
exit 0
