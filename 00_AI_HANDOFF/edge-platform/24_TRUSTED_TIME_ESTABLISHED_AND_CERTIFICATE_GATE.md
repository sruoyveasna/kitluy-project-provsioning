# Trusted time established; activation now blocked on the certificate gate

> ## ⚠ CORRECTION (2026-08-10) — read this before anything below
>
> Statements in this document about "the cloud" being EMPTY, PG17-BLOCKED, or
> about `gkfcxxtryqmjnhujlkdr` / `het-kitluy-dev` being the development target
> are **WRONG** and are superseded by **KLD-2026-08-10-CLOUD-TARGET-001**.
>
> The canonical cloud development project is **`gjgbnkhuwlwhngbtrgts`
> (kitluy-project-pos)**, it is at **87/87 migrations**, and it is at full
> schema parity with local. The **PG17 blocker is CLOSED**.
>
> The error came from enumerating Supabase projects through the MCP connector
> only; that connector is authenticated to a different account than the one
> owning the real project. Everything else in this document stands.

**Date:** 2026-08-10 · **Branch:** `main` · **HEAD:** `e9a7c39` (unchanged, 0 commits)
**Migrations: 87 → 87** (no new migration; the trusted-time schema already existed)

---

## 1. Environment reconciliation (§2) — two earlier claims corrected

| Name                            | Ref / host                                           | PG       | KitLuy migrations | Purpose                |
| ------------------------------- | ---------------------------------------------------- | -------- | ----------------- | ---------------------- |
| canonical test DB               | local `supabase_db_kitluy-repo15`, port **54402**    | 15.8     | **87 applied**    | where all work happens |
| second local stack              | local `supabase_db_kitluy-repo17`, port 54392        | **17.6** | **86 applied**    | PG17 parity stack      |
| unrelated local stack           | `supabase_db_kitluy-suite-supabase`, 54332           | 17.6     | 0                 | different lineage      |
| occupies KitLuy's declared port | `supabase_db_hsa_eco`, **54322**                     | 17.6     | 0                 | HSA ecosystem          |
| hosted dev project              | `het-kitluy-dev` / `gkfcxxtryqmjnhujlkdr`            | 17.6     | **0**             | empty                  |
| hosted donor                    | `kitluy-suite-monorepo-dev` / `iovxllihauhxnlkmhfeh` | 17.6     | 0                 | not KitLuy chain       |

- **The ref `gjgbnkhuwlwhngbtrgts` does not exist in this account.** Nine projects
  are visible and none carry it. It refers to a different account/org or is a
  mis-transcription; no environment here matches it.
- **"PG17 blocked" was wrong as stated.** `repo17` is PostgreSQL **17.6** with
  all 86 canonical migrations applied, including `0140` and `0151`. The PG16+
  `CREATEROLE` problem recorded in handoff 14 is therefore **not** a blanket
  incompatibility. Classification: hosted project = **HOSTED PROJECT EMPTY**
  (never deployed), not PG17-blocked. The earlier report overstated this and is
  corrected here.

## 2. Migration bookkeeping defect, found and fixed

Migration `0188` had been applied to repo15 with `psql -f`, so
`supabase_migrations.schema_migrations` still read **86** while 87 files existed
on disk. The tracking row was inserted; the table now reads **87 = 87**.

## 3. Trusted time — no new schema was needed

The canonical model was already complete: `device_trusted_time`,
`device_trusted_time_events`, `evaluate_trusted_time_v1`,
`assert_trusted_time_v1`, `enforce_trusted_time_floor_monotonic`, plus the
offline mirror in `@kitluy/device-identity`. Development policy:
`max_clock_lag_seconds = 300`, `trusted_time_max_forward_jump_seconds = 3600`.

**What was missing was the transport.** No pg-backed `TrustedTimeStore` or
gateway connected the Hub firstboot flow to the authority. Added:
`services/kitluy-device-firstboot-agent/src/trusted-time-gateway.ts` —
`selectOfferableSources`, `establishTrustedTime`, `readTrustedTimeState`,
`controlPlaneNetworkTime`. It computes no floor and decides no status; §12 keeps
both.

### Source discipline

`Date.now()` cannot be passed as a source — there is no parameter for it. Each
reading must arrive validated, and is dropped with a reason otherwise: a faulted
RTC, an **unauthenticated** network reading (plain NTP), or an unverified token.

The development bootstrap source is `controlPlaneNetworkTime()` — `now()` read
server-side from the canonical control plane over the Hub's already-authenticated
connection. The device cannot influence it, which is the property `Date.now()`
lacks. **It is not a production source**: it carries no signature verifiable
offline, so it cannot bootstrap a disconnected Hub (§12.5). Production still
needs NTS or a verified `trusted_time_bootstrap` token bound to an activation
challenge — both already modelled in `@kitluy/device-identity`, both still
unimplemented, and neither weakened by this.

No RTC evidence was fabricated. No emergency correction path was used.

## 4. A real bug this work exposed

The first gateway used `(evaluate_trusted_time_v1(...)).*` in the SELECT list.
PostgreSQL expands that by **re-evaluating the function once per field** — seven
calls, seven audit events per request, and a `floor_advanced` value read from a
later call that found the floor already moved. Rewritten to the FROM-clause form,
which evaluates exactly once. Verified directly (one call → exactly one event
row) and pinned by a regression test.

## 5. Security invariants — proven, 11/11

    no source offered            -> restricted_no_trusted_source, activation refused
    valid authenticated source   -> floor established, status trusted
    PROCESS RESTART              -> floor identical on a brand new connection
    CLOCK ROLLBACK (-1h)         -> restricted_clock_rollback, floor UNCHANGED
    ADVANCEMENT (+60s)           -> accepted, floor advances, survives restart
    exactly one audit event per evaluation
    append-only event history includes the rollback attempt

Invariant tests use a dedicated fixture device, not the clean Hub: driving the
floor around would leave the provisioned Hub's floor in the future and corrode
the fixture on every run. No timestamp was ever written by hand.

## 6. Activation — the gate moved, and was not bypassed

    BEFORE:  KLUY-DEVICE-TIME-UNTRUSTED
    AFTER:   KLUY-DEVICE-NO-CERTIFICATE
             "device has no active development certificate;
              activation is certificate-backed (KLD-2026-07-21-003)"

    Hub 6b7eb414…  lifecycle = awaiting_trust
                   trusted-time status = trusted, floor = 2026-08-10 07:08:05Z
                   assignment = pending_trust

Trusted time is closed. `issue_device_certificate_v1` exists and **5 active
certificates already exist in the fleet**, so this gate is reachable in
development — it is a real next task, not a BLK-005 wall.

## 7. Terminal prerequisite

Not satisfied _by this Hub_ — it is not ACTIVE. Separately, **5 other active
`store_hub` devices already hold assignments at location …018**, so the terminal
gate at that Location is not currently blocked by Hub availability. That is a
property of pre-existing fixtures, not of this Hub, and is reported as such
rather than claimed as this task's achievement.

## 8. Tests and verify

    firstboot agent .......... 124/124   (11 new trusted-time/activation)
    management API ...........  93/93
    migration validation ..... 87 files, PASS
    secret scan .............. PASS

`pnpm verify`: PASS on Lint, Typecheck, Build, Contract, Offline, OpenAPI,
Migration ×2, Secret scan, Clock usage. Three failures, unchanged in nature:

- **Unit tests — ENVIRONMENTAL.** 85 failures, all `@kitluy/device-identity`,
  whose harness defaults to `127.0.0.1:54322` (the HSA stack, 0 kitluy schemas).
  With `KITLUY_DEV_DB_URL` pointed at the canonical DB: **875/877 passing**.
- **Format — PRE-EXISTING.** 47 files, **none task-owned**.
- **Docs link check — PRE-EXISTING.** 4 broken links in a 2026-07-30 handoff.

## 9. Remaining blockers

| Blocker                                                                      | Class                                 |
| ---------------------------------------------------------------------------- | ------------------------------------- |
| `KLUY-DEVICE-NO-CERTIFICATE` — Hub needs an active development certificate   | **the next task**                     |
| Management API provisioning POST route; Admin UI; Hub CLI                    | not built                             |
| Hosted cloud project empty (never deployed) — reclassified, not PG17-blocked | deployment                            |
| BLK-005 signing (pilot/production)                                           | open                                  |
| `ssl-cert-snakeoil.key` shared across golden images                          | image hardening (recorded, untouched) |
| Physical Raspberry Pi validation                                             | hardware                              |
| 47 prettier / 4 doc links                                                    | housekeeping                          |
