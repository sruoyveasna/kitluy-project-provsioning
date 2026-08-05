# WS-11-T004 — FINAL CAPABILITY CENSUS

Evidence date: 2026-08-05. Evidence commits: the WS-11-T004-P02C commit
(`feat(ws-11): add controlled provisioning composition`), corrected by P02C1
(`fix(ws-11): enforce provisioning composer role entry`), extended by P03A
(`feat(ws-11): add terminal activation completion state`), by P03B
(`2af94d0` — hub-terminal pairing handshake and receipt; verified fresh by
the P03B evidence session at `3e6bb20`), by P03C (restart/offline recovery
proofs + the suite-ordering hygiene fix, one commit — see the P03C handoff)
and by P04A (`feat(ws-11): add cloud terminal provisioning routes` — the
cloud bootstrap route contract under KLD-2026-08-05-TERMINAL-TRANSPORT-001;
row 22 movement below), corrected by P04A1 (`fix(ws-11): expose
terminal-signable provisioning challenge` — the challenge response carries
the exact canonical signing bytes as opaque base64url; migration 0175 makes
challenge retry reconcile byte-stably; rows 14 and 22 below) and by P04B
(`feat(ws-11): add LAN activation and pairing transport` — the mTLS 7443
`/edge/v1` transport, signed discovery, LAN activation gateway and pairing
routes; Hub migration 0032 locks the 300 s pairing lifetime; rows 22,
29–33).
Toolchain: Node v22.23.0, pnpm 9.15.9,
engine-strict=true. Every status below is backed by a migration and an
executed test — nothing is marked implemented because a prompt or handoff
described it.

Status vocabulary: **IMPLEMENTED-IN-DEV** (built and proven in development),
**TESTED-IN-DEV** (evidence-only hardening, no new production surface),
**PARTIAL**, **MISSING**, **BLOCKED BY BLK-005**, **NOT STARTED**.

| #   | Capability                        | Owner / migration                                                                                                          | Tests                                                                                                                              | Environment | Status                 | Remaining dependency                                                                                                                                                                    |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Terminal assignment model         | 0121 `device_terminal_assignments`                                                                                         | assertions.sql; every provisioning suite                                                                                           | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 2   | T1–T4 profile derivation          | 0121 `assign_terminal_profile_v1`                                                                                          | assertions.sql; all provisioning suites                                                                                            | dev         | IMPLEMENTED-IN-DEV     | owner-locked T1–T4 model preserved                                                                                                                                                      |
| 3   | Active-Hub ordering gate          | 0121 projections; gate in 0163/0167/0169/0170/0171                                                                         | recovery-races C, redemption-races C, composition E                                                                                | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 4   | Provisioning-code schema          | 0162                                                                                                                       | assertions.sql, rls-tests WS11-N*                                                                                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 5   | Code issuance                     | 0163 (+0167/0168)                                                                                                          | issuance + reconciliation suites                                                                                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 6   | Code presentation                 | 0164 evaluator (0166 refactor)                                                                                             | presentation suite; composition A/B                                                                                                | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 7   | Attempt counting                  | 0164                                                                                                                       | presentation suite; composition B                                                                                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 8   | Lockout (5th failure)             | 0164                                                                                                                       | presentation suite; composition B                                                                                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 9   | Explicit revocation               | 0165                                                                                                                       | revocation suite; races A (recovery + redemption)                                                                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 10  | Canonical expiration              | 0166                                                                                                                       | expiration suite; boundary races B                                                                                                 | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 11  | Expired-code replacement          | 0167                                                                                                                       | replacement + cross-race suites                                                                                                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 12  | Ambiguous issuance reconciliation | 0168                                                                                                                       | issuance-reconciliation suite                                                                                                      | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 13  | Controlled lost-code recovery     | 0169                                                                                                                       | recovery + recovery-races suites                                                                                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 14  | PoP challenge                     | 0170 `issue_terminal_provisioning_pop_challenge_v1` (+**0175** reconcile)                                                  | PoP suite; composition A; terminal-contract D (byte-stable retry, one row)                                                         | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 15  | Cryptographic proof verification  | `packages/device-identity/src/provisioning-pop.ts` (OPTION B)                                                              | 22 unit + PoP + composition A/C                                                                                                    | dev         | IMPLEMENTED-IN-DEV     | algorithm stays `[REQUIRED: device_certificate_signature_algorithm]`                                                                                                                    |
| 16  | Verified-proof replay protection  | 0170 state machine + one-proof-per-code index                                                                              | PoP races A/B; composition D                                                                                                       | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 17  | Atomic redemption                 | 0171 `redeem_terminal_provisioning_code_v1`                                                                                | redemption + redemption-races; composition A/D/E                                                                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 18  | Credential issuance or binding    | 0120/0123 `issue_device_certificate_v1`, bound by 0171                                                                     | redemption suite (ISSUED + BOUND); races E                                                                                         | dev only    | IMPLEMENTED-IN-DEV     | pilot/production signing custody                                                                                                                                                        |
| 19  | Redemption replay                 | 0171 idempotency + 0172 composition retry contract                                                                         | redemption D; races replays; composition D                                                                                         | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 20  | Controlled composition identity   | **0172** `kitluy_provisioning_service` (+0173 gateway; 8 caps after 0174)                                                  | migration assertions; rls-tests WS11-N19; composition identity test                                                                | dev         | IMPLEMENTED-IN-DEV     | production deployment wiring                                                                                                                                                            |
| 21  | Application composition service   | `services/kitluy-device-registry-service/src/provisioning-composition.ts`                                                  | composition suite A–F                                                                                                              | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 22  | Versioned route contract          | **P04A/P04A1** cloud `provisioning-routes.ts`; **P04B** Hub `edge/transport.ts` + `edge/routes.ts` (mTLS 7443, `/edge/v1`) | route suite 12/12; terminal-contract 7/7; LAN suite 8/8 over real TLS 1.3 sockets                                                  | dev         | IMPLEMENTED-IN-DEV     | production TLS/PKI material (BLK-005/006); the Hub→cloud activation bridge is row 30's dependency, not the transport's                                                                  |
| 23  | Safe result mapping               | `mapRefusal` + closed `ProvisioningResultCode` + P04A total canonical map                                                  | composition A–F; route suite (canonical envelope, no-oracle, POPCTX repair)                                                        | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 24  | Observability                     | safe-field logger in the composition service                                                                               | composition identity test (log census)                                                                                             | dev         | PARTIAL                | metrics/tracing wiring at deployment                                                                                                                                                    |
| 25  | Development environment           | 0120/0122 PKI approval + trusted time                                                                                      | composition A end-to-end                                                                                                           | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 26  | Pilot environment                 | `assert_pki_configuration_approved`                                                                                        | composition F (raises P0001)                                                                                                       | pilot       | **BLOCKED BY BLK-005** | approved pilot signing custody                                                                                                                                                          |
| 27  | Production environment            | `assert_pki_configuration_approved`                                                                                        | composition F (raises P0001)                                                                                                       | production  | **BLOCKED BY BLK-005** | approved production signing custody                                                                                                                                                     |
| 28  | Credential delivery to Store Hub  | **Hub 0033** `project_terminal_credential_v1` + `credential_projection`; `credential-package.ts`; inbox delivery path      | credential-delivery integration 12/12; credential-package units 10/10                                                              | dev         | IMPLEMENTED-IN-DEV     | the CLOUD PRODUCER that mints and signs the delivery needs the Hub-facing service identity (**BLK-006**); the Hub consumer, the terminal verifier and the evidence are built and proven |
| 29  | Terminal acknowledgment           | **0174** ack challenge + `activation-ack.ts`; **P04B** opaque signable payload                                             | 27 unit + activation suite 10/10 (byte identity, byte-stable replay, black-box signing)                                            | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 30  | Terminal activation               | **0174** doors (cloud truth) + **P04B** `/edge/v1/terminal-activation/*` LAN gateway                                       | activation suite 10/10; LAN scenario D (black-box, retry-stable, forged refused, cloud-loss retryable)                             | dev         | **PARTIAL**            | the AUTHENTICATED Hub→cloud activation bridge (BLK-006 service identity) — the shipped gateway fails closed as a retryable 503                                                          |
| 31  | Hub-terminal pairing challenge    | **Hub 0031** doors + `pairing.ts` (§8); lifetime LOCKED at 300 s by **Hub 0032**                                           | 27 unit + pairing integration 19/19; LAN scenarios E/E2 (route + door clamp, expired cannot resume)                                | dev         | IMPLEMENTED-IN-DEV     | — (`pairing_challenge_lifetime` closed by 0032)                                                                                                                                         |
| 32  | Pairing nonce replay protection   | **Hub 0031** globally-unique single-use directional nonces + state machine                                                 | pairing integration (replay, conflicting hello, races A/C); LAN scenario E (consumed nonce dead over the wire)                     | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                                                                                                       |
| 33  | Pairing receipt                   | **Hub 0031** append-only Hub-signed receipt (§9); **P04B** `GET .../{id}/receipt` LAN delivery                             | receipt verify/tamper/transplant units; LAN scenario E (receipt delivered, replay returns the ORIGINAL)                            | dev         | IMPLEMENTED-IN-DEV     | terminal-side PERSISTENCE is #34 (P04C)                                                                                                                                                 |
| 34  | Pairing persistence               | Hub side: 0031 relational authority; **terminal side: `@kitluy/terminal-local-store`** (no migration — terminal-local)     | P03C restart proofs; **terminal receipt-persistence suite 14/14** (restart, corrupt, wrong key, atomic pointer, immutable history) | dev         | IMPLEMENTED-IN-DEV     | whole-file encryption (SQLCipher) remains deployment material under BLK-005; no React Native implementation (§18, deliberate)                                                           |
| 35  | Offline pairing recovery          | Hub side: classification A — no cloud client in the commit path; terminal side: startup verification + §11 revalidation    | P03C offline proofs; terminal suite: startup re-verification and eight eligibility refusals                                        | dev         | IMPLEMENTED-IN-DEV     | extended-offline freshness POLICY remains an owner value                                                                                                                                |

## Verdict

**WS-11-T004 is NOT complete.** Capabilities 1–21, 23, 25, 29, 30 and 31–33
are IMPLEMENTED-IN-DEV with executable evidence — 22 now among them (P04B:
the locked mTLS/TLS-1.3 `/edge/v1` transport on 7443 with signed discovery,
proven over real TLS sockets). 24, 30 (the authenticated Hub→cloud activation
bridge is BLK-006), 34 and 35 are PARTIAL; 28 remains NOT STARTED; 26 and 27
are BLOCKED BY BLK-005.
The cloud-side provisioning capability (operator issues a code → terminal
presents it → terminal proves its enrolled key → cloud atomically redeems and
binds a development credential → terminal acknowledges the exact credential
under its enrolled key → cloud records activation as provisioning completion)
is complete and composed behind a least-privilege identity; the Hub-local §8
mutual-proof handshake (challenge, nonce replay protection, Hub-signed
receipt) is built and proven as internal Store Hub authority; and P03C proved
the HUB SIDE of persistence and offline recovery — a committed receipt
survives instance death and replays byte-stable, an incomplete session
resumes with its original nonces, expiry transitions stay governed and lazy,
LAN pairing consumes only the Hub database under the recorded ACTIVE
projection, and an injected fault leaves a state a fresh instance completes
exactly once. What pairing still deliberately does NOT claim: any
terminal-side receipt persistence or restart recovery (no terminal-local
store exists — spec §9 storage unimplemented), any LAN route or signed
discovery (the §3 transport package), receipt replication to cloud (blocked
on the KLREQ-026 Hub-originated event-vocabulary owner decision), credential
delivery to the Hub (#28), or a terminal transport identity (#22).

Recommended next: the owner decisions that unblock the remainder — the
terminal transport identity / LAN transport package (#22, the largest
blocker), the KLREQ-026 Hub-originated event vocabulary for receipt
replication, and `[REQUIRED: pairing_challenge_lifetime]` — then
**WS-11-T004-P04 — terminal transport identity and LAN pairing route**.

**2026-08-05 update (P04A):** the CLOUD half of #22 is now ruled
(KLD-2026-08-05-TERMINAL-TRANSPORT-001) and built — TLS 1.3 bootstrap over
the manufacturing-enrollment key, three versioned routes, owner rate limit,
canonical error mapping, 12/12 route scenarios. Still open from the list
above: the LAN transport package and terminal-side persistence (P04B/P04C),
KLREQ-026, and `pairing_challenge_lifetime`.

**2026-08-05 update (P04B):** the Store LAN transport exists — HTTPS/1.1 +
JSON on TCP 7443, TLS 1.3 pinned both ways, mandatory client certificates,
wildcard binds refused at construction, signed `_kitluy-edge._tcp.local`
discovery (30 s refresh / 90 s validity) whose record pins the Hub TLS
certificate, the §3 lifecycle matrix over projected terminal/credential
facts, LAN activation through a cloud gateway port, and the pairing routes
composing P03B/P03C with the lifetime LOCKED at 300 s by Hub migration 0032.
Proven by 8 LAN scenarios over real TLS sockets and 6 discovery units. Still
open: the authenticated Hub→cloud activation bridge (BLK-006), terminal-side
receipt persistence (P04C) and Hub credential delivery (#28).

**2026-08-05 update (P04C1):** row 28 is built. The terminal now has a governed
verify-before-install contract (`kitluy.terminal-credential-package.v1` — fixed
field order, the certificate bound by its canonical TBS bytes, the fingerprint
RECOMPUTED from the delivered public key, structural refusal of private material
anywhere in the value), the Hub receives ONE authoritative credential projection
through the EXISTING signed cloud-to-Hub inbox authority into Hub migration
0033's governed door (delivery-keyed idempotence, forward-only status so a
replayed or reordered delivery can never restore `active`, append-only evidence
the runtime cannot write), and the installation acknowledgment is the EXISTING
group-0174 payload — REUSED, with the suite proving the binding is exact and
that no synonymous second acknowledgment exists. Issuance, terminal receipt, Hub
projection, acknowledgment, activation and pairing stay six distinct facts.
Still open: the CLOUD PRODUCER of the signed delivery (BLK-006 service
identity), the Hub→cloud activation bridge (BLK-006), terminal-side receipt
persistence (P04C2) and receipt replication (P04C3).

**2026-08-05 update (P04A1):** the cloud bootstrap contract is now USABLE by
a real terminal — the challenge response carries the exact canonical signing
bytes as one opaque `signingPayload` (Ed25519, unpadded base64url), proven
strictly black-box (7/7), and migration 0175 makes challenge retry reconcile
byte-stably (executable evidence: the 0170 door had been inserting duplicate
issued challenges on retry). The activation-ack challenge still lacks the
same signable-payload treatment — owed alongside activation transport in
P04B.
