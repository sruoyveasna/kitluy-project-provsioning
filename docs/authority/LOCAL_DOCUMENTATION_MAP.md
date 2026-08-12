# KitLuy Local Documentation Map

**Filename:** `LOCAL_DOCUMENTATION_MAP.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** REFERENCE (navigation aid; confers no product authority)
**Scope:** All documentation reachable from `HET-KITLUY-PROJECT` without Google Drive
**Source documents:** direct inspection of the repository, 2026-08-07
**Supersedes:** none — first issue
**Superseded by:** none
**Implementation evidence status:** OBSERVED (counts measured, not estimated)

## 1. Purpose

Answer one question fast: **"where do I read about X locally?"**

This map exists so no agent needs a Google Drive search to find KitLuy
documentation. It is a finding aid — the documents it points to carry the
authority, not this file.

## 2. Where the repository lives

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
```

## 3. Read order (always)

| # | File | Why |
| --- | --- | --- |
| 1 | `PROJECT_HOME.md` | Identity, locked direction, T1–T4, stop conditions |
| 2 | `docs/authority/kitluy-authority-and-precedence-v1.0.0.md` | Which source wins a conflict |
| 3 | `docs/authority/kitluy-source-of-truth-index-v1.0.0.md` | What document defines what |
| 4 | `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md` | Built vs scaffolded — **check before any status claim** |
| 5 | `00_AI_HANDOFF/000_CURRENT_STATE.md` + `000_ACTIVE_PHASE.md` + `000_BLOCKERS.md` | Where work stands now |
| 6 | Domain documentation below | The actual subject matter |
| 7 | Live code, migrations, tests | Ground truth |

## 4. Governance pack — `docs/authority/` (10 files)

> The mission brief called this `docs/00-governance/`. The established location
> is `docs/authority/`. **Use `docs/authority/`.** No parallel directory exists
> and none should be created.

| File | Answers |
| --- | --- |
| `kitluy-source-of-truth-index-v1.0.0.md` | What document defines this? Which version is current? Who owns it? What did it supersede? Where is the local copy? |
| `kitluy-authority-and-precedence-v1.0.0.md` | When two documents disagree, which wins? |
| `kitluy-decision-and-reconciliation-register-v1.0.0.md` | What conflicts exist and how were they resolved? |
| `kitluy-open-decisions-and-required-values-v1.0.0.md` | What `[REQUIRED: …]` values are still unknown? |
| `kitluy-implementation-status-and-evidence-register-v1.0.0.md` | What is actually built, with what evidence? |
| `kitluy-superseded-document-register-v1.0.0.md` | What must never be reintroduced? |
| `kitluy-glossary-and-naming-standard-v1.0.0.md` | What does this term mean? What is the canonical name? |
| `DRIVE_SYNC_POLICY.md` | When may I query Google Drive? |
| `LOCAL_DOCUMENTATION_MAP.md` | This file |
| `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md` | Where would each standalone repo eventually land? (mapping only) |

## 5. Documentation domains — `docs/` (290 Markdown files)

| Directory | Files | Contents |
| --- | --- | --- |
| `docs/source/` | 197 | **Owner-supplied corpus** — immutable classified copies + `manifests/` (KLSRC IDs) |
| `docs/evidence/` | 33 | Implementation evidence, `phase1/` |
| `docs/decisions/` | 18 | ADRs + owner decisions (`kitluy-*-owner-decision-v*.md`) |
| `docs/data/` | 9 | Schema, data dictionary, enums, reference data |
| `docs/authority/` | 10 | Governance pack (§4) |
| `docs/security/` | 7 | RBAC permission registry + amendments, audit registry, security test plan |
| `docs/runbooks/` | 3 | Operational procedures |
| `docs/jobs/` | 2 | Background jobs |
| `docs/api/` | 1 | API surface documentation |
| `docs/architecture/` | 1 | Architecture maps |
| `docs/business-rules/` | 1 | Business rule specifications |
| `docs/events/` | 1 | Event contracts |
| `docs/generated/` | 1 | Generated artifacts — **never hand-edit** |
| `docs/infrastructure/` | 1 | Infrastructure documentation |
| `docs/offline/` | 1 | Offline/sync behavior |
| `docs/product/` | 1 | Product specifications |
| `docs/qa/` | 1 | QA plans |
| `docs/services/` | 1 | Service documentation |
| `docs/superseded/` | 1 | Superseded index |
| `docs/verticals/` | 1 | Vertical specifications |
| `docs/webhooks/` | 1 | Webhook contracts |

### `docs/source/` internal structure

| Path | Role |
| --- | --- |
| `canonical/` | **The two master bibles** (rebuild v4.0.0, business v2.0.0) + owner control-pack originals |
| `manifests/` | KLSRC inventories (v1.0.0–v1.3.0) in md/json/csv + collision registry |
| `inbox/` | Transient owner drop zone — **empty when clean** |
| `processed/reconciliation/` | Coverage matrix, authority map, conflict report, supersession map |
| `owner-instructions/` | AI Swarm Operating System pack |
| `owner-decisions/` | Owner workflow/architecture decisions — device lifecycle workflow v1.0.0 (KLSRC-0162, SOT-028) |
| Classified copies | `api-contracts/ data-contracts/ business-rules/ security/ offline/ shared-services/ ui-ux/ engineering/ qa/ infrastructure/` |
| Reserved (empty) | `product-specs/ architecture/ feature-registry/ approved-handoffs/ research/ competitor-rebuilds/ superseded/ unclassified/` |

### Device lifecycle — where the authority actually lives

The owner device workflow (`owner-decisions/…-pi-terminal-workflow-v1.0.0.md`)
is **direction only**. Read it with its three reconciliation entries, which
record what it settles and what it deliberately leaves open:

| Question | Read |
| --- | --- |
| What the workflow establishes | KLD-2026-08-11-DEVICE-LIFECYCLE-001 |
| Whether the edge blockers are closed | KLREC-2026-08-11-EDGE-001 — **DEC-1 and DEC-2 remain open** |
| Canonical field names (`store_hub_device_id`, `primary_vertical_code`, …) | KLREC-2026-08-11-EDGE-002 |
| Why the ingested copy differs byte-wise from the transfer | KLREC-2026-08-11-EDGE-003 |

## 6. Canonical master authority

| Document | Path |
| --- | --- |
| **KitLuy Suite Rebuild Bible v4.0.0** | `docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md` |
| **KitLuy Suite Business Bible v2.0.0** | `docs/source/canonical/kitluy-suite-business-bible-v2.0.0.md` |

> **Note on `PROJECT_HOME.md` §2.** It states both bibles are "NOT PRESENT in
> the supplied source bundle". That claim is **stale** — both are physically
> present at the paths above. The correction is recorded in the PROJECT_HOME
> Repository Operations Addendum (KLREC-2026-07-26-005). Owner text is never
> silently edited, which is why the original wording remains.

**No Google Drive document outranks these.** Drive's highest versions are
rebuild bible v3.0.0 and business bible v1.0.0 — both superseded.

## 7. Question → location

| Question | Read |
| --- | --- |
| What is KitLuy? | `PROJECT_HOME.md` §3; rebuild bible v4.0.0 |
| Current active vertical? | `00_AI_HANDOFF/000_ACTIVE_PHASE.md`; `verticals/phase1-laundry/` |
| The eight vertical phases? | `PROJECT_HOME.md` §3.1; `verticals/` |
| Digital Store vs Store Location? | `PROJECT_HOME.md` §3.2; glossary |
| What does the Store Hub own? | `PROJECT_HOME.md` §3.5; `services/kitluy-hub-agent/`; `hub/` |
| T1–T4 roles? | `PROJECT_HOME.md` §3.6; `verticals/phase1-laundry/` |
| Offline operation? | `docs/offline/`; `packages/sync-protocol/`; `tests/offline/` |
| The four API surfaces? | `services/kitluy-{management,commerce-store,edge-operations,connector}-api/`; `docs/api/` |
| What owns files? | DigitalOcean Spaces — `PROJECT_HOME.md` §3.7; `services/kitluy-file-service/` |
| What owns cloud database/auth? | Supabase — `PROJECT_HOME.md` §3.7; `supabase/` |
| What owns app/service compute? | DigitalOcean — `PROJECT_HOME.md` §3.7; `infra/digitalocean/` |
| Device provisioning sequence? | `services/kitluy-provisioning-service/`; `infra/kitluy-os-image/`; `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md` |
| Authorization model? | `docs/security/kitluy-suite-rbac-permission-registry-amendment-*.md`; `packages/rbac/`, `packages/auth/`, `packages/approvals/`; `tests/rls/` |
| Phase 1 Laundry definition? | `verticals/phase1-laundry/`; rebuild bible v4.0.0; `docs/decisions/kitluy-ws12-*` |
| Implemented vs planned? | `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md` — **the only valid answer** |
| Active migration? | `supabase/migrations/` (87 files); `supabase/migrations/README.md` |
| Current blockers? | `00_AI_HANDOFF/000_BLOCKERS.md`; `kitluy-open-decisions-and-required-values-v1.0.0.md` |
| Where are the tests? | `tests/{chaos,contract,end-to-end,hardware,integration,load,offline,recovery,rls,security}/` |
| How to start safely? | `CLAUDE.md` → `PROJECT_HOME.md` → authority pack → latest handoff |

## 8. Code as documentation

| Path | Count | What it tells you |
| --- | --- | --- |
| `apps/` | 8 | Phase 1 product shells |
| `services/` | 19 | 4 governed APIs + shared services + Store Hub agent |
| `packages/` | 43 | Neutral shared Core — **no vertical terminology** |
| `verticals/` | 9 | `phase1-laundry` active; phases 2–8 registered-inactive |
| `future-clients/` | 3 | Registered-inactive Phase 2+ clients |
| `supabase/migrations/` | 87 | Applied schema history — **evidence, not plans** |
| `hub/` | — | Store Hub migrations, seed, tests |
| `infra/` | 9 dirs | Terraform, DigitalOcean, Kubernetes, OS image, monitoring, policies |
| `tests/` | 10 dirs | Verification surface |
| `scripts/` | 9 dirs | Tooling (the mission diagram called this `tooling/`) |

## 9. Handoff system — `00_AI_HANDOFF/`

| Path | Role |
| --- | --- |
| `000_INDEX.md` | Handoff index — **update when you add one** |
| `000_CURRENT_STATE.md` | Where the work stands |
| `000_ACTIVE_PHASE.md` | Active vertical |
| `000_BLOCKERS.md` | What is blocked |
| `preparation/` | Workspace preparation reports (this mission) |
| `tasks/` | Active task records |
| `reviews/` | Review records |
| `apps/ data/ evidence/ infrastructure/ repository/ services/ shared/` | Per-area handoffs |
| `*_TEMPLATE.md` | Task, handoff, review, conflict, rollback, evidence templates |

## 10. Workspace-level (outside the repository)

| Path | Contents |
| --- | --- |
| `exported-drive-docs/kitluy/` | **Level A immutable Drive mirror** + `DRIVE_SOURCE_MANIFEST.{md,json}` (45 indexed sources) |
| `workspace-control/workspace.yaml` | Authoritative repository path registry |
| `workspace-control/REPOSITORY_REGISTRY.md` | Repository registry |
| `repos/het-kitluy-standalone-repos/kitluy-*` | Six standalone KitLuy repositories — **reference only, do not modify for monorepo work** |

## 11. Rules this map does not override

- Never call something `IMPLEMENTED` from a Markdown file. Check the evidence register.
- Never edit `docs/source/` classified copies or `exported-drive-docs/` mirrors to resolve a conflict — record it in the decision register.
- Never guess a `[REQUIRED: …]` value.
- Never query Google Drive outside `DRIVE_SYNC_POLICY.md` §5.

---

**Verification:** `pnpm docs:verify` runs the documentation-governance suite
(inventory, hashes, duplicates, classification, authority, coverage,
status-register evidence, links).
