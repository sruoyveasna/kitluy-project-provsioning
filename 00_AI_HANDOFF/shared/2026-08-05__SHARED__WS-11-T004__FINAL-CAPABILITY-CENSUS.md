# WS-11-T004 — FINAL CAPABILITY CENSUS

Evidence date: 2026-08-05. Evidence commits: the WS-11-T004-P02C commit
(`feat(ws-11): add controlled provisioning composition`), corrected by P02C1
(`fix(ws-11): enforce provisioning composer role entry`), extended by P03A
(`feat(ws-11): add terminal activation completion state`), by P03B
(`2af94d0` — hub-terminal pairing handshake and receipt; verified fresh by
the P03B evidence session at `3e6bb20`) and by P03C (restart/offline recovery
proofs + the suite-ordering hygiene fix, one commit — see the P03C handoff).
Toolchain: Node v22.23.0, pnpm 9.15.9,
engine-strict=true. Every status below is backed by a migration and an
executed test — nothing is marked implemented because a prompt or handoff
described it.

Status vocabulary: **IMPLEMENTED-IN-DEV** (built and proven in development),
**TESTED-IN-DEV** (evidence-only hardening, no new production surface),
**PARTIAL**, **MISSING**, **BLOCKED BY BLK-005**, **NOT STARTED**.

| #   | Capability                        | Owner / migration                                                          | Tests                                                                                                         | Environment | Status                 | Remaining dependency                                                                                   |
| --- | --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Terminal assignment model         | 0121 `device_terminal_assignments`                                         | assertions.sql; every provisioning suite                                                                      | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 2   | T1–T4 profile derivation          | 0121 `assign_terminal_profile_v1`                                          | assertions.sql; all provisioning suites                                                                       | dev         | IMPLEMENTED-IN-DEV     | owner-locked T1–T4 model preserved                                                                     |
| 3   | Active-Hub ordering gate          | 0121 projections; gate in 0163/0167/0169/0170/0171                         | recovery-races C, redemption-races C, composition E                                                           | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 4   | Provisioning-code schema          | 0162                                                                       | assertions.sql, rls-tests WS11-N*                                                                             | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 5   | Code issuance                     | 0163 (+0167/0168)                                                          | issuance + reconciliation suites                                                                              | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 6   | Code presentation                 | 0164 evaluator (0166 refactor)                                             | presentation suite; composition A/B                                                                           | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 7   | Attempt counting                  | 0164                                                                       | presentation suite; composition B                                                                             | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 8   | Lockout (5th failure)             | 0164                                                                       | presentation suite; composition B                                                                             | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 9   | Explicit revocation               | 0165                                                                       | revocation suite; races A (recovery + redemption)                                                             | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 10  | Canonical expiration              | 0166                                                                       | expiration suite; boundary races B                                                                            | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 11  | Expired-code replacement          | 0167                                                                       | replacement + cross-race suites                                                                               | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 12  | Ambiguous issuance reconciliation | 0168                                                                       | issuance-reconciliation suite                                                                                 | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 13  | Controlled lost-code recovery     | 0169                                                                       | recovery + recovery-races suites                                                                              | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 14  | PoP challenge                     | 0170 `issue_terminal_provisioning_pop_challenge_v1`                        | PoP suite; composition A                                                                                      | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 15  | Cryptographic proof verification  | `packages/device-identity/src/provisioning-pop.ts` (OPTION B)              | 22 unit + PoP + composition A/C                                                                               | dev         | IMPLEMENTED-IN-DEV     | algorithm stays `[REQUIRED: device_certificate_signature_algorithm]`                                   |
| 16  | Verified-proof replay protection  | 0170 state machine + one-proof-per-code index                              | PoP races A/B; composition D                                                                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 17  | Atomic redemption                 | 0171 `redeem_terminal_provisioning_code_v1`                                | redemption + redemption-races; composition A/D/E                                                              | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 18  | Credential issuance or binding    | 0120/0123 `issue_device_certificate_v1`, bound by 0171                     | redemption suite (ISSUED + BOUND); races E                                                                    | dev only    | IMPLEMENTED-IN-DEV     | pilot/production signing custody                                                                       |
| 19  | Redemption replay                 | 0171 idempotency + 0172 composition retry contract                         | redemption D; races replays; composition D                                                                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 20  | Controlled composition identity   | **0172** `kitluy_provisioning_service` (+0173 gateway; 8 caps after 0174)  | migration assertions; rls-tests WS11-N19; composition identity test                                           | dev         | IMPLEMENTED-IN-DEV     | production deployment wiring                                                                           |
| 21  | Application composition service   | `services/kitluy-device-registry-service/src/provisioning-composition.ts`  | composition suite A–F                                                                                         | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 22  | Versioned route contract          | —                                                                          | —                                                                                                             | —           | **MISSING**            | terminal transport identity (Boundary B3)                                                              |
| 23  | Safe result mapping               | `mapRefusal` + closed `ProvisioningResultCode`                             | composition A–F (every family asserted)                                                                       | dev         | IMPLEMENTED-IN-DEV     | HTTP status mapping waits on #22                                                                       |
| 24  | Observability                     | safe-field logger in the composition service                               | composition identity test (log census)                                                                        | dev         | PARTIAL                | metrics/tracing wiring at deployment                                                                   |
| 25  | Development environment           | 0120/0122 PKI approval + trusted time                                      | composition A end-to-end                                                                                      | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 26  | Pilot environment                 | `assert_pki_configuration_approved`                                        | composition F (raises P0001)                                                                                  | pilot       | **BLOCKED BY BLK-005** | approved pilot signing custody                                                                         |
| 27  | Production environment            | `assert_pki_configuration_approved`                                        | composition F (raises P0001)                                                                                  | production  | **BLOCKED BY BLK-005** | approved production signing custody                                                                    |
| 28  | Credential delivery to Store Hub  | —                                                                          | —                                                                                                             | —           | **NOT STARTED**        | later WS-11 work                                                                                       |
| 29  | Terminal acknowledgment           | **0174** ack challenge + `device-identity/src/activation-ack.ts`           | 27 unit + activation suite (forged/stale/replay refusals)                                                     | dev         | IMPLEMENTED-IN-DEV     | terminal transport identity (#22)                                                                      |
| 30  | Terminal activation               | **0174** activation record + prepare/complete doors                        | activation suite: success, replays, races A–D, rollback, WS11-N20                                             | dev         | IMPLEMENTED-IN-DEV     | #22 transport; #28 delivery stays unclaimed                                                            |
| 31  | Hub-terminal pairing challenge    | **Hub 0031** doors + `device-identity/src/pairing.ts` (§8)                 | 27 unit + pairing integration 12/12 (mutual proof, races A–E)                                                 | dev         | IMPLEMENTED-IN-DEV     | LAN transport package (§3 ports/mTLS/wire codecs) before any real terminal                             |
| 32  | Pairing nonce replay protection   | **Hub 0031** globally-unique single-use directional nonces + state machine | pairing integration (replay, conflicting hello, races A/C); assertions §30                                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                                                      |
| 33  | Pairing receipt                   | **Hub 0031** append-only Hub-signed receipt (§9), one per session          | receipt verify/tamper/transplant units; replay returns ORIGINAL receipt                                       | dev         | IMPLEMENTED-IN-DEV     | delivery to terminal + persistence are #34/#35 (P03C)                                                  |
| 34  | Pairing persistence               | Hub side: 0031 relational authority (no new migration — P03C audit)        | P03C restart proofs: instance death, lost response, incomplete resume, expired refusal, rollback-then-restart | dev         | **PARTIAL**            | terminal-local receipt store does not exist (spec §9 storage unimplemented; #22 transport precedes it) |
| 35  | Offline pairing recovery          | Hub side: classification A — no cloud client in the commit path            | P03C offline proofs: hub-db-only pairing with recorded ACTIVE projection; stale grant refuses closed          | dev         | **PARTIAL**            | extended-offline freshness POLICY is an owner value; terminal-side recovery needs #22 + #34            |

## Verdict

**WS-11-T004 is NOT complete.** Capabilities 1–21, 23, 25, 29, 30 and 31–33
are IMPLEMENTED-IN-DEV with executable evidence; 24, 34 and 35 are PARTIAL;
22 and 28 remain MISSING or NOT STARTED; 26 and 27 are BLOCKED BY BLK-005.
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
