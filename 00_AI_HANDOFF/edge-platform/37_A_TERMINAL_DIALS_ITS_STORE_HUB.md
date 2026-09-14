# A Pi Terminal dials its Store Hub, and the exact wall it stops at

**Date:** 2026-09-10
**Status:** **PROVEN ON HARDWARE, PARTIAL BY DESIGN.** A terminal client now
discovers the Hub over mDNS, authenticates with mutual TLS, is recognised, and
reads Hub authority time. Two further routes are refused, and the reason is a
governed decision, not a defect.
**Not committed. No hosted write. Both images need a rebuild to reach hardware.**

---

## 1. What existed and what did not

The Hub already served a real operational surface: signed discovery, terminal
activation and pairing, health heartbeats, runtime authority time, eligibility,
configuration, staff sessions, customers, laundry booking drafts. The client
state machine existed too, in `apps/kitluy-pos-desktop-app`.

Three things were missing between them:

| Layer | Before |
| --- | --- |
| A client on the Pi Terminal image | none — the image shipped no edge client at all |
| The Hub knowing its terminals | `edge_identity.terminal_device` was EMPTY |
| The Hub knowing itself | `hub_device`, `hub_assignment`, `hub_installation` all EMPTY |

The Hub identifies terminals from its OWN local projection, which the cloud
delivers signed through `edge_sync.inbox`. The Hub-side consumer is built and
proven; **the cloud producer and its transport are not built and are blocked on
BLK-006**. Nothing in `services/kitluy-hub-agent/src/hub/sync/` performs network
I/O at all. So a genuine, activated, certificate-holding terminal was refused
`TERMINAL_NOT_RECOGNIZED` by a Hub that was working perfectly.

## 2. What was built

### 2.1 The terminal edge client (`services/kitluy-device-firstboot-agent`)

Five modules and a service entrypoint, packaged into the Pi Terminal image and
run by `kitluy-terminal-edge.service`:

- `edge-mdns.ts` — a one-shot mDNS PTR/SRV/A query for
  `_kitluy-edge._tcp.local`. Hand-rolled because the image ships `avahi-daemon`
  but no `avahi-browse`, and this agent has **zero runtime dependencies** by
  design (`package-bootstrap-runtime.sh` fails the build if it gains one).
- `edge-transport.ts` — mutual TLS with a device-identity policy.
- `edge-discovery-record.ts` — the record contract, agent-local, drift-tested.
- `edge-pairing.ts` — the Hub-local pairing handshake.
- `edge-session.ts` — one attempt, and the status file it always writes.

It is a **root service**, separate from the Device Shell, because the Shell runs
as `kitluy-terminal` with an empty `CapabilityBoundingSet` and cannot read the
operational private key — and must not be able to. It publishes only
`/var/lib/kitluy/terminal/edge-status.json`, which the Shell can read. Same
split as `kitluy-device-config.service`.

### 2.2 The identity policy the desktop client could not have survived

`apps/kitluy-pos-desktop-app/electron/lan-client.ts` falls back to Node's
DEFAULT `checkServerIdentity` for the unpinned discovery fetch, which matches
the host against DNS/IP SANs. A KitLuy operational certificate has neither:

```text
Subject: CN = <hub device uuid>
SAN:     URI:kitluy-device://<uuid>, URI:kitluy-generation://1,
         URI:kitluy-environment://development
```

So that check refuses every connection to a genuine Hub. Verified against the
Hub on 2026-09-10. **Recorded as a finding against that app; not changed from
here** — it is a different application and out of this scope.

The new client binds the device, not the name: the chain must verify to the
issuing CA (`rejectUnauthorized` stays on), the peer must present a
`kitluy-device://` URI SAN with a matching environment, and once the signed
record names a fingerprint every later call pins that exact certificate.

### 2.3 The signature is reported unverified, never verified

The record is signed with the Hub's Ed25519 device identity key. Verifying it
needs the Hub's public key, which the cloud delivers to terminals — the same
BLK-006 producer. The well-known payload carries the record and the signature
but not the key, so it cannot be bootstrapped from the response either.

The client therefore verifies everything that does not need that key —
version, scope, environment, port, validity, and that
`hubCertificateFingerprint` **is the certificate the connection presented** —
and reports `signature: "unverified"`. Silence is not treated as a pass. The
fingerprint check is the real anchor: a record replayed from another Hub fails
it.

Scope is checked only when the terminal can state it. The seat file records
`digitalStoreReference` and `storeLocationReference` and no tenant, so when the
three UUIDs are not available the verdict says `scopeChecked: false` rather than
implying it passed.

### 2.4 The development projection door (`hub-provision-terminal`)

The stand-in for the BLK-006 producer, on the Hub image, with a workstation
producer (`pnpm hub:terminal-projection`) that READS the facts the cloud already
holds and prints a delivery. It invents nothing — every field is copied from a
row the cloud wrote when it issued the certificate.

It refuses unless the image declares `KITLUY_ENVIRONMENT=development`, and
refuses any delivery whose tenant/store/location is not this Hub's own. A Hub
holding another Store's terminals is the failure that check exists to prevent.

`--hub-self` projects the Hub's own `hub_device` and `hub_assignment`. Two
columns there — a factory DUID hash and a root key fingerprint — exist nowhere
in this development cloud and are written as **self-describing development
placeholders**, exactly as `hub/seed/dev-fixtures.sql` writes
`sha256('fixture:...')`. The board serial, the scope and the certificate serial
are real.

**The X.509 serial, not the KitLuy label.** The Hub matches
`normalizeHex(peerCertificate.serialNumber)` — the serial the certificate itself
carries, lowercase hex. The `DEV-3F8BAE6ECD675D48` label never appears on the
wire. A projection carrying the label is accepted by the database and then
matches nothing, so the terminal is refused against a row that looks correct.
Found on hardware; both sides now name the field `x509CertificateSerial`.

## 3. Proven on hardware, step by step

Run from the Hub board against the live Hub, so no key material moved:

| Step | Result |
| --- | --- |
| mDNS discovery | found `172.16.13.203:7443` |
| mutual TLS, device-identity policy | handshake completed |
| signed discovery record | fetched, 200 |
| fingerprint binds record to connection | matched `298cb6a1…` |
| before projection | `TERMINAL_NOT_RECOGNIZED` |
| after `--delivery` | terminal recognised |
| `GET /edge/v1/runtime/authority-time` | **ok** |
| before `--hub-self` | `503 HUB_NOT_OPERATIONAL` |
| after `--hub-self` | `403 PAIRING_REQUIRED` |
| pairing session opened, proof signed | `403 PAIR_PROFILE_FORBIDDEN` |
| `GET /edge/v1/configuration/current` | `503 DELIVERY_SIGNER_UNAVAILABLE` |

The real terminal `KL-EDD139CCC2C8` is projected into the Hub on
`3f8bae6ecd675d48` and remains so. A temporary self-projection used to prove the
SERVING transition was removed afterwards; only the real terminal remains.

## 4. THE WALL, AND WHY I DID NOT CLIMB IT

Pairing needs a profile grant, and `begin_terminal_pairing_v1` (0031) requires
the grant to come from an `edge_config.configuration_snapshot` in state
`active`. That table takes a signature, and its own comment is explicit: *"no
unsigned snapshot may reach state=active"*.

Writing an active snapshot with a placeholder signature would fabricate the
appearance of signed configuration. That is a different act from copying
identity facts the cloud already holds, and I did not do it.

The matching decision is already recorded in the code. `development-listener.ts`
says `deliverySigner` is **deliberately omitted**, so configuration "fails
closed with DELIVERY_SIGNER_UNAVAILABLE rather than delivering a configuration
signed by a development key", and `activationGateway` is the unavailable default
because "terminal activation is not part of this milestone and must not appear
to work."

So the configuration plane is intentionally closed, and pairing depends on it.

**This is an owner decision, not an engineering one:** whether a development
delivery signer may sign configuration snapshots in `development` only. A
sanctioned development signer already exists for the sync path
(`DevelopmentHmacBatchSigner`, `KITLUY_HUB_DEV_BATCH_SIGNING_KEY`), so the
pattern is established; the milestone chose not to apply it here. Nothing below
that decision is blocked by code.

## 4a. The owner decision, taken and implemented (2026-09-10)

**Owner ruled: enable a development-only signer.** Implemented as narrowly as the
ruling allows, in two places.

### `publishDevelopmentConfiguration` (`hub/dev-configuration.ts`)

Publishes, verifies and activates a configuration snapshot carrying the profile
grants, run as `hub-agent publish-development-configuration <delivery.json>` —
a subcommand rather than a second bundle, because packaging installs exactly one
entrypoint and `runtime-manifest.json` is checked against that path.

Four guards, each deliberate:

- **Development only.** Refuses `production`, `pilot` and `unknown` alike — an
  allow-list, not a production block. It refuses *before it opens a database
  connection*, which the tests prove with a pool that throws if reached.
- **The sanctioned signer.** `DevelopmentHmacBatchSigner`, the same development
  signer the sync path already carries. No new scheme.
- **The key never leaves the board.** Generated on first use at
  `/var/lib/kitluy/operational/development-configuration-signing.key`, mode
  0600, on the encrypted volume. Nothing is baked into an image and no secret
  crosses a machine boundary — so the image secret scanner stays clean.
- **Through the pipeline, not around it.** `recordDownloadedSnapshot` →
  `verifySnapshot` (the same verifier the cloud path uses) → `activateSnapshot`.
  It never writes `state = 'active'` behind the verifier's back, so every check
  that guards a cloud snapshot guards this one. An empty grant set is refused,
  because a configuration that activates and permits nothing leaves a Hub
  claiming to be configured while refusing every pairing.

### The LAN delivery signer (`edge/development-listener.ts`)

`deliverySigner` is now wired **only** when the image declares `development`.
Outside it, `/edge/v1/configuration/current` reaches the same
`DELIVERY_SIGNER_UNAVAILABLE` it always did, and BLK-005 signer custody is
untouched. `composeDevelopmentListener` already refuses to build any signer at
all outside development (`KLUY-HUB-EDGE-BLK005`), so this is the second lock on
the same door.

Result on hardware: `PAIR_PROFILE_FORBIDDEN` became a pairing session that
**opens**, and the terminal proof is submitted. Snapshot v3 is active on the Hub
with four grants for `KL-EDD139CCC2C8`.

## 4b. THE SECOND WALL: the pairing proof cannot be an RSA signature

Driving the handshake to the end surfaced a genuine cross-component mismatch
that no amount of configuration fixes.

The Hub verifies the terminal proof against the fingerprint of the credential it
holds (`pairing.ts` → `verifyTerminalPairingProof`, comparing
`publicKeyFingerprint(presented)` with the projected
`device_credential.public_key_fingerprint`). So the terminal must sign with the
key its operational credential is over. That key is **RSA-2048**:

```text
kitluy_devices.device_certificates.public_key_algorithm = rsa-2048
services/kitluy-device-firstboot-agent  OPERATIONAL_KEY_TYPE = "rsa"
```

But the pairing route caps the signature:

```text
routes.ts   SIGNATURE_B64URL   = /^[A-Za-z0-9_-]{1,120}$/
pairing.ts  MAX_SIGNATURE_BASE64 = 128

measured:   ed25519  -> 86 base64url chars   (fits)
            rsa-2048 -> 342 base64url chars  (refused)
```

`verifyDetachedSignature` itself is not the obstacle — `crypto.verify(null, …)`
accepts RSA as well as Ed25519, measured, not assumed. **The length caps are.**
The route was written for an Ed25519 terminal credential; the device agent mints
an RSA one; the cloud issued the certificate over that RSA key.

Observed end state: `PAIR_CHALLENGE_FAILED`.

I did not widen the caps. A signature-length bound on a security route is not a
number to adjust in passing, and the alternative — changing the terminal's
operational key type — reaches the CSR path, cloud issuance and the TLS
identity. **Both are owner decisions.** Options, in the order I would rank them:

1. **Give the terminal an Ed25519 pairing credential** alongside its RSA
   transport credential, projected with it. Two keys, two jobs — which is
   already the pattern (`device-identity.key.pem` is Ed25519 and separate from
   the RSA `operational-tls.key.pem`). Smallest blast radius.
2. **Move the operational key to Ed25519.** Cleanest long-term, largest change:
   CSR, cloud issuance, certificate, TLS.
3. **Widen the caps to admit RSA-2048.** Smallest diff, weakest reasoning — the
   bound stops being a bound on anything in particular.

## 5. What an operator sees

`edge-status.json` phases, each a real state of a shop:

| Phase | Meaning |
| --- | --- |
| `NOT_ACTIVATED` | no operational certificate yet |
| `NO_HUB_FOUND` | nothing answered on this network |
| `HUB_REFUSED` | a Hub answered and its record was refused |
| `NOT_RECOGNIZED` | the Hub holds no projection for this terminal |
| `PAIRING_REFUSED` | the Hub holds it but will not pair it |
| `DEGRADED` | paired and answering, but a Hub-side dependency is down |
| `SERVING` | every bootstrap read answered |

`DEGRADED` is its own phase deliberately: the link is good and the shop is
blocked on the Hub, not on this terminal, and collapsing it into `HUB_REFUSED`
would send someone to look in the wrong place.

## 6. Verification

```text
services/kitluy-device-firstboot-agent   526 passed, 0 failed, 9 skipped
  of which new: terminal-edge 17, edge-discovery-drift 4
infra/kitluy-os-image                    213 + 43 + 20 + 93 + 23 = 392 gates, 0 failed
infra/kitluy-store-hub-image             170 + 32 + 19 + 52 + 33 + 22 = 328 gates, 0 failed
scan-image-secrets.sh                    kitluy-os-image PASS
```

**Flaky test, not caused here:** on one full-suite run
`operational-tls-client.test.ts > 8. a DUPLICATE response is idempotent` failed
under load and passed on re-run and in isolation, on a clean baseline as well.
It is crypto-heavy (~10s); worth a timeout rather than a chase.

**Pre-existing scanner failure, unchanged:** `hub-migrations/0038:177` — a false
positive; that migration deliberately inserts `-----BEGIN PRIVATE KEY-----probe`
to prove the trust registry CHECK rejects it. Fails on `main` too.

## 7. Delivery

Both images need rebuilding and flashing; nothing here reaches hardware
otherwise. The Terminal now needs a flash too — it had no client, and there is
no root access on that image to side-load one.

Handoff 36 §6 still governs the cost: the NVMe survives (board-serial-derived
key, independently recomputed), `/var` does not, so a flashed Hub must be
re-paired and then re-run `--hub-self` and `--delivery`.

## 7a. Both images rebuilt (2026-09-10)

```text
infra/kitluy-store-hub-image  kitluy-storehub-os-arm64.img.zst          623 MB
infra/kitluy-os-image         kitluy-pos-terminal-wayland-arm64.img.zst 947 MB
classification: DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED
```

Verified INSIDE the built rootfs, not merely in the source tree: the Hub carries
`RuntimeDirectory=postgresql` + `Group=postgres`, `AF_NETLINK`, the `root` DSN,
`hub-provision-terminal` and the publish subcommand; the Terminal carries the
`terminal-edge` wrapper, the enabled unit with `AF_NETLINK` and
`Restart=always`, all five edge modules and the guarded entrypoint. 328 Hub
gates and 396 Terminal gates, 0 failed.

Three defects surfaced during the build, all caught by the trees' own checks:

1. **The Hub closure was missing `paired-identity`**, which `bin/operational-tls`
   imports. Packaging refused rather than shipping a closure that would die at
   first boot.
2. **`bin/terminal-edge.ts` booted its service loop on import.**
   `package-bootstrap-runtime.sh` imports every packaged module to prove it
   loads, so it hung the build silently — twelve minutes before anyone looked at
   what the node process was doing. Every other entrypoint guards on
   `process.argv[1]` (`node -e` leaves it undefined, so loading is not booting);
   an environment-variable guard does NOT work, because the verifier sets no
   variables. `test/entrypoint-self-execution.test.ts` now asserts this for all
   twelve entrypoints and was mutation-tested against the removed guard.
3. **`terminal-edge` was undeclared in `runtime-manifest.json`.** Declaring it
   made `image-contents` fail against the PREVIOUSLY built rootfs, which is the
   manifest doing its job (D-05); the rebuild cleared it.

**Flash advice stands: not yet for the Terminal.** `/var` is on `mmcblk0p6`, so a
flash erases the seat, the operational certificate and the device identity key.
The re-issued certificate takes a NEW serial, which makes the Hub projection
keyed on `3f8bae6ecd675d48` stale and requires re-running the producer and the
door. What that buys today is a Terminal that stops at `PAIR_CHALLENGE_FAILED`
(§4b). Flash once, after the pairing-key decision.

The Hub is the separate judgement: it is serving only via `/run` drop-ins that
die on reboot, so flashing it alone is defensible if that board must survive a
power cut before the decision lands. The NVMe survives either way.

## 8. Recommended next task

1. **Owner decision (§4b):** how a terminal signs its pairing proof — an
   Ed25519 pairing credential (recommended), an Ed25519 operational key, or
   wider signature caps. Pairing, eligibility and configuration all unblock on
   it, and nothing else stands between here and a terminal reaching `SERVING`.
2. Log the swallowed error in `isHubDatabaseReachable()` (handoff 36 §3).
3. Fix `lan-client.ts` in the desktop app: its default server-identity check
   cannot pass against a URI-SAN device certificate (§2.2).

## 9. The state the boards are in

The Hub is serving on `172.16.13.203:7443` under its INSTALLED agent, with the
runtime drop-ins from handoff 36 (netlink, root DSN) that do not survive a
reboot. Its database holds:

```text
terminal KL-EDD139CCC2C8          x509 3f8bae6ecd675d48   active
terminal SELFTEST-HUB-AS-TERMINAL x509 21bd1122545bcc59   retired
configuration snapshot v3         active, 4 grants for KL-EDD139CCC2C8
```

`SELFTEST-HUB-AS-TERMINAL` was a temporary self-projection used to prove the
handshake without a second board. It could not be deleted —
`enforce_pairing_session_governance` refuses hand-edits to `pairing_session`,
correctly — so it was **retired** and its credential revoked through ordinary
columns rather than by bypassing a governed door. It authorizes nothing.
