# KitLuy Task Handoff — owner device-lifecycle workflow ingested as authority

## 0. Identity

| Field              | Value                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Task ID            | `KL-DOCS-BATCH4`                                                                                                           |
| Task title         | Register the owner device factory-enrollment / Store provisioning / Pi Terminal workflow as authority, with reconciliation |
| Product/build      | Documentation authority (edge platform scope)                                                                              |
| Primary agent      | Claude Opus 5                                                                                                              |
| Status             | `HANDOFF_READY`                                                                                                            |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                                                                                |
| Worktree           | `repos/het-kitluy-project` (canonical, no worktree)                                                                        |
| Base commit        | `209afc2`                                                                                                                  |
| Final commit       | `UNCOMMITTED`                                                                                                              |
| Handoff date       | 2026-08-11                                                                                                                 |
| Requested reviewer | Project owner                                                                                                              |

## 1. Outcome

The owner-supplied workflow document was ingested through the documented
corpus pipeline and registered as an authority source. **No code, schema,
migration or device behavior was changed.**

What now exists:

- `KLSRC-0162` in the source manifest, classified at
  `docs/source/owner-decisions/kitluy-device-factory-enrollment-store-provisioning-and-pi-terminal-workflow-v1.0.0.md`
  (sha256 `f7450080…d136a11`).
- `SOT-028` in the source-of-truth index repository addendum.
- Four register entries: `KLD-2026-08-11-DEVICE-LIFECYCLE-001` and
  `KLREC-2026-08-11-EDGE-001` / `-002` / `-003`.

**The headline finding for whoever continues the edge mission:** the workflow
**does not unblock** `28_PI_TERMINAL_MISSION_BLOCKERS.md`. It removes one
option from DEC-2 and supplies an argument for one option in DEC-1, and both
decisions remain owner-required. Details in KLREC-2026-08-11-EDGE-001.

## 2. Source-of-truth checked

| Source                                                  | Version/commit | Section/path                       | Result                                       |
| ------------------------------------------------------- | -------------- | ---------------------------------- | -------------------------------------------- |
| Owner workflow document                                 | v1.0.0         | §1–§40                             | Ingested as KLSRC-0162                       |
| `docs/source/000_INDEX.md`                              | current        | Ingestion workflow for a new batch | Followed, all 7 steps                        |
| `kitluy-source-of-truth-index-v1.0.0.md`                | v1.0.0         | Repository addendum                | Extended (owner rows untouched)              |
| `kitluy-decision-and-reconciliation-register-v1.0.0.md` | v1.0.0         | Appended sections                  | 4 entries added                              |
| `28_PI_TERMINAL_MISSION_BLOCKERS.md`                    | 2026-08-10     | DEC-1, DEC-2, DEC-3                | **Conflict narrowed, not resolved**          |
| `0120_device_enrollment_and_identity.sql:85`            | applied        | `device_class` enum                | Aligned — doc names match canonical exactly  |
| `0050_configuration.sql:47-55`                          | applied        | configuration scope columns        | Partial name divergence — mapped in EDGE-002 |
| `0020_digital_store_and_location.sql:33`                | applied        | `primary_vertical_code`            | Name divergence — mapped in EDGE-002         |
| `0162_terminal_provisioning_codes.sql:76`               | applied        | `store_hub_device_id not null`     | Aligned — §31 already schema-enforced        |
| `0122_device_trust_decision_alignment.sql:752`          | applied        | `enroll_device_v1` signature       | **Unreconciled with §4** — see EDGE-001      |

## 3. Files changed

| Path                                                                         | Change summary                                               | Why                          | Generated?          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- | ------------------- |
| `docs/source/owner-decisions/…-pi-terminal-workflow-v1.0.0.md`               | New classified source copy                                   | Corpus ingestion step 3      | yes (classify.mjs)  |
| `docs/source/manifests/kitluy-inbox-inventory-v1.3.0.{json,csv,md}`          | New batch inventory                                          | Ingestion step 2             | yes (inventory.mjs) |
| `docs/source/manifests/kitluy-source-document-manifest-v1.0.0.{json,csv,md}` | `KLSRC-0162` appended, 161 → 162 sources                     | Ingestion step 2             | yes (classify.mjs)  |
| `scripts/docs/classification-map.mjs`                                        | `BATCH4_RULES` added and wired into `classify()`             | Required before classify.mjs | no                  |
| `.prettierignore`                                                            | `docs/source/owner-decisions` added                          | See "Why the ignore" below   | no                  |
| `docs/authority/kitluy-source-of-truth-index-v1.0.0.md`                      | Batch-4 addendum section + SOT-028 row + authority limits    | Index maintenance rule §5    | no                  |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`       | 4 entries appended                                           | Conflict-recording rule      | no                  |
| `docs/authority/LOCAL_DOCUMENTATION_MAP.md`                                  | `owner-decisions/` documented; device-lifecycle reading list | Local-first navigation       | no                  |
| `docs/source/000_INDEX.md`                                                   | Batch 3 and batch 4 recorded; reserved list corrected        | Taxonomy accuracy            | no                  |

### Why the `.prettierignore` change is load-bearing

Every other classified taxonomy directory is already prettier-ignored.
`owner-decisions/` was not, because it had never been used. A prettier pass
would have reformatted the classified copy and broken the `sha256` that
`docs:classify` uses as its provenance anchor — turning a silent format run
into a corpus-integrity failure. Verified after the change: the classified
copy's hash is unchanged and `prettier --check` matches no file in that
directory.

## 4. Implementation details

### Functional behavior

None. This task produced documentation and manifest records only.

### Schema/data/migrations

**NONE.** No migration was created, modified or applied, to any environment.
KLREC-2026-08-11-EDGE-002 records explicitly that §30 of the document needs no
new enum and that the document authorizes no migration.

### Permissions/audit/security

Unchanged. `pnpm secret:scan` passed over 1513 tracked files. The ingested
document contains no credentials; its §33/§34 are prohibitions, not values.

## 5. Verification — ACTUAL results

`pnpm docs:verify` — **7 PASS / 1 FAIL, byte-identical to the pre-change baseline
captured at the start of this task.**

```text
PASS  Inbox state (no un-ingested sources)
PASS  Hashes
PASS  Duplicates & canonical collisions
PASS  Classification & original links
PASS  Authority index completeness
PASS  Coverage matrix vs filesystem
PASS  Status register evidence
FAIL  Internal links   <- 4 pre-existing broken links, all in
                          00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__
                          PHASE-E-PROMOTION-GATE__AI-HANDOFF.md (bare UUIDs)
```

`pnpm verify` — **4 failures, none attributable to this task:**

| Check                                                                                                                                | Result | Attribution                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check                                                                                                                         | FAIL   | 79 files, all pre-existing untracked/modified WS-11/WS-12 work (`.agents/`, `.mcp.json`, `00_AI_HANDOFF/edge-platform/26–32`, reviews). **Cross-checked: none of this task's files appear in the list.**                               |
| Lint                                                                                                                                 | FAIL   | 16 errors / 6 warnings in `infra/kitluy-os-image/…/firstboot-agent/bin/*.js` (`setTimeout` no-undef), `scripts/database/db-deploy-hosted-dev.mjs`, test files. None touched here.                                                      |
| Unit tests                                                                                                                           | FAIL   | 3 of 139 in `services/kitluy-device-firstboot-agent/test/trusted-time-activation.db.test.ts` — `expected 'restricted_forward_jump' to be 'trusted'`. State-dependent DB test against the persistent local stack; no code touched here. |
| Docs link check                                                                                                                      | FAIL   | The same 4 pre-existing broken links as above.                                                                                                                                                                                         |
| Typecheck, contract tests, offline harness, build, OpenAPI, migration validation, hub migration validation, secret scan, clock usage | PASS   | —                                                                                                                                                                                                                                      |

Attribution method: the failing files were cross-checked against this task's
changed-file list; there is no overlap. The pre-existing failures were **not**
fixed — that is separate work, outside this scope.

## 6. Conflicts and required owner decisions

| ID                          | State                       | What is needed                                                                                                                                                                                                                         |
| --------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KLREC-2026-08-11-EDGE-001` | **OPEN — owner required**   | DEC-2: choose B (per-device secret at flash time), C (Pi 5 hardware root of trust) or D (open enrollment + quarantine, dev only). Option A is eliminated by §4. DEC-1: choose whether the bootstrap agent set is baked into the image. |
| `KLREC-2026-08-11-EDGE-002` | RESOLVED — mapping recorded | Nothing. Use canonical names; `store_hub_device_id`, `store_location_id`, `primary_vertical_code`.                                                                                                                                     |
| `KLREC-2026-08-11-EDGE-003` | RESOLVED — recorded         | Nothing. The recorded hash is of the mojibake-normalized text.                                                                                                                                                                         |

## 7. Recorded but deliberately not fixed (out of scope)

1. **`extractDeclared` header heuristic** (`scripts/docs/lib.mjs`) leaves
   `document_date` and `declared_owner` empty for `**Date:** …` headers where
   the colon sits inside the emphasis markers. Earlier batches show the same
   empty fields. Frozen records were not touched.
2. **4 broken links** in the WS-11-T003 Phase-E handoff (bare UUIDs, not
   paths) — the sole `docs:verify` failure, pre-existing.
3. **79 format-check files and 22 lint problems** from in-flight WS-11/WS-12
   work.
4. **3 trusted-time DB test failures** — state-dependent, needs a clean
   `db:reset` on the local PG17 target to get a clean verdict.

## 8. Next step

The next edge-platform action is **an owner decision, not code**: DEC-1 and
DEC-2 in `00_AI_HANDOFF/edge-platform/28_PI_TERMINAL_MISSION_BLOCKERS.md`,
now narrowed by KLREC-2026-08-11-EDGE-001. Milestone 2 (automatic factory
enrollment) cannot be built until DEC-2 is chosen, because the canonical
enrollment door requires a manufacturing station and operator that a
field-booting Pi does not have.
