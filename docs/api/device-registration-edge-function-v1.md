# Device registration intake — Edge Function contract v1

| Field              | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Surface            | Edge Function (Deno), **not** one of the four governed APIs          |
| Path               | `POST /functions/v1/device-registration`                             |
| Function directory | `supabase/functions/device-registration/`                            |
| Payload kind       | `kitluy.device-registration-request.v1`                              |
| Authority          | KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §2      |
| Database door      | `kitluy_devices.register_device_v1` (migration 0197)                 |
| Database identity  | `kitluy_device_registration_service`                                 |
| Status             | **IMPLEMENTED-IN-DEV.** Probed locally; NOT deployed to any project. |

> This document is the contract. The evidence for it is separate and narrower
> than "it works": the function was served on Deno against the local PG17 stack
> and `pnpm probe:device-registration` passed 12/12, covering the happy path,
> idempotent replay, a reflash preserving the device id, and every refusal in §9.
> It has NOT been deployed to `kitluy-project-pos`, no Raspberry Pi has ever
> called it, and no rate limiting exists (§11).

## 1. Why this surface exists at all

A first-boot Raspberry Pi must be able to say "I exist, here is my hardware, here
is my hostname" without depending on a workstation being switched on. Everything
else about the device — pairing, provisioning, configuration — already has a
governed surface. Registration did not, which is why the enrollment endpoint was
bound to a developer's LAN address and why a device could not register at all
once that address moved.

It is deliberately the smallest possible surface: **one route, one database door,
no trust granted.**

## 2. What this surface is NOT

It is not one of the four governed API surfaces (RB v4 §10.1), and it does not
become a fifth. It carries no business route, reads no Store data and issues no
credential.

It is not the pairing service. A Hub still pairs through `/v1/hub-pairing`.
Collapsing the two was considered and rejected in the plan (§10): pairing
authorizes on a Partner-issued code and registration authorizes on nothing at
all, so they must not share a route.

It is not an authorization boundary for hardware. See §6.

## 3. Authentication posture, stated precisely

The function is deployed **without user JWT verification** (`verify_jwt = false`).

The reason is narrow and worth stating exactly, because the loose version of it
is wrong. A first-boot device does not lack _a key_ — it generates a registration
keypair on first boot. What it lacks is a **previously trusted KitLuy
credential**: no device certificate, no operational credential, no Supabase user.
There is therefore nothing for a JWT gate to check, and adding one would only
mean shipping a shared secret in a clonable image — which §34 of the Store Hub
spec forbids, and which would be a secret in a golden image regardless.

What replaces it is a proof of possession (§5) plus the fact that a successful
call grants nothing (§6).

## 4. Request

`Content-Type: application/json`

```json
{
  "kind": "kitluy.device-registration-request.v1",
  "assetTag": "KL-PI5-9F2C41A8",
  "hardwareProfileKey": "KL-PI5-STORE-HUB-DEV",
  "hostname": "pi5-zjjtir",
  "registrationPublicKeyPem": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n",
  "registrationPublicKeyFingerprint": "3f7a…",
  "signals": [
    { "signalType": "board_serial", "signalValue": "10000000abcdef12" },
    { "signalType": "soc_serial", "signalValue": "1f00e4c9d1a2b3c4" },
    { "signalType": "mac_address", "signalValue": "d8:3a:dd:11:22:33" }
  ],
  "installationEvidence": {
    "storageSerial": "0x1a2b3c4d",
    "storageModel": "SC32G",
    "imageRelease": "kitluy-storehub-os-arm64-2026.08.17-dev"
  },
  "signature": "<base64 Ed25519 detached signature over the bytes in §5>"
}
```

### Field rules

| Field                              | Rule                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                             | Must equal the literal above. A request without it is refused unparsed.                                                                                                                                                   |
| `assetTag`                         | Device-supplied label. **Not an identity** — the server may already know this board under a different tag and will not rename it.                                                                                         |
| `hardwareProfileKey`               | A stable **key**, never a UUID. The image may bake a key because a profile identifies a MODEL, not a device; a UUID would differ per environment and would also be a per-environment identity baked into a generic image. |
| `hostname`                         | Operator-facing, mutable, non-secret. Never an identity input.                                                                                                                                                            |
| `registrationPublicKeyPem`         | SPKI PEM of the key generated on this installation.                                                                                                                                                                       |
| `registrationPublicKeyFingerprint` | Lowercase hex SHA-256 of the SPKI DER. Must match the PEM — the server recomputes and refuses a mismatch rather than trusting the claim.                                                                                  |
| `signals`                          | Board and installation evidence. Values MUST already be normalised (`lower(btrim(value))`) so the bytes signed and the bytes stored are the same form.                                                                    |
| `installationEvidence`             | Free-form string map describing THIS installation. Storage identifiers belong here and nowhere else.                                                                                                                      |
| `signature`                        | Base64 Ed25519 detached signature over §5.                                                                                                                                                                                |

A device MUST NOT send, and the function MUST ignore if present: `tenantId`,
`digitalStoreId`, `storeLocationId`, `deviceRecordId`, `lifecycleState`,
`deviceClass`, or any assignment, scope or credential field. A device names what
it is registering, never what it is. Presence of any of these is refused with
`KLUY-REG-UNPERMITTED-FIELD` rather than silently dropped, because a client that
believes it can set them is a client to fix.

## 5. Canonical signing bytes

Fixed field order, domain separator first, newline-joined UTF-8. This is the same
discipline as `kitluy.manufacturing-enrollment-pop.v1` and
`kitluy.hub-claim-payload.v1`, and for the same reason: a re-serialised request
must not verify differently from the original.

```text
kitluy.device-registration-request.v1
<assetTag>
<hardwareProfileKey>
<hostname>
<registrationPublicKeyFingerprint>
<signalsCanonical>
<installationEvidenceCanonical>
```

`signalsCanonical` — each signal rendered `signalType=signalValue`, the list
sorted lexicographically by that rendered string, joined with `;`:

```text
board_serial=10000000abcdef12;mac_address=d8:3a:dd:11:22:33;soc_serial=1f00e4c9d1a2b3c4
```

`installationEvidenceCanonical` — each entry rendered `key=value`, sorted by key,
joined with `;`:

```text
imageRelease=kitluy-storehub-os-arm64-2026.08.17-dev;storageModel=SC32G;storageSerial=0x1a2b3c4d
```

**No JSON canonicalisation is used anywhere.** Sorting explicitly means the bytes
do not depend on object key order, on a JSON serialiser's escaping choices, or on
two implementations agreeing about number and unicode formatting. `;` and `=` are
reserved in canonical values; a value containing either is refused with
`KLUY-REG-CANONICAL-RESERVED-CHAR` rather than escaped, because an escaping rule
is one more thing two implementations can disagree about.

The definition lives ONCE in `@kitluy/device-identity`. The Edge Function carries
a Deno-importable copy, and a test asserts the two produce identical bytes for
the same input — the same discipline already used for the enrollment client's
copy.

## 6. What a valid signature proves, and what it does not

```text
PROVES:        the caller holds the private half of the key it presented
DOES NOT PROVE: the caller is Raspberry Pi board <board_serial>
```

Hardware evidence is self-reported and unauthenticated. Nothing prevents a
program from claiming any board serial it likes. That is not a gap to be closed
at this layer — it is why registration produces an **untrusted** record and why
HET approval exists downstream. A device that lies about its board serial gets a
pending row that an admin will not be able to match to physical hardware.

The one thing the proof does buy: a captured registration request cannot be
replayed against a _different_ public key, so an attacker cannot graft their own
key onto somebody else's registration.

## 7. Verification order

Refusals are ordered cheapest-first, and **every check completes before the
database is touched.** No partial registration exists.

1. Method is `POST`; body parses as JSON; `kind` matches.
2. No unpermitted field is present (§4).
3. Required fields present and well-formed; `signals` non-empty; fingerprint is
   64 lowercase hex characters.
4. Signal values are already normalised; no reserved character in canonical
   values.
5. `registrationPublicKeyFingerprint` equals SHA-256 of the SPKI DER of
   `registrationPublicKeyPem`.
6. Ed25519 signature verifies against that PEM over the §5 bytes.
7. Resolve `hardwareProfileKey` to a profile id through
   `kitluy_devices.hardware_profile_id_for_key_v1`.
8. Call `kitluy_devices.register_device_v1`.

## 8. Database access

The function connects as `service_role` and immediately enters the restricted
identity for the duration of one transaction:

```sql
begin;
set local role kitluy_device_registration_service;
select kitluy_devices.hardware_profile_id_for_key_v1($1);
select kitluy_devices.register_device_v1($1, $2, $3, $4, $5, $6, $7);
commit;
```

This is the pattern `/v1/hub-pairing` and the Hub issuance route already use. It
matters here for the same reason: `service_role` holds `BYPASSRLS`, and a
pre-credential surface whose caller is authorized by nothing must never run with
it. The restricted role holds EXECUTE on exactly those two functions and no table
privilege at all.

`SET LOCAL ROLE` is only possible because 0197 grants the role to `service_role`.
A role that is merely created cannot be entered — see the standing lesson in
KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001.

## 9. Responses

`200 OK` — a new or returning board, recorded as pending:

```json
{
  "status": "PENDING_APPROVAL",
  "deviceId": "…uuid…",
  "installationId": "…uuid…",
  "installationCreated": true
}
```

`200 OK` — a board already known and already approved:

```json
{
  "status": "KNOWN_DEVICE_INSTALLATION_REGISTERED",
  "deviceId": "…uuid…",
  "installationId": "…uuid…",
  "installationCreated": false
}
```

`200 OK` — evidence or credentials need a human. **Not an error**: the request was
well-formed and the answer is "a person must look at this".

```json
{
  "status": "TRUST_REVIEW_REQUIRED",
  "deviceId": "…uuid… or null",
  "conflictReason": "KLUY-CREDENTIAL-REUSE-DETECTED"
}
```

`conflictReason` values, all originating in 0197:
`KLUY-BOARD-EVIDENCE-AMBIGUOUS`, `KLUY-CREDENTIAL-REUSE-DETECTED`,
`KLUY-CREDENTIAL-REVOKED`, `KLUY-DEVICE-CONTAINED-QUARANTINED`,
`KLUY-DEVICE-CONTAINED-RETIRED`, `KLUY-DEVICE-CONTAINED-REPLACED`,
`KLUY-DEVICE-CONTAINED-RESTRICTED_INVESTIGATION`.

`400` — malformed request (`KLUY-REG-MALFORMED`, `KLUY-REG-UNPERMITTED-FIELD`,
`KLUY-REG-CANONICAL-RESERVED-CHAR`, `KLUY-REG-SIGNAL-NOT-NORMALISED`).
`401` — `KLUY-REG-BAD-SIGNATURE`, `KLUY-REG-FINGERPRINT-MISMATCH`.
`404` — `KLUY-REG-UNKNOWN-PROFILE`.
`405` — non-POST. `500` — `KLUY-REG-UPSTREAM` (details logged, never returned).

### Never present in any response

Tenant id, Digital Store id, Store Location id, assignment, API scope, operational
certificate, pairing token or code, customer data, Booking data, payment or
finance data, connection strings, or any part of a database error message.

A pending device receives its own opaque `deviceId` and nothing else. That is
safe — the id is opaque, the device already knows it registered, and an admin
needs it to be quotable over the phone.

## 10. Replay and idempotency

Registration is deliberately retry-safe: a Pi that loses power mid-request must be
able to repeat it.

Idempotency is keyed on the **installation fingerprint** — a digest of
`installationEvidence` — not on the public-key fingerprint, because one board can
legitimately present the same key across two different installations and two
different keys within one.

A replay may never: create a second device row for one board; create a duplicate
installation generation for the same installation; bypass approval; restore a
revoked credential; or return a contained device to trust. All five are enforced
in 0197 and covered by
`services/kitluy-device-firstboot-agent/test/device-registration-continuity.db.test.ts`.

No nonce and no timestamp are required. This is a deliberate choice, recorded so
it is not mistaken for an oversight: a server-minted nonce would need a challenge
round trip and a challenge table, and a client timestamp is worthless on a device
whose clock has no trusted floor yet — the repository already refuses to rely on
one (`POP_NO_TRUSTED_TIME`). Since a replay is idempotent and grants nothing, the
protection would buy nothing that approval does not already provide.

## 11. Rate limiting

Not implemented by this function, and named as an accepted gap rather than
omitted silently. The surface is unauthenticated, so anything that can reach it
can create pending device rows. The bound today is that pending rows grant
nothing and are visible to HET; the operational risk is fleet-list noise, not
trust. Transport-level limiting is required before this surface is exposed beyond
development.

## 12. Non-goals

Pairing; certificate issuance (BLK-005); Store assignment; configuration
delivery; approval (that is a Management API route); terminal provisioning;
hardware attestation.
