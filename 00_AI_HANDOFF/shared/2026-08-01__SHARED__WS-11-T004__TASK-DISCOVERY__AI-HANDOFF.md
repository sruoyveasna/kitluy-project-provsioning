# WS-11-T004 — task discovery note (NOT a work package)

| Field      | Value |
| ---------- | ----- |
| Date       | 2026-08-01 · Asia/Phnom_Penh |
| Status     | DISCOVERY RECORD — proposal for owner confirmation. **Not a task, not a work package, no implementation authority.** |
| Base SHA   | `42a4fc0` (WS-11-T003 formal closure) |

## Why this exists

The formal closure of WS-11-T003 recorded: "Next permitted task identifier:
WS-11-T004. Exact title: NOT RESOLVED FROM CURRENT REGISTER — a separate
discovery package is required." This note is that discovery package. It
proposes a title from repository evidence; only the owner can turn it into a
task prompt (AGENTS.md §6: work packages only).

## The WS-11 task arc, as recorded in the repository

| Task | Title (from records) | Status |
| ---- | -------------------- | ------ |
| WS-11-T001 | Device enrollment and identity records (Cycle 10) | closed (BLK-005-gated evidence) |
| WS-11-T002 | Hub claim, scope resolution and assignment (Cycle 10) | closed (BLK-005-gated evidence) |
| WS-11-T003 | Trusted time (Step 2); device credential lifecycle and revocation, emergency governance, offline enforcement and lifecycle containment (Step 4) | **COMPLETED-IN-DEV** (formal closure 2026-08-01) |

Discovery observation, recorded honestly: the status register carries dedicated
records for T003 Steps 2 and 4 only; Steps 1 and 3 have no separately titled
records in the repository. The overall closure was recorded by the owner's
formal closure package and is not re-opened here.

## What remains of WS-11 per the master plan

`docs/source/owner-instructions/kitluy-phase1-laundry-master-build-plan-v1.0.0.md`
(§WS-11, exit gate G4) names the workstream pillars. Already covered by
T001–T003: enrollment records, identity, Hub claim/assignment, trusted time,
credential lifecycle, revocation, key destruction, offline revocation
enforcement. **Not yet covered by any task record:**

1. **Provisioning codes and Hub activation** — codes issued/consumed, expired or
   reused code refused, activation gating (the BLK-005 gate resolver already
   exists as a policy check; the activation workflow itself has no task record);
2. **LAN discovery with cached endpoint/manual fallback** — terminal finds its
   Hub after activation;
3. **Fleet health and diagnostics** — `device_health`, health evaluation jobs;
4. **Replacement workflows** — device/Hub/NVMe replacement drills;
5. **Signed release targeting** — release assignments, staged rollout, rollback.

The WS-11 task sequence so far has been strictly dependency-ordered (identity
→ assignment → credentials/revocation), so the next unbuilt dependency for
everything below it is pillar 1.

## Proposal (owner confirmation required)

```text
Candidate identifier: WS-11-T004
Candidate title:      Provisioning codes and Hub activation
Candidate scope:      governed issuance of provisioning codes; code redemption
                      at the Hub; activation state machine against the existing
                      BLK-005 gate; expired/reused/wrong-scope code refusals;
                      activation audit and incidents; LAN discovery inputs
                      (Hub endpoint publication) only to the level activation
                      requires — no fleet health, replacement or release work.
Candidate authority:  master plan §WS-11 (provisioning_codes, Hub activation,
                      exit gate G4); KL-HUB-P1-004..010; BLK-005 decision values
                      (owner ballot 2026-07-28).
Candidate acceptance: from-zero migration chain; governed code lifecycle with
                      four-eyes where policy requires; activation blocked
                      honestly for pilot/production while BLK-005 values are
                      unset; independent review; canonical verification.
```

This proposal has NO authority until the owner issues a task prompt naming
title, scope and acceptance criteria. Nothing in this note starts WS-11-T004.

## Also awaiting named work packages (not started)

- ~~**KLRISK-DEVICE-012**~~ — **CLOSED 2026-08-03** by additive migration 0161
  (constraint admits `destroyed` with the reason preserved, and
  `abandon_generation_key_v1` closes the dead reservation atomically);
  end-to-end proof in the destruction suite (13/13). See
  `2026-08-03__SHARED__KLRISK-DEVICE-012__ABANDONED-KEY-DESTRUCTION-REPAIR__AI-HANDOFF.md`.
- **R2-RV-004 hygiene candidate** — a dedicated assertion role for the 0160
  inspection readers (today `authenticated` holds EXECUTE without schema
  USAGE, i.e. unreachable). Low priority, no behavior change.
