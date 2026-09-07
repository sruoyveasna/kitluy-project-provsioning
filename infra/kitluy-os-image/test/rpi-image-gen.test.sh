#!/usr/bin/env bash
# KitLuy OS image — rpi-image-gen integration tests.
#
# Validates the KitLuy external source (config/, layer/) against the PINNED
# upstream builder. Two classes of check:
#
#   1. STANDALONE  — structure, pin integrity, zero-secret, clone hygiene.
#                    Always run.
#   2. UPSTREAM    — every device/image/suite layer name KitLuy references
#                    actually exists in the pinned tree.
#                    Run only when the pinned tree is available locally;
#                    reported as SKIPPED (never as passed) otherwise.
#
# Point KITLUY_RIG_UPSTREAM at a checkout of the pinned tag to enable class 2:
#   git clone --depth 1 --branch v2.7.0 https://github.com/raspberrypi/rpi-image-gen /tmp/rig
#   KITLUY_RIG_UPSTREAM=/tmp/rig bash infra/kitluy-os-image/test/rpi-image-gen.test.sh
#
# This test NEVER builds an image and never needs root.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/rpi-image-gen"
PIN="${SRC}/upstream.pin"

PASS=0
FAIL=0
SKIP=0
ok()   { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }
skip() { printf '  SKIP %s\n     %s\n' "$1" "${2:-}"; SKIP=$((SKIP + 1)); }

printf '\nKitLuy OS image — rpi-image-gen integration tests\n\n'

# --- Pin integrity ----------------------------------------------------------
if [[ -f "$PIN" ]]; then
  ok "upstream.pin exists"
  # shellcheck disable=SC1090
  source "$PIN"
else
  bad "upstream.pin exists" "missing — the build cannot be called reproducible"
  printf '\n  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
  exit 1
fi

[[ "${KITLUY_RIG_REPOSITORY:-}" == *"raspberrypi/rpi-image-gen"* ]] \
  && ok "pins the upstream Raspberry Pi builder" \
  || bad "pins the upstream Raspberry Pi builder" "got '${KITLUY_RIG_REPOSITORY:-}'"

# A 40-hex commit is what makes the pin immutable. A tag alone can be moved.
[[ "${KITLUY_RIG_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] \
  && ok "pins an immutable 40-hex commit" \
  || bad "pins an immutable 40-hex commit" "got '${KITLUY_RIG_COMMIT:-}'"

[[ -n "${KITLUY_RIG_TAG:-}" && "${KITLUY_RIG_TAG}" != "master" && "${KITLUY_RIG_TAG}" != "main" ]] \
  && ok "pins a release tag, not a moving branch" \
  || bad "pins a release tag, not a moving branch" "got '${KITLUY_RIG_TAG:-}'"

# --- The builder is a dependency, not a fork --------------------------------
# Vendoring upstream would turn every upstream fix into a manual merge, which
# is the specific outcome the external-source model exists to avoid.
if [[ -d "${SRC}/lib" || -f "${SRC}/rpi-image-gen" || -d "${SRC}/device" ]]; then
  bad "upstream is not vendored into the repository" "found upstream tree inside ${SRC}"
else
  ok "upstream is not vendored into the repository"
fi

# --- External-source structure ----------------------------------------------
for d in config layer; do
  [[ -d "${SRC}/${d}" ]] && ok "external source has ${d}/" || bad "external source has ${d}/" "missing"
done

CONFIGS=(kitluy-pi-terminal)
for c in "${CONFIGS[@]}"; do
  [[ -f "${SRC}/config/${c}.yaml" ]] && ok "config ${c}.yaml present" || bad "config ${c}.yaml present" "missing"
done

LAYERS=(kitluy-base kitluy-pi-terminal)
for l in "${LAYERS[@]}"; do
  f="${SRC}/layer/${l}.yaml"
  if [[ -f "$f" ]]; then
    ok "layer ${l}.yaml present"
    grep -q "X-Env-Layer-Name: ${l}" "$f" \
      && ok "layer ${l} declares its own name" \
      || bad "layer ${l} declares its own name" "METABEGIN name mismatch"
    grep -q "METABEGIN" "$f" && grep -q "METAEND" "$f" \
      && ok "layer ${l} has a complete META block" \
      || bad "layer ${l} has a complete META block" "missing METABEGIN/METAEND"
  else
    bad "layer ${l}.yaml present" "missing"
  fi
done

# --- The terminal profile builds on the common base --------------------------
# One platform. The Store Hub image has its own tree (owner decision 2026-08-13)
# and its own copy of this check; the stale store-hub files here are not asserted.
for l in kitluy-pi-terminal; do
  grep -q "X-Env-Layer-Requires: kitluy-base" "${SRC}/layer/${l}.yaml" 2>/dev/null \
    && ok "${l} builds on kitluy-base" \
    || bad "${l} builds on kitluy-base" "does not require the common base"
done

# --- Profile separation -----------------------------------------------------
grep -qi "postgresql" "${SRC}/layer/kitluy-pi-terminal.yaml" 2>/dev/null \
  && bad "terminal does NOT carry a local database" "found postgresql" \
  || ok "terminal does NOT carry a local database"
grep -qiE "labwc|wayland" "${SRC}/layer/kitluy-pi-terminal.yaml" 2>/dev/null \
  && ok "terminal carries the Wayland/labwc kiosk runtime" || bad "terminal carries the Wayland/labwc kiosk runtime" "absent"

# --- Zero-secret (mission §23) ----------------------------------------------
if grep -rIqE 'service_role|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*.+|BEGIN [A-Z ]*PRIVATE KEY|PGPASSWORD[[:space:]]*=[[:space:]]*.+' "$SRC" 2>/dev/null; then
  bad "external source is zero-secret" "credential material found"
else
  ok "external source is zero-secret"
fi

# --- No assignment truth baked in (mission §23) -----------------------------
if grep -rIqE 'KITLUY_TENANT_ID=.+|KITLUY_DIGITAL_STORE_ID=.+|KITLUY_LOCATION_ID=.+|KITLUY_TERMINAL_PROFILE=.+|KITLUY_HUB_ENDPOINT=.+' "$SRC" 2>/dev/null; then
  bad "no assignment truth is baked into the image" "assignment value found"
else
  ok "no assignment truth is baked into the image"
fi

# --- Clone hygiene (mission §15) --------------------------------------------
# Two devices flashed from one golden image must not enrol as the same device.
BASE="${SRC}/layer/kitluy-base.yaml"
grep -q 'etc/machine-id' "$BASE" 2>/dev/null \
  && ok "machine-id is reset in the golden image" \
  || bad "machine-id is reset in the golden image" "clones would share a machine identity"
grep -q 'ssh_host_' "$BASE" 2>/dev/null \
  && ok "SSH host keys are not pre-seeded" \
  || bad "SSH host keys are not pre-seeded" "clones would share host keys"
grep -qE 'hub-endpoint|assignment\.json' "${SRC}/layer/kitluy-pi-terminal.yaml" 2>/dev/null \
  && ok "terminal carries no cached endpoint or assignment" \
  || bad "terminal carries no cached endpoint or assignment" "cached per-device state may survive imaging"

# --- Trusted time (owner-fixed: all three sources) --------------------------
grep -q "systemd-timesyncd" "$BASE" 2>/dev/null && grep -q "fake-hwclock" "$BASE" 2>/dev/null \
  && ok "base requires both authenticated time and an RTC source" \
  || bad "base requires both authenticated time and an RTC source" "trusted time needs all sources, not a choice"

# --- Upstream name validation (class 2) -------------------------------------
UP="${KITLUY_RIG_UPSTREAM:-}"
if [[ -z "$UP" || ! -d "$UP" ]]; then
  skip "upstream layer names validated against the pinned tree" \
       "set KITLUY_RIG_UPSTREAM to a checkout of ${KITLUY_RIG_TAG} to enable"
else
  UP_COMMIT="$(git -C "$UP" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [[ "$UP_COMMIT" == "$KITLUY_RIG_COMMIT" ]]; then
    ok "upstream checkout matches the pinned commit"
  else
    bad "upstream checkout matches the pinned commit" "checkout ${UP_COMMIT} != pin ${KITLUY_RIG_COMMIT}"
  fi

  names() { grep -rh "X-Env-Layer-Name:" "$@" 2>/dev/null | sed 's/.*X-Env-Layer-Name: *//'; }
  UP_NAMES="$(names "$UP/layer" "$UP/device" "$UP/image")"

  for n in "$KITLUY_RIG_DEVICE_LAYER" "$KITLUY_RIG_IMAGE_LAYER" "$KITLUY_RIG_SUITE_LAYER"; do
    grep -qx "$n" <<< "$UP_NAMES" \
      && ok "pinned layer '${n}' exists upstream" \
      || bad "pinned layer '${n}' exists upstream" "not found in ${KITLUY_RIG_TAG}"
  done

  # Every upstream layer the KitLuy layers require must actually exist.
  #
  # The Requires block is a continuation list: the key line plus any following
  # `#  <name>,` lines, ending at the next X-Env- key or METAEND. Parsing it by
  # matching "#  " alone would also swallow wrapped Desc text.
  REQUIRED="$(awk '
    /X-Env-Layer-Requires:/ { sub(/.*X-Env-Layer-Requires: */, ""); print; inblock=1; next }
    inblock && /^# *X-Env-|^# *METAEND/ { inblock=0 }
    inblock && /^#  / { sub(/^#  */, ""); print }
  ' "${SRC}"/layer/*.yaml 2>/dev/null | tr -d ' ' | sed 's/,$//' | grep -v '^$' | sort -u)"
  MISSING=""
  while read -r req; do
    [[ -z "$req" ]] && continue
    # KitLuy's own layers are satisfied from this source directory.
    [[ "$req" == kitluy-* ]] && continue
    grep -qx "$req" <<< "$UP_NAMES" || MISSING="${MISSING} ${req}"
  done <<< "$REQUIRED"
  if [[ -z "$MISSING" ]]; then
    ok "every upstream layer referenced by KitLuy exists in ${KITLUY_RIG_TAG}"
  else
    bad "every upstream layer referenced by KitLuy exists in ${KITLUY_RIG_TAG}" "missing:${MISSING}"
  fi

  # Config keys must be ones the pinned builder actually consumes. Inventing a
  # key is silent: an unknown key is ignored and the image is quietly wrong.
  #
  # TWO SOURCES, AND THE SECOND IS THE AUTHORITATIVE ONE.
  #
  # Example configs show what somebody happened to write. What the builder
  # ACCEPTS is declared by each layer's META block: `X-Env-VarPrefix: ssh`
  # names the section and `X-Env-Var-pubkey_only:` names the key within it.
  # Reading only the examples rejected `ssh.pubkey_only` as unknown, which is
  # wrong: v2.7.0 implements it in layer/net-misc/openssh-server.yaml, and a
  # built rootfs carries the /etc/ssh/sshd_config.d/01pubkey-only.conf it
  # writes. A gate that fails on a correct config teaches people to skip it.
  #
  # The example corpus is still read, because it covers keys consumed by the
  # runner rather than by a layer (`layer.custom`, `image.compression`), which
  # have no META declaration anywhere.
  UP_CONFIG_KEYS="$(
    grep -rhoE '^[a-z_]+:|^  [a-z_]+:' \
      "$UP"/config/*.yaml "$UP"/examples/*/config/*.yaml "$UP"/test/configurations/config/*.yaml \
      "$UP"/getting_started.adoc "$UP"/docs/config/*.adoc \
      2>/dev/null | tr -d ' :'
    grep -rhoE '^# X-Env-VarPrefix: [a-z_]+|^# X-Env-Var-[a-z_]+:' "$UP"/layer 2>/dev/null \
      | sed -E 's/^# X-Env-VarPrefix: //; s/^# X-Env-Var-//; s/:$//'
  )"
  UP_CONFIG_KEYS="$(printf '%s\n' "$UP_CONFIG_KEYS" | sort -u)"
  BADKEY=""
  for c in "${CONFIGS[@]}"; do
    while read -r key; do
      [[ -z "$key" ]] && continue
      grep -qx "$key" <<< "$UP_CONFIG_KEYS" || BADKEY="${BADKEY} ${c}:${key}"
    done <<< "$(grep -oE '^[a-z_]+:|^  [a-z_]+:' "${SRC}/config/${c}.yaml" 2>/dev/null | tr -d ' :' | sort -u)"
  done
  if [[ -z "$BADKEY" ]]; then
    ok "KitLuy configs use only keys present in the pinned upstream configs"
  else
    bad "KitLuy configs use only keys present in the pinned upstream configs" "unknown:${BADKEY}"
  fi
fi

printf '\n  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[[ $FAIL -eq 0 ]] || exit 1
