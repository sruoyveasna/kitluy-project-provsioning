# A re-flashed device recovers its operational credential, and the Hub agrees on who it is

**Date:** 2026-09-14
**Status:** **IMPLEMENTED-IN-DEV. Automated tests pass. NOT hardware verified.**
**Not committed. No hosted write. `kitluy-fresh` (the hardware stack) NOT migrated.
No image rebuilt, no board flashed** — per the owner, U1 hardware flashing does
not resume until this path passed automated tests, and the steps in §8 are still
ahead of it.

Authority: owner instruction 2026-09-14, recorded as
`KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001` and
`KLREC-2026-09-14-HUB-IDENTITY-SELECTION-001` in the decision register.

---

## 1. What was asked

1. Governed operational-credential recovery for an already-known physical
   device after a re-flash, using the existing renewal/rotation mechanism, with
   no replacement of the permanent device identity and no destructive database
   reset.
2. Then fix the Store Hub trusted/deployed identity-selection defect and verify
   it with stale + current Hub identity rows.

Both are the blockers from `docs/reports/2026-09-12__U1-HARDWARE-ACCEPTANCE-STOPPED-DEFECTS-AND-CORRECTIONS.md`
§9b and §11.

## 2. Result

```text
re-flashed Hub, new SD card, new identity key, re-paired by an operator
  -> POST /v1/operational-certificate  200  ISSUED  recovered: true  generation 2
  -> same device_record_id, same asset tag, head 1 -> 2, lost key superseded
  -> advanceDeviceTrust: active

Hub with a stale revoked identity OLDER than its current one
  -> edge:runtime-eligibility     200  hubDeviceId = current
  -> edge:configuration-current   200  hubDeviceId = current
```

Before: `KLUY-KEY-GENERATION-TAKEN` for ever, and `503 HUB_NOT_OPERATIONAL`.

## 3. How recovery works — and why it is not a backdoor

The certificate route authenticates only possession of the NEW key. First
issuance is safe because generation 1 is spendable once; a recovery door that
issued generation N+1 to "a known device with a new key" would let anyone who
knows a device id take its identity. So recovery requires ALL of:

| #   | Condition                                                                                                                                                                                                                    | Where          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | `renewal_policy.allow_reflash_credential_recovery`, which a CHECK refuses without a named decision                                                                                                                           | 0224           |
| 2   | Request signed by the Ed25519 **identity key of the device's CURRENT sealed enrollment** (`kitluy.opcert-recovery-identity.v1` over SHA-256 of the exact `kitluy.csr.v1` bytes) — verified by the service, bound by the door | service + 0224 |
| 3   | The incumbent certificate artifact's enrollment is a **strict ancestor** of the current enrollment via `supersedes_enrollment_id` — clock-free re-flash evidence                                                             | 0224           |
| 4   | Device `awaiting_trust`, live assignment at its current generation, no open trust incident (i.e. governed re-pairing happened)                                                                                               | 0224           |
| 5   | Incumbent credential not revoked                                                                                                                                                                                             | 0224           |

After the reservation, nothing new: `register_generation_key_v2` → the shared
prepare/sign/finalize bound to the reservation (`bindReservationToPreparation`,
exactly as rotate-key renewal) → the same X.509 artifact path
(`mintAndRecordOperationalArtifact`, extracted from first issuance) →
`confirm_provider_key_activation_v1`. The device is its own key provider; it
proved possession in the same request.

Two latent defects surfaced and were fixed inside 0224:

- **The artifact door never saw generation 2.** 0201's one-active-artifact index
  refused every generation-2 X.509 artifact (`device_certificates_one_active_per_env_idx`),
  because nothing ever moved the previous artifact out of `active`. A narrow
  trigger now supersedes it when the current head generation's artifact lands.
- **`reserve_device_credential_renewal_v1` is unusable for this case by design**
  (refuses > 10 days of validity: `KLUY-RENEWAL-TOO-EARLY`; "recovery, not
  renewal"). Hence a separate reservation door rather than a relaxed renewal.

**Proactive rotation is still disabled** (`allow_key_rotation = false`); 0224's
assertions refuse otherwise.

**Re-pairing a re-flashed ACTIVE Store Hub** is the existing operator procedure:
`revoke_device_assignment_v1` (what `pnpm dev:device:unassign` calls) returns it
to `enrolled`; a new pairing code re-pairs it. The Hub pairing-session door
(0194) admits only `enrolled`, so recovery cannot be reached without that
operator step.

## 4. The Hub fix

`runtime-bootstrap.ts` took the oldest `hub_device` row unconditionally.
`selectOperationalHubIdentity` now applies hub migration 0042's selection
(trusted AND deployed, oldest first), so the Hub a terminal paired with is the
Hub that serves it. Only when no operational identity exists does the newest row
decide `HUB_RETIRED` vs `HUB_NOT_OPERATIONAL`. One function feeds eligibility,
the configuration gate and staff sessions, so all three are fixed.

## 5. Files

```text
supabase/migrations/20260914120000_0224_reflash_operational_credential_recovery.sql   NEW
packages/device-identity/src/operational-recovery-identity.ts                         NEW (+ index export)
packages/device-identity/test/operational-recovery-identity.test.ts                   NEW
services/kitluy-device-registry-service/src/reflash-credential-recovery.ts            NEW (dispatcher + composition)
services/kitluy-device-registry-service/src/first-operational-issuance.ts             artifact steps extracted, behaviour unchanged
services/kitluy-device-registry-service/src/operational-certificate-routes.ts         identity fields, dispatcher
services/kitluy-device-registry-service/test/reflash-credential-recovery.adversarial.test.ts   NEW
services/kitluy-device-firstboot-agent/src/operational-recovery-identity-bytes.ts     NEW (device copy + signer)
services/kitluy-device-firstboot-agent/src/operational-tls-client.ts                  attaches the proof
services/kitluy-device-firstboot-agent/src/adapters/http-operational-certificate-client.ts
services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts                     signs with /var/lib/kitluy/identity key
services/kitluy-device-firstboot-agent/src/index.ts                                   export for the registry e2e
services/kitluy-device-firstboot-agent/test/operational-recovery-identity-drift.test.ts   NEW
services/kitluy-device-firstboot-agent/test/operational-tls-client-recovery-identity.test.ts   NEW (3 cases)
services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts                           selectOperationalHubIdentity
services/kitluy-hub-agent/test/t1-bootstrap-routes.integration.test.ts                +2 cases
docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md                  KLD + KLREC entries
docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md           2 rows
```

No unit file changed: both `kitluy-operational-tls` units run as root with
`ReadWritePaths=/var/lib/kitluy`, which covers the identity key.

## 6. Verification

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
export KITLUY_DEV_PKI_DIR=~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki
export KITLUY_DEV_DB_URL=postgresql://postgres:postgres@127.0.0.1:54392/postgres   # kitluy-repo17
export KITLUY_HUB_DB_CONTAINER=kitluy-hub-local
export KITLUY_HUB_DB_URL=postgresql://postgres:postgres@127.0.0.1:54330/kitluy_hub_local
(cd services/kitluy-device-registry-service && npx vitest run test/reflash-credential-recovery.adversarial.test.ts)
(cd services/kitluy-hub-agent && npx vitest run test/t1-bootstrap-routes.integration.test.ts)
```

| Check                                                                             | Result                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Recovery security suite (real DB, real dev CA, real route, real firstboot client) | **14/14**                                                                              |
| Device drift + signer + transport                                                 | **10/10**; client recovery-identity **3/3**; existing client suite **27/27** unchanged |
| device-identity verifier unit tests                                               | **6/6**                                                                                |
| T1 bootstrap routes incl. stale+current Hub identity                              | **22/22**, the 2 new cases executed (not skipped)                                      |
| Hub agent full suite with the Hub database                                        | **447 passed, 0 failed**                                                               |
| First-issuance security suites (C-1, C-2, C-3, M-1/M-2, integration)              | 44/45 — the 1 is pre-existing (§7)                                                     |
| Migration 0224 hostile assertions; idempotent re-apply                            | pass; pass                                                                             |
| `pnpm migrations:validate`                                                        | pass (123 files)                                                                       |
| Lint on changed files                                                             | 0 errors                                                                               |
| `pnpm secret:scan` including the new files                                        | pass (2253 files)                                                                      |

`pnpm verify` (same environment as the morning baseline): Lint, Typecheck,
Contract tests, Offline harness, Build, OpenAPI, Migration validation, Hub
migration validation and Clock usage **PASS**. Format check, Unit tests and Docs
link check **FAIL, unchanged from the baseline** (root-owned image build tree
breaks Prettier; the device-identity concurrency guard; 4 broken links in a
2026-07-30 handoff). Secret scan failed in that run because the new client cases
had been added to `operational-tls-client.test.ts`, a pinned refusal fixture in
`secret-scan.mjs`; they were moved to their own file, the pinned file is
byte-identical to HEAD, and the scan was re-run on its own and passes. The full
`pnpm verify` was not re-run after that move.

**Mutation tests (a gate that cannot fail proves nothing):**

| Broken on purpose                                    | Caught                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| DB: identity key not bound to the current enrollment | a stranger is ISSUED — suite fails                         |
| DB: re-flash evidence removed                        | suite fails (and the evidence table's CHECK still refuses) |
| Service: identity signature not verified             | a tampered proof is ISSUED — suite fails                   |
| Artifact supersession trigger disabled               | generation 2 fails on the one-active-artifact index        |
| Hub: original oldest-row query restored              | eligibility returns the hardware's 503 HUB_NOT_OPERATIONAL |

Every mutation was reverted; source files were restored byte-identical and the
database functions re-applied from the migration file.

## 7. Environment work, and failures that are NOT this change

**`kitluy-repo17` was brought to parity with `kitluy-fresh`** so the suites ran
against the canonical chain. It lacked the effects of 0196, 0217–0223 (its
ledger is unreliable: 0189/0190/0195/0197/0216 are unrecorded, and most of their
objects exist). Applied in order with psql and recorded; function bodies,
triggers and columns then matched `kitluy-fresh` byte for byte. Two function
owners were corrected to what 0222/0223 intend (`set local role` needs a
transaction the plain psql run did not open). Backup first:
`~/Development/HET_VEASNA_WORKSPACE/backups/het-kitluy-project/2026-09-14__kitluy-repo17__before-0196-0224.dump`.

- **0189 was NOT applied: it SIGSEGVs the local Postgres** in its DO block.
  0195 was not applied either. Neither is on the recovery path.
- **A top-level `grant <role> to current_user` crashes the backend** on this image
  when a platform-granted membership already exists; the same grant through
  `DO ... execute format(...)` does not. The recovery suite uses the latter.
- `pnpm db:apply` must NOT be used here: it targets `:54322`, which is
  `supabase_db_hsa_eco`.

Full registry-service suite: 379 passed, 10 failed tests / 23 failed files.
**None traces to this change:**

| Failure                                                                                  | Cause                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 13 provisioning-code / activation / T007 files                                           | legacy `evaluate_trusted_time_v1` refused by 0198/0200 (`KLUY-DEVICE-TIME-RESTRICTED`) — stale fixtures                                 |
| `firstboot-operational-tls.e2e` ACTIVATES                                                | the route has activated the Hub itself since `68e0249`; the test then activates again                                                   |
| `terminal-pairing.integration` INTERNAL_ERROR                                            | fixed-tag fixtures never unbind `physical_terminals.bound_device_id`; exposed by 0218's re-pair path                                    |
| `assignment-capability-census`, `revocation-composition`                                 | `kitluy_issuance_service` SELECT on `device_credentials` is granted by canonical **0202** (present in the pre-change backup)            |
| census, `test-clock-governance`, `emergency-concurrency`, device-identity concurrency ×2 | role memberships on the local stack (platform-granted rows; `generation-artifact-serial` commits a borrowed grant and never returns it) |

Firstboot full suite: 762 passed, 1 failed — `hub-provisioning-e2e.db` expects
"not eligible" for an assigned Hub, which 0219 changed.

## 8. NOT done — in this order, before any U1 flash

1. **Apply 0224 to `kitluy-fresh`** (`:54372`) and record it. Until then **do not
   restart the fleet service on `:8787`**: it runs
   `services/kitluy-device-registry-service/dist/main.js`, whose rebuilt code calls
   `classify_operational_certificate_request_v1`, which that stack does not have.
2. Restart the fleet service on the new build.
3. Re-package both overlays (`package-bootstrap-runtime.sh` for the Terminal and
   the Store Hub; `pnpm --filter @kitluy-services/kitluy-hub-agent build:bundle`
   first) and rebuild both images. The committed overlay JS does not contain
   this change yet.
4. Flash to a spare card (no fallback card exists today). For a re-flashed
   active Hub: `pnpm dev:device:unassign … --reason SD_CARD_REFLASH --confirm`,
   then a new pairing code.
5. From the diagnosis: re-issue the terminal's release assignment (sequence 5) —
   sequences 2–4 are revoked chain-check releases that hide `0.4.12-a`.

## 9. Open questions for the owner

- Should recovery **revoke** the incumbent credential instead of leaving it to
  the existing three-day overlap cap? The old card, if kept, can still present
  the old certificate inside that window.
- Pilot/production recovery stays undecided (the tables are development-only).
- Re-pairing an ACTIVE **Pi Terminal** after a re-flash (terminal pairing
  session door 0213/0220) was not exercised; the suite proves the Store Hub path.
