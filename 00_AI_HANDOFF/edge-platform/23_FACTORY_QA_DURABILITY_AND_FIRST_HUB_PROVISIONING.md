# Durable Factory QA and the first Store Hub provisioning

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

**Date:** 2026-08-10 · **Branch:** `main` · **HEAD:** `e9a7c39` (unchanged, 0 commits, 0 pushes)
**Migrations: 86 → 87** (group `0188`, justified in §2)

---

## 1. The premise correction that shapes everything below

The task asked for proof against the **cloud** development project. That is not
currently possible, and the reason is the blocker this task was told not to
investigate.

    het-kitluy-dev (gkfcxxtryqmjnhujlkdr)  ACTIVE_HEALTHY
      kitluy schemas ......... 0
      applied migrations ..... 0 (no supabase_migrations schema)

Verified live, not read from a handoff. The cloud runs **PostgreSQL 17**, and
the canonical chain cannot apply to PG16+ — migrations `0140` and `0151` become
mutually unsatisfiable once `CREATEROLE` auto-grants membership
(`14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3). That is the open PG17
blocker, explicitly out of scope here.

**So every proof below ran against the canonical PostgreSQL 15 database** —
86 migrations applied, 185 tables — which is the only database where the chain
actually exists. Cloud E2E stays **BLOCKED** behind the PG17 blocker.

## 2. Migration decision: 86 → 87, and the three-limb proof

**A new group was necessary.** All three limbs of the §6 test were checked
before writing a line of DDL:

1. **No existing relation can hold it.** All 64 `kitluy_devices` tables were
   enumerated. `manufacturing_enrollments` seals identity evidence and has no QA
   column (`enrollment_state` is `sealed|superseded|revoked` — none means
   "tested"). `device_hardware_observations` is runtime attestation.
   `device_trust_incidents` records failures of trust, not test execution.
   `device_lifecycle_events` audits lifecycle transitions — and QA is
   deliberately _not_ one, so storing it in `detail jsonb` would put the
   authoritative record inside an audit row for a transition that never
   happened.
2. **No unapplied migration owns it.** 86 files on disk, 86 applied, no
   `CREATE TABLE` matching a QA relation anywhere.
3. Therefore it cannot be implemented safely on existing schema.

Group `0188` is additive only: two tables, two enums, three functions, one view.
No column was dropped, no enum altered, no existing function changed.

## 3. What group 0188 installs

    factory_qa_executions      one row per QA run, append-only,
                               bound to the CURRENT manufacturing enrollment
    factory_qa_check_results   one row per check, append-only

Design points that carry weight:

- **Bound to the enrollment, not just the device.** Re-enrollment after repair
  seals new evidence, so prior QA becomes structurally invisible rather than
  merely stale.
- **`factory_qa_check_results_hil_never_pass_chk`** — a hardware-in-the-loop
  check may never be recorded as `pass`. The agent already refuses this in
  TypeScript; the database refuses it too, because the agent is not the only
  thing that can write. Proven by a test that bypasses the agent entirely.
- **The verdict is derived, not submitted.** `record_factory_qa_v1` computes
  `passed`/`failed` from the checks, so a caller cannot submit failing checks
  with a passing verdict.
- **Idempotent by `(device_id, execution_ref)`**, and a same-ref resubmission
  carrying _different_ evidence is **refused**, not ignored — two results for
  one reference means one is wrong, and choosing either is worse than stopping.
- **No stored eligibility flag.** A migration assertion fails the build if a
  column named `is_provisioning_eligible` / `provisioning_eligible` /
  `factory_qa_passed` ever appears on `devices`.

`evaluate_provisioning_eligibility_v1(device)` derives eligibility fail-closed
from: claimable lifecycle, no live assignment, sealed manifest, **passed durable
QA for the current enrollment**, no open trust incident, no evidence collision,
no containment. There is no bypass argument.

> **One alignment fix found by testing.** The first draft required lifecycle
> `enrolled`. `create_device_claim_v1` admits `enrolled` **and**
> `awaiting_trust`. Left disagreeing, the portal would disable a control the
> server would have allowed. They now agree.

## 4. Restart durability — the reason this task existed

`test/factory-qa-durability.db.test.ts` — **8/8 passing**. It COMMITS and then
drops the connection entirely, because a value visible only inside the writing
transaction proves nothing.

    passing QA persists, eligibility derives true ................ PASS
    PROCESS RESTART: new connection still sees pass + eligibility  PASS
    failed QA persists and stays INELIGIBLE across restart ....... PASS
    no QA at all -> ineligible (absence is denial, never pass) ... PASS
    idempotent on same execution_ref ............................. PASS
    same ref + different evidence -> REFUSED ..................... PASS
    hardware-in-the-loop `pass` -> refused by the database ....... PASS
    UPDATE and DELETE on QA evidence -> refused (append-only) .... PASS

Fixtures are deterministic on purpose: the tables are append-only, so a suite
generating a random device per run would grow the database forever and could
never clean up after itself.

## 5. The one clean development Store Hub

Created entirely through canonical functions — no row hand-inserted into
`devices`, `manufacturing_enrollments`, `device_claims` or `device_assignments`.

    device_record_id  6b7eb414-bcc0-40c1-8043-4a9548ac81e3
    asset_tag         DEV-HUB-4C0C99C2
    device_class      store_hub          (DERIVED by the database)
    lifecycle_state   awaiting_trust     (after a canonical activation attempt)
    factory QA        passed, durable, bound to current enrollment
    assignment        pending_trust -> tenant …011 / store …015 / location …018

## 6. Provisioning issuance and claim — proven end to end

`test/hub-provisioning-e2e.db.test.ts` — **7/7 passing**.

    single-use code issued via create_device_claim_v1 ............ PASS
    only the SHA-256 digest is stored; plaintext unrecoverable ... PASS
    claim succeeds via redeem_device_claim_v1 .................... PASS
    replay of the same code -> REFUSED .......................... PASS
    a second code while an assignment is live -> REFUSED ........ PASS
    claim presented by the WRONG device -> REFUSED .............. PASS
    exact-manifest observation accepted, device NOT quarantined .. PASS
    mismatched observation -> matched = false, response intact ... PASS

The observation is built by the **same function** that produced the enrollment
manifest. Retyping it approximately would make the device quarantine itself.

## 7. Liveness — NEVER_SEEN to ONLINE, in canonical data

`services/kitluy-management-api/test/fleet-liveness.db.test.ts` — **7/7**.

    before provisioning   last_observed_at = NULL   -> NEVER_SEEN
    after observation     2026-08-10 06:37:32Z      -> ONLINE
    +120s (clock moved)                              -> STALE
    +400s (clock moved)                              -> OFFLINE

The stored observation is never rewritten — `device_hardware_observations` is
append-only precisely so nobody can. The **observer's clock** moves instead,
which `deriveFreshness` already takes as a parameter. Thresholds remain
configuration (`MANAGEMENT_API_STALE_AFTER_SECONDS` / `…_OFFLINE_AFTER_SECONDS`,
defaults 90/300), asserted separately so a re-tuned threshold cannot hide.

Exact boundary semantics are pinned in a pure test: `observed_at` carries
microsecond precision and a JS `Date` carries milliseconds, so "exactly 90s
after a real row" tests float truncation, not policy.

## 8. Hub activation — the exact remaining blocker

Asked of the canonical function rather than assumed:

    attempt_activate_device_v1(hub, 'development', 'admin/m1-dev-provisioning')
      -> REFUSED  KLUY-DEVICE-TIME-UNTRUSTED
         "device has never established trusted time. A Store Hub with no WAN
          and an invalid RTC stays in awaiting_trust (KLD-2026-07-28-002
          §12.5, §12.10)"

**Correction to earlier handoffs.** The comment on `devices.lifecycle_state`
says `active` "requires approved PKI configuration (BLK-005) and is currently
unreachable". That comment predates migration `0122` §5, which inserts a
DEVELOPMENT PKI trust configuration by owner decision. The PKI gate is
therefore **satisfied for `development`** (verified: one active row). BLK-005
remains open for pilot/production, but it is **not** what blocks this Hub.

**The smallest genuine activation blocker is trusted time.** Nothing was
bypassed to work around it.

## 9. Tests

    firstboot agent (incl. QA durability + Hub E2E) .... 113/113
    management API (incl. fleet liveness) .............. 93/93
    device-identity, against the canonical DB .......... 875/877 (2 skipped)
    migration validation ............................... 87 files, PASS
    secret scan ........................................ PASS (1458 files)

## 10. `pnpm verify` — fresh, classified

| Gate                                 | Result | Classification                   |
| ------------------------------------ | ------ | -------------------------------- |
| Lint, Typecheck, Build               | PASS   | —                                |
| Contract, Offline, OpenAPI           | PASS   | —                                |
| Migration + Hub migration validation | PASS   | —                                |
| Secret scan, Clock usage             | PASS   | —                                |
| **Unit tests**                       | FAIL   | **ENVIRONMENTAL**                |
| **Format check**                     | FAIL   | **PRE-EXISTING (newly visible)** |
| **Docs link check**                  | FAIL   | **PRE-EXISTING**                 |

- **Unit tests** — 85 failures, all in `@kitluy/device-identity`. Its harness
  defaults to `127.0.0.1:54322`, which the **`hsa_eco` stack occupies** (0
  kitluy schemas). Pointed at the canonical database via `KITLUY_DEV_DB_URL`,
  the same suite is **875/877 passing**. Not a regression; not caused by 0188,
  which is purely additive.
- **Format check** — previously exited 2 on `EACCES` while expanding `.`,
  because the ARM64 image build left a root-owned `…/persistent/home/pi` inside
  `infra/kitluy-os-image/build/`. Prettier expands before applying ignores, so
  `.prettierignore` could not help. The regenerable chroot tree was removed
  (artifacts kept). Prettier now walks the whole tree and reports **47
  pre-existing** style issues that the crash had been masking. The six
  task-owned files were formatted; 47 unrelated files were deliberately **not**
  reformatted.
- **Docs link check** — 4 broken links in
  `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__…`, untouched here.

## 11. Not done, and why

- **Management API `POST /provisioning-sessions`** — NOT built. The router is
  read-only by construction (`if (request.method !== "GET") return 405`) and
  the permission `fleet.device_provisioning_code.issue` is already registered.
  The canonical RPC path is proven end to end; only the HTTP surface is absent.
- **Admin Portal provisioning UI** — NOT built.
- **Store Hub CLI, image restage** — NOT built. No firstboot binary is installed
  into the image (`/usr/lib/kitluy/` is empty by design, mission §27), so there
  was nothing new to stage; the existing DEV-UNSIGNED artifacts stand.
- **Terminal provisioning** — correctly not attempted; the Hub is not ACTIVE.

## 12. Remaining blockers

| Blocker                                                 | Class              |
| ------------------------------------------------------- | ------------------ |
| `KLUY-DEVICE-TIME-UNTRUSTED` — trusted time for the Hub | **the next task**  |
| PG17 chain incompatibility (blocks all cloud E2E)       | open, out of scope |
| BLK-005 signing (pilot/production)                      | open, unchanged    |
| `ssl-cert-snakeoil.key` shared across golden images     | image definition   |
| Physical Raspberry Pi validation                        | hardware           |
| 47 pre-existing prettier issues; 4 broken doc links     | housekeeping       |
