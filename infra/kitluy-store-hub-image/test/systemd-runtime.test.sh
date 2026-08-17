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
# Run: bash infra/kitluy-store-hub-image/test/systemd-runtime.test.sh

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
declare -A GOVERNED=(
  [store-hub]="kitluy-hub-agent.service kitluy-hub-discovery.service"
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

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
