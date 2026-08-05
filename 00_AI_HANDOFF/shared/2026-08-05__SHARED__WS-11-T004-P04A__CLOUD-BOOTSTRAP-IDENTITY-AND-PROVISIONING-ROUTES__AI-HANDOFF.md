# WS-11-T004-P04A — CLOUD BOOTSTRAP IDENTITY AND PROVISIONING ROUTES — AI HANDOFF

| Field     | Value                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-08-05                                                                                                                         |
| Package   | WS-11-T004-P04A (cloud bootstrap identity and terminal provisioning routes)                                                        |
| Status    | **IMPLEMENTED-IN-DEV — CLOUD BOOTSTRAP ROUTES / NO MIGRATION REQUIRED**                                                            |
| Start SHA | `b33a168` (test(ws-11): prove pairing restart recovery)                                                                            |
| End SHA   | recorded by `git log -1` after the package commit (decision + implementation + evidence in ONE)                                    |
| Toolchain | Node v22.23.0 (project-external kitluy-toolchain), pnpm 9.15.9, engine-strict=true                                                 |
| Migration | **NONE.** Cloud 0175 left free — the three routes compose the existing eight-capability composer                                   |
| Decision  | `docs/decisions/kitluy-terminal-transport-and-pairing-completion-owner-decision-v1.0.0.md` (KLD-2026-08-05-TERMINAL-TRANSPORT-001) |

## 1. What this package is

The versioned cloud bootstrap transport for terminal provisioning: three
routes on the device-registry service that compose the SEVEN proven
capabilities (code presentation → PoP challenge → authoritative context →
Ed25519 verification → verified-proof recording → atomic redemption/binding →
ambiguous-response reconciliation) behind the P02C/P02C1 composition layer.
No second provisioning service exists: the routes call
`TerminalProvisioningComposition` and nothing else, and every database
transaction still enters NOLOGIN `kitluy_provisioning_service` explicitly
(0172/0173).

**Bootstrap authentication (owner decision §1):** TLS 1.3 with normal cloud
server-certificate validation (deployment concern; no key material in code);
the terminal's authoritative manufacturing-enrollment key as the only
pre-credential identity, proven by Ed25519 over the server-issued 0170
challenge; the one-time provisioning code as assignment authorization — not
identity — re-presented at redemption. No cookie, staff session, shared
terminal secret or Supabase key; the terminal never receives database
credentials; after issuance the bootstrap identity reaches nothing but these
three routes.

## 2. Route contract (as shipped)

| Route                                                            | Success                        | Handler                        |
| ---------------------------------------------------------------- | ------------------------------ | ------------------------------ |
| `POST /v1/terminal-provisioning/challenges`                      | 201 `CHALLENGE_ISSUED`         | `presentCodeAndIssueChallenge` |
| `POST /v1/terminal-provisioning/challenges/{challengeId}/verify` | 200 `PROOF_VERIFIED` / already | `verifyProofAndRecord`         |
| `POST /v1/terminal-provisioning/redemptions`                     | 201 `REDEEMED` / 200 replayed  | `redeemProvisioning`           |

Inputs (whitelist; unknown fields refused BY NAME, never ignored):

- challenges: `terminalAssignmentId` (uuid), `provisioningCode` (8-char
  Crockford), `enrollmentKeyFingerprint` (64-hex; the manufacturing-enrollment
  key reference, also the rate-limit key component);
- verify: challenge id in the PATH, `protocolVersion` (must equal
  `kitluy.provisioning-pop.v1`), `signature` (UNPADDED base64url, ≤120 chars;
  converted to standard base64 for the composition), `terminalPublicKeyPem`
  (bounded, must carry BEGIN/END PUBLIC KEY);
- redemptions: `terminalAssignmentId`, `provisioningCode` (re-presented),
  `challengeId`; the redemption idempotency key is the `Idempotency-Key`
  HEADER, handed to the governed 0171 door which owns replay reconciliation.

Headers: `Content-Type: application/json` required; `Idempotency-Key`
required on every route (label-only on challenges/verify — the doors already
reconcile replays); `X-Correlation-ID` optional, UUID-validated, regenerated
when absent/malformed, label only. Request maximum 16 KiB, enforced in the
route layer on raw bytes (transport keeps its own 64 KiB outer bound).

The caller can never supply Tenant, Store, Location, Hub, profile,
environment, terminal state, credential id or any timestamp — none is in any
whitelist, and scenario E proves each is refused by name. Responses carry the
composition's approved material only: challenge material without digests or
scope identifiers; non-authoritative verification status; public credential
material with the server-derived serial. A successful redemption makes no
delivery/activation/pairing/connectivity/sync claim (asserted by word census).

## 3. Rate limiting (owner decision §2)

`BootstrapRateLimiter`: token bucket (burst 3, one token per 6 s) AND a hard
10-per-minute window, per key `sourceIp|fingerprint`. Source IP is the
transport-observed peer address; forwarded-for headers are never consulted.
Fingerprint component: caller-declared on challenges, derived from the
submitted PEM on verify, absent on redemptions (that input contract carries
no key material). Malformed attempts count — the limiter is consulted on
content-type, size and JSON-shape refusals too (keyed without fingerprint).
Raw code and signature are never keys. Refusal is canonical `RATE_LIMITED`
429 with `Retry-After`. The limiter is in-process per instance with an
injectable clock; a shared production store is a BLK-006 deployment value,
recorded not invented.

## 4. Safe error mapping

One TOTAL map (`Record<ProvisioningResultCode, KitluyErrorCode>` — a new
composition result fails typecheck rather than escaping unmapped) onto the
canonical `@kitluy/api-errors` envelope, status from `httpStatusFor`:

- REQUEST_INVALID → VALIDATION_FAILED 422 (invalid request, oversize, content
  type, malformed UUID/code/signature, unknown fields, idempotency-key
  missing/conflicting/malformed);
- rate limited → RATE_LIMITED 429 (+ Retry-After);
- CODE_INVALID / CODE_LOCKED / CODE_EXPIRED / CODE_REVOKED / CODE_REDEEMED /
  PROOF_INVALID / PROOF_BINDING_MISMATCH / ASSIGNMENT_INACTIVE / HUB_INACTIVE
  / ENROLLMENT_INELIGIBLE → SCOPE_PERMISSION_DENIED 403 (specific outcome in
  `details.result`; the 0164 missing/inactive-assignment merge is preserved so
  no row-existence oracle appears);
- CODE_ALREADY_PROVEN / CHALLENGE_EXPIRED / CREDENTIAL_CONFLICT →
  RESOURCE_VERSION_CONFLICT 409; CHALLENGE_NOT_FOUND → RESOURCE_NOT_FOUND 404;
- IDEMPOTENCY_CONFLICT → IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST 409;
- PKI_UNAVAILABLE (BLK-005 pilot/production fail-closed; missing trusted
  time) → DEPENDENCY_UNAVAILABLE 503; retryable infrastructure/unexpected →
  INTERNAL_ERROR 500 (same-idempotency-key retry contract).

No SQLSTATE, function/schema/role name, digest detail or expected signature
byte can appear: the routes consume only the composition's closed vocabulary.
Fixed message text per canonical code; caller values are never echoed except
bounded offending FIELD NAMES (revocation-surface precedent).

**One composition repair (in-scope §6):** `mapRefusal` now maps the 0172
context reader's `KLUY-POPCTX-NOT-FOUND` (exact code, no family widening) to
`CHALLENGE_NOT_FOUND`. Before this, verifying against a ghost challenge id
surfaced as INTERNAL_ERROR 500 instead of a safe 404 — a pre-existing P02C
mapping gap no earlier suite probed.

## 5. Composition-role behavior

Unchanged and re-proven at the route package (scenario G): the routes succeed
only through the composition's explicit `SET LOCAL ROLE
kitluy_provisioning_service`; `service_role` holds no effective privilege on
any of the five provisioning doors and a REAL call is 42501; the composer has
zero table reach; after both COMMIT and ROLLBACK a one-connection pool comes
back as the connecting identity with nothing retained. No grant, role or
migration was added — which is why cloud 0175 stays free.

## 6. Files changed (complete list)

1. `docs/decisions/kitluy-terminal-transport-and-pairing-completion-owner-decision-v1.0.0.md` — new (KLD-2026-08-05-TERMINAL-TRANSPORT-001).
2. `services/kitluy-device-registry-service/src/provisioning-routes.ts` — new (router, limiter, canonical mapping).
3. `services/kitluy-device-registry-service/src/http.ts` — bootstrap prefix dispatched before `/v1/`, fail-closed 503 when unconfigured; `KernelRequest`/`KernelResponse` carry rawBody/sourceIp/headers additively.
4. `services/kitluy-device-registry-service/src/main.ts` — raw-body pass-through for the bootstrap prefix (its shape refusals must count toward its limiter), socket peer address, router wiring over the same pool, Retry-After propagation.
5. `services/kitluy-device-registry-service/src/provisioning-composition.ts` — the one-line `KLUY-POPCTX-NOT-FOUND` mapping repair (§4).
6. `services/kitluy-device-registry-service/test/provisioning-routes.integration.test.ts` — new, 12 tests, zero skips.
7. This handoff; `000_INDEX.md` row; T004 census row-22/23 movement; decision
   register + open-values register sections; dated P03C dependency note.

## 7. Focused tests (real local database, ephemeral Ed25519 keys)

`provisioning-routes.integration.test.ts` — **12/12, zero skips** (scenarios
A–H per the package):

| Scenario | Proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | full bootstrap over the routes: 201 challenge (v1 protocol, 64-hex nonce, no digest/tenant/store/code echo) → real proof 200 → redemption 201 with server-derived serial bound to the enrolled key; code `redeemed`; no raw code/private material/activation-delivery-pairing-sync words                                                                                                                                                                                                                                                                      |
| B        | four wrong codes = governed 403 `CODE_INVALID`; fifth locks (`CODE_LOCKED`); correct code still locked; zero challenges, zero credentials                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C        | transplanted signature (another terminal's genuine key) AND garbage both 403 `PROOF_INVALID`; challenge stays `issued`; redemption refused; zero credentials                                                                                                                                                                                                                                                                                                                                                                                                  |
| D        | discarded response + same-key retry → 200 `REDEMPTION_REPLAYED`, identical certificate id and redeemedAt, exactly one active credential; changed input under the same key → 409 canonical conflict                                                                                                                                                                                                                                                                                                                                                            |
| E        | ghost assignment 403 with the merged `ASSIGNMENT_INACTIVE` (no existence oracle), no tenant/store/location/code echo, zero mutation residue; ghost challenge 404; nine caller-supplied scope/state/timestamp fields each refused by name                                                                                                                                                                                                                                                                                                                      |
| F        | pilot AND production `issue_device_certificate_v1` raise P0001 (BLK-005); zero pilot/production certificates exist; and a post-proof redemption failure (governed Hub withdrawal) leaves proof `verified`-unconsumed, code `issued`, zero credentials                                                                                                                                                                                                                                                                                                         |
| G        | composer boundary at the route package: service_role five-door effective privilege false + real 42501; composer zero table reach; role state dies with COMMIT and ROLLBACK on a one-connection pool                                                                                                                                                                                                                                                                                                                                                           |
| H1–H4    | oversize (>16 KiB), wrong/missing content type, malformed JSON, array body, wrong method 405, unknown route 404, malformed path id 404; malformed UUID/code/fingerprint/signature (padded, wrong charset, oversized, empty)/protocol version/PEM/unknown fields all 422 with named fields; idempotency key missing/conflicting/malformed/oversized 422 with identical-duplicates NOT a conflict; rate limit — burst 3 then 429+Retry-After, refill after 6 s, exactly 10 per minute window then 429, independent keys unaffected, malformed attempts counting |
| census   | no raw code, signature, nonce, fingerprint-shaped secret or key material in any captured log line across the whole suite (structural redaction held)                                                                                                                                                                                                                                                                                                                                                                                                          |

## 8. Verification (fast gate per package §8 — full `pnpm verify` deliberately NOT run; it runs once after P04C)

| Command                                                                     | Exit | Result                                                             |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| new route suite                                                             | 0    | **12/12, zero skips**                                              |
| affected neighbors: composition, activation, http, PoP, redemption (serial) | 0    | **56/56** — the `mapRefusal` and `http.ts` edits regressed nothing |
| `pnpm --filter kitluy-device-registry-service typecheck`                    | 0    | clean                                                              |
| `npx eslint` on the five changed TS files                                   | 0    | clean                                                              |
| `npx prettier --check` on all changed files                                 | 0    | clean                                                              |
| `pnpm secret:scan`                                                          | 0    | 1319 tracked files clean                                           |
| diff inspection                                                             | —    | only the files in §6                                               |

Database state: the P03C closeout state (cloud 0000→0174 applied, db:test
fixtures present) — no reset was required because no migration was created.

## 9. Environment posture

Development bootstraps end-to-end through the approved provisional PKI.
Pilot and production remain fail-closed under BLK-005 inside
`assert_pki_configuration_approved` — re-proven (scenario F), zero
pilot/production certificates exist. A route-level pilot bootstrap CANNOT be
exercised even in test, because BLK-005 blocks pilot Hub activation upstream
of any assignment — that is the fail-closed design working, not a test gap;
the gate itself plus post-proof-failure residue-freeness are what F proves.

## 10. Remaining gaps → P04B / P04C

- **Terminal-side canonical-payload acquisition:** the challenge response
  carries the composition's approved material only (no tenant/store/location/
  hub/code-row identifiers), so a REAL terminal cannot yet reconstruct the
  `kitluy.provisioning-pop.v1` signing bytes from the response alone — the
  suites sign from authoritative rows exactly as every prior suite did. The
  terminal-client contract for obtaining/holding those facts is P04B scope;
  widening the response here would have violated §5.2.
- Store Hub credential delivery (#28), activation transport, LAN mTLS +
  signed discovery, pairing routes, terminal receipt persistence (34/35
  terminal side) — P04B/P04C per the owner decision.
- Shared (multi-instance) rate-limiter store; production TLS/domain values —
  BLK-006.
- `[REQUIRED: pairing_challenge_lifetime]` — still open (P03C).
- The correlation-header divergence (`X-Correlation-ID` here vs
  `x-kitluy-correlation-id` on the revocation surface) is RECORDED in the
  decision register; unifying the older surface needs its own package.

**WS-11-T004 is NOT complete** — this package moves census row 22 only.

## 11. Rollback

One commit: revert it. No migration, no role, no grant — the routes, wiring,
tests, decision record and register rows vanish with the revert; migrations
0000–0174 and the Hub are untouched. Reverting also removes the
`KLUY-POPCTX-NOT-FOUND` mapping repair (ghost-challenge verifies would again
answer 500).

## 12. Next package

**WS-11-T004-P04B** — terminal-side transport (canonical-payload
acquisition, activation transport) and the LAN pairing surface per the owner
decision's excluded list.
