# WS-12-T001-P02 — Real Hub Bootstrap Contract, Session Authorization and Discovery

| Field      | Value                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                                                             |
| Authority  | KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 (OWNER-APPROVED — LOCKED); WS-12-T001-P02    |
| Status     | **WS-12-T001 COMPLETE — IMPLEMENTED-IN-DEV**                                             |
| Workstream | WS-12 T1 Intake/Cashier — IN PROGRESS (T001 of 8 closed; T002 NOT STARTED)               |
| Push       | NOT PUSHED                                                                               |

## 0. Checkpoint deviation — recorded, not silently resolved (hard rule 8)

The P02 execution prompt expected HEAD `b820f00` with a clean tree. The
repository was found at **`9d7a64d`** — one commit ahead, itself titled
"WS-12-T001-P02", containing most of the P02 implementation (routes,
runtime-bootstrap, mDNS adapter, identity writer, owner decision document,
permission-registry amendment 002) but **no evidence**: no handoff, no
state-file updates, no recorded verification run, and several §8 required
proofs missing. The commit is owner-authored, in scope and on `main`;
reverting it would destroy owner work. This session therefore **continued
from `9d7a64d`**, verified everything it claims, closed the gaps below, and
records the deviation here and in the decision register
(KLREC-2026-08-06-WS12-T001-P02-001). The repository root on this machine
is `C:\dev\HET-KITLUY-PROJECT` (the 000_CURRENT_STATE row naming the old
Desktop path is machine-specific history).

## 1. What exists and is now proven (executed, zero skips on a live Hub)

**Hub routes** (`services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts`
+ `routes.ts`), all three served over the existing P04B TLS 1.3 mTLS
transport, terminal credential re-derived per request, correlation IDs
throughout, closed public error vocabulary, no raw SQLSTATE:

- `GET /edge/v1/runtime/authority-time` — Hub DATABASE transaction time
  (`select now()` under `kitluy_hub_runtime`), source `hub_database`,
  30-second maximum monotonic cache age, usable before a staff session,
  never without a current eligible credential.
- `GET /edge/v1/runtime/eligibility` — full owner field list, ALL scope
  derived from the authenticated credential and Hub relational authority;
  refuses query parameters; fail-closed for wrong/inactive/retired Hub,
  restored quarantine, stale assignment generation, revoked or superseded
  credential, missing pairing, non-T1 profile, prohibiting containment,
  cross-Tenant AND cross-Store transplants.
- `GET /edge/v1/configuration/current` — the exact signed envelope for the
  authenticated terminal; eligibility re-derived first; Hub operational key
  attests the delivery binding; absent signer fails closed
  (`DELIVERY_SIGNER_UNAVAILABLE`); the envelope now also self-describes its
  DELIVERY signer (`deliverySignerCertificateSerial`,
  `deliverySignerPublicKeyFingerprint`) — distinct from `signingKeyId`,
  which names the CLOUD manifest key (provenance).

**Session authorization**: the five canonical keys `staff.sessions.open`,
`.read`, `.refresh`, `.close` and `pos.t1.use` (registry amendment 002,
109 → 114; no synonyms — verified by search). Open/refresh/close enforce
their exact keys server-side through the EXISTING 0022/0025
`resolve_permission_grant` projection (deny anywhere wins; grants are
cloud-authored rows, so **no migration was needed to register keys** —
see §3). Session open/restore alone never authorizes T1; `pos.t1.use` is
additionally required and is enforced in the Electron MAIN process (the
renderer holds no authorization surface). The Edge inactive-route census
moved 9 → 5 (the four session routes left it; the five T2 display routes
remain fail-closed) — `hub-authorization-matrix.test.ts` updated.

**Terminal adapters** (`apps/kitluy-pos-desktop-app/electron/`): real
authority-time / eligibility / configuration / session adapters over the
pinned mTLS client; real mDNS/DNS-SD listener for
`_kitluy-edge._tcp.local` (raw multicast codec, candidates only — no
identity claim survives it); the locked six-source endpoint order
implemented in `resolveHubEndpoint` and PROVEN order-exact by test; the
atomic protected-identity writer (main-process only, server-authoritative
input, field+fingerprint validation, temp+fsync+rename, prior file
preserved on failure, sealed via safeStorage, no private key in JSON,
append-only installation acknowledgment, idempotent retry, conflict
refusal, corrupt file fails closed).

**Hub-time discipline**: one `HubTimeAnchor` (30 s max age, monotonic
advance only, `performance.now()`), reacquired-or-fail-closed everywhere;
receipt validity, discovery freshness, configuration validity,
staff-session expiry and (new) eligibility freshness are all judged under
Hub time. The runtime reads no wall clock.

**End-to-end proof** (`t1-startup.e2e.integration.test.ts`, real Hub DB,
real Edge TLS server, real Ed25519, real encrypted store, terminal touching
ONLY public adapters):

- protected identity → pairing receipt → signed discovery → TLS 1.3 mTLS →
  Hub authority time → eligibility → signed configuration → staff session →
  `pos.t1.use` → **`ready`** — transitions asserted.
- Hub reachable but unable to attest a delivery + valid cached
  configuration + eligible local authority → **`offline_ready`** with the
  explicit `cached_offline` label. Cloud/WAN is consulted nowhere — the
  port surface is structurally Hub-only (acceptance test 2), which is the
  §7 WAN-unavailable condition.

## 2. Defects found and fixed by this closeout session

The prior commit's implementation was sound in shape but carried four
genuine security gaps, found by contract-verification review and fixed
here (each now pinned by a test):

1. **Unpinned TLS requests disabled hostname verification.**
   `lan-client.ts` returned `undefined` from `checkServerIdentity` when no
   fingerprint pin was supplied, which turns Node's name binding OFF, not
   "default". Unpinned requests (the discovery fetch) now run Node's
   default `tls.checkServerIdentity`.
2. **A pooled TLS socket could skip the identity check entirely.** Node
   22's keep-alive global agent reuses sockets; a request pinned to
   fingerprint A could ride a socket handshaken for B, and
   `checkServerIdentity` never runs on a reused socket. This was observed
   live: the e2e's discovery fetch "passed" a deliberately wrong pin by
   riding the fixture's earlier connection. `pinnedHubRequest` now sets
   `agent: false` — one request, one handshake, one identity check.
3. **The discovery record could direct a connection before it was
   authenticated.** The mTLS session was established with the RECORD's
   claimed TLS fingerprint before the record's signature was verified
   (self-noted in a comment as ordering-inverted). The machine now
   authenticates the record — bindings and Ed25519 signature under the
   provisioned Hub operational key — BEFORE its fingerprint may pin
   anything; the freshness window is then re-judged under the Hub-time
   anchor once it exists (`NOT_YET_VALID`/`EXPIRED` stay retryable, named,
   non-consuming). Also recorded: the pairing receipt's
   `hubCertificateFingerprint` is the Hub CREDENTIAL (operational key)
   fingerprint, NOT the TLS certificate fingerprint — two different key
   domains that development fixtures had conflated; the e2e proves them
   distinct.
4. **Eligibility responses had no freshness check.** The wire's
   `authorityTime` was declared and never read. The machine now refuses an
   eligibility response outside the 30-second Hub-time window
   (`ELIGIBILITY_STALE`) or with an unparseable timestamp
   (`ELIGIBILITY_TIME_MALFORMED`) — both retryable, neither authorizes.

Smaller corrections: session routes now actually refuse query strings
(their comment claimed it; only the GET reads enforced it); a Hub-reported
`maxCacheAgeSeconds` LOWER than 30 now tightens the anchor (higher or
malformed never widens); the session-open idempotency key no longer reads
the wall clock (`Date.now()` → `randomUUID()`, minted once per logical
open).

## 3. Migrations — none, and why that is correct

- **No relational Edge route registry exists** in either database — route
  paths are code-registered (`@kitluy/edge-contracts` `route-paths.ts`,
  mirrored in `routes.ts`); serving three new paths touches no schema.
- **No relational permission-key registry exists** —
  `permission_grant_projection.permission_key` is unconstrained text with
  no FK or CHECK enumeration; the 0025 resolver compares text. A new key
  is registered by the canonical documents + `@kitluy/rbac` seed
  (amendment 002) and becomes effective when cloud-authored grant ROWS
  arrive — data delivery, not DDL. With zero rows the resolver returns
  `unknown` and every caller refuses: fail-closed exactly as required.
- Next free slots remain **cloud 0186** and **Hub 0040**. No empty
  migrations were created; no prior migration was edited.

## 4. Verification record (all executed this session, 2026-08-06)

| Gate                                                            | Result                                        |
| --------------------------------------------------------------- | --------------------------------------------- |
| Hub reset from zero → seed → assertions                         | 40 migrations OK · **43 PASS** · validate OK  |
| hub-agent `t1-bootstrap-routes` (live mTLS + Hub DB)            | **16/16** (12 prior + 4 added)                |
| hub-agent full regression                                       | **384 passed / 2 pre-existing skips**         |
| app `kitluy-pos-desktop-app` (7 files incl. e2e §7)             | **49/49, zero skips** (41 prior + 8 added)    |
| device-identity delivery + pairing + configuration-validity     | **42/42**                                     |
| edge-contracts / rbac / terminal-local-store                    | **45 / 15 / 20**                              |
| typecheck (6 projects, incl. both app tsconfigs)                | clean                                         |
| changed-file eslint + prettier                                  | clean                                         |
| `pnpm secret:scan`                                              | **passed, 1440 tracked files**                |

Toolchain: Node 22.23.0 + pnpm 9.15.9 (project-external pin per the
2026-07-31 owner approval). The Hub database runs in the local
`supabase_db_kitluy-local` container on 54322. Initial runs surfaced ONLY
environment staleness (unbuilt package dists, missing `pnpm install`),
not code defects; after rebuilds every suite above is green. The
`skipIf(!hub-database)` gates in the two live suites executed live
(`live === true`) for every figure here.

Rebuild-test note: the closeout run was performed on exactly the tree
being committed (clean apart from this package's changes), after a Hub
database rebuilt from zero — migration → seed → assertion → live-suite
order proven from nothing.

## 5. §8 acceptance matrix — where each proof lives

Authority time A1–A6: routes suite ("serves Hub-database authority time"),
`hub-time.test.ts` (ahead/behind wall clock, monotonic advance, expired
anchor), acceptance 15–16 (NOT_YET_VALID retryable + consumes nothing —
configuration and discovery instances). Eligibility E1–E11: routes suite
(wrong Hub family, restored quarantine, stale generation,
revoked/superseded, missing pairing, non-T1, containment, cross-Tenant,
cross-Store) + acceptance 4–7. Configuration C1–C8: routes suite +
`terminal-configuration-delivery.test.ts` + `configuration-validity` +
acceptance 8–9 + store rollback tests. Staff S1–S7: routes suite (exact
permission per route, deny-after-open, cross-Store transplant, disabled,
occupied, cross-terminal session), acceptance 11. Identity I1–I7:
`terminal-identity.test.ts` (all seven). Discovery D1–D7:
`mdns.test.ts` (real packets), `edge-discovery.test.ts` (altered record,
wrong fingerprint, expired), `t1-endpoint-order.test.ts` (locked order,
first-answer-wins, manual IP last), acceptance 3–4, 16, 19 (manual IP
gains no verification bypass). Security X1–X5: acceptance 13–14 + 18
(delivery signature never in terminal logs) + routes log census. E2E Z1–Z2:
the §7 integration test.

## 6. Out-of-scope findings — recorded, NOT fixed (hard rule 1)

1. **RETRACTED (2026-08-06 Stage A, KLREC-2026-08-06-WS12-STAGEA-001):**
   ~~`edge_config.resolve_permission_grant` is PUBLIC-executable~~ — the
   report was WRONG. Live reproduction shows 0025 lines 146–151 DO revoke
   PUBLIC execute and grant only `kitluy_hub_runtime`; the live ACL is
   `{postgres=X,kitluy_hub_runtime=X}` with no PUBLIC entry, and a freshly
   minted grantless role cannot execute. The reviewing agent had missed
   the privilege block at the end of 0025 and the claim was recorded here
   without a live probe — the process failure, not the database, was the
   defect. No Hub migration 0040 was created (it would have been empty).
   The correct state is now PINNED by assertions.sql §28b (direct-ACL +
   effective-execution + unrelated-governor probes), so a future recreate
   of the function cannot silently regress to the PUBLIC default.
2. **`staff.sessions.read` gates no served route** — declared in amendment
   002 §2; the key exists so the read surface, when approved, has its key.
3. **`pos.t1.use` has no Hub-side enforcement point yet** — correctly
   reported in `effectivePermissions` and enforced by the main process;
   the first served T1 operational route (T002+) MUST enforce it
   server-side.
4. **Five epoch-sentinel fallbacks** in `runtime-bootstrap.ts`
   (`?? new Date(0)` when a `select now()` row is absent) — practically
   unreachable and fail-closed in effect (an epoch time validates
   nothing), but `readAuthorityTime` throws instead; the five sites should
   match it.
5. **`rollbackReference` is sourced from the highest STAGED snapshot**
   (the next candidate), not the previously-active one; the owner contract
   does not define the direction — needs an owner reading before T002
   consumes it.
6. **`identitiesConflict` compares `JSON.stringify` output** — a
   semantically identical provisioning result with different key order
   would read as a conflict (safe direction, but noisy).
7. **The identity writer does not fsync the parent directory** after
   `renameSync` — file contents are durable, the rename itself is not
   crash-guaranteed on all filesystems.
8. **`eligibility.assignmentId` names the profile-assignment row** while
   `assignmentGeneration` is the device-assignment generation — two
   relations under one field pair; consumers must not treat them as one
   aggregate (doc comment exists in the wire type).

## 7. What T001 completion does NOT claim

Pilot/production key custody and physical Raspberry Pi certification stay
behind **BLK-005** (transport credentials fail closed by default);
the authenticated Hub-to-cloud service identity stays **BLK-006**; the
development staff-session lifetime (30 min, clamped by
`offline_valid_until`) remains PROVISIONAL pending an owner session-policy
value; the T2 display routes remain permission-less and fail-closed. No
Booking, customer-identity or consent work was begun.

## 8. Next task

**WS-12-T002 — Customer Identity, Consent and Booking Draft.** NOT
STARTED. Its named dependencies from the T001 handoff are now discharged
(routes served, permission keys canonical, mDNS listener real, identity
writer real).
