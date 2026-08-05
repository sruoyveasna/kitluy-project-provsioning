# KitLuy Terminal Transport and Pairing Completion — Owner Decision v1.0.0

**Filename:** `kitluy-terminal-transport-and-pairing-completion-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-05-TERMINAL-TRANSPORT-001
**Date:** 2026-08-05
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — recorded verbatim from the WS-11-T004-P04A owner
package instruction. The package states these decisions require no further
owner confirmation.
**Resolves:** the cloud-bootstrap portion of P02C Boundary B3 (terminal
transport identity, capability-census row 22) — the owner value P02C, P02C1,
P03A and P03C each recorded as the blocker for any versioned route contract.
**Does NOT resolve:** LAN mTLS, signed discovery, Store Hub credential
delivery (#28), activation transport, pairing routes, terminal receipt
persistence (rows 34–35 terminal side). Those remain for WS-11-T004-P04B and
P04C.

---

## 1. Cloud bootstrap identity (LOCKED)

1. Transport is **TLS 1.3 with normal cloud-server certificate validation**.
   The terminal validates the cloud server's certificate chain exactly as any
   public TLS client would; no certificate pinning, no custom trust store is
   decided here. TLS termination is a deployment concern; the service code
   never sees key material.
2. The terminal's bootstrap identity is its **current authoritative
   manufacturing-enrollment key** — the sealed Ed25519 enrollment recorded by
   `kitluy_devices.enroll_device_v1` (migration 0120 lineage) and bound into
   the PoP challenge by migration 0170. There is no other pre-credential
   terminal identity.
3. Proof algorithm and canonicalization **reuse `@kitluy/device-identity`**
   (`kitluy.provisioning-pop.v1`, OPTION B of group 0127: the service verifies
   Ed25519, the database records the attestation).
4. The **one-time provisioning code authorizes one assignment attempt but is
   not identity.** It is re-presented at redemption; an earlier MATCH_READY is
   never trusted (migration 0171 discipline).
5. **No browser cookie, no staff session, no shared terminal secret and no
   Supabase key** participate in bootstrap. The refusing
   `RequestAuthenticator` of the revocation surface is NOT reused here because
   these routes carry their own request authority: the provisioning code plus
   the enrolled-key proof, revalidated by the governed doors on every call.
6. **The terminal never receives database credentials.** The response
   vocabulary is the composition layer's approved public material only.
7. **After credential issuance, bootstrap identity cannot access normal Store
   operations.** The manufacturing-enrollment key opens exactly the three
   bootstrap routes below; Store operations require the issued terminal
   credential and the Store Hub path (repository rule 6), which this surface
   never touches.

## 2. Cloud route contract (LOCKED)

The repository's device-registry service already ships an approved `/v1/`
versioning prefix (`/v1/device-credentials/*`, WS-11-T003 Step 4), so the
package routes are used as given:

| Route                                                            | Operation                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `POST /v1/terminal-provisioning/challenges`                      | provisioning-code presentation + PoP challenge issuance       |
| `POST /v1/terminal-provisioning/challenges/{challengeId}/verify` | authoritative-context retrieval + Ed25519 proof verification  |
| `POST /v1/terminal-provisioning/redemptions`                     | code re-presentation + atomic redemption + credential binding |

**Required headers:**

- `Content-Type: application/json`;
- `Idempotency-Key` — required on every route; shape
  `^[A-Za-z0-9_.:-]{1,96}$` (the bound migration 0171 and the P02C serial
  derivation already enforce). On the redemption route it is the redemption
  idempotency key handed to the governed door, which owns replay
  reconciliation. On the challenge and verify routes it is validated and
  treated as a client retry label only, because the governed doors already
  reconcile replays authoritatively (0170 challenge reuse, 0170
  already-verified answers).
- `X-Correlation-ID` — optional from the caller; validated as a UUID and
  regenerated when absent or malformed; only ever a label, never authority.

**Request maximum:** 16 KiB (enforced in the route layer on the raw bytes,
inside the transport's own 64 KiB bound).

**Rate limit:** 10 requests per minute with burst 3, keyed by **source IP
plus manufacturing-enrollment fingerprint**. The fingerprint component is the
caller-declared enrollment-key fingerprint on the challenge route, the
fingerprint of the submitted public key on the verify route, and absent on
the redemption route (source IP alone), because the redemption input contract
carries no key material. Malformed attempts count toward the limit. The raw
provisioning code and the signature are never rate-limit keys. Refusals are
`RATE_LIMITED` (429) with `Retry-After`, per the API error-code registry. The
shipped limiter is in-process per instance; a shared production limiter store
is a deployment value under BLK-006 and is recorded, not invented.

**Source IP** is the transport-observed peer address. Forwarded-for headers
are caller data and are never consulted (Hub spec §3.1: an IP address never
establishes trust — here it only buckets load).

## 3. Environment posture (LOCKED)

- **Development** is allowed through the existing approved provisional PKI
  (KLD-2026-07-28-002).
- **Pilot remains fail-closed under BLK-005.**
- **Production remains fail-closed under BLK-005.**

The fail-closed point is unchanged and inside the database
(`assert_pki_configuration_approved`); no route, flag or environment variable
can open it.

## 4. Recorded reconciliation (not silently resolved)

The existing revocation surface reads its optional correlation label from
`x-kitluy-correlation-id`; this decision mandates `X-Correlation-ID` for the
terminal-provisioning surface. Both are label-only headers with identical
semantics. The divergence is RECORDED in the decision and reconciliation
register; this decision (the later, owner-locked instruction) governs the new
surface and does not rewrite the shipped revocation surface.

## 5. Register updates carried by WS-11-T004-P04A

- decision and reconciliation register — this decision and §4;
- open-values register — Boundary B3 cloud-bootstrap portion resolved; what
  remains `[REQUIRED]`;
- T004 capability census — row 22 movement;
- P03C handoff dependency section — dated cross-reference.
