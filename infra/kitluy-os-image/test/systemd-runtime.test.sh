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

# A unit that claims tty1 must displace getty, be enabled in the overlay that
# defines it, and have a satisfiable ConditionPathExists.
for overlay_unit in "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                    "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service; do
  [[ -f "$overlay_unit" ]] || continue
  grep -q 'TTYPath=/dev/tty1' "$overlay_unit" || continue
  name="$(basename "$overlay_unit")"
  overlay_root="${overlay_unit%/etc/systemd/system/*}"

  if grep -q 'Conflicts=.*getty@tty1' "$overlay_unit"; then
    ok "${name}: conflicts with getty@tty1"
  else
    bad "${name}: conflicts with getty@tty1" "claims tty1 without displacing getty"
  fi

  if [[ -L "${overlay_root}/etc/systemd/system/multi-user.target.wants/${name}" || -e "${overlay_root}/etc/systemd/system/multi-user.target.wants/${name}" ]]; then
    ok "${name}: enabled in the overlay that defines it"
  else
    bad "${name}: enabled in the overlay that defines it" \
        "defines a tty1 console the image never enables — getty keeps tty1"
  fi

  guard="$(grep -oE '^ConditionPathExists=.*' "$overlay_unit" | cut -d= -f2-)"
  if [[ -n "$guard" ]]; then
    if [[ -e "${overlay_root}${guard}" ]]; then
      ok "${name}: its ConditionPathExists target is shipped"
    else
      bad "${name}: its ConditionPathExists target is shipped" \
          "guard ${guard} is absent, so the unit is skipped and getty keeps tty1"
    fi
  fi
done

# Exactly ONE unit owns tty1, and it is the one the manifest names.
TTY1_OWNERS="$(grep -l 'TTYPath=/dev/tty1' "${BASE_OVERLAY}"/etc/systemd/system/kitluy-*.service \
                       "${TERMINAL_OVERLAY}"/etc/systemd/system/kitluy-*.service 2>/dev/null | xargs -r -n1 basename)"
MANIFEST_OWNER="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((m.tty1&&m.tty1.owner)||"")' "$MANIFEST" 2>/dev/null)"
enabled_tty1=""
for u in $TTY1_OWNERS; do
  for overlay in "$BASE_OVERLAY" "$TERMINAL_OVERLAY"; do
    [[ -L "${overlay}/etc/systemd/system/multi-user.target.wants/${u}" || -e "${overlay}/etc/systemd/system/multi-user.target.wants/${u}" ]] && enabled_tty1="${enabled_tty1} ${u}"
  done
done
enabled_tty1="${enabled_tty1# }"
if [[ "$enabled_tty1" == "$MANIFEST_OWNER" && -n "$MANIFEST_OWNER" ]]; then
  ok "exactly one enabled unit owns tty1, and the manifest names it (${MANIFEST_OWNER})"
else
  bad "exactly one enabled unit owns tty1, and the manifest names it" \
      "manifest owner='${MANIFEST_OWNER}' enabled tty1 units='${enabled_tty1}'"
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

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
