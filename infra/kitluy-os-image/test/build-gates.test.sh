#!/usr/bin/env bash
# KitLuy Pi Terminal image — build-system tests.
#
# These test the GATES and the COMPOSITION, which is what can honestly be
# tested without Raspberry Pi hardware. Nothing here claims hardware
# certification. This tree builds the Pi Terminal image only; the Store Hub
# image has its own tree and its own copy of this suite.
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

printf '\nKitLuy Pi Terminal image — build gate tests\n\n'

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

ROOTFS="${TMP}/term/rootfs"
UNITS="${ROOTFS}/etc/systemd/system"

# --- Bootstrap composition (KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001) ------
# The image carries the bootstrap runtime and nothing more.
for unit in kitluy-firstboot.service kitluy-cloud-registration.service \
            kitluy-health-reporter.service kitluy-update-agent.service \
            kitluy-ssh-hostkeys.service kitluy-bootstrap-screen.service; do
  if [[ -f "${UNITS}/${unit}" ]]; then
    ok "term: bootstrap unit ${unit} present"
  else
    bad "term: bootstrap unit ${unit} present" "missing"
  fi
done

# --- Factory Enrollment is the ONE identity path (KLD-2026-09-03-FACTORY-ENROLLMENT-001)
# The flash-time ticket agent enrolled a device straight to `enrolled` with no
# Admin decision, and its identity included the SD card. Unit, enablement and
# executable are three separate facts; all three must be gone.
if [[ -f "${UNITS}/kitluy-enrollment-agent.service" ]]; then
  bad "term: ticket enrollment agent unit stays out" "a device could self-enroll past Admin approval"
else
  ok "term: ticket enrollment agent unit stays out"
fi
if [[ -e "${UNITS}/multi-user.target.wants/kitluy-enrollment-agent.service" ]]; then
  bad "term: ticket enrollment agent is not enabled" "wants symlink present"
else
  ok "term: ticket enrollment agent is not enabled"
fi
if [[ -e "${ROOTFS}/usr/lib/kitluy/enrollment-agent" ]]; then
  bad "term: ticket enrollment agent executable stays out" "shim present"
else
  ok "term: ticket enrollment agent executable stays out"
fi
if [[ -e "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/bin/enrollment-bootstrap.js" ]]; then
  bad "term: ticket enrollment module is not packaged" "bin/enrollment-bootstrap.js present"
else
  ok "term: ticket enrollment module is not packaged"
fi

# Cloud registration is present AND enabled AND backed by a packaged module.
if [[ -e "${UNITS}/multi-user.target.wants/kitluy-cloud-registration.service" ]]; then
  ok "term: cloud registration is enabled"
else
  bad "term: cloud registration is enabled" "no wants symlink"
fi
if [[ -x "${ROOTFS}/usr/lib/kitluy/cloud-registration" \
   && -f "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/bin/cloud-registration.js" ]]; then
  ok "term: cloud registration shim and module are packaged"
else
  bad "term: cloud registration shim and module are packaged" "shim or bin/cloud-registration.js missing"
fi

if [[ -f "${ROOTFS}/etc/ssh/sshd_config.d/60-kitluy-hardening.conf" ]]; then
  ok "term: ssh hardening present"
else
  bad "term: ssh hardening present" "missing"
fi

# --- Ordering: identity before registration, registration before the screen --
# Registration has nothing to prove possession of until identity exists, and
# the screen's first paint should already reflect a registration pass.
if grep -q 'After=kitluy-firstboot.service' "${UNITS}/kitluy-cloud-registration.service"; then
  ok "firstboot identity is ordered before cloud registration"
else
  bad "firstboot identity is ordered before cloud registration" "ordering absent"
fi
if grep -qE '^After=.*kitluy-cloud-registration\.service' "${UNITS}/kitluy-bootstrap-screen.service"; then
  ok "the status screen is ordered after cloud registration"
else
  bad "the status screen is ordered after cloud registration" "ordering absent"
fi
if grep -qE '^Requires=.*kitluy-cloud-registration' "${UNITS}/kitluy-bootstrap-screen.service"; then
  bad "the status screen does not Requires= registration" "the screen must come up with the network down"
else
  ok "the status screen does not Requires= registration"
fi

# --- No Store authority of any kind ------------------------------------------
# Factory Enrollment grants recognition and provisioning eligibility only. The
# terminal image must carry nothing that could act as Store authority.
for forbidden in etc/systemd/system/kitluy-hub-agent.service \
                 usr/lib/kitluy/hub-agent \
                 usr/lib/kitluy/hub-migrations \
                 usr/lib/kitluy/hub-storage-provision \
                 usr/lib/kitluy/hub-database-provision \
                 etc/kitluy/hub.env \
                 etc/avahi/services/kitluy-edge.service; do
  if [[ -e "${ROOTFS}/${forbidden}" ]]; then
    bad "term: no Store authority at /${forbidden}" "a terminal image carries Hub material"
  else
    ok "term: no Store authority at /${forbidden}"
  fi
done

# --- The business application is a governed release: defined, NOT enabled ----
if [[ -f "${UNITS}/kitluy-terminal-client.service" ]]; then
  ok "term: governed POS client unit is defined"
else
  bad "term: governed POS client unit is defined" "missing"
fi
if [[ -e "${UNITS}/multi-user.target.wants/kitluy-terminal-client.service" \
   || -e "${UNITS}/graphical.target.wants/kitluy-terminal-client.service" ]]; then
  bad "term: governed POS client unit is NOT enabled" "the image would try to run an application it does not carry"
else
  ok "term: governed POS client unit is NOT enabled"
fi

# --- Zero-secret image ------------------------------------------------------
if grep -rIqE 'service_role|BEGIN [A-Z ]*PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY=.+' "${ROOTFS}" 2>/dev/null; then
  bad "staged root is zero-secret" "credential material found"
else
  ok "staged root is zero-secret"
fi

# --- No assignment truth is baked into the image ----------------------------
# A terminal image must not carry a terminal profile, Tenant, Store, Location
# or Hub endpoint. Those are delivered after cloud-authorised assignment.
if grep -rIqE 'KITLUY_TERMINAL_PROFILE=|KITLUY_TENANT_ID=|KITLUY_DIGITAL_STORE_ID=|KITLUY_LOCATION_ID=|KITLUY_HUB_ENDPOINT=' \
     "${ROOTFS}" 2>/dev/null; then
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
