# KitLuy Google Drive Synchronization Policy

**Filename:** `DRIVE_SYNC_POLICY.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** APPROVED-TARGET (operating policy for documentation synchronization)
**Scope:** Google Drive ↔ `exported-drive-docs/kitluy/` ↔ `HET-KITLUY-PROJECT/docs/`
**Source documents:** workspace governance (`HET_VEASNA_WORKSPACE/CLAUDE.md`), KitLuy authority pack, `exported-drive-docs/kitluy/DRIVE_SOURCE_MANIFEST.md`
**Supersedes:** none — first issue
**Superseded by:** none
**Implementation evidence status:** POLICY (no code implements this; it governs agent and human behavior)

## 1. Purpose

Google Drive is an **upstream approved documentation source**, not a working
knowledge base. This policy exists so that normal KitLuy development runs
entirely from local files, and Drive is queried only for specific, justified
reasons.

> **The outcome this policy protects:** a development session should never begin
> with a general Google Drive search.

## 2. The three-tier model

```text
Google Drive                          upstream approved source
      |  controlled synchronization
      v
exported-drive-docs/kitluy/           Level A — immutable raw mirror + provenance
      |  classification + reconciliation
      v
HET-KITLUY-PROJECT/docs/              Level B — curated canonical knowledge
      |
      v
Claude Code / KIMI / coding agents    read Level B by default
```

| Tier | Location | Mutability | Who reads it |
| --- | --- | --- | --- |
| Drive | Google Drive | Owner-controlled | Humans; agents only under §5 |
| Level A | `exported-drive-docs/kitluy/` (workspace, outside the repo) | **Immutable evidence** | Agents resolving provenance or conflicts |
| Level B | `HET-KITLUY-PROJECT/docs/` | Curated, versioned in Git | **Agents, by default** |

**Level A is never edited to resolve a contradiction.** Contradictions are
resolved in the decision register
(`kitluy-decision-and-reconciliation-register-v1.0.0.md`), never by rewriting
evidence.

**Level A lives outside the repository** (workspace-level) deliberately: raw
mirrors are evidence, not deliverables, and must not inflate the repository or
compete with `docs/source/` as product truth.

## 3. Relationship to the existing `docs/source/` corpus

`docs/source/` is the **owner-supplied corpus** with its own mature provenance
system (KLSRC-#### IDs, versioned inventories, `inbox/` → classify → reconcile
workflow, `pnpm docs:verify` gates). It predates this policy.

This policy **does not replace it.** The two systems are complementary:

| System | ID prefix | Origin | Location |
| --- | --- | --- | --- |
| Owner-supplied corpus | `KLSRC-####` | Owner drops files into `docs/source/inbox/` | In-repo |
| Drive mirror | `KLDRV-####` | Pulled from Google Drive | Workspace-level |

A document may legitimately exist in both with different IDs. When it does, the
**in-repo `KLSRC` copy is the working authority** and the `KLDRV` record is the
upstream provenance trail.

## 4. Normal development — do not touch Drive

For any authorized development task, read in this order and stop as soon as the
question is answered:

1. `PROJECT_HOME.md`
2. `docs/authority/kitluy-source-of-truth-index-v1.0.0.md`
3. `docs/authority/kitluy-authority-and-precedence-v1.0.0.md`
4. `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
5. The relevant product/vertical documentation under `docs/`
6. The latest handoff in `00_AI_HANDOFF/`
7. Live code, migrations and tests

**Do not query Google Drive during normal development.** Do not re-scan Drive at
the start of a session. Do not "refresh" opportunistically.

## 5. When a Drive query IS authorized

Query Drive **only** when one of these holds, and only for the specific
documents concerned:

1. The local manifest says a required source is **missing** or
   `INDEXED-NOT-MIRRORED` and the task genuinely needs its content.
2. The **owner explicitly requests** a refresh.
3. A **source conflict** requires upstream verification to resolve.
4. The local copy is **known to be stale** (recorded, not assumed).
5. A **new approved document** is known to exist.
6. **Exact source provenance** must be established or cited.

A hunch that "there might be something newer" is **not** a trigger. Neither is
"being thorough".

### Scope discipline

An authorized query is **narrow**. Fetch the identified document by its
`drive_file_id` from the manifest. Do not enumerate folders, do not sweep by
title, do not opportunistically pull neighbours.

## 6. Refresh procedure (targeted)

1. Locate the row in `DRIVE_SOURCE_MANIFEST.json`; take `drive_file_id`.
2. Fetch **only** that document.
3. Compare `drive_modified_time` against the manifest's recorded value.
4. If unchanged → record the check; change nothing.
5. If changed → write the new content to `local_mirror_path`, update
   `content_checksum_sha256`, `drive_modified_time` and `local_sync_time`.
   **Never overwrite the previous version silently** — move it to
   `exported-drive-docs/kitluy/superseded/` with its original provenance header
   intact.
6. If the change affects curated Level B content, open a reconciliation entry.
7. Report what changed.

## 7. Full refresh

A full re-inventory of Drive is an **intentional, owner-requested operation**.
It is never automatic, never scheduled, and never a side effect of another task.

When run: extend the manifest with new `KLDRV` IDs continuing the sequence.
**Never renumber or overwrite existing IDs** — they are cited elsewhere.

## 8. Conflict handling

When a Drive source contradicts local canonical documentation:

1. **Preserve both.** Never delete or edit either to make the conflict disappear.
2. Record the conflict in
   `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`.
3. Apply the precedence ladder in
   `kitluy-authority-and-precedence-v1.0.0.md`.
4. If precedence does not settle it, mark the source `UNRESOLVED` in the
   manifest and **stop** — escalate to the owner. Do not pick a winner.

**Standing finding:** the repository currently holds *newer* canonical authority
than Drive (rebuild bible v4.0.0 vs Drive's v3.0.0; business bible v2.0.0 vs
Drive's v1.0.0). Drive material must not be used to "correct" local canonical
documents without explicit owner authority.

## 9. Deleted or unavailable Drive document

**Do not delete the local mirror.** Mark the manifest row:

```text
status: SOURCE_REMOVED_OR_UNAVAILABLE
```

Record the date and how it was detected. Preserve the local copy and its
checksum until the owner reviews. A document disappearing from Drive is not
evidence that it was withdrawn — it may have been moved, re-shared, or
permission-changed.

## 10. Superseded document

When a mirrored source is superseded:

1. Move it to `exported-drive-docs/kitluy/superseded/`.
2. Keep its provenance header **unchanged**.
3. Set `authority_class: SUPERSEDED` and populate `superseded_by`.
4. Record the supersession in
   `docs/authority/kitluy-superseded-document-register-v1.0.0.md`.

Provenance survives supersession. Never delete.

## 11. Secret safety — absolute

- **Never mirror a Drive document containing real credentials.**
- Record only a secret *reference*: document name, location, risk. **Never a value.**
- Never copy `.env` content, private keys, service-role keys, cloud access keys,
  payment credentials, API tokens, certificate private keys, Minisign private
  keys, or device private keys into the mirror or the repository.
- Review a document **before** writing it to the mirror, not after.
- If credential material is found in a Drive document, report it by
  **filename and risk only** and stop.

## 12. Never mirror source code

Drive holds `HET-KITLUY-PROJECT.zip` (240 MB) and several `.bundle` Git archives.

**These must never become a working source.** Workspace rule: never develop from
a Google Drive source-code snapshot. The live Git repository at
`repos/het-kitluy-project` is the only authoritative source of
code, history, migrations, tests and CI configuration.

## 13. Out-of-scope documents

Do **not** ingest HSA, PlantOS, HSAL, Canvar, Netra, Rotanak, Prajna or other
non-KitLuy project documents as KitLuy product truth. They may be referenced
only when an approved KitLuy document explicitly cites them — and then they are
classified `REFERENCE`, never `CANONICAL`.

## 14. Compliance check

Before finishing any session that touched documentation:

- [ ] No Drive query was made outside §5.
- [ ] Any Drive query fetched only identified documents.
- [ ] No Level A file was edited to resolve a contradiction.
- [ ] Any conflict found was recorded, not silently resolved.
- [ ] No credential value was copied anywhere.
- [ ] Manifest updated if any mirror changed.

---

**Related:** `LOCAL_DOCUMENTATION_MAP.md` (what lives where),
`kitluy-authority-and-precedence-v1.0.0.md` (which source wins),
`exported-drive-docs/kitluy/DRIVE_SOURCE_MANIFEST.md` (the index itself).
