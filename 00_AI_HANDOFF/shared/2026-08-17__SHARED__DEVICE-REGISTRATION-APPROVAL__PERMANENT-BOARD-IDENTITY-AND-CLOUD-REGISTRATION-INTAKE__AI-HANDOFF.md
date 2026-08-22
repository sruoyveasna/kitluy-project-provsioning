# KitLuy Task Handoff — permanent board identity and admin-approved cloud registration

## 0. Identity

| Field              | Value                                               |
| ------------------ | --------------------------------------------------- |
| Task ID            | `KL-DEV-REG-0197`                                   |
| Task title         | Admin-approved device registration, direct to cloud |
| Product/build      | KitLuy Suite — Store Hub / Pi fleet, Phase 1        |
| Primary agent      | Claude Opus 5 (1M context)                          |
| Status             | `PARTIAL`                                           |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`         |
| Worktree           | `repos/het-kitluy-project` (canonical, no worktree) |
| Base commit        | `866a2b4`                                           |
| Final commit       | `UNCOMMITTED`                                       |
| Handoff date       | 2026-08-17                                          |
| Requested reviewer | Owner (Veasna), then independent review             |

## 1. Outcome

A Raspberry Pi can now register itself to the cloud over HTTP, be recognised as
the **same physical board** after a reflash, and be admitted to the trusted fleet
only by an explicit HET decision.

Observable, and each proven below:

- The same board reflashed with a **new SD card, a new registration key and a new
  hostname** keeps one `device_record_id`, gains a new installation generation,
  adds no second device row, raises no evidence collision, and keeps its
  approval. This is plan §8.4 Test A, which the plan calls "the core
  requirement".
- An unknown board reaching the cloud lands in `manufactured` and can pair with
  nothing. Registration cannot produce `enrolled` under any input.
- A cloned SD card in a different board gets its OWN pending identity plus an
  open CRITICAL `credential_reuse_detected` incident, cannot be approved, and
  cannot make the legitimate board un-registerable.
- The registration identity can register and can do nothing else — proven both
  from the privilege graph and as live refusals while holding the role.

**Not deployed anywhere.** Nothing is committed. `kitluy-project-pos` remains at
95/95; 0197 is local-only. No Raspberry Pi has called the Edge Function.

## 2. Source-of-truth checked

| Source                                                  | Version             | Section/path                            | Result                                                       |
| ------------------------------------------------------- | ------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Owner plan, "Direct-to-Cloud Hybrid Trust Plan"         | v1.0.0 (2026-08-17) | §1–§9                                   | aligned; §1.5 Path D deviation corrected TO the plan         |
| `kitluy-decision-and-reconciliation-register-v1.0.0.md` | v1.0.0              | KLD-2026-08-11-DEVICE-LIFECYCLE-001     | option **D** now chosen; the open gap is closed              |
| `kitluy-storehub-phase1-spec-v1.0.0.md`                 | v1.0.0              | §2.2 non-goals; line 623; line 495      | conflict recorded and reconciled, not silently overridden    |
| `KLREC-2026-08-11-EDGE-006`                             | —                   | `GRANT <role> TO CURRENT_USER` segfault | respected; no such grant issued                              |
| Live schema (`kitluy_devices`, PG17 repo17)             | 95-group chain      | credential + enrollment + incidents     | credential generations already built and REUSED, not rebuilt |
| `supabase/functions/README.md`                          | —                   | "contract entry in docs/api/ first"     | followed; contract written before the function               |

## 3. Files changed

| Path                                                                                    | Change                                                       | Why                                                   | Generated |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | --------- |
| `supabase/migrations/20260817090000_0197_...sql`                                        | NEW — the whole database layer                               | plan §1.1–§1.7                                        | no        |
| `services/kitluy-device-firstboot-agent/test/device-registration-continuity.db.test.ts` | NEW — 20 tests                                               | plan §8.1, §8.2, §8.4, §2.4                           | no        |
| `packages/device-identity/src/device-registration-request.ts`                           | NEW — the canonical signing form, defined once               | plan §2.2                                             | no        |
| `packages/device-identity/src/index.ts`                                                 | one export line                                              | expose the above                                      | no        |
| `packages/device-identity/test/device-registration-canonical-parity.test.ts`            | NEW — 11 tests                                               | make the Deno copy safe                               | no        |
| `supabase/functions/_shared/device-registration-canonical.ts`                           | NEW — Deno twin of the canonical form                        | Deno cannot import a pnpm workspace pkg               | no        |
| `supabase/functions/device-registration/index.ts`                                       | NEW — the registration intake route                          | plan §2                                               | no        |
| `docs/api/device-registration-edge-function-v1.md`                                      | NEW — the contract                                           | plan §2.7 (contract first)                            | no        |
| `docs/api/000_INDEX.md`                                                                 | new "Edge Function contracts" section                        | index the contract without touching the four surfaces | no        |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`                  | NEW decision KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001 | plan §5.4; the migration cites this ID                | no        |
| `scripts/development/probe-device-registration-edge.mjs`                                | NEW — the HTTP contract probe                                | plan §8.5, made repeatable                            | no        |
| `package.json`                                                                          | `probe:device-registration` script                           | run the above                                         | no        |

`.prettierignore` and `eslint.config.mjs` were already modified before this
session and are **not** part of this work. `.agents/`, `.claude/`, `.mcp.json`,
`skills-lock.json` are untracked tooling, likewise not this work.

### Allowlist verification

`PASS` — every change is inside `supabase/`, `packages/device-identity/`,
`services/kitluy-device-firstboot-agent/test/`, `scripts/development/`, `docs/`
and `package.json`. No standalone repository was touched. No app internals were
crossed.

## 4. Implementation details

### The identity model, as built

Four lifecycles, deliberately separate:

```text
device_record_id                     opaque, server-generated, per BOARD
device_installations.generation      per SD/NVMe/reflash
manufacturing_enrollments.sequence   per registration key
device_credentials.certificate_generation  per operational credential (pre-existing)
```

Hardware evidence **resolves** the first; it never defines it. `board_serial`
resolves, `soc_serial` corroborates, MAC alone returns `TRUST_REVIEW_REQUIRED`
rather than merging two physical devices, and storage signals are excluded from
resolution entirely because they belong to installation history.

### Schema/data/migrations

`supabase/migrations/20260817090000_0197_device_self_registration_and_approval.sql`
— **applied to the local PG17 stack (`supabase_db_kitluy-repo17`, port 54392)
only.** Its own in-file assertions pass. It is additive: one nullable column, one
new table, one new enum value, new functions, one new role, new grants. No
existing table, column, trigger or grant is dropped and no row is deleted. The
`kitluy:destructive-approved:` marker cites the decision recorded in §2 above.

Adds: `devices.reported_hostname`; `device_installations` (append-only
generations); `trust_incident_type.credential_reuse_detected`;
`resolve_device_by_board_evidence_v1`; `register_device_v1`;
`approve_device_enrollment_v1`; `hardware_profile_id_for_key_v1`;
`kitluy_device_registration_service`; `fleet.device_enrollment.approve`.

Adds **no credential table** — `device_credentials.certificate_generation` with
`device_credential_heads.current_generation/previous_generation/overlap_ends_at`
already implements rotate-with-overlap and is reused unchanged.

### APIs/events/jobs

`POST /functions/v1/device-registration`. Contract:
`docs/api/device-registration-edge-function-v1.md`. Deployed to no project.

### Permissions/audit/security

- `kitluy_device_registration_service` holds EXECUTE on exactly
  `register_device_v1` and `hardware_profile_id_for_key_v1`, USAGE on
  `kitluy_devices`, and **no table privilege at all**. It cannot approve, enrol,
  re-enrol or activate.
- The approval door is granted to `service_role` only, requires a reason AND a
  verification-evidence reference, requires a second distinct approver in
  pilot/production, refuses any source state but `manufactured`, and refuses any
  device carrying an open trust incident.
- The Edge Function connects as `service_role` and immediately enters the
  restricted role for the transaction, so no statement touching device data runs
  with `BYPASSRLS`.
- No RLS policy was weakened. No four-eyes rule was relaxed — it is switched ON
  for pilot/production and is one admin plus a reason in development, which is an
  environment difference, not a relaxation.

### Offline/Store Hub/device impact

None yet on-device. The firstboot agent has **no registration client**, so no
image change was made and no device calls this route.

### Observability/docs

Decision register entry records the reconciliations, the two defects found, the
dishonest test, and an explicit "What is NOT built" list.

## 5. Validation performed

| Command/check                                                  | Environment         | Result               | Evidence                     |
| -------------------------------------------------------------- | ------------------- | -------------------- | ---------------------------- |
| apply 0197                                                     | local PG17 (repo17) | `PASS` + assertions  | `KLUY-MIGRATION-0197` notice |
| `vitest run test/device-registration-continuity.db.test.ts`    | local PG17          | `PASS` 20/20         | plan §8.1/§8.2/§8.4/§2.4     |
| `vitest run test/device-registration-canonical-parity.test.ts` | node 22.23.0        | `PASS` 11/11         | Node↔Deno byte parity        |
| `pnpm probe:device-registration` against a served function     | Deno 2.1.4 → PG17   | `PASS` 12/12         | plan §8.5                    |
| `pnpm secret:scan`                                             | local               | `PASS` (1845 files)  | —                            |
| `turbo typecheck` (device-identity, firstboot agent)           | local               | `PASS` 4/4 tasks     | —                            |
| `eslint` on all new files                                      | local               | `PASS` (no output)   | —                            |
| `prettier --write` on all changed files                        | local               | applied              | —                            |
| `pnpm verify`                                                  | local               | `RED — pre-existing` | see §7                       |

### Plan §8.4 acceptance evidence

| AC                                | Result | Evidence                                                                                         |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| A — same board, new key + install | `PASS` | `device_record_id` SAME, `installation_id` NEW, rows UNCHANGED, collision NONE, still `enrolled` |
| B — hostname only                 | `PASS` | same device, same installation, hostname updated                                                 |
| C — SD moved to another board     | `PASS` | new `device_record_id`, pending, D1 never reused                                                 |
| D — copied credential             | `PASS` | own pending record + CRITICAL incident + unapprovable + no poisoning                             |
| E — MAC-only match                | `PASS` | `TRUST_REVIEW_REQUIRED`, no merge                                                                |

## 6. Two real defects found in my own first implementation

Recorded because both would have shipped silently.

**The role could not be assumed.** PostgreSQL 16 gives a role's creator only an
ADMIN-option membership — `inherit_option` and `set_option` both false — so a
merely-created role can be entered by nobody. `SET LOCAL ROLE` is exactly how
every KitLuy service reaches its least-privilege identity, so 0197's role held
perfect grants and **could not have been used by the Edge Function that was going
to use it.** Fixed with `grant kitluy_device_registration_service to
service_role`, the statement 0192 and 0193 both have.

That defect was hidden by a test that passed dishonestly: `set local role …`
followed by `rejects.toThrow(/permission denied/)` passes when the SET ITSELF is
refused, and would have kept passing if the role held every privilege in the
schema. The SQLSTATE does not disambiguate — both refusals are 42501. The suite
now asserts the privilege graph AND asserts `current_user` immediately after the
SET.

**A revoked credential could be rotated around.** The append-only trigger would
have refused it, but as a raw `KLUY-DEVICE-ENROLLMENT-IMMUTABLE` error escaping a
function whose contract is to return a status. Now refused as
`KLUY-CREDENTIAL-REVOKED`, mutating nothing.

## 7. Not run / not verified

- **`pnpm verify` is RED, and the reasons are NOT the four the previous handoff
  recorded.** Measured this session; two of the four have changed, so the stale
  description is corrected here rather than repeated.

  | Step            | Result | Cause, measured                                                                                                                                                                                                                                                                                                                             |
  | --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Format check    | `FAIL` | `prettier --check .` cannot expand `.`: `EACCES` on `infra/kitluy-store-hub-image/build/work-ttyfix/chroot-v2.7.0/filesystem/home/pi`, a root-owned directory left by an image build. It also prints "All matched files use Prettier code style!" — so no source file is unformatted. Pre-existing; fixable by ignoring image build output. |
  | Unit tests      | `FAIL` | ONE package: `@kitluy/device-identity`. Its live suites default to `postgresql://…@127.0.0.1:54322`, which is `supabase_db_hsa_eco` — the HSA stack, holding **zero** `kitluy_devices` tables. `KITLUY_DEV_DB_URL` is unset. Pointed at repo17, `rotate-key-renewal.integration.test.ts` passes 15/15. Purely environmental.                |
  | Docs link check | `FAIL` | 4 broken links in `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md` (bare UUIDs). Pre-existing, unrelated.                                                                                                                                                                                 |
  | Lint            | `PASS` | The previously recorded 43 `no-undef` failures are **gone**. Not from this work — `eslint.config.mjs` was already modified in the working tree before this session.                                                                                                                                                                         |
  | Everything else | `PASS` | Typecheck, contract tests, offline harness, build, OpenAPI validation, migration validation, hub migration validation, secret scan, clock usage.                                                                                                                                                                                            |

  Because the single failing test package is one I changed, it was checked
  specifically rather than waved away. Run directly against the stack that carries
  the schema, `@kitluy/device-identity` is **899 passed, 0 failed, 23 skipped**
  across 39 of 42 suite files. The two remaining failures are suite-level SETUP
  refusals, not assertion failures, and their cause is now diagnosed — see below.

- **The two remaining `device-identity` failures are a PostgreSQL 16 behaviour
  change, not an environment quirk, and they can never pass as written.** Recorded
  as `KLREC-2026-08-17-PG16-ROLE-MEMBERSHIP-001`. The borrow guard asks
  `pg_has_role(current_user, 'kitluy_credential_issuer', 'MEMBER')`, which returns
  TRUE for PostgreSQL 16's admin-option-only creator membership while `SET ROLE` to
  that same role is REFUSED — both measured side by side. So the guard reports a
  borrow that confers no ability to assume the role and therefore cannot be one.

  **Left unfixed deliberately** (CLAUDE.md hard rule 1): out of this task's scope,
  and the guard protects OTHER sessions, so a careless tightening would let two
  runs revoke each other's borrow — a worse failure than a refusal. A candidate
  predicate is in the KLREC entry, unapplied.

  This is the same root cause as the defect in my own migration, seen from the
  opposite side: a bare `CREATE ROLE` understates usability to nothing, and
  `pg_has_role(…, 'MEMBER')` overstates it.

- **The 19 device-registry failures the previous handoff recorded were not
  reproduced.** `pnpm test` stops at `@kitluy/device-identity`, so 22 of 62 tasks
  never ran — the device-registry service among them. Its state is **unknown this
  session**, not "known red".
- **Not deployed to `kitluy-project-pos`.** 0197 and the Edge Function are local
  only. Deployment needs owner authorization.
- **No Raspberry Pi has registered.** Plan §8.8 hardware E2E is NOT done.
- **No operational certificate is issued by anything** — BLK-005. Approval makes
  a board provisioning-_eligible_ and issues nothing.
- **No rate limiting** on the unauthenticated route (contract §11).
- **The local stack cannot replay the full migration chain** (`0189` segfault,
  `KLREC-2026-08-11-EDGE-006`), so 0197 was applied onto an already-current repo17
  rather than from an empty database.

## 8. Risks and known limitations

| Severity | Risk                                                                     | Impact                                                      | Follow-up                                                           |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **HIGH** | `fleet-service.mjs`'s enrollment path still produces `enrolled` directly | the old bypass still exists alongside the new gate          | plan §5.3 — retire or reroute it through register + approve         |
| **HIGH** | No Admin "Verify & Approve" surface exists                               | pending devices can only be approved by SQL                 | plan §4 — `POST /management/v1/devices/{id}/approve-enrollment`     |
| MEDIUM   | Unauthenticated route, no rate limit                                     | anyone reaching it can create pending rows (fleet noise)    | transport limiting before non-development exposure                  |
| MEDIUM   | Hardware evidence is self-reported                                       | a liar gets a pending row an admin cannot match to hardware | inherent; approval is the control. OTP attestation is a future path |
| MEDIUM   | Earliest holder of a reused key is presumed legitimate                   | a first-mover clone could be the one presumed genuine       | HET review decides; the incident names both ends                    |
| LOW      | The canonical form is duplicated for Deno                                | drift would break registration silently                     | the parity suite fails on drift; keep it in `pnpm test`             |

## 9. Blockers and open decisions

- `BLK-005` — PKI/certificates. Bounds plan §6 and §8.8.
- `KLREC-2026-08-11-EDGE-006` — `0189` segfault, still OPEN.
- Open decision for the owner: **is `TRUST_REVIEW_REQUIRED` on MAC-only evidence
  acceptable operationally?** A Pi whose board serial is unreadable will need a
  manual step. No hardware has been observed failing to report `board_serial`, so
  this is unquantified rather than known-bad.

## 10. Rollback / recovery

Nothing is committed and nothing is deployed, so rollback is `git checkout` of the
listed files plus deleting the new ones. On the local stack, 0197's objects can be
dropped; no pre-existing object was altered, and the one enum value added cannot
be removed (PostgreSQL has no `DROP VALUE`) — it is inert if unused.

## 11. Review focus

- `register_device_v1` Path D and the **poisoning exclusion**. If that exclusion
  is wrong, one copied SD card locks a real Hub out of registration for ever.
- The rotation split: enrolled boards through `reenroll_device_v1`, pending boards
  superseding their own enrollment. Is the pending branch's direct write to
  `manufacturing_enrollments` acceptable, or should a governed door own it?
- The canonical signing form (contract §5) — reserved characters are REFUSED, not
  escaped. Confirm no real hardware signal can contain `;` or `=`.
- Whether `TRUST_REVIEW_REQUIRED` should also open an incident, as credential
  reuse does. Today ambiguity and containment return a status and record nothing.

## 12. Next step

In dependency order:

1. Retire the `enrolled`-producing development path (plan §5.3) — otherwise the
   new gate is optional.
2. Management API approval route + Admin Verify & Approve view (plan §4).
3. Device-side registration client, `installation_id` persistence, console states
   (plan §3).
4. Bake the cloud registration origin into the Store Hub image (plan §5.1).
5. Deploy 0197 + the function to `kitluy-project-pos` — **needs owner
   authorization**.
6. Hardware E2E on a real Pi, then the mandatory continuity reflash (plan §8.8).

## 13. Truth statement

- Production modified: `NO`.
- Hosted development project modified: `NO` — `kitluy-project-pos` untouched at 95/95.
- Secrets in code, docs, logs or this handoff: `NO`. `pnpm secret:scan` passed.
- Committed or pushed: `NO`.
- Capability claimed `IMPLEMENTED`: the **database layer** and the **Edge Function
  route** are `IMPLEMENTED-IN-DEV` with the evidence in §5. Everything in §7
  remains unbuilt or unverified and is not claimed.
