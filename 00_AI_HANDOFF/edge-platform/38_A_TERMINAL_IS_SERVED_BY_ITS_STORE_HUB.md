# A Pi Terminal is served by its Store Hub

**Date:** 2026-09-11
**Status:** **PROVEN ON HARDWARE, END TO END.** A Pi Terminal discovers its Store
Hub, completes mutual TLS, pairs with mutual proof, and reads authority time,
eligibility and configuration — every route 200.
**Not committed. No hosted write. Hub image rebuilt; the Terminal image needed
no change.**

---

## 1. The result

```text
terminal-edge   SERVING: connected to Store Hub c00ce1a3-… at 172.16.13.203:7443
pairing session paired, receipt written

edge:discovery              200  SIGNED_RECORD
edge:runtime-authority-time 200  AUTHORITY_TIME
edge:runtime-eligibility    200  ELIGIBLE
edge:configuration-current  200  CONFIGURATION_DELIVERY
```

Reached from a completely clean slate: cloud fleet truncated, both boards on new
SD cards with freshly built images, new device records, new certificates.

## 2. The owner decision, and why it was the cheap one

Handoff 37 §4b recorded the wall: the Hub verified the pairing proof against the
terminal's **RSA-2048 operational** credential, whose signature is 342 base64url
characters against a route bound of 120. Three options were put; the owner chose
an **Ed25519 pairing credential** (2026-09-11).

It turned out the terminal was already doing the right thing — `edge-pairing.ts`
signs with the Ed25519 device identity key, and the cloud already holds that
key's fingerprint from registration. So no cloud change, no widened bound, and
**no Terminal reflash**. The work was entirely Hub-side.

## 3. Five defects, in the order they surfaced

### 3.1 DER serial padding (producer, mine, from 2026-09-10)

```text
cloud column      008fc0600ad6a2b60c
the certificate     8fc0600ad6a2b60c   ← what OpenSSL, Node and the Hub see
```

`certificate_x509_serial` stores the DER integer bytes, and DER pads a positive
integer whose high bit is set. The projection wrote a row that looked right and
matched nothing, so the terminal was refused `TERMINAL_NOT_RECOGNIZED`.

**It breaks on roughly half of all serials at random.** 2026-09-10's began `0x3F`
and passed; 2026-09-11's began `0x8F` and failed. The producer now reads
`X509Certificate.serialNumber` from the PEM, with a de-padding fallback that says
so when it fires.

### 3.2 The Hub held no credential of its own

`--hub-self` projected the hub device and its assignment but not the
`device_credential` that `begin_terminal_pairing_v1` looks up by
`hub_assignment.operational_cert_serial`. The Hub served, recognised the
terminal, and refused every pairing `PAIR_CERT_INVALID`. Now derived from the
Hub's own certificate — no cloud round trip.

### 3.3 The transcript bound the transport credential (hub migration 0042)

A terminal holds two keys doing two jobs: an RSA operational key that carries
mutual TLS, and an Ed25519 device identity key created by
`kitluy-firstboot.service`. `begin_terminal_pairing_v1` recorded the operational
credential in the transcript, which made the handshake unsatisfiable from either
side — `verifyTerminalPairingProof` demands

```text
fingerprint(presented key) = transcript.terminalCertificateFingerprint
```

Migration 0042 binds the **signing** credential instead, symmetrically for both
halves, with a fallback to the operational credential so a Hub holding no
identity projection behaves as it did before. `assert_pairing_prerequisites_v1`
learned the same distinction: a signing credential has no X.509 serial, so the
equality against the transport serial applies only to an operational credential.

The 120-character bound was left exactly where it is. Ed25519 signatures are 86.

### 3.4 The signer declared the wrong credential

`composeDevelopmentListener` signs with the identity key but declared the TLS
certificate's serial, so `complete_terminal_pairing_v1` refused every completion:
_"the receipt signer is not this session's Hub credential"_. It now declares the
SPKI fingerprint of the key it actually signs with.

### 3.5 A constraint that could permanently brick a terminal — PRE-EXISTING

```sql
constraint pairing_session_proof_state_ck
  check ((terminal_proof_verified_at is not null)
         = (state in ('terminal_proof_verified', 'paired')))
```

The expiry sweep sets `state = 'expired'`. For a session that had already
recorded a terminal proof that makes the check `true = false`, so the sweep threw
and `preparePairing` returned `INTERNAL_ERROR`. Because the sweep is the only
thing that clears an outstanding handshake, **that terminal could never open
another session on this Hub** — and the governance trigger refuses hand-editing
or deleting the row, so there was no way out at all.

This is the most serious finding of the day and has nothing to do with the
Ed25519 work; it was reachable by any session that verified a proof and then
expired. 0042 replaces the equality with two implications, which keep both facts
it protected (a verified/paired session HAS the timestamp; a `challenge_issued`
one has NOT) while letting a terminal state keep it as history.

## 4. What changed

| File                                                             | Change                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hub/migrations/0042_…signing_credential.sql`                    | transcript binds the signing credential, both halves; prerequisite re-validation learns the distinction; `pairing_session_proof_state_ck` corrected |
| `services/kitluy-hub-agent/src/hub/edge/development-listener.ts` | the signer declares its own key's credential                                                                                                        |
| `services/kitluy-hub-agent/src/hub-database.ts`                  | canonical migration list: 43                                                                                                                        |
| `…/usr/lib/kitluy/hub-provision-terminal`                        | projects the Hub's own credential, and both device-identity signing credentials                                                                     |
| `scripts/development/hub-terminal-projection.mjs`                | serial read from the certificate; carries the identity fingerprint                                                                                  |

## 5. Verification

```text
services/kitluy-hub-agent   176 passed, 0 failed, 271 skipped (no local hub DB)
hub image build             43 migrations + manifest
```

Both changed tests were updated to assert the new behaviour with the reasoning
recorded, not relaxed.

## 6. Still open

1. **The `hubPaired` rung** — `UNREPORTABLE_RUNGS` in the Partner Portal. The
   device side now exists (`edge-status.json` carries the phase), but nothing
   carries it to the cloud and the API has no field. Now worth doing: the honest
   value is finally `SERVING`.
2. **The storage authorization marker.** `DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED`
   lives on the SD card while the volume lives on the NVMe, so **every Hub
   reflash breaks storage** until it is re-authorized by hand. Rough edge worth
   closing in the image.
3. **`isHubDatabaseReachable()`** still swallows every error (handoff 36 §3).
4. **`lan-client.ts`** in the desktop app cannot pass its own server-identity
   check against a URI-SAN device certificate (handoff 37 §2.2).
