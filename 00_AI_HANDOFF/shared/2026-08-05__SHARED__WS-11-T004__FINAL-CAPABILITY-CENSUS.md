# WS-11-T004 — FINAL CAPABILITY CENSUS

Evidence date: 2026-08-05. Evidence commits: the WS-11-T004-P02C commit
(`feat(ws-11): add controlled provisioning composition`), corrected by P02C1
(`fix(ws-11): enforce provisioning composer role entry`) and extended by P03A
(`feat(ws-11): add terminal activation completion state`). Toolchain: Node
v22.23.0, pnpm 9.15.9, engine-strict=true. Every status below is backed by a
migration and an executed test — nothing is marked implemented because a
prompt or handoff described it.

Status vocabulary: **IMPLEMENTED-IN-DEV** (built and proven in development),
**TESTED-IN-DEV** (evidence-only hardening, no new production surface),
**PARTIAL**, **MISSING**, **BLOCKED BY BLK-005**, **NOT STARTED**.

| #   | Capability                        | Owner / migration                                                         | Tests                                                               | Environment | Status                 | Remaining dependency                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- | ---------------------- | -------------------------------------------------------------------- |
| 1   | Terminal assignment model         | 0121 `device_terminal_assignments`                                        | assertions.sql; every provisioning suite                            | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 2   | T1–T4 profile derivation          | 0121 `assign_terminal_profile_v1`                                         | assertions.sql; all provisioning suites                             | dev         | IMPLEMENTED-IN-DEV     | owner-locked T1–T4 model preserved                                   |
| 3   | Active-Hub ordering gate          | 0121 projections; gate in 0163/0167/0169/0170/0171                        | recovery-races C, redemption-races C, composition E                 | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 4   | Provisioning-code schema          | 0162                                                                      | assertions.sql, rls-tests WS11-N*                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 5   | Code issuance                     | 0163 (+0167/0168)                                                         | issuance + reconciliation suites                                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 6   | Code presentation                 | 0164 evaluator (0166 refactor)                                            | presentation suite; composition A/B                                 | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 7   | Attempt counting                  | 0164                                                                      | presentation suite; composition B                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 8   | Lockout (5th failure)             | 0164                                                                      | presentation suite; composition B                                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 9   | Explicit revocation               | 0165                                                                      | revocation suite; races A (recovery + redemption)                   | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 10  | Canonical expiration              | 0166                                                                      | expiration suite; boundary races B                                  | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 11  | Expired-code replacement          | 0167                                                                      | replacement + cross-race suites                                     | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 12  | Ambiguous issuance reconciliation | 0168                                                                      | issuance-reconciliation suite                                       | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 13  | Controlled lost-code recovery     | 0169                                                                      | recovery + recovery-races suites                                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 14  | PoP challenge                     | 0170 `issue_terminal_provisioning_pop_challenge_v1`                       | PoP suite; composition A                                            | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 15  | Cryptographic proof verification  | `packages/device-identity/src/provisioning-pop.ts` (OPTION B)             | 22 unit + PoP + composition A/C                                     | dev         | IMPLEMENTED-IN-DEV     | algorithm stays `[REQUIRED: device_certificate_signature_algorithm]` |
| 16  | Verified-proof replay protection  | 0170 state machine + one-proof-per-code index                             | PoP races A/B; composition D                                        | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 17  | Atomic redemption                 | 0171 `redeem_terminal_provisioning_code_v1`                               | redemption + redemption-races; composition A/D/E                    | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 18  | Credential issuance or binding    | 0120/0123 `issue_device_certificate_v1`, bound by 0171                    | redemption suite (ISSUED + BOUND); races E                          | dev only    | IMPLEMENTED-IN-DEV     | pilot/production signing custody                                     |
| 19  | Redemption replay                 | 0171 idempotency + 0172 composition retry contract                        | redemption D; races replays; composition D                          | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 20  | Controlled composition identity   | **0172** `kitluy_provisioning_service` (+0173 gateway; 8 caps after 0174) | migration assertions; rls-tests WS11-N19; composition identity test | dev         | IMPLEMENTED-IN-DEV     | production deployment wiring                                         |
| 21  | Application composition service   | `services/kitluy-device-registry-service/src/provisioning-composition.ts` | composition suite A–F                                               | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 22  | Versioned route contract          | —                                                                         | —                                                                   | —           | **MISSING**            | terminal transport identity (Boundary B3)                            |
| 23  | Safe result mapping               | `mapRefusal` + closed `ProvisioningResultCode`                            | composition A–F (every family asserted)                             | dev         | IMPLEMENTED-IN-DEV     | HTTP status mapping waits on #22                                     |
| 24  | Observability                     | safe-field logger in the composition service                              | composition identity test (log census)                              | dev         | PARTIAL                | metrics/tracing wiring at deployment                                 |
| 25  | Development environment           | 0120/0122 PKI approval + trusted time                                     | composition A end-to-end                                            | dev         | IMPLEMENTED-IN-DEV     | —                                                                    |
| 26  | Pilot environment                 | `assert_pki_configuration_approved`                                       | composition F (raises P0001)                                        | pilot       | **BLOCKED BY BLK-005** | approved pilot signing custody                                       |
| 27  | Production environment            | `assert_pki_configuration_approved`                                       | composition F (raises P0001)                                        | production  | **BLOCKED BY BLK-005** | approved production signing custody                                  |
| 28  | Credential delivery to Store Hub  | —                                                                         | —                                                                   | —           | **NOT STARTED**        | later WS-11 work                                                     |
| 29  | Terminal acknowledgment           | **0174** ack challenge + `device-identity/src/activation-ack.ts`          | 27 unit + activation suite (forged/stale/replay refusals)           | dev         | IMPLEMENTED-IN-DEV     | terminal transport identity (#22)                                    |
| 30  | Terminal activation               | **0174** activation record + prepare/complete doors                       | activation suite: success, replays, races A–D, rollback, WS11-N20   | dev         | IMPLEMENTED-IN-DEV     | #22 transport; #28 delivery stays unclaimed                          |
| 31  | Hub-terminal pairing challenge    | — (protocol §8; P01 row E2)                                               | —                                                                   | —           | **NOT STARTED**        | P03B                                                                 |
| 32  | Pairing nonce replay protection   | — (P01 row E7)                                                            | —                                                                   | —           | **NOT STARTED**        | P03B                                                                 |
| 33  | Pairing receipt                   | — (protocol §9; P01 row E13 partial pattern)                              | —                                                                   | —           | **NOT STARTED**        | P03B                                                                 |
| 34  | Pairing persistence               | —                                                                         | —                                                                   | —           | **NOT STARTED**        | P03C                                                                 |
| 35  | Offline pairing recovery          | —                                                                         | —                                                                   | —           | **NOT STARTED**        | P03C                                                                 |

## Verdict

**WS-11-T004 is NOT complete.** Capabilities 1–21, 23, 25, 29 and 30 are
IMPLEMENTED-IN-DEV with executable evidence; 24 is PARTIAL; 22, 28, 31, 32,
33, 34 and 35 remain MISSING or NOT STARTED; 26 and 27 are BLOCKED BY
BLK-005. The cloud-side provisioning capability (operator issues a code →
terminal presents it → terminal proves its enrolled key → cloud atomically
redeems and binds a development credential → terminal acknowledges the exact
credential under its enrolled key → cloud records activation as provisioning
completion) is complete and composed behind a least-privilege identity.
Activation deliberately claims NO Store Hub delivery, pairing or
connectivity — those remain unbuilt: credential delivery (#28), the terminal
transport identity (#22) and the entire §8 pairing handshake (31–35).

Recommended next: **WS-11-T004-P03B — Hub-terminal pairing challenge, nonce
replay protection and receipt**, then P03C (pairing persistence, replay,
offline recovery). The terminal transport identity (#22) remains the recorded
precondition for exposing any of this to a real terminal.
