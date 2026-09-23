#!/usr/bin/env bash
# The Store Hub storage-key authorization gate.
#
# WHAT THIS PROTECTS
# -----------------------------------------------------------------------------
# `hub-storage-provision` normally encrypts the Store's data volume with a key
# derived from this board's OTP fuses, so a drive pulled out of a Hub is
# ciphertext. Because programming those fuses is IRREVERSIBLE, a development
# board may instead use a DEVELOPMENT-UNBOUND key — one that is NOT bound to the
# board, and therefore is NOT the same security property.
#
# The whole safety argument for that path is the four conditions asserted below.
# If any one of them stops holding, a production Hub could silently come up on a
# volume anyone could read. That is why this file exists.
#
#   bash infra/edge/raspberry-pi/store-hub-image/test/storage-posture.test.sh
#
# It never touches a real device: the script's `--explain` mode resolves the
# posture and exits, and `--state-root`/`--etc-root` point the decision at a
# temporary tree.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-storage-provision"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { printf '  PASS %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }

[[ -x "$SCRIPT" ]] || { printf 'missing or non-executable: %s\n' "$SCRIPT" >&2; exit 2; }

# ---------------------------------------------------------------------------
# A board, simulated.
# ---------------------------------------------------------------------------
# `otp` is "present" or "absent". A fake `rpi-otp-private-key` is put first on
# PATH: `-c` exits 0 when a key is programmed, non-zero when it is all zeros.
# That is the exact contract the real tool has, and the only part of it the
# provisioner uses to decide.
make_board() {
  local name="$1" otp="$2" environment="$3" marker="$4"
  local dir="${TMP}/${name}"
  rm -rf "$dir"
  mkdir -p "${dir}/state" "${dir}/etc/kitluy" "${dir}/bin"
  chmod 0750 "${dir}/state"

  if [[ "$environment" != "NO_IMAGE_ENV" ]]; then
    printf 'KITLUY_ENVIRONMENT=%s\n' "$environment" > "${dir}/etc/kitluy/image.env"
  fi
  [[ "$marker" == "authorized" ]] && touch "${dir}/state/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED"
  # `image-authorized` is the owner's 2026-09-23 path: no marker file on the
  # board, the authorization carried by a DEVELOPMENT image's own hub.env.
  if [[ "$marker" == "image-authorized" ]]; then
    printf 'KITLUY_HUB_STORAGE_DEVELOPMENT_UNBOUND=authorized\n' > "${dir}/etc/kitluy/hub.env"
  fi

  if [[ "$otp" == "present" ]]; then
    printf '#!/bin/sh\n[ "${1:-}" = "-c" ] && exit 0\necho deadbeefdeadbeef\n' > "${dir}/bin/rpi-otp-private-key"
  else
    # Installed but never programmed — the state of every board off the line.
    printf '#!/bin/sh\nexit 1\n' > "${dir}/bin/rpi-otp-private-key"
  fi
  chmod 0755 "${dir}/bin/rpi-otp-private-key"

  # The SoC serial. Real boards read this from the device tree; here it is a
  # plain file, which is what --serial-file exists for.
  printf '%s' "${SERIAL_OVERRIDE:-334a2a7bcc3dba2a}" > "${dir}/serial-number"
  printf '%s' "$dir"
}

explain() {
  local dir="$1"
  OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --explain \
          --state-root "${dir}/state" --etc-root "${dir}/etc" \
          --serial-file "${dir}/serial-number" 2>&1)"
  RC=$?
}

# A non-secret fingerprint of the passphrase this board would use.
fingerprint() {
  local dir="$1"
  PATH="${dir}/bin:$PATH" "$SCRIPT" --key-fingerprint \
    --state-root "${dir}/state" --etc-root "${dir}/etc" \
    --serial-file "${dir}/serial-number" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 1. OTP always wins
# ---------------------------------------------------------------------------
# The single most important assertion in this file. A board with programmed
# fuses must reach OTP-BOUND even when every development condition is also
# satisfied — otherwise a stray marker file would downgrade a real Hub.
dir="$(make_board otp-wins present development authorized)"
explain "$dir"
if [[ $RC -eq 0 && "$OUT" == "OTP-BOUND" ]]; then
  ok "a board with programmed OTP is OTP-BOUND even when the development marker is present"
else
  bad "a board with programmed OTP is OTP-BOUND even when the development marker is present" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 2. The development path, fully authorized
# ---------------------------------------------------------------------------
dir="$(make_board dev-ok absent development authorized)"
explain "$dir"
if [[ $RC -eq 0 && "$OUT" == "DEVELOPMENT-UNBOUND" ]]; then
  ok "no OTP + development + marker resolves to DEVELOPMENT-UNBOUND"
else
  bad "no OTP + development + marker resolves to DEVELOPMENT-UNBOUND" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 3. Opt-in is required
# ---------------------------------------------------------------------------
dir="$(make_board dev-no-marker absent development unauthorized)"
explain "$dir"
if [[ $RC -ne 0 && "$OUT" == *"not authorized"* ]]; then
  ok "development without the marker refuses"
else
  bad "development without the marker refuses" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 4. Non-development refuses, marker or not
# ---------------------------------------------------------------------------
# `pilot` and `production` are the two that would matter in a shop. `staging`
# and `local` are included so the check is an allowlist of ONE value rather than
# a denylist someone could add a value past.
for environment in pilot production staging local disaster_recovery; do
  dir="$(make_board "env-${environment}" absent "$environment" authorized)"
  explain "$dir"
  if [[ $RC -ne 0 && "$OUT" == *"refused outside development"* ]]; then
    ok "environment '${environment}' cannot reach the DEVELOPMENT-UNBOUND path even with the marker"
  else
    bad "environment '${environment}' cannot reach the DEVELOPMENT-UNBOUND path even with the marker" "rc=$RC out=$OUT"
  fi
done

# ---------------------------------------------------------------------------
# 5. An unreadable image.env fails closed
# ---------------------------------------------------------------------------
# The `:-unknown` default is the whole reason this holds. A board that cannot
# read its own environment must not be treated as a development board.
dir="$(make_board no-image-env absent NO_IMAGE_ENV authorized)"
explain "$dir"
if [[ $RC -ne 0 && "$OUT" == *"environment is 'unknown'"* ]]; then
  ok "a missing image.env reads as 'unknown' and refuses"
else
  bad "a missing image.env reads as 'unknown' and refuses" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 6. A writable state directory refuses
# ---------------------------------------------------------------------------
# Anyone who can write the directory can replace the key file, which makes the
# volume readable by them. Mirrors assertDevPkiDirectoryMode.
dir="$(make_board loose-mode absent development authorized)"
chmod 0777 "${dir}/state"
explain "$dir"
if [[ $RC -ne 0 && "$OUT" == *"group- or world-writable"* ]]; then
  ok "a group/world-writable state directory refuses to hold an unbound key"
else
  bad "a group/world-writable state directory refuses to hold an unbound key" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 6b. A DEVELOPMENT IMAGE MAY CARRY THE AUTHORIZATION — and only a development one
# ---------------------------------------------------------------------------
# The marker file lives on the persistent partition, which a reflash rewrites, so
# every fresh Hub card stopped here with the data volume locked and the whole Hub
# with it (hardware, 2026-09-23: storage failed, so hub-database, hub-agent and
# operational-tls never started, and the terminal reported NO_HUB_FOUND). The
# owner ruled the gate off the development path. What protects production is the
# ENVIRONMENT, and these cases hold that line.
DIR="$(make_board image-auth-dev absent development image-authorized)"
explain "$DIR"
if [[ $RC -eq 0 && "$OUT" == "DEVELOPMENT-UNBOUND" ]]; then
  ok "no OTP + development + image authorization (no marker file) resolves to DEVELOPMENT-UNBOUND"
else
  bad "no OTP + development + image authorization (no marker file) resolves to DEVELOPMENT-UNBOUND" "rc=$RC out=$OUT"
fi

for environment in pilot production staging local disaster_recovery; do
  DIR="$(make_board "image-auth-${environment}" absent "$environment" image-authorized)"
  explain "$DIR"
  # The refusal text itself names the posture, so the assertion is on the
  # OUTCOME, not on the words: a non-zero exit and no resolved label.
  if [[ $RC -ne 0 && "$OUT" == *"refused outside development"* ]]; then
    ok "image authorization does NOT open the door in '${environment}'"
  else
    bad "image authorization does NOT open the door in '${environment}'" "rc=$RC out=$OUT"
  fi
done

# An image that says nothing still demands the operator's marker: the change adds
# a door for development images, it does not remove the original one.
DIR="$(make_board image-auth-silent absent development none)"
explain "$DIR"
if [[ $RC -ne 0 ]]; then
  ok "a development image that does NOT authorize still requires the marker file"
else
  bad "a development image that does NOT authorize still requires the marker file" "rc=$RC out=$OUT"
fi

# OTP always wins: a board with fuses programmed ignores the image's opinion.
DIR="$(make_board image-auth-otp present development image-authorized)"
explain "$DIR"
if [[ $RC -eq 0 && "$OUT" == "OTP-BOUND" ]]; then
  ok "OTP still wins over an image that authorizes the unbound key"
else
  bad "OTP still wins over an image that authorizes the unbound key" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 6c. THE DRIVE-SAFETY REFUSALS, AND THE TWO PATHS THAT COULD DESTROY A STORE
# ---------------------------------------------------------------------------
# These protect the Store's database and were untestable until `--dev-root`:
# a test cannot mknod, so the glob could never see a fake drive. Each case fakes
# only the tools the script shells out to, and asserts on the REFUSAL and on the
# fact that no destructive tool was ever invoked.
tools() {
  local dir="$1" mode="$2"
  cat > "${dir}/bin/findmnt" <<SH
#!/bin/sh
# The root filesystem lives on the SD card unless a case says otherwise. The
# answer must name the SAME device path the script discovered, or the guard it
# is testing cannot match.
[ -f "${dir}/root-on-nvme" ] && { echo "${dir}/dev/nvme0n1p2"; exit 0; }
echo "/dev/mmcblk0p2"
SH
  cat > "${dir}/bin/cryptsetup" <<SH
#!/bin/sh
case "\$1" in
  isLuks)  case "$mode" in blank|foreign) exit 1 ;; *) exit 0 ;; esac ;;
  open)    cat >/dev/null; [ "$mode" = openable ] && { touch "${dir}/opened"; exit 0; }; exit 1 ;;
  luksFormat) cat >/dev/null; touch "${dir}/DESTROYED-luksFormat"; exit 0 ;;
  *) exit 0 ;;
esac
SH
  cat > "${dir}/bin/blkid" <<SH
#!/bin/sh
# The mapper never identifies: that is what used to trigger a silent mkfs.
case "\$*" in
  *mapper*) exit 1 ;;
  *) [ "$mode" = foreign ] && exit 0; exit 1 ;;
esac
SH
  cat > "${dir}/bin/mkfs.ext4" <<SH
#!/bin/sh
touch "${dir}/DESTROYED-mkfs"
SH
  cat > "${dir}/bin/wipefs" <<SH
#!/bin/sh
touch "${dir}/DESTROYED-wipefs"
SH
  cat > "${dir}/bin/mount" <<SH
#!/bin/sh
# The volume mounts: a filesystem that mounts but does not identify is the
# "corrupted, not blank" case the guard exists for.
exit 0
SH
  printf '#!/bin/sh\nexit 0\n' > "${dir}/bin/umount"
  chmod 0755 "${dir}"/bin/*
}

boot() {
  local dir="$1"
  OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" \
          --state-root "${dir}/state" --etc-root "${dir}/etc" \
          --serial-file "${dir}/serial-number" --dev-root "${dir}/dev" \
          --hub-root "${dir}/hub" 2>&1)"
  RC=$?
}

# Two drives: the Hub must not guess which one holds the Store.
DIR="$(make_board two-nvme absent development authorized)"
mkdir -p "${DIR}/dev"; : > "${DIR}/dev/nvme0n1"; : > "${DIR}/dev/nvme1n1"
tools "$DIR" openable
boot "$DIR"
if [[ $RC -ne 0 && "$OUT" == *"more than one NVMe drive"* ]]; then
  ok "two NVMe drives: refuses rather than guessing which holds the Store"
else
  bad "two NVMe drives: refuses rather than guessing which holds the Store" "rc=$RC out=$OUT"
fi

# The drive the Hub booted from is never reformatted.
DIR="$(make_board nvme-root absent development authorized)"
mkdir -p "${DIR}/dev"; : > "${DIR}/dev/nvme0n1"; : > "${DIR}/root-on-nvme"
tools "$DIR" blank
boot "$DIR"
if [[ $RC -ne 0 && "$OUT" == *"root filesystem"* && ! -e "${DIR}/DESTROYED-luksFormat" ]]; then
  ok "an NVMe carrying the root filesystem is refused, not reformatted"
else
  bad "an NVMe carrying the root filesystem is refused, not reformatted" "rc=$RC out=$OUT"
fi

# Somebody else's filesystem is data, not a spare drive.
DIR="$(make_board foreign-fs absent development authorized)"
mkdir -p "${DIR}/dev"; : > "${DIR}/dev/nvme0n1"
tools "$DIR" foreign
boot "$DIR"
if [[ $RC -ne 0 && "$OUT" == *"refusing to destroy data this Hub cannot identify"* && ! -e "${DIR}/DESTROYED-luksFormat" ]]; then
  ok "a drive holding an unidentified filesystem is refused, never formatted"
else
  bad "a drive holding an unidentified filesystem is refused, never formatted" "rc=$RC out=$OUT"
fi

# A LUKS volume this board cannot open: the reflash case the owner cares about.
# It must NAME the case and leave every byte alone.
DIR="$(make_board key-mismatch absent development authorized)"
mkdir -p "${DIR}/dev"; : > "${DIR}/dev/nvme0n1"
tools "$DIR" locked
boot "$DIR"
if [[ $RC -ne 0 && "$OUT" == *"STORAGE_KEY_MISMATCH"* && "$OUT" == *"STORAGE_LEGACY_KEY_MISSING"* \
      && ! -e "${DIR}/DESTROYED-luksFormat" && ! -e "${DIR}/DESTROYED-mkfs" && ! -e "${DIR}/DESTROYED-wipefs" ]]; then
  ok "a LUKS volume this board cannot open names the case and destroys nothing"
else
  bad "a LUKS volume this board cannot open names the case and destroys nothing" "rc=$RC out=$OUT"
fi

# The dangerous one: the volume OPENS, but its filesystem does not identify.
# A corrupted superblock on a live Store used to mean a silent mkfs.
DIR="$(make_board unreadable-fs absent development authorized)"
mkdir -p "${DIR}/dev"; : > "${DIR}/dev/nvme0n1"
tools "$DIR" openable
boot "$DIR"
if [[ $RC -ne 0 && "$OUT" == *"STORAGE_FILESYSTEM_UNREADABLE"* && ! -e "${DIR}/DESTROYED-mkfs" ]]; then
  ok "an unlocked volume whose filesystem will not identify is REFUSED, never re-formatted"
else
  bad "an unlocked volume whose filesystem will not identify is REFUSED, never re-formatted" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 7. --explain commits nothing
# ---------------------------------------------------------------------------
# The decision must be askable without generating key material or writing a
# posture an operator would then read as fact.
dir="$(make_board explain-pure absent development authorized)"
explain "$dir"
if [[ ! -e "${dir}/state/development-unbound-storage.key" \
      && ! -e "${dir}/state/storage-posture" ]]; then
  ok "--explain generates no key and writes no posture file"
else
  bad "--explain generates no key and writes no posture file" "it created state"
fi

# ---------------------------------------------------------------------------
# 8. --explain leaks nothing but the label
# ---------------------------------------------------------------------------
# A single line, one of two known words. Anything else on stdout would end up in
# an operator's terminal and, eventually, in a bug report.
if [[ "$OUT" == "DEVELOPMENT-UNBOUND" ]]; then
  ok "--explain prints the posture label and nothing else"
else
  bad "--explain prints the posture label and nothing else" "out=$OUT"
fi

# ---------------------------------------------------------------------------
# 9. The key is 0600 and the posture file carries no secret
# ---------------------------------------------------------------------------
# A full run, stopped where it always stops off-hardware: no NVMe. Everything in
# section 0 has already happened by then, which is the point of committing the
# key with the authorization rather than with the disk.
dir="$(make_board real-run absent development authorized)"
OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" \
        --state-root "${dir}/state" --etc-root "${dir}/etc" \
        --serial-file "${dir}/serial-number" 2>&1)"
KEY="${dir}/state/development-unbound-storage.key"

# THE KEY IS NEVER WRITTEN DOWN (2026-09-08). It used to be 32 random bytes in
# this file, on the SD card's persistent partition -- which a re-flash wipes,
# orphaning the NVMe volume it had encrypted. There must be no copy to lose.
if [[ ! -e "$KEY" ]]; then
  ok "no DEVELOPMENT-UNBOUND key file is written; the key is derived"
else
  bad "no DEVELOPMENT-UNBOUND key file is written; the key is derived" "found $KEY"
fi

if [[ "$(cat "${dir}/state/storage-posture" 2>/dev/null)" == "DEVELOPMENT-UNBOUND" ]]; then
  ok "the posture file records DEVELOPMENT-UNBOUND"
else
  bad "the posture file records DEVELOPMENT-UNBOUND" "got: $(cat "${dir}/state/storage-posture" 2>/dev/null)"
fi

# THE LEAK CHECK. The key must appear in no log line the unit emits. journalctl
# keeps those, and a key in the journal is a key on the disk in plaintext, which
# defeats the volume it protects.
#
# Derived independently rather than read from a file: since 2026-09-08 there IS
# no file, and a leak check that reads an absent key would compare against the
# empty string and pass against any output at all.
SECRET="$(printf 'kitluy.hub-data-volume.development-unbound.v1' \
  | openssl dgst -sha256 -mac HMAC \
      -macopt "hexkey:$(printf '%s' 334a2a7bcc3dba2a | od -An -tx1 | tr -d ' \n')" -hex \
  | sed 's/^.*= //')"
if [[ -n "$SECRET" && "$OUT" != *"$SECRET"* ]]; then
  ok "the storage key never appears in the script's output"
else
  bad "the storage key never appears in the script's output" "the key was printed"
fi

# A second run must arrive at the SAME key — a key that changed between runs
# would make the existing LUKS volume permanently unopenable. Compared through
# the fingerprint, because the key is derived now and never written down.
PATH="${dir}/bin:$PATH" "$SCRIPT" --state-root "${dir}/state" --etc-root "${dir}/etc" \
  --serial-file "${dir}/serial-number" >/dev/null 2>&1
# `%s\n`: derive_passphrase ends its line, so the fingerprint covers that byte.
SECRET_FP="$(printf '%s\n' "$SECRET" | openssl dgst -sha256 -hex | sed 's/^.*= //' | cut -c1-32)"
if [[ "$(fingerprint "$dir")" == "$SECRET_FP" ]]; then
  ok "a second run reuses the existing key rather than minting a new one"
else
  bad "a second run reuses the existing key rather than minting a new one" "the key changed; the volume would be unopenable"
fi

# ---------------------------------------------------------------------------
# 10. No key material may ever be committed
# ---------------------------------------------------------------------------
OVERLAY="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay"
if find "$OVERLAY" \( -name 'development-unbound-storage.key' \
                   -o -name 'DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED' \) \
        -print -quit 2>/dev/null | grep -q .; then
  bad "no unbound-storage key or marker is baked into the image" "the golden image would boot straight into the development path"
else
  ok "no unbound-storage key or marker is baked into the image"
fi


# ---------------------------------------------------------------------------
# 11. THE REGRESSION: a re-flash must not orphan the encrypted volume
# ---------------------------------------------------------------------------
# The Store Hub boots from the SD card and keeps its data on NVMe. The unbound
# key used to be 32 random bytes stored under /var/lib/kitluy -- on the SD card.
# Re-flashing the card (routine in development) destroyed the only copy while
# leaving the LUKS volume intact, so the drive could never be opened again.
# Observed on a real Hub on 2026-09-08 with a 465.8G volume.
#
# The key must therefore depend ONLY on something no re-flash can change.
dir="$(make_board reflash-stability absent development authorized)"
BEFORE="$(fingerprint "$dir")"

# A re-flash, exactly: the whole persistent state directory goes, and the
# operator authorizes the board again on the fresh card.
rm -rf "${dir}/state"
mkdir -p "${dir}/state"; chmod 0750 "${dir}/state"
touch "${dir}/state/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED"
AFTER="$(fingerprint "$dir")"

if [[ -n "$BEFORE" && "$BEFORE" == "$AFTER" ]]; then
  ok "the storage key survives a wiped state directory (a re-flash)"
else
  bad "the storage key survives a wiped state directory (a re-flash)" "before=${BEFORE:-<empty>} after=${AFTER:-<empty>}"
fi

# ---------------------------------------------------------------------------
# 12. Two different boards must not share a volume key
# ---------------------------------------------------------------------------
# Reproducible must not mean identical everywhere: a drive pulled from one Hub
# must still be ciphertext in another.
# `VAR=value name="$(...)"` is NOT a command prefix — with no command word it is
# a plain assignment, so SERIAL_OVERRIDE stayed set for the REST OF THIS FILE and
# every later make_board built a board with the wrong serial. §14's leak check
# computed its expected key for the default serial and so asserted nothing at
# all, while still reporting PASS (found by audit, 2026-09-23). Scoped now.
dir2="$(SERIAL_OVERRIDE=ffffffffffffffff make_board other-board absent development authorized)"
OTHER="$(fingerprint "$dir2")"
if [[ -n "$OTHER" && "$OTHER" != "$AFTER" ]]; then
  ok "a different board serial derives a different key"
else
  bad "a different board serial derives a different key" "same=${OTHER}"
fi

# ---------------------------------------------------------------------------
# 13. A legacy board keeps opening the volume it already has
# ---------------------------------------------------------------------------
# Boards provisioned before this change hold a random key file, and only that
# key can open their existing volume. Ignoring it would orphan exactly the
# volumes this change exists to protect.
dir="$(make_board legacy-key absent development authorized)"
printf 'aaaaaaaabbbbbbbbccccccccdddddddd\n' > "${dir}/state/development-unbound-storage.key"
chmod 0600 "${dir}/state/development-unbound-storage.key"
LEGACY="$(fingerprint "$dir")"
EXPECTED="$(printf 'aaaaaaaabbbbbbbbccccccccdddddddd\n' | openssl dgst -sha256 -hex | sed 's/^.*= //' | cut -c1-32)"
if [[ "$LEGACY" == "$EXPECTED" ]]; then
  ok "an existing legacy key file still wins, so its volume stays openable"
else
  bad "an existing legacy key file still wins, so its volume stays openable" "got=$LEGACY want=$EXPECTED"
fi

# ---------------------------------------------------------------------------
# 14. --key-fingerprint leaks no key material and commits nothing
# ---------------------------------------------------------------------------
dir="$(make_board fp-pure absent development authorized)"
FP="$(fingerprint "$dir")"
RAW="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --key-fingerprint \
        --state-root "${dir}/state" --etc-root "${dir}/etc" \
        --serial-file "${dir}/serial-number" 2>/dev/null)"
# The real passphrase for this serial, computed independently.
TRUE_KEY="$(printf 'kitluy.hub-data-volume.development-unbound.v1' \
  | openssl dgst -sha256 -mac HMAC \
      -macopt "hexkey:$(printf '%s' 334a2a7bcc3dba2a | od -An -tx1 | tr -d ' \n')" -hex \
  | sed 's/^.*= //')"
if [[ "$RAW" != *"$TRUE_KEY"* && ${#FP} -eq 32 ]]; then
  ok "--key-fingerprint prints a fingerprint, never the passphrase"
else
  bad "--key-fingerprint prints a fingerprint, never the passphrase" "len=${#FP}"
fi
if [[ ! -e "${dir}/state/storage-posture" ]]; then
  ok "--key-fingerprint writes no posture file"
else
  bad "--key-fingerprint writes no posture file" "it wrote one"
fi


# ---------------------------------------------------------------------------
# 15. The recovery commands exist and are discoverable
# ---------------------------------------------------------------------------
# The recovery for a lost storage key used to be "know to run wipefs on the
# right device, and know the marker's path". That only works while the person
# who wrote it is in the room; on 2026-09-08 it was not, and a Hub sat unusable.
HELP="$("$SCRIPT" --help 2>&1 || true)"
for flag in --reset-data-volume --authorize-development-unbound --explain; do
  if [[ "$HELP" == *"$flag"* ]]; then
    ok "--help documents ${flag}"
  else
    bad "--help documents ${flag}" "absent from usage"
  fi
done

# ---------------------------------------------------------------------------
# 16. --authorize-development-unbound is refused outside development
# ---------------------------------------------------------------------------
# The marker is the whole gate on the weaker key posture. A command that writes
# it must honour the same environment rule the boot path does, or it becomes a
# way around that rule rather than a way to use it.
for environment in pilot production staging local disaster_recovery; do
  dir="$(make_board "auth-${environment}" absent "$environment" unauthorized)"
  OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --authorize-development-unbound \
          --state-root "${dir}/state" --etc-root "${dir}/etc" \
          --serial-file "${dir}/serial-number" 2>&1)"; RC=$?
  if [[ $RC -ne 0 && ! -e "${dir}/state/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED" ]]; then
    ok "--authorize-development-unbound refuses environment '${environment}'"
  else
    bad "--authorize-development-unbound refuses environment '${environment}'" "rc=$RC out=$OUT"
  fi
done

dir="$(make_board auth-dev absent development unauthorized)"
OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --authorize-development-unbound \
        --state-root "${dir}/state" --etc-root "${dir}/etc" \
        --serial-file "${dir}/serial-number" 2>&1)"; RC=$?
if [[ $RC -eq 0 && -e "${dir}/state/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED" ]]; then
  ok "--authorize-development-unbound writes the marker in development"
else
  bad "--authorize-development-unbound writes the marker in development" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 17. A board with OTP programmed cannot be talked down to the weaker posture
# ---------------------------------------------------------------------------
dir="$(make_board auth-otp present development unauthorized)"
OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --authorize-development-unbound \
        --state-root "${dir}/state" --etc-root "${dir}/etc" \
        --serial-file "${dir}/serial-number" 2>&1)"; RC=$?
if [[ $RC -ne 0 && ! -e "${dir}/state/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED" ]]; then
  ok "--authorize-development-unbound refuses a board whose OTP is programmed"
else
  bad "--authorize-development-unbound refuses a board whose OTP is programmed" "rc=$RC out=$OUT"
fi

# ---------------------------------------------------------------------------
# 18. The recovery commands never run at boot
# ---------------------------------------------------------------------------
# The unit must invoke the provisioner with NO recovery flag, or a boot could
# destroy a Store's data by itself. That is the property the whole "refuse and
# stop" design rests on.
UNIT="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay/etc/systemd/system/kitluy-hub-storage.service"
if [[ -f "$UNIT" ]]; then
  if ! grep -qE 'ExecStart=.*(--reset-data-volume|--authorize-development-unbound)' "$UNIT"; then
    ok "the systemd unit invokes no recovery flag"
  else
    bad "the systemd unit invokes no recovery flag" "a boot could destroy data by itself"
  fi
else
  bad "the systemd unit invokes no recovery flag" "unit not found at $UNIT"
fi

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
