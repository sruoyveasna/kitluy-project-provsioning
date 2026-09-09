#!/usr/bin/env bash
# What the FLASHABLE image actually contains, checked against runtime-manifest.json.
#
# WHY THIS SUITE IS DIFFERENT FROM THE OTHERS
# -----------------------------------------------------------------------------
# `build-gates.test.sh` and `systemd-runtime.test.sh` assert against the STAGED
# tree that `build-image.sh --stage-only` produces — a `cp -a` of the overlay.
# That tree is useful, but it is not what gets flashed, and the gap between them
# is exactly where D-05 lived: the Hub agent's source, its unit and its avahi
# advert all existed, every source-level check passed, and no card ever carried
# the binary.
#
# So this suite inspects the ROOTFS THE BUILDER PRODUCED. A build log saying
# "packaged hub agent" is not evidence; a file in the image is.
#
#   bash infra/kitluy-store-hub-image/test/image-contents.test.sh [rootfs-path]
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
  # rpi-image-gen unpacks into build/work/chroot-<version>/filesystem.
  ROOTFS="$(find "${ROOT}/build" -maxdepth 3 -type d -name filesystem -path '*chroot*' \
              -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
fi

if [[ -z "$ROOTFS" || ! -d "$ROOTFS" ]]; then
  printf '\n  No built rootfs found. Build one first:\n'
  printf '    bash infra/kitluy-store-hub-image/scripts/build-rpi-image.sh --profile store-hub\n'
  printf '  or pass a path:  bash %s <rootfs>\n\n' "${BASH_SOURCE[0]}"
  printf '  0 passed, 0 failed, 1 skipped (no image to inspect)\n\n'
  exit 0
fi

printf '\n  inspecting %s\n\n' "$ROOTFS"

# ---------------------------------------------------------------------------
# The manifest, flattened for shell
# ---------------------------------------------------------------------------
# One line per component: id<TAB>executable<TAB>unit<TAB>enabled<TAB>envfiles
COMPONENTS="$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const c of m.components || []) {
    if (!(c.profiles || []).includes("store-hub")) continue;
    process.stdout.write([
      c.id, c.executable || "", c.unit || "",
      c.enabled ? "yes" : "no",
      (c.environmentFiles || []).join(","),
    ].join("\t") + "\n");
  }
' "$MANIFEST")"

[[ -n "$COMPONENTS" ]] || { printf 'the manifest declares no store-hub components\n' >&2; exit 2; }

# ---------------------------------------------------------------------------
# 1. Every declared component is actually in the image
# ---------------------------------------------------------------------------
# THE D-05 CHECK. If hub-agent source exists but its binary is not on the card,
# this is the assertion that says so.
while IFS=$'\t' read -r id executable unit enabled envfiles; do
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
  fi

  if [[ -n "$unit" ]]; then
    unit_path="${ROOTFS}/etc/systemd/system/${unit}"
    if [[ -f "$unit_path" ]]; then
      ok "${id}: ${unit} is in the image"
    else
      bad "${id}: ${unit} is in the image" "no unit file at /etc/systemd/system/${unit}"
    fi

    # A unit file and a wants symlink are separate facts — v2.7.0 taught the
    # sibling suite this, and it holds here too.
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

  # An EnvironmentFile= that does not exist is a 226/NAMESPACE-class failure:
  # systemd refuses the unit before ExecStart runs.
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
# 2. The Hub agent bundle is real, and is what the shim points at
# ---------------------------------------------------------------------------
SHIM="${ROOTFS}/usr/lib/kitluy/hub-agent"
BUNDLE="${ROOTFS}/usr/lib/kitluy/lib/hub-agent/main.mjs"

if [[ -f "$BUNDLE" && -s "$BUNDLE" ]]; then
  ok "the Hub agent bundle is in the image ($(( $(stat -c '%s' "$BUNDLE") / 1024 )) KiB)"
else
  bad "the Hub agent bundle is in the image" "no bundle at /usr/lib/kitluy/lib/hub-agent/main.mjs"
fi

if [[ -f "$SHIM" ]] && grep -q '/usr/lib/kitluy/lib/hub-agent/main.mjs' "$SHIM"; then
  ok "the Hub agent shim execs the packaged bundle"
else
  bad "the Hub agent shim execs the packaged bundle" "the shim does not point at the bundle that is shipped"
fi

# The image ships NO node_modules. Bundling exists precisely to keep that true.
if find "${ROOTFS}/usr/lib/kitluy" -maxdepth 3 -type d -name node_modules -print -quit 2>/dev/null | grep -q .; then
  bad "the image ships no node_modules" "a dependency tree reached /usr/lib/kitluy"
else
  ok "the image ships no node_modules"
fi

# ---------------------------------------------------------------------------
# 3. The avahi advert corresponds to something that can serve it
# ---------------------------------------------------------------------------
# The whole reason this milestone exists: the image advertised
# `_kitluy-edge._tcp` on 7443 with no agent behind it.
ADVERT="${ROOTFS}/etc/avahi/services/kitluy-edge.service"
if [[ -f "$ADVERT" ]]; then
  advertised_port="$(grep -oP '(?<=<port>)[0-9]+' "$ADVERT" | head -1)"
  if [[ -x "$SHIM" ]]; then
    ok "the _kitluy-edge advert has an agent behind it"
  else
    bad "the _kitluy-edge advert has an agent behind it" "the image advertises a LAN service it cannot serve"
  fi
  if [[ "$advertised_port" == "7443" ]]; then
    ok "the advert names port 7443"
  else
    bad "the advert names port 7443" "advertises ${advertised_port}; a terminal REJECTS any other port"
  fi
else
  skip "the _kitluy-edge advert has an agent behind it" "no avahi service file in this rootfs"
fi

# ---------------------------------------------------------------------------
# 3b. The image STATES its environment
# ---------------------------------------------------------------------------
# DEVELOPMENT-UNBOUND storage and the development LAN listener both open on this
# one word. It used to be defaulted by the layer while the builder passed
# nothing, so every image authorised both by omission. A built image must now
# carry a value somebody chose, and it must be one of the known environments.
#
# `KITLUY_EXPECT_ENVIRONMENT` lets a pilot build assert its own posture; the
# default matches what this repository can currently produce.
EXPECT_ENV="${KITLUY_EXPECT_ENVIRONMENT:-development}"
IMAGE_ENV="$(sed -n 's/^KITLUY_ENVIRONMENT=//p' "${ROOTFS}/etc/kitluy/image.env" 2>/dev/null)"

if [[ -z "$IMAGE_ENV" ]]; then
  bad "the image states an environment" \
      "KITLUY_ENVIRONMENT is empty — every development escape path would read 'unknown' and refuse, but the image should never have shipped without a stated posture"
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

# A development image is DEVELOPMENT. This artifact is unsigned and not release
# eligible, so a posture claiming otherwise would be a lie the release path reads.
if [[ "$IMAGE_ENV" == "pilot" || "$IMAGE_ENV" == "production" ]]; then
  bad "an unsigned artifact does not claim a production posture" \
      "the image says '${IMAGE_ENV}' while being UNSIGNED and NOT release-eligible (BLK-005)"
else
  ok "an unsigned artifact does not claim a production posture"
fi

# ---------------------------------------------------------------------------
# 4. The retired ticket enrollment agent is gone (D-27)
# ---------------------------------------------------------------------------
# Its identity included the SD card, so a re-flashed board minted a SECOND
# device and the duplicate-evidence tripwire quarantined both. Cloud
# registration is the Hub's one identity path.
if [[ -f "${ROOTFS}/etc/systemd/system/kitluy-enrollment-agent.service" \
   || -L "${ROOTFS}/etc/systemd/system/multi-user.target.wants/kitluy-enrollment-agent.service" ]]; then
  bad "the ticket enrollment agent is not in the image" "a re-flashed card would mint a second device identity"
else
  ok "the ticket enrollment agent is not in the image"
fi

# ---------------------------------------------------------------------------
# 5. Nothing per-device was baked in
# ---------------------------------------------------------------------------
# A golden image is generic. Every one of these is generated ON the device, and
# any of them present here would be shared by every board flashed from it.
for forbidden in \
  /var/lib/kitluy/identity/device-identity.key.pem \
  /var/lib/kitluy/operational/operational-tls.key.pem \
  /var/lib/kitluy/pairing-state.json \
  /var/lib/kitluy/registration-state.json \
  /var/lib/kitluy/development-unbound-storage.key \
  /var/lib/kitluy/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED \
  /var/lib/kitluy/storage-posture
do
  if find "$ROOTFS" -path "*${forbidden}" -print -quit 2>/dev/null | grep -q .; then
    bad "no per-device state at ${forbidden}" "every board flashed from this image would share it"
  else
    ok "no per-device state at ${forbidden}"
  fi
done

# machine-id and SSH host keys are per-device too, and are the two that break
# fleet identity most quietly when shared.
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


# ---------------------------------------------------------------------------
# Development recovery sudo
# ---------------------------------------------------------------------------
# `pi` ships with a LOCKED password, so an image with an SSH key but no sudoers
# grant can be logged into and little else -- which stranded a Hub on
# 2026-09-08. The grant is written by a layer hook, and the FIRST version of
# that hook made the layer YAML unparseable and the build refused. This asserts
# the hook is still syntactically reachable and still gated.
SUDOERS_HOOK="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.yaml"
if grep -q 'IGconf_kitluy_dev_recovery_sudo' "$SUDOERS_HOOK"; then
  ok "the recovery-sudo hook is present in the layer"
else
  bad "the recovery-sudo hook is present in the layer" "hook missing"
fi

if python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$SUDOERS_HOOK" 2>/dev/null; then
  ok "the hub layer YAML parses"
else
  bad "the hub layer YAML parses" "rpi-image-gen would refuse this build"
fi

# The grant must be behind the override, never unconditional.
if grep -A2 'IGconf_kitluy_dev_recovery_sudo' "$SUDOERS_HOOK" | grep -q 'if \[ -n'; then
  ok "the recovery-sudo grant is gated on the build override"
else
  bad "the recovery-sudo grant is gated on the build override" "it may be unconditional"
fi

printf '\n  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
[[ $FAIL -eq 0 ]] || exit 1
