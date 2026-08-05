# WS-11-T004-P03C — PAIRING PERSISTENCE, RESTART AND OFFLINE RECOVERY — AI HANDOFF

| Field     | Value                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Date      | 2026-08-05                                                                                                |
| Package   | WS-11-T004-P03C (pairing persistence, restart and offline recovery)                                       |
| Status    | **PARTIAL — TERMINAL PERSISTENCE REQUIRED**                                                               |
| Start SHA | `3e6bb2097aa514ebfda13b050f417631352b9cfe` (P03B evidence)                                                |
| End SHA   | recorded by `git log -1` after the package commit (implementation and evidence in ONE commit)             |
| Toolchain | Node v22.23.0 (project-external), pnpm 9.15.9, engine-strict=true                                         |
| Migration | **NONE.** Hub 0032 and cloud 0175 both left free — the ownership audit found no missing durable authority |

## 1. Ownership audit — why no migration exists

Authority per persisted fact, audited before any code:

| Fact                     | Authority                                                                                                                                                                                                                                                                                                                       | Verdict                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing session          | `edge_identity.pairing_session` (Hub 0031), governed, immutable bindings                                                                                                                                                                                                                                                        | EXISTS                                                                                                                                                               |
| Consumed nonces          | same table — globally unique, single-use columns                                                                                                                                                                                                                                                                                | EXISTS                                                                                                                                                               |
| Pairing receipt          | `edge_identity.pairing_receipt` (Hub 0031), append-only, signature stored                                                                                                                                                                                                                                                       | EXISTS                                                                                                                                                               |
| Terminal receipt copy    | **NO authoritative terminal-local store exists** (spec §9 "encrypted application storage" is unimplemented; terminal apps are fail-closed shells)                                                                                                                                                                               | RECORDED DEPENDENCY — not invented                                                                                                                                   |
| Outbox event             | the outbox producer class is EXCLUSIVELY the WS-09 command pipeline (`HubEventRecorder`): `kh1.*`/`kl1.*` idempotency-key discipline (KLREQ-026), origin-device semantics and declared-effect contracts all presume a terminal command. No Hub-self-originated business-event producer class is defined by repository authority | RECORDED DEPENDENCY — vocabulary owner decision required; the local business fact is the existing `device.paired` audit event, written in the completion transaction |
| Cloud receipt projection | no approved cloud owner; WS-10 owns replication                                                                                                                                                                                                                                                                                 | NO cloud 0175                                                                                                                                                        |

Every authoritative Hub-side pairing fact already lives in PostgreSQL, so
"restart recovery" is a property to PROVE, not to build. Expired-session
cleanup is the EXISTING lazy governed transition (the begin door expires a
stale outstanding session on the next hello; record/complete doors expire on
touch) — no sweeper is defined by authority and none was invented.

## 2. Test-cleanup correction (mandated first)

`hub-terminal-pairing.integration.test.ts` now captures the observed
`postgres` memberships (`kitluy_hub_runtime`, `kitluy_sync_worker`,
`kitluy_support_ro`) in `beforeAll` via `pg_has_role`, and `afterAll` revokes
ONLY memberships the suite itself created. Proven twice: (a) focused —
pairing suite then lifecycle suite, grant survives, 30/30; (b) in the final
closeout — the FULL hub-agent suite (312) ran immediately before the FULL
registry suite (334/334) with the persistent grant confirmed intact between
them. Suite ordering no longer changes results.

## 3. What P03C added — seven recovery proofs (in the pairing suite, 12 → 19)

"Restart" is modelled faithfully: every connection of instance A is ended
(`pool.end()`) and a new pool + composition is built on the same database —
the exact surface a Hub process death exposes. The signer is reconstructed
from the same key custody, as a real restart would.

1. **Committed receipt survives instance death**: pair on A, kill A,
   reconcile on B — same receipt id, transcript hash and paired instant; the
   persisted receipt VERIFIES under the original transcript; exactly one
   session, one receipt, one `device.paired` fact. (Recorded representation
   note: a fresh `PAIRED` response reports `pairedAt` as JS ISO (ms) while
   replays report PostgreSQL text (µs) — one instant, two texts; the stored
   signature binds the ms-precision ISO form and verifies byte-stable.)
2. **Lost response**: complete on A and discard the response; retry on B →
   `ALREADY_PAIRED` with the ORIGINAL receipt/hash/instant; no second receipt,
   no second business fact.
3. **Incomplete unexpired session resumes**: the SAME hello on B replays the
   SAME session with the SAME Hub nonce (nothing regenerated), then proves
   and pairs; exactly one session ever exists.
4. **Expired incomplete session**: the late proof refuses
   (`PAIR_CHALLENGE_EXPIRED`, nothing consumed); the next FRESH hello is what
   transitions the stale session to `expired` through the governed begin door;
   the consumed hello nonce stays dead across restart
   (`PAIR_NONCE_REJECTED`); the fresh handshake pairs cleanly.
5. **Offline LAN**: pairing consumes ONLY `kitluy_hub_local`
   (`current_database()` asserted; the composition holds no cloud client, so
   WAN loss cannot enter the commit path); the enforced authorization is
   recorded exactly — ACTIVE snapshot id, state, assignment version,
   effective-from.
6. **Stale authority**: a profile grant withdrawn mid-handshake refuses
   closed (`PAIR_PROFILE_FORBIDDEN`), no receipt, nothing consumed; stale data
   is never presented as current (the refusal names the missing grant).
7. **Rollback then restart**: the KL940 fault between mutual proof and
   receipt insertion aborts everything (0 receipts, 0 facts, no residue); a
   NEW instance then completes exactly once (1 receipt, 1 fact).

## 4. Final T004 closeout (one serialized run, all fresh)

| Gate                                   | Result                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| cloud reset 0000→0174 + seed ×2        | applied; second seed inserts 0                                                                              |
| Hub reset (32 migrations) + seed       | applied                                                                                                     |
| `db:test` / `test:rls` / `hub:db:test` | **229 / 131 / 37 PASS** (= baselines)                                                                       |
| device-identity                        | **857/857, 36 files, 0 skips**                                                                              |
| hub-agent                              | **312 passed** (305 + 7 recovery) / 2 pre-existing skips                                                    |
| registry (serial, AFTER hub-agent)     | **334/334, 0 skips** — the ordering proof                                                                   |
| `migrations:validate` / `db:validate`  | 73 files PASS / PASS                                                                                        |
| `hub:db:validate`                      | exit 1 — **pre-existing** 0028–0030 `kitluy:hub:group:` marker debt, deliberately NOT masked; 0031 passes   |
| `secret:scan` / `clock:check`          | 1318 files clean / 4/4                                                                                      |
| `pnpm verify`                          | **11 of 12** — only the pre-existing repo-wide Format check (37 files on this machine, none a package file) |

Package files pass targeted Prettier + eslint + tsc. No baseline regressed;
new tests have zero skips.

## 5. Remaining T004 gaps (census rows in parentheses)

- terminal transport identity (#22) and LAN transport package (§3 ports,
  mTLS, wire codecs) — precondition for any real terminal;
- credential/config delivery to Store Hub (#28);
- terminal-local receipt store → terminal restart persistence (34);
- extended offline / stale-projection POLICY (freshness limit is an owner
  value; the Hub currently enforces the latest ACTIVE projection) (35);
- pairing-receipt outbox publication + cloud ingestion — blocked on the
  KLREQ-026 event-vocabulary owner decision (§1);
- pilot/production PKI (26/27, BLK-005);
- challenge lifetime `[REQUIRED: pairing_challenge_lifetime]`.

**WS-11-T004 is NOT complete.** The final census does not prove rows 22, 24,
26–28; rows 34–35 are PARTIAL (Hub side proven, terminal side unbuilt).

> **2026-08-05 update (WS-11-T004-P04A):** the CLOUD-BOOTSTRAP portion of the
> first dependency above (#22) is now ruled by
> KLD-2026-08-05-TERMINAL-TRANSPORT-001 and IMPLEMENTED-IN-DEV — three
> versioned routes over the manufacturing-enrollment key with the owner rate
> limit and canonical error mapping (row 22 → PARTIAL). The LAN transport
> package (§3 ports, mTLS, wire codecs), terminal-side persistence (rows
> 34–35), KLREQ-026 and `[REQUIRED: pairing_challenge_lifetime]` remain open.

## 6. Rollback

One commit: revert it. It contains only the pairing-suite extension (hygiene
fix + 7 tests), this handoff, the census row/verdict updates and the index
row. No migration, no schema, no production surface.

## 7. Next

Owner decisions unblock the rest: (a) the terminal transport identity /
LAN transport package (largest blocker — #22, rows 34–35 terminal side);
(b) the KLREQ-026 Hub-originated event vocabulary for receipt replication;
(c) `[REQUIRED: pairing_challenge_lifetime]`. Recommended next package:
**WS-11-T004-P04 — terminal transport identity and LAN pairing route**, or
the owner-value ballot covering (a)–(c) if decisions must precede code.
