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

# ---------------------------------------------------------------------------
# AN IMAGE THAT CANNOT REACH THE CLOUD MUST BE REFUSED, NOT WARNED.
#
# On 2026-09-10 both images were rebuilt with no registration URL, no hardware
# profile key and no root pin. The build WARNED and carried on; the warnings
# were in the log and were not read; two SD cards were flashed and both boards
# booted inert. A warning that is routinely scrolled past is not a control.
#
# This asserts the refusal is still a refusal.
# ---------------------------------------------------------------------------
GUARD_OUT="$(KITLUY_DEV_SSH_PUBKEY="${HOME}/.ssh/id_ed25519.pub" KITLUY_DEV_PKI_DIR= \
  timeout 120 bash "${ROOT}/scripts/build-rpi-image.sh" --profile pi-terminal --environment development \
    --skip-doctor --skip-packaging --collect-only 2>&1)"
GUARD_RC=$?
if [[ $GUARD_RC -ne 0 && "$GUARD_OUT" == *"inert on the bench"* ]]; then
  ok "an image with no registration URL, profile key or root pin is REFUSED"
else
  bad "an image with no registration URL, profile key or root pin is REFUSED" \
      "the build exited ${GUARD_RC} and would have produced a card that can never register"
fi

# The escape hatch must exist, or every legitimate unconfigured build is blocked.
if [[ "$GUARD_OUT" == *"--allow-unconfigured-image"* ]]; then
  ok "the refusal names its deliberate escape hatch"
else
  bad "the refusal names its deliberate escape hatch" \
      "an operator with a genuine reason has no documented way through"
fi

# ===========================================================================
# U1 RELEASE DELIVERY
# ===========================================================================
MANIFEST="${ROOT}/runtime-manifest.json"
LAUNCHER="${ROOT}/rpi-image-gen/layer/kitluy-pi-terminal.rootfs-overlay/usr/lib/kitluy/device-shell"
BASE_LAYER="${ROOT}/rpi-image-gen/layer/kitluy-base.yaml"
AGENT_UNIT="${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay/etc/systemd/system/kitluy-update-agent.service"

# --- the scope fence (owner ruling OD-U1-2 = C) -----------------------------
# The manifest names the ONE product a release may replace. Anything else must
# stay image-only until the owner rules at U3, and a fence that is only a
# sentence in a document is not a fence.
UPDATABLE="$(node -e 'const m=require(process.argv[1]);process.stdout.write((m.releaseStore?.updatableProducts??[]).join(","))' "$MANIFEST")"
if [[ "$UPDATABLE" == "device-shell" ]]; then
  ok "exactly ONE product is updatable, and it is the Device Shell"
else
  bad "exactly ONE product is updatable, and it is the Device Shell" "manifest says '${UPDATABLE}'"
fi
FENCE_BREACH=""
for forbidden in terminal-edge firstboot-identity cloud-registration update-agent health-reporter operational-tls hub-agent terminal-client; do
  [[ ",${UPDATABLE}," == *",${forbidden},"* ]] && FENCE_BREACH="$forbidden"
done
if [[ -z "$FENCE_BREACH" ]]; then
  ok "no bootstrap or runtime component is declared updatable"
else
  bad "no bootstrap or runtime component is declared updatable" "'${FENCE_BREACH}' was reclassified without an owner ruling"
fi

# --- the launcher prefers a release and FALLS BACK to the image -------------
if grep -q 'IMAGE_APP=/usr/lib/kitluy/lib/device-shell' "$LAUNCHER" \
   && grep -q 'STORE_APP=/persistent/shared/kitluy/releases/device-shell/current/payload' "$LAUNCHER"; then
  ok "the launcher knows both app roots"
else
  bad "the launcher knows both app roots" "a release could never run, or the image copy could never be the floor"
fi
# `-f package.json`, never `-d payload`: a half-unpacked directory must not be
# selected, and this is the test that keeps the launcher and the update runtime
# applying the SAME predicate.
if grep -q 'if \[ -f "\$STORE_APP/package.json" \]' "$LAUNCHER"; then
  ok "the launcher tests for a COMPLETE payload, not merely a directory"
else
  bad "the launcher tests for a COMPLETE payload, not merely a directory" \
      "a half-unpacked release would be started and the screen would be blank"
fi
if grep -q 'running-source.json' "$LAUNCHER"; then
  ok "the launcher records which app it actually started"
else
  bad "the launcher records which app it actually started" \
      "a board on the image fallback would be indistinguishable from one running the release"
fi

# --- trust and source injection --------------------------------------------
if grep -q 'IGconf_kitluy_release_trust_record' "$BASE_LAYER" \
   && grep -q 'etc/kitluy/trust/release-signing.json' "$BASE_LAYER"; then
  ok "the layer can bake a release trust anchor"
else
  bad "the layer can bake a release trust anchor" "the update agent would refuse every payload for ever"
fi
if grep -q 'PRIVATE KEY' "$BASE_LAYER"; then
  ok "the layer refuses a trust record containing a private key"
else
  bad "the layer refuses a trust record containing a private key" "a signing key could reach an image"
fi
if grep -q 'IGconf_kitluy_release_source' "$BASE_LAYER"; then
  ok "the layer can bake a DEFAULT release source"
else
  bad "the layer can bake a DEFAULT release source" "the source could only ever be set on the device"
fi

# --- the override, which is what makes a reflash unnecessary ----------------
OVERRIDE="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.releaseSource?.runtimeOverride??"")' "$MANIFEST")"
if [[ "$OVERRIDE" == /persistent/* ]]; then
  ok "the release source is overridable from the persistent partition"
else
  bad "the release source is overridable from the persistent partition" \
      "override='${OVERRIDE}' — a workstation changing address would cost a reflash"
fi
# The override must NOT be a declared slot-shared path: those are rsynced FROM
# the image on every boot, which would silently restore the baked value.
if ! grep -rqs "release-source" "${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay/etc/rpi-image-gen/slot-shared.d/"; then
  ok "the override is not a slot-shared path the image would overwrite each boot"
else
  bad "the override is not a slot-shared path the image would overwrite each boot" \
      "persistent-shared-init rsyncs image content into shared paths; an edit would not survive a reboot"
fi

# --- the update agent can actually write the store --------------------------
if grep -q 'ReadWritePaths=.*persistent/shared/kitluy' "$AGENT_UNIT"; then
  ok "the update agent may write the release store"
else
  bad "the update agent may write the release store" "ProtectSystem=strict would make every install fail"
fi

# ...and every writable path it declares on the persistent partition must be
# created by a SEPARATE, UNSANDBOXED unit ordered before it.
#
# THIS GATE HAS BEEN WRONG ONCE, WHICH IS WHY IT TESTS WHAT IT TESTS.
#
# systemd requires each ReadWritePaths= entry to exist when it builds the mount
# namespace. The first version of this gate asserted an
# `ExecStartPre=+/usr/bin/install -d ...` on the agent itself and passed happily
# — and the image it passed could not start the agent on any boot:
#
#   (install): Failed to set up mount namespacing:
#     /run/systemd/unit-root/persistent/shared/kitluy: No such file or directory
#   status=226/NAMESPACE
#
# The `+` prefix drops privilege restrictions; on systemd 252 the namespace is
# STILL built for that command, so the command meant to create the directory is
# refused by the namespace that needs it. A gate that asserts a MECHANISM is
# only ever as right as the author's belief about that mechanism. This one
# asserts the arrangement verified on hardware, and refuses the broken form by
# name so it cannot come back.
STORE_INIT="${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay/etc/systemd/system/kitluy-persistent-store-init.service"
RW_PERSISTENT="$(sed -n 's/^ReadWritePaths=//p' "$AGENT_UNIT" | tr ' ' '\n' | sed 's/^-//' | grep '^/persistent/' || true)"

if grep -qE '^ExecStartPre=\+.*(install -d|mkdir).*/persistent/' "$AGENT_UNIT"; then
  bad "the agent does not try to create its store dir from inside its own sandbox" \
      "ExecStartPre=+ is still namespaced on systemd 252 — this exact form shipped and died at step NAMESPACE"
else
  ok "the agent does not try to create its store dir from inside its own sandbox"
fi

MISSING_MKDIR=""
for RWP in $RW_PERSISTENT; do
  grep -qE "^ExecStart=[^ ]*(install -d|mkdir).* ${RWP}( |\$)" "$STORE_INIT" 2>/dev/null \
    || MISSING_MKDIR="${MISSING_MKDIR} ${RWP}"
done
if [[ -n "$RW_PERSISTENT" && -z "$MISSING_MKDIR" ]]; then
  ok "a separate unit creates every persistent path the agent declares writable"
else
  bad "a separate unit creates every persistent path the agent declares writable" \
      "not created:${MISSING_MKDIR:- (none declared)} — the agent dies at step NAMESPACE before main()"
fi

# The creator may be hardened — but every path its own sandbox NAMES must
# already exist, or it dies exactly as the agent did. `/persistent/shared` is on
# the persistent partition and RequiresMountsFor= guarantees it; the subdirectory
# it creates must NOT appear in its own ReadWritePaths=.
INIT_RW="$(sed -n 's/^ReadWritePaths=//p' "$STORE_INIT" 2>/dev/null | tr ' ' '\n' | sed 's/^-//' | grep '^/persistent/' || true)"
SELF_REF=""
for RWP in $RW_PERSISTENT; do
  for IRW in $INIT_RW; do
    [[ "$IRW" == "$RWP" ]] && SELF_REF="${SELF_REF} ${IRW}"
  done
done
if [[ -z "$SELF_REF" ]]; then
  ok "the creating unit never names the directory it is there to create"
else
  bad "the creating unit never names the directory it is there to create" \
      "self-referential:${SELF_REF} — its own namespace cannot be built, same failure as the agent"
fi

if grep -qE '^(Requires|After)=kitluy-persistent-store-init\.service' "$AGENT_UNIT" \
   && grep -q '^Before=kitluy-update-agent.service' "$STORE_INIT" 2>/dev/null; then
  ok "the agent requires and follows the unit that creates its store"
else
  bad "the agent requires and follows the unit that creates its store" \
      "without Requires= + After= the agent can start before the directory exists"
fi

if grep -q '^RequiresMountsFor=/persistent' "$STORE_INIT" 2>/dev/null; then
  ok "the creating unit waits for the persistent partition to be mounted"
else
  bad "the creating unit waits for the persistent partition to be mounted" \
      "the store could be created on the read-only root, or before the mount shadows it"
fi

# And the store must NOT be under /var, which is per-slot.
STORE_ROOT="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.releaseStore?.root??"")' "$MANIFEST")"
if [[ "$STORE_ROOT" == /persistent/* ]]; then
  ok "the release store is on the persistent partition, not per-slot /var"
else
  bad "the release store is on the persistent partition, not per-slot /var" \
      "root='${STORE_ROOT}' — every installed application would vanish on the first A/B update"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
