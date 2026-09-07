# KitLuy Store Hub Development Handoff

> Reconstructed from repository, git, live local database, built image artifacts
> and existing handoff records on 2026-08-25. Every number below was measured on
> that date unless a line says otherwise. Where evidence is older or could not be
> re-verified, the line says so rather than carrying the claim forward silently.

---

## 1. Snapshot

Reconciled 2026-08-28 from repository and live-database truth.

| Fact                             | Value                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Branch                           | `claude/fix-firstboot-esm-and-ssh-hostkeys`                                    |
| HEAD                             | `0a30a74` — **no commit has been made by any remediation session**             |
| Modified tracked files           | 67                                                                             |
| Untracked files                  | 64                                                                             |
| Migrations in the repository     | **111** (through `0212`)                                                       |
| Local ledger rows                | **96**, head `20260825110000` (**0202**)                                       |
| Local schema objects             | **0203–0212 exist**, without ledger rows — applied directly during remediation |
| Hosted development               | **0197**, unchanged and NOT re-verified this session                           |
| Credential-path review loop      | **CLOSED** — see §10                                                           |
| Firstboot operational TLS client | **IMPLEMENTED-IN-DEV** — software evidence only                                |
| Store Hub image                  | **REBUILT 2026-08-26 14:53** from this tree — §9D-2; `bootTested: false`       |
| Physical Pi                      | **NOT TESTED** with this client                                                |

The ledger/schema gap is real and deliberate: migrations 0203–0212 were applied
to the canonical local database directly so their behaviour could be tested,
and ledger reconciliation is explicitly deferred (see D-01 and N-3). No
environment is a faithful replay of another until that is done.

---

## 2. Development Scope

**Owned by this stream:** the Store Hub Raspberry Pi 5 image and its build;
firstboot device identity; cloud self-registration; HET approval; Store pairing;
trusted time; certificate issuance and delivery; activation; the Hub's local
PostgreSQL; the LAN Edge Operations API and its mTLS transport; terminal
provisioning contracts on the cloud/Hub side; offline operation; signed releases
and A/B rollback.

**Explicitly NOT owned by this stream:** Laundry T1–T4 POS workflows and any
business/vertical logic; the Admin/Partner/Chain PWA portals beyond the device
screens already built; catalog, pricing, payments, finance, inventory;
`kitluy-suite-pos-desk-app` and the other six standalone repositories;
production PKI/HSM custody; hosted deployment (owner-operated).

---

## 3. Governing Architecture (locked rules that constrain further work)

- **Digital Store is the control plane**; a Store Location is an optional
  physical edge. Pairing resolves Tenant → Digital Store → Store Location
  server-side; **the device never chooses its Store or Location.**
- **After activation the Store Hub is the local operational authority** for its
  Store Location. T1–T4 talk to the Hub over the Store LAN.
- **Cloud sync is asynchronous.** Internet loss must not stop approved local
  operations. WAN must not be a startup dependency for an already-provisioned Hub.
- **The golden image carries no per-device secret** — no device identity, no
  Store assignment, no key, no DB password, no `service_role`. Clone hygiene is
  enforced in the build (machine-id truncated, SSH host keys removed,
  snakeoil key removed) and re-checked by the image secret scan.
- **Device identity, trust, certificate and Store assignment are four separate
  facts** and are never collapsed. Registration ≠ approval ≠ pairing ≠ trusted
  time ≠ certificate ≠ activation.
- **Trusted time is server-authoritative.** A caller may REQUEST establishment
  and may never SUPPLY the value. Only `cloud_authoritative` (`pg_catalog.now()`
  read inside the database) may initialise a NULL floor; the floor is monotonic;
  device-class sources keep the strict 3600 s forward-jump rule.
- **Signed releases and A/B rollback**; pilot and stable channels are unbuildable
  while BLK-005 is open.
- **Development trust exception:** every certificate/credential in play is
  development-only, `production_eligible = false`, and `pki_trust_configuration`
  refuses pilot and production. Production hardware trust (secure element/TPM)
  is **not waived and not started**.
- **Evidence discipline:** nothing is called implemented without executed
  evidence; nothing is called `HARDWARE_E2E` without a physical Pi.

---

## 4. Current Migration State

Verified 2026-08-28 by counting the repository and querying the live ledger.

| Environment                                     | Migrations | Head                        | Note                                          |
| ----------------------------------------------- | ---------: | --------------------------- | --------------------------------------------- |
| Repository (`supabase/migrations/*.sql`)        |    **111** | `0212`                      | counted from disk                             |
| Canonical local DB (`:54392`, PG 17.6) — LEDGER |     **96** | `20260825110000` (**0202**) | queried live                                  |
| Canonical local DB — SCHEMA OBJECTS             |          — | **0212**                    | 0203–0212 objects all present                 |
| Hosted development (`gjgbnkhuwlwhngbtrgts`)     |         96 | **0197**                    | NOT re-verified this session; carried forward |

### The ledger/schema gap is known, deliberate, and not yet fixable

Migrations 0203–0212 were applied to the canonical local database directly so
their behaviour could be exercised under test. They created their objects and
did NOT write ledger rows, so the ledger says 0202 while the schema is at 0212.

This is not drift that appeared by accident, and it is not safe to paper over:

- **N-3** records that group **0210 cannot safely re-apply** on an
  already-patched schema, so a naive replay would fail part-way.
- **D-01** records that no clean-from-zero replay covers 0189–0212.

Ledger reconciliation is therefore explicitly OUT OF SCOPE for this session by
owner instruction, and must not be attempted until N-3 is closed. Until then, no
environment is a faithful replay of another.

### Groups added since the last handoff

| Group | Purpose                                                          | Finding |
| ----- | ---------------------------------------------------------------- | ------- |
| 0210  | minimal positive DER serial encoding, one rule in both languages | R2-1    |
| 0211  | exact AlgorithmIdentifier equality, inner and outer              | R2-3    |
| 0212  | the serial inverse FAILS CLOSED for non-invertible shapes        | N-1     |

---

## 5. Current Backend State

Measured against the canonical local database (PostgreSQL 17.6, `:54392`) on
2026-08-28.

| Fact                                               | Value                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operational X.509 issuance                         | **BUILT, TESTED and independently reviewed.** Real certificates are issued, key-bound, chain-verified against pinned anchors, and activate a Hub. |
| `device_credentials` rows                          | 3,293                                                                                                                                             |
| Certificate artifacts (`certificate_pem` not null) | 2,904                                                                                                                                             |
| `device_certificates` with `status = 'active'`     | 2,812                                                                                                                                             |
| ...of which belong to RETIRED devices              | **2,541** — see D-16                                                                                                                              |
| Activation                                         | **certificate-backed and ENFORCED.** Reviewed 2026-08-26 and 2026-08-27. No bare `UPDATE` can reach `active` (group 0207).                        |
| Trusted time                                       | server-authoritative (0204); the caller cannot choose a validity anchor                                                                           |
| Separation of duty                                 | REAL (0206) — `service_role` reaches no credential-path door                                                                                      |
| Serial mapping                                     | one canonical minimal-positive-DER rule, and its inverse FAILS CLOSED (0210, 0212)                                                                |

The retired-device figure has GROWN since the review counted 776 (2,541 live), because the
remediation suites mint and retire fixture devices on every run. It is a fixture
population, not a fleet — but the policy question D-16 raises is the same either
way and is an owner decision.

---

## 6. Current Store Hub Image State

### BUILT (verified against the built rootfs at

`infra/kitluy-store-hub-image/build/work/chroot-v2.7.0/filesystem`)

| Aspect                   | State                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact                 | **SUPERSEDED — see §9D-2.** Current: `build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst`, 652,959,133 bytes, **2026-08-26 14:52**                                    |
| SHA-256                  | `15e5f1367d7790890388012b91b56c39773d78f15f96f2cf9f9f39c3fe11c1bb` (§9D-2; the 2026-08-24 digest `d8047881…` is historical)                                                  |
| Manifest                 | `buildClass: DEVELOPMENT-CROSS-BUILD`, `signed: false`, `releaseEligible: false`, `promotable: false`, **`bootTested: false`**                                               |
| Builder                  | rpi-image-gen v2.7.0, commit `a7b6d480…`                                                                                                                                     |
| OS / board               | Debian bookworm arm64, Raspberry Pi 5                                                                                                                                        |
| Storage layout           | `image-rota` A/B system slots + separate userdata; system slot EROFS behind dm-verity                                                                                        |
| NVMe / LUKS              | `cryptsetup` present; `hub-storage-provision` + `var-lib-kitluy-hub.mount` enabled                                                                                           |
| PostgreSQL               | **15** in image; `postgresql.service` + `kitluy-hub-database.service` enabled; UNIX socket only, `PrivateNetwork=yes`                                                        |
| systemd units enabled    | firstboot, cloud-registration, hub-pairing (tty1), hub-database, hub-storage, health-reporter, update-agent, ssh-hostkeys, avahi, systemd-networkd, **wpa_supplicant@wlan0** |
| **Hub LAN agent**        | **NOT PACKAGED** — no unit, no binary in the rootfs                                                                                                                          |
| Network                  | systemd-networkd + systemd-resolved; eth0 `RouteMetric=100` / `RequiredForOnline=yes`; wlan0 `RouteMetric=600` / `RequiredForOnline=no`; **NetworkManager absent**           |
| Wi-Fi                    | `wpa_supplicant`, `wpa_cli`, `iw` present; KitLuy TUI shipped; `/etc/wpa_supplicant` slot-shared; seeded conf mode 0600, zero-secret                                         |
| Timezone                 | `/etc/localtime → Asia/Phnom_Penh`, `/etc/timezone` agrees                                                                                                                   |
| LAN listener / discovery | avahi advert `_kitluy-edge._tcp` port 7443 present; **nothing listens** (agent not packaged)                                                                                 |
| SSH / hardening          | public-key only, root login disabled, no autologin, getty moved to tty2, `NAutoVTs=0`                                                                                        |
| Image secret scan        | PASS                                                                                                                                                                         |
| A/B update               | `update-agent` present and enabled; release trust fails closed under BLK-005                                                                                                 |

### PHYSICALLY TESTED

**Nothing in this artifact.** `bootTested: false`. The only physical evidence in
the repository is against the **2026-08-19** image (see §7). The 2026-08-20
artifact is preserved at
`infra/kitluy-store-hub-image/build/preserved-2026-08-20/` (648,405,823 bytes,
SHA-256 verified `OK` on 2026-08-24).

---

## 7. Real Hardware State

> **The physical Pi's record lives in the HOSTED development project, which was
> not reachable on 2026-08-25.** Everything in this section is quoted from
> `00_AI_HANDOFF/shared/2026-08-20__SHARED__STORE-HUB-HARDWARE-PROOF__…md` and
> is **as of 2026-08-20**, not re-verified.

| Field                   | Value (2026-08-20)                                                          |
| ----------------------- | --------------------------------------------------------------------------- |
| Device id               | `KL-6CBB3BC0D49B`                                                           |
| Hostname                | `pi5-hyzmim`                                                                |
| Lifecycle state         | `awaiting_trust`                                                            |
| Store / Location        | `DEMO-LAUNDRY-001 / DEMO-PP-01`, 1 assignment                               |
| Pairing state           | PAIRED (code typed on the Hub console)                                      |
| Trusted-time state      | none — zero trusted-time rows at that date                                  |
| Certificate state       | none — `device_credentials = 0` for it                                      |
| Activation state        | not activated                                                               |
| Installation generation | 2 (proven: new SD card, same board, same `device_record_id`)                |
| Last physical test      | **2026-08-20** — register → HET approve → pair, on the **2026-08-19** image |

The 15 `KL-*` rows in the **local** dev database are test identities, not this
board: 14 are `device_class = terminal` (3 enrolled, 10 quarantined, 1
restricted_investigation) and one, `KL-F73417A8`, is `store_hub` /
`manufactured`. None has trusted time, an assignment or a certificate.

---

## 8. Terminal State

**Code that exists:** `services/kitluy-device-registry-service/src/provisioning-composition.ts`
and `provisioning-routes.ts` (cloud side); `packages/device-identity/src/provisioning-pop.ts`,
`activation-ack.ts`, `terminal-configuration-delivery.ts`, `credential-package.ts`;
Hub side `services/kitluy-hub-agent/src/hub/pairing.ts`,
`pairing-replication.ts`, `terminal-health.ts`, `src/hub/edge/*`.

**Tested:** only in-suite. The hub-agent suite passes 141 with **271 skipped**
(the skipped ones need a live Hub database). The registry provisioning suites do
not currently execute — they target a stale database (§9).

**Has a real terminal been provisioned through an ACTIVE Hub?** **No.** No
physical terminal evidence exists anywhere in the repository.

**Remaining before terminal proof:** (a) a Hub must reach ACTIVE with a real
operational certificate; (b) the Hub LAN agent must be packaged and running;
(c) mTLS must be provable on the LAN; (d) a terminal identity must be
provisioned through that Hub. None of (a)–(d) is done.

---

## 9. Test Baseline — measured 2026-08-27, after the R2 remediation

| Suite                                   |             Passed | Failed | Skipped | Interpretation                                                                                     |
| --------------------------------------- | -----------------: | -----: | ------: | -------------------------------------------------------------------------------------------------- |
| **Formal security gate** (10 suites)    |             **74** |  **0** |   **0** | 10/10 consecutive clean runs. Zero skips — the suites now FAIL when the fixture is missing (R2-4). |
| `kitluy-device-registry-service` (full) |                343 |      7 |     186 | all 7 are D-12 — see below                                                                         |
| `packages/device-identity`              |            **899** |  **0** |      23 | green, 10/10 runs                                                                                  |
| `kitluy-device-firstboot-agent`         |                342 |      0 |       9 | green in 6/10 runs; D-14 flake in 4                                                                |
| `kitluy-hub-agent`                      |                141 |      0 |     271 | green; skips need a live Hub DB                                                                    |
| `secret:scan`                           | PASS (1,882 files) |      — |       — |                                                                                                    |
| `migrations:validate`                   |   PASS (110 files) |      — |       — |                                                                                                    |
| `contracts:validate`                    |               PASS |      — |       — |                                                                                                    |
| `dsn:check`                             |   PASS (591 files) |      — |       — | M-4 guard                                                                                          |
| `assert-no-dev-pki`                     |               PASS |      — |       — | fingerprint check ACTIVE                                                                           |
| PostgreSQL crash markers                |              **0** |      — |       — | across 10 full runs (R2-2)                                                                         |

### Failure classification — reclassified after the crash was eliminated

The SIGSEGV was destroying whole suites mid-run, so every previous count was
measured through a broken instrument. With it gone the numbers are stable and
mean something. Registry passes moved **213 → 312 → 327 → 338 → 343** as M-4,
the crash fix, and a leaked test-clock policy row were each removed.

1. **ALL 7 registry test failures are D-12**, one environmental cause:
   `postgres` holds `supabase_admin`-granted memberships in the NOLOGIN governor
   roles. That single fact produces every one of them — 3 × "no login role holds
   a NOLOGIN authority" (the assertion is correct and the condition is real),
   2 × `permission denied to set role` (the grants carry `set_option = false`),
   and 2 × a privilege that should be refused succeeding through inheritance.
   `postgres` cannot revoke a `supabase_admin` grant; this needs the container
   owner, not a migration.

2. **17 suite-level (`beforeAll`) failures are D-09**: 894 devices whose
   trusted-time status is not `trusted`, the population left by the R-1 exploit.
   The provisioning fixtures reuse them and are refused at setup. Correct
   behaviour, damaged fixture population, unrecoverable by design.

3. **D-14** — one firstboot test fails ~1 run in 6 on an ambiguous-board-evidence
   collision against the accumulated fleet. Diagnosed, fail-closed, not a product
   defect.

4. **A regression this stream introduced and then fixed:** the C-2 clock fixture
   leaked a `kitluy_ops.test_clock_policy` row and a harness role grant, leaving
   the sanctioned test clock ENABLED in the development database. Found by group
   0184's own governance suite. The helper now removes exactly what it installed,
   and the leaked row was deleted.

**None of these should be described as "the baseline" without the above.**

---

## 9A. Security Remediation — 2026-08-26

The independent Store Hub credential-path review returned **REJECTED**. This
section records what each finding was, what was done, and what proves it.

| Finding                                           | Before                                                                                                                                                                                                                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                 | Tests                                                                                                                                  | Status             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **C-1** certificate not bound to the governed key | `public_key_fingerprint` was COPIED from the credential into the artifact, so activation compared a value to its own source. A self-signed `CN=ATTACKER` certificate over an unrelated key was recorded and the device activated.                          | Group **0203**. An ASN.1 reader and an RSASSA-PKCS1-v1_5 verifier in PL/pgSQL: the door parses the leaf, computes the SPKI fingerprint from its DER, verifies the leaf under the PINNED issuing CA and that CA under the PINNED root, requires the supplied chain to be those anchors byte-for-byte, and stores the COMPUTED fingerprint. Anchors installed out of band by `scripts/pki/pin-dev-trust-anchors.mjs`. | `certificate-key-binding.adversarial` — 9, incl. a FALSIFICATION test that reproduces the original attack in a rolled-back transaction | **PASS**           |
| **C-2** caller chose certificate validity         | `prepare_device_credential_issuance_v1` assigned caller-supplied `p_trusted_time` straight to `not_before`, three lines under a comment claiming otherwise. The Hub filled it from its own `requestedAt`.                                                  | Group **0204**. Anchor comes from `kitluy_ops.authoritative_now_v1()`; trusted time re-established from the database's own state via `assert_trusted_time_v1`; `pg_catalog` moved to the FRONT of the search_path; R-1-style source and signature guards.                                                                                                                                                           | `server-authoritative-validity.adversarial` — 6 (+10y, −31d, epoch, year 9999, 2 structural)                                           | **PASS**           |
| **C-3** a bad first request bricked the Hub       | Generation 1 was spent before signing, and `abandon_generation_key_v1` could not free it because the slot index was not partial. A Hub that lost its private key was unrecoverable.                                                                        | Group **0205**. Partial unique index; registration and the promotion trigger skip abandoned keys; abandonment guarded against live identities; key algorithm validated before any irreversible write (`validateOperationalKey`, and `spki_algorithm_v1` in the door).                                                                                                                                               | `first-issuance-recovery.adversarial` — 8, incl. THE BRICK end-to-end and a not-a-backdoor test                                        | **PASS**           |
| **C-4 / D-07** separation of duty was false       | `service_role` inherited `kitluy_issuance_service`, `kitluy_activation_service` and `kitluy_device_certificate_issuer`, so one identity could mint and consume. Old assertions used `information_schema.role_table_grants`, which is blind to inheritance. | Group **0206**. Three NOINHERIT/NOLOGIN hinges (the 0173 pattern that had explicitly deferred these three), plus removal of the DIRECT grants the hinges cannot touch. Every assertion now uses `has_function_privilege`.                                                                                                                                                                                           | Apply-time effective-privilege guards; §5 of the final report                                                                          | **PASS**           |
| **C-5** activation was advisory                   | `service_role` held UPDATE on `devices` and moved `awaiting_trust → active` in one statement. Reproduced before the fix.                                                                                                                                   | Group **0207**. Privilege revoked (SELECT retained) AND a transition guard refusing any move into `active` not made by `kitluy_activation_governor`.                                                                                                                                                                                                                                                                | Direct probes: `service_role` → permission denied; `postgres` → `KLUY-DEVICE-ACTIVATION-AUTHORITY`                                     | **PASS**           |
| **H-1** generation pre-emption                    | The door checked the environment and the slot. Not that the device existed, was issuable, un-quarantined, or assigned to a Store. Generation was taken on trust.                                                                                           | Group **0208**. Device existence, lifecycle state, quarantine, live Store assignment; generation must be reachable from the governed head.                                                                                                                                                                                                                                                                          | `generation-artifact-serial.adversarial` — 5 H-1 cases incl. PRE-EMPTION                                                               | **PASS**           |
| **H-2** artifact idempotency                      | `device_certificates_credential_idx` was NOT unique, so two concurrent recordings could both pass the existence check and the loser saw a raw 23505.                                                                                                       | Group **0208**. A real UNIQUE index on `credential_id`, and `ON CONFLICT DO NOTHING` + re-read.                                                                                                                                                                                                                                                                                                                     | 3 concurrent recordings → all `ALREADY_RECORDED`, one row                                                                              | **PASS**           |
| **M-1** serial truncation                         | The leaf's serial was `('00' + hex(serial)).slice(0, 40)`, silently dropping the last byte. Every certificate ever issued named a serial that was not the credential's.                                                                                    | Group **0208** + `x509SerialForCredential`. One canonical mapping in both SQL and TypeScript, minimal DER form; the door RECOMPUTES the serial from the leaf's own DER and refuses a mismatch.                                                                                                                                                                                                                      | Mapping agreement across 4 serial shapes; round-trip from the issued certificate                                                       | **PASS**           |
| **M-2** revocation did not reach the artifact     | Revoking a credential left the certificate `active`, chaining to the pinned root, inside its window.                                                                                                                                                       | Group **0209** trigger, plus the Authority Key Identifier the leaf never carried.                                                                                                                                                                                                                                                                                                                                   | 2 tests: revocation propagates; AKI equals the issuer's SKI                                                                            | **PASS (partial)** |
| **M-3** PKI custody                               | Key file modes were checked; the DIRECTORY was not, so a key file could be replaced without writing to it. No local chain pin.                                                                                                                             | `assertDevPkiDirectoryMode` at load and at every signature; a `node:crypto` chain self-check before recording.                                                                                                                                                                                                                                                                                                      | Covered by the issuance suites                                                                                                         | **PASS**           |
| **M-4** hardcoded test target                     | 38 files hardcoded `:54322`, a different project.                                                                                                                                                                                                          | `@kitluy/dev-database`, 36 files repointed, `pnpm dsn:check` guard.                                                                                                                                                                                                                                                                                                                                                 | Registry passes 213 → 282                                                                                                              | **PASS**           |

**M-2 is partial and deliberately so.** The offline mTLS revocation signal —
how a Store Hub with no WAN decides a peer's certificate is revoked (snapshot
cadence, signing key, posture when the snapshot is stale) — is an owner decision
that does not exist. It is `[REQUIRED: offline_mtls_revocation_signal]` and it
BLOCKS the LAN mTLS milestone, not this one. It was not guessed.

### What this pass did NOT do

- It did not touch `has_permission` resource scoping, production TPM/HSM, HSA,
  Laundry T1–T4, terminal provisioning, or Hub LAN packaging.
- It did not fix the 24 seed/fixture failures §9 newly exposes.
- It did not self-approve. See §17.

---

## 9B. Second Security Remediation (R2) — 2026-08-27

The second independent credential-path review returned **APPROVED WITH REQUIRED
FIXES**. C-1…M-4 were independently verified as remediated; four new findings
were raised and are closed below.

| Finding                        | Before                                                                                                                                                                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                             | Status   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **R2-1** X.509 serial encoding | `x509SerialForCredential` prefixed `00` unconditionally, so a serial whose significant bytes already began `00` produced two leading zeros and OpenSSL refused the certificate (`illegal padding`, ~1 in 256). The SQL half stripped ALL leading zeros and never added a sign byte — wrong in the other direction, producing a NEGATIVE integer. The test hid both by normalising with `.replace(/^(00)+/, "")`. | Group **0210**. One rule in both languages: strip leading zero bytes, then add exactly ONE sign byte only when the leading byte is >= 0x80. The door now reads the serial VERBATIM — group 0208 read it through a stripping helper and was structurally blind to the defect. A reversible inverse exists for the revocation projection.                                                                                                     | `serial-canonicalization.adversarial` — 5 tests over 13 byte shapes and 8 DEV serials, differential against DER / Node / OpenSSL, plus a falsification test showing the old encoder really was rejected                                              | **PASS** |
| **R2-2** PostgreSQL SIGSEGV    | A permission-denied function call in `kitluy_devices` crashed the backend and restarted the cluster. Reproduced once, deliberately, before anything was changed.                                                                                                                                                                                                                                                 | **PLATFORM remediation, not an authorization change.** `supautils.hint_roles` — documented by the extension as "roles that receive enhanced permission hints", i.e. the text of an error message — emptied by `pnpm db:dev:supautils-workaround`. `supautils.reserved_roles`, which carries the real security property, is untouched and asserted. Removing `service_role` alone was NOT enough: `anon` and `authenticated` crashed it too. | 0 crash markers across 10 full runs; 25/25 denials still return 42501; `privilege-denial.security.test.ts` proves denial through `has_function_privilege` and never through a crash                                                                  | **PASS** |
| **R2-3** AlgorithmIdentifier   | The verifier used a SUBSTRING search for the OID, and never compared the TBS `signature` to the outer `signatureAlgorithm`.                                                                                                                                                                                                                                                                                      | Group **0211**. EXACT DER equality against `300d06092a864886f70d01010b0500`, AND inner == outer. The issuer SPKI is pinned to `rsaEncryption` exactly. The RSA mathematics and the PKCS#1 exact-block comparison are UNCHANGED — they passed independent review.                                                                                                                                                                            | `algorithm-identifier.adversarial` — 9 tests: mismatch in both directions, wrong OID, absent parameters, trailing junk, SHA-1 with the SHA-256 OID hidden in the parameters, malformed. Falsified against the old rule, which accepted the mismatch. | **PASS** |
| **R2-4** silent skips          | The suites used `describe.skipIf(!live)` on a variable the documented commands never exported, so a reviewer could see a green run in which 42 security assertions were skipped.                                                                                                                                                                                                                                 | `test/support/security-gate.ts` throws at module load, before any test is collected. §18 now exports the PKI location, the canonical DSN, and the one-time setup.                                                                                                                                                                                                                                                                           | The gate fires: with the variable unset the suite FAILS with "FORMAL SECURITY SUITE CANNOT RUN — refusing to skip". With it set: 74 passed, **0 skipped**.                                                                                           | **PASS** |

### One regression found in this stream's own earlier work

The C-2 clock fixture leaked a `kitluy_ops.test_clock_policy` row and a harness
role grant, which left the sanctioned test clock ENABLED in the development
database. Group 0184's governance suite caught it. The helper now removes exactly
what it installed — and only what it installed — and the leaked row was deleted.

---

## 9C. Firstboot Operational TLS Client — 2026-08-28

**Status: IMPLEMENTED-IN-DEV.** Software evidence only; no Raspberry Pi has run it.

### Architecture

```text
local RSA-2048 key (generated once, /var/lib/kitluy/operational/, 0600)
  -> request state persisted BEFORE the first network call
  -> kitluy.csr.v1 signed with the local private key
  -> POST /v1/operational-certificate  (governed route -> governed doors)
  -> 17 device-side checks with node:crypto
  -> atomic adoption: certificate, then chain, then MANIFEST LAST
  -> activation continues through the existing governed path
```

### Local credential state machine

`ABSENT -> KEY_READY -> REQUEST_READY -> (ISSUED_UNVERIFIED) -> VERIFIED -> ADOPTED`

`ISSUED_UNVERIFIED` and `VERIFIED` are in-memory only, and deliberately so:
nothing is written to disk between receiving a certificate and verifying it, so
there is no on-disk state that means "a certificate arrived but was not
checked". `ADOPTED` requires the manifest AND both files AND the key.

### Idempotency

The request identity (`requestId`, `nonce`, `correlationId`, `requestedAt`,
key fingerprint, assignment generation) is written before the first call, so a
lost response replays byte-identically. Proven against the real door: the cloud
issued, the response was swallowed, the Hub rebooted, replayed, and adopted —
with **one** credential and **one** live generation key at the end.

### Test counts

| Suite                                                  |  Tests |
| ------------------------------------------------------ | -----: |
| `operational-key`                                      |     11 |
| `operational-csr-drift` (vs `@kitluy/device-identity`) |      3 |
| `operational-serial-drift`                             |      2 |
| `operational-certificate-verification`                 |     23 |
| `operational-tls-client` (recovery matrix)             |     27 |
| `firstboot-operational-tls.e2e` (real route + real DB) |      3 |
| **Total new**                                          | **69** |

### Zero runtime dependencies

`dependencies: {}`. The only non-builtin imports in the operational sources are
`node:crypto`, `node:fs` and `node:path`. node-forge is a TEST-only dependency
used to mint hostile fixtures, because `node:crypto` can parse X.509 and cannot
issue it; the image gate checks `dependencies` and still passes.

---

## 9D. Firstboot Client Packaged Into the Image — 2026-08-29

**Status: PACKAGED and gated. The image build itself is reported in §6.**

### What was added

| Component          | Canonical path                                                         |
| ------------------ | ---------------------------------------------------------------------- |
| Entrypoint         | `services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts`    |
| Shim               | `.../rootfs-overlay/usr/lib/kitluy/operational-tls`                    |
| Unit               | `.../rootfs-overlay/etc/systemd/system/kitluy-operational-tls.service` |
| Enablement         | `.../multi-user.target.wants/kitluy-operational-tls.service`           |
| Runtime directory  | `install -d -m 0700 "$1/var/lib/kitluy/operational"` in the layer      |
| Root pin injection | `IGconf_kitluy_development_root_sha256`, layer + `build-rpi-image.sh`  |
| Device closure     | 7 modules added to `DEVICE_MODULES` in `package-bootstrap-runtime.sh`  |

### Where it sits in the lifecycle, and why it is not collapsed

```text
registration -> HET approval -> Store pairing -> trusted time
  -> CERTIFICATE (kitluy-operational-tls) -> activation
```

`After=` pairing, because a certificate is a statement about a device that
belongs to a Store — asking earlier earns the correct refusal
`KLUY-KEY-NO-ASSIGNMENT` (group 0208). Deliberately **not** `Requires=` the
pairing console: the console is an interactive screen whose exit says nothing
about whether the Hub is paired, so the prerequisite is read from the pairing
STATE FILE instead — the fact, rather than a proxy for it.

### The development root pin

The Hub verifies against a PINNED root: a chain that verifies internally proves
only that it is SELF-CONSISTENT, so the pin is the only thing that makes it
ours. The digest is injected at BUILD time from `$KITLUY_DEV_PKI_DIR` and is
never committed — `assert-no-dev-pki.mjs` refuses development CA material in the
repository, and now carries ONE narrow exemption for
`/etc/kitluy/development-root.sha256` when that file contains nothing but a
digest. The same digest in any other path is still refused, and that narrowness
is asserted.

**A missing pin is safe:** the Hub logs `blocked: no development root pin` and
refuses to adopt anything, rather than adopting unverified.

### Three defects this milestone found — two of them in the packaging itself

**1. The Hub would have refused every certificate it was legitimately issued.**
The device's trusted time is an observation taken BEFORE the request; the
certificate's `notBefore` is stamped by the server when it issues. Real seconds
pass between them, so `notBefore > deviceTrustedTime` is the NORMAL case — and
the first version of check 11 refused it. Caught by the end-to-end suite under
load, not by reasoning. Fixed with a bounded five-minute allowance on
`notBefore` only; the expiry side keeps none, because erring toward "not yet
usable" is safe and erring toward "still valid" is not.

**2. The root pin was never injected.** The forwarding block in
`build-rpi-image.sh` was placed inside the `if [[ -n "$HARDWARE_PROFILE_KEY" ]]`
conditional, which does not run for a build that passes no profile key. The
first image therefore came out PINLESS and nothing said so. Found by grepping
the build log for the message the block should have printed. Moved to top level,
where the pin belongs — it has nothing to do with the profile key.

**3. The unit would have re-moded a directory four other units share.**
`StateDirectory=kitluy/operational` with `StateDirectoryMode=0700` creates BOTH
path components and applies the mode to the parent, so whichever unit started
first would decide the mode of `/var/lib/kitluy` — which the enrollment, health,
update and registration agents all declare at `0750`. Found by comparing the
built rootfs against the proven units. Now `StateDirectory=kitluy` at `0750`,
matching the siblings; the credential directory is created `0700` by the agent
and the key `0600`, where the requirement belongs and where tests enforce it.

### The original defect note

### A real defect this milestone found

The device's trusted time is an observation taken BEFORE the request; the
certificate's `notBefore` is stamped by the server when it issues. Real seconds
pass between them, so `notBefore > deviceTrustedTime` is the NORMAL case — and
the first version of check 11 refused it. A Hub would have refused **every**
certificate it was legitimately issued.

Caught by the end-to-end suite under load, not by reasoning. Fixed with a
bounded five-minute allowance on `notBefore` only; the expiry side keeps no
allowance at all, because erring toward "not yet usable" is safe and erring
toward "still valid" is not.

---

## 9D-1. The Built Image — 2026-08-29

**Built from the present working tree.** The 2026-08-24 artifact is superseded
and must not be used as current evidence.

| Field                                 | Value                                                    |
| ------------------------------------- | -------------------------------------------------------- |
| Build class                           | `DEVELOPMENT-CROSS-BUILD`                                |
| Builder                               | rpi-image-gen v2.7.0 (`a7b6d4806183`)                    |
| Git HEAD at build                     | `0a30a74`                                                |
| Working tree                          | **DIRTY** — 68 modified, 78 untracked; nothing committed |
| signed / releaseEligible / promotable | `false` / `false` / `false`                              |
| **bootTested**                        | **`false`** — no Pi has run it                           |
| Status                                | `DEVELOPMENT-UNSIGNED-NOT-RELEASE-ELIGIBLE`              |
| Schema the client expects             | **0212** (hosted is 0197 — see §9E)                      |

### Artifacts

| Path (under `infra/kitluy-store-hub-image/build/work/`)              |          Bytes | SHA-256                                                            |
| -------------------------------------------------------------------- | -------------: | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst`              |    985,964,002 | `7f5919ad3bc12f9f3c62e91eb9fad4d5feeed1498899a36887ebb322320cb691` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.sparse.zst`              |    652,989,898 | `ae99d3b36c8ebd878704687e75d7bcf1708dc205565116745a7e318e3dae6b16` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst`                     |    652,958,515 | `ff7c104a44fe42c570b4cb8515956b95487b59fb6cb069ede6289331598f497a` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img`        | 17,490,268,160 | `c2a097de03687e2ea3d9702be0167d5692c31f0ae014a1b4b21fcb4b57338912` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img.sparse` |    830,549,960 | `647cca4d99ca595f77029963e4033d3c256042ddd00da13f153de0870a39b125` |

### Rootfs verified

| Check                                                      | Result                                                |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| 7 operational modules + shim + unit + enablement           | present                                               |
| `/etc/kitluy/development-root.sha256`                      | present, `0644`, **matches the development root**     |
| `assert-no-dev-pki --root` with the pin present            | **PASS** — the narrow exemption works on a real image |
| Operational key / certificate / chain / manifest / request | **absent**                                            |
| Development CA private keys                                | **absent**                                            |
| `/etc/machine-id`                                          | **empty** — generated on device                       |
| SSH host keys                                              | **0** — generated on device                           |
| node-forge, `service_role` literal in the device closure   | **absent**                                            |
| Hub LAN agent                                              | **absent**, deliberately                              |

### Gates

`systemd-runtime` 145/0 · `build-gates` 32/0 · `rpi-image-gen` 22/0/1 skipped ·
image secret scan PASS · `secret:scan` PASS · `assert-no-dev-pki` PASS on tracked
files **and** on the built rootfs.

> **BLK-005 remains open.** This image is DEVELOPMENT, UNSIGNED and NOT
> release-eligible. It must not be promoted to PILOT or STABLE.

---

## 9D-2. Fresh Image Build — 2026-08-26 14:31–14:53 (SUPERSEDES §9D-1)

**Built from the working tree as it stood at 14:31 on 2026-08-26.** The artifacts
recorded in §9D-1 and the intermediate 12:15 build are both superseded and must
not be quoted as current evidence.

| Field                                 | Value                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| Build started / completed             | `2026-08-26T14:31:48+07:00` / `2026-08-26T14:53:31+07:00`         |
| Build class                           | `DEVELOPMENT-CROSS-BUILD` (x86_64 host, QEMU)                     |
| Builder                               | rpi-image-gen v2.7.0 (`a7b6d4806183195f3efadb533f58c8e46393d057`) |
| Git HEAD at build                     | `0a30a74`, branch `claude/fix-firstboot-esm-and-ssh-hostkeys`     |
| Working tree                          | **DIRTY** — 68 modified, 77 untracked; nothing committed          |
| signed / releaseEligible / promotable | `false` / `false` / `false`                                       |
| **bootTested**                        | **`false`** — no Pi has run it                                    |
| Status                                | `DEVELOPMENT-UNSIGNED-NOT-RELEASE-ELIGIBLE`                       |

Build command (the pin comes from the exported `$KITLUY_DEV_PKI_DIR`, see §18.0):

```bash
KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub \
bash infra/kitluy-store-hub-image/scripts/build-rpi-image.sh \
  --profile store-hub \
  --registration-url https://gjgbnkhuwlwhngbtrgts.supabase.co/functions/v1/device-registration \
  --hardware-profile-key CLOUD-HUB-PI5 \
  --enrollment-url http://172.16.21.17:8787
```

### Artifacts — SHA-256 recomputed directly from the new files, not copied

| Path (under `infra/kitluy-store-hub-image/build/work/`)              |          Bytes | SHA-256                                                            |
| -------------------------------------------------------------------- | -------------: | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` **(flash this)**    |    652,959,133 | `15e5f1367d7790890388012b91b56c39773d78f15f96f2cf9f9f39c3fe11c1bb` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img`        | 17,490,268,160 | `185a44a7cfd352aa9517b3ef887242f7355b37e7cfb431faa7ca7a255bcc1080` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.sparse.zst`              |    652,993,128 | `a457051c93d128b99fb767e3ce8946420a1197aef066a5690d57328c387a01b8` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img.sparse` |    830,549,960 | `1bf518d66b5ce9ae69c13aa6f4b79c73a43bedb08acf8d6f4f4e27fcef30d693` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst`              |    985,966,742 | `d8807c1b12d372030e94cf302fa084ad5f23ad4b23138ba550cd1b366254b18d` |

Minimum SD card: **32 GB**. The raw image is a fixed 17,490,268,160-byte whole
disk; a nominal 16 GB card is ~15.9 GB and cannot hold it. `persistent` is
`expand-to-fit`, so a larger card is used, not wasted.

### The defect this build existed to catch

**The 2026-08-26 12:15 build came out PINLESS.** `/etc/kitluy/development-root.sha256`
was absent from its chroot, because `KITLUY_DEV_PKI_DIR` was not exported for that
run. This is handoff defect #2 of §9D recurring through a different route: the
build script's `else` branch warns and continues — correctly, since ABSENT IS SAFE —
but a warning halfway up a build log changes nothing for whoever flashes the card.
A Hub flashed from that artifact would have logged `blocked: no development root pin`
and refused every certificate it was legitimately issued.

The fix is procedural, not code: `$KITLUY_DEV_PKI_DIR` must be exported before
`build-rpi-image.sh`, and the build log line `development root pinned into the
image:` must be **read**, not assumed. This build logged
`b115609ad754dacf...` and the pin is present in the rootfs.

### Rootfs verified — against the ACTUAL new tree, every path proven to exist first

| Check                                                             | Result                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| 7 operational modules + shim + unit + `multi-user.target.wants`   | present                                                       |
| `/etc/kitluy/development-root.sha256`                             | present, `0644`, digest-only, **matches the approved root**   |
| `assert-no-dev-pki --root` (18,473 files, 300 certs parsed)       | **PASS**, fingerprint check ACTIVE                            |
| Operational key / leaf / chain / manifest / request state         | **absent**                                                    |
| Development CA private keys                                       | **absent**                                                    |
| `/etc/machine-id`                                                 | present and **empty**                                         |
| SSH host keys / snakeoil key                                      | **0** / **absent**                                            |
| `service_role` literal in the device closure                      | **absent**                                                    |
| Hub LAN agent unit + binary                                       | **absent**, deliberately                                      |
| Runtime imports                                                   | `node:child_process crypto fs os path readline/promises` only |
| `node-forge` imported anywhere in the closure                     | **no** (one comment mention)                                  |
| Recovery access (`persistent.ext4:/home/pi/.ssh/authorized_keys`) | one **ssh-ed25519 PUBLIC** key, mode `0600`, `.ssh` `0700`    |

**Where the writable state actually lives.** `/var/lib/kitluy` does NOT exist in
the system slot — `/var/lib` is stateless in the read-only EROFS root. The runtime
directory contract is in the persistent partition, once per A/B slot, at
`persistent/slots/system_{a,b}/var/lib/kitluy`: parent `0755`, `operational` `0700`
and **empty**, siblings `identity`/`enrollment`/`health`/`update`/`terminal` `0700`,
`hub` `0755`. Anyone re-checking this must look there — a `find` against
`filesystem/var/lib/kitluy` returns nothing and that nothing means nothing.

The §9D defect-3 regression has NOT returned: `kitluy-operational-tls.service`
declares `StateDirectory=kitluy` at `0750`, matching its four siblings, and no
unit declares `kitluy/operational`.

### Lifecycle order, read off the built units

```text
kitluy-firstboot           After=local-fs.target
kitluy-cloud-registration  After=firstboot, network-online   Requires=firstboot
kitluy-hub-pairing         After=firstboot, enrollment-agent
kitluy-operational-tls     After=firstboot, cloud-registration, hub-pairing,
                                 network-online              Requires=firstboot
```

`kitluy-operational-tls` is `After=` pairing and never `Requires=` it, and reads
the pairing STATE FILE rather than the console's exit. `Requires=` names only
`kitluy-firstboot`, so once adopted the unit exits 0 and **WAN is not a boot
dependency**. Before pairing exists the unit polls and must NOT generate an RSA
key — the golden image ships the empty `operational` directory that proves it
has not.

### Gates

`systemd-runtime` 145/0 · `build-gates` 32/0 · `rpi-image-gen` 22/0/1 skipped ·
image secret scan 17/0 PASS · `secret:scan` PASS · `migrations:validate` PASS ·
`contracts:validate` PASS · `dsn:check` PASS · `assert-no-dev-pki` PASS on tracked
files **and** on the built rootfs · formal credential security gate **78/0/0** ·
firstboot-agent **409 passed, 9 skipped, 0 failed**.

Two honest classifications, neither a product defect and neither fixed here:

- **`operational-tls-client.test.ts` case 8 is FLAKY.** It failed once, then passed
  5/5 on re-run. `mintLeaf()` stamps validity from the wall clock and X.509
  `UTCTime` has one-second granularity, so the mock's second mint differs in DER
  whenever the two calls straddle a second boundary. The mock re-mints where the
  real governed door replays stored bytes; the byte-equality assertion is only
  accidentally true. Device code is not involved.
- **`rpi-image-gen.test.sh` class-2 fails when enabled.** With `KITLUY_RIG_UPSTREAM`
  set, "KitLuy configs use only keys present in the pinned upstream configs"
  reports `kitluy-store-hub:pubkey_only` and `kitluy-store-hub:ssh` as unknown.
  They are NOT unknown: `ssh.pubkey_only` is declared in the pinned tree at
  `layer/net-misc/openssh-server.yaml` (`X-Env-Var-pubkey_only`, `Valid: bool`)
  and consumed at line 52 (`igconf isy ssh_pubkey_only`); the build log confirms
  `CFG IGconf_ssh_pubkey_only=y`. The test's reference corpus is upstream's
  example _config files_, and this key is only demonstrated in upstream's _docs_
  and `examples/README.md`. A test-corpus gap, not a config defect. The sanctioned
  invocation skips class 2 entirely, which is why the recorded baseline is 22/0/1.

### Hardware status

**NOT TESTED.** `bootTested: false`. Hosted development remains at **0197**;
certificate issuance and certificate-backed ACTIVE need hosted behaviour through
**0212**. This artifact must not be described as proving certificate installation,
ACTIVE, WAN-offline operational identity, or `HARDWARE_E2E`.

> **BLK-005 remains open.** DEVELOPMENT, UNSIGNED, NOT release-eligible. It must
> not be promoted to PILOT or STABLE.

---

## 9E. Hosted-Development Deployment Delta — VERIFIED, NOT DEPLOYED

**HOSTED DEPLOYMENT REQUIRED: YES.** Owner authorization was granted 2026-08-26.
The deployment did **not** proceed — see "Why it stopped" below. No hosted write
was made.

### Hosted state — MEASURED 2026-08-26, no longer "believed"

Read through the Supabase CLI, which is independently authenticated on this
workstation and could see the project without any stored credential being read.

| Fact                      | Value                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Project                   | `kitluy-project-pos` / `gjgbnkhuwlwhngbtrgts` (the canonical cloud development project) |
| Remote-applied migrations | **96**                                                                                  |
| Hosted HEAD               | `20260817090000` = **0197** — exactly as expected                                       |
| Local rows                | 111                                                                                     |
| Delta (local-only)        | **15**, contiguous                                                                      |
| Remote-only rows          | **0** — nothing hosted is missing locally                                               |

The delta is exactly `0198 … 0212`:

```text
20260822090000 (0198)   20260826090000 (0203)   20260826140000 (0208)
20260824100000 (0199)   20260826100000 (0204)   20260826150000 (0209)
20260824140000 (0200)   20260826110000 (0205)   20260827090000 (0210)
20260825090000 (0201)   20260826120000 (0206)   20260827100000 (0211)
20260825110000 (0202)   20260826130000 (0207)   20260828090000 (0212)
```

> The earlier D-03 worry that local and hosted "both report 96 rows with
> different heads" is RESOLVED and was a misreading: hosted has 96 APPLIED of the
> same 111-row local set, and zero remote-only rows. The sets are not divergent;
> hosted is simply 15 behind.

### Trust anchor identity — two of three legs verified

| Leg                                                | Fingerprint         | Result                 |
| -------------------------------------------------- | ------------------- | ---------------------- |
| Image pin (`/etc/kitluy/development-root.sha256`)  | `b115609a…2001313e` | —                      |
| Local approved development root                    | `b115609a…2001313e` | **MATCH**              |
| Local database anchor `development_root`           | `b115609a…2001313e` | **MATCH**              |
| Local database anchor `development_device_issuing` | `4c240ab0…fff37c8a` | —                      |
| **Hosted anchors**                                 | —                   | **NOT YET APPLICABLE** |

Hosted cannot hold anchors yet: `pki_pinned_trust_anchors` is created by group
**0203**, which is in the undeployed delta. After deployment the anchors must be
registered (governed door, public certificate material only) and must match the
fingerprints above, or every certificate will be issued successfully and then
REFUSED by the device on verification check 6.

### N-3 does NOT block this deployment

N-3 is a RE-APPLICATION defect. Group 0210 patches
`record_operational_certificate_v1` in place and guards itself by requiring the
door's source to contain `asn1_integer_bytes_v1(v_serial_tlv)` — text introduced
by group **0208**, exactly once. On a clean `0197 → 0212` sequence 0208 creates
it and 0210 patches it, so the precondition holds.

Reproduced locally, where the schema is already patched: re-applying 0210 raised
`KLUY-MIGRATION-0210: the artifact door does not read the serial the way group
0208 left it` and the transaction aborted **with the door intact**. It fails
SAFE.

### WHY IT STOPPED

`KITLUY_HOSTED_DEV_DB_URL` was **not supplied to the session**, and the
repository's sanctioned deployment command requires it.

`../../local-config/het-kitluy-project/supabase.env.local` does hold a
`KITLUY_SUPABASE_DB_PASSWORD`, and a DSN could be assembled from it plus the
project ref and the CLI's cached pooler URL. That is precisely what the owner
instruction forbids — _"Do NOT construct a DSN from stored passwords or
fragments"_ — and what `CLAUDE.md` forbids independently. It was not done.

Two substitutions were considered and REJECTED:

1. **`supabase db push --linked`** — would deploy, but bypasses the repository
   wrapper's exact-project allowlist, downgrade refusal, post-deploy ledger
   verification and `REFUSED-INCOMPLETE` handling. Those protections exist
   because of real incidents; dropping them to work around a missing credential
   trades a safety mechanism for convenience.
2. **Editing `db-deploy-hosted-dev.mjs` to accept `--linked`** — modifying a
   safety-critical deployment tool during the deployment it governs. Worse than
   the first.

The correct unblock is one line from an operator, not a workaround.

---

## 9F. Hosted-Development Trust-Anchor Bootstrap — BUILT, NOT RUN (2026-08-26)

Repository-side prerequisite only. **No hosted write of any kind was made**;
the hosted ledger is still 96 / `20260817090000` (0197) and
`pki_pinned_trust_anchors` still does not exist there.

### The 0203 authority question, answered from the catalog

The migration comment says the door is "reachable only by a superuser". That
describes the intent and NOT the mechanism, and the difference decides whether
hosted needs a new migration. Measured on the local database, where 0203 IS
applied:

| Object                                 | Fact                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `register_development_trust_anchor_v1` | owner `postgres`, `prosecdef = t`, `proacl = postgres=X/postgres`   |
| `pki_pinned_trust_anchors`             | owner `postgres`, `relrowsecurity = t`, `relforcerowsecurity = t`   |
| table ACL                              | `postgres=arwdDxtm/postgres`, `kitluy_credential_issuer=r/postgres` |
| policies                               | **one**, `polcmd = r` (SELECT), for `kitluy_credential_issuer`      |
| INSERT policy                          | **none at all**                                                     |

SECURITY DEFINER runs the body as `postgres`, which holds INSERT in the ACL.
FORCE RLS applies to the owner too and there is no INSERT policy — so the write
survives only because **`postgres` carries `rolbypassrls = t`**. That attribute,
not superuser status, is the mechanism: `postgres` is `rolsuper = f` on BOTH the
local container and the hosted project, and the local pin demonstrably succeeds
(both anchors present, `ALREADY_PINNED` on replay).

Hosted `postgres` and local `postgres` were compared attribute by attribute and
are identical — `rolsuper=f`, `rolbypassrls=t`, `rolcanlogin=t`, `rolinherit=t`.

**Therefore hosted needs NO new migration and no new grant. The hosted target
remains 0212.** The existing governed door is reachable once 0203 is deployed.

`service_role`, `anon` and `authenticated` hold no EXECUTE on the door and no
privilege on the table; `service_role` carries `rolbypassrls = t` but BYPASSRLS
is not a table privilege and grants it nothing here.

### What was built

| File                                           | Change                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `scripts/pki/trust-anchor-bootstrap.mjs`       | NEW — target resolution and public trust material, as pure functions             |
| `scripts/pki/pin-dev-trust-anchors.mjs`        | CLI rewritten over the module; `--hosted-development` added                      |
| `scripts/pki/trust-anchor-bootstrap.test.mjs`  | NEW — 27 assertions, no database of any kind                                     |
| `scripts/database/verify-hosted-supautils.mjs` | NEW — read-only supautils verification, refuses to bless the probe               |
| `package.json`                                 | two scripts added (`pki:bootstrap-anchors:check`, `supautils:verify:hosted-dev`) |

Hosted requires ALL of: the explicit `--hosted-development` flag, a separate
`KITLUY_HOSTED_DEV_DB_URL`, the existing allowlist in `hosted-dev-target.mjs`
(reused, not restated), and the approved digests supplied out of band. Default
behaviour is unchanged and still refuses any non-local target.

### Why the approved digests are NOT in the repository

`assert-no-dev-pki.mjs` refuses development CA fingerprints anywhere in the tree,
exempting only `/etc/kitluy/development-root.sha256` when that file is nothing
but a digest. Hardcoding `b115609a…` or `4c240ab0…` in a script would break that
guard for the reason it exists. So the operator supplies them
(`KITLUY_DEV_ROOT_SHA256`, `KITLUY_DEV_ISSUING_SHA256`) and the bootstrap
COMPUTES the real digest from the certificate bytes and compares. Two sources
must agree; either disagreeing fails closed, **before a connection is opened**.

Private keys never enter the path: an unapproved basename is refused before the
file is read (asserted with an injected reader that records zero opens), and an
approved basename whose content carries a PRIVATE KEY block is refused too.

### Supautils — NOT YET REMEDIATED, external platform blocker

Re-measured today, read-only: `supautils.hint_roles` is still
`anon, authenticated, service_role` (`source=configuration file`,
`context=sighup`, `pending_restart=false`); `reserved_roles` is byte-for-byte
unchanged; `session_preload_libraries = supautils`; server build identical to the
image measured crashing. `HOSTED_SUPAUTILS_SAFE = FALSE`.

One nuance worth recording: the probe's target
`kitluy_devices.record_operational_certificate_v1` does not exist on hosted yet,
so the crash is not reachable there **today**. It becomes reachable the moment
0202/0203 land — which is precisely why the supautils change must precede the
deployment, not follow it.

`pnpm supautils:verify:hosted-dev` is the read-only gate for that change. It
checks `hint_roles` is empty, `reserved_roles` is byte-for-byte unchanged against
the captured value, and `pending_restart = false`, then checks authorization
posture from the catalog with `has_function_privilege` — which resolves
inheritance and makes no call. It does NOT run the denied-function probe, and
prints `HOSTED_SUPAUTILS_SAFE = FALSE` with a non-zero exit until `hint_roles`
is empty.

### Both blockers, explicitly

Hosted physical ACTIVE proof needs BOTH, and neither is satisfied:

1. `HOSTED_SUPAUTILS_SAFE = TRUE` — **FALSE**, external platform change pending
2. `HOSTED_TRUST_ANCHOR_BOOTSTRAP = APPROVED` — built and tested, **awaiting
   independent review**

Until both hold: no hosted deployment, no hosted credential smoke test, no
physical certificate-backed ACTIVE claim. The Raspberry Pi DEVELOPMENT image
(§9D-2) is unaffected and may still be flashed and booted.

---

## 9G. H-1 Remediated — the Host Is the Target (2026-08-27)

Independent security review returned **APPROVED WITH REQUIRED FIXES**. H-1 was
the first required remediation and is the only one done in this pass. H-2 and
M-1…M-5 remain OPEN and were deliberately not started.

**No hosted write, and no hosted connection at all.** Hosted is still 96 / 0197.

### The defect

`hosted-dev-target.mjs` derived the project reference from the **PostgreSQL
username** and returned on the first match, never looking at the host:

```js
const pooled = /^postgres\.([a-z0-9]{20})$/i.exec(user);
if (pooled !== null) return pooled[1].toLowerCase(); // host never consulted
```

So `postgres.gjgbnkhuwlwhngbtrgts@evil.example.net:5432` was classified as the
approved project, **announced** as `kitluy-project-pos (gjgbnkhuwlwhngbtrgts)`,
and then dialled — at an attacker's machine, carrying the hosted database
password. A confused deputy: a caller-supplied string decided identity and the
machine actually contacted was never checked. The credential is the payload.

Reproduced before the fix, all with the approved username:

| Host                                | Old guard              |
| ----------------------------------- | ---------------------- |
| `evil.example.net`                  | **APPROVED**           |
| `127.1`, `2130706433`, `0x7f000001` | **APPROVED**           |
| `[::1]`, `[2001:db8::1]`            | **APPROVED**           |
| `127.0.0.1`                         | refused (the only one) |

`isLocalUrl` matched the literal string `127.0.0.1` and missed every other
spelling of loopback.

### The fix

The **host is validated first**, against an **exact allowlist** — not a grammar,
not a suffix test, not a substring. `endsWith(".supabase.com")` is satisfied by
an attacker-registered subdomain; `===` is satisfied by exactly one machine. The
approved pooler host is a literal because the repository already documents it
(CLAUDE.md pins `aws-0-ap-southeast-1.pooler.supabase.com:5432`), and the
configured DSN was verified to match it exactly.

Canonical contract, all of which must hold:

| Limb        | Required                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------- |
| scheme      | `postgresql:` or `postgres:`                                                                   |
| host        | `aws-0-ap-southeast-1.pooler.supabase.com` **or** `db.gjgbnkhuwlwhngbtrgts.supabase.co`, exact |
| port        | `5432` — 6543 is transaction mode, cannot run DDL, refused not coerced                         |
| database    | `postgres`                                                                                     |
| username    | pooler: `postgres.<ref>`; direct: `postgres` or `postgres.<ref>`                               |
| reference   | pooler: username; direct: host AND username, and they must AGREE                               |
| environment | exactly `development`                                                                          |

No reference found in the username, password, path or query may rescue a host
that is not on the list. L-5 is closed as part of canonical parsing: a malformed
percent-encoded username fails closed through the governed refusal path instead
of raising an uncaught `URIError`.

`isLocalUrl` now decodes IPv4 in every spelling — dotted-quad, shorthand,
decimal, hex, octal — and the IPv6 loopback forms, by DECODING the leading octet
rather than string-matching. Non-loopback IP literals refuse as
`HOST-NOT-APPROVED`, which is the honest code for them.

### Proof

`pnpm db:deploy:hosted-dev:check` → **62 passed, 0 failed** (was 25).

Every refusal asserts THREE things: that it refused, WHICH rule refused, and
that **zero connection attempts** were made — `net.connect` is monkey-patched to
count rather than perform. A guard that refuses after opening the socket has
already lost the credential.

The credential-exfiltration proof uses a real TCP listener on loopback and a
canary credential: listener connections **0**, canary bytes on the wire
**none**, canary absent from stdout, stderr, error message and stack, full DSN
absent from all output. Both real callers were run as processes against
`evil.example.net` and both refused with `KLUY-DEPLOY-HOST-NOT-APPROVED` before
any I/O — **zero DNS lookups**, so a refused host is never even resolved.

The real configured hosted DSN still parses as ALLOWED (pooler, 5432, postgres,
0 DNS lookups), so hosted dry-run target parsing remains functional.

### Deliberately NOT done

- **H-2 (TLS posture)** — OPEN. Query parameters are now parsed canonically and
  REPORTED as `observedQueryParameters`, so H-2 has the observation, but nothing
  here rewrites or asserts on them.
- **M-1 (unset environment)** — OPEN, and now documented by a test. The guard
  refuses anything that is not exactly `development`; the defect is that BOTH
  callers default an unset `KITLUY_ENV` to `development`. Test H1-24 asserts the
  defaulting is still present in both, so H-1 closure cannot be mistaken for M-1
  closure.
- M-2…M-5 and L-1…L-9 (except L-5, above) — untouched.

---

## 9H. H-1 Re-opened, Then Closed at the Consumer (2026-08-27)

A third, narrow confirmation pass was run against §9G. It aimed 77 independent
adversarial cases at `hosted-dev-target.mjs` and **could not break the guard** —
host isolation, loopback in every spelling, project identity and L-5 all held,
each refusal making zero DNS lookups and zero connection attempts.

H-1 was nevertheless **STILL OPEN**, because the guard was never the gap.

### The defect — a consumer that never called the guard

`scripts/database/verify-hosted-supautils.mjs`, added by the §9G pass itself and
wired into `package.json` as `supautils:verify:hosted-dev`, read
`KITLUY_HOSTED_DEV_DB_URL` and called `new pg.Client({ connectionString }).connect()`
while **importing nothing from `hosted-dev-target.mjs`**.

READ-ONLY against the database says nothing about what is handed to the HOST.
PostgreSQL cleartext authentication surrenders the password to any listener that
answers the startup packet, so the original H-1 shape —
`postgres.<approved-ref>@evil.example.net` — still worked end to end through this
consumer. The confirming reviewer captured the canary credential in cleartext on
a listener they controlled.

§9G's exfiltration proof missed it because that proof named **two** callers and
ran them as processes. This was the third. **A hand-written list of callers
cannot notice the caller it does not name.**

### The fix

One import and one call, on the same governed path as `db-deploy-hosted-dev.mjs`,
before any socket is opened. `assertHostedDevTarget` performs no I/O, so a
refusal means nothing was dialled.

The refusal exits **2, not 1**: exit 1 from this script asserts
`HOSTED_SUPAUTILS_SAFE = FALSE`, which is a measurement. A refused target
measured nothing and must not be reported as a supautils verdict.

`hosted-dev-target.mjs` was **NOT modified**. It withstood the pass.

### Proof

A positive control came first: the pre-fix file, reconstructed by removing only
the guard, against a listener speaking enough of the PostgreSQL wire protocol to
answer the startup packet with `AuthenticationCleartextPassword`. It **captured
the canary**, 1 connection — so the harness genuinely works, and the guard call
is what stops it.

| Case                             | Exit | Refusal code                    | Listener conns | DNS / connect / TLS |    Canary    |
| -------------------------------- | :--: | ------------------------------- | :------------: | :-----------------: | :----------: |
| pre-fix control, our listener    |  —   | none — it connected             |     **1**      |          —          | **CAPTURED** |
| fixed script, same listener      |  2   | `KLUY-DEPLOY-LOCAL-TARGET`      |     **0**      |    **0 / 0 / 0**    |    absent    |
| fixed script, `evil.example.net` |  2   | `KLUY-DEPLOY-HOST-NOT-APPROVED` |     **0**      |    **0 / 0 / 0**    |    absent    |

Egress was counted **inside the child** — `dns.lookup`, `dns.resolve`,
`dns.promises.*`, `net.connect`, `net.createConnection`,
`net.Socket.prototype.connect` and `tls.connect` — so "refused after connecting"
could not hide behind a non-zero exit code.

`pnpm db:deploy:hosted-dev:check` → **65 passed, 0 failed** (was 62). Three
assertions added:

| ID     | Asserts                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `X-12` | `verify-hosted-supautils` refuses `evil.example.net` with `HOST-NOT-APPROVED`, no credential in output |
| `X-13` | hosted-DSN consumers are enumerated **from disk**, not from a list — 5 found                           |
| `X-14` | **every** consumer of `KITLUY_HOSTED_DEV_DB_URL` routes it through `hosted-dev-target.mjs`             |

`X-14` is the structural repair, and it was **mutation-tested**: against the real
tree it reports 0 unguarded; against a tree where the pre-fix consumer is put
back it names exactly that file. It follows relative imports, so reaching the
guard indirectly counts — `pin-dev-trust-anchors.mjs` does so via
`trust-anchor-bootstrap.mjs`.

`X-13`/`X-14` read files with `fs`, **not `grep`** — see D-17.

### Deliberately NOT done — recorded, not fixed

- **H-1-b — `scripts/development/seed-hosted-dev-partner.mjs`** writes to hosted
  with no target guard. It assembles its DSN from the credentials file and
  ignores `KITLUY_HOSTED_DEV_DB_URL`, so it is **not** attacker-steerable through
  the environment and is not the H-1 shape; it checks only `deriveProjectRef`.
  It is therefore outside `X-14`'s reach. See D-18.
- **M-1** — the fix adds a third place defaulting an unset `KITLUY_ENV` to
  `development`, matching the two existing callers. M-1's eventual fix must cover
  all three.
- **D-17** (NUL bytes making a source file binary to `grep`) — found during this
  pass, not fixed.
- H-2 and M-2…M-5 — untouched, still OPEN.

### Verification actually run

`pnpm verify` **FAILS** (exit 1) on this tree, and did so for reasons unrelated
to this change: `Format check` aborts with `EACCES` scanning
`infra/kitluy-store-hub-image/build/work/chroot-v2.7.0/…` (a build artefact, not
a formatting fault — it prints "All matched files use Prettier code style!"),
`Lint` errors in `scripts/database/apply-dev-supautils-hint-workaround.mjs:77`,
`Unit tests` fail 2 files in `@kitluy/device-identity` because
`kitluy_credential_issuer` is already granted to this login by another session,
and `Docs link check` reports 4 broken links in a 2026-07-30 shared handoff.
Both files changed here pass `prettier --check` and `eslint` individually.

`pnpm pki:bootstrap-anchors:check` 27/0 · `pnpm secret:scan` PASS ·
`pnpm pki:assert-no-dev` PASS · `pnpm dsn:check` PASS.

**No hosted connection was made by this pass.**

---

## 9I. D-18 Remediated — the API Door (2026-08-27)

`seed-hosted-dev-partner.mjs` could write to hosted development without passing
through the centralized target guard. Fixed. **No hosted write was performed**;
one HTTPS request reached the hosted auth API during testing and is disclosed
below.

### What it was actually doing

The script has **two** destinations, and they were guarded very differently:

| Destination                                              | Before                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL DSN (pooler, built from the credentials file) | checked with `deriveProjectRef` only — project proven, **environment never checked**, so pilot/staging/production were not refusable |
| **Supabase Auth Admin API over HTTPS**                   | **NOT CHECKED AT ALL**                                                                                                               |

`KITLUY_SUPABASE_URL` was read, tested only for non-emptiness, and interpolated
straight into `fetch(\`${supabaseUrl}/auth/v1/admin/users\`)`carrying the
**SERVICE-ROLE KEY** in both`apikey`and`Authorization`. That `fetch`is the
FIRST network call the script makes — before`pg.Client`exists. A wrong or
hostile`KITLUY_SUPABASE_URL` handed full database-bypass authority to whatever
host it named, and nothing would have refused it.

### The fix

Both doors now assert through the ONE central module, before any I/O:

- **SQL door** — `assertHostedDevTarget({ dbUrl, environment, declaredProjectRef })`,
  the full H-1 canonical contract, unchanged and not duplicated.
- **API door** — a NEW `assertHostedDevApiTarget` in the same module.

`assertHostedDevTarget` was NOT reused for the API door. It validates a
PostgreSQL DSN — `postgresql:` scheme, pooler/direct database host, session-mode
port, database name, `postgres.<ref>` username — and none of those limbs exist
on an HTTPS origin. Fabricating a DSN to reach it would have validated a string
nobody connects to while the real request went elsewhere: the H-1 mistake in a
new costume. The two doors share the one thing that must never diverge —
`ALLOWED_HOSTED_DEV` — and `APPROVED_HOSTED_DEV_API_ORIGIN` is DERIVED from it
rather than written out a second time.

The API assertion **returns the canonical origin, and the caller builds requests
from that** instead of from the configured string. The script concatenates
(`${origin}/auth/v1/...`), so validating the raw value and then concatenating
onto it would leave everything the parser normalised away back in play.

**Environment is read, never defaulted.** An absent `KITLUY_ENV` REFUSES here
with an instruction to run `KITLUY_ENV=development pnpm dev:seed:hosted-partner`.
This is a NEW strictness on a path that previously had no environment concept at
all — it does not touch M-1, which is about three other callers that default an
unset value to `development`.

### Structural coverage — the actual lesson

H-1 was fixed correctly and was still incomplete, because a third consumer
(`verify-hosted-supautils.mjs`) had no guard and leaked a cleartext password to a
confirmer's listener. D-18 was the same story again. Twice the guard was right
and the COVERAGE was wrong.

`scripts/database/hosted-write-consumers.test.mjs` therefore **discovers**
consumers from disk — any file that names a hosted credential or host AND
constructs a network client must reach a central assertion — rather than
consulting a hand-maintained list that is wrong precisely when it matters.

It follows local imports one level, so delegation counts (`pin-dev-trust-anchors`
asserts through `trust-anchor-bootstrap.mjs`), but it deliberately does NOT
follow `hosted-dev-target.mjs` itself: that file contains the string
`assertHostedDevTarget(` because it DECLARES it, and concatenating it marked
every importer as guarded. That false-negative was caught and removed before the
test was trusted.

Current state: **5 consumers discovered, 0 unguarded.** Two are graded PARTIAL
and reported as a finding rather than a pass-in-disguise — `fleet-service.mjs`
and `seed-hosted-dev-scope.mjs` validate the project through `deriveProjectRef`
but assert no environment, so neither can refuse pilot/staging/production. **That
is a new finding, deliberately not fixed here.**

Mutation-tested: with both assertions neutralised in `seed-hosted-dev-partner.mjs`
the structural test exits 1 and names that exact file; restored byte-identical
(sha256 `91c6ebe3…` before and after).

### Proof

22-case adversarial matrix against the REAL script, run in a sandbox whose
credentials file holds canary values so the real hosted credentials are never
read. Every refusal: **DNS 0, sockets 0, fetch 0, credential bytes 0**, and no
canary in stdout, stderr, message or stack.

The approved-target control matters as much as the refusals: with the approved
origin the script DOES reach the network and gets `401` from the canary
service-role key — the TARGET was approved, the CREDENTIAL was not. That single
HTTPS request went to `https://gjgbnkhuwlwhngbtrgts.supabase.co/auth/v1/admin/users`
and is the one piece of hosted contact in this pass: rejected at authentication,
no database connection, no mutation. The same "does not blanket-refuse" property
is also proven in-process with **zero** I/O, so the claim does not rest on it.

`db:deploy:hosted-dev:check` 92/0 (was 65) · `hosted:consumers:check` 5/0 ·
`pki:bootstrap-anchors:check` 27/0 · secret-scan, dsn, migrations, contracts and
assert-no-dev-pki all PASS.

### `pnpm verify` FAILS — four failures, none from this work

| Check      | Cause                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format     | `prettier --check .` cannot `scandir` `build/work/chroot-v2.7.0/filesystem/persistent/home/pi` (mode 0700, subuid-owned image-build output). Prettier prints "All matched files use Prettier code style!" then exits 2 on EACCES.                         |
| Lint       | one error in `scripts/database/apply-dev-supautils-hint-workaround.mjs:77` (untracked, 2026-08-25), plus 8 pre-existing warnings                                                                                                                          |
| Unit tests | `@kitluy/device-identity` only — 2 files, both refusing because `kitluy_credential_issuer` is already granted to `postgres` (a stale borrow from an interrupted run). 899 passed, 23 skipped. The guard says not to revoke by hand, so it was left alone. |
| Docs links | 4 broken links in a 2026-07-30 handoff                                                                                                                                                                                                                    |

This pass changed four `.mjs` files and `package.json`. No TypeScript, no SQL, no
migration.

---

## 9J. D-20 Remediated — the Validated Server Is the Server Contacted (2026-08-27)

libpq/`pg` connection-string query parameters could override the host and port
that `assertHostedDevTarget` had just validated. Fixed centrally. **No real
hosted connection was made in this pass.**

### The baseline, reproduced before touching code

```
DSN   postgresql://postgres.<ref>:<canary>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
      ?host=127.0.0.1&port=<listener>
guard verdict            ALLOW  (reports aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres)
pg actually dialled      127.0.0.1:<listener>
listener connections     1
CANARY PASSWORD CAPTURED YES
```

Measured against `pg` directly, the overrides that work are `?host=` (including
`?host=%2Ftmp`, which redirects to a **UNIX socket**), `?port=` and `?user=`.
`?hostaddr=` and `?dbname=` are ignored by `pg` but honoured by libpq — and the
Supabase CLI links libpq, so the guard must not depend on which client reads the
string.

### Root cause

Validating the authority section and then handing the ORIGINAL string to the
client is not validation, because the client re-reads the query and lets it win.
The guard and the thing that actually connects were reading two different
documents.

### The fix, in two layers

**1. Fail closed on the query string.** An ALLOWLIST, not a blacklist — a
blacklist would have to enumerate every routing keyword libpq has now and every
one it gains later, and would be wrong the first time either changed.

- 27 routing/identity parameters refused: `host`, `hostaddr`, `port`, `dbname`,
  `database`, `user`, `username`, `password`, `passfile`, `service`,
  `servicefile`, `socket`, `unix_socket`, `requirepeer`, `target_session_attrs`,
  `load_balance_hosts`, `replication`, `options`, `krbsrvname`, `gsslib`,
  `gssdelegation`, `gssencmode`, `authtype`, `connect_timeout`,
  `client_encoding`, `application_name`, `fallback_application_name`.
- Unknown parameter → refuse. Duplicate parameter → refuse (which value wins is
  client-defined, and "it depends on the library" is not a security property).
- Names compared case-insensitively, and `searchParams` has already decoded
  percent-encoding, so `?HOST=`, `?Host=` and `?%68ost=` all land on `host`.

**2. The original string never regains control.** `assertHostedDevTarget` now
returns a `connectionConfig` (host/port/database/user/password as fields) and a
`canonicalConnectionString` rebuilt from the validated components plus the
allowlisted TLS parameters. Every consumer connects from those. The password is
carried but redacted by `toJSON` **and** the Node inspect hook, so
`console.log(target)` and `JSON.stringify(target)` both print `«REDACTED»`.

`canonicalHostedConnection()` applies the same query policy WITHOUT asserting an
environment. That is what lets `fleet-service.mjs` and `seed-hosted-dev-scope.mjs`
get D-20 protection while their environment gating — finding **D-19** — is left
untouched, as instructed.

### Consumers

| Consumer                      | Connects from                                                               | Raw DSN reused after validation |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| `verify-hosted-supautils.mjs` | `target.connectionConfig`                                                   | NO                              |
| `db-deploy-hosted-dev.mjs`    | `target.canonicalConnectionString` → `supabase --db-url`                    | NO                              |
| `pin-dev-trust-anchors.mjs`   | `target.connectionConfig` (via `resolveTarget`)                             | NO                              |
| `seed-hosted-dev-scope.mjs`   | `canonicalHostedConnection().connectionConfig`                              | NO                              |
| `fleet-service.mjs`           | hosted branch: `canonicalHostedConnection()`; local branch keeps its string | NO                              |
| `seed-hosted-dev-partner.mjs` | `sqlTarget.connectionConfig`                                                | NO                              |

`resolveTarget` no longer returns `dbUrl` for a hosted target at all — the field
is gone, so a caller cannot reach for it by habit.

The subprocess path mattered most: the Supabase CLI takes a string, so there is
no options object to hand it. It gets the **rebuilt** DSN. Instrumented
`spawn`/`exec*` confirms no override ever reaches a child process.

### Proof

34-case attack matrix, all refusing with **zero** DNS, TCP, TLS: every routing
parameter above, plus unix-socket redirection, case variants, percent-encoded
names, duplicates, empty values, unknown parameters, and TLS-plus-routing
combinations. Only `sslmode`, `sslrootcert` and `channel_binding` survive.

All five consumers RUN against the exploit DSN: **listener connections 0, DNS 0,
sockets 0, spawns 0, canary captured NO, no leak in stdout/stderr/message/stack.**

Positive control with `pg.Client.prototype.connect` mocked and zero real network:
dials `aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` as
`postgres.<ref>`.

`db:deploy:hosted-dev:check` 118/0 (was 92) · `hosted:consumers:check` 15/0 ·
`pki:bootstrap-anchors:check` 27/0.

### An honest note on the two new regression tests

The behavioural check runs each consumer against a redirecting DSN. The
structural check greps for raw-DSN reuse. **Mutation-testing showed they are not
interchangeable**: reintroducing `connectionString: DSN` in
`verify-hosted-supautils.mjs` did NOT make the behavioural check fail, because
layer 1 refuses the redirecting DSN before the client is ever built. Only the
structural check caught it. Both are kept and the test says so — one proves the
outcome, the other proves the defence in depth.

### What D-20 does NOT establish

D-20 says: the validated server is the server contacted. It says **nothing**
about whether that server is cryptographically authenticated. TLS posture is
**H-2, still OPEN**, and these parameters remain permitted for H-2 to govern:

```
sslmode  sslcert  sslkey  sslrootcert  sslcrl  sslcrldir  sslsni
sslcompression  sslpassword  ssl_min_protocol_version
ssl_max_protocol_version  channel_binding
```

`?sslmode=disable` is accepted today. Hosted DB transport is NOT secure merely
because D-20 is closed.

---

## 9K. A Re-flashed Store Hub Could Not Pair, and the Console Said the Wrong Thing (2026-08-29)

Reported from the field by the owner: the SAME Store Hub board, booted from a
NEW SD card, would not pair with the shop it had already been paired with.

### Why it refuses — correctly

The board is resolved from HARDWARE evidence (MAC, board serial, SoC serial) and
deliberately NOT from storage (`src/installation.ts`; runbook §E: "a reflashed
card stays the same board"). A new card is therefore a new INSTALLATION of the
SAME DEVICE, and the assignment created by its first pairing is still live. The
device sits at `awaiting_trust`, not `enrolled`.

Two different doors then refuse, and they are reached in this order:

1. **PRESENTATION — the one that actually fires in the field.**
   `evaluate_hub_pairing_session_v1` (0194) requires
   `device_class = 'store_hub' AND lifecycle_state = 'enrolled'`. An already
   paired Hub fails that test and is refused `KLUY-HUBSESSION-DEVICE-INELIGIBLE`
   — **and the attempt spends one of the session's five**. Five correct codes
   later the code is LOCKED, the console says "generate a NEW pairing code", and
   the new code locks the same way. That is the loop the owner was in.

2. **REDEMPTION** — reachable when a device is `enrolled` yet still holds a live
   assignment. `create_device_claim_v1` (0121) raises
   `KLUY-DEVICE-ALREADY-CLAIMED`, or `KLUY-DEVICE-OWNERSHIP-TRANSFER` for a
   different Store/Location.

**`KLUY-DEVICE-OWNERSHIP-TRANSFER` was mapped nowhere.** It fell through to
`INTERNAL_ERROR`, and the Hub console printed "Pairing could not be completed.
Check the network and try again." for a device whose network was fine.

### The remedy existed and was unreachable

0121's own hint names it: "Use `revoke_device_assignment_v1` with a named
operator. A device never changes owner as a side effect of a new claim." That
function is granted to `kitluy_fleet_governor` and, before this change, was
called from **nothing outside tests and the 0179 replacement doors**. There was
no operator surface at all — no management-API route, no Portal action — so a
re-flashed Hub required a psql prompt.

### What was changed

| Area                                                 | Change                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub-pairing-composition.ts`                         | New coarse result `ALREADY_ASSIGNED`; new `ASSIGNMENT_CONFLICTS` map checked BEFORE `REDEMPTION_REFUSALS`; `KLUY-DEVICE-OWNERSHIP-TRANSFER` mapped for the first time |
| `hub-pairing-routes.ts`                              | `ALREADY_ASSIGNED` → `RESOURCE_VERSION_CONFLICT`, with safe text that does NOT say "ask for a new one"                                                                |
| `bin/hub-pairing-ui.ts`                              | `ALREADY_ASSIGNED` case (holds 60s, does not exit into `Restart=always`); `CODE_REFUSED` now names the re-flash cause; `interpret` gained `holdSeconds`               |
| `pairing-state.ts`                                   | New `ALREADY_ASSIGNED` phase, so the screen still explains itself after a reboot                                                                                      |
| `scripts/development/unassign-hosted-dev-device.mjs` | **NEW.** `pnpm dev:device:unassign` — the operator surface for `revoke_device_assignment_v1`                                                                          |

**The console names the second cause; the SERVER still does not.** 0194 collapses
"wrong code" and "ineligible device" on purpose — `DEVICE-INELIGIBLE` is only
returned when the code MATCHED, so reporting it distinctly would hand any device
an oracle for discovering live pairing codes. The console leaks nothing by
describing what a refusal can mean, so the wording went there and the door was
left alone.

### The new script

Read-only without `--confirm`. Refuses any project but the allowlisted
development one and any environment but `development` (`assertHostedDevTarget`,
the FULL assertion — not `deriveProjectRef`), connects only to the rebuilt
`connectionConfig` (D-20), and requires `--reason` and `--operator`, both
recorded on the claim event. Borrows `kitluy_fleet_governor` with `set local
role` inside the transaction.

```bash
pnpm dev:device:unassign --asset-tag KL-6CBB3BC0D49B          # report only
pnpm dev:device:unassign --asset-tag KL-6CBB3BC0D49B \
  --reason SD_CARD_REFLASH --operator OP-VEASNA --confirm
```

### Verified

| Check                                            | Result                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `kitluy-device-firstboot-agent`                  | **416 passed, 0 failed**, 9 skipped                                                                                              |
| `hub-pairing.integration` + `hub-pairing-routes` | **25 passed, 0 failed**                                                                                                          |
| `kitluy-device-registry-service` (full)          | 302 passed, **7 failed** — all D-12, unchanged by this work                                                                      |
| `pnpm hosted:consumers:check`                    | **17 passed, 0 failed**; the new script grades GUARDED, not partial                                                              |
| `infra/.../systemd-runtime.test.sh`              | **146 passed, 0 failed**                                                                                                         |
| `pnpm secret:scan`                               | PASS (1,882 files)                                                                                                               |
| Guard refusals, exercised                        | wrong project, wrong environment, `?host=` redirect and `--confirm` without attribution all refuse with **0 connections opened** |

Image overlay repackaged: 30 JS files; only `bin/hub-pairing-ui.js` changed.

### EXECUTED — the board was released (2026-08-29, owner-run)

The owner ran the tool against hosted development. Measured before the write:

```text
Device ......... KL-6CBB3BC0D49B      Record id ... 4af4a1df-8021-4f86-8991-5caabe46fe60
Class .......... store_hub            Lifecycle ... awaiting_trust     Generation ... 2
LIVE ASSIGNMENT  42b327c5-3c5b-4dc6-8556-f9c63c5956e8
  state pending_trust   generation 2   DEMO-LAUNDRY-001 / DEMO-PP-01   created 2026-08-26T07:12:52.606Z
```

The first `--confirm` run FAILED at `set role`, and nothing was written. The
preflight added in response reports the authority instead of discovering it
mid-transaction, and it measured this on HOSTED:

```text
connected as . postgres
governor ..... member (SET NO, INHERIT NO)
may execute .. yes
```

**D-12's shape is not local-only.** `postgres` holds the
`kitluy_fleet_governor` membership on the hosted development project with BOTH
`set_option` and `inherit_option` false, so `set role` is refused there exactly
as it is in the container. `may execute` is nonetheless true because `postgres`
OWNS the door and the tables it writes.

So the borrow was never the mechanism, only a convenience. The script now
borrows when the membership permits and otherwise runs the door under the
session's own privileges — `revoke_device_assignment_v1` performs the same
checks under either authority. Second run:

```text
REVOKED. 1 assignment(s) closed.
Lifecycle ...... enrolled
Generation ..... 0  (0 = free to pair)
```

Re-read afterwards: `enrolled`, generation 0, no live assignment. The board now
satisfies 0194's gate and can present a pairing code again.

### CORRECTION — the revoke was real, and it was NOT the blocker (2026-08-29)

After the revoke the Hub STILL could not pair, and reported "Pairing could not
be completed. Check the network and try again." The cause was not the device
record at all.

**Two fleet services were running on this workstation, on two different
databases:**

| Port     | Target                                                     | Up since   |
| -------- | ---------------------------------------------------------- | ---------- |
| **8787** | HOSTED dev — `kitluy-project-pos` (`gjgbnkhuwlwhngbtrgts`) | 2026-08-26 |
| **8788** | LOCAL stack — `127.0.0.1:54372`                            | 2026-08-28 |

The image bakes `KITLUY_ENROLLMENT_BASE_URL=http://172.16.21.17:8788`, so **the
Hub dialled the LOCAL-backed service while its identity lived in hosted.** Its
device record id does not exist in the local database, and
`evaluate_hub_pairing_session_v1` refuses a device it cannot find with the same
`KLUY-HUBSESSION-DEVICE-INELIGIBLE` it uses for an ineligible one. The service's
own log says so plainly:

```text
04:34:40  hub-pairing-presentation-refused  "the code was right but this Hub cannot be paired"
04:36:12  hub-pairing-presentation-refused  "the code was right but this Hub cannot be paired"
```

**"The code was right."** The local database holds exactly two `store_hub`
records — `KL-37125B10C582` and `KL-634CDAECDB56` — and BOTH are `retired`, a
terminal state with no governed reversal. No live assignment existed there to
revoke, and `device_installations` is empty.

**The lesson is diagnostic order.** The hosted record genuinely was
stale-assigned and clearing it was correct work, but WHICH DATABASE ANSWERS THE
DEVICE was never checked first, so a real fix was applied to a database the
device does not talk to. Read the fleet service's preflight line — it prints its
target — before reasoning about any device's state.

**Fix applied:** `:8788` was restarted against hosted development
(`KITLUY_DEV_FLEET_DSN` unset, so `fleet-service.mjs` resolves the hosted DSN).
The card's baked address needed no change and no re-flash. `:8787` was left
running and untouched. Preflight after the restart:

```text
✓ target: HOSTED DEV kitluy-project-pos (gjgbnkhuwlwhngbtrgts)
✓ station CLOUD-STATION-01 active
✓ store_hub profile CLOUD-HUB-PI5 requires: mac_address, board_serial, storage_serial
Ready — devices will appear in kitluy-project-pos.
```

### The second missing surface — no way to issue a pairing code

There was no open session in hosted (the last was consumed 2026-08-26T07:12),
and **nothing in this repository could open one.** The only issuance surface is
the Partner Portal route in `services/kitluy-management-api/src/hub-pairing-issuance.ts`,
and that service has no dev runner. Hardware sessions had been hand-writing SQL.

`pnpm dev:pairing:code` (`scripts/development/issue-hosted-dev-pairing-code.mjs`)
now opens a session the way the Portal does — Store scope and a code digest, **no
device named** (KLD-2026-08-13-HUB-PAIRING-SESSION-001). It takes the alphabet
from `hub_claim_code_alphabet_v1()` rather than copying it, mints the code with
`randomInt`, stores only the SHA-256, prints the code once, and requires
`--operator` for the session record. Same full `assertHostedDevTarget` guard.
Verified: attribution, TTL ceiling and environment refusals all fire, and a real
session was opened against hosted (`e7d84cf8-…`, self-test).

### SECOND CORRECTION — the target is LOCAL, and hosted was never in play (2026-08-31)

The owner: _"we are using our local supabase."_ The 2026-08-29 switch of `:8788`
to hosted was the WRONG direction, recommended on an inference from this
handoff's hosted-heavy content rather than on an established fact. `:8788` has
been restored to the local stack it was on; `:8787` was never touched.

**The active local stack is the `kitluy-fresh` Supabase project on `:54372`** —
container `supabase_db_kitluy-fresh`. Note this is NEITHER the documented
canonical `:54392` (`@kitluy/dev-database`) NOR the known-wrong `:54322` (D-04).
`:54392` is not running at all. The service reaches `:54372` only because
`KITLUY_DEV_FLEET_DSN` names it.

**What is actually wrong on local.** `kitluy-fresh` holds exactly two
`store_hub` records and both are `retired`:

| Asset tag         | Created        | Retired            | Gen |
| ----------------- | -------------- | ------------------ | --: |
| `KL-634CDAECDB56` | 08-28 09:28    | **08-29 01:34:34** |   1 |
| `KL-37125B10C582` | 08-29 01:21:55 | **08-29 01:35:59** |   0 |

Read against the service log, the sequence is unambiguous:

```text
01:21:55  KL-37125B10C582 created   <- the re-flashed board registers, lands `manufactured`
01:32:09  presentation-refused      <- "the code was right but this Hub cannot be paired"
01:34:34  KL-634CDAECDB56 retired
01:35:59  KL-37125B10C582 retired
01:44 / 01:55 / 04:34 / 04:36  refused
```

**Two separate gates, neither of them the assignment.** At 01:32 the board was
`manufactured` — pending HET approval — and 0194 admits only an `enrolled`
`store_hub`. Nothing had approved it, because **there was no approval surface
for a local stack at all**: `fleet-watch.mjs` records that the Admin PWA and
Management API need an admin auth user linked to an `admin_user_profiles` row,
and the local seed's profile references a user id with no `auth.users` record.
Then both records were retired, which is terminal.

**The retirements bypassed the governed door.** `retire_device_v1` calls
`record_lifecycle_event`, and `device_lifecycle_events` holds ZERO rows for
either device. So `lifecycle_state` and `retired_at` were set by direct UPDATE,
and `trg_devices_lifecycle_transition` did not stop it. Recorded as **D-23**.

### What was built for the local path

| Script                                                                     | Purpose                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/development/dev-target.mjs`                                       | **One** target resolver for the dev device tools. Reads `KITLUY_DEV_FLEET_DSN` with exactly `fleet-service.mjs`'s precedence, so a tool and the service cannot silently disagree (D-22). Returns a label every caller prints. Refuses production-like `KITLUY_ENV` on BOTH targets, matching `assertLocalTarget` (KL-INF-P1-037). |
| `scripts/development/approve-dev-device.mjs` (`pnpm dev:device:approve`)   | The HET approval step. Calls `approve_device_enrollment_v1` (0197) and nothing else — reason and verification evidence mandatory, `manufactured` only, pilot/production refused before connecting. Report-only without `--confirm`.                                                                                               |
| `scripts/development/issue-dev-pairing-code.mjs` (`pnpm dev:pairing:code`) | Now `--local` aware through the shared resolver (was hosted-only).                                                                                                                                                                                                                                                                |

Verified against `kitluy-fresh`: the approve tool reports the retired board
correctly and refuses to act; a pairing session was opened on local; production
`KITLUY_ENV` is refused on the local target too. `hosted:consumers:check` 17/0
with 0 unguarded, lint and format clean.

### The local recovery sequence

1. Boot the Hub. Hardware-evidence resolution **skips** retired and replaced
   devices (0197 lines 214/265/374), so it should land a NEW record in
   `manufactured`. If instead it reports `TRUST_REVIEW_REQUIRED`, resolution
   matched a retired record by another path (0197 line 478) — **stop**, that is
   the fail-closed branch, and clearing `/var/lib/kitluy/registration-state.json`
   on the card is what forces a clean registration.
2. `pnpm dev:fleet:watch --once` — read the new asset tag.
3. `pnpm dev:device:approve --local --asset-tag <tag> --operator OP-… --reason … --evidence … --confirm`
4. `pnpm dev:pairing:code --local --operator OP-…`
5. Type the code on the console.

### NOT done, and deliberately

- **The five-attempt budget still counts an ineligible device's attempt** (0194).
  An already-paired Hub can therefore still lock a perfectly good code. Changing
  that is a security-sensitive edit to the presentation door — an attacker's
  device would gain unmetered probing — and is recorded as **D-21**, not fixed.
- **No management-API route or Portal action.** The script is a development
  operator tool, not the product surface a Partner would use.

---

## 10. Security Review State

Reconciled 2026-08-27. The credential path has now had **two** independent
adversarial reviews and is awaiting a third, narrow confirmation.

| Area                                             | Independent Review                                   | Verdict                                                            | Open findings                                                                            |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Trusted time (0198 R-1 repair, 0200)             | Yes — 4 reviewers over 2 rounds, 2026-08-24/25       | **APPROVED**                                                       | —                                                                                        |
| 0198 activation composition identity             | Covered by the trusted-time review                   | **APPROVED** in that scope                                         | —                                                                                        |
| 0199 certificate issuer identity                 | Superseded by the 2026-08-26 review                  | **APPROVED**                                                       | its separation-of-duty claim was false as deployed (C-4); closed by 0206                 |
| Certificate issuer / credential path (0201–0209) | **Yes** — 2026-08-26                                 | **REJECTED**, then remediated                                      | C-1…M-4 all closed (§9A)                                                                 |
| The same path, re-reviewed (0201–0209)           | **Yes** — 2026-08-27                                 | **APPROVED WITH REQUIRED FIXES**                                   | R2-1…R2-4, all closed (§9B)                                                              |
| R2 fixes (0210, 0211, platform, gate)            | **Yes** — 2026-08-28, final independent confirmation | **APPROVED WITH REQUIRED FIXES** — R2-1, R2-2, R2-3, R2-4 all PASS | N-1 (CLOSED 2026-08-28, group 0212); N-2, N-3, N-4 remain                                |
| Firstboot operational TLS client                 | **NO — not reviewed**                                | software evidence only                                             | the 2026-08-28 confirmation stated: required fixes before the firstboot client, **NONE** |
| Activation enforcement (0207)                    | Covered by the 2026-08-27 review                     | **APPROVED**                                                       | —                                                                                        |
| Pairing eligibility                              | Yes (WS-11-T004 closeout)                            | APPROVED                                                           | —                                                                                        |
| Revocation                                       | Yes (WS-11 reviews in `00_AI_HANDOFF/reviews/`)      | APPROVED                                                           | M-2 partial: `[REQUIRED: offline_mtls_revocation_signal]`                                |
| Authorization / resource scoping                 | Yes                                                  | **OPEN finding**                                                   | KLREC-2026-08-13-AUTHZ-001 (D-02), untouched by both passes                              |

**Nothing in this document is self-approved.** Where a verdict says APPROVED, an
independent reviewer said so; where it says PENDING, no one has yet.

**The credential-path review loop is CLOSED for this milestone.** Four
independent sessions reviewed it; the final one concluded "Required fixes before
FIRSTBOOT operational TLS client: NONE". It reopens only on new executable
evidence.

---

## 11. Known Defects / Technical Debt

Reconciled 2026-08-27. Entries closed by the two security-remediation passes are
marked CLOSED with the group that closed them, rather than deleted, so the
history stays traceable. Their evidence lives in §9A and §9B.

| ID   | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Severity | Blocks Dev? | Blocks Pilot? | Blocks Prod? | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | :---------: | :-----------: | :----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | **0189 unapplied** in the canonical local DB while proven green from zero elsewhere. No clean-from-zero replay covers 0189–0211.                                                                                                                                                                                                                                                                                                                         | MEDIUM   |     No      |    **Yes**    |   **Yes**    | OPEN — owner-scheduled clean replay on a disposable PG17.6 container. **Do not edit 0189.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-02 | `kitluy_auth.has_permission(key, resource_type, resource_id, environment)` **accepts a resource scope and ignores it**.                                                                                                                                                                                                                                                                                                                                  | HIGH     |     No      |    **Yes**    |   **Yes**    | OPEN — explicitly out of scope for both remediation passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-03 | **Local/hosted schema divergence.** Hosted development is at 0197; local carries 0198–0211.                                                                                                                                                                                                                                                                                                                                                              | HIGH     |     No      |    **Yes**    |   **Yes**    | OPEN — expected while 0198–0211 remain undeployed by instruction. Reconcile before any hosted deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-04 | **`:54322` is not the KitLuy database.**                                                                                                                                                                                                                                                                                                                                                                                                                 | MEDIUM   |      —      |       —       |      —       | **CLOSED** (M-4). 36 files repointed, `@kitluy/dev-database` is the one helper, `pnpm dsn:check` refuses a new literal. It also found three suites aimed at `:54402`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-05 | **Hub LAN agent is not packaged.** Passes 141 tests, absent from the image.                                                                                                                                                                                                                                                                                                                                                                              | HIGH     |   **Yes**   |    **Yes**    |   **Yes**    | OPEN — blocked on the final security confirmation and on `[REQUIRED: offline_mtls_revocation_signal]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-06 | **No operational X.509 has ever been issued.**                                                                                                                                                                                                                                                                                                                                                                                                           | HIGH     |      —      |       —       |      —       | **CLOSED** (0201–0211). Real certificates are issued, key-bound, chain-verified against pinned anchors, and activate a Hub.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-07 | `service_role` inherits both mint and consume authority.                                                                                                                                                                                                                                                                                                                                                                                                 | HIGH     |      —      |       —       |      —       | **CLOSED** (0206). Three NOINHERIT hinges plus removal of the direct grants; `has_function_privilege` says DENIED on all six credential-path doors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-08 | **Local PG17 container SIGSEGVs** on permission-denied function calls.                                                                                                                                                                                                                                                                                                                                                                                   | MEDIUM   |      —      |       —       |      —       | **CLOSED for development** (R2-2) as a PLATFORM remediation: `supautils.hint_roles` emptied by `pnpm db:dev:supautils-workaround`. 0 crashes in 10 consecutive full runs. The upstream supautils bug is NOT fixed — see D-15.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-09 | Development devices carrying a trusted-time floor in the future / restricted trust.                                                                                                                                                                                                                                                                                                                                                                      | LOW      |   Partly    |      No       |      No      | OPEN and GROWN: **894** `device_trusted_time` rows are not `trusted`. They make 17 provisioning suites fail at fixture setup. Unrecoverable by design — **no reset backdoor**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-10 | `dev-pki.invalid-emdash` quarantined outside the repo.                                                                                                                                                                                                                                                                                                                                                                                                   | LOW      |     No      |      No       |      No      | OPEN — owner-authorised deletion after the evidence package. **Do not use, copy or delete.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-11 | 3 pre-existing files fail `prettier --check`.                                                                                                                                                                                                                                                                                                                                                                                                            | LOW      |     No      |      No       |      No      | OPEN — deliberately not reformatted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-12 | Governor roles stale-granted to `postgres` **by `supabase_admin`**.                                                                                                                                                                                                                                                                                                                                                                                      | MEDIUM   |   Partly    |      No       |      No      | OPEN, now DIAGNOSED and measured: it causes **all 7** remaining registry test failures. `postgres` cannot revoke a `supabase_admin` grant, and the grants carry `set_option = false`, so `SET ROLE` also fails. Needs the container owner, not a migration. **2026-08-29 (§9K): the same shape was measured on HOSTED development** — `postgres` holds the `kitluy_fleet_governor` membership with `set_option` AND `inherit_option` false, so `set role` is refused there too. It is NOT a local-container artefact; work needing the role must not assume `set role` succeeds. `may execute` is still true because `postgres` owns the doors. |
| D-13 | `migrations:validate` flags the ordinary English word for "shorten" **inside a comment** as a destructive statement.                                                                                                                                                                                                                                                                                                                                     | LOW      |     No      |      No       |      No      | OPEN — a false positive that pressures authors into attaching destructive markers to non-destructive migrations. Group 0210 works around it in prose rather than taking a marker it does not deserve.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-14 | `device-registration-continuity.db.test.ts` fails ~1 run in 6 with `TRUST_REVIEW_REQUIRED` instead of `PENDING_APPROVAL`.                                                                                                                                                                                                                                                                                                                                | LOW      |     No      |      No       |      No      | OPEN and DIAGNOSED: the fixture's random hardware signals occasionally collide with the accumulated fleet, and the **fail-closed** ambiguous-board-evidence path fires. The security control is behaving correctly; the fixture is not unique enough.                                                                                                                                                                                                                                                                                                                                                                                           |
| D-15 | The supautils permission-hint SIGSEGV is worked around, not fixed, and the workaround does not survive a container recreate.                                                                                                                                                                                                                                                                                                                             | MEDIUM   |     No      |      No       |      No      | OPEN — the durable fix is a supautils/image upgrade (option A), which is an infrastructure change this session was not authorised to make.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| N-1  | The serial inverse fabricated a `DEV-`-shaped credential serial for hash-derived shapes it cannot invert.                                                                                                                                                                                                                                                                                                                                                | HIGH     |      —      |       —       |      —       | **CLOSED** 2026-08-28 (group 0212). Fails closed, self-checking, and SQL and TypeScript are asserted to agree on WHICH serials are invertible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N-2  | `x509_signature_is_valid_v1` accepts an issuer exponent of **e = 1**.                                                                                                                                                                                                                                                                                                                                                                                    | MEDIUM   |     No      |    **Yes**    |   **Yes**    | OPEN. Unreachable today: the issuer is PINNED (group 0203), so the only key the verifier ever uses is the development CA's. **MUST be closed before that verifier participates in unpinned peer or LAN trust.**                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| N-3  | Migration **0210 cannot safely re-apply** on an already-patched schema.                                                                                                                                                                                                                                                                                                                                                                                  | MEDIUM   |     No      |      No       |      No      | OPEN. **Blocks ledger reconciliation, D-01 clean replay, and any migration-recovery workflow that depends on replayability.** It is why §4's ledger/schema gap cannot simply be replayed away.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N-4  | 0211's apply-time assertions are structural (they read `prosrc`) rather than behavioural.                                                                                                                                                                                                                                                                                                                                                                | LOW      |     No      |      No       |      No      | OPEN. The behaviour IS covered by `algorithm-identifier.adversarial` (9 tests); what is missing is an apply-time behavioural check. Harden in a dedicated migration-hardening pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-16 | **Retired devices hold `device_certificates` rows with `status = 'active'`** — 776 at review time, **2,541** as measured 2026-08-28 (the suites mint and retire fixtures on every run).                                                                                                                                                                                                                                                                  | HIGH     |     No      |    **Yes**    |   **Yes**    | OPEN — needs `[REQUIRED: device_lifecycle_certificate_policy]`. Deliberately NOT decided here; see §19.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D-17 | **`scripts/pki/trust-anchor-bootstrap.mjs` contains two literal NUL bytes** (lines 199–200, used as a `.replace()`/`.split()` delimiter in `certificateSha256`). `file` reports the source as `data` and **`grep` treats it as binary and prints NO matches for it at all** — silently, with exit status 0.                                                                                                                                              | LOW      |     No      |      No       |      No      | OPEN — behaviourally correct JavaScript, but it hides the file from every grep-based sweep, including a sweep for unguarded consumers of the hosted DSN. `X-13`/`X-14` therefore read with `fs`. A behaviour-identical repair is to write the delimiter as the escape `\0` instead of embedding the raw byte.                                                                                                                                                                                                                                                                                                                                   |
| D-23 | **Two `store_hub` records in the local `kitluy-fresh` stack were retired by direct UPDATE, bypassing `retire_device_v1`.** `device_lifecycle_events` holds zero rows for either, yet the governed door always calls `record_lifecycle_event`, so `lifecycle_state`/`retired_at` were hand-set and `trg_devices_lifecycle_transition` did not refuse it.                                                                                                  | MEDIUM   |   **Yes**   |      No       |      No      | OPEN — recorded 2026-08-31. Retirement is terminal, so a hand-edit here permanently bricks a development board's identity with no audit trail explaining why. Two questions follow: whether the transition trigger is meant to refuse this and does not, and what wrote those rows.                                                                                                                                                                                                                                                                                                                                                             |
| D-22 | **Two fleet services on one workstation can target different databases, and the SD card's baked `KITLUY_ENROLLMENT_BASE_URL` silently decides which one a device talks to.** On 2026-08-29 `:8787` served hosted and `:8788` served local; the image pointed at `:8788`, so a Hub registered in hosted was refused by a database that had never heard of it — reported as the same `KLUY-HUBSESSION-DEVICE-INELIGIBLE` as a genuinely ineligible device. | MEDIUM   |   **Yes**   |      No       |      No      | OPEN — recorded 2026-08-29 (§9K). No guard exists: nothing warns that the address in the image and the database behind it disagree. Mitigation today is to read the service preflight line (`✓ target: …`) before diagnosing any device. A real fix would have the pairing route report the project it is bound to, or the console display it.                                                                                                                                                                                                                                                                                                  |
| D-21 | **An ineligible device spends a pairing session's five-attempt budget.** `evaluate_hub_pairing_session_v1` (0194) increments `failed_attempt_count` when the CODE matched but the device is not an `enrolled` `store_hub` — so a re-flashed, already-assigned Hub locks a perfectly valid code after five correct entries.                                                                                                                               | LOW      |     No      |      No       |      No      | OPEN — recorded 2026-08-29 (§9K). NOT fixed: exempting ineligible devices from the budget would give an attacker-controlled device unmetered probing against live codes. The console now warns before the fifth attempt; a real fix needs a decision on how to meter presentations per DEVICE rather than per SESSION.                                                                                                                                                                                                                                                                                                                          |
| D-18 | **`scripts/development/seed-hosted-dev-partner.mjs` writes to hosted with no target guard.** It assembles its DSN from `supabase.env.local` and checks only `deriveProjectRef`; it never calls `assertHostedDevTarget`.                                                                                                                                                                                                                                  | MEDIUM   |     No      |    **Yes**    |   **Yes**    | OPEN — **not** the H-1 shape: it ignores `KITLUY_HOSTED_DEV_DB_URL`, so it is not attacker-steerable through the environment, and it is consequently outside `X-14`'s reach. It should still route through the one guard so that "which machine may receive hosted writes" has exactly one answer.                                                                                                                                                                                                                                                                                                                                              |

---

## 12. Physical Verification Matrix

| Scenario                    | Status                                          | Evidence                                                                            |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Hub clean-image boot        | **NOT TESTED** for the current artifact         | current image `bootTested: false`                                                   |
| Hub registration            | **PASSED (2026-08-20)** on the 2026-08-19 image | 2026-08-20 hardware handoff                                                         |
| HET approval                | **PASSED (2026-08-20)**                         | same                                                                                |
| Store pairing               | **PASSED (2026-08-20)**, twice incl. reflash    | same                                                                                |
| Certificate installation    | **NOT TESTED on hardware**                      | a certificate now exists in development (§12A) but no device has ever installed one |
| Hub ACTIVE                  | **NOT TESTED** on hardware                      | hardware Pi is `awaiting_trust`                                                     |
| Real terminal provisioning  | **NOT TESTED**                                  | §8                                                                                  |
| Hub reboot                  | **NOT TESTED**                                  |                                                                                     |
| WAN loss                    | **NOT TESTED**                                  |                                                                                     |
| Terminal reconnect          | **NOT TESTED**                                  |                                                                                     |
| Power loss                  | **NOT TESTED**                                  |                                                                                     |
| A/B good release            | **NOT TESTED**                                  |                                                                                     |
| A/B failed release rollback | **NOT TESTED**                                  |                                                                                     |
| Interrupted update          | **NOT TESTED**                                  |                                                                                     |

---

## 12A. Certificate Issuance Failure / Recovery Matrix — SOFTWARE, not hardware

Measured 2026-08-25 against `:54392`, repeatable across three consecutive runs.
Source: `services/kitluy-device-registry-service/test/first-operational-issuance.integration.test.ts`
(8 tests) and `test/hub-activation-chain.integration.test.ts` (3 tests).

| Scenario                                                    | Expected                                                                            | Result   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| Valid first issuance                                        | real X.509, parseable, chain-verifiable, persisted                                  | **PASS** |
| PoP signed by a DIFFERENT private key                       | `OPCERT_POSSESSION_PROOF_FAILED`, nothing spent                                     | **PASS** |
| PoP over a MUTATED preimage (nonce changed)                 | `OPCERT_POSSESSION_PROOF_FAILED`                                                    | **PASS** |
| Same signed request replayed (lost response)                | `REPLAYED`, byte-identical certificate, no second identity                          | **PASS** |
| Two concurrent requests for one device                      | one wins; no conflicting authority                                                  | **PASS** |
| No CA configured                                            | `OPCERT_CA_UNAVAILABLE`, **generation 1 not spent**, no key material in the message | **PASS** |
| `environment = pilot` / `production`                        | THROWS citing BLK-005; nothing spent                                                | **PASS** |
| Activation before issuance / after issuance                 | `KLUY-DEVICE-NO-CERTIFICATE` → `ACTIVATED`                                          | **PASS** |
| Full chain: pair → time → certificate → activation → ACTIVE | `active`, exactly one active certificate, exactly one trusted-time event            | **PASS** |
| Second advance with the same request                        | `REPLAYED`, still `active`                                                          | **PASS** |
| No CSR presented at all                                     | `CSR_REQUIRED`; **no certificate SQL is issued at all**                             | **PASS** |

**NOT yet covered, and named rather than implied:** crash between
`record_…_issuance` and artifact persistence (needs fault injection); expired,
not-yet-valid or revoked certificate at activation time; corrupt PEM on disk;
CA key present but mode-widened; wrong-device / wrong-environment artifact
recording. These belong to the independent review's scope (§17).

---

## 13. Current Status Classification

Status words are used only where evidence supports them. Nothing here is
HARDWARE_E2E: no Raspberry Pi has executed any of it.

| Capability                                    | Status                 | Evidence                                                                     |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Governed operational X.509 issuance           | **IMPLEMENTED-IN-DEV** | real certificates issued, key-bound, chain-verified; two independent reviews |
| Certificate-backed activation                 | **IMPLEMENTED-IN-DEV** | 0201/0203/0207; enforced against bare `UPDATE`; independently reviewed       |
| First-issuance recovery                       | **IMPLEMENTED-IN-DEV** | 0205; the brick case recovers end to end                                     |
| Separation of duty                            | **IMPLEMENTED-IN-DEV** | 0206; `has_function_privilege` proves DENIED on all six doors                |
| Serial canonicalisation                       | **IMPLEMENTED-IN-DEV** | 0210/0212; differential against DER, Node and OpenSSL                        |
| **Firstboot operational TLS client**          | **IMPLEMENTED-IN-DEV** | 66 unit/recovery tests + 3 end-to-end against the real route and database    |
| Certificate installation on a real Pi         | **NOT TESTED**         | no physical hardware has run this                                            |
| Physical Hub reaching ACTIVE with this client | **NOT TESTED**         | same                                                                         |
| Hub LAN mTLS                                  | **NOT STARTED**        | blocked by two owner decisions                                               |

Certificate issuance is no longer "never executed", and activation is no longer
"unsatisfiable" or "unreviewed" — both statements were true when written and are
preserved in the dated review records rather than in this table.

---

## 14. Completed Work Since Previous Handoff

All uncommitted; HEAD remains `0a30a74`.

1. **R-1 (caller-supplied trusted time) closed at two layers.** 0198 edited in
   place: `establish_device_trusted_time_v1` now takes `(uuid, text, uuid)` and
   reads `now()` inside the definer. 0200 additionally revoked `service_role`'s
   direct trust-table mutation, which independent review proved still reached
   the identical outcome. Independently **APPROVED**.
2. **Defect A** — `select (fn(...)).*` re-evaluated composites 7× and 6× per
   pairing. Both call sites moved to the FROM clause; measured 7→1 and 6→1.
3. **Defect B** — source-aware trusted time. New `cloud_authoritative` source
   requested by boolean; NULL floors may only be initialised by it; device-class
   sources keep the strict 3600 s rule. Ladder proven at 30 min / 2 h / 8 h /
   24 h / 14 d.
4. **Persistent development PKI.** `scripts/pki/bootstrap-dev-pki.mjs` creates a
   root and issuing intermediate outside the repository (0700/0600), verified by
   both `openssl` and Node, `pathlen:0`, refuses overwrite and refuses paths
   inside the repo. Guard `scripts/verification/assert-no-dev-pki.mjs` parses
   certificates (an earlier grep-only version was a tautology).
5. **Migration 0201** — links `device_certificates` to `device_credentials`,
   adds the X.509 artifact columns, tightens the activation predicate, and
   revokes `service_role`'s write on `device_certificates` and its EXECUTE on
   the raw `issue_device_certificate_v1`.
6. **Wi-Fi fallback for the Store Hub console** — `wpa_supplicant` on the
   existing systemd-networkd, KitLuy TUI, Ethernet preferred by route metric,
   credentials slot-shared. Fixed during development: cleartext passphrase echo,
   per-byte UTF-8 decoding, arrow-key leakage, unhandled EOF, and Khmer/escaped
   SSID corruption that could brick a shop's Wi-Fi configuration.
7. **Appliance timezone** baked to `Asia/Phnom_Penh` (the artifact had shipped
   `Europe/London` while `image.env` advertised Phnom Penh, read by nothing).
8. **Test environment reconciliation** — `trusted-time-activation.db.test.ts`
   repointed from the stale PG15 `:54402` to canonical `:54392`; firstboot went
   from 3 failures to **0**.
9. **New tests:** `trusted-time-staleness.integration` (31),
   `hub-activation-chain.integration` (3), `device-trust-advance-sql` (5),
   `network` (25), `network-ui` (15), `read-secret` (8).

---

### Added 2026-08-25 — the first governed operational X.509

11. **First operational certificate issuance, end to end.** New
    `services/kitluy-device-registry-service/src/first-operational-issuance.ts`
    composes: verify `kitluy.csr.v1` → load the persistent DEV CA → register the
    device-generated key at generation 1 → `runGovernedIssuance` → read the
    authoritative serial and validity window back from `device_credentials` →
    sign the leaf → record the artifact. **A real certificate now exists**, is
    parseable by `node:crypto`, verifies against the persisted chain, and
    activates a Hub. It is the first one this project has ever issued.
12. **Migration 0202** — `record_operational_certificate_v1`, SECURITY DEFINER
    owned by `kitluy_credential_issuer`, granted to `kitluy_issuance_service`
    alone. The caller supplies only the certificate bytes and chain; device,
    environment, generation, serial, fingerprint and validity window are all read
    from the credential, and `certificate_sha256` is computed server-side from
    the DER. Idempotent per credential; a different certificate for the same
    credential raises `KLUY-OPCERT-ARTIFACT-CONFLICT`.
13. **The persistent DEV CA is now the canonical signer.**
    `persistent-dev-ca.ts` implements `CertificateAuthorityProvider` by LOADING
    root and intermediate from OS-protected files. The ephemeral
    `DevelopmentCertificateAuthority` minted a new CA identity per process, which
    orphaned every credential a previous process signed. A/B measurement: the
    persistent CA returns the same intermediate key id and root certificate id
    across loads and verifies cross-load signatures; the ephemeral one does not.
14. **A real pre-existing defect fixed in `issuance-gateway.ts`.** `finalize`
    cast the door's snake_case JSON straight to a camelCase interface, so
    `notBefore` / `notAfter` / `serialNumber` were silently `undefined` — a
    `new Date(undefined)` reached the signer as `Invalid Date`. Now mapped
    field by field. This was latent before this stream and would have corrupted
    any consumer of `finalize`'s result.
15. **`advanceDeviceTrust` no longer fabricates a certificate.** It used to call
    `issue_development_device_certificate_v1`, which wrote a metadata-only
    `device_certificates` row — no PEM, no SHA-256, no `credential_id`. Under
    0201 such a row can never satisfy activation, and its `status = 'active'`
    would occupy the one-active index against the real certificate. The step now
    runs the governed composition when the device presents a signed request, and
    reports `CSR_REQUIRED` when it has not — a certificate is a statement about
    a key, and the control plane does not hold the device's key.
16. **A grant is not a policy — found a third time.** 0201 gave the activation
    identity `SELECT` on `device_credentials` and `device_credential_heads`
    without RLS policies. Both tables FORCE row security, so the reads returned
    ZERO ROWS rather than erroring, and every device was refused with
    `KLUY-DEVICE-NO-CERTIFICATE` while holding a perfectly valid certificate.
    0201 now creates both read policies and **asserts on apply** that the policy
    exists wherever it granted.
17. **Chain fixtures are fresh per run.** `hub-activation-chain` reused rolling
    device slots, which cannot survive real issuance:
    `register_generation_key_v1` binds ONE key to generation 1 permanently, so a
    reused slot is refused with `KLUY-KEY-GENERATION-TAKEN` — correctly. Devices
    are now minted fresh and retired in `afterAll`, so the suite does not grow
    the active fleet.

## 15. Work In Progress

| Area                                 | Files                                                                                                                                                                                                          | State                                                  | Remaining                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Operational X.509 issuance           | `src/first-operational-issuance.ts`, `src/persistent-dev-ca.ts`, `src/dev-operational-pki.ts`                                                                                                                  | **BUILT and independently reviewed**                   | nothing on this path                                                                                                              |
| **Firstboot operational TLS client** | `operational-key.ts`, `operational-csr-bytes.ts`, `operational-credential-state.ts`, `operational-certificate-verification.ts`, `operational-tls-client.ts`, `adapters/http-operational-certificate-client.ts` | **IMPLEMENTED-IN-DEV**                                 | image packaging, then physical Pi proof                                                                                           |
| Governed issuance route              | `src/operational-certificate-routes.ts`, wired through `http.ts` and `main.ts`                                                                                                                                 | **BUILT**                                              | authenticated device identity on the route is inherited from the bootstrap surface; revisit if the Hub identity mechanism changes |
| Activation                           | 0201, 0203, 0207                                                                                                                                                                                               | **satisfied through a real certificate, and enforced** | nothing                                                                                                                           |
| Hub LAN packaging                    | `services/kitluy-hub-agent`                                                                                                                                                                                    | passes 141 tests, absent from the image                | BLOCKED on two owner decisions and on N-1/N-2 being closed for peer trust                                                         |
| Serial canonicalisation              | 0210, 0212 + `first-operational-issuance.ts`                                                                                                                                                                   | **BUILT**, inverse fails closed                        | N-3 blocks replayability                                                                                                          |

### The firstboot client, in one line each

```text
operational-key.ts                     generate once, reuse, never silently replace
operational-csr-bytes.ts               kitluy.csr.v1 canonical bytes (drift-tested)
operational-credential-state.ts        request state before the call, manifest last
operational-certificate-verification.ts  17 checks, node:crypto only
operational-tls-client.ts              the orchestration and the state machine
adapters/http-operational-certificate-client.ts  bounded, typed, no secret logging
```

Local key reference: `/var/lib/kitluy/operational/operational-tls.key.pem`,
directory `0700`, file `0600`. **The key material itself appears nowhere** — not
in this document, not in a request body, not in a log line, not in an error
message, and not in the golden image.

---

## 16. Blockers

### The one blocker on the current milestone

- **HOSTED DEVELOPMENT IS AT 0197.** The firstboot operational TLS client needs
  the governed credential stack through **0212**. Until the delta in §9E is
  deployed and verified, the physical Pi will register, wait for approval, pair,
  establish trusted time — and then stop at the certificate stage with a
  governed refusal. That is correct behaviour, not a fault, and no amount of
  reflashing changes it.

### Development blockers

- **None on the credential path.** The formal security gate is 81/81 with zero
  skips.
- **D-09** 894+ restricted trusted-time devices make 17 provisioning suites fail
  at fixture setup. Fixture-population damage, unrecoverable by design.
- **D-12** `supabase_admin`-granted governor memberships on `postgres` cause all
  7 remaining registry test failures. Needs the container owner.

### Integrated-verification blockers

- **D-05** Hub LAN agent not packaged — deliberately, and out of scope here.
- **`[REQUIRED: offline_mtls_revocation_signal]`** — blocks LAN mTLS outright.
- No physical Pi has reached ACTIVE; no terminal provisioned through an ACTIVE Hub.

### Pilot blockers

- **BLK-005** PKI/HSM custody OPEN — pilot and stable channels unbuildable.
- **D-02** `has_permission` ignores resource scope.
- **D-16 / `[REQUIRED: device_lifecycle_certificate_policy]`** — retired devices
  holding active certificate artifacts (2,541 measured 2026-08-28).
- **D-03** schema divergence; **D-01** no clean replay covering 0189–0212, and
  **N-3** must close before that replay is attempted.

### Production blockers

- All pilot blockers, plus production secure-element/TPM key storage (not
  started, not waived), production CA custody, and
  `[REQUIRED: device_certificate_signature_algorithm]` unresolved
  (`DEV_TLS_ALGORITHM_IS_PROVISIONAL`).

---

## 17. Exact Next Actions

**The credential-path review loop is CLOSED** (four independent sessions; the
2026-08-28 confirmation concluded "Required fixes before FIRSTBOOT operational
TLS client: NONE"). Do not commission another credential security review.

**NEXT ACTION — obtain owner authorization to deploy the hosted-development
backend delta.** The physical Pi cannot reach ACTIVE until it exists.

1. **Owner authorises the hosted deployment.** This session has no such
   authorization and made no hosted write.
2. An operator supplies `KITLUY_HOSTED_DEV_DB_URL` — never assembled from stored
   password fragments — and runs a READ-ONLY dry run first:

   ```bash
   KITLUY_HOSTED_DEV_DB_URL='…' pnpm db:deploy:hosted-dev --dry-run
   ```

   This confirms the ACTUAL hosted ledger rather than the believed 0197.

3. **Establish the hosted supautils posture before deploying 0206** (§9E item 3).
   Group 0206 makes `service_role` hit permission-denied on the credential-path
   doors, and D-15 says that class of call can SIGSEGV this PostgreSQL image.
4. Deploy 0198 – 0212, then **pin the hosted trust anchors** — the migrations
   create the table, the rows are installed out of band, and without them no Hub
   can obtain a certificate.
5. Confirm the hosted anchors are the SAME development CA the image pins
   (§9E item 2), or every certificate will be issued and then refused by the
   device.
6. Re-verify the hosted state of `KL-6CBB3BC0D49B` — the recorded
   `awaiting_trust` is stale.
7. **Then** flash the image from §6 and execute
   `docs/runbooks/kitluy-store-hub-first-activation-runbook-v1.0.0.md`, recording
   into `00_AI_HANDOFF/HARDWARE_ACTIVATION_EVIDENCE_TEMPLATE.md`.

**Do NOT start LAN mTLS.** Blocked by both owner decisions (§18A) and by N-1 and
N-2, which must close before the serial inverse or the SQL verifier participates
in peer or offline trust.

---

## 18. Commands for Next Session

### 18.0 REQUIRED ENVIRONMENT — export this before any credential-path work

The formal security suites now FAIL rather than skip when this is missing
(finding R2-4). Before the fix, a reviewer could run the documented command,
watch it go green, and be looking at a run in which 42 security assertions never
executed.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
cd ~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project

# The APPROVED external development PKI location. Outside the repository and
# outside every device image, by owner decision 3 (2026-08-24). Certificates in
# it are public; the private keys are mode 0600 and are never read into a log,
# an error or an API response.
export KITLUY_DEV_PKI_DIR="$HOME/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki"

# The CANONICAL local development database: PostgreSQL 17.6 on :54392.
# NOT :54322 (a different project) and NOT :54402 (a stale PG15 at 0188).
export KITLUY_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:54392/postgres"
```

One-time per container, and again after any `supabase stop` + recreate:

```bash
# Pin the development trust anchors the artifact door verifies against (0203).
node scripts/pki/pin-dev-trust-anchors.mjs

# DEVELOPMENT PLATFORM remediation for finding R2-2: a denied function call in
# kitluy_devices as service_role SIGSEGVs this PostgreSQL image. Removes
# service_role from supautils.hint_roles, which decides the text of an error
# message and nothing else. Does not survive a container recreate.
pnpm db:dev:supautils-workaround
```

### 18.1 The formal security gate

```bash
cd services/kitluy-device-registry-service
pnpm vitest run \
  test/serial-canonicalization.adversarial.test.ts \
  test/algorithm-identifier.adversarial.test.ts \
  test/privilege-denial.security.test.ts \
  test/certificate-key-binding.adversarial.test.ts \
  test/server-authoritative-validity.adversarial.test.ts \
  test/first-issuance-recovery.adversarial.test.ts \
  test/generation-artifact-serial.adversarial.test.ts \
  test/first-operational-issuance.integration.test.ts \
  test/hub-activation-chain.integration.test.ts \
  test/device-trust-advance-sql.test.ts
```

Expected: **74 passed, 0 skipped, 0 failed.** A skipped security assertion is a
failed gate — if the suites report skips, the environment above is not exported.

### 18.2 Everything else

```bash

# 1. repo / branch / dirt
git status --short && git log --oneline -5 && git rev-parse HEAD

# 2. migration ledger — repo vs the CANONICAL local database (:54392, PG17)
ls supabase/migrations/*.sql | wc -l
docker ps --format '{{.Names}} {{.Ports}}' | grep kitluy

# 3. hosted ledger (READ-ONLY). Needs KITLUY_HOSTED_DEV_DB_URL, which is NOT in
#    local-config — an operator must supply it. Never construct it from a stored
#    password.
# KITLUY_HOSTED_DEV_DB_URL=... pnpm db:deploy:hosted-dev --dry-run

# 4. test baseline. Point device-identity at the CANONICAL database or 85 tests
#    fail for environmental reasons only.
(cd services/kitluy-device-firstboot-agent && pnpm vitest run --reporter=basic)
(cd services/kitluy-device-registry-service && pnpm vitest run --reporter=basic)
(cd packages/device-identity && \
  KITLUY_DEV_DB_URL="postgresql://postgres:postgres@127.0.0.1:54392/postgres" \
  pnpm vitest run --reporter=basic)

# 5. gates
pnpm secret:scan && pnpm migrations:validate && pnpm contracts:validate
bash infra/kitluy-store-hub-image/test/systemd-runtime.test.sh
bash infra/kitluy-store-hub-image/test/build-gates.test.sh
KITLUY_DEV_PKI_DIR=~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki \
  node scripts/verification/assert-no-dev-pki.mjs
```

---

## 18A. Owner Decisions Required — DO NOT GUESS

Both are recorded as required values. Neither was decided here.

### `[REQUIRED: offline_mtls_revocation_signal]`

**Blocks LAN mTLS.** `pki_trust_configuration` names the mechanism
(`SIGNED_REVOCATION_SNAPSHOT`, `offline_grace_hours = 720`) and nothing else
exists. Needed: the revocation snapshot model, its cadence, the signing
authority, behaviour when the snapshot is stale, and the WAN-loss posture.

Group 0209 deliberately stops at "revoking a credential revokes its artifact".
How a Store Hub with no WAN decides that a PEER's certificate is revoked is not
implied by that, and was not invented.

### `[REQUIRED: device_lifecycle_certificate_policy]`

**Retired devices still hold `device_certificates` rows with `status = 'active'`** —
**776** when the independent review counted them on 2026-08-27, **2,541** when
measured live on 2026-08-28. The figure grows because the remediation suites
mint and retire fixture devices on every run, so it is a FIXTURE population
rather than a fleet — but the policy question is identical either way. A policy is needed for at
least retirement, containment, quarantine, and suspension / restricted
investigation.

Deliberately NOT decided here, and it is **not** obvious that every lifecycle
state should revoke the certificate: a device under investigation may need its
identity preserved as evidence, and a quarantined device may be expected to
return. Group 0209 revokes an artifact when its CREDENTIAL is revoked, which is a
narrower rule and the only one current authority supports.

---

## 19. Important Do-Not-Do Rules

1. **Do not touch migration 0189.** Owner-locked.
2. **Do not rewrite 0198, 0199 or 0200** — they carry independent security-review
   evidence. 0201 is local and may still be revised.
3. **Do not weaken the activation predicate.** It is satisfied through a real
   certificate (0201/0203/0207) and enforced against bare UPDATEs; the two chain
   tests that were once intentionally red are green through genuine issuance.
4. **Do not lower or clear a trusted-time floor**, and do not add a reset path.
   The database refuses deletion (`KLUY-DEVICE-TIME-IMMUTABLE`) — that refusal is
   correct.
5. **Do not let a caller supply trusted time.** A caller may request; the
   authority decides.
6. **`select (fn(...)).*` re-evaluates a composite once per output field.** Use
   the FROM clause for every mutating governed function.
7. **Do not add runtime dependencies to the firstboot agent** — its packaged
   closure is verified zero-dependency. `node-forge` is server-side only.
8. **Do not put non-ASCII in an X.509 subject.** An em-dash produced a
   certificate both OpenSSL and Node rejected.
9. **SSIDs from `wpa_cli` are `printf_encode`d.** Decode before use; a Khmer name
   otherwise corrupts the config and can brick a shop's Wi-Fi.
10. **Never read a secret while another reader owns stdin** — readline echoes it.
11. **Do not assume `:54322` or `:54402` is the KitLuy database.** Canonical is
    **`:54392`** (PostgreSQL 17.6).
12. **Do not call a function as a role lacking EXECUTE on the local PG17
    container** — it SIGSEGVs the backend. Use `has_function_privilege`.
13. **Do not use, copy or delete `dev-pki.invalid-emdash`.**
14. **No cloud writes, no deploy, no commit, no push** without explicit owner
    authorisation. The push URL is disabled by configuration.
15. **Do not run `prettier --write` over a whole directory** — it reformats
    unrelated files.

---

## 20. Evidence Locations

Repository records (all verified to exist on 2026-08-25):

- `00_AI_HANDOFF/000_INDEX.md` — chronological handoff index
- `00_AI_HANDOFF/000_BLOCKERS.md` — BLK-005/006/007 state
- `00_AI_HANDOFF/reviews/` — WS-11 independent review records
- `00_AI_HANDOFF/edge-platform/30_CLEAN_PG17_CANONICAL_CHAIN_PROOF.md` — the
  clean-from-zero proof and why PG 17.6 is canonical
- `00_AI_HANDOFF/edge-platform/32_DEC4_SELF_ESCALATION_PROBE_AND_0189.md` — 0189
  authored, locally green, not deployed
- `00_AI_HANDOFF/shared/2026-08-20__SHARED__STORE-HUB-HARDWARE-PROOF__REGISTER-APPROVE-PAIR-ON-REAL-HARDWARE__AI-HANDOFF.md`
  — the only physical-hardware evidence
- `00_AI_HANDOFF/shared/2026-08-24__SHARED__STORE-HUB-NETWORK-UX-BASELINE__TRUSTED-TIME-CALL-MULTIPLICATION-REPAIR__AI-HANDOFF.md`
- `00_AI_HANDOFF/shared/2026-08-24__SHARED__R1-TRUSTED-TIME-BOUNDARY__SOURCE-AWARE-STALENESS-AND-WIFI-FALLBACK__AI-HANDOFF.md`
- `00_AI_HANDOFF/shared/2026-08-24__SHARED__INDEPENDENT-REVIEW-NOT-APPROVED__R1-SURVIVES-AT-THE-TABLE-LAYER__AI-HANDOFF.md`
- `00_AI_HANDOFF/shared/2026-08-24__SHARED__TRUST-AUTHORITY-CLOSED-AT-THE-TABLE-LAYER__NULL-FLOOR-RULE__AI-HANDOFF.md`
- `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` —
  KLREC-2026-08-13-AUTHZ-001 at line 3321
- `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
- `infra/kitluy-store-hub-image/README.md`
- `infra/kitluy-store-hub-image/build/work/kitluy-store-hub-dev-manifest.json`
- `infra/kitluy-store-hub-image/build/preserved-2026-08-20/` — preserved artifact
  and `SHA256SUMS`
- `scripts/pki/bootstrap-dev-pki.mjs`, `scripts/verification/assert-no-dev-pki.mjs`

Outside the repository (never committed):
`~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki/`
(persistent development CA) and `…/dev-pki.invalid-emdash/` (quarantined).

Test logs from this session are in the session scratchpad and are **not**
durable repository evidence; re-run the commands in §18 instead.

---

HANDOFF CONFIDENCE:

- **MEDIUM-HIGH.** Repository, git, local database, built image and test results
  were measured directly on 2026-08-25 and are high confidence. Confidence is
  held below HIGH by two things that could not be verified today: the hosted
  development ledger and the physical Pi's state.

UNVERIFIED ASSUMPTIONS:

- **Hosted development is still at 96 migrations (through 0197).** Last verified
  2026-08-22. Not re-checked because `KITLUY_HOSTED_DEV_DB_URL` is absent from
  local-config and building a DSN from the stored password was declined.
- **The physical Pi `KL-6CBB3BC0D49B` is still `awaiting_trust`.** Quoted from
  the 2026-08-20 handoff; its record lives in the hosted project.
- **No one else has deployed to hosted development** since 2026-08-22.
- The 2026-08-24 image has never been flashed; `bootTested: false` is trusted as
  written.
- Migrations 0198–0212 have been applied only to the local PG17 database, and
  0203–0212 without ledger rows (§4). Their behaviour on a clean chain from zero
  is **reasoned, not observed** — and N-3 says 0210 cannot safely replay yet.
- The device-identity suites blocked by `supabase_admin`-granted governor
  memberships were DIAGNOSED (D-12) but not fixed; that needs the container
  owner.
- `hub_pairing_sessions` having no environment column is recorded as an
  observation; whether that is a defect was not determined.

NEXT SESSION SHOULD START BY:

- Exporting the §18.0 environment, running the §18.1 formal security gate
  (**74 passed, 0 skipped** is the only acceptable result), then carrying out the
  **NEXT ACTION** in §17: package the verified firstboot operational TLS client
  into the Store Hub image and prove a physical Pi reaches ACTIVE.

  The generation-1 PoP question that used to sit here is ANSWERED and the
  instruction is deleted rather than carried forward: it is `kitluy.csr.v1`,
  no new PoP kind was created, and the device's copy of those canonical bytes is
  drift-tested against `packages/device-identity` on every run.
