#!/usr/bin/env bash
# KitLuy OS image — shared build library.
#
# Sourced by build-image.sh and by the profile scripts. Contains no build
# actions of its own so it can be sourced by the test suite without side
# effects.

set -euo pipefail

KITLUY_OS_IMAGE_ROOT="${KITLUY_OS_IMAGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
export KITLUY_OS_IMAGE_ROOT

# Every unresolved owner value in this build system uses this exact marker, so
# one grep finds all of them and no build can quietly proceed past one.
readonly KITLUY_REQUIRED_MARKER="[REQUIRED:"

log()  { printf '[kitluy-store-hub-image] %s\n' "$*" >&2; }
warn() { printf '[kitluy-store-hub-image] WARNING: %s\n' "$*" >&2; }
die()  { printf '[kitluy-store-hub-image] REFUSED: %s\n' "$*" >&2; exit 1; }

# --- Configuration loading --------------------------------------------------

# load_config <file> — source a conf file after checking it exists.
load_config() {
  local file="$1"
  [[ -f "$file" ]] || die "configuration file not found: $file"
  # shellcheck disable=SC1090
  source "$file"
}

# is_required_placeholder <value> — true when the value is an unresolved owner
# value. Used everywhere instead of ad-hoc emptiness checks, because an
# unresolved value and an empty value must not be confused: empty may be legal
# (KITLUY_ENROLLMENT_BASE_URL), unresolved never is.
is_required_placeholder() {
  [[ "${1:-}" == *"${KITLUY_REQUIRED_MARKER}"* ]]
}

# --- Profile validation -----------------------------------------------------

# This source tree builds the Store Hub image and nothing else. The Pi
# Terminal is a separate image with its own source (owner decision,
# 2026-08-13): two devices, two images, two sources.
readonly KITLUY_KNOWN_PROFILES="store-hub"

# assert_known_profile <profile>
assert_known_profile() {
  local profile="${1:-}"
  [[ -n "$profile" ]] || die "no profile given (expected one of: ${KITLUY_KNOWN_PROFILES})"
  local known
  for known in $KITLUY_KNOWN_PROFILES; do
    [[ "$profile" == "$known" ]] && return 0
  done
  die "unknown profile '${profile}' (expected one of: ${KITLUY_KNOWN_PROFILES})"
}

# --- Release-channel gate ---------------------------------------------------

readonly KITLUY_KNOWN_CHANNELS="internal pilot stable"

# assert_channel_buildable <channel> <signing_key_ref> <secure_element_model>
#
# The owner channel model is internal -> pilot -> stable with no skips. Pilot
# and stable additionally require a real signer and a certified secure-element
# SKU. Both are BLK-005 implementation work, so this gate REFUSES rather than
# emitting an unsigned artifact labelled pilot — an unsigned artifact that
# looks releasable is the specific failure this gate exists to prevent.
assert_channel_buildable() {
  local channel="${1:-}" signing_key_ref="${2:-}" secure_element="${3:-}"
  local known found="no"
  for known in $KITLUY_KNOWN_CHANNELS; do
    [[ "$channel" == "$known" ]] && found="yes"
  done
  [[ "$found" == "yes" ]] || die "unknown release channel '${channel}' (expected one of: ${KITLUY_KNOWN_CHANNELS})"

  if [[ "$channel" == "internal" ]]; then
    return 0
  fi

  if is_required_placeholder "$signing_key_ref"; then
    die "channel '${channel}' requires a signing key: KITLUY_IMAGE_SIGNING_KEY_REF is unresolved (BLK-005 implementation pending). Only 'internal' is buildable."
  fi
  if is_required_placeholder "$secure_element"; then
    die "channel '${channel}' requires a certified secure-element SKU: KITLUY_SECURE_ELEMENT_MODEL is unresolved (production BOM decision pending). Only 'internal' is buildable."
  fi
  return 0
}

# --- Base-image pin gate ----------------------------------------------------

# assert_base_pinned <release> <sha256>
#
# An unpinned base image makes the build irreproducible, which makes release
# identity meaningless: two images with the same version would not be the same
# image. Recorded honestly as a blocker rather than defaulted to "latest".
assert_base_pinned() {
  local release="${1:-}" sha="${2:-}"
  if is_required_placeholder "$release" || is_required_placeholder "$sha"; then
    return 1
  fi
  return 0
}

# --- Zero-secret gate -------------------------------------------------------

# assert_no_secrets_in_overlay <overlay_dir>
#
# Images are zero-secret by construction (mission §30). This scans the overlay
# for material that must never be baked into an image. It is a build-time
# backstop, not a substitute for `pnpm secret:scan`.
assert_no_secrets_in_overlay() {
  local dir="${1:-}"
  [[ -d "$dir" ]] || return 0

  local findings
  findings="$(grep -rIlE \
    'SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9._-]+|BEGIN [A-Z ]*PRIVATE KEY|service_role' \
    "$dir" 2>/dev/null || true)"

  if [[ -n "$findings" ]]; then
    printf '%s\n' "$findings" >&2
    die "overlay contains material that must never be baked into an image (service-role key or private key)"
  fi
  return 0
}

# --- Overlay application ----------------------------------------------------

# stage_overlay <src> <dest> — copy an overlay tree preserving modes.
stage_overlay() {
  local src="${1:-}" dest="${2:-}"
  [[ -d "$src" ]] || { log "overlay '${src}' absent — nothing to stage"; return 0; }
  mkdir -p "$dest"
  cp -a "${src}/." "${dest}/"
  log "staged overlay: ${src} -> ${dest}"
}

# --- Canonical systemd + runtime installation --------------------------------
# THE SINGLE SOURCE. Both build paths install from the same rootfs overlay
# directories, so a unit or an executable is defined exactly once:
#
#   rpi-image-gen/layer/<layer>.rootfs-overlay/   <- canonical assets
#     |-> rpi-image-gen consumes it natively (the real .img)
#     |-> build-image.sh consumes it here (the staged tree)
#
# Before this, the staged path defined eight units by heredoc and the layer
# path defined one, and they disagreed on names, users and hardening. That
# divergence is what shipped six dead ExecStart targets in v2.7.0.
kitluy_install_overlay() {
  local root="$1" overlay="$2"
  [[ -d "$overlay" ]] || { echo "missing canonical overlay: $overlay" >&2; return 1; }
  # -a preserves the .wants symlinks, which ARE the enablement decision.
  cp -a "${overlay}/." "${root}/"
}
