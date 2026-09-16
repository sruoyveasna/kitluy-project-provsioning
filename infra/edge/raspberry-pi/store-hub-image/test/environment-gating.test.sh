#!/usr/bin/env bash
# The image's declared environment, and why it may never be implicit.
#
# WHAT THIS PROTECTS
# -----------------------------------------------------------------------------
# Two security escape paths open on one word:
#
#   DEVELOPMENT-UNBOUND storage — a LUKS key NOT bound to the board
#   the development LAN listener — a pairing signer composed locally
#
# Both require `KITLUY_ENVIRONMENT=development`. Until BRINGUP-003 the image
# layer DEFAULTED that value to `development` and the builder never passed one,
# so every image ever produced authorised both by omission. Nobody had chosen
# it; it was simply what the file said when no one said otherwise.
#
# The correction has two halves and this file asserts both:
#
#   1. the builder must STATE the environment, and unknown/pilot/production
#      are refused there;
#   2. the layer ships EMPTY, so an image built by some other path declares
#      nothing — and every development escape path reads `unknown` and refuses.
#
#   bash infra/edge/raspberry-pi/store-hub-image/test/environment-gating.test.sh
#
# The builder cases stop before any image work, so this suite is fast.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ROOT}/scripts/build-rpi-image.sh"
LAYER="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.yaml"

PASS=0
FAIL=0
ok()  { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

printf '\nKitLuy OS image — environment gating\n\n'

# A pubkey is required before the builder reaches the environment check; any
# readable file satisfies the shape test, and none of these runs builds anything.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "${TMP}/probe" 2>/dev/null
export KITLUY_DEV_SSH_PUBKEY="${TMP}/probe.pub"

# `--collect-only` branches AFTER the environment override is assembled, so the
# gate and its log line are exercised with no image build. Without it the
# accepted cases would each start a twenty-minute cross-build.
run_build() {
  # `--allow-unconfigured-image` because this suite is ABOUT environment
  # plumbing, not cloud wiring: it deliberately builds with no registration
  # URL, profile key or root pin. Without the flag the 2026-09-10 guard refuses
  # first and the overrides under test are never assembled. The guard is what
  # stops an inert image reaching an SD card; saying so here is the difference
  # between a deliberate unconfigured build and an accidental one.
  OUT="$(timeout 180 bash "$BUILD" --profile store-hub --skip-doctor --skip-packaging \
          --collect-only --allow-unconfigured-image --environment "$1" 2>&1)"
  RC=$?
}

# ---------------------------------------------------------------------------
# 1. Unknown environments are refused
# ---------------------------------------------------------------------------
# An ALLOWLIST, not a denylist. A typo must refuse rather than fall through to
# whatever the layer happened to contain.
# `--environment ""` is deliberately NOT in this list: an empty override means
# "not supplied", and the profile config then states the value. That is the
# intended path. The defect was the config value never being passed ON.
for value in bogus develop Development DEVELOPMENT dev prod " development"; do
  run_build "$value"
  if [[ $RC -ne 0 && "$OUT" == *"is not a KitLuy environment"* ]]; then
    ok "environment '${value}' is refused"
  else
    bad "environment '${value}' is refused" "rc=$RC out=$(printf '%s' "$OUT" | tail -2)"
  fi
done

# The both-absent case is unreachable from the command line while
# config/image.conf states a value, which is deliberate. Its guard is asserted
# at source; the LAYER assertion further down is the runtime backstop that fires
# if any path ever hands the builder nothing.
if grep -q 'no environment resolved' "$BUILD"; then
  ok "the builder refuses when neither an override nor a config value exists"
else
  bad "the builder refuses when neither an override nor a config value exists" \
      "an unresolved environment would fall through"
fi

# ---------------------------------------------------------------------------
# 2. Pilot, production and disaster recovery cannot be produced here
# ---------------------------------------------------------------------------
# The channel gate refuses to BUILD them. This refuses to LABEL an artifact as
# one: an image marked `production` from this host would carry a posture the
# artifact cannot support, and the marking is what downstream checks trust.
for value in pilot production disaster_recovery; do
  run_build "$value"
  if [[ $RC -ne 0 && "$OUT" == *"BLK-005"* ]]; then
    ok "environment '${value}' cannot be produced by this builder (BLK-005)"
  else
    bad "environment '${value}' cannot be produced by this builder (BLK-005)" "rc=$RC out=$(printf '%s' "$OUT" | tail -2)"
  fi
done

# ---------------------------------------------------------------------------
# 3. Development is accepted, and STATED
# ---------------------------------------------------------------------------
# The positive case. It must both pass the gate and appear in the override list
# actually handed to the builder — passing the check while forgetting to pass
# the value is exactly the bug this replaces.
run_build development
if [[ "$OUT" == *"image environment: development (stated explicitly, not defaulted)"* ]]; then
  ok "development is accepted and announced as stated"
else
  bad "development is accepted and announced as stated" "no statement line in output"
fi
if [[ "$OUT" == *"IGconf_kitluy_environment=development"* ]]; then
  ok "the environment is passed to the image builder as an override"
else
  bad "the environment is passed to the image builder as an override" \
      "the value was validated but never handed to rpi-image-gen — the original defect"
fi

# ---------------------------------------------------------------------------
# 4. The layer ships NO environment
# ---------------------------------------------------------------------------
# The other half. If the layer carried `development` again, an image built by
# any path that forgot the override would silently authorise both escape paths.
if grep -qE '^\s*KITLUY_ENVIRONMENT=\s*$' "$LAYER"; then
  ok "the image layer declares an EMPTY environment (no implicit default)"
else
  baked="$(grep -oP '(?<=^\s{6}KITLUY_ENVIRONMENT=).*' "$LAYER" | head -1)"
  bad "the image layer declares an EMPTY environment (no implicit default)" \
      "it defaults to '${baked}', which authorises the development escape paths by omission"
fi

# And the layer must FAIL THE BUILD when nothing supplied one, rather than ship
# an image whose posture nobody stated.
if grep -q 'REFUSED: this image declares no KITLUY_ENVIRONMENT' "$LAYER"; then
  ok "the layer fails the build when no environment was supplied"
else
  bad "the layer fails the build when no environment was supplied" \
      "an image with no declared environment would be produced and shipped"
fi

# The layer validates too, so an override reaching it directly cannot smuggle a
# value the builder would have refused.
if grep -q 'local|development|staging|pilot|production|disaster_recovery' "$LAYER"; then
  ok "the layer validates the environment it is handed"
else
  bad "the layer validates the environment it is handed" "any string would be baked verbatim"
fi

# ---------------------------------------------------------------------------
# 5. The readers fail closed on an absent value
# ---------------------------------------------------------------------------
# `${VAR:-unknown}` fires on EMPTY as well as unset, which is what makes an
# empty layer value safe rather than merely undefined.
for script in hub-storage-provision hub-database-provision; do
  f="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/${script}"
  if [[ -f "$f" ]] && grep -q 'KITLUY_ENVIRONMENT:-unknown' "$f"; then
    ok "${script}: an absent environment reads as 'unknown'"
  else
    bad "${script}: an absent environment reads as 'unknown'" "it may default to development"
  fi
done

if grep -q 'KITLUY_ENVIRONMENT ?? "unknown"' \
     "${ROOT}/../../../../services/kitluy-hub-agent/src/bin/hub-agent.ts"; then
  ok "hub-agent: an absent environment reads as 'unknown'"
else
  bad "hub-agent: an absent environment reads as 'unknown'" "it may default to development"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
