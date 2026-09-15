> **Snapshot, 2026-09-14 (diagnosis only, before any fix).** Its two principal
> blockers — re-flash operational-credential recovery and the Store Hub identity
> selection — were implemented and tested the same day: see
> `00_AI_HANDOFF/edge-platform/39_A_REFLASHED_DEVICE_RECOVERS_ITS_CREDENTIAL.md`.
> The live-state facts below (board reachability, release assignments) are as observed then.

# KITLUY PROVISIONING BLOCKER REPORT

Diagnosis run: 2026-09-14, about 15:30–16:20 (+07). Diagnosis only: no repository file was changed, nothing was committed or pushed, and every database query ran with `default_transaction_read_only = on`.

Evidence labels used below:

- **CONFIRMED**: observed in this run.
- **REPORTED**: recorded in the repo's own report `docs/reports/2026-09-12__U1-HARDWARE-ACCEPTANCE-STOPPED-DEFECTS-AND-CORRECTIONS.md` (hereafter "the U1 report") and not re-observed here.
- **INFERRED**: follows from confirmed code and data, but not yet observed.

All times are +07 unless marked.

---

## 1. Executive Summary

1. Device provisioning is built and was run on real hardware on 2026-09-14. That covers image, identity, registration, approval, pairing, operational certificate, Store Hub mTLS and Terminal LAN pairing. The work actually in progress is **U1**, the first over-the-air update of the Pi Terminal's Device Shell, and it is stopped at hardware acceptance: Tests A/B/C/D have not passed.
2. **Test A stopped on "Defect 5".** The update agent on the flashed image asks the release source for updates using a locally derived asset tag the cloud does not know, gets `404`, and reports `NOTHING_TO_DO`.
   - The fix is in code at HEAD.
   - A fixed Terminal image was built at 12:27 but **never flashed**: the database shows no new installation generation.
3. **Every acceptance test also requires "the terminal is still SERVING", which cannot be met.** The Store Hub answers the Terminal's eligibility and configuration requests with `503 HUB_NOT_OPERATIONAL`.
   - Cause: `runtime-bootstrap.ts` picks the oldest, revoked Hub identity row.
   - That defect is **still unfixed at HEAD**, has no test, and falls outside U1's written scope.
4. **The structural root cause:** every remaining fix has to reach a board by re-flashing its SD card, and a re-flashed board that already holds an operational certificate cannot get a new one.
   - The issuance code always binds the key at generation 1.
   - Nothing routes a re-flashed board to the rotate-key renewal path that already exists.
   - All three boards now hold a generation-1 certificate, so re-flashing any of them brings the collision back.
5. The last time that collision was cleared, it took an owner-ordered TRUNCATE of the local device database. That reset gave the Hub a new cloud identity, which is exactly what created the stale Hub row behind `HUB_NOT_OPERATIONAL`.
6. The real release assignment for the Terminal is also hidden right now. A `release:chain:check` run at 12:04 assigned three synthetic releases to the same hardware Terminal and revoked them. Under the "newest assignment or nothing" rule (migration 0223) the Terminal is now offered **no** assignment.
7. Both boards are offline at the time of this diagnosis.
8. **Classification:**
   - Mostly **not broken code**. It is two device-level defects (one fixed but not deployed, one unfixed), one design gap in re-flash credential recovery, and polluted test state.
   - **Owner decisions are required** on Hub-fix scope and on re-flash credential recovery.
9. The repository's state documents still describe the WS-12 milestone from August and never mention U1.

---

## 2. Current Repository State

```text
Repo:             ~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
Remote:           provisioning = github.com/sruoyveasna/kitluy-project-provsioning (public; push enabled)
                  origin       = github.com/Soenghak3301/HET-KITLUY-PROJECT (fetch only; push URL disabled by design)
Branch:           claude/fix-firstboot-esm-and-ssh-hostkeys  (local main points at the same commit)
HEAD:             0687d8c  2026-09-14 15:17 +07  Sruoy Veasna
                  "style(repo): format, lint and de-flag the in-flight snapshot"
Ahead/behind:     provisioning/main and provisioning/<branch>: 0 / 0 (identical)
                  origin/main: 67 ahead, 0 behind
Working tree:     clean. 0 modified, 0 untracked, 0 stashes
Uncommitted work: none
```

Notes:

- **Git history cannot show individual attempts.** All work from 2026-09-10 to 2026-09-14 (Store Hub serving terminals, U1 phases, Defects 1–5 and their fixes, migrations 0221–0223) was uncommitted until today, when it was committed as one snapshot, `74722be`. The reports and handoffs are the only record of what was tried.
- **Migrations are in sync on the hardware database stack.** The stack the boards register against, `kitluy-fresh` (`:54371` API / `:54372` DB), has **122 of 122 repo migrations applied, latest `20260911160000_0223_newest_assignment_or_nothing`**. There are no unapplied and no unknown migrations (CONFIRMED).
- **The hosted dev project (`kitluy-project-pos`) was not checked.** That would need credentials outside the repo, so its migration state is UNKNOWN.

---

## 3. Current Provisioning Goal

**U1: hardware acceptance of the Pi Terminal device-update chain.** The plan is:

1. Post-flash bootstrap proof, items 1–7.
2. Tests A (install), B (rollback), C (power-cut recovery) and D (tamper refusal), with no SD-card change between them.
3. Every test ends with "and the terminal is still SERVING".

Sources:

- U1 report §10 "What remains", §11 "Bootstrap proof on the corrected image (2026-09-14)", §12 "DEFECT 5"
- `docs/reports/2026-09-11__U1-IMPLEMENTATION-PLAN.md` (tests at plan:269 and :281; scope fence at :291–306)
- `docs/reports/2026-09-11__U1-HARDWARE-ACCEPTANCE-RUNBOOK.md`

Immediately before stopping, Test A ran like this:

1. Release `0.4.12-a` was published, signed, promoted and assigned to Terminal `KL-1CB3577C26A7` (assignment sequence 1, 11:49; CONFIRMED in the database).
2. The agent polled with trust loaded and reported `NOTHING_TO_DO`, which is Defect 5 (REPORTED).

The fix work that followed:

- `release-runtime.ts` now names the device by `deviceId`, and `release-service.mjs` accepts a UUID. Both are CONFIRMED at HEAD.
- The Terminal overlay was repackaged (file time 12:05) and a Terminal image was rebuilt (12:27, `.img.zst` sha256 `5080fe471aba…`). Both are CONFIRMED on disk.
- The image was not flashed (see §6 R4).

```text
STATUS: IN PROGRESS, BLOCKED at hardware acceptance
```

**CONFLICT: what the repo's state documents say.**

- `00_AI_HANDOFF/000_ACTIVE_PHASE.md:3,128` and `000_CURRENT_STATE.md:21` give the active milestone as **WS-12 T1 Intake/Cashier, next WS-12-T003 NOT STARTED**.
- `000_BLOCKERS.md:139–147` says T003 is blocked by a missing owner package.
- "U1" does not appear in any state or authority document, including CURRENT_STATE, ACTIVE_PHASE, BLOCKERS, the INDEX, the evidence register, the decision register and `docs/decisions/`.
- The U1 owner rulings OD-U1-1/2/3 exist only at `U1-IMPLEMENTATION-PLAN.md:11–17`.

---

## 4. Last Verified Working Point

REPORTED on hardware in U1 report §11 (image `6ea367bd…`, board `pi5-unljtj` / `KL-1CB3577C26A7`). The database facts marked CONFIRMED below were checked in this run.

| Stage                                                                             | Result                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap items 1–5 and 7                                                         | PASS: `/persistent` mounted, `/persistent/shared/kitluy` exists, update agent active with 0 restarts, `:8791` is the release service, release trust loads with `trustedKeys=1`, no stray assignment |
| Image Defects 1–4 (unit sandbox path, release-source port, enrollment URL, umask) | Fixed and confirmed on hardware                                                                                                                                                                     |
| Registration and re-flash recovery                                                | Worked. CONFIRMED: installation generation 2 opened at **09-14 11:18**, generation 1 superseded                                                                                                     |
| Terminal operational certificate                                                  | Issued and adopted. CONFIRMED: `device_identity` credential head at generation 1, updated **09-14 11:24**                                                                                           |
| Terminal ↔ Store Hub LAN pairing                                                  | Succeeded, after manual development stand-ins: terminal projection delivered, dev configuration published, Hub self-identity re-projected                                                           |
| Release chain                                                                     | publish → sign → promote → assign → assignment-sign worked; the release source served a signed assignment under the cloud tag                                                                       |

Not verified:

- Hub eligibility/configuration returning 200
- SERVING
- Any install, rollback, power-cut recovery or tamper refusal on hardware

---

## 5. First Broken or Unfinished Point

There are two stop points, and they are independent. 5a is first in execution order; 5b blocks every test's SERVING clause.

### 5a. Release assignment → install (Test A)

```text
Stage:     Release assignment -> install (update agent on the Pi Terminal)
File:      services/kitluy-device-firstboot-agent/src/release-runtime.ts
           (as baked into flashed image 6ea367bd; the code at HEAD is different)
Function:  the release runtime named itself as assetTag: assetTagFromFingerprint(fingerprint)
Command:   curl "http://127.0.0.1:8791/release/v1/assignment?device=KL-6F4E86A71516"
Expected:  200 with a signed assignment for 0.4.12-a
Actual:    404 {"error":"unknown device on this target"}  -> agent: NOTHING_TO_DO
Fix state: at HEAD, release-runtime.ts:225-228 passes deviceRef: deviceId, and
           release-service.mjs:150-152 accepts a UUID or an asset tag.
           Image built 12:27, NOT flashed.
```

### 5b. Store Hub eligibility and configuration → SERVING

```text
Stage:     Terminal runtime eligibility + configuration from the Store Hub -> SERVING
File:      services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts:189-193 (refuses at :202)
Function:  Hub self-identity lookup:
             select id, lifecycle_status, trust_status from edge_identity.hub_device
              where device_kind = 'store_hub' order by created_at limit 1
           No trust or lifecycle filter. Compare hub/migrations/0042_terminal_pairing_signing_credential.sql:119-122,
           which filters trust_status='trusted' and lifecycle_status='deployed' before ordering.
Command:   hardware only (Hub offline in this run); no automated test has two hub_device rows
Expected:  200 eligibility, 200 configuration -> terminal SERVING
Actual:    503 HUB_NOT_OPERATIONAL on edge:runtime-eligibility and edge:configuration-current;
           terminal DEGRADED (REPORTED, U1 report §11)
```

---

## 6. Reproduction

Every command below is read-only and was run in this diagnosis.

### R1. Defect 5 still reproduces against the live release service (CONFIRMED)

```bash
curl -s -w ' %{http_code}\n' "http://127.0.0.1:8791/release/v1/assignment?device=KL-6F4E86A71516"   # tag the device derives
curl -s -w ' %{http_code}\n' "http://127.0.0.1:8791/release/v1/assignment?device=KL-1CB3577C26A7"   # tag the cloud holds
curl -s -w ' %{http_code}\n' "http://127.0.0.1:8791/release/v1/assignment?device=<device uuid 7a6f1e26-…>"
curl -s http://127.0.0.1:8791/health
```

```text
KL-6F4E86A71516 -> 404 {"error":"unknown device on this target"}
KL-1CB3577C26A7 -> 200 {"assignment":null}
7a6f1e26-…      -> 200 {"assignment":null}
health          -> 200 {"status":"ok","target":"LOCAL stack (127.0.0.1:54372/postgres)"}
```

### R2. The real assignment is hidden by revoked chain-check assignments (CONFIRMED, not in the U1 report)

```bash
docker exec supabase_db_kitluy-fresh psql -U postgres -At -c "set default_transaction_read_only=on;
 select d.asset_tag, i.desired_version, i.assignment_sequence, i.status,
        to_char(i.updated_at at time zone 'Asia/Phnom_Penh','MM-DD HH24:MI')
   from kitluy_releases.device_installations i join kitluy_devices.devices d on d.id=i.device_id
  order by i.assignment_sequence;"
```

```text
KL-1CB3577C26A7 | 0.4.12-a                      | 1 | assigned | 09-14 11:49
KL-1CB3577C26A7 | 0.0.0-chain-mu0s32yp          | 2 | assigned | 09-14 12:04
KL-1CB3577C26A7 | 0.0.0-chain-mu0s32yp-older    | 3 | assigned | 09-14 12:04
KL-1CB3577C26A7 | 0.0.0-chain-mu0s32yp-unsigned | 4 | assigned | 09-14 12:04
```

- **Release states:** `0.4.12-a` is `internal`. All three `0.0.0-chain-*` releases are `revoked` (09-14 12:04).
- **What the 0223 function returns:** `current_device_assignment_v1` gives **NULL for all 3 devices**.
- **Why:** 0223 picks the newest row first (sequence 4) and returns nothing if that row is not installable. It never falls back to sequence 1. That is the migration's documented intent (0223 lines 29–42).
- **The gate does this by design:** `release:chain:check` uses `KITLUY_DEV_TERMINAL_ASSET_TAG`, the hardware Terminal (U1 report §12).

### R3. Migration state (CONFIRMED)

```bash
docker exec supabase_db_kitluy-fresh psql -U postgres -At -c "select count(*), max(version) from supabase_migrations.schema_migrations;"
ls supabase/migrations/*.sql | wc -l
```

```text
122|20260911160000
122
```

### R4. The fixed Terminal image was not flashed, and every board already holds a generation-1 certificate (CONFIRMED)

```text
installations: KL-1CB3577C26A7 gen 1 superseded 09-14 11:18, gen 2 current since 09-14 11:18   (no gen 3)
               KL-C2B02C760E41 gen 1 current since 09-12 11:39
               KL-CFADA8C75001 gen 1 current since 09-12 10:40   (Store Hub)
credential heads (device_identity, development): all three current_generation = 1
               (KL-1CB3577C26A7 updated 09-14 11:24)
newest terminal image on disk: build/work/deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst, 09-14 12:27
               sha256 5080fe471aba…   (packaged overlay release-runtime.js already names the device by deviceId)
newest Store Hub image on disk: 09-11 09:57 (predates every Hub finding in U1 report §9b and §11)
```

### R5. Hardware availability (CONFIRMED)

```text
fleet last_seen: KL-CFADA8C75001 (Hub) 09-14 13:16, KL-1CB3577C26A7 13:15, KL-C2B02C760E41 11:16
TCP 172.16.13.204:7443 from workstation 172.16.21.17/19 (same subnet): "No route to host"  -> board off or disconnected
local services up: kitluy-fresh stack, fleet service :8787, management API :8790, release service :8791
```

### R6. Defects still present at HEAD (CONFIRMED by code inspection)

```text
runtime-bootstrap.ts:189-193          no trusted/deployed filter; no test seeds two hub_device rows
first-operational-issuance.ts:546-548 register_generation_key_v1(..., 'device_identity', 1, ...)   literal generation 1
```

### Not reproducible in this run

| Failure                                                         | Why not                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `503 HUB_NOT_OPERATIONAL`                                       | Needs the Hub board (offline); no local test covers it                       |
| `OPCERT_KEY_REGISTRATION_REFUSED` / `KLUY-KEY-GENERATION-TAKEN` | Needs a re-flash; observed on the Hub on hardware 2026-09-12 (U1 report §9b) |

### Test and verify baseline (CONFIRMED; not provisioning blockers)

**`pnpm verify`: 10 of 13 steps pass.**

| Failing step    | Cause                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Format check    | Prettier cannot read a root-owned image build folder, and 140 files from earlier commits are unformatted                              |
| Unit tests      | `@kitluy/device-identity` concurrency tests refuse because the local DB login still holds `kitluy_credential_issuer` (leftover state) |
| Docs link check | 4 broken links in a 2026-07-30 handoff                                                                                                |

**Package tests:**

- `kitluy-device-firstboot-agent`: 750 passed, 9 skipped. `device-registration-continuity.db.test.ts` is flaky, failing 1 of 4 runs with no code change.
- `kitluy-hub-agent`: 176 passed, **271 skipped** (hub database tests are not configured in this shell).
- `kitluy-device-shell`: 147 passed.

---

## 7. Root Cause

```text
CONFIDENCE: HIGH for the mechanism (code at HEAD and live database state confirmed).
            MEDIUM that the Terminal will hit the collision on its next re-flash
            (the same code path was observed failing on the Hub on 2026-09-12; not yet observed on the Terminal).
```

### Root cause

U1 can only deliver its remaining fixes by re-flashing boards, and the platform has no governed recovery for a re-flashed board that already holds an operational certificate.

- **Why a re-flash is the only route:** the bootstrap agent and the Hub agent live on an EROFS read-only rootfs, the Device Shell is the only updatable component, and A/B system OTA is U5 and not built.
- **Where the key is bound:** `first-operational-issuance.ts:546-548` always registers the `device_identity` key at **generation 1**. `register_generation_key_v1` permanently binds one key per generation (`KLUY-KEY-GENERATION-TAKEN`), and abandoning the generation is refused once a certificate exists (`KLUY-KEY-ABANDON-REFUSED`).
- **The recovery path that exists but is unused:** rotate-key renewal (`reserve_device_credential_renewal_v1` → `register_generation_key_v2`, migrations 0130–0132) is only called from `packages/device-identity` tests. No service routes a re-flashed device to it.

Each fix therefore sets off a chain:

1. Deploying the Defect-5 fix means re-flashing the Terminal. Deploying a `runtime-bootstrap.ts` fix means rebuilding and re-flashing the Hub.
2. A re-flash destroys the device's private key.
3. The device can no longer get an operational certificate.
4. It cannot be SERVING.

The only recovery used so far was an owner-ordered `TRUNCATE` of 82 `kitluy_devices` and `kitluy_releases` tables on `kitluy-fresh`. It also gave the Hub a new cloud identity (`549a41c6…`), and that left the stale local `hub_device` row which exposed the `runtime-bootstrap.ts` selection defect and produced `HUB_NOT_OPERATIONAL`.

### Evidence

- `first-operational-issuance.ts:546-548`: literal generation `1` (CONFIRMED at HEAD). The module's authority note says the path is deliberately "first issuance at generation 1" (U1 report §9b).
- A search of the renewal functions finds callers only in migrations 0130–0132, `supabase/tests/assertions.sql` and `packages/device-identity` tests. The registry service and firstboot agent never call them (CONFIRMED).
- The database has `device_identity` credential heads at generation 1 for **all three** boards (CONFIRMED).
- On hardware 2026-09-12, the Hub's re-flash produced `OPCERT_KEY_REGISTRATION_REFUSED` / `KLUY-KEY-GENERATION-TAKEN` every 30 s (REPORTED):
  - a `KITLUY_ASSIGNMENT_GENERATION=2` override made no difference;
  - `abandon_generation_key_v1` was refused;
  - a direct delete was refused with `KLUY-CRED-HEAD-IMMUTABLE`.
- The truncate workaround ran and re-enrolled the boards as new devices. The Hub got a new cloud identity while its local `edge_identity.hub_device` kept the old one, and the old row cannot be deleted because `pairing_receipt` is append-only (REPORTED, U1 report §9b and §11).
- `runtime-bootstrap.ts:189-193` selects the oldest `hub_device` row unfiltered, while `0042` filters to trusted+deployed. No test seeds two rows (CONFIRMED).
- The Defect-5 fix exists only in source and in an unflashed image (CONFIRMED: no installation generation after 11:18; image built 12:27).

### Immediate failures, ranked

1. **Store Hub `503 HUB_NOT_OPERATIONAL`.** It blocks the SERVING clause of every acceptance test. The fix is unfixed code, and the U1 report classes it as out of U1 scope or needing authority.
2. **Defect 5 on the flashed Terminal image.** Fixed in code, not deployed.
3. **The Terminal's real assignment is hidden** by revoked chain-check assignments (sequences 2–4).
4. **Boards offline** at diagnosis time.

### Why this blocks subsequent provisioning

U1 acceptance as written requires install, rollback, power-cut and tamper tests **plus** a SERVING Terminal, and getting there needs all of the following:

1. The Terminal on the fixed image, which means a re-flash.
2. An operational certificate after that re-flash. Today that means either another database truncate or a governed renewal route that does not exist.
3. A Hub that serves eligibility, which means a Hub code fix plus a Hub image rebuild and re-flash (with the same certificate problem), or an owner-authorised destructive re-provision of the Hub's local database.
4. A fresh release assignment, because sequence 4 currently hides sequence 1.

Items 2 and 3 cannot be completed by engineering alone without an owner decision.

---

## 8. Secondary Problems

```text
Severity: HIGH
Issue:    Terminal's real assignment (0.4.12-a, seq 1) is hidden by revoked synthetic assignments seq 2-4 from release:chain:check (12:04).
          The chain check targets the hardware Terminal's tag, so running that gate during acceptance destroys the acceptance precondition.
Evidence: §6 R2; migration 0223 rule; current_device_assignment_v1 = NULL for all devices.
Blocks current goal: YES. Even a correctly flashed Terminal would report NOTHING_TO_DO until a new assignment (seq 5) exists.

Severity: HIGH (today)
Issue:    Store Hub and Terminal are offline or unreachable from the workstation.
Evidence: §6 R5 ("No route to host" on same /19 subnet; last_seen 13:15-13:16).
Blocks current goal: YES, for any hardware step.

Severity: MEDIUM
Issue:    No fallback SD card. The Terminal's card was re-flashed in place. Owner preference was to flash a separate card.
Evidence: U1 report §6.1 (both installation generations report the same storage serial).
Blocks current goal: NO, but raises the cost of every re-flash.

Severity: MEDIUM
Issue:    Unrecorded owner decisions, and conflicts with recorded ones.
          - OD-U1-1/2/3 appear only in the U1 plan. The decision register's last entry is 2026-09-04.
          - OD-U1-2 (updatable Device Shell) and U1's exclusion of A/B conflict with
            KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001 §2-§4.2 ("bootstrap-agent changes ride an image rebuild",
            apps "through the governed A/B release path").
          - The 2026-09-12 truncate (new device records, new Hub cloud identity) conflicts with the permanent
            device_record_id rule (KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001), governed Hub-identity cutover,
            and "Do not add an unsafe reset/backdoor" (decision register:3792-3793). It is recorded only in the U1 report.
          - Device naming changed from asset tag to deviceId; release-service.mjs:36-40 says mTLS was "owner ruled out".
            Neither is recorded in docs/decisions/.
          - Open reconciliations: KLREC-2026-08-19-DEVICE-IDENTITY-PER-SLOT-001, KLREC-2026-08-20-REFLASH-FORGETS-PAIRING-001.
          - Pilot/production re-flash recovery is explicitly "Not decided here" (decision register:3843-3846).
Evidence: documentation audit of decision register, docs/decisions/, U1 plan.
Blocks current goal: YES for the Hub fix and re-flash recovery (need authority); NO for Defect 5.

Severity: MEDIUM
Issue:    Terminal projection, Hub self-record and development configuration are manual, untested development stand-ins
          for the missing BLK-006 cloud producer (hub-provision-terminal, hub-terminal-projection.mjs, dev-configuration.ts).
          Every Hub re-provision needs them repeated by hand.
          Also: the discovery record signature is always "unverified", and terminal activation always reports UNREACHABLE.
Evidence: hub-provision-terminal:10-29; edge-discovery-record.ts:26,97; edge/routes.ts:144,200; runtime-bootstrap.ts:596.
Blocks current goal: NO directly (dev stand-ins work), but they are part of every recovery.

Severity: MEDIUM
Issue:    Documentation drift (not edited in this run):
          - 00_AI_HANDOFF/000_INDEX.md:10 says "PROVEN ON HARDWARE, END TO END · SERVING · every bootstrap route 200 · not committed".
            The 09-14 evidence shows DEGRADED/503, and the work was committed at 74722be.
            The "not committed" claim repeats at INDEX:17,24 and in handoffs 36-38.
          - The INDEX has no U1 entry (newest 2026-09-11).
          - U1-PHASE-4-IMAGE-VERIFIED.md:6-7 says "IMAGE VERIFIED", yet that image carried Defects 1-4.
          - U1-HARDWARE-ACCEPTANCE-RUNBOOK.md:6 says "NOT EXECUTED" (now partly run); :104,142 still address devices by asset tag.
          - U1-IMPLEMENTATION-PLAN.md:78 says the assignment source runs over mTLS, but the built service is plain HTTP.
          - 000_CURRENT_STATE.md (refreshed 2026-08-01) cites cloud migrations at 0187 (actual 0223),
            and :56 vs :31 contradict each other on WS-11.
          - The evidence register has no rows for U1, 0221-0223, 515202b, f6fe6c8, or handoffs 33-38.
            Row 201 still says terminal-facing routes were not exercised.
          - PROJECT_HOME.md:219-229 lists the /edge/v1 fork as a blocker; BLOCKERS says it was resolved 2026-07-27.
          - The U1 report's own title says "Four defects, all corrected", but §11-§12 add Defect 5 and the Hub defect,
            and §12 presents the deviceId fix as future work although HEAD already has it.
          - BLK-006 is defined two ways in 000_BLOCKERS.md (row :41 vs note :24).
Evidence: documentation audit with file:line references above.
Blocks current goal: NO, but a reviewer reading only the state docs would pursue the wrong milestone.

Severity: LOW
Issue:    Store Hub release agent (hub/release-agent.ts) uses fake adapters and is not wired into bin/hub-agent.ts.
Evidence: hub/release-agent.ts:18-23.
Blocks current goal: NO (Hub updates are U4).

Severity: LOW
Issue:    Stale comments after the deviceId change: http-release-source.ts:47 and release-service.mjs:11 still say "asset tag".
          release-publish.mjs only accepts --target <asset-tag>.
Evidence: code inspection.
Blocks current goal: NO.

Severity: LOW
Issue:    A third terminal, KL-C2B02C760E41 (pi5-jkided), registered 09-12 11:39, active, last seen 09-14 11:16.
          It is not mentioned in the U1 report. Its role is UNKNOWN.
Evidence: kitluy_devices.devices and device_fleet_status.
Blocks current goal: UNKNOWN.

Severity: LOW
Issue:    Verify and CI baseline failures unrelated to provisioning (format / DB role leftover / docs links, see §6).
          GitHub CI on the provisioning remote fails format:check. gitleaks reports 2 false positives
          (terminalProfileKey in POS desktop tests).
Evidence: pnpm verify summary; GitHub Actions runs.
Blocks current goal: NO.
```

---

## 9. Provisioning Dependency Chain

```text
Image build (build-rpi-image.sh)                                     OK
↓
First boot: identity key, SSH host keys, network                     OK (on hardware)
↓
Cloud registration / sighting (device-registration edge fn, 0197/0216)
   + re-flash recovery keeps the same device record (515202b)        OK (gen 2 install, 09-14 11:18)
↓
HET approval (approve_device_enrollment_v1)                          OK
↓
Pairing (Hub: hub-pairing-composition; Terminal: 0213/0218-0220)     OK
↓
Operational certificate (first-operational-issuance.ts,
   register_generation_key_v1 at literal generation 1)               OK only on first issuance
   └─ [STRUCTURAL GAP] a re-flashed board holding a gen-1 cert -> KLUY-KEY-GENERATION-TAKEN
      (all 3 boards now hold one; recovery = truncate the device DB)
↓
Store Hub mTLS :7443 + mDNS (hub-agent, manual --hub-self record)     OK (09-14)
↓
Terminal record on Hub (manual hub-terminal-projection, BLK-006)      OK (manual stand-in)
↓
Terminal discovers Hub + LAN pairing (edge-session.ts, 0042)         OK (paired 09-14)
↓
[CURRENT FAILURE 5b] Hub eligibility + configuration
   (runtime-bootstrap.ts:189 picks the oldest, revoked hub_device row) -> 503 HUB_NOT_OPERATIONAL
↓
SERVING (edge-status.json)                                            cannot be reached
↓
"terminal still SERVING" clause of Tests A-D                          cannot be met

In parallel, the release path (does not need the Hub):
Release publish -> sign -> promote -> assign -> assignment-sign (0221/0222)   OK
↓
[STATE PROBLEM] newest assignment seq 4 is revoked -> 0223 returns NULL        hides the real release
↓
[CURRENT FAILURE 5a] update agent on flashed image asks with the derived tag -> 404 -> NOTHING_TO_DO
   (fixed at HEAD; image built 12:27; NOT flashed)
↓
Install -> health gate -> rollback / power-cut / tamper (Tests A-D)      cannot run
↓
HARDWARE VERIFIED for U1                                                 cannot be claimed
```

---

## 10. Code vs Environment vs Decision Matrix

```text
CODE STATUS:              incomplete. One unfixed defect (runtime-bootstrap.ts) and one design gap
                          (no re-flash route to renewal); the Defect-5 fix is present but not deployed.
LOCAL ENVIRONMENT:        healthy for provisioning (stack, fleet, release service up; migrations 122/122);
                          incomplete for pnpm verify (root-owned build dir, leftover DB role grant).
DATABASE/MIGRATION STATE: migrations healthy; release assignment data divergent (seq 2-4 revoked, hiding seq 1);
                          hosted dev project UNKNOWN.
EXTERNAL DEPENDENCY:      not required for the local hardware stack; BLK-006 cloud producer unavailable
                          (development stand-ins in use).
HARDWARE DEPENDENCY:      required; unavailable at diagnosis time (both boards offline). No fallback SD card.
OWNER DECISION REQUIRED:  yes.
```

| Area                | Status                                                                                                        | Evidence                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code                | Incomplete                                                                                                    | `runtime-bootstrap.ts:189-193` unfixed; `first-operational-issuance.ts:546-548` gen 1 with no renewal routing; Defect-5 fix at `release-runtime.ts:225-228`                                         |
| Tests               | Mostly passing; gaps                                                                                          | firstboot 750 pass (1 flaky), hub-agent 176 pass / 271 skipped, device-shell 147 pass; no two-`hub_device` test; no re-flash-with-issued-cert test; release chain only checked by live-stack script |
| Git state           | Healthy                                                                                                       | Clean tree; local = provisioning remote at `0687d8c`; five days of work landed as one snapshot `74722be`                                                                                            |
| Supabase/migrations | Healthy (local) / UNKNOWN (hosted)                                                                            | `kitluy-fresh` 122/122 through 0223                                                                                                                                                                 |
| Raspberry Pi/OS     | Image Defects 1–4 fixed on hardware; fixed Terminal image not flashed; newest Hub image predates Hub findings | Installation generations; image timestamps                                                                                                                                                          |
| NetworkManager      | N/A (not implicated)                                                                                          | Network stage worked on hardware                                                                                                                                                                    |
| SSH/host keys       | N/A (not implicated)                                                                                          | `kitluy-ssh-hostkeys.service` + `Requires=etc-ssh.mount` fix present at HEAD                                                                                                                        |
| Device identity     | **Blocked on re-flash**                                                                                       | Gen-1 hardcode; all 3 boards hold gen-1 heads; `KLUY-KEY-GENERATION-TAKEN` observed 09-12                                                                                                           |
| Pairing             | Working                                                                                                       | LAN pairing succeeded 09-14 (manual BLK-006 stand-ins)                                                                                                                                              |
| Release assignment  | Chain works; current data hides the real release; device naming fixed in code only                            | §6 R1, R2                                                                                                                                                                                           |
| Documentation       | Drifted; CONFLICT                                                                                             | State docs still on WS-12; U1 absent; INDEX claims SERVING; decisions unrecorded                                                                                                                    |
| External dependency | BLK-006 producer missing (dev stand-ins)                                                                      | `hub-provision-terminal`, `dev-configuration.ts`                                                                                                                                                    |
| Owner decision      | **Required**                                                                                                  | Hub-fix scope, re-flash credential recovery, recording of truncate and U1 rulings                                                                                                                   |

---

## 11. Files Most Relevant to the Blocker

| Path                                                                                                                    | Why it matters                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/reports/2026-09-12__U1-HARDWARE-ACCEPTANCE-STOPPED-DEFECTS-AND-CORRECTIONS.md`                                    | Primary evidence: Defects 1–5, the §9b re-flash certificate gap, the §11 `HUB_NOT_OPERATIONAL` finding, and what was tried |
| `services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts` (:189-193, :202)                                          | Unfiltered Hub self-identity selection behind `HUB_NOT_OPERATIONAL`                                                        |
| `hub/migrations/0042_terminal_pairing_signing_credential.sql` (:119-122)                                                | Correct trusted+deployed filter that `runtime-bootstrap.ts` disagrees with                                                 |
| `services/kitluy-device-registry-service/src/first-operational-issuance.ts` (:546-548)                                  | Literal generation 1: re-flash certificate collision                                                                       |
| `supabase/migrations/*0205*`, `*0208*` (`register_generation_key_v1`), `*0130*`–`*0132*` (renewal)                      | One key per generation; the unused rotate-key renewal path                                                                 |
| `packages/device-identity` (rotate-key renewal composition)                                                             | The renewal logic that exists but is only used by tests                                                                    |
| `services/kitluy-device-firstboot-agent/src/release-runtime.ts` (:183, :225-228)                                        | Device naming (Defect 5), fixed at HEAD                                                                                    |
| `services/kitluy-device-firstboot-agent/src/adapters/http-release-source.ts` (:256, stale :47)                          | Sends `?device=`                                                                                                           |
| `scripts/development/release-service.mjs` (:117-157)                                                                    | Accepts UUID or asset tag; returns 404 for unknown tags                                                                    |
| `supabase/migrations/20260911160000_0223_newest_assignment_or_nothing.sql`                                              | "Newest or nothing" rule that makes revoked chain-check assignments hide the real release                                  |
| `scripts/development/release-chain.test.mjs`, `release-publish.mjs`                                                     | Chain check assigns to the hardware Terminal's tag; publisher targets by asset tag only                                    |
| `infra/kitluy-store-hub-image/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-provision-terminal` | Manual BLK-006 stand-in: Hub self-record and terminal projection                                                           |
| `services/kitluy-hub-agent/src/hub/dev-configuration.ts`                                                                | Development configuration signer (BLK-006 stand-in)                                                                        |
| `docs/reports/2026-09-11__U1-IMPLEMENTATION-PLAN.md` (:11-17, :269, :281, :291-306)                                     | U1 scope fence, tests requiring SERVING, OD-U1 rulings                                                                     |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`                                                  | Identity decisions the truncate and re-flash recovery conflict with; latest entry 2026-09-04                               |
| `00_AI_HANDOFF/000_INDEX.md`, `000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`, `000_BLOCKERS.md`                          | Drifted state documents                                                                                                    |

---

## 12. Recent Commits Relevant to the Blocker

| Commit    | Date       | What                                                                                                                                                                                         |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b80206d` | 2026-08-22 | A board registers itself and waits for a human to approve it                                                                                                                                 |
| `4c5e8a7` | 2026-08-22 | A paired Store Hub can be told what time it is (trusted time)                                                                                                                                |
| `0a30a74` | 2026-08-24 | A Store Hub reaches ACTIVE; the issuer is not the activator                                                                                                                                  |
| `68e0249` | 2026-09-07 | Snapshot of in-flight device, image and portal work (includes the Hub overlay with dangling `.wants` links)                                                                                  |
| `8f16cc3` | 2026-09-07 | A Pi Terminal can be told which seat it is                                                                                                                                                   |
| `65108c0` | 2026-09-07 | Pi Terminal screen that takes a pairing code                                                                                                                                                 |
| `5e4a6f2` | 2026-09-09 | A re-flash no longer orphans the Store Hub's encrypted data volume                                                                                                                           |
| `515202b` | 2026-09-09 | A re-flashed device can be recovered (registration and pairing), not just refused. It does not cover operational credentials                                                                 |
| `f6fe6c8` | 2026-09-09 | A Pi Terminal can obtain its operational certificate. From here the Terminal also enters the gen-1 issuance path, and the builder help became stale (caused Defect 3)                        |
| `74722be` | 2026-09-14 | One snapshot of five days of uncommitted work: Store Hub serves terminals (handoffs 36–38), U1 phases, migrations 0221–0223, fixes for Defects 1–5 including the deviceId naming, U1 reports |
| `0687d8c` | 2026-09-14 | Formatting, lint and secret-scan marker clean-up only; no behaviour change                                                                                                                   |

---

## 13. What Has Already Been Tried

From the U1 report and handoffs unless marked CONFIRMED.

### Re-flash certificate collision (Hub, 2026-09-12)

| Attempt                                                                                                                              | Result                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `KITLUY_ASSIGNMENT_GENERATION=2` as a runtime-only drop-in under `/run`                                                              | No change; removed afterwards                           |
| Owner-authorised `abandon_generation_key_v1`                                                                                         | Refused: `KLUY-KEY-ABANDON-REFUSED`                     |
| Deleting the blocking rows directly (in a rolled-back transaction)                                                                   | Refused: `KLUY-CRED-HEAD-IMMUTABLE`                     |
| `pnpm db:reset`                                                                                                                      | Rejected; it targets a different stack (`kitluy-local`) |
| Owner-ordered `TRUNCATE ... RESTART IDENTITY CASCADE` of 82 device and release tables on `kitluy-fresh`, after a `pg_dumpall` backup | Worked, see below                                       |

After the truncate:

- Policies, channels and trust anchors were restored.
- Fixtures were recreated with `--ensure-fixtures`.
- Both boards re-enrolled as new devices and the Hub served terminals.
- The underlying gen-1 defect was left untouched.

### `HUB_NOT_OPERATIONAL` (2026-09-14)

Steps worked through:

1. Terminal projection delivered, which cleared `TERMINAL_NOT_RECOGNIZED`.
2. Development configuration published with 4 grants (snapshot v2), which cleared `PAIR_PROFILE_FORBIDDEN`.
3. Hub self-identity re-projected, which cleared `PAIR_CERT_INVALID`.
4. The old `hub_device` row was marked revoked; deletion is impossible because `pairing_receipt` is append-only.

Result: pairing succeeded, but eligibility and configuration still return 503.

Considered and not done:

- **Back-dating the new row's `created_at`:** refused, because it falsifies an audit timestamp.
- **Re-provisioning the Hub's local database:** needs owner authority.
- **Changing the `runtime-bootstrap.ts` query:** Hub code plus a Hub image rebuild, outside U1 scope.

### Defect 5 (2026-09-14)

- **Diagnosed** by comparing the device-derived tag `KL-6F4E86A71516` with the cloud tag `KL-1CB3577C26A7`.
- **Fixed in source:** the device now uses `deviceId`, and the service accepts a UUID (CONFIRMED at HEAD).
- **Image rebuilt** at 12:27 (CONFIRMED on disk).
- **Not flashed** (CONFIRMED: no new installation generation).
- **`release:chain:check` was run at 12:04** (CONFIRMED in the database: synthetic releases assigned and revoked on the hardware Terminal). This is what now hides `0.4.12-a`.

### Defects 1–4

Fixed in source, mutation-tested (each gate shown to fail when its defect is reintroduced), rebuilt, flashed, and confirmed on hardware 2026-09-14.

---

## 14. Recommended Next Action

Do not implement. The smallest action that unblocks progress:

```text
CLASSIFICATION: OWNER DECISION
```

Engineering can deploy the Defect-5 fix on its own, but U1 acceptance as written cannot pass without these decisions:

1. **Store Hub fix scope.** Is correcting `runtime-bootstrap.ts` authorised inside U1, with a Hub image rebuild? The change would make it select the Hub identity the same way `0042` does (trusted + deployed) and add a test with a revoked and a trusted `hub_device` row. **Or** should the "terminal still SERVING" clause be removed from or deferred in Tests A–D, so U1 proves install/rollback/power-cut/tamper only?
2. **Re-flash credential recovery.** Which is it:
   - **(a)** authorise a governed change so a re-flashed board with an existing gen-1 credential is routed to the rotate-key renewal path (`reserve_device_credential_renewal_v1` → `register_generation_key_v2`); or
   - **(b)** authorise a named, recorded, development-only device-state reset procedure for `kitluy-fresh`, used before each re-flash during U1, and record it in the decision register, because today's truncate conflicts with recorded identity decisions?
3. **Record the decisions already taken.** That covers OD-U1-1/2/3, device naming by `deviceId` to the release source, the plain-HTTP (no mTLS) release source, and the 2026-09-12 truncate.

Once those are decided, this confirming step needs no code change (**HARDWARE VERIFICATION**):

1. Power the boards on.
2. Flash the existing 12:27 Terminal image (`5080fe471aba…`) to a **spare** card, which preserves the current card.
3. Issue a fresh assignment (sequence 5) for `0.4.12-a` to device `7a6f1e26-…`.
4. Observe the result:

| Observation                                                     | Meaning                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Agent requests with the device id and starts the install        | Confirms Defect 5 is fixed                                |
| `OPCERT_KEY_REGISTRATION_REFUSED` / `KLUY-KEY-GENERATION-TAKEN` | Confirms the predicted re-flash collision on the Terminal |
| Terminal stays DEGRADED                                         | Confirms the Hub defect is independent of the Terminal    |

Do not run `release:chain:check` against the hardware Terminal's tag during acceptance.

---

## 15. Exact Question for ChatGPT

> **ChatGPT, based on this repository evidence, what should we do next to unblock KitLuy provisioning?**
