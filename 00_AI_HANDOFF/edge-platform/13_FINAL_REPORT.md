# Edge platform mission — final report

**Date:** 2026-08-07 · **Branch:** `main` · **HEAD:** `e9a7c39` (unchanged)
**Nothing was committed. Nothing was pushed.**

---

## 0. Summary in one paragraph

The cloud edge/device backend this mission set out to build **already existed**
— E01–E10 were delivered by WS-11 and WS-12 across migration groups
`0120`–`0187`, and this mission proved that by building the whole schema from
zero and running its test suites. The genuine greenfield was `kitluy-os-image`,
which went from a 7-line README to an executable, tested build system plus a
tested firstboot/enrollment agent. **Cloud deployment was stopped**: the only
plausible cloud target carries a different migration lineage and 1,518 rows of
live data, and applying the canonical chain to it would have been destructive.
The Admin and Partner provisioning UIs were **not built**, and that is reported
as not done.

---

## A. Supabase

| Item                             | Result                              |
| -------------------------------- | ----------------------------------- |
| Original migration count         | **86**                              |
| Final migration count            | **86**                              |
| New migrations written           | **0**                               |
| Local reset-from-zero            | **PASS** — all 86 applied, exit 0   |
| Seed                             | **PASS** — exit 0                   |
| Structural assertions            | **PASS** — exit 0, groups 0010–0180 |
| RLS suite                        | **PASS** — exit 0                   |
| Idempotency (re-apply / re-seed) | **PASS** — no-op; `INSERT 0 0`      |
| Type generation                  | **PASS** — exit 0, 5,394 lines      |
| Cloud project status             | **BLOCKED — nothing applied**       |

**Why no migration was written.** Every capability the mission asked for
(§10–§17) already exists: 66 relations in `kitluy_devices`, 5 in
`kitluy_releases`, 4 in `kitluy_config`, 27 canonical enums. Writing migrations
would have duplicated governed schema and violated the mission's own §2/§10
instruction not to invent registries that already exist.

### KLDRV-CONF-004 — RESOLVED (facts)

The blocker required "per-environment applied-migration comparison". That was
done, against three environments:

|               | Canonical                         | Standalone donor repo             | Cloud `kitluy-suite-monorepo-dev` |
| ------------- | --------------------------------- | --------------------------------- | --------------------------------- |
| Migrations    | 86                                | 21                                | 28                                |
| Version range | `20260726180000`–`20260807040000` | `20260711000000`–`20260724192000` | `20260711000000`–`20260731160000` |
| Schemas       | 11 `kitluy_*`                     | unprefixed domain schemas         | unprefixed domain schemas         |

**Version-string intersection: 0. Schema-namespace intersection: 0.** The
donor's newest migration predates the canonical chain's oldest, and the
canonical chain was proven to apply to a genuinely empty database.

**Conclusion:** the 21 donor migrations are **not ancestors** of the canonical
chain. They are a **parallel, superseded lineage** on a different schema layout.
Canonical migration identity is unambiguous, so per mission §7 this no longer
blocks additive new migrations.

**Still an owner decision:** whether any donor _capability_ should be ported.
That is a product question, not a lineage question, and it is not resolved here.

### Remaining blockers

1. **No cloud project carries the canonical lineage** — see §C below.
2. **Generated types are stale** — committed 5,045 lines vs 5,394 fresh.
   Not regenerated: `pnpm db:types` targets a container the port collision
   prevented from existing.
3. **Local port collision** — `config.toml` declares 54321–54323; `hsa_eco`
   holds all three.
4. **Documentation defect** — the imported rebuild bible v1.1.0 names
   `qneduoifcsvjajeqmvgb` as KitLuy's Supabase project in ten places. That is
   **`hsa-eco-dev`** — a different ecosystem. Recorded, not edited (superseded
   document).

## B. Device fleet

No change. Already implemented and re-proven from zero: device identity,
enrollment records, provisioning codes with PoP challenges, claims,
assignments, heartbeat/health projections, containment, revocation (including
emergency and four-eyes), trusted time, key destruction, replacement.

## C. Cloud Supabase — STOPPED, escalation

`kitluy-suite-monorepo-dev` (ref `iovxllihauhxnlkmhfeh`) **is not this
monorepo's database despite its name.** It carries the donor lineage: 28
migrations, zero `kitluy_*` schemas, and **1,518 live rows across 112 tables**.

Applying the canonical 86-migration chain there would collide two lineages
sharing no version and no schema, and put live data at risk. Mission §39
escalation condition met — the unit was stopped, nothing was applied, no
credential was invented or printed.

**Required from the owner:** a new, empty Supabase project for the canonical
lineage; its reference recorded in repository configuration; a ruling on the
misleadingly-named existing project; and confirmation of the intended
environment.

## D. Store Hub and terminals

Cloud contracts unchanged and already complete. New device-side work:
`services/kitluy-device-firstboot-agent` — identity bootstrap with rerun
safety, the enrollment state machine, fail-closed refusals, assignment polling
and configuration-version acceptance. **31 tests, typecheck clean.**

Two canonical rules the agent enforces and pins by test: `ENROLLED_UNASSIGNED`
is `enrolled` with no assignment (not a new enum value), and an assigned device
moves to `awaiting_trust`, never straight to `active`.

## E / F. Admin and Partner portals

**Nothing was built.** Both remain two-source-file skeletons. Reported as NOT
STARTED, not as partial. Reason: a fleet UI with no cloud database to operate
would be a mockup described as capability. See
`10_ADMIN_PARTNER_PROVISIONING_REPORT.md`.

## G. `kitluy-os-image`

From one 7-line README to an executable build system: shared + per-profile
configuration, a gate library, three composition scripts, overlays, and **34
passing tests**.

- Both profiles stage a real root filesystem; profile separation asserted in
  both directions (a terminal never gets the Hub agent; a Hub never gets a
  kiosk).
- `pilot`/`stable` channels **refuse**, naming BLK-005. Only `internal` builds.
- Zero-secret and no baked assignment truth, both asserted by test.
- Staged-root digest is deterministic.
- **No flashable image is produced and none is claimed** — the build exits 3
  with `BLOCKED-NOT-EXECUTED` rather than emitting an unsigned `.img`.

Not built, not claimed: dm-verity/encrypted-partition/A-B assembly, the device
executables the systemd units reference, and any hardware validation.

## H. End-to-end tests

| Scenario                                   | Result           |
| ------------------------------------------ | ---------------- |
| fresh Pi → cloud → `ENROLLED_UNASSIGNED`   | **NOT ACHIEVED** |
| Hub → Store/Location assignment → ACTIVE   | **NOT ACHIEVED** |
| Terminal → Hub/Profile assignment → ACTIVE | **NOT ACHIEVED** |

All three require a cloud target that does not exist, device executables that
are not built, and Pi hardware that was not available. The enrollment logic is
proven **in simulation** (31 tests covering every §31 OS/agent requirement),
which is not the same thing and is not presented as such.

## I. Security

RLS suite passed in full. No policy written, weakened or relaxed. BLK-005 gate
re-proven shut (`pki_trust_configuration` empty after migrations + seed;
`production_eligible` has no path to `true`). No secret committed, embedded or
printed; `pnpm secret:scan` passed over 1,458 tracked files. No private key in
git or in any image. Audit relations untouched — this mission wrote no SQL.

## J. Verification — `pnpm verify` 10/13

| Gate                                                        | Result                         |
| ----------------------------------------------------------- | ------------------------------ |
| Lint · Typecheck · Contract tests · Offline harness · Build | **PASS**                       |
| OpenAPI · Migration validation · Hub migration validation   | **PASS**                       |
| Secret scan · Clock usage                                   | **PASS**                       |
| **Format check**                                            | **FAIL — pre-existing**        |
| **Unit tests**                                              | **FAIL — environment-blocked** |
| **Docs link check**                                         | **FAIL — pre-existing**        |

**All three failures are pre-existing or environmental, and none is caused by
this mission's changes:**

- **Unit tests** — 85 failures, all in `@kitluy/device-identity` live-database
  integration tests, failing with `relation "kitluy_devices.key_destruction_policy"
does not exist` because the local `kitluy-local` stack cannot start (port
  collision). 757 passed, 35 skipped. **The new package passed 31/31.**
- **Format check** — the long-recorded repository-wide condition (~865 files).
  Every file this mission created was formatted and **passes `prettier --check`**.
- **Docs link check** — 4 broken bare-UUID links in a 2026-07-30 handoff
  (committed `d1a35f3`, untouched by this session), already recorded as a known
  cosmetic issue.

Additionally executed outside `verify`: os-image build gates **34/34**;
firstboot agent **31/31**; database reset-from-zero, seed, assertions, RLS,
idempotency and type generation all exit 0.

## K. Git

- Branch `main`, HEAD **`e9a7c39`** — unchanged.
- **0 commits, 0 pushes.** The disabled `origin` push URL was not touched.
- Pre-existing dirty files preserved, including the unrelated modification to
  `infra/kitluy-os-image/README.md`, which was **not** reverted or edited.
- New paths added: `00_AI_HANDOFF/edge-platform/` (14 docs),
  `infra/kitluy-os-image/{build,config,overlay,test}/`,
  `services/kitluy-device-firstboot-agent/`.
- `pnpm-lock.yaml` changed by `pnpm install` for the new workspace package.

## L. Recommended next task

**Create an empty Supabase project for the canonical lineage and deploy the 86
proven migrations to it.**

It is the smallest next slice and it unblocks the most: E11, E12 and all three
end-to-end scenarios are gated behind it and nothing else. The chain is already
proven to apply from zero, so the work is `supabase link` → inspect remote state
→ apply additively → verify schema/RLS → record as `DEPLOYED-STAGING`.

Do **not** reuse `kitluy-suite-monorepo-dev`.

Second-smallest, and independent of the cloud: package the firstboot agent into
the `/usr/lib/kitluy/firstboot-identity` and `/usr/lib/kitluy/enrollment-agent`
executables the systemd units already reference.

---

## Status vocabulary

    canonical Supabase schema             IMPLEMENTED-IN-DEV (re-proven from zero)
    KLDRV-CONF-004 lineage facts          RESOLVED
    cloud deployment                      BLOCKED — no valid target
    kitluy-os-image build system          SCAFFOLDED-EXECUTABLE (34 tests)
    firstboot/enrollment agent            IMPLEMENTED-IN-DEV (31 tests)
    device executables                    NOT BUILT
    Admin/Partner provisioning UI         NOT STARTED
    end-to-end scenarios                  NOT ACHIEVED
    hardware certification                NOT CLAIMED
