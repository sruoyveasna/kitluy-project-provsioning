#!/usr/bin/env bash
# KitLuy OS image — rpi-image-gen build entrypoint (DEVELOPMENT cross-build).
#
#   build-rpi-image.sh --profile store-hub|pi-terminal [--skip-doctor]
#                      [--filesystem-only] [--build-dir DIR]
#
# This is the path that produces an actual arm64 .img. It drives the PINNED
# upstream builder (rpi-image-gen, see ../rpi-image-gen/upstream.pin) over the
# KitLuy external source, and it exists so that the invocation, the preflight
# and the artifact classification are one reproducible command rather than
# three remembered ones.
#
# RELATIONSHIP TO build-image.sh
# ------------------------------
# `build-image.sh` stages an inspectable root filesystem tree and refuses to
# emit an .img. It is unchanged by this script and remains the authority on the
# release-channel gate. This script REUSES that gate rather than restating it,
# so there is exactly one place where "pilot and stable are unbuildable" lives.
#
# WHAT THIS SCRIPT MAY AND MAY NOT PRODUCE (§17, BLK-005)
# -------------------------------------------------------
# It may produce a DEVELOPMENT, UNSIGNED, NOT-RELEASE-ELIGIBLE artifact on the
# `internal` channel. It may not produce anything on pilot or stable, and it
# never marks an artifact signed or promotable. The release pipeline's
# fail-closed signing logic is untouched: nothing here writes a signature
# field, and the emitted manifest states the artifact is not release-eligible.
#
# Authority: mission §21/§24 (external source, builder pinning),
#            §25 (build-host classification), KLD-2026-07-28-002 (BLK-005).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PIN_FILE="${KITLUY_OS_IMAGE_ROOT}/rpi-image-gen/upstream.pin"
KITLUY_SRC="${KITLUY_OS_IMAGE_ROOT}/rpi-image-gen"
UPSTREAM_DIR="${KITLUY_RIG_UPSTREAM:-${KITLUY_OS_IMAGE_ROOT}/build/upstream}"
BUILD_DIR="${KITLUY_OS_IMAGE_ROOT}/build/work"

PROFILE=""
CHANNEL_OVERRIDE=""
SKIP_DOCTOR="no"
NO_INTERACTIVE_ACCESS="no"
FILESYSTEM_ONLY="no"
COLLECT_ONLY="no"

usage() {
  cat >&2 <<'EOF'
Usage: build-rpi-image.sh --profile <store-hub|pi-terminal> [options]

  --enrollment-url <url>  bake the fleet enrollment endpoint into the image,
                          e.g. http://172.16.21.17:8787 . Without it the card
                          boots and reports that no endpoint is configured.

Options:
  --profile <name>     Image profile to build (required).
  --channel <name>     Release channel (default: config; only `internal` builds).
  --build-dir <dir>    Builder work root (default: ../build/work).
  --filesystem-only    Build the root filesystem, skip image generation.
  --collect-only       Skip the build; re-collect and re-hash existing artifacts.
  --skip-doctor        Skip the host preflight. Not recommended.
  --no-interactive-access  Build an image with NO console or SSH access at all.
                       Required to acknowledge that a failed bootstrap can then
                       only be reflashed, never inspected.
  -h, --help           Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)         PROFILE="${2:-}"; shift 2 ;;
    --channel)         CHANNEL_OVERRIDE="${2:-}"; shift 2 ;;
    # The address the flashed device will call to enroll. Exported so the
    # kitluy-base layer can bake it into /etc/kitluy/image.env, which is what
    # makes a card cloneable: every copy already knows where the fleet is.
    --enrollment-url)  ENROLLMENT_URL="${2:-}"; shift 2 ;;
    --build-dir)       BUILD_DIR="${2:-}"; shift 2 ;;
    --filesystem-only) FILESYSTEM_ONLY="yes"; shift ;;
    --collect-only)    COLLECT_ONLY="yes"; shift ;;
    --skip-doctor)     SKIP_DOCTOR="yes"; shift ;;
    --no-interactive-access) NO_INTERACTIVE_ACCESS="yes"; shift ;;
    -h|--help)         usage; exit 0 ;;
    *)                 usage; die "unknown argument: $1" ;;
  esac
done

assert_known_profile "$PROFILE"

# --- Release-channel gate (reused, not restated) -----------------------------
load_config "${KITLUY_OS_IMAGE_ROOT}/config/image.conf"
load_config "${KITLUY_OS_IMAGE_ROOT}/config/profiles/${PROFILE}.conf"
[[ -n "$CHANNEL_OVERRIDE" ]] && KITLUY_RELEASE_CHANNEL="$CHANNEL_OVERRIDE"

assert_channel_buildable \
  "$KITLUY_RELEASE_CHANNEL" \
  "$KITLUY_IMAGE_SIGNING_KEY_REF" \
  "$KITLUY_SECURE_ELEMENT_MODEL"

# --- Preflight ----------------------------------------------------------------
# Run BEFORE the pinned checkout is fetched and long before mmdebstrap starts.
# A build that dies 30 minutes in because genimage could not be compiled has
# wasted 30 minutes to report something knowable in two seconds.
if [[ "$SKIP_DOCTOR" == "yes" ]]; then
  warn "host preflight skipped (--skip-doctor)"
else
  log "running host preflight (doctor.sh)"
  if ! bash "${SCRIPT_DIR}/doctor.sh"; then
    die "host preflight failed — fix the FAIL lines above, or run: sudo bash ${SCRIPT_DIR}/setup-ubuntu-arm64-builder.sh"
  fi
fi

# --- Pinned upstream builder --------------------------------------------------
[[ -f "$PIN_FILE" ]] || die "missing ${PIN_FILE}"
# shellcheck disable=SC1090
source "$PIN_FILE"

: "${KITLUY_RIG_REPOSITORY:?upstream.pin has no repository}"
: "${KITLUY_RIG_TAG:?upstream.pin has no tag}"
: "${KITLUY_RIG_COMMIT:?upstream.pin has no commit}"

fetch_upstream() {
  log "fetching pinned builder ${KITLUY_RIG_TAG} into ${UPSTREAM_DIR}"
  mkdir -p "$(dirname "$UPSTREAM_DIR")"
  git clone --quiet --branch "$KITLUY_RIG_TAG" "$KITLUY_RIG_REPOSITORY" "$UPSTREAM_DIR" \
    || die "could not clone ${KITLUY_RIG_REPOSITORY}"
}

[[ -x "${UPSTREAM_DIR}/rpi-image-gen" ]] || fetch_upstream

# The pin is verified, never assumed. A tag can be moved; the commit cannot.
ACTUAL_COMMIT="$(git -C "$UPSTREAM_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
[[ "$ACTUAL_COMMIT" == "$KITLUY_RIG_COMMIT" ]] \
  || die "upstream checkout ${ACTUAL_COMMIT} != pinned ${KITLUY_RIG_COMMIT} (refusing an irreproducible build)"
log "builder pinned and verified: ${KITLUY_RIG_TAG} / ${ACTUAL_COMMIT}"

# --- Build classification (§25) -----------------------------------------------
HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" != "aarch64" && "$HOST_ARCH" != "arm64" ]]; then
  warn "host is ${HOST_ARCH}, native build arch is ${KITLUY_RIG_NATIVE_BUILD_ARCH:-arm64}."
  warn "this is a DEVELOPMENT CROSS-BUILD via QEMU — NOT hardware-certified."
fi

RIG_CONFIG="kitluy-${PROFILE}.yaml"
[[ -f "${KITLUY_SRC}/config/${RIG_CONFIG}" ]] \
  || die "no builder config for profile '${PROFILE}' at ${KITLUY_SRC}/config/${RIG_CONFIG}"

mkdir -p "$BUILD_DIR"

# --- Break-glass access (owner decision, 2026-08-11) --------------------------
# A KitLuy image creates `pi` with NO password and locks root, and the base
# layer sets PasswordAuthentication no. That is the intended posture — a managed
# fleet device is not administered by typing a password into it — but with no
# authorized_keys it also means an image with NO way in at all. When the
# bootstrap runtime failed on 2026-08-11 the device could not be inspected,
# only reflashed, and the cause had to be found by reading the build tree.
#
# A PUBLIC key is not a secret, so this keeps the zero-secret property intact:
# nothing here can end up in the image that would not be safe to publish.
# It stays opt-in rather than defaulted to whatever key the build host happens
# to own, because silently baking an operator's identity into a fleet artifact
# should be a decision, not a side effect.
RIG_OVERRIDES=()
ENROLLMENT_URL="${ENROLLMENT_URL:-${KITLUY_ENROLLMENT_BASE_URL:-}}"
if [[ -n "${KITLUY_DEV_SSH_PUBKEY:-}" ]]; then
  [[ -f "$KITLUY_DEV_SSH_PUBKEY" ]] \
    || die "KITLUY_DEV_SSH_PUBKEY is not a readable file: ${KITLUY_DEV_SSH_PUBKEY}"
  # Refuse a PRIVATE key outright. Pointing at id_ed25519 instead of
  # id_ed25519.pub is a one-character mistake that would bake a private key
  # into every device flashed from the artifact.
  if grep -qE 'PRIVATE KEY' "$KITLUY_DEV_SSH_PUBKEY"; then
    die "REFUSED: ${KITLUY_DEV_SSH_PUBKEY} is a PRIVATE key — pass the .pub file"
  fi
  grep -qE '^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-|sk-(ssh|ecdsa))' "$KITLUY_DEV_SSH_PUBKEY" \
    || die "REFUSED: ${KITLUY_DEV_SSH_PUBKEY} does not look like an OpenSSH public key"
  # THE KEY, NOT THE PATH. rpi-image-gen documents
  #   IGconf_ssh_pubkey_user1="$(< ~/.ssh/id_rsa.pub)"
  # Passing a filename produced an image with NO authorized_keys at all: the
  # build reported success and the device would have been unreachable, which is
  # the exact outcome the refusal below exists to prevent.
  RIG_OVERRIDES+=("IGconf_ssh_pubkey_user1=$(cat "$KITLUY_DEV_SSH_PUBKEY")")
  log "recovery access: public key from ${KITLUY_DEV_SSH_PUBKEY} -> /home/pi/.ssh/authorized_keys"
elif [[ "$NO_INTERACTIVE_ACCESS" == "yes" ]]; then
  warn "--no-interactive-access: building an image with NO way in, deliberately."
  warn "  root is locked, pi has no password, and sshd rejects password auth."
  warn "  A device that fails to bootstrap can only be reflashed, never inspected."
else
  # REFUSE, not warn. This exact condition already shipped: an image with no
  # key reached a Raspberry Pi on 2026-08-11, firstboot failed, and the device
  # could not be logged into over console OR SSH — the cause had to be found by
  # reading the build tree instead of the device. A warning printed halfway up
  # a twenty-minute build scrolls past and changes nothing; the next person
  # discovers it with a flashed card in their hand.
  #
  # An unreachable image is still a legitimate PRODUCTION posture, so the
  # escape hatch exists — but it must be stated, not defaulted into.
  die "this image would have NO interactive access at all.
  root is locked by upstream (usermod --pass='*'), user 'pi' is created with
  --disabled-password, and sshd rejects password authentication. Without a
  public key the device cannot be inspected if bootstrap fails — only reflashed.

  Build with recovery access:
    KITLUY_DEV_SSH_PUBKEY=\$HOME/.ssh/id_ed25519.pub $0 --profile ${PROFILE}

  Or state the lockdown explicitly:
    $0 --profile ${PROFILE} --no-interactive-access"
fi

RIG_ARGS=(build -S "$KITLUY_SRC" -c "$RIG_CONFIG" -B "$BUILD_DIR")
[[ "$FILESYSTEM_ONLY" == "yes" ]] && RIG_ARGS+=(-f)
# The endpoint a flashed device will call.
#
# Passed as an IGconf override rather than an exported shell variable: the
# layer's customize steps run inside bdebstrap, which forwards ONLY what it is
# given, so an exported KITLUY_ENROLLMENT_BASE_URL never crossed that boundary
# and the first build with --enrollment-url still produced an EMPTY endpoint.
#
# It has to be right at build time. The rootfs is erofs — read-only — so this
# cannot be corrected on the card afterwards.
if [[ -n "$ENROLLMENT_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_enrollment_url=${ENROLLMENT_URL}")
  log "enrollment endpoint baked: ${ENROLLMENT_URL}"
else
  warn "no --enrollment-url given: the image will boot and report that no"
  warn "  enrollment endpoint is configured. The rootfs is read-only, so this"
  warn "  cannot be fixed on the card — rebuild with --enrollment-url."
fi

[[ ${#RIG_OVERRIDES[@]} -gt 0 ]] && RIG_ARGS+=(-- "${RIG_OVERRIDES[@]}")

log "profile=${PROFILE} config=${RIG_CONFIG} channel=${KITLUY_RELEASE_CHANNEL}"
log "invoking: rpi-image-gen ${RIG_ARGS[*]}"

if [[ "$COLLECT_ONLY" == "yes" ]]; then
  log "--collect-only: skipping the build, re-collecting existing artifacts"
else
  BUILD_RC=0
  ( cd "$UPSTREAM_DIR" && ./rpi-image-gen "${RIG_ARGS[@]}" ) || BUILD_RC=$?

  if [[ $BUILD_RC -ne 0 ]]; then
    die "rpi-image-gen exited ${BUILD_RC} — no artifact is claimed"
  fi
fi

# --- Artifact classification --------------------------------------------------
# An .img produced here is a development artifact. Recording that next to the
# artifact — rather than only in a runbook — is what keeps it from being
# mistaken for something releasable later.
log "build finished; collecting artifacts"

# Collect ONLY from the builder's own output directories.
#
# Not from ${BUILD_DIR} as a whole: that tree also holds the from-source
# package builds, and upstream's util-linux ships hundreds of *.img.xz test
# FIXTURES under tests/ts/blkid/. Sweeping the whole work root pulls those in,
# which both poisons the manifest with files that are not KitLuy artifacts and
# spends minutes hashing them. The genimage output dir and the deploy dir are
# the only places a real artifact appears.
COLLECT_DIRS=()
for d in "${BUILD_DIR}"/image-* "${BUILD_DIR}"/deploy-*; do
  [[ -d "$d" ]] && COLLECT_DIRS+=("$d")
done

# Artifacts must belong to THIS profile. The deploy directory is keyed by
# builder version (deploy-v2.7.0), not by profile, so after building both
# profiles it holds Store Hub and Terminal artifacts side by side. Collecting
# the directory wholesale would put Terminal images in the Store Hub manifest,
# and a manifest that misattributes an artifact is worse than no manifest —
# it is evidence pointing at the wrong thing. The image name from the builder
# config is the discriminator.
RIG_IMAGE_NAME="$(awk '/^image:/{f=1;next} f&&/^[^[:space:]]/{f=0} f&&/^[[:space:]]+name:/{print $2; exit}' \
  "${KITLUY_SRC}/config/${RIG_CONFIG}")"
[[ -n "$RIG_IMAGE_NAME" ]] || die "could not read image.name from ${KITLUY_SRC}/config/${RIG_CONFIG}"
log "collecting artifacts named '${RIG_IMAGE_NAME}*'"

if [[ ${#COLLECT_DIRS[@]} -eq 0 ]]; then
  warn "no image-*/deploy-* output directory under ${BUILD_DIR}"
  ARTIFACTS=()
else
  mapfile -t ARTIFACTS < <(find "${COLLECT_DIRS[@]}" -maxdepth 1 -type f \
    \( -name "${RIG_IMAGE_NAME}*.img" -o -name "${RIG_IMAGE_NAME}*.img.zst" \
       -o -name "${RIG_IMAGE_NAME}*.img.xz" -o -name "${RIG_IMAGE_NAME}*.img.sparse" \
       -o -name "${RIG_IMAGE_NAME}*.img.sparse.zst" -o -name "${RIG_IMAGE_NAME}*.tar.zst" \
    \) 2>/dev/null | sort)
fi

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  warn "no image artifact found under ${BUILD_DIR}"
  if [[ "$FILESYSTEM_ONLY" == "yes" ]]; then
    log "--filesystem-only was requested, so this is the intended result."
    exit 0
  fi
  die "image generation reported success but produced no artifact"
fi

MANIFEST="${BUILD_DIR}/kitluy-${PROFILE}-dev-manifest.json"
{
  printf '{\n'
  printf '  "manifestVersion": %s,\n'          "${KITLUY_RELEASE_MANIFEST_VERSION}"
  printf '  "profile": "%s",\n'                "${PROFILE}"
  printf '  "deviceClass": "%s",\n'            "${KITLUY_PROFILE_DEVICE_CLASS}"
  printf '  "releaseChannel": "%s",\n'         "${KITLUY_RELEASE_CHANNEL}"
  printf '  "architecture": "%s",\n'           "${KITLUY_TARGET_ARCH}"
  printf '  "targetBoard": "%s",\n'            "${KITLUY_TARGET_BOARD}"
  printf '  "baseOs": "debian-%s-arm64",\n'    "${KITLUY_RIG_SUITE_LAYER%%-*}"
  printf '  "builder": "rpi-image-gen %s",\n'  "${KITLUY_RIG_TAG}"
  printf '  "builderCommit": "%s",\n'          "${KITLUY_RIG_COMMIT}"
  printf '  "buildHostArch": "%s",\n'          "${HOST_ARCH}"
  printf '  "buildClass": "%s",\n' \
    "$([[ "$HOST_ARCH" == aarch64 || "$HOST_ARCH" == arm64 ]] && echo NATIVE || echo DEVELOPMENT-CROSS-BUILD)"
  printf '  "digestAlgorithm": "%s",\n'        "${KITLUY_RELEASE_DIGEST_ALGORITHM}"
  printf '  "signed": false,\n'
  printf '  "signatureStatus": "UNSIGNED",\n'
  printf '  "releaseEligible": false,\n'
  printf '  "promotable": false,\n'
  printf '  "bootTested": false,\n'
  printf '  "status": "DEVELOPMENT-UNSIGNED-NOT-RELEASE-ELIGIBLE",\n'
  printf '  "artifacts": [\n'
  for i in "${!ARTIFACTS[@]}"; do
    f="${ARTIFACTS[$i]}"
    printf '    { "path": "%s", "bytes": %s, "sha256": "%s" }' \
      "${f#"${KITLUY_OS_IMAGE_ROOT}/"}" \
      "$(stat -c%s "$f")" \
      "$(sha256sum "$f" | cut -d' ' -f1)"
    [[ $i -lt $(( ${#ARTIFACTS[@]} - 1 )) ]] && printf ','
    printf '\n'
  done
  printf '  ]\n}\n'
} > "$MANIFEST"

log "artifacts:"
for f in "${ARTIFACTS[@]}"; do
  log "  $(stat -c%s "$f") bytes  $f"
done
log "manifest: ${MANIFEST}"
log "classification: DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED"
