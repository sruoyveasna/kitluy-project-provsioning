# KitLuy Task Handoff — Edge milestone, increment 1

## 0. Identity

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Task ID       | `EDGE-MILESTONE` increment 1 of N                           |
| Task title    | Edge milestone reconnaissance + development liveness policy |
| Status        | `PARTIAL` — reconnaissance complete, one lane item complete |
| Branch / HEAD | `main` / `e9a7c39` (unchanged, 0 commits, 0 pushes)         |
| Handoff date  | 2026-08-10                                                  |

## 1. Honest scope statement

The requested milestone spans four lanes, two OS image families, a GUI and a
CLI. **It was not completed.** This increment delivers the mandated
reconnaissance (§3) and one self-contained owner decision (§17), both finished
and tested. Everything else is NOT STARTED and is sequenced below.

The reconnaissance is not a formality here — it **changed the plan** in three
ways that would have caused wrong work if skipped.

## 2. Reconnaissance map — requirement → existing canonical → missing

| Requirement                | Existing canonical implementation                                                                                                           | Missing                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Provisioning issue (term.) | `kitluy_devices.issue_terminal_provisioning_code_v1` (0163)                                                                                 | Management API route, Admin UI             |
| Provisioning issue (hub)   | `kitluy_devices.create_device_claim_v1` (0121) — generic, class-agnostic                                                                    | Management API route, Admin UI             |
| Claim (terminal)           | `redeem_terminal_provisioning_code_v1` + PoP challenge/verify, exposed at `/v1/terminal-provisioning/*` in `kitluy-device-registry-service` | edge client                                |
| Claim (hub)                | `redeem_device_claim_v1` (0121)                                                                                                             | HTTP exposure, edge client                 |
| Heartbeat / liveness       | `record_hardware_observation_v1` (0120) → drives `device_fleet_status.last_observed_at`                                                     | HTTP route, edge client                    |
| Terminal health (assigned) | `ingest_device_health_report_v1` + `HealthReportIngestion`                                                                                  | HTTP route (Hub-delivered, assigned only)  |
| Firstboot state machine    | `services/kitluy-device-firstboot-agent` — `bootstrapIdentity`, `runEnrollmentStep`                                                         | HTTP `EnrollmentClient` impl, resume state |
| Hub image                  | `infra/kitluy-os-image` layer + profile + staging pipeline, 34 gate tests pass                                                              | Hub CLI, PostgreSQL init verification      |
| Terminal image             | same pipeline, Wayland/labwc layer present, 30 gate tests pass                                                                              | setup/recovery shell, terminal-session bin |
| Liveness thresholds        | `deriveFreshness`                                                                                                                           | **DONE this increment**                    |

### Finding 1 — heartbeat needs no new table, and is an attestation

`device_fleet_status.last_observed_at` is
`max(device_hardware_observations.observed_at)`, written only by
`record_hardware_observation_v1`. That function compares submitted signals
against the enrolled manifest and **quarantines on mismatch**.

So a heartbeat IS a hardware attestation. Two consequences:

- No migration is required for liveness (**86 → 86** holds).
- A heartbeat must never be sent with approximate signals. An agent that
  "roughly" reports hardware will quarantine its own device.

`HealthReportIngestion` is NOT this path: it is Hub-delivered health for an
ASSIGNED terminal, requiring `AuthenticatedHubDelivery` scope. It cannot serve
an unassigned device's first heartbeat.

### Finding 2 — Hub and Terminal provisioning are already two paths, on purpose

`issue_terminal_provisioning_code_v1` refuses with
_"no activated Store Hub at this scope; a terminal cannot provision before its
Hub is active"_.

The canonical order is therefore **Hub first, then Terminal**. The shared
foundation is device identity + claim semantics; the terminal path adds
proof-of-possession and the active-Hub gate. This is one protocol family with a
justified specialization — not two competing protocols — and the edge client
must model it that way.

### Finding 3 — the permission already exists

`fleet.device_provisioning_code.issue` is canonical, seeded, and held by the
dev Admin (confirmed live: 8 permissions). Per §5 its semantics cover
provisioning issuance, so **`fleet.provisioning.issue` must NOT be created** —
that would be the second key OD-ADMIN-PROVISION-001 forbids.

## 3. Delivered this increment — OD-EDGE-LIVENESS-001

Configurable development liveness thresholds (§17), owner decision recorded at
`docs/decisions/kitluy-development-device-liveness-thresholds-owner-decision-v1.0.0.md`.

- Defaults 90s STALE / 300s OFFLINE, overridable by
  `MANAGEMENT_API_STALE_AFTER_SECONDS` / `MANAGEMENT_API_OFFLINE_AFTER_SECONDS`.
- Configuration, not schema. **No DDL. 86 → 86.**
- Unparseable/non-positive value → startup refusal, never a silent default.
- Inverted thresholds → refusal (`STALE` would be unreachable).
- Portal labels a ruled policy as a DEVELOPMENT default; `ONLINE` is now
  permitted but never presented as settled truth.

Live proof: the API reports `freshnessPolicyRuled: true` against the real cloud
and all three devices still read `NEVER_SEEN` truthfully — none has ever had an
observation recorded.

## 4. Deliberately NOT done, with reason

- **No live heartbeat write.** `record_hardware_observation_v1` quarantines on
  signal mismatch, and `KL-CLOUD-TERM-0001` is the only eligible device. §11
  requires creating a clean device rather than risking an existing one. The
  `NEVER_SEEN → ONLINE → STALE → OFFLINE` transition is proven at route level
  against ruled thresholds, **not** yet against live cloud state.
- **No image artifacts.** See blockers.

## 5. Validation

`pnpm verify` fresh: 3 failures, **all PRE-EXISTING and identical to baseline**
(format check 48 entries, `@kitluy/device-identity` DB-dependent tests
12/26/1, docs link check 4 links). No task was cancelled. **No new regressions.**

Targeted: management-api 86/86, admin-portal 54/54, image build gates 34/34,
rpi-image-gen gates 30/30 (1 skipped — needs a checkout of the pinned tree).

## 6. Blockers

| Blocker                          | Status                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARM64 image artifact generation  | **ENVIRONMENTAL** — x86_64 host, non-root, `mmdebstrap`, `debootstrap`, `qemu-user-static`, `genimage` all absent; no arm64 binfmt handler registered. Docker is available, so a privileged cross-build container is a viable path but was not attempted. |
| Release signing (BLK-005)        | OPEN — pipeline correctly stages and refuses full assembly (exit 3), status `STAGED-UNSIGNED`. Preserved, not weakened.                                                                                                                                   |
| Factory QA persistence           | OPEN, pre-Pilot — not yet exercised; blocks the positive provisioning path for a NEW device.                                                                                                                                                              |
| PG17 local assertion/RLS SIGSEGV | OPEN, pre-Pilot — untouched, as instructed.                                                                                                                                                                                                               |
| Physical Raspberry Pi            | NOT TESTED — no hardware evidence exists.                                                                                                                                                                                                                 |

## 7. Next task (exact)

**Lane A, step 1 — governed provisioning issuance for a Store Hub.**
`POST /management/v1/provisioning-sessions` reusing `create_device_claim_v1`
behind `fleet.device_provisioning_code.issue`, returning the plaintext code
once and storing only its SHA-256, with expiry / single-use / replay /
wrong-device tests. Hub before Terminal, because the canonical terminal door
refuses until a Hub is active.

## 8. Truth statement

- Migration count: 86 → 86. No DDL.
- Commits: 0. Pushes: 0. HEAD unchanged at `e9a7c39`.
- Secrets in code/handoff/evidence: NO.
- Anything claimed `HARDWARE-TESTED`: NO.
