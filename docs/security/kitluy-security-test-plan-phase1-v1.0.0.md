# KitLuy Phase 1 Security Test Plan — Executable Register

| Field       | Value                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| Filename    | `kitluy-security-test-plan-phase1-v1.0.0.md`                                               |
| Version     | v1.0.0                                                                                     |
| Date        | 2026-08-06                                                                                 |
| Owner       | HET / KitLuy Suite Project Owner                                                           |
| Work item   | WS-11-T008 (independent review, evidence reconciliation and closeout)                      |
| Authority   | KLD-2026-08-06-WS11-T007-001 §19; KLREQ-008 / KLREC-2026-07-26-018                         |
| Governs     | The EXECUTABLE half of `kitluy-phase1-security-test-system-v1.0.0.md` — that document      |
|             | states WHAT must be verified; this one states HOW a qualified engineer reruns it TODAY.    |
| Scope       | WS-11 device provisioning and fleet management (T001–T008), plus the shared platform gates |
| Environment | Development only. Pilot and production remain fail-closed under BLK-005 / BLK-006.         |

> **Truth rule.** Every row below names a command that was EXECUTED against the
> development stack and the result it produced. A row with no executed command
> is not written here. Nothing in this document is a claim about pilot,
> production, or physical hardware.

## 1. How to run the whole Phase 1 security verification

```bash
# 0. Toolchain — Node from .nvmrc (22.23.0), pnpm pinned in package.json.
pnpm install --frozen-lockfile

# 1. Cloud database from zero, then seed twice (the second must be idempotent).
pnpm migrations:validate
pnpm db:reset
pnpm db:seed && pnpm db:seed

# 2. Hub database from zero, then seed.
pnpm hub:db:validate
pnpm hub:db:reset
pnpm hub:db:seed

# 3. Database-level security assertions (RLS runs inside db:test).
pnpm db:test
pnpm hub:db:test

# 4. Application-level security suites.
pnpm --filter @kitluy/device-identity test
pnpm --filter kitluy-device-registry-service test
pnpm --filter kitluy-hub-agent test
pnpm --filter @kitluy/terminal-local-store test

# 5. Destructive recovery (opt-in; destroys and rebuilds the Hub database).
KITLUY_HUB_DESTRUCTIVE_TESTS=1 pnpm --filter kitluy-hub-agent exec vitest run test/hub-backup-restore.test.ts
pnpm hub:db:reset && pnpm hub:db:seed   # return the Hub to canonical state

# 6. Repository-level gates.
pnpm secret:scan
pnpm clock:check
pnpm verify
```

**Development key generation.** No production signer exists (BLK-005). Every
certificate, signing key and proof in these suites is minted per test run by
`@kitluy/device-identity` test helpers and by `hub/seed/dev-fixtures.sql`; no
key material is stored in the repository, and `secret:scan` enforces that. The
Hub backup key is derived for development by
`scripts/hub/backup-manifest.mjs::resolveDevBackupKey`.

**Failure diagnosis.** Database assertion failures print
`ASSERT FAIL: <reason>` and exit 3; the section number in
`supabase/tests/assertions.sql` / `hub/tests/assertions.sql` localises them. A
`checksum drift` refusal from any Hub command means a migration file changed —
that is the immutability guard, not a bug. Suites that print
`SKIPPED … unreachable` mean the local database was down, and a skipped
security suite is NOT evidence.

**Residue and rollback.** All suites are re-runnable. The cloud and Hub
development databases are rebuilt from zero by the commands above; no test is
permitted to leave fault controls, temporary roles or temporary objects behind
(§17 of the security test system, verified by the T008 residue censuses).

## 2. Executable register

Result column records the latest EXECUTED outcome at SHA `09f93e9`
(2026-08-06). "Residual" states what the row does NOT prove.

### 2.1 Authentication and machine identity

| ID         | Requirement / risk                         | Test file                                                                              | Command                                             | Expected                                           | Result | Residual                          |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | ------ | --------------------------------- |
| KLSEC-X-01 | Only enrolled devices obtain identity      | `supabase/tests/assertions.sql` §29a–29e                                               | `pnpm db:test`                                      | Refusals recorded as evidence, not raised silently | PASS   | No production PKI (BLK-005)       |
| KLSEC-X-02 | Activation impossible without approved PKI | `supabase/tests/assertions.sql` (BLK-005 gate)                                         | `pnpm db:test`                                      | `KLUY-DEVICE-PKI-UNCONFIGURED` in all environments | PASS   | Gate cannot be opened by an agent |
| KLSEC-X-03 | Terminal activation needs a signed ack     | `services/kitluy-device-registry-service/test/terminal-activation.integration.test.ts` | `pnpm --filter kitluy-device-registry-service test` | Redemption alone never activates                   | PASS   | Dev certificates only             |
| KLSEC-X-04 | Device identity is never transferred       | `supabase/tests/assertions.sql` §56                                                    | `pnpm db:test`                                      | Identity-transfer refused both directions          | PASS   | —                                 |

### 2.2 Authorization, RLS and effective privilege

| ID         | Requirement / risk                               | Test file                                                   | Command                            | Expected                                                        | Result | Residual |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------- | ------ | -------- |
| KLSEC-A-01 | `anon`/`authenticated` reach no machine door     | `supabase/tests/rls-tests.sql` WS11-N1…N23                  | `pnpm db:test`                     | Every door and table refused                                    | PASS   | —        |
| KLSEC-A-02 | `service_role` cannot bypass a NOINHERIT gateway | `supabase/tests/assertions.sql` §55d, §57                   | `pnpm db:test`                     | Membership must be ENTERED; inheritance proves nothing          | PASS   | —        |
| KLSEC-A-03 | Governors are NOLOGIN and granted to nobody      | `supabase/tests/assertions.sql`, `hub/tests/assertions.sql` | `pnpm db:test`, `pnpm hub:db:test` | No login member, no BYPASSRLS                                   | PASS   | —        |
| KLSEC-A-04 | Every device table is RLS ENABLED **and** FORCED | `supabase/tests/assertions.sql` §55d                        | `pnpm db:test`                     | Missing FORCE fails the section                                 | PASS   | —        |
| KLSEC-A-05 | A governor's read reach carries no write path    | migration `0183`/`0184` on-apply guard                      | `pnpm db:reset`                    | `has_table_privilege(... 'insert'/'update'/'delete')` all false | PASS   | —        |
| KLSEC-A-06 | Four-eyes cannot be self-approved                | assertions §55–§56; `t007-cloud-races` F10/F11              | `pnpm db:test`; suite              | Self-approval refused for containment, recovery, replacement    | PASS   | —        |

### 2.3 Tenant, Store and Location isolation

| ID         | Requirement / risk                             | Test file                                                                                    | Command                                             | Expected                                         | Result | Residual                         |
| ---------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ------ | -------------------------------- |
| KLSEC-S-01 | Cross-Tenant claim/redeem refused              | `supabase/tests/assertions.sql`; T008 Reviewer B probe set                                   | `pnpm db:test`                                      | `KLUY-DEVICE-OWNERSHIP-TRANSFER`                 | PASS   | —                                |
| KLSEC-S-02 | Cross-scope health report refused              | `supabase/migrations/…0177` door + registry suite                                            | `pnpm --filter kitluy-device-registry-service test` | `KLUY-FLEET-REPORT-WRONG-HUB`                    | PASS   | —                                |
| KLSEC-S-03 | Cross-scope pairing receipt refused **in SQL** | `services/kitluy-device-registry-service/test/pairing-receipt-ingestion.integration.test.ts` | same                                                | `KLUY-PAIRING-RECEIPT-WRONG-HUB` / `WRONG-SCOPE` | PASS   | Closed by 0183/0184 (T008 NEW-1) |
| KLSEC-S-04 | Refusals leak no other scope's identifiers     | same suite + T008 Reviewer C leakage check                                                   | same                                                | Sentinels name no real Tenant/Store              | PASS   | —                                |

### 2.4 Cryptographic proof, replay and idempotency

| ID         | Requirement / risk                            | Test file                                                                        | Command                                             | Expected                                    | Result | Residual           |
| ---------- | --------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- | ------ | ------------------ |
| KLSEC-C-01 | Forged / reflected pairing proof refused      | `services/kitluy-hub-agent/test/hub-terminal-pairing.integration.test.ts`        | `pnpm --filter kitluy-hub-agent test`               | Zero residue on refusal                     | PASS   | Dev keys only      |
| KLSEC-C-02 | Release manifest tampering refused            | `packages/device-identity/test/release-manifest.test.ts`; 0180 triggers          | `pnpm --filter @kitluy/device-identity test`        | Fail-closed union; FREEZE after signing     | PASS   | Signer is BLK-005  |
| KLSEC-C-03 | Digest / size / architecture mismatch refused | `services/kitluy-hub-agent/test/release-cache.integration.test.ts`               | `pnpm --filter kitluy-hub-agent test`               | Durable rejection recorded                  | PASS   | —                  |
| KLSEC-C-04 | Backup authentication failure is total        | `services/kitluy-hub-agent/test/hub-backup-manifest.test.ts` + destructive suite | see §1 step 5                                       | AES-GCM auth failure, never partial restore | PASS   | Dev key derivation |
| KLSEC-C-05 | Nonce/effect-key replay is governed           | pairing-receipt suite (T008 NEW-2), containment `command_ref` probes             | `pnpm --filter kitluy-device-registry-service test` | `KLUY-…-CONFLICT`, never a raw SQLSTATE     | PASS   | —                  |
| KLSEC-C-06 | Idempotent replay is ONE business effect      | pairing, activation, health, release-assignment suites                           | package suites                                      | Same receipt/campaign returned              | PASS   | —                  |

### 2.5 Concurrency (all sixteen WS-11 race families)

| ID         | Requirement / risk                    | Test file                                                                           | Command                                             | Expected                              | Result | Residual                |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- | ------ | ----------------------- |
| KLSEC-R-01 | Families 1–6 (provisioning lifecycle) | `provisioning-code-*-races`, `emergency-concurrency`, `terminal-activation`         | `pnpm --filter kitluy-device-registry-service test` | Governed outcome both orderings       | PASS   | —                       |
| KLSEC-R-02 | Families 7–9 (pairing, heartbeat)     | `hub-terminal-pairing`, `terminal-health`                                           | `pnpm --filter kitluy-hub-agent test`               | One receipt; race-A determinism 20/20 | PASS   | —                       |
| KLSEC-R-03 | Families 10–12, 14, 15 (cloud)        | `services/kitluy-device-registry-service/test/t007-cloud-races.integration.test.ts` | same                                                | 20 iterations each, separate sessions | PASS   | Found 0177/0180 defects |
| KLSEC-R-04 | Families 13, 16 (Hub-local)           | `services/kitluy-hub-agent/test/t007-hub-races.integration.test.ts`                 | `pnpm --filter kitluy-hub-agent test`               | Retirement total; one rollback pinned | PASS   | —                       |

### 2.6 Offline, restart and recovery

| ID         | Requirement / risk                    | Test file                                                                            | Command                               | Expected                                 | Result | Residual                              |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------- | ------ | ------------------------------------- |
| KLSEC-O-01 | Store LAN operation survives WAN loss | `hub-offline-operation`, `hub-live-gate-offline-revocation`                          | `pnpm --filter kitluy-hub-agent test` | Local authority continues; outbox pends  | PASS   | Production transport is BLK-006       |
| KLSEC-O-02 | Reconnect replays in order, once      | `offline-reconnect`, `sync-inbox`                                                    | same                                  | No duplicate historical event            | PASS   | —                                     |
| KLSEC-O-03 | Restart resumes from durable state    | `hub-restart-recovery`, `hub-crash-recovery`, pairing restart cases, `release-agent` | same                                  | No process-memory dependency             | PASS   | Slot adapters are development fakes   |
| KLSEC-O-04 | Restore quarantine and integrity      | destructive backup suite + 0037 gates                                                | see §1 step 5                         | Corrupt/wrong-scope never becomes active | PASS   | —                                     |
| KLSEC-O-05 | Rollback never touches the database   | `release-agent.integration.test.ts`                                                  | `pnpm --filter kitluy-hub-agent test` | Transactions and outbox preserved        | PASS   | Physical A/B is BLK-005 hardware work |

### 2.7 Release signing, promotion and rollback

| ID         | Requirement / risk                      | Test file                                  | Command        | Expected                            | Result | Residual               |
| ---------- | --------------------------------------- | ------------------------------------------ | -------------- | ----------------------------------- | ------ | ---------------------- |
| KLSEC-L-01 | Internal→Pilot→Stable, no skips         | `supabase/tests/assertions.sql` §57        | `pnpm db:test` | Order enforced; skip refused        | PASS   | —                      |
| KLSEC-L-02 | Pilot/Stable fail closed under BLK-005  | §57 + T008 probe                           | `pnpm db:test` | `KLUY-DEVICE-PKI-UNCONFIGURED`      | PASS   | This is the pilot gate |
| KLSEC-L-03 | Signed manifest immutable after signing | 0180 FREEZE trigger; T008 Reviewer B probe | `pnpm db:test` | Refused even as the owning governor | PASS   | —                      |
| KLSEC-L-04 | Assignment identity is whole-request    | `t007-cloud-races` T008 F-5 case           | suite          | Same-key different-device REFUSED   | PASS   | Closed by 0182         |

### 2.8 Audit integrity, secrets and residue

| ID         | Requirement / risk                    | Test file                                      | Command                                      | Expected                           | Result | Residual                              |
| ---------- | ------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------- | ------ | ------------------------------------- |
| KLSEC-E-01 | Financial/audit facts are append-only | `hub-append-only`, cloud assertion sections    | package + `db:test`                          | UPDATE/DELETE refused by trigger   | PASS   | —                                     |
| KLSEC-E-02 | No secret material in logs or events  | pairing and terminal-health residue probes     | package suites                               | No 64-hex, nonce, key or signature | PASS   | —                                     |
| KLSEC-E-03 | No secret material in the repository  | `scripts/verification/secret-scan.mjs`         | `pnpm secret:scan`                           | 1405 tracked files clean           | PASS   | One checksum-pinned rejection fixture |
| KLSEC-E-04 | Migration history is immutable        | `hub-db.mjs` journal + `hub-validate.mjs` pins | `pnpm hub:db:status`, `pnpm hub:db:validate` | Drift or mutation REFUSES          | PASS   | Line-ending independent since T008    |
| KLSEC-E-05 | Trusted time never regresses          | `t007-cloud-races` D3; `test-clock-governance` | suites                                       | Floor monotonic under concurrency  | PASS   | No RTC/TPM exists to test against     |

## 3. Support access and containment

| ID         | Requirement / risk                      | Test file                                | Command        | Expected                                      | Result | Residual       |
| ---------- | --------------------------------------- | ---------------------------------------- | -------------- | --------------------------------------------- | ------ | -------------- |
| KLSEC-P-01 | Support sessions are scoped and capped  | assertions §55; `t007-cloud-races` F10   | `pnpm db:test` | C1/C2/C3 caps; consent evidence required      | PASS   | —              |
| KLSEC-P-02 | Support read-only surface is views      | assertions §55d                          | `pnpm db:test` | No base-table reach for `support_ro`          | PASS   | —              |
| KLSEC-P-03 | Containment blocks device operation     | assertions §55; `release-agent` precheck | `pnpm db:test` | Contained device refuses updates and sessions | PASS   | —              |
| KLSEC-P-04 | Containment apply/clear cannot deadlock | `t007-cloud-races` F11                   | suite          | Governed winner in 20/20                      | PASS   | Closed by 0181 |

## 4. BLK-007 disposition

BLK-007 required "two canonical security test plans (KLREC-017/KLREQ-011)" —
consolidated and CONTRACT-APPROVED as
`kitluy-phase1-security-test-system-v1.0.0.md` — **plus** the missing
`kitluy-testing-and-evidence-system-v1.0.0` document cited as `source_document`
by 41 registry rows (KLREQ-008 / KLREC-2026-07-26-018).

**This document discharges the EXECUTABLE half of that gap for WS-11 and the
shared platform gates**: §1 gives a qualified engineer the toolchain, the
migration and seed order, the runtime and key-generation process, every
command, the expected outcomes, failure diagnosis and rollback; §2–§3 bind
every executed security family to a file, a command and a result.

**BLK-007 therefore REMAINS OPEN, with its remaining gap narrowed and named:**
the 41 non-WS-11 registry rows that cite
`kitluy-testing-and-evidence-system-v1.0.0` still have no source document, and
re-sourcing them (or supplying that document) is an OWNER decision about
evidence policy across all workstreams — it is not WS-11 work and is not
closed here. No WS-11 capability depends on it; WS-11's own security
verification is executable from this file alone.

## 5. What this plan does NOT prove

- Nothing about pilot or production. BLK-005 (PKI, HSM/secure element,
  hardware certification) and BLK-006 (production transports and producers)
  are fail-closed and were re-proven so from a database rebuilt from zero.
- Nothing about physical devices. The Raspberry Pi boot-slot and Electron
  updater adapters are development harnesses (`FakeDevice`), declared as such
  in code, handoffs and the status register.
- No penetration test, load test or chaos test has been run
  (`pnpm test:security`, `test:load`, `test:recovery`, `test:hardware` remain
  intentionally blocked stubs).
