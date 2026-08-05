# WS-11-T004-P02B3B — ATOMIC PoP-BOUND REDEMPTION AND CREDENTIAL BINDING — AI HANDOFF

| Field          | Value                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                |
| Package        | WS-11-T004-P02B3B (atomic PoP-bound redemption and terminal credential binding)                           |
| Status         | **IMPLEMENTED-IN-DEV — EXISTING CREDENTIAL AUTHORITY REUSED** (migration 0171 created)                    |
| Start SHA      | `a853d184ca283a3bb582ac4416a218d82156e3bb` (feat(ws-11): add terminal provisioning proof foundation)      |
| End SHA        | recorded by `git log -1` after the package commit                                                         |
| Branch / ahead | `main`, ~103 ahead at intake; push `disabled://push-requires-owner-approval` — **nothing pushed**         |
| Toolchain      | **Node v22.23.0** (kitluy-toolchain), pnpm 9.15.9 (corepack), engine-strict=true                          |
| Migration      | `supabase/migrations/20260805220000_0171_atomic_pop_bound_redemption.sql` (additive; 0000–0170 untouched) |

## 1. Credential-architecture audit (§6 — completed BEFORE migration 0171)

**Classification: A — TRANSACTIONAL CREDENTIAL AUTHORITY AVAILABLE**, with
the B select-and-bind path when an eligible active certificate already
exists.

- The repository's governed terminal credential is the
  `kitluy_devices.device_certificates` STATUS row (0120): created ONLY by
  `issue_device_certificate_v1` (0123 version) — a **plain, synchronous,
  single-transaction INSERT** gated by `assert_pki_configuration_approved`
  (**BLK-005**: development approved; pilot/production RAISE = fail-closed,
  untouched here), `assert_trusted_time_v1`, the sealed current enrollment
  and the key-storage-class policy. One ACTIVE certificate per
  (device, environment) is a partial unique index.
- No asynchronous signer, durable job, callback or external transaction
  boundary exists on this path. The 0125–0128 `device_credentials`
  reservation machine (reserve→sign→finalize, OPTION B) is the SIGNED-
  ARTIFACT lifecycle for the credential service and is deliberately NOT
  entangled here; the dev-CA artifact remains a service concern
  (WS-11-T003), separate from the database credential status this door
  binds. Nothing async is hidden.
- Empirical proof: the NOLOGIN governor executed the full
  `issue_device_certificate_v1` path end-to-end inside a probe transaction
  (it traversed grants, RLS and the lifecycle event and reached the
  one-active unique index).
- No production signer, key or grant was created; the signature-algorithm
  owner value stays `[REQUIRED]`; BLK-005 posture is exactly the 0120/0122
  behavior, exercised through the same assert.

## 2. Files changed (complete list)

1. `supabase/migrations/20260805220000_0171_atomic_pop_bound_redemption.sql` — new.
2. `services/kitluy-device-registry-service/test/provisioning-code-redemption.integration.test.ts` — new, 9 tests.
3. `supabase/tests/rls-tests.sql` — WS11-N18 boundary case (3 PASS) + summary line.
4. This handoff + one `00_AI_HANDOFF/000_INDEX.md` row.

## 3. The door

```text
kitluy_devices.redeem_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_presented_code text,
  p_pop_challenge_id uuid,
  p_idempotency_key text,
  p_certificate_serial text
) returns jsonb
```

SECURITY DEFINER; owner `kitluy_activation_governor` (NOLOGIN); pinned
search_path; EXECUTE **kitluy_test_harness only** until P02C (public/anon/
authenticated/service_role/worker revoked and asserted). The serial is
issuance INPUT for the existing credential authority's contract (the
composition service owns allocation policy under P02C), validated for shape
and uniqueness — never credential authority. No reason parameter: canonical
policy requires none for ordinary terminal provisioning, and none was
invented. Nothing else is caller-suppliable: tenant/store/location/Hub/
environment/profile/terminal/enrollment/fingerprint/states/actor/timestamps
all derive from locked rows.

**Lock order:** DEVICE → ASSIGNMENT → CODE → CHALLENGE. Device-first is
consistent with the 0121 doors (device before assignment rows) and extends
the 0163–0170 order (assignment before code before challenge) without any
cycle against any established door; `issue_device_certificate_v1` re-locks
the already-held device row harmlessly. Holding the DEVICE lock is also the
enrollment-currency lock: `devices.current_enrollment_id` cannot move under
the transaction, and enrollment rows themselves are append-only.

**Both possessions, revalidated under the final locks:**

- _Code possession_ — the presented raw value is normalized by the exact
  0164/0166 rule and re-verified against the stored digest with
  `constant_time_text_eq_v1`. An earlier evaluator match answer is never
  consulted (asserted: the door body must not reference that vocabulary). A
  wrong value refuses with **no attempt increment** (bounded attempt
  counting is the 0164 evaluator's ownership; this internal composition door
  is not the public presentation surface — recorded).
- _Key possession_ — one VERIFIED, unconsumed, unexpired 0170 proof bound to
  exactly this code row, assignment, Hub, profile, environment, enrollment
  and fingerprint; enrollment still current+sealed with the same
  fingerprint; the bound Hub still projected at the scope; trusted time
  politely pre-checked (`device_trusted_time` must be `trusted`) before the
  authority asserts it again.

**Atomic success (one transaction):** select-and-bind the ONE eligible
active certificate (same enrollment + fingerprint) or synchronously issue it
through `issue_device_certificate_v1` (any refusal it raises is caught
BEFORE any mutation → stable `KLUY-REDEEM-CREDENTIAL-REFUSED`, zero
residue); then challenge VERIFIED→CONSUMED (guarded), code ISSUED→REDEEMED
(guarded; `redeemed_at` + `redemption_idempotency_key` +
`redeemed_with_challenge_id` + `redeemed_certificate_id`, all frozen
afterwards by the extended 0162 trigger), and the ONE `REDEEMED` event
(actor TERMINAL, correlation = the proof's correlation, detail carries the
challenge id, certificate id and credential action only). Proof-consumption
evidence is the immutable challenge row (0170's recorded design);
credential evidence is the `CERTIFICATE_ISSUED` device lifecycle event the
existing authority appends. Output is safe public material only (ids,
serial, public fingerprint, times, scope) — never a private key, raw code
or digest.

**Schema:** three columns + the redemption-binding check (one-directional by
necessity — pre-0171 assertion fixtures planted reference-less redeemed rows
as the migration authority; references imply redeemed and travel together,
and the extended trigger makes every NEW issued→redeemed transition through
the door carry all three, forbids born-redeemed inserts, forbids staging on
live rows and freezes recorded bindings). Unique indexes: one redemption key
ever; **one proof can never redeem two codes**; the 0120 index keeps **one
redemption from producing two credentials**.

## 4. Idempotency

Identical replay (same key + assignment + challenge + presented-value
digest) → `ALREADY_REDEEMED` naming code/proof/certificate, no raw code, no
event, no timestamp change. Same key with different immutable input →
`KLUY-REDEEM-CONFLICTING-REPLAY`, zero residue. A different key after
success → stable `KLUY-REDEEM-CODE-ALREADY-REDEEMED`; the proof is never
re-consumed and no second credential appears. Pre-check + under-lock
re-check, the 0163/0169 double-check pattern.

## 5. Rollback evidence (two-stage fault injection, transaction-local)

- _Stage 1 — certificate INSERT faulted_ (serial-keyed trigger on
  `device_certificates`, installed by its owning authority inside the doomed
  transaction): the door catches the failure → stable
  `KLUY-REDEEM-CREDENTIAL-REFUSED`; code ISSUED, proof VERIFIED, no
  certificate, no event, no idempotency residue.
- _Stage 2 — REDEEMED-event INSERT faulted_ (governor-installed trigger on
  the events table): uncaught → the WHOLE transaction aborts — the freshly
  issued certificate provably rolls back with the consumption and
  redemption; `redeemed_at` null, no key residue, no fault mechanism
  survives (pg_trigger census 0). A clean redemption then succeeds.

## 6. Concurrency (separate backends; canonical PIDs 402/403)

- **Race A — identical requests:** one `REDEEMED`, one `ALREADY_REDEEMED`;
  one consumed proof, one redeemed code, one credential, one REDEEMED
  event; no uncontrolled SQLSTATE.
- **Race B — different keys:** one winner; loser gets stable
  `KLUY-REDEEM-CODE-ALREADY-REDEEMED`; proof consumed exactly once, one
  credential, one event; no unique/check/FK escape.
- Broad races (vs revocation/expiration/Hub withdrawal/enrollment
  supersession/credential revocation) are P02B3C's, deliberately not begun.

## 7. Security / privacy evidence

Door 42501 for anon, authenticated and service_role; authenticated cannot
mutate redemption bindings, challenge state or certificate status
(42501); even the table-owning governor cannot reopen a redeemed code or
strip its bindings (P0001 from the trigger — the one-way machine holds
against the owner). Second provisioning cycle BINDS the existing credential
(one active certificate, ever); an active certificate under a foreign key
refuses `KLUY-REDEEM-CREDENTIAL-CONFLICT` (governed credential revocation
owns the fix). Raw-code census across events and certificate serials: zero.
No private-key or raw-code column (asserted). Zero grant/membership/clock/
fault residue after the run. BLK-005 fail-closed posture untouched;
development-only credentials; nothing labeled pilot/production-ready.

## 8. Verification (Node v22.23.0; fresh reset; cloud and Hub serialized)

| Command                                    | Exit | Result                                                                                                                             |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm migrations:validate` / `db:validate` | 0/0  | 70 files PASS                                                                                                                      |
| `pnpm db:reset` (0000→**0171**) + seed ×2  | 0    | 70 applied; 0171 guard NOTICE; idempotent                                                                                          |
| `pnpm db:test`                             | 0    | **224 PASS, 0 FAIL** (baseline 221 + 3 WS11-N18)                                                                                   |
| `pnpm test:rls`                            | 0    | **126 PASS, 0 FAIL** (baseline 123 + 3 WS11-N18)                                                                                   |
| redemption suite                           | 0    | **9/9, zero skips**; races A/B PIDs 402/403                                                                                        |
| PoP suite                                  | 0    | **10/10** (baseline held)                                                                                                          |
| device-identity                            | 0    | **803/803** (baseline held)                                                                                                        |
| `pnpm hub:db:reset` + seed + test          | 0    | **35 PASS**                                                                                                                        |
| registry full suite (serial)               | 0    | **302/302, 27 files, zero skips** (baseline 293 + 9; lifecycle 30/30, residue census 14/14)                                        |
| `pnpm secret:scan` / `clock:check`         | 0/0  | 1295 files clean / PASS                                                                                                            |
| targeted `prettier` on changed files       | 0    | clean                                                                                                                              |
| `pnpm verify`                              | 1    | **11 of 12** — only the recorded pre-existing ~830-file `format:check` artifact (identical at clean HEAD; no package file flagged) |

No baseline regressed: db:test 221→224, rls 123→126, registry 293→302
(26→27 files), device-identity 803→803, PoP 10→10, Hub 35→35, lifecycle
30→30, census 14→14. Zero skips in required tests.

## 9. Unresolved risks

1. Environment behavior: development redeems with a provisional development
   credential; **pilot and production fail closed inside
   `issue_device_certificate_v1`** (caught → `CREDENTIAL-REFUSED`, zero
   residue) until BLK-005 signing custody is owner-approved. Not
   integration-driven here (no pilot fixtures exist by design).
2. The signed dev-CA ARTIFACT delivery to the terminal (WS-11-T003 pattern)
   is service composition — P02C-era work; the database status row is the
   authoritative binding this package owns.
3. Cross-operation redemption races and enrollment-supersession-mid-flight
   remain P02B3C scope (the same recorded position as 0170).
4. Credential-conflict resolution (foreign-key active certificate) requires
   governed certificate revocation — out of scope, refusal proven.

## 10. Rollback

`git revert <package commit>`, then `pnpm db:reset` (0000→0170) and Hub
rebuild. Additive only.

## 11. P02B3C prerequisites (exact)

- Race the redemption door against: 0165 revocation, 0166 boundary expiry,
  0121 Hub withdrawal, governed re-enrollment, certificate revocation, and
  the 0170 attestation door itself (verify-vs-redeem interleavings).
- Replay hardening: ambiguous-response redemption recovery (lost REDEEMED
  response), cross-assignment key reuse, hostile serial collisions.
- Provisioning-composition hardening: the end-to-end service composition
  (evaluate → challenge → verify → attest → redeem) under failure at every
  seam. P02C then owns the production grants for every provisioning door.

Do not mark WS-11-T004 complete.
