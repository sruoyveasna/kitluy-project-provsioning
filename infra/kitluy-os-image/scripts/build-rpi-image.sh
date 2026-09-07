#!/usr/bin/env bash
# KitLuy Pi Terminal image — rpi-image-gen build entrypoint (DEVELOPMENT cross-build).
#
#   build-rpi-image.sh --profile pi-terminal [--skip-doctor]
#                      [--filesystem-only] [--build-dir DIR]
#
# This is the path that produces an actual arm64 .img. It drives the PINNED
# upstream builder (rpi-image-gen, see ../rpi-image-gen/upstream.pin) over the
# KitLuy external source, and it exists so that the invocation, the preflight
# and the artifact classification are one reproducible command rather than
# three remembered ones.
#
# ONE TREE, ONE DEVICE. This tree builds the Pi Terminal image and nothing else
# (owner decision 2026-08-13: two devices, two images, two sources). The Store
# Hub image is built from infra/kitluy-store-hub-image, and this script
# REFUSES the store-hub profile rather than producing a Hub artifact from a tree
# that no longer carries the Hub's runtime.
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
#            §25 (build-host classification), KLD-2026-07-28-002 (BLK-005),
#            KLD-2026-09-03-FACTORY-ENROLLMENT-001 (the terminal's first stage).

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
SKIP_PACKAGING="no"
ENVIRONMENT_OVERRIDE=""
NO_INTERACTIVE_ACCESS="no"
FILESYSTEM_ONLY="no"
COLLECT_ONLY="no"

usage() {
  cat >&2 <<'EOF'
Usage: build-rpi-image.sh --profile <pi-terminal> [options]

  --registration-url <url>
                          bake the CLOUD registration route into the image,
                          e.g. https://<ref>.supabase.co/functions/v1/device-registration
  --hardware-profile-key <key>
                          bake the hardware profile KEY the device registers as.
                          It must exist in the stack the registration route
                          points at: KL-PI5-TERMINAL-DEV on the local development
                          stacks, CLOUD-TERM-PI5 on hosted development.
  --enrollment-url <url>  bake the fleet enrollment endpoint into the image.
                          Retained for the Store Hub's fleet service; a
                          terminal registers through --registration-url.

Options:
  --profile <name>     Image profile to build (required; only pi-terminal builds here).
  --channel <name>     Release channel (default: config; only `internal` builds).
  --build-dir <dir>    Builder work root (default: ../build/work).
  --filesystem-only    Build the root filesystem, skip image generation.
  --collect-only       Skip the build; re-collect and re-hash existing artifacts.
  --environment <name> Environment to BAKE into the image (default: config).
                       Not defaulted silently — development-only paths key on
                       it. pilot/production are refused.
  --skip-doctor        Skip the host preflight. Not recommended.
  --skip-packaging     Do not re-package runtime components into the overlay.
                       The image then carries whatever the overlay already held,
                       which may not match the source tree. Diagnostic only.
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
    # The fleet enrollment endpoint. Kept so the layer's image.env key stays
    # populated for a Hub-style build; a terminal does not use it.
    --enrollment-url)  ENROLLMENT_URL="${2:-}"; shift 2 ;;
    # The CLOUD registration route, as a FULL url. Separate from the fleet
    # endpoint because it is a different service: Supabase does not serve
    # /v1/device-enrollment, and the fleet service does not serve this.
    --registration-url) REGISTRATION_URL="${2:-}"; shift 2 ;;
    # A stable hardware profile KEY (never a UUID) so the image stays generic.
    --hardware-profile-key) HARDWARE_PROFILE_KEY="${2:-}"; shift 2 ;;
    --build-dir)       BUILD_DIR="${2:-}"; shift 2 ;;
    --filesystem-only) FILESYSTEM_ONLY="yes"; shift ;;
    --collect-only)    COLLECT_ONLY="yes"; shift ;;
    --skip-doctor)     SKIP_DOCTOR="yes"; shift ;;
    --skip-packaging)  SKIP_PACKAGING="yes"; shift ;;
    --environment)     ENVIRONMENT_OVERRIDE="${2:-}"; shift 2 ;;
    --no-interactive-access) NO_INTERACTIVE_ACCESS="yes"; shift ;;
    -h|--help)         usage; exit 0 ;;
    *)                 usage; die "unknown argument: $1" ;;
  esac
done

assert_known_profile "$PROFILE"

# The stale store-hub profile files in this tree are kept for record and are
# NOT buildable from here. A Hub artifact built from a tree without the Hub's
# runtime would be D-05 all over again: a card advertising a service it cannot
# serve.
if [[ "$PROFILE" == "store-hub" ]]; then
  die "the Store Hub image is built from infra/kitluy-store-hub-image, not from this tree.
  This tree builds the Pi Terminal image only (owner decision 2026-08-13: two
  devices, two images, two sources). Its store-hub profile files remain for
  record and are not buildable here."
fi

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

# --- Runtime packaging --------------------------------------------------------
# `package-bootstrap-runtime.sh` is what puts the agents into the rootfs overlay
# that rpi-image-gen then bakes. On the Hub tree nothing invoked it for weeks —
# it was a manual pre-step documented in a README — so a build run straight
# after a source change happily produced an image containing the PREVIOUS
# overlay (D-05). Running it here makes the flashable image a function of the
# source tree again. It is idempotent and takes about a second, and it REFUSES
# when runtime-manifest.json and the overlay disagree.
if [[ "$SKIP_PACKAGING" == "yes" ]]; then
  warn "runtime packaging skipped (--skip-packaging): the overlay may not match the source tree"
else
  log "packaging runtime components into the rootfs overlay"
  if ! bash "${SCRIPT_DIR}/package-bootstrap-runtime.sh"; then
    die "runtime packaging failed — the image would ship a stale or incomplete overlay. Build the agent first:
  pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build"
  fi
fi

# --- Electron runtime ---------------------------------------------------------
# The Device Shell is an Electron application and Debian ships no Electron, so
# the runtime is an external pinned dependency: fetched, checksum-verified and
# unpacked by `fetch-electron.sh`, then handed to the layer as an IGconf
# override. Downloading it here rather than inside a layer hook keeps
# verification in ONE place — a hook that fetched its own copy would be a second,
# unverified path to the same 289 MB binary.
#
# Skipped with --skip-packaging for the same reason packaging is: that flag means
# "build from the overlay as it stands". The unit's ConditionPathExists then
# leaves the shell inactive and the device shows the text screen, rather than
# restart-looping against a runtime that is not there.
ELECTRON_DIR=""
if [[ "$PROFILE" == "pi-terminal" && "$SKIP_PACKAGING" != "yes" ]]; then
  log "resolving the pinned Electron runtime"
  if ! ELECTRON_DIR="$(bash "${SCRIPT_DIR}/fetch-electron.sh")"; then
    die "could not obtain the pinned Electron runtime — the Device Shell would be absent from this image.
  Re-run with network access, or with --skip-packaging to build without it."
  fi
  log "electron runtime: ${ELECTRON_DIR}"
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
REGISTRATION_URL="${REGISTRATION_URL:-${KITLUY_REGISTRATION_URL:-}}"
HARDWARE_PROFILE_KEY="${HARDWARE_PROFILE_KEY:-${KITLUY_HARDWARE_PROFILE_KEY:-}}"
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
  # Either form works: the upstream openssh-server layer tests `-f` on the
  # value first and falls back to treating it as the key text, so a path and
  # the contents are both accepted. The contents are passed because that is
  # what rpi-image-gen's own documentation shows.
  #
  # The key lands on the PERSISTENT partition, not in the chroot — /home is
  # moved into persistent.ext4 during image assembly. Verify it with
  #   debugfs -R "cat /home/pi/.ssh/authorized_keys" persistent.ext4
  # and NOT by looking at chroot-*/filesystem/home, which is empty by design.
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

# WHICH DEVICE THIS IMAGE IS.
#
# The profile has always known (`KITLUY_PROFILE_DEVICE_CLASS`) and this builder
# already writes it into the manifest — it must ALSO go into the image, because
# the cloud derives the device class from the hardware profile a device
# registers with and the agents read this value from /etc/kitluy/image.env.
# Passed as an IGconf override rather than an exported shell variable: the
# layer's customize steps run inside bdebstrap, which forwards ONLY what it is
# given, so an exported variable never crosses that boundary.
RIG_OVERRIDES+=("IGconf_kitluy_device_class=${KITLUY_PROFILE_DEVICE_CLASS}")

# --- The environment, STATED (never inherited) --------------------------------
# The layer used to default this to `development`, and the builder never passed
# one, so every image ever built declared itself a development device because
# nobody said otherwise — while development-only escape paths key on exactly
# that word. It now comes from the profile config, is validated here, and is
# asserted by the layer. `config/image.conf` carries `development` for this
# development builder; `--environment` overrides it.
BUILD_ENVIRONMENT="${ENVIRONMENT_OVERRIDE:-${KITLUY_ENVIRONMENT:-}}"
[[ -n "$BUILD_ENVIRONMENT" ]] \
  || die "no environment resolved: set KITLUY_ENVIRONMENT in config/image.conf or pass --environment. It is deliberately not defaulted — the development-only paths key on it."

case "$BUILD_ENVIRONMENT" in
  local|development|staging) ;;
  pilot|production|disaster_recovery)
    # The channel gate already refuses to BUILD these; this refuses to LABEL an
    # artifact as one. An image marked `production` from this host would carry a
    # posture the artifact cannot support — it is unsigned and not release
    # eligible — and the marking is what downstream checks would trust.
    die "environment '${BUILD_ENVIRONMENT}' cannot be produced by this builder: artifacts from this host are DEVELOPMENT, UNSIGNED and NOT release-eligible (BLK-005)."
    ;;
  *)
    die "environment '${BUILD_ENVIRONMENT}' is not a KitLuy environment (local, development, staging, pilot, production, disaster_recovery)."
    ;;
esac

RIG_OVERRIDES+=("IGconf_kitluy_environment=${BUILD_ENVIRONMENT}")
log "image environment: ${BUILD_ENVIRONMENT} (stated explicitly, not defaulted)"

# DEVELOPMENT DIAGNOSTIC SUDO — OPT-IN, OFF BY DEFAULT.
#
# The hardened default purges sudo entirely (`IGconf_device_user1sudo=none`),
# which is right for anything that could reach a shop: a terminal holds a device
# identity, and `pi` is reachable over SSH by key.
#
# It also makes the device UNDIAGNOSABLE. `/var/lib/kitluy` is root-only, so the
# agents' own state — registration, identity — cannot be read at all, and
# `journalctl` returns nothing for system units. `KITLUY_DEV_SUDO=1` grants
# passwordless sudo to `pi` for DEVELOPMENT images only. It must never be set
# for a pilot or production build; those are signed artifacts and this flag is
# not part of that path.
if [[ "${KITLUY_DEV_SUDO:-}" == "1" ]]; then
  RIG_OVERRIDES+=("IGconf_device_user1sudo=nopasswd")
  warn "DEVELOPMENT SUDO ENABLED: user 'pi' has passwordless sudo in this image."
  warn "  Diagnostic only. Never build a pilot or production artifact with KITLUY_DEV_SUDO=1."
fi
log "device class baked: ${KITLUY_PROFILE_DEVICE_CLASS}"

if [[ -n "$ENROLLMENT_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_enrollment_url=${ENROLLMENT_URL}")
  log "enrollment endpoint baked: ${ENROLLMENT_URL}"
fi

# THE CLOUD REGISTRATION ROUTE — FACTORY ENROLLMENT, STAGE ONE.
#
# Without it the device cannot announce itself to KitLuy at all, and — because
# the rootfs is read-only and dm-verity protected — nothing on the flashed card
# can add it later. The fix is a rebuild, and the operator should learn that
# here rather than with a card in their hand.
if [[ -n "$REGISTRATION_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_registration_url=${REGISTRATION_URL}")
  log "cloud registration route baked: ${REGISTRATION_URL}"
else
  warn "no --registration-url given: this image cannot register itself to the"
  warn "  cloud, so Factory Enrollment can never begin. The rootfs is read-only,"
  warn "  so rebuild with --registration-url."
fi

if [[ -n "$ELECTRON_DIR" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_electron_dir=${ELECTRON_DIR}")
fi

if [[ -n "$HARDWARE_PROFILE_KEY" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_hardware_profile_key=${HARDWARE_PROFILE_KEY}")
  log "hardware profile key baked: ${HARDWARE_PROFILE_KEY}"
elif [[ -n "$REGISTRATION_URL" ]]; then
  # A registration URL with no profile key produces a device that reaches the
  # cloud and is refused KLUY-REG-UNKNOWN-PROFILE every time. Refused here
  # rather than warned, because the two values are only useful together and the
  # failure would otherwise appear as a network-looking error in a shop.
  die "--registration-url given without --hardware-profile-key.
  A device registering with no profile key is refused KLUY-REG-UNKNOWN-PROFILE
  by the cloud on every attempt, and the read-only rootfs cannot be corrected
  on the card.

  Pass both, e.g.:
    $0 --profile ${PROFILE} \\
      --registration-url https://<ref>.supabase.co/functions/v1/device-registration \\
      --hardware-profile-key KL-PI5-TERMINAL-DEV"
fi

# NO DEVELOPMENT ROOT PIN ON A TERMINAL, YET. The Store Hub bakes the SHA-256 of
# the development root certificate so it can verify the operational certificate
# it is issued. A terminal's own credential custody is a later slice; when it
# arrives, the pin is injected here the way the Hub tree does it, from the
# operator's $KITLUY_DEV_PKI_DIR and never from the repository.

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
# builder version (deploy-v2.7.0), not by profile. The image name from the
# builder config is the discriminator.
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
