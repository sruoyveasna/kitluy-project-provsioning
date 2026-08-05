# WS-11-T004-P03B — HUB-TERMINAL PAIRING CHALLENGE, MUTUAL PROOF AND RECEIPT — AI HANDOFF

| Field          | Value                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                                                                                                            |
| Package        | WS-11-T004-P03B (Hub-terminal pairing challenge, mutual proof and receipt)                                                                                                                            |
| Status         | **IMPLEMENTED-IN-DEV — HUB-LOCAL PAIRING AUTHORITY**                                                                                                                                                  |
| Start SHA      | `e4562ad4b82d3a7c3cb75ac575c9f1e06a4e4d73` (P03A)                                                                                                                                                     |
| Implementation | `2af94d06de3d6ecee8224a7470c89b0cf2572577` (feat(ws-11): add hub-terminal pairing handshake and receipt)                                                                                              |
| End SHA        | recorded by `git log -1` after the evidence commit                                                                                                                                                    |
| Branch / ahead | `main`; push `disabled://push-requires-owner-approval` — **nothing pushed**                                                                                                                           |
| Toolchain      | **Node v22.23.0** (project-external toolchain), pnpm 9.15.9, engine-strict=true                                                                                                                       |
| Migration      | **Hub 0031** `hub/migrations/0031_terminal_pairing.sql` (additive; Hub 0000–0030 and cloud 0000–0174 untouched); **NO cloud migration 0175** — the ownership audit found no cloud object was required |

## 0. TWO-SESSION RECORD — read this first

The P03B **implementation** was completed and committed at `2af94d0`
(2026-08-05 17:52 +0700) by a prior build session that ended **without
producing its evidence obligations**: no handoff, no index row, no capability
census update existed for it. This session (same date, different machine —
see §12) audited that commit against the package requirements, executed the
full verification sequence from a fresh reset, and produced this handoff, the
index row and the census update. Every result in §8 was **executed by this
session**; nothing is inherited from the implementing session's claims,
because none were recorded.

Checkpoint deviations found and resolved by live evidence, none blocking:

- expected HEAD `e4562ad`, found `2af94d0` — the delta IS the P03B
  implementation commit itself;
- Hub migration slot 0031 "occupied" — by the P03B implementation, not by a
  foreign writer;
- ahead-count ~108 expected, 0 found — `origin/main` already carries the full
  history (owner-pushed source hosting; push remains disabled);
- repository root differs from the recorded Windows development root (§12).

## 1. Pairing ownership classification — A (Store Hub local authority)

The Store Hub is the local operational authority for pairing sessions, nonce
consumption, terminal authorization and receipts (pairing protocol
v1.0.0 §8–§9; master build plan WS-11 "normal operation remains LAN-only
capable"). Cloud acknowledgement is **never** part of the LAN handshake's
commit path. The cloud's authority arrives exclusively as the projections the
Hub already holds and the Hub authors none of them:
`edge_identity.terminal_device`, `edge_config.terminal_profile_assignment`
(active-snapshot-sourced), `edge_identity.device_credential`,
`edge_identity.hub_assignment`. Receipt replication to cloud is later WS-10
sync work, deliberately absent here.

## 2. Protocol authority audit

Everything below is sourced from `kitluy-device-discovery-and-pairing-protocol-v1.0.0.md`
and existing repository authority — nothing invented:

- protocol version `1.0` (§8.1); purpose `hub_terminal_pairing`;
- challenge initiator: terminal hello → Hub challenge (§8.1–8.2); two
  directional nonces (terminal hello nonce, Hub challenge nonce);
- transcript canonicalization: fixed-field-order newline-joined bytes under
  domain separators, the established house pattern (provisioning-pop,
  activation-ack); canonical JSON is NOT defined by authority and is not used;
- proof algorithm: Ed25519 via `@kitluy/device-identity` (OPTION B, cloud
  group 0127) — no second cryptographic system;
- receipt signer: **Hub-signed** (§8.3 "Hub returns a pairing receipt signed
  by the Hub key", §9), over a transcript containing both verified proofs'
  subject matter; `valid_until: null` permitted (§9);
- time authority: Hub-local commit time (Hub schema contract 0001 §1); the
  terminal clock is never consulted;
- refusal vocabulary: §18 `PAIR_*` names reused exactly; additions
  (`PAIR_CHALLENGE_EXPIRED`, `PAIR_SESSION_MISMATCH`, `PAIR_NONCE_MISMATCH`,
  `PAIR_RECEIPT_INVALID`, `PAIR_RECEIPT_EXPIRED`) documented in
  `pairing.ts` with the reason §18 lacks each.

**Unresolved values, recorded not invented:**

- challenge lifetime: no authority defines a duration. The door requires a
  caller-supplied expiry bounded by BOTH credentials' expiry (0174
  inheritance discipline); the production default stays
  `[REQUIRED: pairing_challenge_lifetime]`;
- LAN transport: §3 names port 7443/8443 and mTLS, but no transport package
  exists; P03B ships **internal service methods only** and claims no route;
- nonce wire encoding: §8.1 shows base64 on the (unbuilt) wire; the canonical
  transcript and storage use 32-byte lowercase hex — the wire codec belongs
  to the transport package;
- cloud activation record (0174) is NOT projected to the Hub; the Hub-local
  activation truth is registration + enabled active-snapshot profile grant +
  active credential. The missing projection is a P03C/sync prerequisite.

## 3. What exists at `2af94d0`

**Hub migration 0031** (877 lines): NOLOGIN, granted-to-nobody
`kitluy_pairing_governor` owning everything (0024 RV-001 executing-identity
pattern); `edge_identity.pairing_session` with immutable bindings (session,
version, purpose, tenant/store/location/environment, Hub device with
assignment, generation, credential, serial and fingerprint, terminal device
with assignment generation, profile, credential, serial and fingerprint, both
nonces, correlation, created/expires) and the minimal state machine
`challenge_issued → terminal_proof_verified → paired | expired | refused` —
forward-only, terminal states final, timestamps written once, receipt cannot
precede mutual proof (CHECK + trigger); globally single-use directional
nonces (two unique indexes over ALL sessions); at most one live handshake per
terminal (partial unique index — the structural race authority);
`edge_identity.pairing_receipt` append-only, one per session (unique),
Hub-signed signature stored and verified in the command layer (house rule: no
crypto in SQL); `assert_pairing_prerequisites_v1` re-deriving EVERY
prerequisite from the authoritative projections at call time (Hub
trusted+deployed, active Hub assignment matching scope+generation, both
credentials active/unexpired/unrevoked with offline-snapshot revocation
checks, terminal registration active, scope match, active-snapshot profile
grant); three governed doors — `begin_terminal_pairing_v1` (identity, scope,
profile, generation all derived from authoritative rows; caller chooses
nothing; identical hello replays the live session; expired live session
transitioned once), `record_terminal_pairing_proof_v1` (OPTION B attestation,
re-locks and re-derives, idempotent once verified, false attestation aborts),
`complete_terminal_pairing_v1` (requires verified proof, revalidates, issues
the ONE receipt and marks paired in the SAME transaction; same-transcript
replay returns the ORIGINAL receipt; receipt signer must be THIS session's
Hub credential). Boundary proven on apply: governor NOLOGIN/no-members,
runtime EXECUTE on exactly the three doors, PUBLIC nothing, no runtime table
mutation, helper governor-only, doors governor-owned, no secret-shaped
column. HAZARD KLRISK-HUB-001 respected (grantee resolved and quoted; never
`GRANT ... TO current_user`).

**`packages/device-identity/src/pairing.ts`** (+ export): four domains —
`kitluy.pairing-transcript.v1`, `kitluy.pairing-terminal-proof.v1`,
`kitluy.pairing-hub-proof.v1`, `kitluy.pairing-receipt.v1`; one transcript,
two directional proofs over the SAME fields under DIFFERENT separators
(reflection structurally dead); bindings-first-signature-last verification
for terminal proof, Hub proof and receipt; receipt verification is
**historical evidence only** — it never authorizes a different terminal
session, Hub, generation, credential or environment (§11 reconnection
re-validates separately). No raw code, private key, or credential in any
canonical payload; nonces are signed material, never log material.

**`services/kitluy-hub-agent/src/hub/pairing.ts`** —
`TerminalPairingComposition`: `preparePairing` (server-generated UUID +
32-byte `randomBytes` nonces from the sanctioned node:crypto authority),
`verifyTerminalProofAndRecord` (transcript reconstructed from the
AUTHORITATIVE session row read in the same transaction as `now()`; refusal
recorded as a security event in its own transaction),
`produceHubProofAndComplete` (Hub proof + receipt signed via the injected
`PairingSigner` — production keys non-exportable, tests inject ephemeral
sanctioned keys), `reconcilePairingReceipt`; every operation one
`withHubTransaction` as `kitluy_hub_runtime`; KLUY-EDGE-PAIRING-* sentinel
families mapped to the closed `PairingResultCode` vocabulary — no SQLSTATE,
role name or SQL text escapes; logger structurally limited to
`{operation, correlationId, result}`. Terminals hold **no database identity**;
no LAN listener, no cloud route.

**Census contract**: `HUB_DB_ASSERTION_CONTRACT.expectedPassNotices` 35 → 37
(assertions.sql section 30: pairing governor posture + privilege boundary,
both direct AND effective).

## 4. Immutable bindings, nonce model, idempotency, replay

- Bindings: relational, frozen by trigger for the life of the session; JSON
  nowhere in authoritative fields.
- Nonces: 32-byte lowercase hex, directionally distinct (CHECK
  `terminal_nonce <> hub_nonce`), bound to one session, single-use across ALL
  sessions, never logged, never in events; Hub nonce from `randomBytes(32)`.
- Identical hello → the SAME live session (no new nonce, no second session);
  conflicting hello with a consumed nonce → refused.
- Identical completion → the ORIGINAL receipt (same id, transcript,
  paired_at); different transcript on a paired session →
  `PAIR_TRANSCRIPT_CONFLICT`, fails closed.
- Expired challenge → transitions once to `expired`; cannot prove or pair.
- An endpoint/IP is never identity; nothing binds trust to an address.

## 5. Verification executed this session (all fresh, serialized)

| Step | Command                                       | Exit | Result                                                                                                                                                         |
| ---- | --------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | node/pnpm/engine-strict                       | 0    | v22.23.0 / 9.15.9 / true                                                                                                                                       |
| 2    | `pnpm migrations:validate`                    | 0    | 73 cloud files                                                                                                                                                 |
| 3    | `pnpm hub:db:validate`                        | 1    | **3 PRE-EXISTING marker failures** (0028–0030 carry `kitluy:hub:group:`, validator expects `kitluy:hub:migration:`; last touched before P03B; **0031 passes**) |
| 4    | `pnpm db:reset` (0000→0174) + `db:seed` ×2    | 0    | applied from zero; second seed inserts 0 rows                                                                                                                  |
| 5    | `pnpm db:test`                                | 0    | **229 PASS** (= baseline)                                                                                                                                      |
| 6    | `pnpm test:rls`                               | 0    | **131 PASS** (= baseline)                                                                                                                                      |
| 7    | `pnpm hub:db:reset` + seed + `hub:db:test`    | 0    | 32 migrations incl. 0031; **37 `NOTICE:  PASS`** (contract: 35 + 2 pairing)                                                                                    |
| 8    | device-identity suite                         | 0    | **857/857, 36 files, 0 skips** (830 baseline + 27 pairing unit tests)                                                                                          |
| 9    | hub-agent suite                               | 0    | **305 passed / 2 pre-existing skips**; pairing integration **12/12, 0 skips**                                                                                  |
| 10   | registry suite (serial)                       | 0    | **334/334, 30 files, 0 skips** — lifecycle 30/30, provisioning composition 12, activation 9, residue/spendability census 14                                    |
| 11   | `pnpm db:validate`                            | 0    | all static checks, 73 files                                                                                                                                    |
| 12   | `pnpm typecheck` / `pnpm lint`                | 0/0  | clean / 0 errors + 2 pre-existing warnings                                                                                                                     |
| 13   | `pnpm secret:scan` / `pnpm clock:check`       | 0/0  | 1317 files clean / PASS                                                                                                                                        |
| 14   | targeted `prettier --check` (8 P03B TS files) | 0    | clean; the two .sql files are outside Prettier's parser scope (repo gate globs known extensions)                                                               |
| 15   | `pnpm verify`                                 | 1    | **11 of 12 PASS** — only the pre-existing Format check                                                                                                         |

No baseline regressed. All new-capability suites have zero skips.

**Pairing integration evidence (12/12):** success (one Hub-signed receipt the
terminal verifies; no delivery/persistence words in the payload); replay
(same hello → same live session; completion → ORIGINAL receipt); hostile —
ineligible terminals/credentials (unknown, inactive, revoked, expired,
foreign scope) refused with zero residue; forged (another terminal's GENUINE
key), reflected (terminal proof as Hub proof) and malformed/oversized proofs
never pair and leave refusal evidence; expired session can neither prove nor
pair; races A–E (§6); rollback injection (§6); privilege boundary direct AND
effective (§7).

**Pairing unit evidence (27):** deterministic domain-separated canonical
transcript; reflection refused byte-level in both directions; transplant
matrix (each binding altered → its specific refusal); version/environment/
expiry-boundary/future-dated refusals; wrong-key ("a valid certificate alone
is not possession"), malformed/altered-payload refusals; receipt
verification matrix (tampered field with genuine signature, transplanted
receipt, wrong signing key, boundary expiry, null `valid_until` per §9);
domain-uniqueness census against every other proof domain in the repository.

## 6. Concurrency and rollback

Races run through the composition over a `pg.Pool` (max 10) — each competing
operation acquires its OWN pooled connection, so arbitration happens between
genuinely separate PostgreSQL backends under `Promise.all`; the winner is
decided by the partial-unique-index / row-lock authorities and proven by
governed outcomes plus post-state counts (backend PIDs are not additionally
logged by this suite; the structural arbiters make the outcome
deterministic):

- **A — identical completions**: exactly `["ALREADY_PAIRED","PAIRED"]`, one
  receipt, one paired_at, same receipt id seen by both, no uncontrolled
  SQLSTATE.
- **B — valid vs forged proof, one session**: valid proof records; forgery
  refused or observes the already-verified state; verified state never
  unwound; zero receipts before completion.
- **C — concurrent hellos + foreign-scope hello**: at most one live
  handshake (partial unique index); both same-terminal callers see the SAME
  session or one gets `PAIR_SESSION_OUTSTANDING`; the unauthorized scope gets
  `PAIR_ASSIGNMENT_MISMATCH` and **zero** session rows.
- **D — Hub-assignment withdrawal**: withdrawal-first → prerequisites
  re-derived → fails closed, no receipt, no paired state; pairing-first →
  the receipt stands as immutable history and later withdrawal changes
  current eligibility only.
- **E — credential revocation (Hub and terminal separately)**:
  revocation-first → `PAIR_CERT_INVALID` fails closed, no receipt;
  pairing-first → receipt is immutable history, current eligibility reflects
  the revocation separately.
- **Rollback injection**: a forced fault between mutual proof acceptance and
  receipt insertion aborts EVERYTHING — session not paired, receipt absent,
  paired_at absent, nonce-success state rolled back, no success event, no
  idempotency residue, fault mechanism removed; the controlled SQLSTATE
  reaches only the harness.

## 7. Privilege architecture

- `kitluy_pairing_governor`: NOLOGIN, member-of-nobody, nobody-a-member;
  owns tables triggers and doors; the trigger gate is the EXECUTING IDENTITY
  (`current_user`), not a settable GUC. The migrator borrows membership for
  owner-requiring statements and hands it back BEFORE commit (the 0173
  lesson: a retained membership would let a login role forge the gate).
- `kitluy_hub_runtime`: EXECUTE on exactly the three doors + SELECT on the
  two tables; INSERT/UPDATE/DELETE denied. `kitluy_sync_worker` /
  `kitluy_support_ro`: nothing. PUBLIC: nothing. Internal prerequisite
  helper: governor-only.
- Asserted BOTH as direct ACLs and as effective privileges
  (`has_function_privilege` / `has_table_privilege` in migration §10,
  assertions.sql section 30, and the integration suite's runtime probes) —
  the 0173 inherited-membership defect class is explicitly covered.
- Terminals hold no database identity; no Supabase key, no cloud
  `service_role` dependency anywhere in the pairing path.

## 8. Environment conditions of THIS verification run (recorded, none fixed in-repo)

1. **Machine**: run on Windows root `C:\dev\HET-KITLUY-PROJECT` (host user
   `zaqws`), not the recorded development root from 000_CURRENT_STATE. Node
   22.23.0 lives at `%LOCALAPPDATA%\kitluy-toolchain\node-v22.23.0-win-x64`.
2. **Docker Desktop startup defect repaired (host, not repo)**: stale
   zero-byte unix-socket files (`dockerInference`,
   `userAnalyticsOtlpHttp.sock`) in `%LOCALAPPDATA%\Docker\run` crashed the
   backend at start ("cannot be accessed by the system"); undeletable as
   reparse points, the `run` directory was renamed aside and Docker Desktop
   restarted cleanly (engine 29.4.1).
3. **Stale workspace builds**: this clone's `dist/` outputs predated P03B
   (and `@kitluy/job-contracts` predated its gateway export), failing 13
   hub-agent files and 10 registry files at collection.
   `pnpm install --frozen-lockfile` + `pnpm turbo run build` (71 tasks)
   resolved both; no source file changed.
4. **Hub dev-cluster role membership**: `postgres` was not a member of
   `kitluy_hub_runtime`, so `set local role` failed 42501 inside
   `withHubTransaction` and the registry lifecycle's Hub stages died with
   "current transaction is aborted". Applied the development posture the
   `assumeRole` doc-comment itself prescribes ("Grant the role to the
   connecting user to restore it"): `grant kitluy_hub_runtime, 
kitluy_sync_worker, kitluy_support_ro to postgres` on the LOCAL dev
   cluster. Cluster-level, development-only, no repo file changed.
5. **Pre-existing gates**: `hub:db:validate` marker failures on 0028–0030
   (§5 step 3); `format:check` fails on **37 committed files on this
   machine** (`core.autocrlf=false` here — the reference machine's ~832
   figure is dominated by its CRLF artifact), none a P03B file, all failing
   identically at starting HEAD; 2 lint warnings; 2 hub-agent test skips
   (recorded since 2026-07-28).

## 9. FINDING — cross-suite test-environment coupling (recorded, not fixed)

`hub-terminal-pairing.integration.test.ts` `beforeAll` runs
`grant kitluy_hub_runtime to postgres` (plus sync_worker, support_ro) and its
`afterAll` **revokes unconditionally** — including a membership that existed
before the suite ran. This dance is unique to this file. Consequence: running
the hub-agent suite BEFORE the registry suite strips the persistent dev
membership the registry lifecycle's Hub stages depend on, and those stages
then fail with aborted transactions (reproduced this session; §8.4 restored
the grant afterwards). Correct fix (owed to a follow-up, NOT applied to keep
this commit evidence-only): the afterAll should restore the membership state
it observed in beforeAll instead of revoking unconditionally — or the
lifecycle suite should establish its own membership the way the pairing
suite does.

## 10. What P03B deliberately does NOT claim

No receipt delivery to the terminal; no durable terminal receipt storage; no
survival of Hub or terminal restart; no reconnection after WAN/LAN loss; no
offline pairing recovery (all P03C). No LAN route (§3 port values remain a
transport package); no signed mDNS discovery implementation; no endpoint
caching or manual-IP fallback; no cloud receipt replication; no pairing UI;
no production signer custody; no pilot/production PKI claim (BLK-005). The
receipt proves the handshake at `paired_at` — nothing after it.
**WS-11-T004 is NOT complete.**

## 11. Rollback

Evidence commit: revert it (docs only). Implementation: Hub migration 0031 is
additive — drop the two triggers + their functions, the three doors +
prerequisite helper, the two tables (receipt before session, FK order), and
the `kitluy_pairing_governor` role; revert the assertions.sql section-30 and
open-items 35→37 edits; delete `pairing.ts` + its export + both test files;
`hub-database.ts` doc-line reverts with it. Cloud 0000–0174 and Hub
0000–0030 were never touched.

## 12. P03C prerequisites (exact)

1. Durable receipt installation on the terminal (encrypted application
   storage per §9) and its acknowledgment trail.
2. Hub restart / terminal restart / process-loss receipt reconciliation
   (`reconcilePairingReceipt` is the seam; nothing survives a process today).
3. Offline / WAN-loss reconnection re-validation (§11) over the cached
   receipt + snapshot authorities.
4. The cloud activation-record projection to the Hub (§2 note) — or an
   owner ruling that registration + grant + credential remains the
   authoritative Hub-local activation truth.
5. The LAN transport package (§3 ports, mTLS, wire codecs incl. base64 nonce
   encoding) before ANY door is reachable by a real terminal.
6. Stale-projection policy: how old an `edge_config` projection may be and
   still authorize a pairing (recorded as open; the doors currently enforce
   the latest projection the Hub holds).

## 13. Next

**WS-11-T004-P03C — pairing persistence, replay, restart and offline
recovery** (census rows 34–35). P03C was NOT started by this session.
