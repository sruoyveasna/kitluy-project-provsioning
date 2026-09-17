#!/usr/bin/env bash
# What the FLASHABLE Pi Terminal image actually contains, checked against
# runtime-manifest.json.
#
# WHY THIS SUITE IS DIFFERENT FROM THE OTHERS
# -----------------------------------------------------------------------------
# `build-gates.test.sh` and `systemd-runtime.test.sh` assert against the STAGED
# tree that `build-image.sh --stage-only` produces — a `cp -a` of the overlay.
# That tree is useful, but it is not what gets flashed, and the gap between them
# is exactly where D-05 lived on the Hub: the agent's source, its unit and its
# advert all existed, every source-level check passed, and no card ever carried
# the binary.
#
# So this suite inspects the ROOTFS THE BUILDER PRODUCED. A build log saying
# "packaged cloud registration" is not evidence; a file in the image is.
#
#   bash infra/edge/raspberry-pi/pi-terminal-image/test/image-contents.test.sh [rootfs-path]
#
# With no argument it finds the most recent chroot filesystem under build/work.
# It SKIPS rather than fails when no image has been built — a developer who has
# not built one has not broken anything — but a build pipeline should treat a
# skipped run as no evidence at all (KLD-EVIDENCE-001).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT}/runtime-manifest.json"

PASS=0
FAIL=0
SKIP=0
ok()   { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }
skip() { printf '  SKIP %s\n     %s\n' "$1" "${2:-}"; SKIP=$((SKIP + 1)); }

[[ -f "$MANIFEST" ]] || { printf 'missing runtime manifest: %s\n' "$MANIFEST" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf 'node is required to read the manifest\n' >&2; exit 2; }

# ---------------------------------------------------------------------------
# Locate the built rootfs
# ---------------------------------------------------------------------------
ROOTFS="${1:-}"
if [[ -z "$ROOTFS" ]]; then
  ROOTFS="$(find "${ROOT}/build" -maxdepth 3 -type d -name filesystem -path '*chroot*' \
              -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
fi

if [[ -z "$ROOTFS" || ! -d "$ROOTFS" ]]; then
  printf '\n  No built rootfs found. Build one first:\n'
  printf '    bash infra/edge/raspberry-pi/pi-terminal-image/scripts/build-rpi-image.sh --profile pi-terminal\n'
  printf '  or pass a path:  bash %s <rootfs>\n\n' "${BASH_SOURCE[0]}"
  printf '  0 passed, 0 failed, 1 skipped (no image to inspect)\n\n'
  exit 0
fi

printf '\n  inspecting %s\n\n' "$ROOTFS"

# A chroot left behind by a build that died inside mmdebstrap (a mirror that
# would not answer, 2026-09-03) has apt lists and no KitLuy layer output. That
# is not an image, and inspecting it would report the layer's absence as a
# dozen failures against an artifact nobody produced. SKIP, loudly: the next
# build overwrites the directory, and a skipped run is no evidence either way.
if [[ ! -f "${ROOTFS}/etc/kitluy/image.env" ]]; then
  printf '  The rootfs at %s has no /etc/kitluy/image.env — an incomplete or\n' "$ROOTFS"
  printf '  foreign chroot, not a built KitLuy image. Rebuild, or pass the right path.\n\n'
  printf '  0 passed, 0 failed, 1 skipped (incomplete rootfs)\n\n'
  exit 0
fi

# The rootfs must be a TERMINAL rootfs. This tree's build directory once held
# Hub artifacts too, and inspecting the wrong device's filesystem would pass
# half the checks for the wrong reasons.
IMAGE_CLASS="$(sed -n 's/^KITLUY_DEVICE_CLASS=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"
if [[ "$IMAGE_CLASS" == "terminal" ]]; then
  ok "the rootfs declares device class 'terminal'"
else
  bad "the rootfs declares device class 'terminal'" "KITLUY_DEVICE_CLASS='${IMAGE_CLASS}' — is this a terminal image?"
fi

# ---------------------------------------------------------------------------
# The manifest, flattened for shell
# ---------------------------------------------------------------------------
COMPONENTS="$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const c of m.components || []) {
    if (!(c.profiles || []).includes("pi-terminal")) continue;
    process.stdout.write([
      c.id, c.executable || "", c.unit || "",
      c.enabled ? "yes" : "no",
      (c.environmentFiles || []).join(","),
      (c.source && c.source.kind) || "",
    ].join("|") + "\n");
  }
' "$MANIFEST")"
# The separator is "|", NOT a tab. Tab is IFS whitespace, and `read` collapses
# runs of IFS whitespace, so a component with no executable or no
# environment file shifted every later field left: on the first complete
# terminal rootfs (2026-09-03) the test reported "terminal-client: no is in
# the image" and "ssh-hostkeys: package exists" — the unit name read as the
# executable, the enabled flag as the unit, the source kind as an environment
# file. A non-whitespace separator keeps empty fields empty.

[[ -n "$COMPONENTS" ]] || { printf 'the manifest declares no pi-terminal components\n' >&2; exit 2; }

# ---------------------------------------------------------------------------
# 0. IS THIS ROOTFS OLDER THAN THE SOURCE IT IS BEING JUDGED AGAINST?
# ---------------------------------------------------------------------------
# A stale rootfs fails honestly — it really does not contain what the manifest
# now declares — but "absent from the built rootfs" reads like a packaging defect
# when the actual answer is "nobody has rebuilt since this was added". Saying so
# once, at the top, is the difference between a five-minute rebuild and an
# afternoon spent looking for a bug that is not there.
# COMPARED AGAINST A FILE THE BUILD WROTE, NOT THE ROOTFS DIRECTORY.
#
# The directory's own mtime comes from the base extraction and can be a month
# older than the build that filled it — measured here as 2026-08-10 on a rootfs
# built 2026-09-07 — so comparing against it reports EVERY rootfs as stale, and a
# staleness warning that is always on is one nobody reads. `image.env` is written
# by the kitluy-base layer during the build, so its mtime is the build.
BUILD_STAMP="${ROOTFS}/etc/kitluy/image.env"
NEWEST_SOURCE=""
[[ -f "$BUILD_STAMP" ]] && NEWEST_SOURCE="$(find "${ROOT}/runtime-manifest.json" "${ROOT}/rpi-image-gen" \
                   -type f -newer "$BUILD_STAMP" -print -quit 2>/dev/null || true)"
if [[ -n "$NEWEST_SOURCE" ]]; then
  printf '\n  NOTE: this rootfs is OLDER than the image source.\n'
  printf '        e.g. %s\n' "${NEWEST_SOURCE#"${ROOT}/"}"
  printf '        Failures below may simply mean the image has not been rebuilt:\n'
  printf '          bash %s/scripts/build-rpi-image.sh --profile pi-terminal ...\n\n' "${ROOT##*/}"
fi

# ---------------------------------------------------------------------------
# 1. Every declared component is actually in the image
# ---------------------------------------------------------------------------
while IFS='|' read -r id executable unit enabled envfiles kind; do
  [[ -n "$id" ]] || continue

  if [[ -n "$executable" ]]; then
    target="${ROOTFS}${executable}"
    if [[ ! -e "$target" ]]; then
      bad "${id}: ${executable} is in the image" "declared in runtime-manifest.json, absent from the built rootfs"
    elif [[ ! -x "$target" ]]; then
      bad "${id}: ${executable} is executable" "present but mode $(stat -c '%a' "$target")"
    else
      ok "${id}: ${executable} is in the image and executable"
    fi
  elif [[ "$kind" == "governed-release" ]]; then
    ok "${id}: a governed release declares no executable in the image"
  fi

  if [[ -n "$unit" ]]; then
    unit_path="${ROOTFS}/etc/systemd/system/${unit}"
    if [[ -f "$unit_path" ]]; then
      ok "${id}: ${unit} is in the image"
    else
      bad "${id}: ${unit} is in the image" "no unit file at /etc/systemd/system/${unit}"
    fi

    wants="${ROOTFS}/etc/systemd/system/multi-user.target.wants/${unit}"
    if [[ "$enabled" == "yes" ]]; then
      if [[ -L "$wants" || -f "$wants" ]]; then
        ok "${id}: ${unit} is enabled"
      else
        bad "${id}: ${unit} is enabled" "declared enabled, but no multi-user.target.wants symlink"
      fi
    elif [[ -L "$wants" || -f "$wants" ]]; then
      bad "${id}: ${unit} stays disabled" "the manifest declares it not enabled, but it is wanted by multi-user.target"
    else
      ok "${id}: ${unit} stays disabled"
    fi
  fi

  if [[ -n "$envfiles" ]]; then
    IFS=',' read -ra files <<< "$envfiles"
    for f in "${files[@]}"; do
      if [[ -f "${ROOTFS}${f}" ]]; then
        ok "${id}: ${f} exists"
      else
        bad "${id}: ${f} exists" "the unit names it as EnvironmentFile= and it is not in the image"
      fi
    done
  fi
done <<< "$COMPONENTS"

# ---------------------------------------------------------------------------
# 2. The bootstrap closure is real
# ---------------------------------------------------------------------------
LIB="${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent"
for m in bin/firstboot-identity bin/cloud-registration bin/health-reporter bin/update-bootstrap bin/bootstrap-ui \
         registration-state adapters/http-registration-client; do
  if [[ -s "${LIB}/${m}.js" ]]; then
    ok "closure: ${m}.js is in the image"
  else
    bad "closure: ${m}.js is in the image" "absent from /usr/lib/kitluy/lib/firstboot-agent"
  fi
done
if [[ -f "${LIB}/package.json" ]] && grep -q '"type": "module"' "${LIB}/package.json"; then
  ok "closure: the ESM module marker is in the image"
else
  bad "closure: the ESM module marker is in the image" "every entrypoint would die at its first import"
fi
if find "${ROOTFS}/usr/lib/kitluy" -maxdepth 3 -type d -name node_modules -print -quit 2>/dev/null | grep -q .; then
  bad "the image ships no node_modules" "a dependency tree reached /usr/lib/kitluy"
else
  ok "the image ships no node_modules"
fi

# ---------------------------------------------------------------------------
# 3. Retired paths are gone (KLD-2026-09-03-FACTORY-ENROLLMENT-001)
# ---------------------------------------------------------------------------
while IFS=$'\t' read -r r_unit r_exec r_modules; do
  [[ -n "$r_unit$r_exec" ]] || continue
  if [[ -n "$r_unit" ]]; then
    if [[ -f "${ROOTFS}/etc/systemd/system/${r_unit}" \
       || -L "${ROOTFS}/etc/systemd/system/multi-user.target.wants/${r_unit}" ]]; then
      bad "retired: ${r_unit} is not in the image" "a device could self-enroll past Admin approval"
    else
      ok "retired: ${r_unit} is not in the image"
    fi
  fi
  if [[ -n "$r_exec" ]]; then
    if [[ -e "${ROOTFS}${r_exec}" ]]; then
      bad "retired: ${r_exec} is not in the image" "present"
    else
      ok "retired: ${r_exec} is not in the image"
    fi
  fi
  IFS=',' read -ra mods <<< "$r_modules"
  for mod in "${mods[@]}"; do
    [[ -n "$mod" ]] || continue
    if [[ -e "${LIB}/${mod}.js" ]]; then
      bad "retired: ${mod}.js is not packaged" "present in the closure"
    else
      ok "retired: ${mod}.js is not packaged"
    fi
  done
done < <(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const r of m.retired || []) {
    process.stdout.write([r.unit || "", r.executable || "", (r.modules || []).join(",")].join("\t") + "\n");
  }' "$MANIFEST")

# ---------------------------------------------------------------------------
# 4. No Store authority of any kind
# ---------------------------------------------------------------------------
while read -r p; do
  [[ -n "$p" ]] || continue
  if [[ -e "${ROOTFS}${p}" ]]; then
    bad "no Store authority at ${p}" "a terminal image carries Hub material"
  else
    ok "no Store authority at ${p}"
  fi
done < <(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const p of m.storeAuthorityMustBeAbsent || []) process.stdout.write(p + "\n");' "$MANIFEST")
if [[ -d "${ROOTFS}/usr/lib/postgresql" ]]; then
  bad "no local database in a terminal image" "/usr/lib/postgresql present"
else
  ok "no local database in a terminal image"
fi

# ---------------------------------------------------------------------------
# 5. The image STATES its environment
# ---------------------------------------------------------------------------
EXPECT_ENV="${KITLUY_EXPECT_ENVIRONMENT:-development}"
IMAGE_ENV="$(sed -n 's/^KITLUY_ENVIRONMENT=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"

if [[ -z "$IMAGE_ENV" ]]; then
  bad "the image states an environment" \
      "KITLUY_ENVIRONMENT is empty — the image should never have shipped without a stated posture"
elif [[ "$IMAGE_ENV" == "$EXPECT_ENV" ]]; then
  ok "the image states environment '${IMAGE_ENV}'"
else
  bad "the image states environment '${EXPECT_ENV}'" "it states '${IMAGE_ENV}'"
fi

case "$IMAGE_ENV" in
  local|development|staging|pilot|production|disaster_recovery)
    ok "the stated environment is a known KitLuy environment" ;;
  *)
    bad "the stated environment is a known KitLuy environment" "'${IMAGE_ENV}' is not one" ;;
esac

if [[ "$IMAGE_ENV" == "pilot" || "$IMAGE_ENV" == "production" ]]; then
  bad "an unsigned artifact does not claim a production posture" \
      "the image says '${IMAGE_ENV}' while being UNSIGNED and NOT release-eligible (BLK-005)"
else
  ok "an unsigned artifact does not claim a production posture"
fi

# ---------------------------------------------------------------------------
# 6. Factory Enrollment can actually begin: the registration route and the
#    hardware profile key. A warning, not a failure, unless the build claims
#    to be a registering image (KITLUY_EXPECT_REGISTRATION=1).
# ---------------------------------------------------------------------------
REG_URL="$(sed -n 's/^KITLUY_REGISTRATION_URL=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"
REG_KEY="$(sed -n 's/^KITLUY_HARDWARE_PROFILE_KEY=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"
if [[ -n "$REG_URL" && -n "$REG_KEY" ]]; then
  ok "the image carries a registration route and a hardware profile key"
elif [[ "${KITLUY_EXPECT_REGISTRATION:-0}" == "1" ]]; then
  bad "the image carries a registration route and a hardware profile key" \
      "url='${REG_URL:-<empty>}' key='${REG_KEY:-<empty>}' — this image cannot register"
else
  skip "the image carries a registration route and a hardware profile key" \
       "empty; the device will report NOT_REGISTERED until rebuilt with --registration-url and --hardware-profile-key"
fi

# ---------------------------------------------------------------------------
# 7. Nothing per-device was baked in
# ---------------------------------------------------------------------------
for forbidden in \
  /var/lib/kitluy/identity/device-identity.key.pem \
  /var/lib/kitluy/identity/identity.json \
  /var/lib/kitluy/bootstrap-state.json \
  /var/lib/kitluy/registration-state.json \
  /var/lib/kitluy/installation.json \
  /var/lib/kitluy/pairing-state.json \
  /var/lib/kitluy/terminal/assignment.json \
  /var/lib/kitluy/terminal/hub-endpoint.json \
  /var/lib/kitluy/terminal/configuration.json
do
  if find "$ROOTFS" -path "*${forbidden}" -print -quit 2>/dev/null | grep -q .; then
    bad "no per-device state at ${forbidden}" "every board flashed from this image would share it"
  else
    ok "no per-device state at ${forbidden}"
  fi
done

if [[ -s "${ROOTFS}/etc/machine-id" ]]; then
  bad "/etc/machine-id is empty in the image" "a populated machine-id makes every board the same host"
else
  ok "/etc/machine-id is empty in the image"
fi

if find "${ROOTFS}/etc/ssh" -maxdepth 1 -name 'ssh_host_*' -print -quit 2>/dev/null | grep -q .; then
  bad "no SSH host keys are baked in" "every board would present the same host key"
else
  ok "no SSH host keys are baked in"
fi

if [[ -e "${ROOTFS}/etc/ssl/private/ssl-cert-snakeoil.key" ]]; then
  bad "no shared snakeoil TLS key is baked in" "every board would share one private key"
else
  ok "no shared snakeoil TLS key is baked in"
fi

# ---------------------------------------------------------------------------
# 8. tty1 belongs to the product; tty2 to maintenance
# ---------------------------------------------------------------------------
if [[ -e "${ROOTFS}/etc/systemd/system/getty.target.wants/getty@tty1.service" ]]; then
  bad "getty is not enabled on tty1" "an operator would meet login: as the product"
else
  ok "getty is not enabled on tty1"
fi
if [[ -e "${ROOTFS}/etc/systemd/system/getty.target.wants/getty@tty2.service" ]]; then
  ok "an authenticated maintenance console is enabled on tty2"
else
  bad "an authenticated maintenance console is enabled on tty2" "the device would be unrecoverable from the console"
fi

# ---------------------------------------------------------------------------
# 9. Appliance clock and Wi-Fi seed
# ---------------------------------------------------------------------------
TZ_LINK="$(readlink "${ROOTFS}/etc/localtime" 2>/dev/null)"
if [[ "$TZ_LINK" == *"Asia/Phnom_Penh" ]]; then
  ok "the appliance clock is Asia/Phnom_Penh"
else
  bad "the appliance clock is Asia/Phnom_Penh" "/etc/localtime -> '${TZ_LINK}'"
fi
WPA="${ROOTFS}/etc/wpa_supplicant/wpa_supplicant-wlan0.conf"
if [[ -f "$WPA" ]] && ! grep -qE '^\s*psk=' "$WPA"; then
  ok "the seeded Wi-Fi configuration carries no secret"
else
  bad "the seeded Wi-Fi configuration carries no secret" "missing, or carries a PSK"
fi

# ---------------------------------------------------------------------------
# THE DEVICE SHELL, IN THE IMAGE THAT WAS ACTUALLY BUILT
# ---------------------------------------------------------------------------
# The overlay suites prove the SOURCE is right. None of them can see the Electron
# runtime, because it is fetched at build time and deliberately never committed —
# so this is the only place the image's user interface is checked at all. D-05
# was exactly this gap in a different component: unit, source and advert all
# present, and no card ever carried the binary.
SHELL_APP="${ROOTFS}/usr/lib/kitluy/lib/device-shell"

if [[ -f "${SHELL_APP}/package.json" ]]; then
  ok "device shell: the app is in the image"
  APP_MAIN="$(node -e 'process.stdout.write(require(process.argv[1]).main||"")' "${SHELL_APP}/package.json" 2>/dev/null)"
  [[ -n "$APP_MAIN" && -f "${SHELL_APP}/${APP_MAIN}" ]] \
    && ok "device shell: its declared main is in the image (${APP_MAIN})" \
    || bad "device shell: its declared main is in the image" "package.json names '${APP_MAIN}', which is absent — Electron exits at startup"
  [[ -f "${SHELL_APP}/dist-electron/electron/preload.cjs" ]] \
    && ok "device shell: the preload bridge is in the image" \
    || bad "device shell: the preload bridge is in the image" "the keypad would submit nowhere"
  [[ -f "${SHELL_APP}/dist/index.html" ]] \
    && ok "device shell: the renderer bundle is in the image" \
    || bad "device shell: the renderer bundle is in the image" "the window would load nothing"
  find "${SHELL_APP}" -name '*.map' 2>/dev/null | grep -q . \
    && bad "device shell: no source maps reached the card" "the original sources ship with the image" \
    || ok "device shell: no source maps reached the card"
else
  bad "device shell: the app is in the image" "no ${SHELL_APP#"$ROOTFS"}/package.json in the built rootfs"
fi

# The compositor the launcher execs. Absent, the unit start-loops on exit 127.
[[ -x "${ROOTFS}/usr/bin/cage" ]] \
  && ok "device shell: the cage kiosk compositor is installed" \
  || bad "device shell: the cage kiosk compositor is installed" "the launcher execs /usr/bin/cage"

# THE RUNTIME, AND THE ARCHITECTURE IT WAS BUILT FOR.
# An x86 Electron unpacks perfectly on the build host and fails only on the Pi.
ELECTRON_BIN="${ROOTFS}/usr/lib/kitluy/electron/electron"
if [[ -x "$ELECTRON_BIN" ]]; then
  ok "device shell: the pinned Electron runtime is in the image"
  if command -v file >/dev/null 2>&1; then
    case "$(file -b "$ELECTRON_BIN")" in
      *aarch64*) ok "device shell: the Electron runtime is aarch64" ;;
      *) bad "device shell: the Electron runtime is aarch64" "$(file -b "$ELECTRON_BIN" | cut -c1-60)" ;;
    esac
  fi
  # Chromium's sandbox helper must be setuid root. Without it the renderer runs
  # unsandboxed, or Electron refuses to start and says so only in the journal.
  SANDBOX="${ROOTFS}/usr/lib/kitluy/electron/chrome-sandbox"
  if [[ -f "$SANDBOX" ]]; then
    [[ "$(stat -c '%a' "$SANDBOX")" == "4755" ]] \
      && ok "device shell: chrome-sandbox is setuid root, so the renderer stays sandboxed" \
      || bad "device shell: chrome-sandbox is setuid root" "mode $(stat -c '%a' "$SANDBOX")"
  fi
else
  bad "device shell: the pinned Electron runtime is in the image" \
      "no executable at /usr/lib/kitluy/electron/electron — the screen would never start"
fi

# THE KHMER FONT. The shell is Khmer-default; without a Khmer face the first
# screen an installer sees is a row of empty boxes.
if find "${ROOTFS}/usr/share/fonts" -iname '*khmer*' -o -iname '*Khmer*' 2>/dev/null | grep -q .; then
  ok "device shell: a Khmer font reached the image, so the default locale renders"
else
  bad "device shell: a Khmer font reached the image" \
      "the Khmer-default UI would render as empty boxes on a real terminal"
fi


# ---------------------------------------------------------------------------
# The operational certificate path
# ---------------------------------------------------------------------------
# A Terminal that pairs is stuck at "Assigned to a Store, awaiting activation"
# for ever without this: activation is certificate-backed for BOTH device
# classes, and nothing else on the device asks for a certificate. The Store Hub
# image has carried it since 2026-09-08; the Terminal did not, because no
# Terminal had ever asked.
for f in operational-tls; do
  if [[ -x "${ROOTFS}/usr/lib/kitluy/${f}" ]]; then
    ok "the ${f} launcher is present and executable"
  else
    bad "the ${f} launcher is present and executable" "missing or not executable"
  fi
done

for m in bin/operational-tls.js paired-identity.js operational-key.js \
         operational-tls-client.js adapters/http-operational-certificate-client.js; do
  if [[ -f "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/${m}" ]]; then
    ok "the certificate closure carries ${m}"
  else
    bad "the certificate closure carries ${m}" "absent — the agent would fail to import"
  fi
done

# `paired-identity` specifically: the Device Shell is sandboxed to
# /var/lib/kitluy/terminal and CANNOT write the canonical pairing state, so the
# agent reads the Terminal's seat instead. Without this module a paired Terminal
# reports "waiting: not paired yet" for ever.
if grep -q "terminal/assignment.json" \
     "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/paired-identity.js" 2>/dev/null; then
  ok "the agent reads the Terminal's seat, not only the Hub's pairing state"
else
  bad "the agent reads the Terminal's seat, not only the Hub's pairing state" "path absent"
fi

# The pin is INJECTED at build time and must never be committed.
if grep -q "IGconf_kitluy_development_root_sha256" \
     "${ROOT}/rpi-image-gen/layer/kitluy-base.yaml"; then
  ok "the layer writes the development root pin when the builder supplies one"
else
  bad "the layer writes the development root pin when the builder supplies one" "hook missing"
fi

# Against the SOURCE overlay, not the built image: the built one SHOULD carry a
# pin (the builder injects it). What must never happen is the pin being
# committed, which is what `assert-no-dev-pki.mjs` guards from the other side.
if [[ ! -e "${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay/etc/kitluy/development-root.sha256" ]]; then
  ok "no development root pin is committed to the repository"
else
  bad "no development root pin is committed to the repository" "CA material in git"
fi

# ===========================================================================
# U1 RELEASE DELIVERY, IN THE BUILT ROOTFS
# ===========================================================================
# Everything above this point is checked in the SOURCE tree. These are checked
# in the rootfs the builder actually produced, which is the only place a
# packaging mistake shows up.

# The image copy of the Device Shell is the FLOOR and must always be there.
if [[ -f "${ROOTFS}/usr/lib/kitluy/lib/device-shell/package.json" ]]; then
  ok "the image carries its own Device Shell (the fallback floor)"
else
  bad "the image carries its own Device Shell (the fallback floor)" \
      "a failed release would leave the board with no screen at all"
fi

# The launcher, as built.
if grep -qs 'STORE_APP=/persistent/shared/kitluy/releases' "${ROOTFS}/usr/lib/kitluy/device-shell"; then
  ok "the built launcher prefers an installed release"
else
  bad "the built launcher prefers an installed release" "a release would be installed and never run"
fi
if grep -qs 'running-source.json' "${ROOTFS}/usr/lib/kitluy/device-shell"; then
  ok "the built launcher records what it started"
else
  bad "the built launcher records what it started" "the image fallback would be invisible"
fi

# The POS launcher, as built: the image-owned half of the governed POS release.
if [[ -x "${ROOTFS}/usr/lib/kitluy/terminal-client" ]] \
   && grep -qs '^STORE=/persistent/shared/kitluy/releases/kitluy-terminal$' "${ROOTFS}/usr/lib/kitluy/terminal-client"; then
  ok "the built POS launcher reads the kitluy-terminal release store"
else
  bad "the built POS launcher reads the kitluy-terminal release store" "no POS release could ever run"
fi
if [[ ! -e "${ROOTFS}/usr/lib/kitluy/lib/terminal-client" ]] \
   && ! find "${ROOTFS}/usr/lib/kitluy" -maxdepth 3 -path '*kitluy-pos-desktop*' -print -quit 2>/dev/null | grep -q .; then
  ok "the built image carries no POS application"
else
  bad "the built image carries no POS application" "a business application is in the golden image"
fi
if grep -qs '^OnFailure=kitluy-device-shell.service$' "${ROOTFS}/etc/systemd/system/kitluy-terminal-client.service"; then
  ok "the built POS unit hands the display back when it cannot run"
else
  bad "the built POS unit hands the display back when it cannot run" "stale unit definition in the image"
fi

# The release runtime modules must be in the shipped closure.
REL_MISSING=""
for m in durable-write release-store release-verify release-trust release-archive \
         release-artifact release-assignment release-install release-status release-runtime; do
  [[ -f "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/${m}.js" ]] || REL_MISSING="${REL_MISSING} ${m}"
done
[[ -f "${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/adapters/http-release-source.js" ]] \
  || REL_MISSING="${REL_MISSING} adapters/http-release-source"
if [[ -z "$REL_MISSING" ]]; then
  ok "the release runtime is in the shipped device closure"
else
  bad "the release runtime is in the shipped device closure" "missing:${REL_MISSING}"
fi

# THE IGNITION. The closure carrying the installer proves nothing if the shipped
# entrypoint never calls it — which is exactly the defect found before the first
# flash: a correct image that reported `ready` for ever and installed nothing.
ENTRY="${ROOTFS}/usr/lib/kitluy/lib/firstboot-agent/bin/update-bootstrap.js"
if grep -qs "runInstallPass" "$ENTRY" && grep -qs "composeInstallDependencies" "$ENTRY"; then
  ok "the shipped update agent reaches the install pass"
else
  bad "the shipped update agent reaches the install pass" \
      "the image would boot, register, pair, report ready — and never install anything"
fi

# The trust registry directory exists, and carries PUBLIC material only.
if [[ -d "${ROOTFS}/etc/kitluy/trust" ]]; then
  ok "the trust registry directory exists"
else
  bad "the trust registry directory exists" "the update agent would report no_trust_anchor for ever"
fi
if ! grep -rqs "PRIVATE KEY" "${ROOTFS}/etc/kitluy/trust" 2>/dev/null; then
  ok "NO private key material anywhere in the trust registry"
else
  bad "NO private key material anywhere in the trust registry" "a signing key reached the image"
fi

# The baked release source exists as a file (even if empty).
if [[ -f "${ROOTFS}/etc/kitluy/release.env" ]]; then
  ok "the baked release source file exists"
else
  bad "the baked release source file exists" "the agent's EnvironmentFile-style read would find nothing"
fi

# THE ENROLLMENT ORIGIN MUST NOT BE EMPTY ON A TERMINAL IMAGE.
#
# `KITLUY_ENROLLMENT_BASE_URL=` with no value is how a terminal ends up unable
# to obtain its operational certificate. operational-tls then logs
#   waiting: no KITLUY_ENROLLMENT_BASE_URL in /etc/kitluy/image.env
# every 30s for ever, terminal-edge stays NOT_ACTIVATED, and the board never
# reaches SERVING — while registering, pairing and drawing its screen normally.
# The builder refuses this now; this gate is the second wall, because the
# builder has a documented escape hatch and the image is what gets flashed.
ENROLL="$(sed -n 's/^KITLUY_ENROLLMENT_BASE_URL=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"
if [[ -n "$ENROLL" ]]; then
  ok "the image states a fleet enrollment origin" "$ENROLL"
else
  bad "the image states a fleet enrollment origin" \
      "empty — the terminal can never obtain an operational certificate, and the rootfs is read-only"
fi

# The image must ship NOTHING in the release store: it is created at runtime,
# and anything shipped there would be restored over an operator's edit.
if [[ ! -e "${ROOTFS}/persistent/shared/kitluy/releases" ]]; then
  ok "the image ships no release store (it is created at runtime)"
else
  bad "the image ships no release store (it is created at runtime)" \
      "shipped content here would overwrite what a device installed"
fi
if [[ ! -e "${ROOTFS}/persistent/shared/kitluy/release-source.env" ]]; then
  ok "the image ships no release-source override (an edit would be overwritten)"
else
  bad "the image ships no release-source override (an edit would be overwritten)" \
      "the override would be restored from the image on every boot"
fi

printf '\n  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[[ $FAIL -eq 0 ]] || exit 1
