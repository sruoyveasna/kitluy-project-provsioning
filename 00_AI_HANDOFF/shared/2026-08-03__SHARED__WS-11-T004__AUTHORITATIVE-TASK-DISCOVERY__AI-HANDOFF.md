# WS-11-T004 — authoritative task discovery record

| Field      | Value |
| ---------- | ----- |
| Date       | 2026-08-03 · Asia/Phnom_Penh |
| Base SHA   | `ee38d2b` (main, clean, 87 ahead, push `disabled://push-requires-owner-approval`) |
| Toolchain  | Node v22.23.0, pnpm 9.15.9 |
| Package    | WS-11-T004 AUTHORITATIVE TASK DISCOVERY — discovery only; **no implementation, no migrations, no runtime changes, nothing pushed** |

## 1. Repository state (verified)

HEAD `ee38d2b` (formal closure `42a4fc0` plus discovery note `2bc57a4` and the
KLRISK-DEVICE-012 repair commits), branch `main`, tree clean, 87 commits
ahead of upstream, push disabled, `git diff --check` clean, Node v22.23.0,
pnpm 9.15.9. WS-11-T003: COMPLETED-IN-DEV. WS-11-T004..T008: NOT STARTED.

## 2. Task identity

```text
Task ID:    WS-11-T004
Title:      Terminal (T1–T4) assignment and provisioning
Confidence: DERIVED FROM AUTHORITATIVE SOURCES (see classification below)
```

The discovery note's proposed title — "Provisioning codes and Hub activation" —
is **NOT confirmed** and is corrected here: Hub activation is already delivered
(T002's `device_claims` claim/redeem machinery and `attempt_activate_device_v1`
with the asserted BLK-005 gate). What is unambiguously next in the locked chain
is the TERMINAL side.

### Classification of the identity

| Item | Classification | Source |
| ---- | -------------- | ------ |
| Task ID `WS-11-T004` (next permitted) | AUTHORITATIVE | formal closure record + `000_CURRENT_STATE.md` |
| Next step is terminal assignment | AUTHORITATIVE | `00_AI_HANDOFF/000_ACTIVE_PHASE.md` §10 (owner-directed 2026-07-28), dependency order step 6: "Terminal T1-T4 assignment" — steps 1–5 map to T001/T002/T003 (closed) |
| The terminal provisioning flow (code → certificate → Hub/profile → pairing → active) | AUTHORITATIVE | `kitluy-device-discovery-and-pairing-protocol-v1.0.0.md` §7; `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` §3.2 |
| Exact title string "Terminal (T1–T4) assignment and provisioning" | DERIVED | composed from the two sources above; no register contains a literal title |
| Acceptance criteria detail | DERIVED (safe) | pairing protocol §6.1/§8/§10/§13, QA registry POS4-QA-001 + ADMIN-QA-014, master plan §WS-11 Tests row |
| Terminal code TTL/lockout policy values | AUTHORITATIVE | pairing protocol §6.1 (8-char Crockford Base32, 15 minutes, single-use, salted hash, 5-attempt lockout + security event) |

## 3. What already exists (must NOT be rebuilt)

- `kitluy_devices.device_terminal_assignments` (0121): terminal profile ↔
  device ↔ assignment binding, wrong-Location refused structurally,
  `<vertical>.t<n>.<role>` profile shape without Laundry vocabulary in Core.
- `kitluy_devices.device_claims` (0121): single-use, hash-only, scope-bound
  claim (the data dictionary's `provisioning_sessions`).
- Terminal profile identifiers (Cycle 5, group 0100).
- Activation path: `attempt_activate_device_v1` with refusal evidence and the
  BLK-005 gate (resolves for development, fails closed for pilot/production
  with named `[REQUIRED: ...]` values).
- Credential issuance for devices (0125-0128, T003): the terminal's
  operational certificate is issued by the SAME governed doors the Hub's was.
- Lifecycle state machine: `enrolled → active` is REMOVED; `active` is
  reachable only through `awaiting_trust` (claim + assignment), with
  `device_assignment_projections` written only by a successful activation.
- `kitluy-provisioning-service` (SCAFFOLDED): kernel built (health/ready/
  version); its README names exactly this scope — "short-lived provisioning
  codes, assignment approval (RB v4 §6.5)".

## 4. The gap T004 must close

1. **Terminal provisioning codes** — issued bound to a terminal device ID, an
   assignment intent and environment, per pairing protocol §6.1: 8-char
   Crockford Base32, 15-minute TTL, single-use, salted-hash storage only,
   five failed attempts lock the session and emit a security event. (Today's
   claim token format is a long hex string; the human-facing code, its
   issuance surface and the attempt lockout do not exist.)
2. **Terminal provisioning flow endpoint** (cloud): validate enrollment +
   assignment → prove non-exportable key → issue terminal operational
   certificate → return assigned Hub identity + profile set → mark terminal
   active through `awaiting_trust` only. The installer can NEVER choose T1–T4
   roles (cloud-authored, Hub-enforced).
3. **Pairing session machinery** (§8 handshake, §9 pairing receipt, §10 state
   machine): terminal↔Hub mutual certificate + assignment verification, with
   the receipt Hub-persisted for offline operation.
4. **Ordering rule**: a terminal cannot provision before its Hub is active
   (QA ADMIN-QA-014; pos-desktop spec §3.x rule 2).
5. **Offline behavior**: assignment projections and the pairing receipt must
   let a terminal resolve and authenticate to its Hub with the internet down
   (connection priority §5 / pos spec §3.3; an address never creates trust).

## 5. Scope

**In scope (inferred work items):** cloud migration for terminal code
issuance/lockout/security events; provisioning-service endpoint(s); pairing
session schema + governed doors; terminal activation through the existing
state machine; focused security tests (lockout, replay, expired, wrong-scope,
role-choice refusal, Hub-not-active refusal); offline pairing tests; evidence.

**Out of scope:** Hub provisioning/activation (delivered); LAN discovery
mechanics beyond what pairing requires; fleet health/diagnostics (step 10);
replacement workflows (step 11); signed releases (steps 9/12); T1–T4
application integration (explicitly out for all of Cycle 10);
production-signing-key custody (BLK-005, owner values); T004 does not advance
pilot/production activation while BLK-005 values are unset.

## 6. Dependencies and boundaries

- **Depends on:** T001 (enrollment), T002 (claim/assignment), T003 (credential
  issuance, trusted time, revocation) — all closed. Hub activation must
  resolve in development for the ordering rule to be testable.
- **Products/services:** `kitluy-provisioning-service` (endpoint owner),
  `kitluy-device-registry-service` (credential issuance reuse),
  `kitluy-hub-agent` (pairing enforcement + receipt persistence), Admin PWA
  (code issuance surface, `/fleet`), POS terminal image (client of the flow).
- **Database ownership:** `kitluy_devices` (cloud, Fleet-owned, NOLOGIN
  authorities per existing pattern); `edge_config`/`edge_identity` (Hub).
- **Security boundaries:** codes never stored (hash only); code never bypasses
  factory identity or the cryptographic challenge; provisioning requires cloud
  for the code step, then LAN-only operation; RLS ENABLE+FORCE; NOLOGIN definer
  owners; four-eyes where policy requires; no `service_role` shortcuts.
- **Permissions:** code issuance is a fleet/hardware operator permission with
  approval per approvals-domain policy; terminal activation has no human
  permission at all — it is code + certificate + assignment, machine-checked.

## 7. Acceptance contract (derived, no invented values)

Required implementation: the five gap items in §4, through governed doors,
with production-composition wiring (no helper-only claims).
Required tests (all new, zero skips): §6.1 format/TTL/single-use/hash-only;
five-attempt lockout + security event; expired code refused; reused code
refused; wrong-Location/wrong-Store refused; terminal-before-Hub-active
refused; role-choice by installer refused; certificate issued through the
governed doors; pairing handshake + receipt + state machine; offline
pairing/reconnection without a code; ordering projections correct.
Required evidence: migration chain from zero; db:test/test:rls/hub:db:test
green; focused suites green; independent review; canonical verification 12/13
baseline or better; handoff + register updates.
Completion criteria: POS4-QA-001 and ADMIN-QA-014 executable and passing;
terminal provisions end-to-end in development with no manual DB action; BLK-005
gate posture unchanged (fails closed outside development).

## 8. Package plan (sequential, each ≤59 min / ≤80 steps, one primary outcome)

| Pkg | Objective | Allowed files | Prohibited | Gate |
| --- | --------- | ------------- | ---------- | ---- |
| T004-P01 | Capability audit: prove exactly which pairing/terminal-code primitives already exist vs are absent (catalog census, no changes) | none (read-only) | all writes | audit record + file-ownership map |
| T004-P02 | Cloud migration: terminal provisioning codes + attempt lockout + security event (additive, next group after 0161) | `supabase/migrations/20260803*_0162_*.sql`, assertions.sql additions | runtime code, other migrations | from-zero reset + db:test green |
| T004-P03 | Provisioning-service endpoint: code issuance + redemption flow through governed doors | `services/kitluy-provisioning-service/**` only | other services, packages | service tests + production-composition proof |
| T004-P04 | Pairing session machinery (cloud schema + governed handshake doors) | one additive migration group, `packages/device-identity/**` | hub runtime, other migrations | focused unit/integration tests |
| T004-P05 | Hub-side pairing enforcement + receipt persistence (additive hub migration) | `hub/migrations/0031_*`, `services/kitluy-hub-agent/**` | cloud migrations, other services | hub rebuild + hub:db:test + hub-agent suites |
| T004-P06 | Focused security tests: §6.1 all refusals + ordering rule + role-choice refusal | test files only | runtime changes | all focused suites green, zero skips |
| T004-P07 | Offline pairing/reconnection + terminal-before-Hub ordering tests | test files + evidence | runtime changes | offline suites green with hub DB live |
| T004-P08 | Lifecycle integration: terminal provisioning inside a production lifecycle run | lifecycle test file | runtime changes | lifecycle passes with new stages counted honestly |
| T004-P09 | Independent review (3 reviewers) + remediation | review records only | code | no blocker; conditions fixed |
| T004-P10 | Canonical verification + evidence register + formal status | docs/registers | runtime | verify baseline ≥12/13, evidence current |

Dependency: P01 → P02 → P03 → P04 → P05 → P06/P07 (parallel-safe files) → P08
→ P09 → P10. No package combines investigation, migration, runtime wiring,
broad testing and review. Estimated: P01 30 min; P02/P04/P05 45-59 min each;
P03 59 min; P06-P08 45-59 min each; P09/P10 45 min each.

## 9. Risks and blockers

- BLK-005 (PKI root/CA, HSM) remains OPEN: T004 must use the existing gate
  posture — development resolves, pilot/production fail closed with the named
  `[REQUIRED: ...]` values. Do NOT invent a signer. The gate is asserted, not
  widened.
- KLRISK-DEVICE-003 remains OPEN: unchanged by T004.
- The literal title string is DERIVED, not register-authoritative (§2). If the
  owner prefers a different title, only this record's label changes — scope is
  fixed by the dependency order either way.
- Watch item: terminal codes share the claim table or a sibling? P02's audit
  decides; do NOT widen `device_claims` semantics without an authority check
  (it is Hub-scoped by design today).

## 10. Start decision

```text
READY FOR IMPLEMENTATION PACKAGES
```

Exact title is DERIVED (strongest available, explicitly flagged); acceptance
criteria are present or safely derivable from named sections; no required
owner value is missing for development; dependencies are closed; no conflict
with T003; affected files and ownership boundaries are identified per package.
