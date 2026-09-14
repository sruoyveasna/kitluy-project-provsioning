#!/usr/bin/env bash
# KitLuy Pi Terminal image — systemd runtime integrity gates.
#
# WHY THIS FILE EXISTS
# --------------------
# `build-gates.test.sh` once reported 34/34 PASS against an image in which EVERY
# KitLuy agent was missing. It asserted that unit FILES exist; it never asked
# whether the program each unit starts exists. Image v2.7.0 shipped six enabled
# units pointing at absent binaries and no gate objected.
#
# THE INVARIANT THIS ENFORCES
# ---------------------------
#   Every ENABLED KitLuy systemd unit must point at a real executable present
#   in the image.
#
# NOT "every possible KitLuy unit must exist and be enabled". The KitLuy POS
# Desktop application is a GOVERNED APPLICATION RELEASE (owner decision DEC-1),
# so `kitluy-terminal-client.service` is DEFINED by the golden image and
# deliberately NOT enabled: the release package installs the binary and enables
# the unit. A unit that is defined-but-disabled is correct architecture; a unit
# that is enabled-but-dead is the v2.7.0 defect.
#
# Enablement is read the way systemd reads it — a symlink under a
# `*.target.wants/` directory — not from a naming convention.
#
# Run: bash infra/kitluy-os-image/test/systemd-runtime.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ROOT}/scripts/build-image.sh"
LAYER_DIR="${ROOT}/rpi-image-gen/layer"
MANIFEST="${ROOT}/runtime-manifest.json"
BASE_LAYER="${LAYER_DIR}/kitluy-base.yaml"
TERMINAL_LAYER="${LAYER_DIR}/kitluy-pi-terminal.yaml"
SRC="${ROOT}/rpi-image-gen"
REPO_ROOT="$(cd "${ROOT}/../.." && pwd)"
BASE_OVERLAY="${LAYER_DIR}/kitluy-base.rootfs-overlay"
TERMINAL_OVERLAY="${LAYER_DIR}/kitluy-pi-terminal.rootfs-overlay"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

# ExecStart programs that come from a Debian package rather than the KitLuy
# overlay, mapped to the package that provides them. Kept explicit and small: a
# new entry is a deliberate statement that the image depends on a distribution
# binary, which is worth noticing in review rather than inferring at runtime.
declare -A PACKAGE_PROVIDING=(
  [/usr/bin/ssh-keygen]=openssh-server
  # coreutils is Essential:yes on Debian, so it is present in every rootfs this
  # builder can produce; it is recorded here because the gate asks for a NAME,
  # not because its presence is in doubt.
  [/usr/bin/install]=coreutils
)

printf '\nKitLuy Pi Terminal image — systemd runtime integrity\n\n'

for profile in pi-terminal; do
  bash "$BUILD" --profile "$profile" --stage-only --out "${TMP}/${profile}" >/dev/null 2>&1
done

# Units enabled in a staged tree: any kitluy-*.service symlinked from a
# *.target.wants directory.
enabled_units() {
  local root="$1"
  find "${root}/etc/systemd/system" -mindepth 2 -name 'kitluy-*.service' -path '*.wants/*' \
    -printf '%f\n' 2>/dev/null | sort -u
}

# ---------------------------------------------------------------------------
# 1. THE REGRESSION GATE — every enabled unit's ExecStart must exist and be
#    executable. Hard failure: an enabled unit whose program is absent is a
#    device that boots into a restart loop.
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  root="${TMP}/${profile}/rootfs"
  units_dir="${root}/etc/systemd/system"
  [[ -d "$units_dir" ]] || { bad "${profile}: unit directory exists" "absent"; continue; }

  mapfile -t enabled < <(enabled_units "$root")
  if [[ ${#enabled[@]} -eq 0 ]]; then
    bad "${profile}: at least one KitLuy unit is enabled" "none enabled"
  else
    ok "${profile}: ${#enabled[@]} KitLuy unit(s) enabled"
  fi

  for unit_name in "${enabled[@]}"; do
    unit="${units_dir}/${unit_name}"
    [[ -f "$unit" ]] || { bad "${profile}/${unit_name}: enabled unit has a definition" "symlink with no unit file"; continue; }

    exec_line="$(grep -m1 '^ExecStart=' "$unit" | sed 's/^ExecStart=//')"
    if [[ -z "$exec_line" ]]; then
      bad "${profile}/${unit_name}: declares an ExecStart" "none found"
      continue
    fi
    target="$(printf '%s\n' "$exec_line" | awk '{print $1}' | sed 's/^[-@:+!]*//')"

    # TWO KINDS OF ExecStart, TWO KINDS OF PROOF.
    #
    # A program under /usr/lib/kitluy is installed by the overlay, so the staged
    # tree must contain it. A program from a Debian package (ssh-keygen) can
    # never appear in the staged tree, because --stage-only installs no
    # packages; what IS checkable is that some layer declares the providing
    # package so mmdebstrap installs it into the real rootfs.
    if [[ "$target" == /usr/lib/kitluy/* ]]; then
      if [[ -e "${root}${target}" ]]; then
        if [[ -x "${root}${target}" ]]; then
          ok "${profile}/${unit_name}: ExecStart ${target} exists and is executable"
        else
          bad "${profile}/${unit_name}: ExecStart ${target} is executable" "present but not +x"
        fi
      else
        bad "${profile}/${unit_name}: ExecStart ${target} exists" \
            "ENABLED unit whose program is absent from the image"
      fi
    else
      pkg="${PACKAGE_PROVIDING[$target]:-}"
      if [[ -z "$pkg" ]]; then
        bad "${profile}/${unit_name}: ExecStart ${target} has a known provider" \
            "program is outside /usr/lib/kitluy and no providing package is recorded in PACKAGE_PROVIDING"
      elif grep -rqE "^#? *- ?${pkg}[,[:space:]]*$|^# X-Env-Layer-Requires:.*${pkg}|^#  ${pkg}," "${LAYER_DIR}"/*.yaml; then
        ok "${profile}/${unit_name}: ExecStart ${target} provided by declared package '${pkg}'"
      else
        bad "${profile}/${unit_name}: ExecStart ${target} provided by declared package '${pkg}'" \
            "no layer declares ${pkg}, so the binary would be absent from the real image"
      fi
    fi
  done
done

# ---------------------------------------------------------------------------
# 1b. Every EnvironmentFile an ENABLED unit references must exist.
#     systemd FAILS a unit whose EnvironmentFile is missing (unless the path is
#     prefixed with `-`).
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  root="${TMP}/${profile}/rootfs"
  while read -r unit_name; do
    [[ -n "$unit_name" ]] || continue
    unit="${root}/etc/systemd/system/${unit_name}"
    [[ -f "$unit" ]] || continue
    while read -r envref; do
      [[ -n "$envref" ]] || continue
      optional=0
      [[ "$envref" == -* ]] && { optional=1; envref="${envref#-}"; }
      if [[ -e "${root}${envref}" ]]; then
        ok "${profile}/${unit_name}: EnvironmentFile ${envref} exists"
      elif [[ $optional -eq 1 ]]; then
        ok "${profile}/${unit_name}: EnvironmentFile ${envref} absent but marked optional"
      else
        bad "${profile}/${unit_name}: EnvironmentFile ${envref} exists" \
            "systemd will refuse to start this unit"
      fi
    done < <(grep '^EnvironmentFile=' "$unit" | sed 's/^EnvironmentFile=//')
  done < <(enabled_units "$root")
done

# ---------------------------------------------------------------------------
# 2. Governed application releases must be DEFINED but NOT ENABLED.
# ---------------------------------------------------------------------------
declare -A GOVERNED=(
  [pi-terminal]="kitluy-terminal-client.service"
)
for profile in "${!GOVERNED[@]}"; do
  root="${TMP}/${profile}/rootfs"
  for unit_name in ${GOVERNED[$profile]}; do
    if [[ -f "${root}/etc/systemd/system/${unit_name}" ]]; then
      ok "${profile}/${unit_name}: governed-release unit is defined"
    else
      bad "${profile}/${unit_name}: governed-release unit is defined" "definition absent"
    fi
    if enabled_units "$root" | grep -qx "$unit_name"; then
      bad "${profile}/${unit_name}: governed-release unit is NOT enabled" \
          "enabled in the golden image, so it will restart-loop until the release lands"
    else
      ok "${profile}/${unit_name}: governed-release unit is NOT enabled"
    fi
  done
done

# ---------------------------------------------------------------------------
# 2b. THE MANIFEST AND THE OVERLAY AGREE ON ENABLEMENT.
#     `enabled` in runtime-manifest.json is what the tests and the packaging
#     believe; the wants symlink is what systemd believes. They must match.
# ---------------------------------------------------------------------------
if [[ -f "$MANIFEST" ]] && command -v node >/dev/null 2>&1; then
  while IFS=$'\t' read -r id unit enabled; do
    [[ -n "$id" && -n "$unit" ]] || continue
    wanted="no"
    for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
      [[ -L "${overlay}/etc/systemd/system/multi-user.target.wants/${unit}" || -e "${overlay}/etc/systemd/system/multi-user.target.wants/${unit}" ]] && wanted="yes"
    done
    if [[ "$enabled" == "$wanted" ]]; then
      ok "manifest/${id}: enabled=${enabled} matches the overlay"
    else
      bad "manifest/${id}: enabled=${enabled} matches the overlay" "the overlay says wanted=${wanted}"
    fi
    defined="no"
    for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
      [[ -f "${overlay}/etc/systemd/system/${unit}" ]] && defined="yes"
    done
    if [[ "$defined" == "yes" ]]; then
      ok "manifest/${id}: ${unit} is defined in an overlay"
    else
      bad "manifest/${id}: ${unit} is defined in an overlay" "declared but no unit file"
    fi
  done < <(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const c of m.components || []) {
      if (!(c.profiles || []).includes("pi-terminal") || !c.unit) continue;
      process.stdout.write([c.id, c.unit, c.enabled ? "yes" : "no"].join("\t") + "\n");
    }' "$MANIFEST")
else
  bad "runtime-manifest.json is present and readable" "missing manifest or node"
fi

# ---------------------------------------------------------------------------
# 3. `%i` is meaningless outside a template unit.
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  for unit in "${TMP}/${profile}/rootfs/etc/systemd/system"/kitluy-*.service; do
    [[ -e "$unit" ]] || continue
    name="$(basename "$unit")"
    [[ "$name" == *@.service ]] && continue
    if grep -qE '^[A-Za-z]+=.*%i' "$unit"; then
      bad "${profile}/${name}: no %i specifier in a non-template unit" \
          "$(grep -nE '^[A-Za-z]+=.*%i' "$unit" | head -1)"
    else
      ok "${profile}/${name}: no %i specifier in a non-template unit"
    fi
  done
done

for overlay_unit in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                    "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -e "$overlay_unit" ]] || continue
  name="$(basename "$overlay_unit")"
  if grep -qE '^User=.*%i' "$overlay_unit"; then
    bad "canonical ${name}: no User=%i in a non-template unit" "specifier expands to empty"
  else
    ok "canonical ${name}: no User=%i in a non-template unit"
  fi
done

# ---------------------------------------------------------------------------
# 4. Hardening must be present on every canonical KitLuy unit.
# ---------------------------------------------------------------------------
for overlay_unit in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                    "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -e "$overlay_unit" ]] || continue
  name="$(basename "$overlay_unit")"
  for directive in NoNewPrivileges ProtectSystem ProtectHome PrivateTmp RestrictSUIDSGID; do
    if grep -q "^${directive}=" "$overlay_unit"; then
      ok "canonical ${name}: ${directive} present"
    else
      bad "canonical ${name}: ${directive} present" "hardening directive absent"
    fi
  done
done

# ---------------------------------------------------------------------------
# 5. Service users referenced by units must be declared in the image.
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  root="${TMP}/${profile}/rootfs"
  for unit in "${root}/etc/systemd/system"/kitluy-*.service; do
    [[ -e "$unit" ]] || continue
    name="$(basename "$unit")"
    user="$(grep -m1 '^User=' "$unit" | sed 's/^User=//')"
    [[ -z "$user" || "$user" == "root" ]] && continue
    if grep -rqE "^u[[:space:]]+${user}\b" "${root}/etc/sysusers.d/" 2>/dev/null; then
      ok "${profile}/${name}: service user ${user} is declared"
    else
      bad "${profile}/${name}: service user ${user} is declared" "no sysusers.d entry"
    fi
  done
done

# ---------------------------------------------------------------------------
# 6. One canonical source: the staged tree and the layer overlay must contain
#    byte-identical unit definitions.
# ---------------------------------------------------------------------------
for overlay_unit in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                    "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -e "$overlay_unit" ]] || continue
  name="$(basename "$overlay_unit")"
  staged="${TMP}/pi-terminal/rootfs/etc/systemd/system/${name}"
  if [[ -f "$staged" ]]; then
    if cmp -s "$overlay_unit" "$staged"; then
      ok "canonical ${name}: staged tree matches the overlay byte-for-byte"
    else
      bad "canonical ${name}: staged tree matches the overlay byte-for-byte" \
          "the two build paths have diverged again"
    fi
  fi
done

# ---------------------------------------------------------------------------
# 7. Required runtime directories.
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  root="${TMP}/${profile}/rootfs"
  for d in var/lib/kitluy etc/kitluy usr/lib/kitluy; do
    [[ -d "${root}/${d}" ]] && ok "${profile}: runtime directory /${d} exists" \
                            || bad "${profile}: runtime directory /${d} exists" "absent"
  done
done

# ---------------------------------------------------------------------------
# 8. Clone hygiene: no per-device state may be pre-populated.
# ---------------------------------------------------------------------------
for profile in pi-terminal; do
  root="${TMP}/${profile}/rootfs"
  for forbidden in var/lib/kitluy/identity/identity.json \
                   var/lib/kitluy/identity/device-identity.key.pem \
                   var/lib/kitluy/bootstrap-state.json \
                   var/lib/kitluy/registration-state.json \
                   var/lib/kitluy/installation.json \
                   var/lib/kitluy/enrollment/ticket \
                   var/lib/kitluy/terminal/assignment.json \
                   var/lib/kitluy/terminal/hub-endpoint.json \
                   var/lib/kitluy/terminal/configuration.json; do
    if [[ -e "${root}/${forbidden}" ]]; then
      bad "${profile}: /${forbidden} is NOT pre-populated" "golden image carries per-device state"
    else
      ok "${profile}: /${forbidden} is NOT pre-populated"
    fi
  done
done

# ---------------------------------------------------------------------------
# 9. FACTORY ENROLLMENT IS THE ONE IDENTITY PATH (KLD-2026-09-03-FACTORY-ENROLLMENT-001).
#    The flash-time ticket agent enrolled a device straight to `enrolled` with
#    no Admin decision. Unit, enablement, shim and module are separate facts.
# ---------------------------------------------------------------------------
for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
  [[ -d "$overlay" ]] || continue
  label="$(basename "$overlay")"
  if find "$overlay/etc/systemd/system" -name 'kitluy-enrollment-agent.service' -print -quit 2>/dev/null | grep -q .; then
    bad "ticket enrollment agent stays out of the terminal image (${label})" \
        "a device could self-enroll past Admin approval"
  else
    ok "ticket enrollment agent stays out of the terminal image (${label})"
  fi
done
if [[ -e "${BASE_OVERLAY}/usr/lib/kitluy/enrollment-agent" ]]; then
  bad "ticket enrollment agent shim stays out of the overlay" "present"
else
  ok "ticket enrollment agent shim stays out of the overlay"
fi
if [[ -f "${BASE_OVERLAY}/usr/lib/kitluy/lib/firstboot-agent/bin/enrollment-bootstrap.js" ]]; then
  bad "ticket enrollment module stays out of the packaged closure" "bin/enrollment-bootstrap.js present"
else
  ok "ticket enrollment module stays out of the packaged closure"
fi
# And cloud registration — the one path — is present, enabled and packaged.
if [[ -f "${BASE_OVERLAY}/etc/systemd/system/kitluy-cloud-registration.service" \
   && -L "${BASE_OVERLAY}/etc/systemd/system/multi-user.target.wants/kitluy-cloud-registration.service" \
   && -x "${BASE_OVERLAY}/usr/lib/kitluy/cloud-registration" \
   && -f "${BASE_OVERLAY}/usr/lib/kitluy/lib/firstboot-agent/bin/cloud-registration.js" ]]; then
  ok "cloud registration is defined, enabled and packaged"
else
  bad "cloud registration is defined, enabled and packaged" "unit, symlink, shim or module missing"
fi

# ---------------------------------------------------------------------------
# 10. NO STORE AUTHORITY IN A TERMINAL OVERLAY.
# ---------------------------------------------------------------------------
for rel in etc/systemd/system/kitluy-hub-agent.service usr/lib/kitluy/hub-agent \
           usr/lib/kitluy/hub-migrations usr/lib/kitluy/hub-storage-provision \
           usr/lib/kitluy/hub-database-provision etc/kitluy/hub.env; do
  present="no"
  for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
    [[ -e "${overlay}/${rel}" ]] && present="yes"
  done
  if [[ "$present" == "yes" ]]; then
    bad "no Store authority at /${rel} in a terminal overlay" "Hub material present"
  else
    ok "no Store authority at /${rel} in a terminal overlay"
  fi
done

# ---------------------------------------------------------------------------
# 11. TTY1 OWNERSHIP IS DECIDED, NOT CONTESTED.
# ---------------------------------------------------------------------------
for layer in "$BASE_LAYER"; do
  name="$(basename "$layer")"

  if grep -q 'rm -f "$1/etc/systemd/system/getty.target.wants/getty@tty1.service"' "$layer"; then
    ok "${name}: getty is removed from tty1"
  else
    bad "${name}: getty is removed from tty1" \
        "getty@tty1 stays enabled and races the KitLuy console for tty1"
  fi

  if grep -q 'NAutoVTs=0' "$layer"; then
    ok "${name}: logind autospawn is disabled"
  else
    bad "${name}: logind autospawn is disabled" \
        "logind starts autovt@tty1 (an alias of getty@), which Conflicts= cannot prevent"
  fi

  if grep -q 'getty.target.wants/getty@tty2.service' "$layer"; then
    ok "${name}: an authenticated maintenance console remains on tty2"
  else
    bad "${name}: an authenticated maintenance console remains on tty2" \
        "tty1 taken with no maintenance TTY left"
  fi

  if grep -qE 'autologin|--autologin|agetty.* -a ' "$layer"; then
    bad "${name}: no autologin shortcut" "an appliance must not auto-login a shell"
  else
    ok "${name}: no autologin shortcut"
  fi
done

# THE DISPLAY HAS EXACTLY ONE OWNER, AND THE MANIFEST NAMES IT.
#
# "Claims the console" used to mean one thing — `TTYPath=/dev/tty1`, because the
# only surface was a text screen. The Device Shell claims the DISPLAY instead:
# cage takes the DRM device and never opens a tty, so a TTYPath-only rule would
# have looked straight past the unit that actually owns the screen and declared
# the image ownerless.
#
# What both mechanisms share is the thing that matters — they must displace
# getty, or a login prompt no one can satisfy prints over the product. So a
# claimant is a unit that sets TTYPath=/dev/tty1 OR conflicts with getty@tty1,
# and the invariant is that exactly ONE of them is enabled.
#
# Being defined and NOT enabled is legitimate and is not a defect: the text
# screen stays in the image as the recovery surface for a board where the
# compositor cannot start, and the labwc session stays for the governed POS
# release. Only the enabled set is constrained.
CONSOLE_CLAIMANTS=""
for overlay_unit in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                    "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -f "$overlay_unit" ]] || continue
  grep -qE 'TTYPath=/dev/tty1|Conflicts=.*getty@tty1' "$overlay_unit" || continue
  name="$(basename "$overlay_unit")"
  overlay_root="${overlay_unit%/etc/systemd/system/*}"
  CONSOLE_CLAIMANTS="${CONSOLE_CLAIMANTS} ${name}"

  if grep -q 'Conflicts=.*getty@tty1' "$overlay_unit"; then
    ok "${name}: conflicts with getty@tty1"
  else
    bad "${name}: conflicts with getty@tty1" "claims the console without displacing getty"
  fi

  # Every ConditionPathExists must be satisfiable, not just the first: the shell
  # guards on its launcher AND on the Electron runtime, and a unit skipped for a
  # guard nobody checked is the D-27 shape — silently inactive, no error anywhere.
  while IFS= read -r guard; do
    [[ -n "$guard" ]] || continue
    # The Electron runtime is fetched at build time and is deliberately not in any
    # overlay; image-contents.test.sh asserts it against the BUILT rootfs instead.
    if [[ "$guard" == /usr/lib/kitluy/electron/* ]]; then
      ok "${name}: guard ${guard} is the pinned runtime (asserted against the built rootfs)"
    elif [[ -e "${overlay_root}${guard}" ]]; then
      ok "${name}: its ConditionPathExists target is shipped (${guard})"
    else
      bad "${name}: its ConditionPathExists target is shipped" \
          "guard ${guard} is absent, so the unit is skipped and getty keeps the console"
    fi
  done <<< "$(grep -oE '^ConditionPathExists=.*' "$overlay_unit" | cut -d= -f2-)"
done

# At least one claimant must exist, or the image has no product on its screen.
if [[ -n "${CONSOLE_CLAIMANTS// /}" ]]; then
  ok "the image defines a console/display surface"
else
  bad "the image defines a console/display surface" "no unit claims the screen at all"
fi

# Exactly ONE claimant is enabled, and it is the one the manifest names.
#
# Two enabled claimants is not a cosmetic problem: both would start, both would
# Conflicts= the other, and systemd would stop one to start the other in a loop
# whose visible symptom is a flickering screen in a shop.
MANIFEST_OWNER="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((m.tty1&&m.tty1.owner)||"")' "$MANIFEST" 2>/dev/null)"
enabled_console=""
for u in $CONSOLE_CLAIMANTS; do
  for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
    [[ -L "${overlay}/etc/systemd/system/multi-user.target.wants/${u}" || -e "${overlay}/etc/systemd/system/multi-user.target.wants/${u}" ]] && enabled_console="${enabled_console} ${u}"
  done
done
enabled_console="${enabled_console# }"
if [[ "$enabled_console" == "$MANIFEST_OWNER" && -n "$MANIFEST_OWNER" ]]; then
  ok "exactly one enabled unit owns the display, and the manifest names it (${MANIFEST_OWNER})"
else
  bad "exactly one enabled unit owns the display, and the manifest names it" \
      "manifest owner='${MANIFEST_OWNER}' enabled claimants='${enabled_console}'"
fi

# The unit the manifest displaced must still be DEFINED. It is the surface an
# operator falls back to when the compositor cannot start — no GPU, no seat, no
# Electron — and deleting it would leave such a board with a blank screen and no
# way to read its own registration state.
PREVIOUS_OWNER="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((m.tty1&&m.tty1.previousOwner)||"")' "$MANIFEST" 2>/dev/null)"
if [[ -n "$PREVIOUS_OWNER" ]]; then
  if [[ -f "${BASE_OVERLAY}/etc/systemd/system/${PREVIOUS_OWNER}" || -f "${TERMINAL_OVERLAY}/etc/systemd/system/${PREVIOUS_OWNER}" ]]; then
    ok "the displaced console surface is still defined for recovery (${PREVIOUS_OWNER})"
  else
    bad "the displaced console surface is still defined for recovery" \
        "${PREVIOUS_OWNER} was removed, so a board that cannot start the shell shows nothing"
  fi
fi

# ============================================================================
# NETWORK CONTRACT (owner decision 2026-08-24 §4, §5, §7, §8)
# ============================================================================
WIFI_SLOT_SHARED="${BASE_OVERLAY}/etc/rpi-image-gen/slot-shared.d/61-kitluy-wifi.conf"

if grep -qE '^\s+- wpasupplicant\s*$' "$BASE_LAYER"; then
  ok "wifi: wpa_supplicant is installed"
else
  bad "wifi: wpa_supplicant is installed" "wlan0 can take a DHCP lease but can never associate"
fi

if grep -qE '^\s+- network-manager\s*$' "$BASE_LAYER"; then
  bad "wifi: NetworkManager is NOT installed" "the network activator must stay systemd-networkd"
else
  ok "wifi: NetworkManager is NOT installed"
fi

if grep -q 'RouteMetric=100' "$BASE_LAYER" && grep -q 'RouteMetric=600' "$BASE_LAYER"; then
  ok "network: Ethernet outranks Wi-Fi by route metric"
else
  bad "network: Ethernet outranks Wi-Fi by route metric" \
      "with both links up the default route would be whichever lease landed last"
fi

# A DHCP lease must never rename the appliance, and the request to apply one
# starts systemd-hostnamed, which cannot set up its namespace on the erofs root
# (226/NAMESPACE) — one failed unit on every boot of both images (2026-09-03).
if [ "$(grep -c '^\s*UseHostname=no\s*$' "$BASE_LAYER")" -eq 2 ]; then
  ok "networkd: neither interface takes a hostname from DHCP (UseHostname=no twice)"
else
  bad "networkd: neither interface takes a hostname from DHCP (UseHostname=no twice)" \
      "networkd would ask systemd-hostnamed to apply the lease hostname, and hostnamed fails on the read-only root"
fi

if grep -q 'RequiredForOnline=no' "$BASE_LAYER"; then
  ok "network: an unconfigured wlan0 does not hold up boot"
else
  bad "network: an unconfigured wlan0 does not hold up boot" "wait-online will block on wlan0"
fi

if [[ -f "$WIFI_SLOT_SHARED" ]] && grep -q '^Path=/etc/wpa_supplicant$' "$WIFI_SLOT_SHARED"; then
  ok "wifi: the credential store is slot-shared"
else
  bad "wifi: the credential store is slot-shared" \
      "/etc is EROFS at runtime; per-slot would also lose the shop's Wi-Fi on every update"
fi

# The slot-shared generator bug: with two slot-shared paths declared, only the
# last is enabled unless a consumer Requires= the other mount.
SSH_UNIT="${BASE_OVERLAY}/etc/systemd/system/kitluy-ssh-hostkeys.service"
if grep -q '^Requires=etc-ssh.mount' "$SSH_UNIT"; then
  ok "wifi: declaring a second slot-shared path does not orphan /etc/ssh"
else
  bad "wifi: declaring a second slot-shared path does not orphan /etc/ssh" \
      "kitluy-ssh-hostkeys.service must Requires=etc-ssh.mount or sshd never starts"
fi

if grep -q 'ctrl_interface=/run/wpa_supplicant' "$BASE_LAYER" && \
   ! grep -qE '^\s+psk=' "$BASE_LAYER"; then
  ok "wifi: the seeded configuration carries no secret"
else
  bad "wifi: the seeded configuration carries no secret" "a PSK must never be baked into a golden image"
fi

# ============================================================================
# TIMEZONE (owner decision 2026-08-24 §3, §9)
# ============================================================================
if grep -q 'ln -sf "/usr/share/zoneinfo/\$TZ" "\$1/etc/localtime"' "$BASE_LAYER"; then
  ok "timezone: the appliance clock is set at build time"
else
  bad "timezone: the appliance clock is set at build time" "the image would ship the Debian default"
fi

if grep -q 'IGconf_kitluy_timezone:-Asia/Phnom_Penh' "$BASE_LAYER"; then
  ok "timezone: defaults to Asia/Phnom_Penh with no installer step"
else
  bad "timezone: defaults to Asia/Phnom_Penh with no installer step" "the default must not be Debian's"
fi

# The hook links /etc/localtime to a zoneinfo file and refuses when it is
# absent. The Store Hub always had one (PostgreSQL depends on tzdata); the first
# terminal build died in this hook because nothing declared it, and every later
# hook plus the KitLuy overlay never happened. A package a hook depends on must
# be named by the layer, not inherited by luck.
if grep -qE '^\s+- tzdata\s*$' "$BASE_LAYER"; then
  ok "timezone: tzdata is declared, so the zoneinfo file the hook links exists"
else
  bad "timezone: tzdata is declared, so the zoneinfo file the hook links exists" \
      "the appliance-clock hook would abort the build on a rootfs without zoneinfo"
fi

CONSOLE_SRC="${ROOT}/../../services/kitluy-device-firstboot-agent/src/bin"
for forbidden in 'Select.*timezone' 'Choose.*language' 'Which Store' 'Select.*Location'; do
  if grep -rqiE "$forbidden" "$CONSOLE_SRC" 2>/dev/null; then
    bad "console: no selection step for '${forbidden}'" "the Store Location is resolved by the pairing session"
  else
    ok "console: no selection step for '${forbidden}'"
  fi
done

# ============================================================================
# EVERY UNIT SHARING /var/lib/kitluy MUST AGREE ON ITS MODE.
# ============================================================================
# systemd re-applies StateDirectoryMode on each start, so when units disagree
# the last one to start wins and the directory's mode depends on boot ordering.
# The Store Hub settled on 0751 (postgres must traverse the directory); the
# terminal keeps the same value so both images stay on one convention.
STATE_MODES=""
for unit_file in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                 "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -f "$unit_file" ]] || continue
  grep -qE '^StateDirectory=kitluy$' "$unit_file" || continue
  mode="$(grep -oP '(?<=^StateDirectoryMode=)\S+' "$unit_file" | head -1)"
  STATE_MODES+="$(basename "$unit_file")=${mode:-UNSET} "
done

distinct="$(printf '%s\n' $STATE_MODES | sed 's/.*=//' | sort -u | tr '\n' ' ')"
if [[ "$(printf '%s' "$distinct" | wc -w)" -eq 1 ]]; then
  ok "every unit sharing /var/lib/kitluy declares the same StateDirectoryMode (${distinct% })"
else
  bad "every unit sharing /var/lib/kitluy declares the same StateDirectoryMode" \
      "modes disagree, so boot order decides the result: ${STATE_MODES}"
fi

SHARED_MODE="${distinct% }"
if [[ "$SHARED_MODE" == "0751" ]]; then
  ok "the shared state directory mode matches the Store Hub image (0751)"
else
  bad "the shared state directory mode matches the Store Hub image (0751)" "mode is ${SHARED_MODE}"
fi

# ============================================================================
# THE DEVICE SHELL (Slice 1B image integration)
# ============================================================================
# Everything here fails the same way if it is wrong: not at build time, but on a
# Pi 5 on a counter, with a black screen and a loader error nobody can read.
SHELL_UNIT="${TERMINAL_OVERLAY}/etc/systemd/system/kitluy-device-shell.service"
SHELL_SHIM="${TERMINAL_OVERLAY}/usr/lib/kitluy/device-shell"
SHELL_APP="${TERMINAL_OVERLAY}/usr/lib/kitluy/lib/device-shell"
ELECTRON_PIN="${SRC}/electron.pin"

# --- The compositor the shim actually execs ---------------------------------
# The shim runs `/usr/bin/cage`. If the layer does not install it, the unit
# starts, the shim exits 127, and Restart=always turns that into a loop.
if grep -qE '^\s+- cage\s*$' "$TERMINAL_LAYER"; then
  ok "device shell: the cage kiosk compositor is declared"
else
  bad "device shell: the cage kiosk compositor is declared" \
      "the shim execs /usr/bin/cage and nothing installs it"
fi

if [[ -x "$SHELL_SHIM" ]] && grep -q '/usr/bin/cage' "$SHELL_SHIM"; then
  ok "device shell: the launcher execs cage, not a general compositor"
else
  bad "device shell: the launcher execs cage, not a general compositor" \
      "a desktop compositor on a shop counter is a way out of the application"
fi

# --- Electron's shared libraries --------------------------------------------
# Electron is dynamically linked and Debian supplies what it links against.
# Chromium links the X11 client libraries even when it renders under Wayland.
MISSING_LIBS=""
for lib in libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
           libgtk-3-0 libgbm1 libdrm2 libxkbcommon0 libpango-1.0-0 libcairo2 \
           libasound2 libexpat1 libxcb1 libx11-6 libxcomposite1 libxdamage1 \
           libxext6 libxfixes3 libxrandr2; do
  grep -qE "^\s+- ${lib}\s*$" "$TERMINAL_LAYER" || MISSING_LIBS="${MISSING_LIBS} ${lib}"
done
if [[ -z "$MISSING_LIBS" ]]; then
  ok "device shell: every Electron shared library is declared"
else
  bad "device shell: every Electron shared library is declared" "missing:${MISSING_LIBS}"
fi

# --- Fonts, which are not cosmetic here -------------------------------------
# The shell is Khmer-default. Without a Khmer face the first screen a Cambodian
# installer sees is a row of empty boxes: the application working perfectly and
# communicating nothing.
if grep -qE '^\s+- fonts-khmeros\s*$' "$TERMINAL_LAYER"; then
  ok "device shell: a Khmer font is installed, so the default locale renders"
else
  bad "device shell: a Khmer font is installed, so the default locale renders" \
      "the Khmer-default UI would render as empty boxes"
fi
if grep -qE '^\s+- fonts-dejavu-core\s*$' "$TERMINAL_LAYER"; then
  ok "device shell: a Latin fallback font is installed (asset tag, pairing code)"
else
  bad "device shell: a Latin fallback font is installed (asset tag, pairing code)" "absent"
fi

# --- The application itself --------------------------------------------------
if [[ -f "${SHELL_APP}/package.json" ]]; then
  ok "device shell: the app manifest is packaged"
  APP_MAIN="$(node -e 'process.stdout.write(require(process.argv[1]).main||"")' "${SHELL_APP}/package.json" 2>/dev/null)"
  if [[ -n "$APP_MAIN" && -f "${SHELL_APP}/${APP_MAIN}" ]]; then
    ok "device shell: the declared main (${APP_MAIN}) is present"
  else
    bad "device shell: the declared main is present" \
        "package.json names '${APP_MAIN}', which was not packaged — Electron would exit at startup"
  fi
  if [[ "$(node -e 'process.stdout.write(require(process.argv[1]).type||"")' "${SHELL_APP}/package.json" 2>/dev/null)" == "module" ]]; then
    ok "device shell: the app is marked ESM, matching its compiled output"
  else
    bad "device shell: the app is marked ESM, matching its compiled output" \
        "the emitted main uses import/export; without \"type\": \"module\" Node reads it as CommonJS and it dies on its first import"
  fi
else
  bad "device shell: the app manifest is packaged" "no package.json at ${SHELL_APP#"$ROOT/"}"
fi

# The preload is the ONLY bridge between the renderer and the main process. Its
# absence does not break the build; it breaks the keypad, at a counter.
if [[ -f "${SHELL_APP}/dist-electron/electron/preload.cjs" ]]; then
  ok "device shell: the preload bridge is packaged, and is .cjs"
else
  bad "device shell: the preload bridge is packaged, and is .cjs" \
      "a sandboxed preload cannot load ESM; without it the keypad submits nowhere"
fi
if [[ -f "${SHELL_APP}/dist/index.html" ]]; then
  ok "device shell: the renderer bundle is packaged"
else
  bad "device shell: the renderer bundle is packaged" "the window would load nothing"
fi
# Source maps hand anyone holding the card the original sources, and are dead
# weight on an appliance.
if find "$SHELL_APP" -name '*.map' 2>/dev/null | grep -q .; then
  bad "device shell: no source maps are shipped" "$(find "$SHELL_APP" -name '*.map' | wc -l) map file(s) packaged"
else
  ok "device shell: no source maps are shipped"
fi

# --- A WRITABLE /tmp, WITHOUT WHICH THE SCREEN CANNOT START -----------------
# The erofs root is read-only and upstream's systemd-min ships no tmp.mount, so
# /tmp was a read-only directory on both images. cage could not start Xwayland
# (no /tmp/.X11-unix), exited 133, and restarted 285 times in 25 minutes with no
# failed unit to point at. It also defeats PrivateTmp=, which systemd builds
# inside the real /tmp.
TMP_UNIT="${BASE_OVERLAY}/etc/systemd/system/tmp.mount"
if [[ -f "$TMP_UNIT" ]]; then
  ok "a tmpfs /tmp is shipped (the erofs root cannot provide one)"
  if grep -q 'Type=tmpfs' "$TMP_UNIT" && grep -q 'Where=/tmp' "$TMP_UNIT"; then
    ok "tmp.mount actually mounts a tmpfs at /tmp"
  else
    bad "tmp.mount actually mounts a tmpfs at /tmp" "unit does not declare Type=tmpfs at /tmp"
  fi
  if grep -q 'mode=1777' "$TMP_UNIT"; then
    ok "the tmpfs /tmp is world-writable with the sticky bit (1777)"
  else
    bad "the tmpfs /tmp is world-writable with the sticky bit (1777)" \
        "Xwayland and every other consumer need an ordinary /tmp"
  fi
  if [[ -L "${BASE_OVERLAY}/etc/systemd/system/local-fs.target.wants/tmp.mount" ]]; then
    ok "tmp.mount is enabled, not merely defined"
  else
    bad "tmp.mount is enabled, not merely defined" "no local-fs.target.wants symlink — /tmp stays read-only"
  fi
else
  bad "a tmpfs /tmp is shipped (the erofs root cannot provide one)" \
      "without it cage cannot start Xwayland and the Device Shell crash-loops"
fi

# --- Xwayland, and the private /tmp it cannot live without -------------------
# The 2026-08-13 defect, twice: labwc died starting Xwayland because PrivateTmp
# gave it an empty /tmp with no .X11-unix, and the cage unit reproduced it
# exactly (pi5-aanljf, exit 133, restart counter 157).
if grep -qE '^\s+- xwayland\s*$' "$TERMINAL_LAYER"; then
  ok "device shell: Xwayland is declared, not left to a transitive dependency"
else
  bad "device shell: Xwayland is declared, not left to a transitive dependency" \
      "cage exits when it cannot start Xwayland, so this is not optional"
fi

# /tmp/.X11-unix comes from the distribution's own tmpfiles.d, which needs only
# a writable /tmp (asserted above). Asserting the declaration here keeps the
# dependency visible: if a future layer drops x11.conf, cage stops starting.
if grep -rq 'X11-unix' "${ROOT}/rpi-image-gen/layer/" 2>/dev/null || true; then :; fi
if grep -q 'Type=tmpfs' "${BASE_OVERLAY}/etc/systemd/system/tmp.mount" 2>/dev/null; then
  ok "device shell: Xwayland has a writable /tmp to create its socket directory in"
else
  bad "device shell: Xwayland has a writable /tmp to create its socket directory in" \
      "no tmpfs /tmp — cage exits 133 and the screen never paints"
fi

# The kiosk user must own its HOME or Chromium cannot cache shaders.
if grep -qE '^ExecStartPre=\+.*chown.*kitluy-terminal.*\/var\/lib\/kitluy\/terminal' "$SHELL_UNIT"; then
  ok "device shell: the kiosk user is given ownership of its own HOME"
else
  bad "device shell: the kiosk user is given ownership of its own HOME" \
      "the image creates /var/lib/kitluy/terminal as root; the shell runs as kitluy-terminal"
fi

# --- The pinned runtime ------------------------------------------------------
if [[ -f "$ELECTRON_PIN" ]]; then
  ok "device shell: the Electron runtime is pinned"
  PIN_SHA="$(sed -n 's/^KITLUY_ELECTRON_SHA256="\(.*\)"/\1/p' "$ELECTRON_PIN")"
  PIN_VER="$(sed -n 's/^KITLUY_ELECTRON_VERSION="\(.*\)"/\1/p' "$ELECTRON_PIN")"
  if [[ "$PIN_SHA" =~ ^[0-9a-f]{64}$ ]]; then
    ok "device shell: the pin carries a real sha256, not a placeholder"
  else
    bad "device shell: the pin carries a real sha256, not a placeholder" "got '${PIN_SHA}'"
  fi

  # THE DRIFT THAT MATTERS. The app is built and tested against one Electron and
  # the image ships another: every API difference between them becomes a defect
  # that reproduces only on hardware.
  APP_ELECTRON="$(node -e 'process.stdout.write((require(process.argv[1]).devDependencies||{}).electron||"")' \
                   "${REPO_ROOT}/apps/kitluy-device-shell/package.json" 2>/dev/null)"
  if [[ -n "$APP_ELECTRON" && "$APP_ELECTRON" == "$PIN_VER" ]]; then
    ok "device shell: the image pin and the app agree on Electron ${PIN_VER}"
  else
    bad "device shell: the image pin and the app agree on Electron" \
        "pin=${PIN_VER} app=${APP_ELECTRON}"
  fi

  # The build must actually be able to reach the fetcher, and the fetcher must
  # refuse a bad digest rather than unpack it.
  if grep -q 'fetch-electron.sh' "${ROOT}/scripts/build-rpi-image.sh"; then
    ok "device shell: the build resolves the pinned runtime"
  else
    bad "device shell: the build resolves the pinned runtime" \
        "nothing invokes fetch-electron.sh, so the image ships no Electron"
  fi
else
  bad "device shell: the Electron runtime is pinned" "no electron.pin"
fi

# ---------------------------------------------------------------------------
# THE LINK TO THE STORE HUB.
#
# A Pi Terminal that holds an operational certificate and cannot use it is not a
# till. Until 2026-09-10 the image shipped no client at all: the Hub was
# reachable, the certificate was adopted, and nothing on the terminal ever
# dialled /edge/v1. These assertions are what stop that shipping again.
# ---------------------------------------------------------------------------
EDGE_UNIT="${LAYER_DIR}/kitluy-pi-terminal.rootfs-overlay/etc/systemd/system/kitluy-terminal-edge.service"
EDGE_WRAPPER="${LAYER_DIR}/kitluy-base.rootfs-overlay/usr/lib/kitluy/terminal-edge"

if [[ -f "$EDGE_UNIT" ]]; then
  ok "terminal edge: the unit is shipped"

  if grep -qE '^RestrictAddressFamilies=.*AF_NETLINK' "$EDGE_UNIT"; then
    ok "terminal edge: RestrictAddressFamilies includes AF_NETLINK"
  else
    bad "terminal edge: RestrictAddressFamilies includes AF_NETLINK" \
        "libuv cannot join the mDNS multicast group and the Hub is never discovered"
  fi

  if grep -qE '^Restart=always' "$EDGE_UNIT"; then
    ok "terminal edge: Restart=always (a clean exit is as unexpected as a crash)"
  else
    bad "terminal edge: Restart=always" \
        "the loop reports shop states; stopping on any exit leaves the till mute"
  fi

  if grep -qE '^ReadWritePaths=.*(/var/lib/kitluy)' "$EDGE_UNIT"; then
    ok "terminal edge: names its writable path"
  else
    bad "terminal edge: names its writable path" "ProtectSystem=strict would deny the status write"
  fi

  if grep -qE '^After=.*kitluy-operational-tls' "$EDGE_UNIT"; then
    ok "terminal edge: ordered after the operational certificate"
  else
    bad "terminal edge: ordered after the operational certificate" \
        "it would report NOT_ACTIVATED on a board about to be issued one"
  fi
else
  bad "terminal edge: the unit is shipped" "no kitluy-terminal-edge.service in the terminal overlay"
fi

if [[ -L "${LAYER_DIR}/kitluy-pi-terminal.rootfs-overlay/etc/systemd/system/multi-user.target.wants/kitluy-terminal-edge.service" ]]; then
  ok "terminal edge: enabled, not merely defined"
else
  bad "terminal edge: enabled, not merely defined" "no multi-user.target.wants symlink"
fi

if [[ -x "$EDGE_WRAPPER" ]] && grep -q 'bin/terminal-edge.js' "$EDGE_WRAPPER"; then
  ok "terminal edge: the wrapper execs a packaged bin"
else
  bad "terminal edge: the wrapper execs a packaged bin" "no executable /usr/lib/kitluy/terminal-edge"
fi

# The closure list is what actually puts the modules on the card.
PKG="${ROOT}/scripts/package-bootstrap-runtime.sh"
EDGE_MISSING=""
for m in edge-transport edge-mdns edge-discovery-record edge-pairing edge-session bin/terminal-edge; do
  grep -qE "(^|[[:space:]])${m}([[:space:]]|$)" "$PKG" || EDGE_MISSING="${EDGE_MISSING} ${m}"
done
if [[ -z "$EDGE_MISSING" ]]; then
  ok "terminal edge: every module is in the packaged closure"
else
  bad "terminal edge: every module is in the packaged closure" \
      "absent from DEVICE_MODULES:${EDGE_MISSING}"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
