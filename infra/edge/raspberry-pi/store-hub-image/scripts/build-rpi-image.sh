#!/usr/bin/env bash
# KitLuy OS image — rpi-image-gen build entrypoint (DEVELOPMENT cross-build).
#
#   build-rpi-image.sh --profile store-hub [--skip-doctor]
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
SKIP_PACKAGING="no"
ENVIRONMENT_OVERRIDE=""
NO_INTERACTIVE_ACCESS="no"
FILESYSTEM_ONLY="no"
COLLECT_ONLY="no"

usage() {
  cat >&2 <<'EOF'
Usage: build-rpi-image.sh --profile <store-hub> [options]

  --registration-url <url>
                          bake the CLOUD registration route into the image,
                          e.g. https://<ref>.supabase.co/functions/v1/device-registration
  --hardware-profile-key <key>
                          bake the hardware profile KEY the device registers as
  --enrollment-url <url>  bake the fleet enrollment endpoint into the image,
                          e.g. http://172.16.21.17:8787 . Without it the card
                          boots and reports that no endpoint is configured.
  --release-source <url>  bake the release service the Hub's update agent polls,
                          so a Hub change can arrive as a governed release
                          instead of a reflash (a DEFAULT; the device may
                          override it at /persistent/shared/kitluy/
                          release-source.env)
  --development-unbound-storage
                          authorize the DEVELOPMENT-UNBOUND data-volume key in
                          the image, so a fresh development Hub card boots
                          without a hand-made marker file. DEVELOPMENT IMAGES
                          ONLY — the layer refuses it for any other environment,
                          and the provisioner refuses the posture regardless.
                          The key is derived from the board serial, which is not
                          secret: this buys reproducibility, never secrecy.
  --hub-sync-url <url>    bake the development hub-sync producer the Hub pulls
                          its terminal projections from, e.g.
                          http://172.16.21.17:8792 (HUB-TERMINAL-SYNC-001).
                          Without it the Hub provisions no terminal by itself.

Options:
  --profile <name>     Image profile to build (required).
  --channel <name>     Release channel (default: config; only `internal` builds).
  --build-dir <dir>    Builder work root (default: ../build/work).
  --filesystem-only    Build the root filesystem, skip image generation.
  --collect-only       Skip the build; re-collect and re-hash existing artifacts.
  --environment <name> Environment to BAKE into the image (default: config).
                       Not defaulted silently — the development storage and
                       listener paths key on it. pilot/production are refused.
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
    # The address the flashed device will call to enroll. Exported so the
    # kitluy-hub-base layer can bake it into /etc/kitluy/image.env, which is what
    # makes a card cloneable: every copy already knows where the fleet is.
    --enrollment-url)  ENROLLMENT_URL="${2:-}"; shift 2 ;;
    # The CLOUD registration route, as a FULL url. Separate from the fleet
    # endpoint because it is a different service: Supabase does not serve
    # /v1/device-enrollment, and the fleet service does not serve this.
    --registration-url) REGISTRATION_URL="${2:-}"; shift 2 ;;
    # The development hub-sync producer (HUB-TERMINAL-SYNC-001). A separate
    # service on a separate port, so a separate value: the fleet service does
    # not serve it, and deriving one address from another is how a device ends
    # up talking to whatever answers.
    --hub-sync-url)    HUB_SYNC_URL="${2:-}"; shift 2 ;;
    --release-source)  RELEASE_SOURCE="${2:-}"; shift 2 ;;
    --development-unbound-storage) DEV_UNBOUND_STORAGE="authorized"; shift ;;
    --allow-unconfigured-image) ALLOW_UNCONFIGURED="yes"; shift ;;
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
# THE STEP THIS SCRIPT USED TO SKIP.
#
# `package-bootstrap-runtime.sh` is what puts the agents into the rootfs overlay
# that rpi-image-gen then bakes. Nothing invoked it: it was a manual pre-step
# documented in a README, so a build run straight after a source change happily
# produced an image containing the PREVIOUS overlay. That cost two full rebuilds
# on 2026-08-31 and is the mechanism behind D-05 — the Hub agent's source, unit
# and avahi advert all existed while no card ever carried the binary.
#
# Running it here makes the flashable image a function of the source tree again.
# It is idempotent and takes about a second.
if [[ "$SKIP_PACKAGING" == "yes" ]]; then
  warn "runtime packaging skipped (--skip-packaging): the overlay may not match the source tree"
else
  log "packaging runtime components into the rootfs overlay"
  if ! bash "${SCRIPT_DIR}/package-bootstrap-runtime.sh"; then
    die "runtime packaging failed — the image would ship a stale or incomplete overlay. Build the workspace first:
  pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build
  pnpm --filter @kitluy-services/kitluy-hub-agent build:bundle"
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
HUB_SYNC_URL="${HUB_SYNC_URL:-${KITLUY_HUB_SYNC_URL:-}}"
RELEASE_SOURCE="${RELEASE_SOURCE:-${KITLUY_RELEASE_SOURCE:-}}"
DEV_UNBOUND_STORAGE="${DEV_UNBOUND_STORAGE:-}"
REGISTRATION_URL="${REGISTRATION_URL:-${KITLUY_REGISTRATION_URL:-}}"
ALLOW_UNCONFIGURED="${ALLOW_UNCONFIGURED:-no}"
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
# The endpoint a flashed device will call.
#
# Passed as an IGconf override rather than an exported shell variable: the
# layer's customize steps run inside bdebstrap, which forwards ONLY what it is
# given, so an exported KITLUY_ENROLLMENT_BASE_URL never crossed that boundary
# and the first build with --enrollment-url still produced an EMPTY endpoint.
#
# It has to be right at build time. The rootfs is erofs — read-only — so this
# cannot be corrected on the card afterwards.
# WHICH DEVICE THIS IMAGE IS.
#
# The profile has always known (`KITLUY_PROFILE_DEVICE_CLASS`) and this builder
# already writes it into the manifest — but never into the image, so the agent
# fell back to its default of `terminal`. A Store Hub built from this path would
# have enrolled as a TERMINAL, and a terminal cannot anchor the provisioning
# codes that `device_provisioning_codes.store_hub_device_id NOT NULL` requires.
# The failure would have surfaced at Store pairing, far from its cause.
RIG_OVERRIDES+=("IGconf_kitluy_device_class=${KITLUY_PROFILE_DEVICE_CLASS}")

# --- The environment, STATED (never inherited) --------------------------------
# This override did not exist, and the layer defaulted the value to
# `development`. So every image ever built declared itself a development device
# because nobody said otherwise — while DEVELOPMENT-UNBOUND storage (a LUKS key
# NOT bound to the board) and the development LAN listener both open exactly on
# that word. An implicit default was authorising two security escape paths.
#
# It now comes from the profile config, is validated here, and is asserted by the
# layer. `config/image.conf` carries `development` for this development builder;
# `--environment` overrides it.
BUILD_ENVIRONMENT="${ENVIRONMENT_OVERRIDE:-${KITLUY_ENVIRONMENT:-}}"
[[ -n "$BUILD_ENVIRONMENT" ]] \
  || die "no environment resolved: set KITLUY_ENVIRONMENT in config/image.conf or pass --environment. It is deliberately not defaulted — the development storage and listener paths key on it."

# SSH WITHOUT SUDO IS NOT RECOVERY ACCESS.
#
# `pi` ships with a LOCKED password, so an image carrying a development SSH key
# but no sudoers grant gives a shell that cannot restart a unit, read a protected
# log or repair a volume. That shipped: on 2026-09-08 a Hub needed one `wipefs`
# to recover its data volume and the only account that could reach the board
# could not become root. Half of recovery access is worse than none, because it
# looks serviceable.
#
# DELIBERATELY PLACED HERE, not beside the key check above: `BUILD_ENVIRONMENT`
# is not resolved until this point, and the first version of this read an unset
# variable and silently never granted anything.
if [[ -n "${KITLUY_DEV_SSH_PUBKEY:-}" ]]; then
  if [[ "$BUILD_ENVIRONMENT" == "development" ]]; then
    RIG_OVERRIDES+=("IGconf_kitluy_dev_recovery_sudo=yes")
    log "recovery access: pi may use sudo without a password (DEVELOPMENT ONLY)"
  else
    warn "environment '${BUILD_ENVIRONMENT}': SSH key installed, but NO sudo grant."
    warn "  pi has a locked password, so this image can be logged into and little"
    warn "  else. That is deliberate outside development."
  fi
fi

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
# which is right for anything that could reach a shop: a Store Hub holds device
# credentials and a local database, and `pi` is reachable over SSH by key.
#
# It also makes the device UNDIAGNOSABLE. `/var/lib/kitluy` is root-only 0750, so
# the agents' own state — registration, pairing, operational credential — cannot
# be read at all, and `journalctl` returns nothing for system units. A bring-up
# session spent most of a day inferring device state from server logs because of
# this, and got it wrong twice.
#
# `KITLUY_DEV_SUDO=1` grants passwordless sudo to `pi` for DEVELOPMENT images
# only. It must never be set for a pilot or production build; those are signed
# artifacts and this flag is not part of that path.
if [[ "${KITLUY_DEV_SUDO:-}" == "1" ]]; then
  RIG_OVERRIDES+=("IGconf_device_user1sudo=nopasswd")
  warn "DEVELOPMENT SUDO ENABLED: user 'pi' has passwordless sudo in this image."
  warn "  Diagnostic only. Never build a pilot or production artifact with KITLUY_DEV_SUDO=1."
fi
log "device class baked: ${KITLUY_PROFILE_DEVICE_CLASS}"

if [[ -n "$ENROLLMENT_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_enrollment_url=${ENROLLMENT_URL}")
  log "enrollment endpoint baked: ${ENROLLMENT_URL}"
else
  warn "no --enrollment-url given: the image will boot and report that no"
  warn "  enrollment endpoint is configured. The rootfs is read-only, so this"
  warn "  cannot be fixed on the card — rebuild with --enrollment-url."
fi

# THE CLOUD REGISTRATION ROUTE.
#
# Without it the device cannot announce itself to KitLuy at all, and — because
# the rootfs is read-only and dm-verity protected — nothing on the flashed card
# can add it later. Warned about in the same terms as the fleet endpoint, and
# for the same reason: the fix is a rebuild, and the operator should learn that
# here rather than with a card in their hand.
# =============================================================================
# AN IMAGE THAT CANNOT REACH THE CLOUD IS REFUSED, NOT WARNED.
#
# These three values are command-line inputs, not source. When they are absent
# the build used to WARN and carry on, producing an image that looks perfect,
# passes every gate, and is inert: no registration route, no profile key, no
# root pin. On 2026-09-10 exactly that happened — both images were rebuilt with
# none of them, two SD cards were flashed, and the boards booted and sat there.
# The warnings were in the build log and were not read.
#
# A warning that is routinely ignored is not a control. This refuses.
#
# `--allow-unconfigured-image` is the deliberate escape hatch, for building a
# rootfs whose cloud wiring is supplied some other way. It has to be typed.
# =============================================================================
if [[ "$ALLOW_UNCONFIGURED" != "yes" ]]; then
  MISSING=()
  [[ -n "$REGISTRATION_URL" ]] || MISSING+=("--registration-url        (the device cannot register at all)")
  [[ -n "$HARDWARE_PROFILE_KEY" ]] || MISSING+=("--hardware-profile-key    (registration is refused KLUY-REG-UNKNOWN-PROFILE)")
  [[ -n "${KITLUY_DEV_PKI_DIR:-}" ]] || MISSING+=("\$KITLUY_DEV_PKI_DIR       (no root pin: no operational certificate can be adopted)")
  if [[ ${#MISSING[@]} -gt 0 ]]; then
    printf '\n[%s] REFUSED: this image would be inert on the bench.\n\n' "kitluy-store-hub-image" >&2
    printf '  missing: %s\n' "${MISSING[@]}" >&2
    printf '\n  The rootfs is read-only, so none of these can be corrected on the card:\n' >&2
    printf '  the only fix is a rebuild and another flash.\n\n' >&2
    printf '  Example:\n' >&2
    printf '    KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub \\\n' >&2
    printf '    KITLUY_DEV_PKI_DIR=<workspace>/local-config/het-kitluy-project/dev-pki \\\n' >&2
    printf '      %s --profile %s --environment development \\\n' "$0" "$PROFILE" >&2
    printf '        --registration-url http://<lan-ip>:54371/functions/v1/device-registration \\\n' >&2
    printf '        --hardware-profile-key <KEY>\n\n' >&2
    printf '  Deliberately building an unconfigured rootfs? Pass --allow-unconfigured-image.\n\n' >&2
    exit 2
  fi
fi

if [[ -n "$REGISTRATION_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_registration_url=${REGISTRATION_URL}")
  log "cloud registration route baked: ${REGISTRATION_URL}"
else
  warn "no --registration-url given: this image cannot register itself to the"
  warn "  cloud. The rootfs is read-only, so rebuild with --registration-url."
fi

# THE HUB-SYNC PRODUCER AND ITS TRUST ANCHOR (HUB-TERMINAL-SYNC-001).
#
# Two things, and the Hub needs both or it provisions no terminal: the address
# of the development producer (into /etc/kitluy/hub.env) and the PUBLIC record
# of the key that producer signs with (into /etc/kitluy/hub-sync-trust.json).
# The record is compacted to one line because rpi-image-gen refuses an override
# containing a newline; the JSON is identical. ABSENT IS SAFE: with either one
# missing the sync says so once at start and does nothing.
# ---------------------------------------------------------------------------
# THE DEVELOPMENT-UNBOUND STORAGE AUTHORIZATION (development images only).
# ---------------------------------------------------------------------------
# The marker file the provisioner otherwise demands lives on the persistent
# partition, which a reflash rewrites — so every fresh Hub card stopped with the
# data volume locked, and with it the database, the agent and the LAN API. The
# owner met that on 2026-09-23 and ruled it off the development path. The
# environment gate is what protects production, and it is enforced twice: here,
# and again in the layer against the image.env this build actually wrote.
if [[ -n "$DEV_UNBOUND_STORAGE" ]]; then
  if [[ "$BUILD_ENVIRONMENT" != "development" ]]; then
    die "--development-unbound-storage is development-only; this build is '${BUILD_ENVIRONMENT}'.
  The DEVELOPMENT-UNBOUND key is derived from the board serial, which is not
  secret, so the volume is reproducible by anyone who can read it."
  fi
  RIG_OVERRIDES+=("IGconf_kitluy_hub_storage_development_unbound=authorized")
  log "DEVELOPMENT-UNBOUND storage authorized in this image (development only; key derived from the board serial, NOT secret)"
fi

# ---------------------------------------------------------------------------
# THE RELEASE TRUST ANCHOR — why a Store Hub needs one as much as a Terminal.
# ---------------------------------------------------------------------------
# This image has always shipped the update agent and never given it anything to
# trust, so on the owner's Hub it woke every five minutes and refused to look at
# any payload ("no public release trust anchor in /etc/kitluy/trust"). The price
# was a reflash for every Hub change — and a Hub reflash wipes /persistent, the
# Store's own database. With the anchor, a Hub fix travels the same governed
# path as a Terminal's: signed release, verified digest, A/B install.
if [[ -n "${KITLUY_DEV_PKI_DIR:-}" && -f "${KITLUY_DEV_PKI_DIR}/dev-release-signing.json" ]]; then
  # Compacted to one line: rpi-image-gen refuses an override containing a
  # newline, and the record on disk is pretty-printed. Same JSON, less space.
  RELEASE_TRUST_RECORD="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' "${KITLUY_DEV_PKI_DIR}/dev-release-signing.json")"
  if grep -q "PRIVATE KEY" <<<"$RELEASE_TRUST_RECORD"; then
    die "${KITLUY_DEV_PKI_DIR}/dev-release-signing.json contains a PRIVATE KEY block. A device carries public material only."
  fi
  RIG_OVERRIDES+=("IGconf_kitluy_release_trust_record=${RELEASE_TRUST_RECORD}")
  RELEASE_KEY_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).keyId)' "${KITLUY_DEV_PKI_DIR}/dev-release-signing.json")"
  log "release trust anchor baked: ${RELEASE_KEY_ID:0:16}... (release_signing, development)"
else
  warn "no release trust anchor: this Hub REFUSES every release payload, so every"
  warn "  Hub change costs a reflash — and a reflash wipes the Store database."
  warn "  Run: pnpm pki:bootstrap-dev --dir \$KITLUY_DEV_PKI_DIR --release-key-only"
fi

if [[ -n "$RELEASE_SOURCE" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_release_source=${RELEASE_SOURCE}")
  log "release source default: ${RELEASE_SOURCE} (overridable on the device)"
else
  warn "no --release-source: the image bakes an empty default. Set one on the"
  warn "  device at /persistent/shared/kitluy/release-source.env, or rebuild."
fi

if [[ -n "$HUB_SYNC_URL" ]]; then
  RIG_OVERRIDES+=("IGconf_kitluy_hub_sync_url=${HUB_SYNC_URL}")
  log "hub-sync producer baked: ${HUB_SYNC_URL}"
else
  warn "no --hub-sync-url given: this Hub will NOT provision its terminals by itself"
  warn "  (the manual hub-provision-terminal door remains)."
fi
if [[ -n "${KITLUY_DEV_PKI_DIR:-}" && -f "${KITLUY_DEV_PKI_DIR}/dev-hub-sync-signing.json" ]]; then
  HUB_SYNC_TRUST_RECORD="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' "${KITLUY_DEV_PKI_DIR}/dev-hub-sync-signing.json")"
  if grep -q "PRIVATE KEY" <<<"$HUB_SYNC_TRUST_RECORD"; then
    die "${KITLUY_DEV_PKI_DIR}/dev-hub-sync-signing.json contains a PRIVATE KEY block. A device carries public material only."
  fi
  RIG_OVERRIDES+=("IGconf_kitluy_hub_sync_trust_record=${HUB_SYNC_TRUST_RECORD}")
  HUB_SYNC_KEY_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).keyId)' "${KITLUY_DEV_PKI_DIR}/dev-hub-sync-signing.json")"
  log "hub-sync trust anchor baked: ${HUB_SYNC_KEY_ID:0:16}... (transport_signing, development)"
else
  warn "no hub-sync trust anchor: the Hub will refuse every terminal-projection envelope."
  warn "  Run: node scripts/pki/bootstrap-dev-pki.mjs --dir \$KITLUY_DEV_PKI_DIR --hub-sync-key-only"
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
      --hardware-profile-key CLOUD-HUB-PI5"
fi

# THE PINNED DEVELOPMENT ROOT DIGEST.
#
# The Hub verifies its operational certificate against a PINNED root: a chain
# that verifies internally proves only that it is SELF-CONSISTENT, so the pin is
# the only thing that makes it OURS.
#
# TOP LEVEL, deliberately. The first version of this sat inside the
# `if [[ -n "$HARDWARE_PROFILE_KEY" ]]` block above and therefore never ran for a
# build that passed no profile key — the image came out with no pin and nothing
# said so. The pin has nothing to do with the profile key.
#
# Read from the operator's $KITLUY_DEV_PKI_DIR at build time and NEVER committed:
# `scripts/verification/assert-no-dev-pki.mjs` refuses development CA material in
# the repository, and rightly. A SHA-256 of a public certificate is not key
# material — it authorises nothing and signs nothing.
#
# ABSENT IS SAFE. A Hub with no pin REFUSES to adopt any certificate rather than
# adopting an unverified one, so an image built on a machine without the
# development PKI — every CI runner — is inert on this path rather than
# dangerous.
if [[ -n "${KITLUY_DEV_PKI_DIR:-}" && -f "${KITLUY_DEV_PKI_DIR}/dev-root-ca.crt.pem" ]]; then
  DEV_ROOT_SHA256="$(node -e '
    const {createHash} = require("crypto"), fs = require("fs");
    const pem = fs.readFileSync(process.argv[1], "utf8");
    const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
    process.stdout.write(createHash("sha256").update(der).digest("hex"));
  ' "${KITLUY_DEV_PKI_DIR}/dev-root-ca.crt.pem")"
  RIG_OVERRIDES+=("IGconf_kitluy_development_root_sha256=${DEV_ROOT_SHA256}")
  # Only the first bytes, so a build log never carries the whole pin.
  log "development root pinned into the image: ${DEV_ROOT_SHA256:0:16}..."
else
  warn "no \$KITLUY_DEV_PKI_DIR: the image carries NO root pin, and the Hub will"
  warn "  refuse to adopt any operational certificate until one is built in."
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
