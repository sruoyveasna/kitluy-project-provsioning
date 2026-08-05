# WS-11-T004-P04B — LAN mTLS, SIGNED DISCOVERY, ACTIVATION AND PAIRING ROUTES — AI HANDOFF

| Field      | Value                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-05                                                                                                                                             |
| Package    | WS-11-T004-P04B (LAN mTLS transport, signed discovery, activation and pairing routes)                                                                  |
| Status     | **PARTIAL — CLOUD ACTIVATION BRIDGE REQUIRED** (transport, discovery and pairing are IMPLEMENTED-IN-DEV)                                               |
| Start SHA  | `70056cb` (fix(ws-11): expose terminal-signable provisioning challenge)                                                                                |
| End SHA    | recorded by `git log -1` after the package commit (one atomic commit)                                                                                  |
| Toolchain  | Node v22.23.0 (kitluy-toolchain), pnpm 9.15.9, engine-strict=true                                                                                      |
| Migrations | **Hub 0032 CREATED** (locked 300 s pairing lifetime + transport read assertion). **Cloud 0176 NOT created** — no cloud contract or grant was required. |

## 1. Transport implementation (§3, locked)

`services/kitluy-hub-agent/src/hub/edge/transport.ts` — HTTPS over HTTP/1.1
and JSON; **TLS 1.3 pinned at both `minVersion` and `maxVersion`** (a
downgrade dies in OpenSSL, before a request exists); **mandatory client
certificate** via `requestCert` + `rejectUnauthorized` (an uncertified or
unknown-CA peer dies in the handshake, never in a handler); TCP **7443** by
default (tests bind an ephemeral port); **wildcard binds are REFUSED at
construction** — `0.0.0.0`, `::` and `*` throw
`KLUY-EDGE-TRANSPORT-BIND-REFUSED`, so "no public WAN ingress" is structural
rather than documentary. Bodies are bounded at 64 KiB. Binary values on the
wire are unpadded base64url throughout; the compositions keep standard
base64 internally and the routes translate at the boundary.

**What the handshake proves and what it does not:** a completed handshake
proves only that the peer holds the private key of a CA-chained certificate.
The transport therefore hands the router the OBSERVED peer identity
(normalized serial + certificate SHA-256) — never a decision.

## 2. TLS certificate validation and the per-request gate (§3)

Every request maps the peer's certificate SERIAL onto the projected
`edge_identity.terminal_device` and its `device_credential`, then applies the
lifecycle matrix; the governed doors re-derive scope, profile, generation,
Hub trust, both credentials and offline-snapshot revocation again inside
their own transactions. Certificate validity alone opens nothing.

| Terminal state                             | Allowed                                  |
| ------------------------------------------ | ---------------------------------------- |
| credential issued, projection not `active` | activation routes only                   |
| `active` (activation projected), unpaired  | activation replay + pairing              |
| paired                                     | pairing replay + receipt reconciliation  |
| revoked / expired / retired / unrecognized | denied (merged families — no row oracle) |

A session route additionally requires the authenticated terminal to OWN the
session it names (`SESSION_NOT_OWNED`), so another terminal's valid
certificate opens nothing. Unknown-serial and ineligible-credential peers
answer with merged families, so the LAN carries no existence oracle.

## 3. Signed discovery (§4)

`packages/device-identity/src/edge-discovery.ts` (canonical bytes + verifier,
domain `kitluy.edge-discovery.v1`) and
`services/kitluy-hub-agent/src/hub/edge/discovery.ts` (minting, cadence).
Advertised as `_kitluy-edge._tcp.local`; served at
`GET /.well-known/kitluy-edge-discovery/v1` over the mTLS transport. The
record binds protocol version, record id, Hub UUID, **Hub TLS certificate
fingerprint**, Tenant, Digital Store, Location, environment, hostname, port
7443, issued-at and expires-at, signed by the Hub's existing operational key
authority (the same signer the pairing receipt uses). **Refresh 30 s,
validity 90 s**, both locked and asserted.

**mDNS never establishes trust**: the multicast announcement carries only the
service type, instance name, port and the record id — no scope, no
fingerprint, no signature — and the verifier consumes only signed records, so
no code path leads from an announcement to a verdict. The terminal verifies
the record BEFORE connecting, and because the record pins the Hub TLS
certificate fingerprint, a verified record pins the very handshake that
follows (the suite pins it in `checkServerIdentity` and proves an impostor
Hub with a CA-valid certificate is refused). Neither the signature body nor
the record payload is logged.

## 4. Activation authority boundary (§5) — why this package is PARTIAL

Activation truth stays in the P03A CLOUD authority; no second activation
source of truth exists on the Hub. The Hub is an authenticated LAN gateway:
`POST /edge/v1/terminal-activation/challenges` and
`POST /edge/v1/terminal-activation/complete` compose the cloud through the
`CloudActivationGateway` port. The Hub holds **no cloud database
credentials** — a production gateway speaks HTTPS to the cloud
device-registry service under the Hub's own service identity, whose
authentication values are **BLK-006 and do not exist**. The shipped default
is `unavailableActivationGateway()`: every call reports the cloud
unreachable, which the routes surface as a **retryable** `HUB_UNREACHABLE`
503 (`details.retryable = true`). **That missing bridge is why the package
status is PARTIAL — CLOUD ACTIVATION BRIDGE REQUIRED.**

The challenge response carries the P04A1 contract applied to activation:
`signatureAlgorithm: "ed25519"`, `signingPayloadEncoding: "base64url"` and an
opaque `signingPayload` — the exact canonical `kitluy.activation-ack.v1`
bytes. **Cloud-side change:** `TerminalActivationComposition.prepareActivation`
now builds that payload from the 0174 context reader in the SAME transaction
that prepared the challenge (the completion path still reconstructs
independently and never trusts caller bytes); a prepare replay reuses the
outstanding challenge, so the payload is byte-stable. The Hub persists **no
new activation row** — the lifecycle matrix reads the existing
`terminal_device.lifecycle_status` projection and the code labels it exactly
that: a projection of cloud activation truth, authored by the (still unbuilt)
cloud→Hub delivery path (#28), never by the Hub.

## 5. Pairing transport (§6) and the 300-second lock

`POST /edge/v1/terminal-pairing/sessions`, `.../{id}/terminal-proof`,
`.../{id}/complete`, `GET .../{id}/receipt` compose the proven P03B/P03C
`TerminalPairingComposition` — no pairing logic is recreated. The session
response carries the same opaque `signingPayload` (the exact canonical
terminal-proof bytes), so the terminal signs bytes it never rebuilds. The
terminal device id comes from the AUTHENTICATED certificate, never a body
field.

**Hub migration 0032** replaces `begin_terminal_pairing_v1` (0031's file
untouched, standard governor ownership borrow) to clamp the stored expiry to
`now() + interval '300 seconds'` of **Hub-authoritative** time: the caller may
shorten the window, nothing can lengthen it, and no skew grace exists because
the clamp is computed inside the door. Every inherited refusal, the
credential caps, the same-hello replay (which returns the existing session
with its ORIGINAL expiry — retry extends nothing), consumed-nonce death and
the one-live-handshake invariant are preserved and asserted by the guard.

**A real defect this package's own tests caught and fixed:** an earlier draft
of 0032 dropped the inherited
`perform edge_identity.assert_pairing_prerequisites_v1(v_session)` call, so a
wrong-profile hello opened a session it must never have opened (scenario C
and F both failed). The call is restored and the guard now asserts it
structurally, so the regression cannot recur silently.

## 6. Offline behavior (§6/§7-F)

Pairing consumes only `kitluy_hub_local`: with the cloud gateway forced
unavailable for the whole scenario, a previously activated eligible terminal
opens a session, proves, completes and receives its receipt — pairing never
waits for cloud acknowledgement — while activation, which genuinely needs the
cloud authority, returns the retryable 503. Stale authorization fails closed
under the existing governed policy: a profile grant disabled in the ACTIVE
projection refuses `PAIR_PROFILE_FORBIDDEN` and is never presented as current
cloud truth.

## 7. Focused tests (zero skips)

**`services/kitluy-hub-agent/test/edge-lan.integration.test.ts` — 8/8**, real
TLS 1.3 sockets, ephemeral per-run X.509 (node-forge), real Hub database, real
`@kitluy/device-identity` crypto on both sides:

| Scenario | Proven                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | TLS 1.3 succeeds (protocol asserted); no client certificate fails; unknown-CA certificate fails; TLS 1.2 fails; plain HTTP fails; a CA-valid but WRONG Hub certificate is refused by the terminal's pin; wildcard bind refused at construction                                                       |
| B        | the well-known record verifies under the Hub key with the TLS fingerprint it pins; altered hub id / scope / port / fingerprint and an expired window all fail                                                                                                                                        |
| C        | pre-activation → activation only, pairing refused `ACTIVATION_REQUIRED`; revoked and expired credentials refused `CREDENTIAL_NOT_CURRENT`; an unknown CA-valid peer refused `TERMINAL_NOT_RECOGNIZED`; wrong profile refused `PAIR_PROFILE_FORBIDDEN`; a foreign session refused `SESSION_NOT_OWNED` |
| D        | black-box activation: mTLS → public signing payload → sign those bytes → activated; challenge retry byte-identical; completion retry returns the ORIGINAL instants; a transplanted signature refuses; cloud loss is a retryable 503; the shipped default gateway fails closed                        |
| E        | one session, mutual proofs (the terminal verifies the HUB's proof), one receipt, completion replay and receipt fetch return the original, consumed nonce dead, session retry byte-identical with unchanged expiry, and the 300 s lock measured at both route and door                                |
| E2       | an expired session cannot resume, whatever payload the terminal retained (`PAIR_CHALLENGE_EXPIRED`)                                                                                                                                                                                                  |
| F        | pairing completes end-to-end with the cloud DOWN; activation stays retryable; stale grant fails closed                                                                                                                                                                                               |
| G        | log census: no key, code, nonce, payload, signature, certificate body or 64-hex secret in any line; terminals hold no database identity                                                                                                                                                              |

**`services/kitluy-hub-agent/test/edge-discovery.test.ts` — 6/6**: validity
window, every tamper class, expiry, refresh re-signing without identity
change, the unsigned hint carrying nothing, and the 30-second cadence.

**Cloud side**: `terminal-activation.integration.test.ts` 9 → **10/10** (new
P04B case: signable payload, byte identity with the server reconstruction,
byte-stable prepare replay, black-box signing, `ALREADY_ACTIVATED` after).

## 8. Verification (fast package gate)

| Command                                                                                          | Exit | Result                                                       |
| ------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------ |
| `pnpm hub:db:reset` (0000→**0032**) + seed + `hub:db:test`                                       | 0    | 33 applied; 0032 guard NOTICE; **37 PASS** (= baseline)      |
| new LAN suite / new discovery suite                                                              | 0    | **8/8** and **6/6**, zero skips                              |
| hub-agent pairing regression (P03B/P03C)                                                         | 0    | **19/19** (33 with the two new suites)                       |
| cloud regression: activation, P04A routes, terminal contract, composition, PoP, redemption, http | 0    | **76/76**                                                    |
| device-identity crypto (pairing, activation-ack, provisioning-pop)                               | 0    | **76/76**                                                    |
| `typecheck` (device-identity, registry service, hub-agent)                                       | 0    | clean                                                        |
| `npx eslint` / `npx prettier --check` on changed files                                           | 0    | clean                                                        |
| `pnpm secret:scan`                                                                               | 0    | 1326 tracked files clean                                     |
| `pnpm hub:db:validate`                                                                           | 1    | the **pre-existing** 0028–0030 marker debt only; 0032 PASSES |

Cloud `db:test`/`test:rls` were not re-run: no cloud migration was created
and the only cloud change is the composition's added payload field, covered
by the 10/10 activation suite. Full `pnpm verify` and the T004 closeout are
deliberately deferred to after P04C.

## 9. Migration decisions

- **Hub 0032 CREATED** — the locked 300-second lifetime is a DATABASE
  property (Hub-authoritative time, no skew grace, retry cannot extend), which
  no route-layer value can guarantee; the guard also asserts the transport's
  authorization reads and the restored prerequisite call.
- **Hub transport reads: MEASURED, NOT GRANTED.** `kitluy_hub_runtime`
  already held SELECT (and INSERT/UPDATE — it is the sync projection writer)
  on `terminal_device` and `device_credential`; a first draft tried to grant
  and to assert "no mutation", which failed on apply and would have been a
  false claim. 0032 asserts the read posture instead. **Recorded, not
  changed:** the LAN gate runs as an identity that CAN write those
  projections. Narrowing the runtime's projection-write surface is a
  repository-wide machine-identity question (the same class as the recorded
  `kitluy_issuance_service`/`kitluy_worker_service` finding) and belongs to
  its own package.
- **Cloud 0176 NOT created** — nothing in this package needed a cloud
  contract, function or grant.
- **Dependency added:** `node-forge` + `@types/node-forge` as hub-agent
  devDependencies through the workspace catalog, for ephemeral test X.509 only
  (both already present in the lockfile as transitive packages). No production
  dependency changed.

## 10. Remaining P04C dependencies

- **The authenticated Hub-to-cloud activation bridge** (BLK-006 service
  identity values) — the shipped gateway fails closed until it exists;
- terminal-local receipt persistence and terminal restart recovery (census
  rows 34/35, terminal side) — explicitly P04C;
- pairing-receipt outbox publication + cloud ingestion (KLREQ-026 event
  vocabulary);
- Store Hub credential/config delivery (#28) — the projection this package's
  lifecycle matrix reads is written by that unbuilt path;
- production TLS/PKI material for pilot and production (BLK-005/BLK-006):
  every certificate here is development-only and minted per test run;
- the full manual-IP recovery UI and endpoint-cache persistence (this package
  implements the signed-discovery and route contracts, per §4).

**WS-11-T004 is NOT complete.**

## 11. Rollback

Revert the one commit, then `pnpm hub:db:reset` + seed + `hub:db:test` to
return the Hub database to 0031 (the reset replays from zero; the cloud
database is untouched by this package, though a cloud reset would as always
drop `kitluy_hub_local`). Reverting removes the LAN transport, discovery,
routes, both new suites, the activation payload field and the 300-second
clamp — pairing lifetime would return to caller-bounded with the
`[REQUIRED: pairing_challenge_lifetime]` placeholder.
