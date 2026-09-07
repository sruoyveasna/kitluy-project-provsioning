#!/usr/bin/env bash
# The image's declared environment, and why it may never be implicit.
#
# WHAT THIS PROTECTS
# -----------------------------------------------------------------------------
# Development-only behaviour on both KitLuy images opens on one word:
# `KITLUY_ENVIRONMENT=development`. Until BRINGUP-003 the layer DEFAULTED that
# value and the builder never passed one, so every image ever produced
# authorised it by omission. Nobody had chosen it; it was simply what the file
# said when no one said otherwise.
#
# The correction has two halves and this file asserts both:
#
#   1. the builder must STATE the environment, and unknown/pilot/production
#      are refused there;
#   2. the layer ships EMPTY, so an image built by some other path declares
#      nothing — and every reader treats an absent value as `unknown`.
#
#   bash infra/kitluy-os-image/test/environment-gating.test.sh
#
# The builder cases stop before any image work, so this suite is fast.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ROOT}/scripts/build-rpi-image.sh"
LAYER="${ROOT}/rpi-image-gen/layer/kitluy-base.yaml"
AGENT_SRC="${ROOT}/../../services/kitluy-device-firstboot-agent/src"

PASS=0
FAIL=0
ok()  { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

printf '\nKitLuy Pi Terminal image — environment gating\n\n'

# A pubkey is required before the builder reaches the environment check; any
# readable file satisfies the shape test, and none of these runs builds anything.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "${TMP}/probe" 2>/dev/null
export KITLUY_DEV_SSH_PUBKEY="${TMP}/probe.pub"

# `--collect-only` branches AFTER the environment override is assembled, so the
# gate and its log line are exercised with no image build.
run_build() {
  OUT="$(timeout 180 bash "$BUILD" --profile pi-terminal --skip-doctor --skip-packaging \
          --collect-only --environment "$1" 2>&1)"
  RC=$?
}

# ---------------------------------------------------------------------------
# 0. This tree builds the terminal only
# ---------------------------------------------------------------------------
OUT="$(timeout 60 bash "$BUILD" --profile store-hub --skip-doctor --skip-packaging --collect-only 2>&1)"
if [[ $? -ne 0 && "$OUT" == *"infra/kitluy-store-hub-image"* ]]; then
  ok "the store-hub profile is refused and pointed at its own tree"
else
  bad "the store-hub profile is refused and pointed at its own tree" "out=$(printf '%s' "$OUT" | tail -2)"
fi

# ---------------------------------------------------------------------------
# 1. Unknown environments are refused
# ---------------------------------------------------------------------------
for value in bogus develop Development DEVELOPMENT dev prod " development"; do
  run_build "$value"
  if [[ $RC -ne 0 && "$OUT" == *"is not a KitLuy environment"* ]]; then
    ok "environment '${value}' is refused"
  else
    bad "environment '${value}' is refused" "rc=$RC out=$(printf '%s' "$OUT" | tail -2)"
  fi
done

if grep -q 'no environment resolved' "$BUILD"; then
  ok "the builder refuses when neither an override nor a config value exists"
else
  bad "the builder refuses when neither an override nor a config value exists" \
      "an unresolved environment would fall through"
fi

# ---------------------------------------------------------------------------
# 2. Pilot, production and disaster recovery cannot be produced here
# ---------------------------------------------------------------------------
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
if [[ "$OUT" == *"IGconf_kitluy_device_class=terminal"* ]]; then
  ok "the device class is passed to the image builder as an override"
else
  bad "the device class is passed to the image builder as an override" "the image would register as the agent's default"
fi

# ---------------------------------------------------------------------------
# 4. The layer ships NO environment
# ---------------------------------------------------------------------------
if grep -qE '^\s*KITLUY_ENVIRONMENT=\s*$' "$LAYER"; then
  ok "the image layer declares an EMPTY environment (no implicit default)"
else
  baked="$(grep -oP '(?<=^\s{6}KITLUY_ENVIRONMENT=).*' "$LAYER" | head -1)"
  bad "the image layer declares an EMPTY environment (no implicit default)" \
      "it defaults to '${baked}', which authorises development behaviour by omission"
fi

if grep -q 'REFUSED: this image declares no KITLUY_ENVIRONMENT' "$LAYER"; then
  ok "the layer fails the build when no environment was supplied"
else
  bad "the layer fails the build when no environment was supplied" \
      "an image with no declared environment would be produced and shipped"
fi

if grep -q 'local|development|staging|pilot|production|disaster_recovery' "$LAYER"; then
  ok "the layer validates the environment it is handed"
else
  bad "the layer validates the environment it is handed" "any string would be baked verbatim"
fi

# ---------------------------------------------------------------------------
# 5. The readers fail closed on an absent value
# ---------------------------------------------------------------------------
# The terminal ships no shell provisioners; its readers are the agents, which
# reach image.env through ONE reader. An EMPTY value must read as undefined, so
# an image built by a path that forgot the override cannot be mistaken for a
# development device.
if grep -q 'return value.length === 0 ? undefined : value' "${AGENT_SRC}/image-env.ts"; then
  ok "readImageEnv: an empty value reads as undefined"
else
  bad "readImageEnv: an empty value reads as undefined" "an empty KITLUY_ENVIRONMENT could be read as a value"
fi

if grep -rqE 'KITLUY_ENVIRONMENT:-development' "${ROOT}/rpi-image-gen/layer" "${ROOT}/scripts" 2>/dev/null; then
  bad "no image script defaults the environment to development" \
      "$(grep -rlE 'KITLUY_ENVIRONMENT:-development' "${ROOT}/rpi-image-gen/layer" "${ROOT}/scripts" | head -3 | tr '\n' ' ')"
else
  ok "no image script defaults the environment to development"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
