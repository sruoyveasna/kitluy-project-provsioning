# WS-11-T004 — FINAL CLOSEOUT — AI HANDOFF

| Field      | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Date       | 2026-08-05                                                                             |
| Task       | WS-11-T004 — terminal provisioning, activation, LAN transport and Hub-terminal pairing |
| Status     | **COMPLETE — IMPLEMENTED-IN-DEV**                                                      |
| Start SHA  | `5711466` (feat(ws-11): add LAN activation and pairing transport) — see §1             |
| Toolchain  | Node v22.23.0 (kitluy-toolchain), pnpm 9.15.9, engine-strict=true                      |
| Migrations | Cloud through **0176**; Hub through **0034**                                           |
| Push       | NOT pushed. `origin` push URL is `disabled://push-requires-owner-approval`.            |

## 1. Starting-state correction

The closeout package expected `HEAD = 70056cb` with P04B1/P04B2/P04B3
outstanding. **P04B was already delivered** by the preceding session as one
commit, `5711466`, with its own handoff. That is explained by git history, not
an unexplained repository change, so this session verified its coverage against
the P04B1/B2/B3 requirement lists — mTLS 7443 `/edge/v1` transport, lifecycle
matrix, signed `_kitluy-edge._tcp.local` discovery (30 s / 90 s), LAN activation
routes, LAN pairing routes, Hub 0032's 300-second clamp — and proceeded to P04C
rather than re-implementing shipped work.

## 2. Package commits (not squashed)

| SHA       | Package  | Subject                                                                             |
| --------- | -------- | ----------------------------------------------------------------------------------- |
| `5711466` | P04B     | LAN mTLS transport, signed discovery, activation and pairing routes (prior session) |
| `09ea7a1` | P04C1    | `feat(ws-11): complete terminal credential delivery authority`                      |
| `99684aa` | P04C2    | `feat(ws-11): persist verified terminal pairing receipts`                           |
| `0081b2a` | P04C3    | `feat(ws-11): replicate pairing receipts through hub outbox`                        |
| this      | closeout | `docs(ws-11): close terminal provisioning and pairing task`                         |

## 3. What each P04C package delivered

**P04C1 — credential delivery, Hub projection, installation acknowledgment.**
Classification first: P04A already returns the issued public credential to the
terminal at redemption, so nothing redelivers or reissues it. The missing
governed parts were a terminal-side verify-before-install contract
(`kitluy.terminal-credential-package.v1` — fixed field order, the certificate
bound by its canonical TBS bytes, the fingerprint RECOMPUTED from the delivered
key rather than trusted, cycle-safe structural refusal of private material),
the Hub projection nothing had ever written (Hub 0033's governed door with
delivery-keyed idempotence, forward-only status so a replayed or reordered
delivery can never restore `active`, and append-only evidence the runtime
cannot write), and proof that the acknowledgment is the EXISTING group-0174
payload rather than a synonymous second one. Census row 28 moved NOT STARTED →
IMPLEMENTED-IN-DEV.

**P04C2 — terminal receipt persistence.** The repository had no terminal-local
store at all. New `@kitluy/terminal-local-store`: a SQLite-compatible driver
port (the seam a future React Native runtime implements — no speculative mobile
implementation, per §18), OS-protected key custody whose shipped default
REFUSES and names BLK-005, AES-256-GCM value sealing bound by AAD to table,
column and row, and keyed blind indexes for lookup. The receipt authority
verifies the Hub signature before a byte is written, moves the row and the
current pointer in one transaction, keeps history immutable through SQLite
triggers, re-verifies at startup, and treats missing, corrupt or unverifiable
as NOT PAIRED with recovery through governed re-pairing. A verified receipt
still does not authorize operation — Hub, assignment and both credentials are
revalidated against current eligibility first (protocol §11). Census rows 34
and 35 moved PARTIAL → IMPLEMENTED-IN-DEV.

**P04C3 — receipt replication.** The event is written inside the pairing
completion transaction; there is no cloud client in that path. Cloud 0176
stores fleet evidence keyed on the receipt id, moving only cloud-side freshness
on redelivery and refusing a redelivery that asserts different facts. Hub time
and cloud time stay separate fields. The new ingestion identity must be ENTERED
through a NOINHERIT gateway and holds no table reach. New census rows 36 and 37.

## 4. Closeout verification — one serialized run

| Step  | Gate                                                                                                                          | Result                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1     | cloud `migrations:validate` + `db:validate`                                                                                   | PASS — 75 files                                                                              |
| 2–3   | cloud reset 0000 → 0176, seed twice                                                                                           | PASS — second seed idempotent (80 zero-row inserts)                                          |
| 4     | `hub:db:validate`                                                                                                             | **FAIL — pre-existing 0028–0030 marker debt ONLY**; 0033 and 0034 pass every check           |
| 5–6   | Hub reset 0000 → 0034, seed                                                                                                   | PASS — 35 migrations                                                                         |
| 7     | clean terminal-local database                                                                                                 | PASS — created per test from the shipped driver                                              |
| 8     | cloud `db:test`                                                                                                               | **229 PASS**, exit 0 (= baseline)                                                            |
| 9     | cloud `test:rls`                                                                                                              | **131 PASS**, exit 0 (= baseline)                                                            |
| 10    | `hub:db:test`                                                                                                                 | **37 PASS**, exit 0 (= baseline)                                                             |
| 11    | terminal-local database suite                                                                                                 | **14/14**                                                                                    |
| 12–18 | provisioning routes, activation, LAN/discovery, pairing/restart, credential delivery, receipt persistence, outbox + ingestion | all green inside the suite totals below                                                      |
| 19    | device-identity suite                                                                                                         | **867/867** (37 files)                                                                       |
| 20    | Hub-agent suite                                                                                                               | **344 passed, 1 failed, 2 skipped** — the failure is the pre-existing WS-10-T006 flake in §6 |
| 21    | device-registry suite (serial)                                                                                                | **363/363** (33 files)                                                                       |
| 22    | role-privilege census (direct + effective)                                                                                    | PASS — §5                                                                                    |
| 23    | grant / nonce / fault / temporary-object residue                                                                              | PASS — §5                                                                                    |
| 24    | `pnpm secret:scan`                                                                                                            | PASS — 1356 tracked files                                                                    |
| 25    | `pnpm clock:check`                                                                                                            | PASS — no prohibited clock access; 4/4 consumers                                             |
| 26    | targeted formatting of every file this task wrote                                                                             | PASS                                                                                         |
| 27    | **`pnpm verify`**                                                                                                             | **11/12 PASS** — only Format check fails, on the pre-existing repository-wide condition      |

**Repository-wide format condition, reported separately and NOT fixed:** 36
files fail `prettier --check`. Every one predates this task — verified by
intersecting the failing list against everything this task created or edited;
the intersection is empty. Mass-formatting was deliberately not performed.

## 5. Security and residue census

**Cloud.** `service_role` does NOT effectively hold either 0176 door — it must
ENTER `kitluy_edge_sync_service` through the NOINHERIT `kitluy_edge_sync_gateway`
(the 0173 discipline). The ingestion identity holds EXECUTE and **zero table
reach**. The provisioning composer census is still exactly **8** capabilities,
unchanged by 0176. The new relation is RLS enabled and forced with one governor
policy.

**Hub.** Both governors (`kitluy_pairing_governor`,
`kitluy_credential_projection_governor`) are NOLOGIN and **granted to nobody**.
The runtime holds SELECT and EXECUTE and **no INSERT/UPDATE/DELETE** on the
projection evidence. `kitluy_sync_worker`, `kitluy_support_ro` and `public`
reach no door. **No inherited effective-privilege defect was found.**

**Residue.** Zero temporary objects in any `edge_*` schema. Zero fabricated
acknowledgements. **20 pairing receipts and exactly 20
`terminal_pairing.receipt_issued` events** — the one-event-per-receipt invariant,
measured rather than asserted. `kh1.*` and `kl1.*` stay disjoint (168 / 76). Ten
credential projections, all `projected`. No provisioning code, nonce, private
key, certificate body or database credential appears in any log, payload or
ledger the censuses inspected.

## 6. Defects found in already-committed work

**Two fixed forward in this closeout**, both surfaced by the reset-from-zero
that the package gates before P04C had deferred:

1. **Hub 0032 was never registered** in `HUB_MIGRATION_ORDER`. P04B created the
   file but not the entry, so `hub-database.test.ts` had been failing since
   `5711466`, and a rebuild driven by the canonical list would have silently
   omitted the owner-locked 300-second pairing clamp. Both 0032 and 0033 are now
   registered, with the omission recorded in the source comment.
2. **Hub 0033 shipped without its §8 scope index and without a relation-census
   entry.** `edge_identity.credential_projection` is a scoped relation, so the
   schema-contract assertions require
   `edge_identity_credential_projection_scope_idx` and an exact tally; the
   package's behavioural tests could not reach either. Migration **0034** adds
   the index ADDITIVELY (0033 keeps its journalled bytes) and the tally now
   expects 63 relations.

**One recorded, NOT fixed** (repository rule 1): `sync-inbox.test.ts` →
"deduplicates a redelivery of the SAME facts" fails intermittently — 3 of 5 runs
on this machine, then 3 of 3 passes. Its fixture derives `providerEventId` from
a truncated `uuidv7()` (~44 bits of the millisecond timestamp), so two tests in
the same file landing within about 16 ms mint the SAME dedupe triple and the
first insert is already a duplicate. It belongs to WS-10-T006 (`e2390b2`),
predates every P04 package, and no T004 capability depends on it. `pnpm verify`
passed its Unit tests gate in the closeout run. Fix when that area is next
opened: give the fixture a random suffix.

## 7. T004 completion criteria — every item, with its evidence

| Criterion                                                        | Evidence                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| terminal assignment + T1–T4 derivation                           | cloud 0121; assertions.sql; every provisioning suite                                      |
| one-time provisioning codes                                      | cloud 0162/0163; issuance suites                                                          |
| presentation, lockout, revocation, expiry, replacement, recovery | cloud 0164–0169; presentation, revocation, expiration, replacement, recovery suites       |
| terminal PoP                                                     | cloud 0170 + `provisioning-pop.ts`; PoP suite                                             |
| atomic redemption                                                | cloud 0171; redemption + races suites                                                     |
| controlled composition identity                                  | cloud 0172/0173; composition identity test; effective-privilege census                    |
| usable cloud bootstrap routes                                    | P04A/P04A1; route suite 12/12, terminal contract 7/7                                      |
| stable terminal-signable challenges                              | cloud 0175; byte-stable prepare replay proven                                             |
| credential issuance + delivery/projection                        | cloud 0171/0120/0123 + **Hub 0033**; credential delivery 12/12                            |
| signed installation acknowledgment                               | cloud 0174 `kitluy.activation-ack.v1`; exact-binding proof (six mutations)                |
| terminal activation                                              | cloud 0174 + LAN gateway; activation suite 10/10                                          |
| TLS 1.3 mutual authentication                                    | P04B transport; LAN suite over real TLS sockets                                           |
| signed Hub discovery                                             | `edge-discovery.ts` + Hub minting; discovery 6/6, LAN scenario B                          |
| verified endpoint resolution                                     | P04B resolver; LAN scenario B                                                             |
| LAN activation transport                                         | P04B routes; LAN scenario D                                                               |
| Hub-local mutual pairing                                         | Hub 0031 + `pairing.ts`; pairing 19/19, LAN scenario E                                    |
| 300-second nonce and challenge                                   | **Hub 0032** clamp; measured at route AND door                                            |
| immutable pairing receipt                                        | Hub 0031 append-only receipt; tamper/transplant units                                     |
| Hub restart recovery                                             | P03C restart proofs; replication restart scenario                                         |
| offline WAN-independent pairing                                  | LAN scenario F; replication offline scenario                                              |
| encrypted terminal receipt persistence                           | **`@kitluy/terminal-local-store`**; 14/14 including a plaintext census of the raw file    |
| startup receipt verification                                     | `loadVerifiedCurrentReceipt`; restart + corrupt + wrong-key scenarios                     |
| atomic receipt outbox publication                                | `pairing-replication.ts`; 7/7 including injected-fault rollback                           |
| idempotent cloud receipt ingestion                               | **cloud 0176**; 9/9 including conflict and out-of-order                                   |
| no terminal or Hub production-DB credentials                     | LAN scenario G; the Hub holds no cloud DB credential; terminals hold no database identity |
| no inherited effective-privilege defect                          | closeout census §5                                                                        |
| no leaked code, nonce, private key or secret                     | log and payload censuses in every suite; `secret:scan` 1356 clean                         |
| complete dev verification + Rebuild Test                         | §4 and §8                                                                                 |

## 8. Rebuild Test (PROJECT_HOME §8)

Performed for the T004 surface: **one qualified engineer can reconstruct and
operate this chain from repository artifacts alone.** Cloud migrations 0120–0176
and Hub migrations 0000–0034 carry every contract, refusal family and grant
boundary in-file with source citations and prove their own boundary on apply;
owner decision `KLD-2026-08-05-TERMINAL-TRANSPORT-001` fixes the transport and
route contracts; `@kitluy/device-identity` holds every canonical byte format
with fixed field order; `@kitluy/terminal-local-store` holds the terminal
storage contract.

The test earned its place: it is what found the two gaps in §6 — a rebuild from
the canonical migration list would have omitted the 300-second clamp, and a
rebuild from zero failed two schema-contract assertions. Both are closed, and a
reset from zero now reaches 0034 and passes 37/37.

## 9. What T004 does NOT claim

- **Pilot and production are BLOCKED BY BLK-005**, re-proven fail-closed inside
  `assert_pki_configuration_approved` on a reset from zero. Every certificate
  exercised is development-only and minted per test run. Whole-file encryption
  for the terminal-local store (SQLCipher) is BLK-005 deployment material.
- **BLK-006 gates three named things**: the authenticated Hub→cloud ACTIVATION
  bridge (the shipped gateway fails closed as a retryable 503), the cloud
  PRODUCER that mints and signs the credential-projection delivery (the Hub
  consumer is built and proven), and the signed Hub→cloud transport that would
  carry a pairing-receipt batch (the cloud ingestion is built and proven).
- **The WAN sender is WS-10's**, not this task's. Replication writes `pending`
  and nothing else.
- **No React Native terminal implementation** (§18, deliberate): the driver port
  is the seam, and the repository carries no mobile runtime or secure-storage
  authority yet.
- **`node:sqlite` is a Node 22 builtin that Node still marks experimental** —
  recorded, and isolated behind the driver port so a swap changes one file.

## 10. Next task

Read from the authoritative WS-11 task register / `00_AI_HANDOFF/000_INDEX.md`.
The register records WS-11-T005..T008 as NOT STARTED and **their titles are not
resolved from the current register** — the same condition WS-11-T003's closure
recorded for T004, which required a dedicated discovery package. A discovery
package is therefore the next step; no successor title is invented here.

## 11. Rollback

Revert the four package commits in reverse order (`0081b2a`, `99684aa`,
`09ea7a1`, then `5711466` if the LAN transport is also being withdrawn), then
`pnpm db:reset` + seed and `pnpm hub:db:reset` + seed. Note that the closeout
commit carries Hub migration 0034 and the 0032/0033 migration-order
registration: reverting it alone re-breaks `hub-database.test.ts` and
`hub:db:test`.
