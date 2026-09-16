# BOOT-RECOVERY-CLASSIFICATION-001 — one answer per boot: what happened, and the one next step

**Date:** 2026-09-16
**Status:** **IMPLEMENTED · TESTED · INTEGRATED (local hardware stack `kitluy-fresh`, live route probed with the real boards' records) · PORTAL: source and tests only, NOT browser-verified · IMAGE: sources integrated and packaged, NOT rebuilt · HARDWARE VERIFICATION PENDING · END-TO-END NOT VERIFIED.**
The REFLASH-HARDENING-001 hardware gate (handoff 43 §8) is **also still pending**: both boards were powered off throughout this session.

| Fact             | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Starting commit  | `22bfd5ce97cd6a039c4607ed641b9c085e47350e` (verified as HEAD before editing)                               |
| Ending commit    | see §14                                                                                                    |
| Migration        | **0227** `supabase/migrations/20260916100000_0227_device_boot_evidence.sql`                                |
| New package      | `packages/device-boot-classification` (`@kitluy/device-boot-classification`, plus `/evidence-row` subpath) |
| Previous records | handoff 43 (REFLASH-HARDENING-001, hardware pending), 42 (hardware run), 41 (topology, D1)                 |

Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 (2026-09-16). It re-decides
nothing already locked: `KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001`,
`KLD-2026-08-06-WS11-T006-001` (no Hub identity cloning; four-eyes replacement),
`KLV4-DEC-007` (Store staff do not service Hub storage) and the register's
"storage evidence never resolves identity".

---

## 1. The result in one paragraph

Every boot now ends in **one classification, one reason code and one next
action**: `READY`, `RECOVERING_DEVICE`, `NEW_DEVICE`, `WRONG_MEDIA`,
`REPLACE_HARDWARE`, `SECURITY_LOCK`, or `WAITING` (never a security failure). The decision is a
**single pure function** in `@kitluy/device-boot-classification`. The cloud computes
it when the board can reach it (only the cloud can say which device a board
serial is). The board computes it with **the same code** when it cannot, and
offline it never calls anything "new hardware" or "new device". The same
contract drives the Store Hub console, the registry route, and the Admin
device view, so a screen, a portal and a support log cannot give three different
answers about one card.

## 2. Architecture

```
            hardware signals + card claims
 board ─────────────────────────────────────▶ POST /v1/device-boot/classification (registry service)
   │                                              │  as kitluy_device_boot_service
   │                                              ▼
   │                                   describe_device_boot_evidence_v1(signals)   ◀─┐ both call
   │                                              │                                   │ device_boot_facts_v1
   │                                              ▼                                   │ (ONE assembly)
   │                                   classifyBoot(evidence)  ◀── the contract       │
   │                                              │                                   │
   │ ◀──── shop-safe decision only (no ids) ──────┘                                   │
   │                                                                                  │
   │  offline: classifyBoot({ boardResolution: "unresolved", … }) — byte-identical copy of the contract
   ▼
 /var/lib/kitluy/boot-classification.json ──▶ Store Hub console (first line on tty1)

 Admin Portal ─▶ GET /management/v1/devices/:id ─▶ authorize human (fleet.read)
                                                  └▶ as kitluy_device_boot_service:
                                                     describe_device_recovery_facts_v1(device_id) ──┘
                                                     └▶ classifyBoot(… freshly flashed card …) ─▶ `recovery` block
```

- **The card is a claim, the hardware is authoritative.** The device is whatever the
  board's signals resolve to (`resolve_device_by_board_evidence_v1`, called, not
  copied). Nothing looks a device up by a card-supplied id.
- **One classifier, shipped twice.** Boards carry no `node_modules`, so
  `services/kitluy-device-firstboot-agent/src/boot-classification-contract.ts` is
  the package source **byte for byte**; `test/boot-classification-contract-drift.test.ts`
  compares the two files and fails on a single byte.
- **One facts assembly, two doors.** The board's door (by hardware) and the Admin's
  door (by device id) both call `device_boot_facts_v1`; a DB test proves they return
  identical JSON for the same device, and so did the three real boards (§10).
- **The route grants nothing.** Read-only, pre-credential like `/v1/hub-pairing`, rate
  limited per transport peer, and it returns only the shop-safe decision fields —
  never a device, Store or Location id, a generation, or the admin detail (which
  goes to the service log). What it could reveal is bounded by what
  `/functions/v1/device-registration` already returns for the same signals.

## 3. The contract (`packages/device-boot-classification/src/index.ts`)

**Decision order is the contract** (each step returns):

1. Security: locked lifecycles, open incidents (the repo's single predicate), evidence conflict, registration refused / trust review, MAC-only review.
2. Card built for another device class or environment.
3. Whose card: another device's → `WRONG_MEDIA`; card names a device and the cloud says the board is **unknown** → `REPLACE_HARDWARE`.
4. No cloud record: storage locks first; then **offline/unresolved waits** (see below); else `NEW_DEVICE`.
5. Seat taken by another board → `REPLACE_HARDWARE`.
6. Card names another Store → `WRONG_MEDIA`.
7. Hub storage locks (`foreign`, `opened_foreign_contents`, `unidentified`, `not_opened`) → `CONTACT_HET_SUPPORT`.
8. Card outdated: generation below the head **unless it is the previous generation inside an open overlap window**; or the card's enrollment / **identity key** is no longer the device's current one.
9. Transients: no network / cloud unreachable → `WAITING` (still serving when the installation is current).
10. `READY`.
11. Recovery and first-setup branches.

**Rules added during implementation, each from a real finding:**

| Rule                                                                                                                                                                                             | Why                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servesLocally` on every decision; connectivity judged before READY                                                                                                                              | S02 and task §4: an outage keeps the shop trading, it is not a recovery                                                                                        |
| `boardResolution: "unresolved"` (board-only) → always `WAITING`, never `REPLACE_HARDWARE`/`NEW_DEVICE`                                                                                           | Offline, a board cannot resolve itself; reporting `unknown` would have told a shop with a good card to replace its hardware                                    |
| Offline trading requires `confirmedReadyOnThisBoard`: the cloud's last answer was READY, recorded with **this board's serial** and a digest of **these card claims**, and a Hub's volume is open | A cloned card in another Pi reads another serial and does not trade; a later cloud lock supersedes the confirmation                                            |
| `honouredPreviousGeneration`                                                                                                                                                                     | `kitluy-fresh` had two heads at generation 2 still honouring 1 until 2026-09-18; a naive `< head` would have locked working shops for two days                 |
| `identityKeyFingerprint` (card) vs `currentIdentityKeyFingerprint` (cloud)                                                                                                                       | A real card never records its enrollment id; without this, the **old card put back after a re-flash but before recovery** read READY                           |
| `CloudDeviceClass` includes `manufacturing_station`, `peripheral`                                                                                                                                | A Store image on a factory station must classify, not fail to type                                                                                             |
| Storage `not_opened`                                                                                                                                                                             | `hub-storage-provision` records no outcome, so a board cannot tell "another Hub's drive" from "key posture lost on re-flash" (GAP-BOOT-006); it claims neither |

Shop copy is `DEFAULT_USER_MESSAGES` (English fallback, identifier-free, asserted by
tests); reason codes `KLUY-BOOT-*` are for logs, Admin and support only.

## 4. Scenario matrix S01–S43 (`packages/device-boot-classification/test/scenario-matrix.test.ts`)

**69 passed · 2 skipped (71).** Every owner scenario is present by number.

| Group                                                 | Scenarios                                                                       | State                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Normal                                                | S01, S02 (+S02b)                                                                | executable                                                                                    |
| Offline, board-local                                  | S02c–S02i                                                                       | executable (added: good card never "replace", clone does not trade, foreign/unopened storage) |
| Same device, new SD                                   | S03 (+S03b, S03c), S04, S05                                                     | executable                                                                                    |
| Old SD                                                | S06, S07 (+S06b), S11b–S11d (identity key)                                      | executable                                                                                    |
| Wrong device / class / Store                          | S08–S13 (+S10b, S13b), S06c                                                     | executable                                                                                    |
| Hardware replacement / seat                           | S14, S15, S16                                                                   | executable                                                                                    |
| Cloning                                               | S17 (+S17b), S18, S19                                                           | executable                                                                                    |
| Quarantine / retirement / tamper                      | S20–S23 (+S22b, S23b)                                                           | executable                                                                                    |
| Assignment generation                                 | S24–S28 (S25–S27 parameterised)                                                 | executable; durable half proven by group 0226's suite                                         |
| Credential overlap                                    | S27b–S27d                                                                       | executable (added)                                                                            |
| Power / retry                                         | S29–S32                                                                         | executable                                                                                    |
| Class and environment                                 | S33–S35                                                                         | executable                                                                                    |
| Hub storage                                           | S36–S40 (+S38c)                                                                 | executable; S38's evidence is not produced yet (GAP-BOOT-002)                                 |
| Terminal seat/profile                                 | S41                                                                             | executable                                                                                    |
| **S42** cloud desired seat/profile beats a stale card | **skipped** — GAP-BOOT-003, blocked by owner decision TOPOLOGY-001 (handoff 41) |
| **S43** deliberate role change is not a recovery      | **skipped** — GAP-BOOT-004, no governed role-change door exists                 |

Plus contract invariants: one next action and a shop-safe message on every branch;
`SECURITY_LOCK` never retries and `WAITING` always does; no shop message contains a
technical code in any branch.

## 5. Database — migration 0227

Additive; one transaction; asserts its own boundary on apply.

| Object                                           | Owner                      | EXECUTE                   | Purpose                                                                                                                        |
| ------------------------------------------------ | -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| role `kitluy_device_boot_service`                | —                          | granted to `service_role` | NOLOGIN; member of nothing; **exactly two** capabilities; no table privilege                                                   |
| `device_boot_credential_head_v1(device, env)`    | `kitluy_credential_issuer` | `postgres`                | head generation, and the previous one only while the overlap is open                                                           |
| `device_boot_facts_v1(device, env)`              | `postgres`                 | `postgres` (internal)     | the single facts assembly: lifecycle, incidents, enrollment + identity fingerprint, assignment, active certificate, head, seat |
| `describe_device_boot_evidence_v1(signals, env)` | `postgres`                 | boot service              | board's door: resolver, **retired/replaced board recognised**, evidence collision, facts                                       |
| `describe_device_recovery_facts_v1(device, env)` | `postgres`                 | boot service              | Admin's door: collision + facts by id                                                                                          |

All four are `STABLE SECURITY DEFINER` with a pinned search path, so Postgres
itself refuses a write inside them. No table ACL changed. A borrowed membership is
handed back; verified afterwards on both stacks (§10).

## 6. Registry service — `POST /v1/device-boot/classification`

- `src/device-boot-classification.ts` (composition) and `src/device-boot-routes.ts`
  (route); wired in `http.ts` (fail closed 503 when unconfigured) and `main.ts`
  (raw body owned by the route so the limiter sees malformed attempts; listed in
  the startup `governedRoutes`).
- `REGISTRY_ROLES.deviceBoot` added to `database.ts`.
- Body: `signals` (DB signal vocabulary, 1–16), `media` claims (every field
  shape-checked; unknown fields refused), optional `registration`, `storage`.
- Row mapping moved to `@kitluy/device-boot-classification/evidence-row` (shared with
  the Management API; never shipped to boards).

## 7. Board runtime and images

- `src/boot-classification.ts`: reads **only claims the card can back** (adoption via
  `currentPhase` — a manifest without its certificate **or private key** is not
  adopted; only a pairing-_stated_ generation; Terminal references only when they are
  ids; identity key fingerprint from `registration-state.json`), board signals only
  (storage signals never identify a board), Hub storage as far as a board can see
  it (`opened` / `absent` / `not_opened`), calls the route, falls back to the
  contract offline, and keeps `lastCloudAnswer` bound to board serial + claims digest.
- `src/bin/boot-classification.ts`: polls every 60 s (like `cloud-registration`),
  logs only on change, exits 2 only if the image does not state its class.
- **Store Hub console** (`bin/hub-pairing-ui.ts`): the shop sentence is the first line
  under the title; never the reason code (test).
- **Both images:** `kitluy-boot-classification.service` (+ wants link, hardened, root
  with an empty capability set, writes only `/var/lib/kitluy`), shim
  `/usr/lib/kitluy/boot-classification`, `runtime-manifest.json` component, module list
  in both `package-bootstrap-runtime.sh`; both overlays **re-packaged** (closure and
  load checks passed). Images **not rebuilt**.
- **Not done:** the Pi Terminal **Device Shell** does not render the classification yet
  (GAP-BOOT-005). The Terminal writes the file; nothing shows it.

## 8. Management API and Admin Portal

- `services/kitluy-management-api/src/device-recovery.ts`: after `fleet.read`
  authorization, reads as `kitluy_device_boot_service` in a transaction and classifies
  with a **freshly flashed card** — "what would this device need if its card were
  replaced now". `GET /management/v1/devices/:id` returns it as `recovery`
  (`null` when unconfigured; the device still answers). OpenAPI `DeviceRecovery` added.
- `nextActionGap` states when this API cannot perform the next action:
  `RELEASE_ROUTE_NOT_AVAILABLE`, `REPLACE_ROUTE_NOT_AVAILABLE`.
- **Admin Portal** device page: a recovery card with the translated one-line next step,
  the raw classification/next action/reason code (operators quote them), the gap note,
  and the admin detail. No button. Khmer strings were written by the agent —
  **native review required** (GAP-BOOT-010).
- **Not done:** the Partner Portal shows nothing yet (GAP-BOOT-009).

## 9. Tests

| Suite                                                                                  | Result                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract scenario matrix                                                               | **69 passed, 2 skipped** (S42, S43)                                                                                                                                                                                                                                                                                                          |
| Registry `device-boot-routes.test.ts`                                                  | **31/31** (only seven fields returned; no ids; limiter before parse; unknown fields refused; strict row mapping)                                                                                                                                                                                                                             |
| Registry `device-boot-evidence.integration.test.ts` (real DB, governed doors, dev PKI) | **15/15** — READY, fresh card, other device, other Store, unknown board, MAC-only, **re-flash → old card outdated by identity key → release → enter pairing code**, quarantine, **retired board recognised**, twin evidence (confirmed the real twin path ran), writes nothing in any device table, STABLE, both doors identical, privileges |
| Registry full suite (final code)                                                       | 431 passed, **10 failed / 23 failed files — the same files as the handoff 39 §7 baseline** (trusted-time fixtures, platform role memberships, the 0202 grant, the e2e double activation, terminal-pairing seat fixtures); none touches this work                                                                                             |
| Firstboot boot classification + drift + console + entrypoint guard                     | **68/68**                                                                                                                                                                                                                                                                                                                                    |
| Firstboot full suite (final code)                                                      | **805 passed**, 1 failed — pre-existing `hub-provisioning-e2e.db` (handoffs 39, 43)                                                                                                                                                                                                                                                          |
| Management API full suite (final code)                                                 | **176/176**, incl. `device-recovery.test.ts` and `device-recovery.db.test.ts` (3/3 over the real devices in `kitluy-repo17`)                                                                                                                                                                                                                 |
| Admin Portal                                                                           | **110/110**                                                                                                                                                                                                                                                                                                                                  |
| Image `systemd-runtime`                                                                | Store Hub **179/0**, Pi Terminal **235/0**                                                                                                                                                                                                                                                                                                   |
| Image `build-gates`, `environment-gating`, `rpi-image-gen`                             | pass, both trees                                                                                                                                                                                                                                                                                                                             |
| Image `image-contents`                                                                 | Store Hub 53 passed / 3 failed, Terminal 108 / 3 — the 3 are exactly "boot-classification is in the image / unit present / enabled", read from the **old** built rootfs: rebuild pending, as designed                                                                                                                                        |
| ESLint on every touched file                                                           | clean                                                                                                                                                                                                                                                                                                                                        |
| `pnpm secret:scan`                                                                     | passed                                                                                                                                                                                                                                                                                                                                       |

`pnpm verify`: **FAIL** overall. PASS: Lint, Typecheck, Contract tests, Offline
harness, Build, OpenAPI validation, Migration validation, Hub migration validation,
Secret scan, Clock usage. FAIL, all pre-existing:

- **Format check:** every matched file passes Prettier; the step fails on EACCES in
  the root-owned `infra/kitluy-os-image/build/work/chroot-*` tree.
- **Unit tests:** stopped at `@kitluy/device-identity`, where the two concurrency suites
  refuse because `postgres` holds the platform's creation-time `kitluy_credential_issuer`
  membership (grantor `supabase_admin`), recorded in handoff 39 §7. Verified that 0227 left
  no borrowed row on either stack. Turbo then skipped the remaining test tasks; the
  affected packages were run directly (above).
- **Docs link check:** four broken UUID links in
  `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`.

## 10. Environments

- `kitluy-repo17`: 0227 applied (re-applied after each restructure; idempotent;
  assertion passed), ledger row recorded on success only. All 19 `BOOT-EVIDENCE-*`
  fixtures retired (the first cleanup failed silently on
  `devices_quarantine_consistency_chk` — fixed and no longer swallowed).
- `kitluy-fresh` (hardware stack, PG 15.8): 0227 applied, assertion passed, ledger row
  recorded. Memberships checked: no borrowed row left.
- Fleet service `:8787` rebuilt (by `pnpm verify`'s build) and **restarted** with the
  exact environment of the running process (captured privately, deleted after launch);
  ready in ~2 s; `governedRoutes` lists `/v1/device-boot/classification`. Log:
  `scratch/2026-09-16__fleet-service-kitluy-fresh-boot-recovery-classification-001.log`.
- **Live route, real boards' recorded signals, freshly flashed card:**

| Board (record)           | Both doors identical | Cloud facts                                                                                                                            | Live answer                                                                   |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Store Hub                | yes                  | `enrolled`, generation 0, no assignment; head 2, previous 1 still honoured; active certificate gen 2 **not** of the current enrollment | `RECOVERING_DEVICE` `KLUY-BOOT-RECOVERY-NEEDS-PAIRING` → `ENTER_PAIRING_CODE` |
| Pi Terminal (re-flashed) | yes                  | `active`, gen 2; head 2, previous 1 honoured; seat not taken                                                                           | `RECOVERING_DEVICE` → `RELEASE_DEVICE_THEN_PAIR`                              |
| Pi Terminal              | yes                  | `active`, gen 1; seat not taken                                                                                                        | `RECOVERING_DEVICE` → `RELEASE_DEVICE_THEN_PAIR`                              |
| unknown board            | —                    | —                                                                                                                                      | `NEW_DEVICE` → `APPROVE_ENROLLMENT`                                           |

No hosted database was touched.

## 11. Hardware (task §12)

- **REFLASH-HARDENING-001 gate: NOT performed.** Live state confirms the Store Hub is
  where handoff 43 §8 leaves off after steps 1 and 3 (re-flashed, new enrollment,
  assignment released to generation 0). Steps 4–7 remain: the owner issues a pairing
  code **in their own terminal**, the code is typed on the Hub console, and the
  pass criteria in 43 §8 are checked (stated generation, generation-3 adoption, no
  override, no abandon, no key moved).
- **This task's hardware acceptance: NOT performed.** It needs rebuilt images (§13).
- The Store Hub (`172.16.13.203`) did not answer on SSH; its MAC was not in the
  neighbour table. Only one other Pi was visible on the LAN.

## 12. Gaps and decisions

| Id                                                | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Blocks                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **BOOT-RECOVERY-DEC-001** (**DECISION REQUIRED**) | No governed route to **release a device from its Store**. `revoke_device_assignment_v1` records an operator string, not a verified human; no permission key exists. Owner must decide **who may release** (HET Admin only, or the Store's Partner owner too), whether **pilot/production need four-eyes**, and the reason codes. **Proposal:** a `fleet.device_assignment.release` permission; a SECURITY DEFINER wrapper that records `auth.uid()` and an audit event; Admin-only in development first; four-eyes in pilot/production like approval. Until then the portal states the gap and a HET engineer releases with governor SQL. | S03 without SQL (task product principle) |
| GAP-BOOT-002                                      | Nothing produces `opened_foreign_contents` (Hub data naming another Hub/Store)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | S38 real evidence                        |
| GAP-BOOT-003                                      | S42 — cloud desired seat/profile vs a stale card                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | owner decision TOPOLOGY-001              |
| GAP-BOOT-004                                      | S43 — no governed role-change operation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | handoff 41 TOPOLOGY-004                  |
| GAP-BOOT-005                                      | Pi Terminal **Device Shell** does not render the classification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Terminal shop UX                         |
| GAP-BOOT-006                                      | `hub-storage-provision` records no machine-readable outcome (foreign vs posture unresolved)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | precise storage messages                 |
| GAP-BOOT-007                                      | Device **replacement** route not exposed (group 0179 exists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | S14/S16 without SQL                      |
| GAP-BOOT-008                                      | The cloud stores no board-reported classification, so Admin sees the fresh-card view, not the live boot state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | live fleet view                          |
| GAP-BOOT-009                                      | Partner Portal shows no recovery status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Partner UX                               |
| GAP-BOOT-010                                      | Admin Portal Khmer strings for recovery are agent-authored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | owner/native review                      |

## 13. Exact next steps

1. **Hardware, REFLASH-HARDENING-001 gate first** (handoff 43 §8 steps 4–7), one
   physical action at a time: power on the Store Hub; confirm SSH; the owner issues the
   pairing code in their own terminal; type it on the console; check the pass criteria.
2. Owner decides **BOOT-RECOVERY-DEC-001**; then build the release route + Admin action.
3. Rebuild both images from the commit in §14, read `boot-classification` back from
   each erofs `system_a` (handoff 40 technique), then flash and run acceptance:
   S01 (READY on console), S02 (unplug network: waiting + still serving on the Hub),
   S03 (fresh card: console says release/pair), S06 (old card after recovery: outdated).
4. GAP-BOOT-005 (Device Shell screen), GAP-BOOT-009 (Partner Portal), GAP-BOOT-006
   (storage outcome file).

## 14. Git

| Commit      | What                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| this commit | contract package + matrix; migration 0227; registry route; firstboot runtime, console and drift test; both overlays re-packaged; Management API recovery view + OpenAPI; Admin Portal recovery card; this handoff, the index, register rows |

Pushed to `provisioning` `dev`. `main` unchanged. Not included:
`scripts/development/issue-dev-pairing-code.mjs` (an uncommitted PG 15 fix present
before this session, not part of this task).
