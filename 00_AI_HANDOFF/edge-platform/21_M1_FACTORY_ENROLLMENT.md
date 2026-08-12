# M1 — factory identity and enrollment path

**Date:** 2026-08-07 · **Branch:** `main` · **HEAD:** `e9a7c39` (unchanged, 0 commits)
**Status:** **M1 BUILT and TESTED against the canonical database.**
Not DEPLOYED-IN-DEV (no cloud target). Not HARDWARE-TESTED (no Raspberry Pi).

---

## 1. Reported state — verified, not assumed

Every figure the previous execution reported was re-measured against a database
built from zero by all 86 canonical migrations:

| Reported                      | Actual                                               | Verdict                             |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------- |
| HEAD `e9a7c39`, 0 commits     | `e9a7c39`, 0 commits                                 | confirmed                           |
| 86 migrations                 | 86                                                   | confirmed                           |
| `kitluy_devices` 66 relations | 66                                                   | confirmed                           |
| `kitluy_releases` 5 relations | 5                                                    | confirmed                           |
| `kitluy_config` 4 relations   | 4                                                    | confirmed                           |
| 27 canonical enums            | 27 in `kitluy_devices` (29 across all `kitluy_*`)    | confirmed, with the scope clarified |
| os-image 34/34                | 34/34                                                | confirmed                           |
| firstboot agent 31/31         | 43/43 at intake (31 + 12 boundary tests added later) | confirmed, count moved on           |

`device_class` and `device_lifecycle_state` are unchanged and were not touched.

### 1.1 Named source authority is ABSENT

`kitluy-edge-hardware-ecosystem-architecture-v1.0.0.md` **does not exist** in
the repository, and is not listed in the Drive source manifest. The
architecture in the task prompt was therefore treated as owner authority, cross-
checked against the authority that does exist:

`docs/source/offline/kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md`
— which independently confirms **Raspberry Pi 5** for both Store Hub (8 GB) and
terminal (4 GB), matching the `rpi5` device layer already pinned.

**Recorded as a documentation gap, not silently invented.**

---

## 2. Existing capability reuse — E01–E10 were reused, not recreated

The single most important finding: **M1's device-registry step needs no new
schema.** A real enrollment executed against the canonical database:

    kitluy_devices.enroll_device_v1(...)
      -> device_record_id  5ee5ce00-…
      -> lifecycle_state   enrolled
      -> device_class      store_hub      (DERIVED from the hardware profile)
      -> active assignments 0             (ENROLLED + UNASSIGNED)

| M1 requirement               | Existing implementation                                                | Reused / changed      | Evidence                    |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------- | --------------------------- |
| device identity              | `devices`, `manufacturing_enrollments`                                 | **reused**            | `enroll_device_v1` executed |
| key-possession binding       | `device_public_key_fingerprint` (`^[0-9a-f]{64}$`)                     | **reused**            | constraint verified live    |
| hardware manifest            | `hardware_manifests`, `hardware_manifest_signals`, `hardware_profiles` | **reused**            | manifest accepted           |
| enrollment station / batch   | `enrollment_stations`, `p_enrollment_batch_ref`                        | **reused**            | fixtures created            |
| device class registry        | `device_class` enum                                                    | **reused unchanged**  | 4 values verified           |
| enrolled-unassigned state    | `enrolled` + no active assignment                                      | **reused unchanged**  | `active_assignments = 0`    |
| duplicate-evidence refusal   | `KLUY-DEVICE-EVIDENCE-MISSING/DUPLICATE`                               | **reused**            | refusal test passes         |
| heartbeat                    | `device_health_reports`, `device_health_projections`                   | **reused**            | contract unchanged          |
| **factory QA result**        | **absent**                                                             | **DELTA — not built** | §5                          |
| **provisioning eligibility** | **absent as stored state**                                             | **derived instead**   | §4                          |

**No migration was written. Migration count is unchanged at 86.** No enum, no
table and no parallel identity model was created.

---

## 3. What was built

### `services/kitluy-device-firstboot-agent` — 98 tests (was 43)

| File                                 | Purpose                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/factory.ts`                     | factory state machine, manifest validation, software QA, eligibility predicate, log redaction |
| `src/factory-gateway.ts`             | composition over `enroll_device_v1`; canonical state and eligibility reads                    |
| `test/factory.test.ts`               | 43 unit tests                                                                                 |
| `test/factory-gateway.test.ts`       | 13 contract tests (no database)                                                               |
| `test/factory-enrollment.db.test.ts` | **9 database-backed integration tests**                                                       |

Status: **BUILT · TESTED**.

### `infra/kitluy-os-image/` — terminal profile moved to Wayland

The terminal layer previously carried an X11 stack (`xserver-xorg`, `openbox`),
which contradicts the stated architecture. It now uses **Wayland with `labwc`**
— also the Raspberry Pi OS Bookworm default on Pi 5 — plus `seatd`,
`libinput-tools`, `wlr-randr` and `evtest` for the touchscreen foundation, and
reuses upstream's `device-user-admin` layer for the unprivileged session user
instead of declaring a competing one.

Image names now match the two golden families:

    kitluy-storehub-os-arm64            (image-rota: A/B + userdata)
    kitluy-pos-terminal-wayland-arm64   (image-rota: A/B + userdata)

Verified by the **upstream builder itself** at pinned tag `v2.7.0`:

    rpi-image-gen layer --srcroot <KitLuy source> --describe kitluy-pi-terminal
      Layer: kitluy-pi-terminal   Version: 0.2.0
      Depends: device-user-admin -> device-user-credentials

Status: **BUILT · TESTED (build graph) · NOT image-generated**.

---

## 4. Provisioning eligibility is DERIVED, never stored

`PROVISIONING_ELIGIBLE` is **not** a database state and was not added as one.
It is computed from canonical facts:

    enrolled  AND  no active assignment
              AND  sealed hardware manifest
              AND  certified hardware profile
              AND  software QA passed

This mirrors the discipline the schema already applies to "enrolled and
unassigned". A stored eligibility flag would be a second copy of the truth, and
the copy is what goes stale — a device revoked after being marked eligible would
still read as eligible.

The agent's factory states are likewise **agent progress**, not database enums,
related to canonical truth by an explicit mapping table
(`CANONICAL_STATE_MAPPING`) that a test asserts is total. Every pre-enrollment
state maps to `canonicalLifecycle: null`, making visible exactly where a device
stops being a local process and becomes a fleet record. No factory state maps to
anything but `enrolled` — factory enrollment never reaches `awaiting_trust` or
`active`, which belong to Store provisioning.

---

## 5. The one genuine schema delta — NOT built

**Factory QA result persistence has no canonical home.** There is no `qa`,
`factory` or eligibility concept in `kitluy_devices`
(`production_eligible` is a different, BLK-005-gated production-certification
flag and was not repurposed).

Today the QA result is computed and passed in memory to the eligibility
predicate. Persisting it needs migration `0188` with, at minimum: an
append-only `device_factory_qa_results` relation keyed by device and QA run,
the check outcomes, the agent/image versions, RLS, and an audit event.

**Deliberately not written this session**, for three reasons:

1. The canonical chain **cannot currently deploy to PostgreSQL 16+**
   (`14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3). Adding migration 87 to a
   chain that halts at 51 adds schema nobody can verify.
2. Migrations in this codebase are 170–1800 lines with assertions, RLS,
   triggers and audit. A rushed governed-security migration is worse than none.
3. Every recent migration **creates a role**, which is the exact PG16+
   `CREATEROLE` pattern that breaks the chain. A new one would inherit the
   defect unless deliberately designed around it.

---

## 6. Evidence — database-backed, not mocked

Isolated canonical database, ports 54361–54364. The `hsa_eco` stack still holds
54321–54323 and was **not** stopped; no unrelated project was altered.

    reset from zero ......... 86 / 86 applied, exit 0
    seed .................... exit 0
    schema assertions ....... exit 0
    RLS tests ............... exit 0

    kitluy schemas 15 · tables 183 · views 2 · functions 255
    triggers 160 · enums 29 · foreign keys 466
    RLS-enabled 181/183 (kitluy_devices 64/64) · policies 258

The two tables without RLS are `kitluy_ops.migration_journal` and
`kitluy_ops.test_clock_policy` — internal operational tables.

### Integration results (9/9, every test inside a rolled-back transaction)

| Scenario                                                       | Result   |
| -------------------------------------------------------------- | -------- |
| Store Hub: first boot → enroll → QA → PROVISIONING_ELIGIBLE    | **PASS** |
| Terminal: first boot → enroll → QA → PROVISIONING_ELIGIBLE     | **PASS** |
| replayed enrollment → one device, `created: false`             | **PASS** |
| reboot during enrollment → resumes, 1 enrollment row           | **PASS** |
| two distinct devices → two identities                          | **PASS** |
| empty manifest → `KLUY-DEVICE-EVIDENCE-MISSING`, not retryable | **PASS** |
| QA failure alone blocks eligibility                            | **PASS** |
| canonical read: enrolled + unassigned, no stored flag          | **PASS** |

The suite **skips** (never fails) without a database — 89 passed + 9 skipped,
exit 0 — so `pnpm verify` is not turned red by an absent dependency. A skip is
reported as a skip and must not be read as a pass.

---

## 7. Hardware honesty

`runFactoryQa` emits hardware-in-the-loop checks as `not_evaluated`, never
`pass`, and excludes them from `softwarePassed` so it cannot be read as
certification. Deferred: touchscreen input, peripheral certification (Hub and
terminal), NVMe storage, thermal and power.

A test asserts that **no** hardware check can report `pass` from a simulation.

**Nothing here is hardware-certified. No Raspberry Pi has run any of it.**

---

## 8. Two defects found and fixed in this session's own work

Recorded rather than quietly corrected:

1. **`runFactoryQa` threw on a valid manifest.** The `check()` helper evaluates
   both message arguments eagerly, so the failure message dereferenced
   `problems` on a successful validation. Found by the new tests; fixed by
   narrowing instead of casting.
2. **`describe.skipIf` skipped the whole database suite even against a live
   database.** `skipIf` is evaluated at collection time, before `beforeAll`
   runs, so the reachability flag was always false. Fixed with a module-scope
   probe. Without this the suite would have reported a silent, permanent skip.

A third issue was found in the canonical contract rather than in this work: the
fingerprint must match `^[0-9a-f]{64}$`, and a violation surfaced as an opaque
refusal. The gateway now checks the shape locally and returns
`KLUY-DEVICE-FINGERPRINT-MALFORMED` before contacting the database.
