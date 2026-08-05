# WS-11-T004-P04A1 — TERMINAL-SIGNABLE PROVISIONING CHALLENGE — AI HANDOFF

| Field     | Value                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-08-05                                                                                                                                                     |
| Package   | WS-11-T004-P04A1 (terminal-signable provisioning challenge contract)                                                                                           |
| Status    | **IMPLEMENTED-IN-DEV — USABLE CLOUD BOOTSTRAP CONTRACT**                                                                                                       |
| Start SHA | `399817b` (feat(ws-11): add cloud terminal provisioning routes)                                                                                                |
| End SHA   | recorded by `git log -1` after the package commit (one atomic commit)                                                                                          |
| Toolchain | Node v22.23.0 (kitluy-toolchain), pnpm 9.15.9, engine-strict=true                                                                                              |
| Migration | **0175 CREATED** — `20260806040000_0175_pop_challenge_issuance_reconciliation.sql` (see §5: executable evidence proved a database defect; 0000–0174 untouched) |

## 1. What this package corrects

P04A shipped routes a real terminal could not use: the challenge response
carried the composition's approved material only, and the canonical
`kitluy.provisioning-pop.v1` bytes bind FIFTEEN fields the terminal never
receives (tenant/store/location/hub/device/code-row identifiers). Every suite
signed from authoritative rows via the harness — recorded then as the P04B
gap. P04A1 closes it: the challenge response now provides the EXACT canonical
bytes to sign as one opaque value, and a terminal completes bootstrap with no
database access, no server-internal helper and no knowledge of authoritative
rows — only the public HTTP response and its manufacturing private key.

## 2. The exact public challenge response (201)

```json
{
  "result": "CHALLENGE_ISSUED",
  "correlationId": "<uuid — route label>",
  "challenge": {
    "challengeId": "<uuid>",
    "challengeVersion": "kitluy.provisioning-pop.v1",
    "purpose": "terminal_provisioning_redemption",
    "nonce": "<64-hex challenge nonce>",
    "issuedAt": "<authoritative database text>",
    "expiresAt": "<authoritative expiry — never extended>",
    "terminalAssignmentId": "<uuid>",
    "terminalProfileKey": "<T1–T4 profile key>",
    "signatureAlgorithm": "ed25519",
    "signingPayloadEncoding": "base64url",
    "signingPayload": "<UNPADDED base64url of the exact canonical signing bytes>"
  }
}
```

Exported as `TerminalSignableChallenge` (provisioning-routes.ts) — the small
shared public type the package permits. Locked values per the owner decision:
Ed25519; unpadded base64url; payload bytes are EXACTLY
`provisioningChallengeBytes(...)` from `@kitluy/device-identity` — no second
canonicalizer exists. The response still carries no raw code, no code digest,
no private material, no role/schema/permission detail, and no authoritative
scope identifiers as separate fields (the payload is opaque TO THE TERMINAL;
it is challenge material, not a secret — and it is never logged, §8).

## 3. How a terminal signs (proven strictly black-box)

1. `POST /v1/terminal-provisioning/challenges` (code + assignment +
   enrollment fingerprint);
2. base64url-decode `signingPayload`;
3. sign those exact bytes with the manufacturing-enrollment private key;
4. `POST /v1/terminal-provisioning/challenges/{challengeId}/verify` with
   `protocolVersion` (= `challengeVersion`), the unpadded-base64url
   `signature`, and its own public key PEM.

The terminal needs no timestamps, no JSON re-serialization, no UUID
formatting and no optional-field decisions — the drift classes the package
names (Date conversion, precision, property order, newlines) cannot enter the
signature because the terminal never rebuilds anything. RECORDED, not
changed: the verify request still carries `terminalPublicKeyPem`. It is the
terminal's OWN key (bound server-side against the enrolled fingerprint), not
an authoritative binding field; the server stores fingerprints only (0120),
so dropping it would require inventing server-side key storage.

## 4. How the server reconstructs independently

`presentCodeAndIssueChallenge` builds the payload from the ISSUANCE DOOR's
authoritative return (the door has always returned the full canonical field
set); the verification path reconstructs from the 0172 CONTEXT READER as
before. Both parse the same immutable row's jsonb text with the same
canonicalizer — the byte-identity suite proves equality. The verify route
accepts NO caller payload: `signingPayload` in a verify body is refused BY
NAME like every unknown field (test F), so echoed bytes cannot even reach the
comparison, let alone be trusted.

**Timestamp precision:** authoritative timestamps travel as PostgreSQL jsonb
ISO text (microsecond precision), are parsed once (`new Date(text)`), and are
canonicalized by `toISOString()` (millisecond, Z-suffixed) — identically on
the issuance and verification paths. No `String(Date)`, no locale formatting,
no driver `Date` object anywhere in the payload path; test C asserts the
canonical form and the absence of locale artifacts, and B's byte equality
covers whatever precision the database actually produced.

## 5. Migration 0175 — why the slot is no longer free

**Executable evidence of the defect (recorded before writing the
migration):** on the live database at `399817b`, calling
`issue_terminal_provisioning_pop_challenge_v1` twice for ONE outstanding
issued code inserted TWO issued challenges with DISTINCT nonces
(`uq_..._one_proof_per_code` only constrains verified/consumed). The P04A
owner package §5.2 step 5 and the P02C handoff both say "issue or RECONCILE
the existing PoP challenge" — the reconcile behavior was documented and never
implemented. With P04A1 handing real terminals the signing payload, a
lost-response retry MUST be byte-stable (§5 of this package), which no
composition- or route-level mechanism can provide: the composer has no
discover-outstanding-challenge capability and an in-process cache would be a
second source of truth.

**The correction:** `create or replace` of the issuance door (0170's file
untouched) adding one branch — after every inherited validation, an
outstanding ISSUED challenge for the same code bound to the CURRENT sealed
enrollment is returned exactly as first issued (same id, nonce, created_at,
expires_at, correlation; nothing regenerated, nothing extended, no duplicate
row). The code-row `FOR UPDATE` lock serializes concurrent issuance. A
superseded-enrollment challenge is deliberately NOT reused. Ownership borrow
follows the 0125–0166 pattern (`grant kitluy_activation_governor to
current_user`, handed back before the guard — the first apply attempt proved
the applying role is not superuser and cannot replace a governor-owned
function without it). The guard re-asserts governor ownership, the reconcile
branch, the surviving insert path, and the 0173 boundary (`service_role`
effective privilege still false; composer and harness still hold EXECUTE).

## 6. Replay and expiry (§5 of the package)

- Identical challenge retry: same challenge ID, same protocol version,
  byte-identical `signingPayload`, same expiry, ONE challenge row (test D,
  which then verifies the RETRY response's payload — the lost-response case).
- Expiry: an expired challenge stays unusable with its retained original
  payload. Challenge lifetime IS the code lifetime (recorded 0170 decision),
  so expiry is driven through the canonical 0166 expirer under the sanctioned
  transaction-local test clock; the correctly signed original payload then
  refuses (`CODE_EXPIRED`, 403) with nothing consumed (test E4).

## 7. Focused tests (all executed, zero skips)

`provisioning-terminal-contract.integration.test.ts` — **7/7**:

| Test | Proven                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | black-box terminal flow: public response + private key only → decode, sign, verify 200, redeem 201; payload starts with the domain separator and never contains the raw code                                                                   |
| B    | decoded payload bytes EXACTLY equal the server's independent reconstruction from the authoritative row through the crypto authority                                                                                                            |
| C    | canonical timestamps are ms-precision `toISOString` parsed from µs-precision database text; no `String(Date)`/locale/GMT artifacts; DB text re-parse reproduces the canonical strings                                                          |
| D    | identical retry → same id/nonce/expiry, byte-identical payload, ONE row (migration 0175); the retry response's payload verifies                                                                                                                |
| E    | one flipped payload byte, another challenge's payload, another assignment's payload, and an expired challenge's ORIGINAL payload all refuse (403) — challenges stay `issued`, zero verified proofs, zero credentials, redemption refused       |
| F    | verification succeeds with protocolVersion + signature + own PEM only; `signingPayload`, tenant/store/location/hub, environment, nonce and timestamps in the verify body are each refused BY NAME; the clean request still succeeds afterwards |
| G    | log census across the suite: no raw code, no signing payload, no nonce, no signature, no 64-hex digest/fingerprint shape, no PEM, no canonical text                                                                                            |

Regression (H): P04A route suite 12/12, composition 12/12, PoP 10/10,
redemption 9/9, redemption-races 11/11, http 5/5 — **59/59**, plus the reset
gates below.

## 8. Verification (fast package gate + the reset the new migration requires)

| Command                                                        | Exit | Result                                                              |
| -------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `pnpm migrations:validate` / `pnpm db:validate`                | 0/0  | 74 files, all static checks                                         |
| `pnpm db:reset` (0000→**0175** from zero) + seed ×2            | 0    | 74 applied; KLUY-MIGRATION-0175 guard NOTICE; second seed inserts 0 |
| `pnpm db:test`                                                 | 0    | **229 PASS, 0 FAIL** (= baseline)                                   |
| `pnpm test:rls`                                                | 0    | **131 PASS, 0 FAIL** (= baseline; WS11-N19 door censuses hold)      |
| new terminal-contract suite                                    | 0    | **7/7, zero skips**                                                 |
| affected suites (routes/composition/PoP/redemption/races/http) | 0    | **59/59**                                                           |
| `pnpm --filter …device-registry-service typecheck`             | 0    | clean                                                               |
| `npx eslint` / `npx prettier --check` changed files            | 0    | clean                                                               |
| `pnpm secret:scan`                                             | 0    | 1323 tracked files clean                                            |

Recorded intake/apply note: the FIRST reset attempt failed applying 0175 with
`42501 must be owner of function` — the applying role is not superuser and
the door is governor-owned; fixed by the standard ownership borrow (§5). Full
`pnpm verify` deliberately not run (post-P04C closeout owns it). The cloud
reset destroyed `kitluy_hub_local` as always (KLRISK-HUB-006); no Hub suite
was needed this package, and the Hub database must be rebuilt before any is.

## 9. Remaining P04B dependencies (unchanged except the first, now CLOSED)

- ~~terminal-side canonical-payload acquisition~~ — **CLOSED by this
  package**;
- Store Hub credential delivery (#28); activation transport (the activation
  ack has the same payload-acquisition need — the activation challenge does
  NOT yet return a signable payload; same pattern applies in P04B);
- LAN mTLS, signed discovery, pairing routes, terminal receipt persistence
  (rows 34–35 terminal side);
- shared rate-limiter store + production TLS values (BLK-006);
- `[REQUIRED: pairing_challenge_lifetime]`.

**WS-11-T004 is NOT complete.**

## 10. Rollback

Revert the one commit, then `pnpm db:reset` (0000→0174) + seed + `db:test`
and rebuild the Hub database. Reverting restores BOTH gaps: terminals lose
the signable payload, and challenge retry again duplicates issued challenges.
