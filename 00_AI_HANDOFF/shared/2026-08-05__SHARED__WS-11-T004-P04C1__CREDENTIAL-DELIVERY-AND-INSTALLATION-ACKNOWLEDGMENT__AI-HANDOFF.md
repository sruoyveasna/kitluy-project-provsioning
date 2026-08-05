# WS-11-T004-P04C1 — CREDENTIAL DELIVERY, HUB PROJECTION AND INSTALLATION ACKNOWLEDGMENT — AI HANDOFF

| Field      | Value                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Date       | 2026-08-05                                                                                             |
| Package    | WS-11-T004-P04C1 (terminal credential delivery / Hub projection / installation acknowledgment)         |
| Status     | **IMPLEMENTED-IN-DEV** — capability-census row 28 moves NOT STARTED → IMPLEMENTED-IN-DEV (development) |
| Start SHA  | `5711466` (feat(ws-11): add LAN activation and pairing transport)                                      |
| Toolchain  | Node v22.23.0 (kitluy-toolchain), pnpm 9.15.9, engine-strict=true                                      |
| Migrations | **Hub 0033 CREATED** (credential projection door + append-only evidence). **Cloud 0176 NOT created.**  |

## 0. Starting-state correction (read this first)

The P04C package instruction expected `HEAD = 70056cb` and named P04B1/P04B2/P04B3
as packages 1–3. **They were already delivered** by the preceding session as ONE
commit `5711466` (`feat(ws-11): add LAN activation and pairing transport`) with
its own handoff. The change is explained by git history and that handoff — it is
not an unexplained repository change — so this session verified its coverage
against the P04B1/B2/B3 requirement lists and proceeded to P04C rather than
re-implementing shipped work. Coverage confirmed: mTLS 7443 `/edge/v1` transport,
lifecycle matrix, signed `_kitluy-edge._tcp.local` discovery (30 s / 90 s), LAN
activation routes, LAN pairing routes, Hub 0032's 300-second clamp. The one
P04B gap it recorded (the authenticated Hub→cloud activation bridge, BLK-006)
remains open and is NOT closed here.

## 1. What was actually missing (§15 classification, done first)

P04A **already returns the issued public credential to the terminal at
redemption**, so nothing here redelivers or reissues it — that would be a second
issuance authority. Classifying the existing facts left four gaps, and this
package closes three of them:

| Fact                            | Before P04C1                    | After                              |
| ------------------------------- | ------------------------------- | ---------------------------------- |
| 1. Issuance                     | cloud 0171/0120/0123            | unchanged — NOT touched            |
| 2. Terminal verifies + installs | no governed package contract    | **`credential-package.ts`**        |
| 3. Hub projection               | **nothing wrote it** (row 28)   | **Hub 0033 + signed delivery**     |
| 4. Installation acknowledgment  | 0174 `kitluy.activation-ack.v1` | **REUSED** — no second ack created |

Facts 5 (activation) and 6 (pairing) are later still and nothing here advances
them; the suite proves that explicitly.

## 2. The terminal-side verifier (§16)

`packages/device-identity/src/credential-package.ts` — domain
`kitluy.terminal-credential-package.v1`, fixed field order (a re-serialized
package cannot verify differently), the device certificate bound by its
**canonical TBS bytes** rather than a JSON rendering, so the package signature
covers the very structure the chain verifier then checks.

The package vocabulary is public material only: certificate + chain, credential
id, serial, public-key fingerprint, environment, issued/expires, terminal and
assignment references, signed authority metadata. **There is deliberately no
field a private key could occupy**, and `assertNoPrivateKeyMaterial` walks the
whole delivered value (cycle-safe) so a future adapter that attached one gets a
refusal rather than a durable secret. The private key is generated on the
terminal and never enters a package, a delivery, JSON or SQLite.

Verification order is the contract: version → private material → authority
signature → chain to the terminal's OWN anchor set → the certificate is the one
the package describes → **the fingerprint is RECOMPUTED from the delivered public
key** (a claimed fingerprint is never trusted) → the key is THIS terminal's key →
terminal/assignment/scope/environment → the window, judged against the caller's
TRUSTED instant (device trusted time — never a host clock and never the Hub's
clock; those are separate authorities by design).

On success the verdict yields an `InstallableCredential` that is deliberately
NARROWER than the package: exactly the fields the group-0174 acknowledgment
binds, so a terminal cannot acknowledge one credential and install another.

## 3. The Hub projection (Hub migration 0033)

The delivery arrives through the **existing** signed cloud-to-Hub authority —
`edge_sync.inbox` + `acceptCloudMessage`/`recordInboxApplied` (WS-10-T006,
offline §8: persist, verify, then apply) — under the new message type
`device.terminal_credential_projected` schema version 1.
`services/kitluy-hub-agent/src/hub/sync/credential-projection.ts` parses the
closed payload vocabulary, refuses a payload whose scope contradicts its own
envelope, and hands the facts to the governed door.

`edge_identity.project_terminal_credential_v1` (SECURITY DEFINER, owned by the
NOLOGIN granted-to-nobody `kitluy_credential_projection_governor`, 0024 RV-001
pattern) refuses rather than reconciles:

- a terminal this Hub does not hold, or one in another Tenant/Store/Location;
- a scope that is not this Hub's own active assignment scope;
- a credential already bound to a DIFFERENT device;
- a serial or fingerprint contradicting what is already projected;
- a serial already projected under another credential id;
- **a status downgrade** — once told revoked/superseded/expired/retired, no
  later, replayed or REORDERED delivery restores `active`;
- a rotation-generation or assignment-generation regression.

**Idempotence is keyed on the DELIVERY**, `(credential_id, delivery_message_id)`,
and the replay lookup answers BEFORE validation — re-validating a
retransmission could refuse today what was legitimately accepted yesterday and
would rewrite history as a side effect. A genuinely NEW message carrying
identical facts is recorded as a second projection row (being told twice is
itself a fact) but still converges on ONE credential.

`edge_identity.credential_projection` is append-only evidence; the runtime holds
SELECT and EXECUTE and **no INSERT/UPDATE/DELETE on it at all**, asserted by the
migration guard.

**The Hub cannot author credential identity.** The projection's chain is
deliberately NOT sent to the Hub: the Hub authorizes against credential identity
and status, and holding a device certificate would invite it to start deciding
certificate validity itself.

## 4. The installation acknowledgment — reused, not duplicated

Group 0174's `kitluy.activation-ack.v1` payload **already binds** certificateId,
certificateSerial, certificateFingerprint, terminal, assignment, profile, Hub,
environment, provisioning code row, PoP challenge, enrolled-key fingerprint,
nonce and window. §16 says to reuse it where it already proves these facts, and
it does — so **no synonymous second acknowledgment was created**. Scenario E
proves the binding is exact by mutating each of six fields and showing the
original signature no longer verifies, and proves the two domains are disjoint so
a package signature can never be replayed as an installation acknowledgment.

## 5. Focused tests (zero skips)

**`services/kitluy-hub-agent/test/credential-delivery.integration.test.ts` —
12/12**, real Hub database, real `@kitluy/device-identity` crypto and a real
development CA chain:

| Scenario | Proven                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | a valid package verifies and yields exactly what may be installed; forged/unknown authority, contradicted serial, lying fingerprint, another terminal's key, wrong assignment, wrong scope, untrusted anchor, expired window and unknown version each refuse with their own code                                                                                  |
| B        | private material anywhere fails the package BEFORE anything else, and the delivery parser refuses it before a single fact is read                                                                                                                                                                                                                                 |
| C        | one signed delivery projects one credential and moves the registration pointer; the SAME message replays to `duplicate_ignored`; a NEW message with the same facts leaves a second evidence row and still ONE credential; an unverifiable delivery is durably rejected and applies nothing; cross-scope, cross-terminal and contradicted-serial deliveries refuse |
| D        | a revoked projection cannot be restored to active by a replayed OR reordered delivery; superseded behaves identically                                                                                                                                                                                                                                             |
| E        | the group-0174 acknowledgment binds the exact credential (six mutations each break the signature); no second synonymous acknowledgment authority exists                                                                                                                                                                                                           |
| F        | a projected credential does NOT activate and does NOT pair the terminal — the facts stay distinct                                                                                                                                                                                                                                                                 |
| G        | no private key, certificate body or secret in the inbox payload, the evidence ledger or the logs; the ledger is append-only and runtime-unwritable                                                                                                                                                                                                                |

**`packages/device-identity/test/credential-package.test.ts` — 10/10**:
canonical byte ordering and domain separation, chain-swap sensitivity, authority
refusals, another terminal's key, recomputed fingerprint, untrusted anchor,
window judged against the caller's trusted instant (including a package that
tries to STRETCH a credential's window), private-material refusal across four PEM
label forms plus a cyclic payload, projection facts derived from the package, and
the unsupported-version refusal.

## 6. Verification (fast package gate)

| Command                                                                  | Exit | Result                   |
| ------------------------------------------------------------------------ | ---- | ------------------------ |
| `pnpm hub:db:apply` (0033)                                               | 0    | applied; guard NOTICE    |
| new hub credential-delivery suite                                        | 0    | **12/12**, zero skips    |
| new device-identity credential-package suite                             | 0    | **10/10**, zero skips    |
| hub regression: pairing 19, LAN 8, sync-inbox 15 (+ the new 12)          | 0    | **54/54**                |
| device-identity regression: pairing 27, activation-ack 27, PoP 22 (+ 10) | 0    | **86/86**                |
| `typecheck` (device-identity, hub-agent)                                 | 0    | clean                    |
| `npx eslint` / `npx prettier` on changed files                           | 0    | clean                    |
| `pnpm secret:scan`                                                       | 0    | 1334 tracked files clean |

Full `pnpm verify`, cloud `db:test`/`test:rls` and the Hub reset-from-zero are
deliberately deferred to the T004 closeout, per the package gate. No cloud
migration was created and no cloud code changed.

## 7. Migration decisions

- **Hub 0033 CREATED** — the projection is a DATABASE property: idempotence keyed
  on the delivery, forward-only status and the identity refusals must hold under
  concurrent and reordered deliveries, which no application-layer check can
  guarantee. New governor role `kitluy_credential_projection_governor`.
- **Cloud 0176 NOT created** — nothing in this package needed a cloud contract,
  function or grant. The cloud PRODUCER of the delivery is not built here (see §8).
- **Recorded, not changed** (inherited from 0032's finding): `kitluy_hub_runtime`
  still holds INSERT/UPDATE on `device_credential` and `terminal_device`
  directly, because it is the sync projection writer. This door is the AUTHORIZED
  credential-delivery path and the only one that records evidence; narrowing the
  runtime's raw projection-write surface remains the repository-wide
  machine-identity package 0032 recorded.

## 8. What this package does NOT claim

- **The cloud-side PRODUCER of the delivery is not built.** This package builds
  the Hub's governed CONSUMER, the terminal's verifier and the evidence. The
  cloud service that mints and signs `device.terminal_credential_projected`
  needs the Hub-facing signed-delivery service identity, which is **BLK-006**
  and does not exist. The Hub side is proven end-to-end against real signed
  deliveries with an injected verifier, exactly as the existing WS-10 inbox
  suites do.
- **No pilot or production readiness.** Every certificate is development-only
  and minted per test run; BLK-005 fail-closed is unchanged.
- Terminal-local receipt persistence (P04C2) and receipt replication (P04C3)
  are not started by this package.

## 9. Rollback

Revert the one commit, then `pnpm hub:db:reset` + seed to return the Hub
database to 0032. Reverting removes the projection door, the evidence ledger,
the governor role, the terminal-side package verifier and both suites; census
row 28 returns to NOT STARTED.
