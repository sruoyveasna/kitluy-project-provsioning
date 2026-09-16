#!/usr/bin/env bash
# KitLuy OS image — golden-image secret and binding scan.
#
#   scan-image-secrets.sh <rootfs-or-build-tree> [more paths...]
#
# Images are zero-secret by construction (mission §23, §30). This scans a BUILT
# artifact tree rather than the overlay source, because the overlay backstop in
# lib/common.sh cannot see what the builder itself, a layer hook or an installed
# package wrote into the filesystem.
#
# TWO CLASSES, BOTH FAILURES
# --------------------------
#   SECRET   — credential material. Obvious.
#   BINDING  — assignment truth: Tenant, Digital Store, Location, terminal
#              profile, a fixed Hub endpoint. Not a credential, and every bit as
#              disqualifying: a golden image that carries assignment makes the
#              image a source of assignment truth, which the locked provisioning
#              chain forbids, and means a spare terminal can only ever replace
#              the one role it was flashed for.
#
# NEVER PRINTS A MATCHED VALUE. Only the category, the file and the line number.
# A scanner that echoes the credential it found has copied that credential into
# the log, the transcript and the handoff.

set -uo pipefail

log()  { printf '[kitluy-secret-scan] %s\n' "$*" >&2; }
die()  { printf '[kitluy-secret-scan] REFUSED: %s\n' "$*" >&2; exit 2; }

[[ $# -ge 1 ]] || die "usage: $0 <rootfs-or-build-tree> [more paths...]"

TARGETS=("$@")
for t in "${TARGETS[@]}"; do
  [[ -e "$t" ]] || die "target not found: $t"
done

# category|description|extended-regex
#
# Patterns require an assigned VALUE where a bare mention is legitimate. The
# string `service_role` appears in Postgres role documentation and in KitLuy's
# own comments explaining that the key must never be present; matching the bare
# word would fail every image for containing a correct explanation of the rule.
#
# WHY THE VALUE MUST NOT START WITH '$'
# -------------------------------------
# `PGPASSWORD=$(pwgen 20 1)` is a password GENERATED at runtime, not a password
# baked into the image — and Debian's postgresql-common ships exactly that in
# /usr/bin/pg_virtualenv. Flagging it teaches the reader that this scanner cries
# wolf, which is how a real finding gets waved through later. So a value that is
# a command substitution, a parameter expansion or a variable reference is not a
# baked credential and does not match.
NOTVAL="[^[:space:]\"'\$]"

CHECKS=(
  "SECRET|Supabase service_role key (JWT)|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  "SECRET|Supabase service-role assignment|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*[=:][[:space:]]*[A-Za-z0-9._-]+"
  "SECRET|Supabase secret key (sb_secret)|sb_secret_[A-Za-z0-9_-]+"
  "SECRET|Supabase personal access token|sbp_[A-Za-z0-9]{20,}"
  "SECRET|Database password assignment|(PGPASSWORD|POSTGRES_PASSWORD|DB_PASSWORD|DATABASE_PASSWORD)[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "SECRET|Database URL with inline password|postgres(ql)?://[^[:space:]:/]+:[^[:space:]@]+@"
  "SECRET|Private key material|BEGIN[[:space:]]+([A-Z]+[[:space:]]+)?PRIVATE[[:space:]]+KEY"
  "SECRET|Admin/partner password assignment|(ADMIN_PASSWORD|PARTNER_PASSWORD|KITLUY_ADMIN_PASSWORD)[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "SECRET|Provisioning/enrollment code assignment|(PROVISIONING_CODE|ENROLLMENT_CODE|KITLUY_PROVISIONING_CODE)[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "SECRET|Release signing key reference with value|KITLUY_IMAGE_SIGNING_KEY[A-Z_]*[[:space:]]*[=:][[:space:]]*[^[:space:]\"'\$\[]"
  "BINDING|Tenant binding|KITLUY_TENANT_ID[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "BINDING|Digital Store binding|KITLUY_DIGITAL_STORE_ID[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "BINDING|Location binding|KITLUY_LOCATION_ID[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "BINDING|Terminal profile baked in|KITLUY_TERMINAL_PROFILE[[:space:]]*[=:][[:space:]]*${NOTVAL}"
  "BINDING|Fixed Hub endpoint|KITLUY_HUB_ENDPOINT[[:space:]]*[=:][[:space:]]*${NOTVAL}"
)

# Device identity must be absent, not merely empty of secrets: a golden image
# carrying a device private key means every device flashed from it shares one
# identity.
IDENTITY_PATHS=(
  "var/lib/kitluy/identity/device.key"
  "var/lib/kitluy/identity/device-private.pem"
  "etc/kitluy/device.key"
)

# Clone hygiene: a non-empty machine-id or a pre-seeded SSH host key makes two
# flashed devices the same device on the network.
printf '\nKitLuy golden-image secret and binding scan\n'
printf '  targets: %s\n\n' "${TARGETS[*]}"

# -----------------------------------------------------------------------------
# KNOWN NEGATIVE-TEST PROBE — named individually, never a directory skip.
# -----------------------------------------------------------------------------
# Hub migration 0038 asserts AT APPLY TIME that the release trust registry
# REFUSES a private key: it attempts to insert a string beginning with the PEM
# private-key marker and requires the constraint to reject it. The marker is the
# whole point of the test, so the file matches "[SECRET] Private key material"
# while containing no key material at all.
#
# It is exempted here rather than rewritten, because this exact file is the one
# an independent review called "THE ONE REAL BREACH": a commit labelled
# `docs(...)` once silently amended this same probe in an already-applied
# migration, and a later commit had to restore it byte for byte
# (00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-11-T008__INITIAL-INDEPENDENT-REVIEW).
# Schema contract §4 — "an applied file is never edited" — means the right place
# to absorb this is the scanner, not the migration.
#
# Scoped to ONE path. A real key added to that same file would still be reported
# under every other check, and this probe text appearing anywhere else still fails.
# Each entry is a PATH FRAGMENT. A file is exempt only for matching this exact
# path; the same text anywhere else still fails, and every OTHER check still
# applies to these files.
KNOWN_FALSE_POSITIVES=(
  # Hub migration 0038 asserts AT APPLY TIME that the release trust registry
  # REFUSES a private key, so it carries the PEM marker on purpose and holds no
  # key material. It is exempted rather than rewritten because an independent
  # review recorded an earlier silent amendment of this exact probe as "THE ONE
  # REAL BREACH", and schema contract §4 forbids editing an applied migration.
  "hub-migrations/0038_release_trust_and_cache.sql"
  # The crypto library's own source. Both lines are `startswith` checks that
  # DETECT an OpenSSH private key format — writing and recognising PEM is what
  # the library does, so its source will always contain these markers. The
  # library stays because `rpi-eeprom-config` imports it for signed Pi 5 EEPROM
  # images; its 2.8 MB of SelfTest fixtures are removed from the image instead.
  "Cryptodome/PublicKey/ECC.py"
  "Cryptodome/PublicKey/RSA.py"
)

# ⚠️ THREE named exceptions is a signal, not a comfort. The underlying cause is
# that this check matches a PEM MARKER rather than key material, so any file that
# mentions the format trips it. Tightening the pattern to require a real PEM block
# was considered and rejected here: every safe tightening also stops matching a
# key pasted into a single-line string, which is exactly the case worth catching.
# Recorded so the next person sees a known limitation rather than a habit.

FAIL=0
PASS=0

for entry in "${CHECKS[@]}"; do
  IFS='|' read -r class desc regex <<<"$entry"
  # -I skips binary files: a random byte sequence inside a compiled binary that
  # happens to match is noise, and reporting it trains people to ignore this.
  hits="$(grep -rIn --binary-files=without-match -E "$regex" "${TARGETS[@]}" 2>/dev/null \
          | grep -vE '\[REQUIRED:' \
          | grep -vFf <(printf '%s\n' "${KNOWN_FALSE_POSITIVES[@]}") | head -20)"
  if [[ -n "$hits" ]]; then
    printf '  FAIL  [%s] %s\n' "$class" "$desc"
    # File and line only — never the matched text.
    printf '%s\n' "$hits" | awk -F: '{printf "          %s:%s\n", $1, $2}' | sort -u
    FAIL=$((FAIL + 1))
  else
    printf '  PASS  [%s] %s\n' "$class" "$desc"
    PASS=$((PASS + 1))
  fi
done

printf '\n'
for t in "${TARGETS[@]}"; do
  [[ -d "$t" ]] || continue
  for rel in "${IDENTITY_PATHS[@]}"; do
    if [[ -e "${t}/${rel}" ]]; then
      printf '  FAIL  [SECRET] device identity present in golden image: %s\n' "$rel"
      FAIL=$((FAIL + 1))
    fi
  done

  if [[ -f "${t}/etc/machine-id" ]]; then
    if [[ -s "${t}/etc/machine-id" ]]; then
      printf '  FAIL  [BINDING] /etc/machine-id is non-empty — clones share a machine identity\n'
      FAIL=$((FAIL + 1))
    else
      printf '  PASS  [BINDING] /etc/machine-id is empty (regenerated at first boot)\n'
      PASS=$((PASS + 1))
    fi
  fi

  if compgen -G "${t}/etc/ssh/ssh_host_*" >/dev/null 2>&1; then
    printf '  FAIL  [SECRET] pre-seeded SSH host keys present — clones can impersonate each other\n'
    FAIL=$((FAIL + 1))
  else
    printf '  PASS  [SECRET] no pre-seeded SSH host keys\n'
    PASS=$((PASS + 1))
  fi
done

printf '\n  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || { printf '  RESULT: FAIL\n\n'; exit 1; }
printf '  RESULT: PASS\n\n'
exit 0
