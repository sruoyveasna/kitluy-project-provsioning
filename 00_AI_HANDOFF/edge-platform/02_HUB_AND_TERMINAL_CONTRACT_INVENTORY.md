# Hub and terminal contract inventory

**Date:** 2026-08-07

---

## 1. The Hub LAN API — real, 30 routes

`services/kitluy-hub-agent` (155 TS files) serves `/edge/v1` over pinned
TLS 1.3. Routes present at intake:

**Runtime and bootstrap** — `/edge/v1/identity`, `/runtime/authority-time`,
`/runtime/eligibility`, `/configuration/current`, `/health`, `/sync/status`

**Terminal provisioning and health** — `/terminal-pairing/sessions`,
`/terminal-activation/challenges`, `/terminal-activation/complete`,
`/terminal-health/heartbeats`

**Staff sessions** — `/sessions/open|close|refresh|switch` (and the
`/laundry/*` vertical equivalents)

**T1 intake (WS-12)** — `/customers`, `/customers/search`,
`/bookings/drafts`, `/laundry/bookings/drafts`

**T2/T3/T4 surfaces** — `/display-sessions`, `/displays/sessions`,
`/ready-scan/sessions`, `/pickup-scan/sessions`, `/laundry/ready-sessions`,
`/laundry/pickup-sessions`, `/laundry/display-sessions`

Discovery is real: an mDNS `_kitluy-edge._tcp.local` listener with a locked
six-source endpoint resolution order, proven order-exact by WS-12-T001.

## 2. The cloud provisioning surface — real

`services/kitluy-device-registry-service` (79 TS files):

| Route                                                   | Purpose                        |
| ------------------------------------------------------- | ------------------------------ |
| `POST /v1/terminal-provisioning/challenges`             | issue a signable PoP challenge |
| `POST /v1/terminal-provisioning/challenges/{id}/verify` | verify Ed25519 PoP             |
| `POST /v1/terminal-provisioning/redemptions`            | redeem a provisioning code     |
| `/v1/device-credentials/revocations`                    | governed revocation            |
| `/v1/device-credentials/emergency-revocations`          | emergency revocation           |

**The authorisation model is the notable part.** These are pre-credential
routes: the caller's only authority is its sealed manufacturing-enrollment key
(proven by Ed25519 signature over a server-issued challenge) plus a one-time
provisioning code. A staff session, browser cookie or Supabase key on this
surface is a refusal. Tenant, Store, Location, Hub, environment, profile and
every timestamp are **server-derived** — the device may name _what_ it is asking
about, never _who_ is allowed or _where_ it belongs.

That is exactly the boundary the mission's §19–§20 asks for, already built.

## 3. The trust contract for the new agent

`@kitluy/device-identity` supplies the abstract PKI, attestation and signing
provider interfaces plus a fail-closed default (`UnconfiguredPkiProvider`
refuses every operation with an explicit required-value error). There is still
no CA, no key generation, no issuance and no signer — BLK-005 decision values
are ruled, implementation is pending.

`services/kitluy-device-firstboot-agent` was therefore built against
**interfaces**, not against a CA: `KeyProvider` and `ServerIdentityVerifier` are
injected. This keeps the agent testable today and lets the real providers drop
in when BLK-005 implementation lands, without the agent pretending trust exists.

## 4. Scaffold services — named honestly

`kitluy-provisioning-service`, `kitluy-edge-operations-api`,
`kitluy-management-api`, `kitluy-configuration-projection-service` and
`kitluy-device-release-and-update-service` are each three source files: a health
check and a version string. Their names suggest capability they do not have.

No work was added to them. The governed contracts live in
`kitluy-device-registry-service` and `kitluy-hub-agent`, and splitting them out
is an architecture decision, not a mission task.
