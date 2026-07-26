# KitLuy Provisional Governance Comparison — v1.0.0

Task KL-DOCS-001, 2026-07-26 (Phase E). Semantic comparison of the eight
bootstrap-recreated governance documents against the owner-supplied originals,
and the replacement actions taken. Bootstrap versions are preserved in git at
commit `4a79f66`; owner originals are immutable at `docs/source/canonical/`;
working copies at `docs/authority/` (and repo-root PROJECT_HOME.md) contain
the owner text plus clearly marked repository addenda. No owner text was
edited; no conflicting requirements were merged silently.

## Global comparison findings

- The owner pack contains **none** of the bootstrap identifiers (KLREC-_,
  KLBOOT-DEC-_, KLREQ-_, ADR-_) — it was authored independently.
- The owner pack was written against a **pre-v4-bible bundle**: it declares
  RB v4.0.0 / BB v2.0.0 missing, cites only superseded bibles in its
  open-value ledger (343/827 occurrences from ecosystem-business-bible
  v1.0.0), and its evidence baseline states no repository was supplied.
  All three staleness classes are corrected via addenda
  (KLREC-2026-07-26-005/-008).
- **No contradictions with owner-locked invariants** in either direction.
- The owner implementation-status model (11 statuses PROPOSED→DEPRECATED,
  evidence classes E-REPO..E-PROD, transition gates) **replaces** the
  bootstrap SCAFFOLDED/BUILT/TESTED vocabulary.

## Per-document actions

| Document                                                     | Action                                                                                                  | Repo-only content preserved (as addendum/proposal)                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROJECT_HOME.md                                              | Replaced with owner original + operations addendum                                                      | Repository map, run/test/validation commands, migration + handoff rules, current-blockers list; stale §2 "bibles missing" gate corrected (KLREC-2026-07-26-005)                                                                                                        |
| kitluy-source-of-truth-index-v1.0.0.md                       | Replaced + addendum                                                                                     | Missing-file findings (feature registry .md/.json, decision-lock file, security-lock spec), SOT-010/011/027 state corrections, newly ingested 102-source corpus pointer, prior-code rows, owner-decision ID traceability                                               |
| kitluy-authority-and-precedence-v1.0.0.md                    | Replaced as-is (+pointer note)                                                                          | Bootstrap status vocabulary DROPPED (superseded by owner model); handoff-location pointer kept                                                                                                                                                                         |
| kitluy-decision-and-reconciliation-register-v1.0.0.md        | Replaced + critical addendum                                                                            | KLREC-2026-07-26-001..013 (open conflicts; -001 cited by live code), KLBOOT-DEC-001..009, ADR links, KLV4-DEC traceability                                                                                                                                             |
| kitluy-open-decisions-and-required-values-v1.0.0.md          | Owner original kept as single immutable 2.2 MB copy; working file = pointer + addendum (KLBOOT-DEC-008) | KLREQ-001..007 with post-ingestion states (KLREQ-003 SATISFIED), repo-level required values (section F), staleness note + rescan proposal                                                                                                                              |
| kitluy-implementation-status-and-evidence-register-v1.0.0.md | Replaced + critical addendum                                                                            | All repository evidence rows re-registered under the owner model (BUILT/TESTED → SCAFFOLDED with E-REPO/E-TEST evidence, KLREC-2026-07-26-008); machine-checkable table validated by `pnpm docs:registry-check`; documentation-status upgrades from the ingested packs |
| kitluy-superseded-document-register-v1.0.0.md                | Replaced + addendum                                                                                     | Machine-found superseded-file rows, retired terminal identifiers, SUP-001/002 staleness note                                                                                                                                                                           |
| kitluy-glossary-and-naming-standard-v1.0.0.md                | Replaced + addendum                                                                                     | Terminal profile identifier strings (with KLREC-2026-07-26-009 flag), event/permission-key formats (with -011/-013 flags), package namespaces, cardinality invariants, BB verbatim definitions                                                                         |

## Proposals registered for owner review

1. Update SOT-010/011 rows: bibles present, canonical, dated 2026-07-26.
2. Resolve SOT-027: supply `kitluy-owner-decision-lock-12-capabilities-v1.0.md`
   or amend the row to cite RB v4 §11.2.
3. Index the 102 newly ingested sources as SOT rows (or adopt the source
   manifest as the index extension).
4. Re-scan the open-value register against RB v4/BB v2; retire ledger rows
   sourced solely from superseded bibles.
5. Correct the evidence-register §4 baseline (repository now exists with
   verified evidence).
6. Supply the three missing Supabase pack members and re-issue the pack
   checksum file against the regenerated members.
