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
#   bash infra/kitluy-store-hub-image/test/storage-posture.test.sh
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

  if [[ "$otp" == "present" ]]; then
    printf '#!/bin/sh\n[ "${1:-}" = "-c" ] && exit 0\necho deadbeefdeadbeef\n' > "${dir}/bin/rpi-otp-private-key"
  else
    # Installed but never programmed — the state of every board off the line.
    printf '#!/bin/sh\nexit 1\n' > "${dir}/bin/rpi-otp-private-key"
  fi
  chmod 0755 "${dir}/bin/rpi-otp-private-key"
  printf '%s' "$dir"
}

explain() {
  local dir="$1"
  OUT="$(PATH="${dir}/bin:$PATH" "$SCRIPT" --explain \
          --state-root "${dir}/state" --etc-root "${dir}/etc" 2>&1)"
  RC=$?
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
        --state-root "${dir}/state" --etc-root "${dir}/etc" 2>&1)"
KEY="${dir}/state/development-unbound-storage.key"

if [[ -s "$KEY" && "$(stat -c '%a' "$KEY")" == "600" ]]; then
  ok "the DEVELOPMENT-UNBOUND key is generated 0600"
else
  bad "the DEVELOPMENT-UNBOUND key is generated 0600" "mode=$(stat -c '%a' "$KEY" 2>/dev/null) size=$(stat -c '%s' "$KEY" 2>/dev/null)"
fi

if [[ "$(cat "${dir}/state/storage-posture" 2>/dev/null)" == "DEVELOPMENT-UNBOUND" ]]; then
  ok "the posture file records DEVELOPMENT-UNBOUND"
else
  bad "the posture file records DEVELOPMENT-UNBOUND" "got: $(cat "${dir}/state/storage-posture" 2>/dev/null)"
fi

# THE LEAK CHECK. The generated key must appear in no log line the unit emits.
# journalctl keeps those, and a key in the journal is a key on the disk in
# plaintext, which defeats the volume it protects.
SECRET="$(cat "$KEY")"
if [[ -n "$SECRET" && "$OUT" != *"$SECRET"* ]]; then
  ok "the storage key never appears in the script's output"
else
  bad "the storage key never appears in the script's output" "the key was printed"
fi

# A second run must reuse the key rather than mint a new one — a regenerated key
# would make the existing LUKS volume permanently unopenable.
PATH="${dir}/bin:$PATH" "$SCRIPT" --state-root "${dir}/state" --etc-root "${dir}/etc" >/dev/null 2>&1
if [[ "$(cat "$KEY")" == "$SECRET" ]]; then
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

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
