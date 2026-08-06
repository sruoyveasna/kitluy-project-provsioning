# WS-12-T001 — T1 Runtime, Device Session and Store Hub Bootstrap

| Field      | Value                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                                                  |
| Authority  | KLD-2026-08-06-WS12-TASKS-001 (WS-12 task register); WS-12-T001 owner package |
| Status     | **WS-12-T001 PARTIAL — SUCCESSOR PACKAGE REQUIRED**                           |
| Workstream | WS-12 T1 Intake/Cashier — IN PROGRESS (T001 of 8; nothing else started)       |
| Push       | NOT PUSHED                                                                    |

## 1. What was built (all verified by executed tests)

The minimum production-shaped T1 application foundation in
`apps/kitluy-pos-desktop-app`, composing existing shared authorities only —
T1 creates no new source of truth anywhere in this package.

- **The §5 startup machine** (`src/bootstrap/machine.ts`): the ten required
  steps in order, mapping every failure into the CLOSED thirteen-state
  vocabulary (`src/bootstrap/states.ts`). Fail-closed throughout; no
  fourteenth state can be invented; cloud availability is structurally
  outside startup (there is NO cloud port in `T1BootstrapPorts`).
- **Verified Hub endpoint resolution** (`src/bootstrap/hub-endpoint.ts`):
  the P04B signed discovery record parsed, shape-checked, verified through
  `verifyEdgeDiscoveryRecord` against the CLOUD-PROVISIONED expectation, and
  converted into a TLS-pinned endpoint. Wrong Hub/scope/environment →
  `assignment_invalid`; forged or unverifiable record → `hub_unavailable`.
- **Device session authority composition**: startup re-verifies the stored
  pairing receipt (`PairingReceiptStore.loadVerifiedCurrentReceipt`) and
  judges it against CURRENT Hub eligibility (`authorizeOperationalUse`) — a
  verified receipt is evidence, never a standing authorization (protocol
  §11). Revoked credential → `credential_invalid`; stale assignment
  generation → `assignment_invalid`; non-T1 or retired profile identifier →
  `profile_not_authorized` (refused, never coerced).
- **Signed configuration loading**: verification through the REAL
  `evaluateConfigurationSnapshot` (trusted time, environment, scope, device,
  assignment generation, checksum, signature, monotonic version), a
  schema-version compatibility gate (Hub 0003 `schema_version` contract),
  and the NEW terminal-local cache (below). Freshness is an explicit label:
  `current` (obtained from the Hub this startup → `ready`) vs
  `cached_offline` (last valid snapshot re-verified → `offline_ready`);
  cached data is never presented as current, in state or in UI.
- **`@kitluy/terminal-local-store` `ConfigurationSnapshotStore`** — the
  missing authoritative local persistence contract for offline startup
  (owner package §6 requires the last valid signed configuration to survive
  restart; no contract for that existed anywhere). Same driver, sealing
  (AES-256-GCM with AAD binding), key custody and SQLite-trigger
  immutability as the receipt store; versions only move forward
  (`KLUY-TERMINAL-STORE-CONFIG-ROLLBACK`); forbidden material refused; wrong
  key reads are CORRUPT, not silently empty. 6 new tests.
- **Staff session and permission bootstrap**: durable restore only if
  still valid (`staff_authentication_required` otherwise — a restart always
  re-authenticates), and step-9 evaluation via `evaluateStaffAuthorization`:
  the staff member must be authorized for the exact owner-locked T1 profile.
  The four `/edge/v1/sessions/*` permission keys remain `[REQUIRED:]` gaps
  in `@kitluy/edge-contracts` and were NOT guessed (hard rule 9).
- **Electron composition root** (`electron/t1-runtime.ts`) wiring REAL
  adapters where authority exists — protected identity file
  (`terminal-identity.ts`, safeStorage-wrapped, forbidden-material-guarded),
  encrypted terminal store, pinned mTLS LAN client (`lan-client.ts`, TLS 1.3
  only, `checkServerIdentity` fingerprint pinning,
  `KLUY-TERMINAL-HUB-CERT-MISMATCH`) — and explicit FAIL-CLOSED defaults
  everywhere authority does not exist yet (§4 below).
- **Renderer**: read-only preload bridge (`electron/preload.cts`,
  contextBridge, no channel pass-through, no input of any kind), and the
  bilingual (km-KH/en-US) `T1BootstrapView` state surface where
  `offline_ready` renders through the `stale` DataSurface with its
  verification instant.
- **Non-selectability (§5)**: Tenant, Digital Store, Location, Hub,
  environment, terminal profile and assignment generation enter ONLY through
  the protected identity file and the Hub-signed receipt. No UI, IPC
  channel, argument or environment variable can supply or override any of
  them — the bridge is read-only and the ports carry no override input.

Two pre-existing app defects were fixed because T001 wires the runtime they
blocked: `package.json` `main` pointed at a never-emitted
`dist-electron/main.cjs`, and `electron/terminal-store.ts` was never called
from the main process. The electron TS project now emits NodeNext ESM
(`dist-electron/electron/main.js`) and `main.ts` runs the bootstrap and
publishes the report over IPC.

## 2. Focused acceptance evidence (§7 — all executed, ZERO skips)

`apps/kitluy-pos-desktop-app/test/t1-bootstrap.acceptance.test.ts` — **16
tests covering all 14 required scenarios** — real Ed25519 keys
(`DevelopmentDeviceKeyProvider`), the real device-identity verifiers and the
real encrypted store over `node:sqlite`; only the transports are port fakes.
Results 2026-08-06: app suite **18/18** (16 acceptance + 2 smoke);
`@kitluy/terminal-local-store` **20/20** (14 receipt + 6 new configuration);
affected consumed-authority suites re-run green: device-identity
`pairing` + `configuration-validity` **37/37**, hub-agent `edge-discovery`
**6/6**. Typecheck clean (renderer + electron projects). Changed-file
lint 0 errors, changed-file Prettier clean, `secret:scan` **1412 tracked
files, passed**.

| §7 scenario                               | Test                                           |
| ----------------------------------------- | ---------------------------------------------- |
| First successful startup                  | 1 (ready; §5 order asserted via transitions)   |
| Restart, WAN unavailable, Hub available   | 2 (no cloud port exists — structural proof)    |
| Discovery + certificate verification      | 3 (verified record pins the endpoint)          |
| Wrong Hub refusal                         | 4 (`DISCOVERY_WRONG_HUB` → assignment_invalid) |
| Revoked/expired credential refusal        | 5 (transport refusal AND eligibility refusal)  |
| Stale assignment generation refusal       | 6 (`PAIR_ASSIGNMENT_MISMATCH`)                 |
| Non-T1 profile refusal                    | 7 (T2 profile + retired `t2_scan_in`)          |
| Incompatible configuration refusal        | 8 (schema version + bad signature)             |
| Valid cached configuration, offline label | 9 (`offline_ready`, `cached_offline`)          |
| Missing/corrupt receipt fails closed      | 10 (missing → recovery; wrong-key CORRUPT)     |
| Staff without T1 permission denied        | 11 (profile denial + expired session)          |
| Restart restores only valid durable state | 12 (re-verified receipt+config; staff never)   |
| No DB/cloud credential exposed            | 13 (forbidden-material walk over report+logs)  |
| Logs carry no key/token/cert/signature    | 14 (PEM bodies, signatures, bearer patterns)   |

(Stale-configuration expiry and Hub-unreachable each additionally have a
dedicated test.)

## 3. Migration decision

**No cloud or Hub migration was created.** Startup composes existing doors
only (discovery route, pairing receipt authority, Hub 0003/0022
configuration contracts); executable evidence showed no missing
cloud/Hub-side persistence. The missing authoritative LOCAL persistence
contract that §6 offline startup proved (the last-valid-signed-configuration
cache) lives where terminal-local persistence is governed — in
`@kitluy/terminal-local-store`, whose schema is in-package DDL with
SQLite-trigger immutability, not a numbered migration. No empty migration
was created.

## 4. Recorded gaps — why PARTIAL, and what the successor needs

Fail-closed today, each with its structural reason; NONE was worked around:

1. **No approved `/edge/v1` route serves terminal eligibility, Hub time or
   a configuration snapshot.** The KLD-2026-07-26-002 approved catalogue has
   no such reads (the legacy spec's `GET /edge/v1/config/status` was never
   carried into `@kitluy/edge-contracts`). Inventing a route is a contract
   change (hard rule 8) — the runtime adapters return explicit
   `KLUY-TERMINAL-*-UNSERVED` refusals. **Owner decision needed: additive
   route registration** for eligibility/config delivery, then a Hub handler
   package.
2. **`/edge/v1/sessions/*` permission keys are `[REQUIRED:]` gaps** — staff
   session open/refresh/switch/close cannot be served or called until the
   owner rules them (hard rule 9). Step 8/9 are implemented against the
   port with profile-authorization evaluation.
3. **Transport credential custody** (`unavailableTransportCredentials`) —
   private-key custody for mTLS is BLK-005 material.
4. **Trusted-time providers** — the composition default REFUSES
   (`restricted_no_trusted_source`); the host clock is never trusted
   (KLD-2026-08-06-WS11-CLOCK-001). Real RTC/authenticated-network wiring
   is BLK-005 G12 hardware work.
5. **No mDNS listener exists repo-wide**; discovery uses the provisioned
   endpoint hint + the signed record. The multicast listener is successor
   scope.
6. **Configuration signature verification is caller-supplied** (device-
   identity condition C4, unchanged): the shipped default refuses all; the
   development verifier is quarantined under `kitluy.dev.` domain
   separation and refuses every non-development environment.
7. **No provisioning writer for the identity file exists yet** — the T004
   provisioning outcome must be wired to `writeProtectedTerminalIdentity`
   (successor, with T002's first real Hub interaction).

Because items 1–2 leave three §5 steps without a servable Hub surface, the
end-to-end runtime cannot reach `ready` against a real Hub yet — the
machine-level proof is complete, the composition is production-shaped and
fail-closed, and the status is honestly **PARTIAL — SUCCESSOR PACKAGE
REQUIRED** (the WS-11-T005 precedent).

## 5. T001 capability census

| Capability                                          | State                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| §5 state vocabulary (13 states, closed)             | IMPLEMENTED-IN-DEV (tested)                                        |
| Ten-step bootstrap sequence                         | IMPLEMENTED-IN-DEV (tested, transitions asserted)                  |
| Protected identity load (safeStorage custody)       | IMPLEMENTED-IN-DEV (adapter; no writer wired)                      |
| Pairing-receipt startup verification + §11 re-check | IMPLEMENTED-IN-DEV (real store + crypto)                           |
| Verified discovery → pinned endpoint                | IMPLEMENTED-IN-DEV (real signatures)                               |
| mTLS establishment w/ pinning                       | IMPLEMENTED-IN-DEV (client built; credentials BLK-005 fail-closed) |
| Eligibility / Hub time / config delivery over LAN   | FAIL-CLOSED — no approved route (owner decision)                   |
| Signed-config verification + schema gate            | IMPLEMENTED-IN-DEV (real verifier; C4 signer gap unchanged)        |
| Offline config cache (durable, sealed, monotonic)   | IMPLEMENTED-IN-DEV (new store, 6 tests)                            |
| Staff restore + T1 profile authorization            | IMPLEMENTED-IN-DEV (machine level; Hub sessions route gap)         |
| Read-only renderer bridge + bilingual state surface | IMPLEMENTED-IN-DEV                                                 |
| Non-selectability of scope/Hub/profile/generation   | IMPLEMENTED-IN-DEV (structural; no input path)                     |
| Booking/pricing/payment/receipt/printing            | NOT IN T001 — untouched (T002–T006)                                |

## 6. Security result

- `pnpm secret:scan` — **passed, 1412 tracked files**, zero findings.
- Acceptance tests 13–14 prove the runtime surface and logs carry no
  connection string, private key, token, certificate body, PEM body (even
  public), receipt signature or bearer material.
- The terminal never receives a database or cloud credential anywhere in
  this design; the Store Hub is never bypassed; no Supabase dependency
  exists in the app.
- Renderer hardening preserved (contextIsolation, sandbox, no
  nodeIntegration) and the new preload exposes a read-only report surface
  only.

## 7. Remaining WS-12-T002 dependencies

T002 (Customer Identity, Consent and Booking Draft) additionally needs:
the owner route-registration decision for the eligibility/configuration
reads (§4.1) and the sessions permission keys (§4.2) if T002 opens real
staff sessions; the provisioning writer for the protected identity file
(§4.7); and the WS-06 customer/consent authorities it composes. The T1
shell it builds inside is this package's `ready`/`offline_ready` states.

## 8. Rollback

Revert the single T001 commit; no database changed. The
`configuration_snapshots` tables exist only inside terminal-local SQLite
files created at runtime.
