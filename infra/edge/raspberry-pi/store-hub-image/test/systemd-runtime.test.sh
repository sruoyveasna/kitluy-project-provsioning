#!/usr/bin/env bash
# KitLuy OS image — systemd runtime integrity gates.
#
# WHY THIS FILE EXISTS
# --------------------
# `build-gates.test.sh` reported 34/34 PASS against an image in which EVERY
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
# Run: bash infra/edge/raspberry-pi/store-hub-image/test/systemd-runtime.test.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${ROOT}/scripts/build-image.sh"
LAYER_DIR="${ROOT}/rpi-image-gen/layer"
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

printf '\nKitLuy OS image — systemd runtime integrity\n\n'

for profile in store-hub; do
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
for profile in store-hub; do
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
    # tree must contain it — that is the v2.7.0 defect this file was written for
    # and the check stays exactly as strict.
    #
    # A program from a Debian package (ssh-keygen, from openssh-server) can
    # never appear in the staged tree, because --stage-only installs no
    # packages. Asserting its presence there would fail an image that is
    # correct. What IS checkable, and is the property that actually matters, is
    # that some layer declares the providing package so mmdebstrap installs it
    # into the real rootfs. An undeclared package is the same class of bug —
    # an enabled unit whose program is absent — caught at the right layer.
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
#
#     systemd FAILS a unit whose EnvironmentFile is missing (unless the path is
#     prefixed with `-`). /etc/kitluy/image.env was written only by the staged
#     build path, so on the real .img every unit referencing it would have
#     failed at first boot — a defect no previous gate could see.
# ---------------------------------------------------------------------------
for profile in store-hub; do
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
#
#    This is the positive statement of the same invariant: the golden image
#    carries the unit so the release package need not invent one, and creates
#    no .wants symlink so nothing restart-loops before the binary arrives.
# ---------------------------------------------------------------------------
#    `kitluy-hub-agent.service` was here until BRINGUP-003 and no longer is: the
#    agent is packaged into the image now, so its unit is DEFINED AND ENABLED
#    like any other component, and asserting it stays disabled would fail the
#    image for shipping the Hub. `test/image-contents.test.sh` checks the unit,
#    the binary and the enablement against `runtime-manifest.json` instead.
#
#    `kitluy-hub-discovery.service` remains governed: no
#    `/usr/lib/kitluy/hub-discovery-advertise` exists anywhere, and the avahi
#    advert is served statically by avahi-daemon from a file in the overlay.
declare -A GOVERNED=(
  [store-hub]="kitluy-hub-discovery.service"
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
# 3. `%i` is meaningless outside a template unit.
# ---------------------------------------------------------------------------
for profile in store-hub; do
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

# The canonical overlay is the source for the real .img, so it is checked too.
for overlay_unit in "${LAYER_DIR}"/*.rootfs-overlay/etc/systemd/system/kitluy-*.service; do
  [[ -e "$overlay_unit" ]] || continue
  name="$(basename "$overlay_unit")"
  if grep -qE '^User=.*%i' "$overlay_unit"; then
    bad "canonical ${name}: no User=%i in a non-template unit" "specifier expands to empty"
  else
    ok "canonical ${name}: no User=%i in a non-template unit"
  fi
done

# ---------------------------------------------------------------------------
# 4. Hardening must be present on every canonical KitLuy unit, and identical
#    between build paths because there is now only ONE definition of each.
# ---------------------------------------------------------------------------
for overlay_unit in "${LAYER_DIR}"/*.rootfs-overlay/etc/systemd/system/kitluy-*.service; do
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
for profile in store-hub; do
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
#    byte-identical unit definitions. Divergence here is what shipped v2.7.0.
# ---------------------------------------------------------------------------
for overlay_unit in "${LAYER_DIR}"/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-*.service \
                    "${LAYER_DIR}"/kitluy-store-hub.rootfs-overlay/etc/systemd/system/kitluy-*.service; do
  [[ -e "$overlay_unit" ]] || continue
  name="$(basename "$overlay_unit")"
  staged="${TMP}/store-hub/rootfs/etc/systemd/system/${name}"
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
for profile in store-hub; do
  root="${TMP}/${profile}/rootfs"
  for d in var/lib/kitluy etc/kitluy usr/lib/kitluy; do
    [[ -d "${root}/${d}" ]] && ok "${profile}: runtime directory /${d} exists" \
                            || bad "${profile}: runtime directory /${d} exists" "absent"
  done
done

# ---------------------------------------------------------------------------
# 8. Clone hygiene: no per-device state may be pre-populated.
# ---------------------------------------------------------------------------
for profile in store-hub; do
  root="${TMP}/${profile}/rootfs"
  for forbidden in var/lib/kitluy/identity/identity.json \
                   var/lib/kitluy/identity/device-identity.key.pem \
                   var/lib/kitluy/bootstrap-state.json \
                   var/lib/kitluy/enrollment/ticket \
                   var/lib/kitluy/terminal/assignment.json \
                   var/lib/kitluy/terminal/hub-endpoint.json; do
    if [[ -e "${root}/${forbidden}" ]]; then
      bad "${profile}: /${forbidden} is NOT pre-populated" "golden image carries per-device state"
    else
      ok "${profile}: /${forbidden} is NOT pre-populated"
    fi
  done
done

# ---------------------------------------------------------------------------
# 9. TTY1 OWNERSHIP IS DECIDED, NOT CONTESTED.
# ---------------------------------------------------------------------------
# An operator must never meet `login:` as the product. The KitLuy console unit
# declares `Conflicts=getty@tty1.service`, and that alone is NOT sufficient —
# three mechanisms were verified in a built artifact that each put a login
# prompt back on tty1:
#
#   1. Debian's preset leaves `getty@tty1.service` enabled in
#      `getty.target.wants/`, so getty and the console are both wanted and race.
#      Conflicts= is documented as orthogonal to ordering.
#   2. `systemd-logind` autospawns `autovt@ttyN.service`, and `autovt@.service`
#      is a SYMLINK to `getty@.service` — the same program under a different
#      unit name, which `Conflicts=getty@tty1.service` does not match.
#   3. The console uses `Restart=always`, reopening that window on every restart.
#
# These assertions are on the LAYER RECIPE rather than a built artifact, because
# the recipe is what a rebuild reproduces.
for layer in "${LAYER_DIR}"/kitluy-hub-base.yaml; do
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
        "logind will start autovt@tty1 (an alias of getty@), which Conflicts= cannot prevent"
  fi

  # MAINTENANCE MUST SURVIVE. Removing getty from tty1 without providing another
  # authenticated console would make a device unrecoverable, which is a worse
  # failure than the login prompt this fixes.
  if grep -q 'getty.target.wants/getty@tty2.service' "$layer"; then
    ok "${name}: an authenticated maintenance console remains on tty2"
  else
    bad "${name}: an authenticated maintenance console remains on tty2" \
        "tty1 taken with no maintenance TTY left — the device becomes unrecoverable"
  fi

  # The fix must not become an autologin shortcut.
  if grep -qE 'autologin|--autologin|ExecStart=.*agetty.*-a ' "$layer"; then
    bad "${name}: no autologin shortcut" "an appliance must not auto-login a shell"
  else
    ok "${name}: no autologin shortcut"
  fi
done

# Every KitLuy unit that claims tty1 must ALSO conflict with the autovt alias.
for overlay_unit in "${LAYER_DIR}"/*.rootfs-overlay/etc/systemd/system/kitluy-*.service; do
  [[ -f "$overlay_unit" ]] || continue
  grep -q 'TTYPath=/dev/tty1' "$overlay_unit" || continue
  name="$(basename "$overlay_unit")"
  if grep -q 'Conflicts=.*getty@tty1' "$overlay_unit"; then
    ok "${name}: conflicts with getty@tty1"
  else
    bad "${name}: conflicts with getty@tty1" "claims tty1 without displacing getty"
  fi
done

# ============================================================================
# NETWORK CONTRACT (owner decision 2026-08-24 §4, §5, §7, §8)
# ============================================================================
# Asserted on the LAYER RECIPE, for the reason recorded above: these are
# properties of what the build will produce, and they are checkable without an
# ARM64 builder or a board. Nothing here claims a booted device.
HUB_LAYER="${LAYER_DIR}/kitluy-hub-base.yaml"
WIFI_SLOT_SHARED="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/rpi-image-gen/slot-shared.d/61-kitluy-wifi.conf"
CONSOLE_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-hub-pairing.service"

# The capability that was missing entirely: nothing on the image could associate
# with an access point, so `02-wlan0.network` had always been unreachable.
if grep -qE '^\s+- wpasupplicant\s*$' "$HUB_LAYER"; then
  ok "wifi: wpa_supplicant is installed"
else
  bad "wifi: wpa_supplicant is installed" "wlan0 can take a DHCP lease but can never associate"
fi

# The owner rejected NetworkManager for this milestone: systemd-networkd is the
# active activator and Ethernet DHCP already works.
if grep -qE '^\s+- network-manager\s*$' "$HUB_LAYER"; then
  bad "wifi: NetworkManager is NOT installed" "the network activator must stay systemd-networkd"
else
  ok "wifi: NetworkManager is NOT installed"
fi

# Ethernet preferred, deterministically, in the routing table — not by a program
# that has to be running to have an opinion.
if grep -q 'RouteMetric=100' "$HUB_LAYER" && grep -q 'RouteMetric=600' "$HUB_LAYER"; then
  ok "network: Ethernet outranks Wi-Fi by route metric"
else
  bad "network: Ethernet outranks Wi-Fi by route metric" \
      "with both links up the default route would be whichever lease landed last"
fi

# Without this a wired-only Hub waits out systemd-networkd-wait-online's timeout
# on EVERY boot, because wlan0 never becomes routable.
if grep -q 'RequiredForOnline=no' "$HUB_LAYER"; then
  ok "network: an unconfigured wlan0 does not hold up boot"
else
  bad "network: an unconfigured wlan0 does not hold up boot" "wait-online will block on wlan0"
fi

# The credential store must survive EROFS and an A/B update.
if [[ -f "$WIFI_SLOT_SHARED" ]] && grep -q '^Path=/etc/wpa_supplicant$' "$WIFI_SLOT_SHARED"; then
  ok "wifi: the credential store is slot-shared"
else
  bad "wifi: the credential store is slot-shared" \
      "/etc is EROFS at runtime; per-slot would also lose the shop's Wi-Fi on every update"
fi

# ProtectSystem=strict would otherwise let the console scan, prompt, accept a
# password and only then fail to save it.
if grep -q '^ReadWritePaths=/etc/wpa_supplicant$' "$CONSOLE_UNIT"; then
  ok "wifi: the console may write the credential store"
else
  bad "wifi: the console may write the credential store" "the network screen could not save anything"
fi

# ZERO SECRET. The seeded configuration exists so wpa_cli can reach the daemon
# and must never carry a network block.
if grep -q 'ctrl_interface=/run/wpa_supplicant' "$HUB_LAYER" && \
   ! grep -qE '^\s+psk=' "$HUB_LAYER"; then
  ok "wifi: the seeded configuration carries no secret"
else
  bad "wifi: the seeded configuration carries no secret" "a PSK must never be baked into a golden image"
fi

# ============================================================================
# TIMEZONE (owner decision 2026-08-24 §3, §9)
# ============================================================================
# The built artifact carried /etc/localtime -> Europe/London while image.env
# advertised Asia/Phnom_Penh and no code read it.
if grep -q 'ln -sf "/usr/share/zoneinfo/\$TZ" "\$1/etc/localtime"' "$HUB_LAYER"; then
  ok "timezone: the appliance clock is set at build time"
else
  bad "timezone: the appliance clock is set at build time" "the image would ship the Debian default"
fi

if grep -q 'IGconf_kitluy_timezone:-Asia/Phnom_Penh' "$HUB_LAYER"; then
  ok "timezone: defaults to Asia/Phnom_Penh with no installer step"
else
  bad "timezone: defaults to Asia/Phnom_Penh with no installer step" "the default must not be Debian's"
fi

# There must be no timezone-, language-, Store- or Location-selection step. The
# Store Location owns all of it and the pairing session resolves it.
CONSOLE_SRC="${ROOT}/../../../../services/kitluy-device-firstboot-agent/src/bin"
for forbidden in 'Select.*timezone' 'Choose.*language' 'Which Store' 'Select.*Location'; do
  if grep -rqiE "$forbidden" "$CONSOLE_SRC" 2>/dev/null; then
    bad "console: no selection step for '${forbidden}'" "the Store Location is resolved by the pairing session"
  else
    ok "console: no selection step for '${forbidden}'"
  fi
done

# ---------------------------------------------------------------------------
# THE OPERATIONAL TLS STAGE (2026-08-29).
#
# The Hub's operational identity. These assertions are about what the IMAGE
# contains and how the stage is ordered — the behaviour itself is proven by the
# firstboot agent's own 69 tests and the end-to-end suite.
# ---------------------------------------------------------------------------
OPTLS_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-operational-tls.service"
OPTLS_LIB="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/lib/firstboot-agent"
OPTLS_SHIM="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/operational-tls"

if [[ -x "$OPTLS_SHIM" ]]; then
  ok "operational-tls: the shim exists and is executable"
else
  bad "operational-tls: the shim exists and is executable" "no /usr/lib/kitluy/operational-tls"
fi

# The whole closure, or the unit dies at its first import on a real device.
for m in operational-key operational-csr-bytes operational-credential-state \
         operational-certificate-verification operational-tls-client \
         adapters/http-operational-certificate-client bin/operational-tls; do
  if [[ -f "${OPTLS_LIB}/${m}.js" ]]; then
    ok "operational-tls: ${m}.js is packaged"
  else
    bad "operational-tls: ${m}.js is packaged" "absent from the device closure"
  fi
done

# ZERO RUNTIME DEPENDENCIES. node-forge is a TEST-only dependency used to mint
# hostile fixtures; `node:crypto` verifies X.509 even though it cannot issue it.
if grep -rqE '(import|require)[^\n]*"node-forge"' "$OPTLS_LIB" 2>/dev/null; then
  bad "operational-tls: node-forge is not in the image" "a runtime dependency reached the device"
else
  ok "operational-tls: node-forge is not in the image"
fi
if grep -rhoE 'from "[^."][^"]*"' "$OPTLS_LIB" 2>/dev/null | grep -qv '"node:'; then
  bad "operational-tls: every packaged import is a node: builtin" "a non-builtin import is present"
else
  ok "operational-tls: every packaged import is a node: builtin"
fi

# THE LIFECYCLE ORDER IS NOT COLLAPSED. A certificate is a statement about a
# device that belongs to a Store, so this stage runs After= pairing — and is
# NOT Requires= pairing, because the pairing console is an interactive screen
# whose exit says nothing about whether the Hub is paired.
if grep -qE '^After=.*kitluy-hub-pairing\.service' "$OPTLS_UNIT"; then
  ok "operational-tls: ordered after Store pairing"
else
  bad "operational-tls: ordered after Store pairing" "the lifecycle order is collapsed"
fi
if grep -qE '^Requires=.*kitluy-hub-pairing' "$OPTLS_UNIT"; then
  bad "operational-tls: does not Requires= the pairing console" "the console exiting would stop this unit"
else
  ok "operational-tls: does not Requires= the pairing console"
fi
# THE STORE HUB DATABASE UNIT MUST CREATE ITS OWN SOCKET DIRECTORY.
#
# Two beliefs about /run/postgresql each took the whole Hub down on hardware,
# and both are asserted against here.
#
# 2026-09-04: listing /run/postgresql in ReadWritePaths made systemd bind-mount
# it, and the provision script's chmod of a mount root returned EPERM.
#
# 2026-09-10: with the bind-mount gone, nothing created the directory at all.
# postgresql-common's tmpfiles rule does not run on a read-only erofs root
# (systemd-tmpfiles-setup.service is condition-skipped), and the script's
# `install -d -m 2775` fallback is blocked by RestrictSUIDSGID=yes because 2775
# carries the setgid bit — so the database never started and the agent refused
# with KLUY-HUB-DB-UNREACHABLE.
#
# RuntimeDirectory= satisfies both: PID 1 creates it with the setgid mode before
# the sandbox exists, and no bind-mount of an existing path is involved.
DB_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-hub-database.service"
if [ -f "$DB_UNIT" ]; then
  if grep -qE '^ReadWritePaths=.*(/run/postgresql)' "$DB_UNIT"; then
    bad "hub database: /run/postgresql is NOT in ReadWritePaths" \
        "bind-mounting the socket dir makes the provision chmod fail EPERM"
  else
    ok "hub database: /run/postgresql is not in ReadWritePaths (no bind-mount of the socket dir)"
  fi

  if grep -qE '^RuntimeDirectory=postgresql$' "$DB_UNIT"; then
    ok "hub database: declares RuntimeDirectory=postgresql"
  else
    bad "hub database: declares RuntimeDirectory=postgresql" \
        "nothing else creates /run/postgresql on a read-only erofs root; the cluster cannot open a socket"
  fi

  if grep -qE '^RuntimeDirectoryMode=2775$' "$DB_UNIT"; then
    ok "hub database: RuntimeDirectoryMode=2775 (setgid, applied by the manager)"
  else
    bad "hub database: RuntimeDirectoryMode=2775" \
        "postgres needs group-write on the socket dir, and the payload cannot set setgid under RestrictSUIDSGID"
  fi

  if grep -qE '^RuntimeDirectoryPreserve=yes$' "$DB_UNIT"; then
    ok "hub database: RuntimeDirectoryPreserve=yes (a unit restart keeps the live socket)"
  else
    bad "hub database: RuntimeDirectoryPreserve=yes" \
        "restarting the unit would delete /run/postgresql while postgres is still running"
  fi

  if grep -qE '^Group=postgres$' "$DB_UNIT"; then
    ok "hub database: Group=postgres (the manager chowns the runtime dir root:postgres)"
  else
    bad "hub database: Group=postgres" \
        "without it the runtime dir is root:root and postgres cannot create the socket"
  fi

  DB_PROVISION="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-database-provision"
  if [ -f "$DB_PROVISION" ]; then
    if grep -qE 'install -d[^\n]*-m 0755[^\n]*SOCKET_DIR' "$DB_PROVISION"; then
      bad "hub database: the socket dir is created idempotently, never force-chmod'd" \
          "install -d -m 0755 on an existing /run/postgresql fails EPERM inside the unit namespace"
    else
      ok "hub database: the socket dir is created only when absent, never force-chmod'd"
    fi
    if grep -qE 'install -d[^\n]*-m [0-7]?[1-7][0-7]{3}[^\n]*SOCKET_DIR' "$DB_PROVISION"; then
      bad "hub database: the fallback socket dir carries no setgid/setuid bit" \
          "RestrictSUIDSGID=yes blocks mkdir with S_ISGID, so install -d -m 2775 creates nothing"
    else
      ok "hub database: the fallback socket dir carries no setgid/setuid bit"
    fi
  fi
fi

# THE HUB AGENT NEEDS AF_NETLINK.
#
# libuv enumerates local interfaces through a netlink socket. Without the family
# Node dies at startup with "uv_interface_addresses returned Unknown system
# error 97" before the agent can resolve its own bind host (hardware,
# 2026-09-10). Netlink reaches the local kernel only; it is not a route off the
# device.
AGENT_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-hub-agent.service"
if [ -f "$AGENT_UNIT" ]; then
  if grep -qE '^RestrictAddressFamilies=.*AF_NETLINK' "$AGENT_UNIT"; then
    ok "hub agent: RestrictAddressFamilies includes AF_NETLINK"
  else
    bad "hub agent: RestrictAddressFamilies includes AF_NETLINK" \
        "libuv cannot enumerate interfaces and the agent exits before serving"
  fi
fi

# THE HUB DSN MUST NAME THE OS USER THE AGENT RUNS AS.
#
# The cluster is initdb'd --auth=peer, which demands a database role named after
# the connecting uid. kitluy-hub-agent.service runs as root, so a DSN saying
# `postgres` is refused "Peer authentication failed" — and that refusal is
# swallowed into KLUY-HUB-DB-UNREACHABLE, which reads as a storage or migration
# fault and is neither (hardware, 2026-09-10).
HUB_LAYER_YAML="${LAYER_DIR}/kitluy-store-hub.yaml"
if [ -f "$HUB_LAYER_YAML" ]; then
  DSN_LINE="$(grep -E '^[[:space:]]*KITLUY_HUB_DB_URL=' "$HUB_LAYER_YAML" | head -1)"
  AGENT_USER="$(grep -E '^User=' "$AGENT_UNIT" 2>/dev/null | head -1 | cut -d= -f2)"
  case "$DSN_LINE" in
    *"://${AGENT_USER}@"*)
      ok "hub agent: the DSN connects as '${AGENT_USER}', the uid peer auth will see" ;;
    *)
      bad "hub agent: the DSN connects as the unit's own User= ('${AGENT_USER}')" \
          "peer auth refuses any other role name and the Hub reports KLUY-HUB-DB-UNREACHABLE" ;;
  esac
  case "$DSN_LINE" in
    *localhost*|*127.0.0.1*)
      ok "hub agent: the DSN keeps the load-bearing localhost literal" ;;
    *)
      bad "hub agent: the DSN keeps the load-bearing localhost literal" \
          "hubDatabaseUrl() refuses a DSN without localhost/127.0.0.1 (KL-INF-P1-037)" ;;
  esac
fi

if grep -qE '^ReadWritePaths=/var/lib/kitluy' "$OPTLS_UNIT"; then
  ok "operational-tls: names its writable path"
else
  bad "operational-tls: names its writable path" "ProtectSystem=strict would deny every write"
fi

# THE RUNTIME DIRECTORY MUST BE CREATED AT BUILD TIME. systemd refuses a unit
# whose ReadWritePaths does not exist (226/NAMESPACE, before ExecStart) — which
# is exactly how three agents crash-looped from the first real Pi boot.
# The SHARED parent's mode is not this unit's to decide. `/var/lib/kitluy` is
# used by five units; a StateDirectory that re-modes it makes the result depend
# on start order.
#
# This checked `StateDirectoryMode=0750` on THIS unit alone, which could not see
# the actual hazard: kitluy-firstboot.service declared the same StateDirectory
# with 0700, so the units never agreed and the winner WAS start order. The
# agreement is asserted across all of them below; here it only has to be set.
if grep -qE '^StateDirectory=kitluy$' "$OPTLS_UNIT" && grep -qE '^StateDirectoryMode=' "$OPTLS_UNIT"; then
  ok "operational-tls: shares /var/lib/kitluy on the sibling convention"
else
  bad "operational-tls: shares /var/lib/kitluy on the sibling convention" "it would re-mode a directory four other units share"
fi

if grep -q 'install -d -m 0700 "$1/var/lib/kitluy/operational"' "$HUB_LAYER"; then
  ok "operational-tls: /var/lib/kitluy/operational is created 0700 at build time"
else
  bad "operational-tls: /var/lib/kitluy/operational is created 0700 at build time" "the unit could never start"
fi

# AND IT MUST BE EMPTY. A golden image carrying an operational key would give
# every Hub flashed from it the same identity.
for forbidden in operational-tls.key.pem operational-tls.crt.pem operational-tls.chain.pem \
                 operational-credential.json issuance-request.json; do
  if find "${LAYER_DIR}" -name "$forbidden" -print -quit 2>/dev/null | grep -q .; then
    bad "operational-tls: no ${forbidden} in the image" "device identity material is in the overlay"
  else
    ok "operational-tls: no ${forbidden} in the image"
  fi
done

# EVERY UNIT SHARING /var/lib/kitluy MUST AGREE ON ITS MODE, AND IT MUST BE
# TRAVERSABLE.
#
# systemd re-applies StateDirectoryMode on each start, so when units disagree the
# last one to start wins and the directory's mode depends on boot ordering. They
# did disagree: five units said 0750 and kitluy-firstboot said 0700.
#
# Neither value works. PostgreSQL runs as `postgres`, its cluster lives on the
# encrypted volume under /var/lib/kitluy/hub, and reaching it means TRAVERSING
# /var/lib/kitluy — which `postgres` neither owns nor shares a group with. Both
# modes omit the final execute bit, so initdb failed with "could not access
# directory ... Permission denied" on a directory it owned. That cost a hardware
# bring-up cycle to diagnose, because the message names the leaf, not the
# grandparent that actually denied it.
#
# 0751 grants TRAVERSAL ONLY: no read bit, so /var/lib/kitluy still cannot be
# listed, and identity/ and operational/ remain 0700.
STATE_MODES=""
for unit_file in "${LAYER_DIR}"/*.rootfs-overlay/etc/systemd/system/kitluy-*.service; do
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

# The last octal digit must include the execute bit, or postgres cannot pass
# through. Odd digits (1,3,5,7) are exactly those with the x bit set.
SHARED_MODE="${distinct% }"
if [[ "${SHARED_MODE: -1}" =~ ^[1357]$ ]]; then
  ok "the shared state directory is traversable by postgres (mode ends in an execute bit)"
else
  bad "the shared state directory is traversable by postgres (mode ends in an execute bit)" \
      "mode ${SHARED_MODE} denies traversal to others; initdb cannot reach a cluster it owns"
fi

# THE HUB LAN AGENT IS NOW PACKAGED — this gate is inverted deliberately.
#
# It used to read "hub LAN agent remains unpackaged", and it was correct while
# the agent was out of scope. Leaving it that way would have made the assertion
# that the Hub is absent outlive the decision to ship it, and the suite would
# then fail for doing the right thing.
#
# What replaces it is the stronger statement: the unit and the executable exist
# TOGETHER. A unit without a binary is D-27; a binary without a unit never runs.
HUB_AGENT_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-hub-agent.service"
HUB_AGENT_SHIM="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-agent"
if [[ -f "$HUB_AGENT_UNIT" && -x "$HUB_AGENT_SHIM" ]]; then
  ok "hub LAN agent is packaged: unit and executable both present"
else
  bad "hub LAN agent is packaged: unit and executable both present" \
      "unit=$([[ -f "$HUB_AGENT_UNIT" ]] && echo yes || echo NO) exec=$([[ -x "$HUB_AGENT_SHIM" ]] && echo yes || echo NO)"
fi

# `Requires=postgresql.service` is the one mistake the legacy profile's version
# of this unit made, and it could never have worked: postgresql.service is masked
# to /dev/null in this overlay, and a Requires= on a masked unit fails the job.
if [[ -f "$HUB_AGENT_UNIT" ]] && grep -q '^Requires=.*postgresql\.service' "$HUB_AGENT_UNIT"; then
  bad "hub agent depends on the Hub database, not the masked postgresql.service" \
      "Requires=postgresql.service — that unit is masked, so the job fails"
else
  ok "hub agent depends on the Hub database, not the masked postgresql.service"
fi

# Restart=always on a unit that exits 0 by design is exactly how D-27 hid for a
# week: the unit cycles in `activating` and never appears in `systemctl --failed`.
if [[ -f "$HUB_AGENT_UNIT" ]] && grep -q '^Restart=always' "$HUB_AGENT_UNIT"; then
  bad "hub agent does not restart-loop on a configured refusal" \
      "Restart=always, but the agent exits 0 when it decides not to serve"
else
  ok "hub agent does not restart-loop on a configured refusal"
fi

# THE FLASH-TIME TICKET AGENT STAYS OUT OF THE HUB IMAGE — plan §5.3, enforced
# after it burned a real board (2026-08-31). The ticket path's identity includes
# the SD card, so a Hub re-flashed onto a new card enrolled as a SECOND device
# with the same board evidence; the duplicate-evidence tripwire then quarantined
# the new record AND put the board's real record into restricted_investigation,
# and the pairing console refused a correct code with a message blaming the
# network. A Store Hub's ONE identity path is cloud registration, which resolves
# the board from mac/board/soc and deliberately ignores storage.
#
# Both the unit and its enablement are checked: v2.7.0 taught this suite that a
# unit file and a wants symlink are separate facts.
for hub_overlay in "${LAYER_DIR}/kitluy-hub-base.rootfs-overlay" "${LAYER_DIR}/kitluy-store-hub.rootfs-overlay"; do
  [[ -d "$hub_overlay" ]] || continue
  if find "$hub_overlay/etc/systemd/system" -name 'kitluy-enrollment-agent.service' -print -quit 2>/dev/null | grep -q .; then
    bad "ticket enrollment agent stays out of the Hub image ($(basename "$hub_overlay"))" \
        "a new SD card would mint a second device identity for the same board"
  else
    ok "ticket enrollment agent stays out of the Hub image ($(basename "$hub_overlay"))"
  fi
done

# --- A WRITABLE /tmp, WITHOUT WHICH THE SCREEN CANNOT START -----------------
# The erofs root is read-only and upstream's systemd-min ships no tmp.mount, so
# /tmp was a read-only directory on both images. cage could not start Xwayland
# (no /tmp/.X11-unix), exited 133, and restarted 285 times in 25 minutes with no
# failed unit to point at. It also defeats PrivateTmp=, which systemd builds
# inside the real /tmp.
TMP_UNIT="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/tmp.mount"
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
  if [[ -L "${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system/local-fs.target.wants/tmp.mount" ]]; then
    ok "tmp.mount is enabled, not merely defined"
  else
    bad "tmp.mount is enabled, not merely defined" "no local-fs.target.wants symlink — /tmp stays read-only"
  fi
else
  bad "a tmpfs /tmp is shipped (the erofs root cannot provide one)" \
      "without it cage cannot start Xwayland and the Device Shell crash-loops"
fi

# --- A MOUNT THAT WAITS FOR A SERVICE IS NOT A LOCAL FILE SYSTEM ---------------
# Hardware 2026-09-16 (handoff 46 §5). With default dependencies a mount unit is
# ordered Before=local-fs.target. var-lib-kitluy-hub.mount also waited for
# kitluy-hub-storage.service, an ordinary service that runs after sysinit.target,
# which itself waits for local-fs.target. systemd broke the cycle at every boot
# by deleting the start jobs of systemd-timesyncd, systemd-tmpfiles-setup and
# local-fs.target: the Hub never synchronised its clock and sat a day behind,
# which is how certificates come to look not-yet-valid.
#
# The rule, for every overlay mount: ordered after (or requiring) a service means
# DefaultDependencies=no, and then unmounting at shutdown must be restored by
# hand. image-contents.test.sh asks systemd-analyze the same question of a built
# rootfs.
OVERLAY_UNITS="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/etc/systemd/system"
SERVICE_ORDERED_MOUNTS=0
for mount_unit in "${OVERLAY_UNITS}"/*.mount; do
  [[ -f "$mount_unit" ]] || continue
  mount_name="$(basename "$mount_unit")"
  waits_for="$(grep -hE '^(After|Requires|BindsTo)=' "$mount_unit" | cut -d= -f2- | tr ' ' '\n' \
               | grep -E '\.service$' | sort -u | tr '\n' ' ')"
  [[ -n "$waits_for" ]] || continue
  SERVICE_ORDERED_MOUNTS=$((SERVICE_ORDERED_MOUNTS + 1))
  if grep -qE '^DefaultDependencies=no[[:space:]]*$' "$mount_unit"; then
    ok "${mount_name} waits for ${waits_for% } and so is not ordered before local-fs.target"
  else
    bad "${mount_name} waits for ${waits_for% } and so is not ordered before local-fs.target" \
        "without DefaultDependencies=no it is implicitly Before=local-fs.target: an ordering cycle through sysinit.target"
  fi
  if grep -qE '^Conflicts=.*\bumount\.target\b' "$mount_unit" \
     && grep -qE '^Before=.*\bumount\.target\b' "$mount_unit"; then
    ok "${mount_name} still unmounts at shutdown (Conflicts= and Before=umount.target)"
  else
    bad "${mount_name} still unmounts at shutdown (Conflicts= and Before=umount.target)" \
        "DefaultDependencies=no drops these; the volume would stay mounted while the LUKS device closes"
  fi
done
if [[ $SERVICE_ORDERED_MOUNTS -eq 0 ]]; then
  bad "the Hub data mount is checked for the local-fs ordering cycle" \
      "no overlay mount is ordered after a service, so this rule matched nothing"
fi

# The cycle must not be "fixed" by dropping the ordering that makes the volume
# safe: unlock, then mount, then the database.
HUB_MOUNT="${OVERLAY_UNITS}/var-lib-kitluy-hub.mount"
HUB_DATABASE="${OVERLAY_UNITS}/kitluy-hub-database.service"
if grep -qE '^Requires=.*\bkitluy-hub-storage\.service\b' "$HUB_MOUNT" \
   && grep -qE '^After=.*\bkitluy-hub-storage\.service\b' "$HUB_MOUNT"; then
  ok "the Hub data mount still requires and follows the storage unlock"
else
  bad "the Hub data mount still requires and follows the storage unlock" \
      "it could mount before /dev/mapper/kitluy-hub-data exists"
fi
if grep -qE '^Requires=.*\bvar-lib-kitluy-hub\.mount\b' "$HUB_DATABASE" \
   && grep -qE '^After=.*\bvar-lib-kitluy-hub\.mount\b' "$HUB_DATABASE"; then
  ok "the Hub database still requires and follows the data mount"
else
  bad "the Hub database still requires and follows the data mount" \
      "PostgreSQL could start on the empty directory beneath the mount point"
fi

# ---------------------------------------------------------------------------
# THE DEVELOPMENT TERMINAL PROJECTION DOOR.
#
# A Store Hub holds no terminals until the cloud delivers them, and that
# producer is BLK-006. Without a stand-in, every /edge/v1 call from a genuine
# activated Pi Terminal is refused TERMINAL_NOT_RECOGNIZED and the shop cannot
# trade. This door is the development stand-in, and these assertions are what
# keep it a stand-in rather than a second write path.
# ---------------------------------------------------------------------------
PROVISION="${LAYER_DIR}/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-provision-terminal"
if [ -f "$PROVISION" ]; then
  ok "terminal projection: the door is shipped"

  if [ -x "$PROVISION" ]; then
    ok "terminal projection: the door is executable"
  else
    bad "terminal projection: the door is executable" "an operator cannot run it"
  fi

  if grep -q 'KITLUY_ENVIRONMENT' "$PROVISION" && grep -q 'ENVIRONMENT" = "development"' "$PROVISION"; then
    ok "terminal projection: refused outside development"
  else
    bad "terminal projection: refused outside development" \
        "an operator-authored identity projection must never run in pilot or production"
  fi

  # A Hub holds terminals of its OWN Store. Without this it would hold anyone's.
  if grep -q 'storeLocationId' "$PROVISION" && grep -q 'pairing-state.json' "$PROVISION"; then
    ok "terminal projection: the delivery scope is checked against this Hub's own pairing state"
  else
    bad "terminal projection: the delivery scope is checked against the Hub's pairing state" \
        "a Hub would accept a projection for another Store"
  fi

  # The serial the Hub matches is the X.509 one it observes in the handshake.
  # Projecting the KitLuy DEV-... label produces a row that matches nothing.
  if grep -q 'x509CertificateSerial' "$PROVISION"; then
    ok "terminal projection: keyed on the X.509 serial the handshake presents"
  else
    bad "terminal projection: keyed on the X.509 serial" \
        "a projection keyed on the KitLuy label is refused TERMINAL_NOT_RECOGNIZED"
  fi

  if sh -n "$PROVISION" 2>/dev/null; then
    ok "terminal projection: the door parses as POSIX sh"
  else
    bad "terminal projection: the door parses as POSIX sh" "it would fail at the first run"
  fi
else
  bad "terminal projection: the door is shipped" "no hub-provision-terminal in the Hub overlay"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
