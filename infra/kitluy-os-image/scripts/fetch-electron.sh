#!/usr/bin/env bash
# Fetch, VERIFY and unpack the pinned Electron runtime for the Pi Terminal image.
#
#   bash infra/kitluy-os-image/scripts/fetch-electron.sh [--print-dir]
#
# Writes to build/electron/<version>-<arch>/ (gitignored, ~250 MB unpacked) and
# prints that directory. `build-rpi-image.sh` passes it to the layer as
# IGconf_kitluy_electron_dir; the layer copies it into the rootfs.
#
# ===========================================================================
# WHY THIS IS NOT IN THE ROOTFS OVERLAY
# ===========================================================================
# Everything else the image installs lives in `<layer>.rootfs-overlay/` and is
# committed — the firstboot agent's JS closure, the units, the shims. That works
# because they are kilobytes of our own source. Electron is a quarter of a
# gigabyte of somebody else's binary, and committing it would put a build
# artifact of that size into every clone and every fetch, for ever.
#
# So it is acquired the way rpi-image-gen itself is: pinned, downloaded, and
# verified against a recorded digest before anything unpacks it.
#
# ===========================================================================
# THE DOWNLOAD IS CACHED, THE VERIFICATION IS NOT
# ===========================================================================
# A cached zip is re-verified on every run rather than trusted because it was
# there last time. A cache is a directory on a workstation: it can be edited,
# truncated by a full disk, or restored from a backup of a different version.
# Re-hashing costs a second and removes the whole question.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/common.sh
source "${ROOT}/scripts/lib/common.sh"

PIN="${ROOT}/rpi-image-gen/electron.pin"
[[ -f "$PIN" ]] || die "no Electron pin at ${PIN}"
# shellcheck source=/dev/null
source "$PIN"

for required in KITLUY_ELECTRON_VERSION KITLUY_ELECTRON_ARCH \
                KITLUY_ELECTRON_SHA256 KITLUY_ELECTRON_URL_TEMPLATE; do
  [[ -n "${!required:-}" ]] || die "${PIN} does not set ${required}"
done

# A pin that is not a real digest is not a pin. `[REQUIRED: ...]`, an empty
# string or a truncated paste must fail here rather than at `sha256sum -c`,
# where the message would be about a checksum file instead of about the pin.
[[ "$KITLUY_ELECTRON_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || die "KITLUY_ELECTRON_SHA256 is not a 64-character sha256: '${KITLUY_ELECTRON_SHA256}'"

CACHE_DIR="${ROOT}/build/electron"
STAMP="${KITLUY_ELECTRON_VERSION}-${KITLUY_ELECTRON_ARCH}"
ZIP="${CACHE_DIR}/electron-v${STAMP}.zip"
DEST="${CACHE_DIR}/${STAMP}"

# shellcheck disable=SC2059  # the template is ours, from the pin file
URL="$(printf "$KITLUY_ELECTRON_URL_TEMPLATE" \
        "$KITLUY_ELECTRON_VERSION" "$KITLUY_ELECTRON_VERSION" "$KITLUY_ELECTRON_ARCH")"

verify() {
  local file="$1" actual
  actual="$(sha256sum "$file" | cut -d' ' -f1)"
  [[ "$actual" == "$KITLUY_ELECTRON_SHA256" ]] || {
    # The bad file is REMOVED, not left for the next run to trip over again.
    rm -f "$file"
    die "Electron checksum mismatch — refusing to unpack.
  expected ${KITLUY_ELECTRON_SHA256}
  actual   ${actual}
  The download was discarded. If the pin was just changed, re-check it against
  the release's SHASUMS256.txt; if it was not, do not retry until you know why."
  }
}

mkdir -p "$CACHE_DIR"

if [[ -x "${DEST}/electron" ]]; then
  log "electron ${KITLUY_ELECTRON_VERSION} (${KITLUY_ELECTRON_ARCH}) already unpacked"
else
  if [[ -f "$ZIP" ]]; then
    log "electron ${KITLUY_ELECTRON_VERSION}: using cached download, re-verifying"
  else
    command -v curl >/dev/null 2>&1 || die "curl is required to fetch Electron"
    log "electron ${KITLUY_ELECTRON_VERSION}: downloading ${URL}"
    # A partial download must never become the cache: fetch to a temp name and
    # rename only once curl has reported success.
    curl -sSL --fail --retry 3 --connect-timeout 20 -o "${ZIP}.part" "$URL" \
      || die "could not download Electron from ${URL}"
    mv "${ZIP}.part" "$ZIP"
  fi

  verify "$ZIP"
  log "electron ${KITLUY_ELECTRON_VERSION}: checksum verified"

  command -v unzip >/dev/null 2>&1 || die "unzip is required (apt-get install unzip)"
  rm -rf "${DEST}.tmp" "$DEST"
  mkdir -p "${DEST}.tmp"
  unzip -q "$ZIP" -d "${DEST}.tmp"
  # The launcher must be executable; the zip does not always preserve the bit.
  chmod +x "${DEST}.tmp/electron" 2>/dev/null || true
  [[ -x "${DEST}.tmp/electron" ]] || die "the unpacked archive has no executable 'electron' at its root"
  mv "${DEST}.tmp" "$DEST"
  log "electron ${KITLUY_ELECTRON_VERSION}: unpacked into ${DEST#"${ROOT}/"}"
fi

# A sanity check that costs nothing and catches the case that matters: an
# archive for the WRONG ARCHITECTURE unpacks perfectly and fails only on the Pi.
if command -v file >/dev/null 2>&1; then
  case "$(file -b "${DEST}/electron")" in
    *aarch64*|*ARM\ aarch64*) : ;;
    *) die "the unpacked electron binary is not aarch64 — check KITLUY_ELECTRON_ARCH in the pin" ;;
  esac
fi

printf '%s\n' "$DEST"
