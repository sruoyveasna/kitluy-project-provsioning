#!/usr/bin/env bash
# KitLuy OS image — build-system tests.
#
# These test the GATES and the COMPOSITION, which is what can honestly be
# tested without Raspberry Pi hardware. Nothing here claims hardware
# certification; see 00_AI_HANDOFF/edge-platform/11_KITLUY_OS_IMAGE_IMPLEMENTATION.md.
#
# Run: bash infra/kitluy-os-image/test/build-gates.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ROOT}/scripts/build-image.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

ok()   { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# run_build <args...> -> sets OUT and RC
run_build() {
  OUT="$(bash "$BUILD" "$@" 2>&1)"
  RC=$?
}

printf '\nKitLuy OS image — build gate tests\n\n'

# --- Profile gate -----------------------------------------------------------
run_build --profile nonsense --stage-only
if [[ $RC -ne 0 && "$OUT" == *"unknown profile"* ]]; then
  ok "unknown profile is refused"
else
  bad "unknown profile is refused" "rc=$RC out=$OUT"
fi

run_build --stage-only
if [[ $RC -ne 0 && "$OUT" == *"no profile given"* ]]; then
  ok "missing profile is refused"
else
  bad "missing profile is refused" "rc=$RC"
fi

# --- Channel gate: the BLK-005 boundary -------------------------------------
# This is the most important test in the file. Pilot and stable must be
# unbuildable while the signing key is unresolved, and the refusal must name
# the blocker rather than failing generically.
for channel in pilot stable; do
  run_build --profile pi-terminal --channel "$channel" --out "${TMP}/${channel}" --stage-only
  if [[ $RC -ne 0 && "$OUT" == *"BLK-005"* ]]; then
    ok "channel '${channel}' is refused while the signing key is unresolved"
  else
    bad "channel '${channel}' is refused while the signing key is unresolved" "rc=$RC out=$OUT"
  fi
  if [[ -d "${TMP}/${channel}" ]]; then
    bad "refused '${channel}' build produced no output" "output directory exists"
  else
    ok "refused '${channel}' build produced no output"
  fi
done

run_build --profile pi-terminal --channel invalid --out "${TMP}/inv" --stage-only
if [[ $RC -ne 0 && "$OUT" == *"unknown release channel"* ]]; then
  ok "unknown release channel is refused"
else
  bad "unknown release channel is refused" "rc=$RC"
fi

# --- Internal channel builds ------------------------------------------------
run_build --profile store-hub --out "${TMP}/hub" --stage-only
if [[ $RC -eq 0 ]]; then
  ok "store-hub stages on the internal channel"
else
  bad "store-hub stages on the internal channel" "rc=$RC out=$OUT"
fi

run_build --profile pi-terminal --out "${TMP}/term" --stage-only
if [[ $RC -eq 0 ]]; then
  ok "pi-terminal stages on the internal channel"
else
  bad "pi-terminal stages on the internal channel" "rc=$RC out=$OUT"
fi

# --- Unpinned base is warned, never silently accepted -----------------------
if [[ "$OUT" == *"UNPINNED"* ]]; then
  ok "unpinned base OS is reported"
else
  bad "unpinned base OS is reported" "no warning emitted"
fi

# --- Shared base composition ------------------------------------------------
for profile in hub term; do
  for unit in kitluy-firstboot.service kitluy-enrollment-agent.service \
              kitluy-health-reporter.service kitluy-update-agent.service; do
    if [[ -f "${TMP}/${profile}/rootfs/etc/systemd/system/${unit}" ]]; then
      ok "${profile}: base unit ${unit} present"
    else
      bad "${profile}: base unit ${unit} present" "missing"
    fi
  done
  if [[ -f "${TMP}/${profile}/rootfs/etc/ssh/sshd_config.d/60-kitluy-hardening.conf" ]]; then
    ok "${profile}: ssh hardening present"
  else
    bad "${profile}: ssh hardening present" "missing"
  fi
done

# --- Ordering: identity before enrollment -----------------------------------
# Enrollment has nothing to prove possession of until identity exists.
if grep -q 'Before=kitluy-enrollment-agent.service' \
     "${TMP}/hub/rootfs/etc/systemd/system/kitluy-firstboot.service"; then
  ok "firstboot identity is ordered before enrollment"
else
  bad "firstboot identity is ordered before enrollment" "ordering absent"
fi

# --- Profile separation -----------------------------------------------------
if [[ -f "${TMP}/hub/rootfs/etc/systemd/system/kitluy-hub-agent.service" ]]; then
  ok "store-hub has the Hub agent"
else
  bad "store-hub has the Hub agent" "missing"
fi
if [[ ! -f "${TMP}/term/rootfs/etc/systemd/system/kitluy-hub-agent.service" ]]; then
  ok "pi-terminal does NOT have the Hub agent"
else
  bad "pi-terminal does NOT have the Hub agent" "terminal must not run Hub authority"
fi
if [[ -f "${TMP}/term/rootfs/etc/systemd/system/kitluy-terminal-client.service" ]]; then
  ok "pi-terminal has the kiosk client"
else
  bad "pi-terminal has the kiosk client" "missing"
fi
if [[ ! -f "${TMP}/hub/rootfs/etc/systemd/system/kitluy-terminal-client.service" ]]; then
  ok "store-hub does NOT have the kiosk client (headless)"
else
  bad "store-hub does NOT have the kiosk client (headless)" "Hub must stay headless"
fi

# --- Zero-secret image ------------------------------------------------------
# The whole staged tree must contain no credential material.
if grep -rIqE 'service_role|BEGIN [A-Z ]*PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY=.+' \
     "${TMP}/hub/rootfs" "${TMP}/term/rootfs" 2>/dev/null; then
  bad "staged roots are zero-secret" "credential material found"
else
  ok "staged roots are zero-secret"
fi

# --- No assignment truth is baked into the image ----------------------------
# A terminal image must not carry a terminal profile, Tenant, Store, Location
# or Hub endpoint. Those are delivered after cloud-authorised assignment.
if grep -rIqE 'KITLUY_TERMINAL_PROFILE=|KITLUY_TENANT_ID=|KITLUY_DIGITAL_STORE_ID=|KITLUY_LOCATION_ID=|KITLUY_HUB_ENDPOINT=' \
     "${TMP}/term/rootfs" 2>/dev/null; then
  bad "terminal image bakes no assignment truth" "assignment value found in image"
else
  ok "terminal image bakes no assignment truth"
fi

# --- Manifest honesty -------------------------------------------------------
MANIFEST="${TMP}/term/release-manifest.json"
if [[ -f "$MANIFEST" ]]; then
  ok "release manifest is emitted"
  if grep -q '"signed": false' "$MANIFEST"; then
    ok "manifest reports the artifact as unsigned"
  else
    bad "manifest reports the artifact as unsigned" "signed flag wrong"
  fi
  if grep -q '"flashableImage": false' "$MANIFEST"; then
    ok "manifest does not claim a flashable image"
  else
    bad "manifest does not claim a flashable image" "flashableImage flag wrong"
  fi
  if grep -q '"status": "STAGED-UNSIGNED"' "$MANIFEST"; then
    ok "manifest status is STAGED-UNSIGNED"
  else
    bad "manifest status is STAGED-UNSIGNED" "status wrong"
  fi
else
  bad "release manifest is emitted" "missing"
fi

# --- Assembly refusal -------------------------------------------------------
# Without --stage-only the build must refuse, not emit an unsigned .img.
run_build --profile pi-terminal --out "${TMP}/full"
if [[ $RC -eq 3 && "$OUT" == *"BLOCKED-NOT-EXECUTED"* ]]; then
  ok "full image assembly refuses honestly (exit 3)"
else
  bad "full image assembly refuses honestly (exit 3)" "rc=$RC"
fi
if compgen -G "${TMP}/full/*.img" > /dev/null; then
  bad "no .img is produced" "an image file was emitted"
else
  ok "no .img is produced"
fi

# --- Determinism ------------------------------------------------------------
# Same inputs, same staged root digest. Without this, release identity is
# meaningless even before signing exists.
run_build --profile pi-terminal --out "${TMP}/det1" --stage-only
run_build --profile pi-terminal --out "${TMP}/det2" --stage-only
D1="$(grep stagedRootDigest "${TMP}/det1/release-manifest.json" | cut -d'"' -f4)"
D2="$(grep stagedRootDigest "${TMP}/det2/release-manifest.json" | cut -d'"' -f4)"
if [[ -n "$D1" && "$D1" == "$D2" ]]; then
  ok "staged root digest is deterministic"
else
  bad "staged root digest is deterministic" "$D1 != $D2"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
