# Google Drive Ingestion Report

**Filename:** `GOOGLE_DRIVE_INGESTION_REPORT.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (what was inventoried and mirrored)
**Scope:** Google Drive account `het.hosting01@gmail.com`, KitLuy material
**Source documents:** `exported-drive-docs/kitluy/DRIVE_SOURCE_MANIFEST.{md,json}`
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. Headline result

> **Google Drive holds no canonical KitLuy authority. The repository does.**

| Document family      | Newest on Drive       | In repository | Verdict                  |
| -------------------- | --------------------- | ------------- | ------------------------ |
| Suite Rebuild Bible  | `v3.0.0` (2026-07-20) | **`v4.0.0`**  | Repository authoritative |
| Suite Business Bible | `v1.0.0` (2026-07-20) | **`v2.0.0`**  | Repository authoritative |

Both repository copies are at `docs/source/canonical/`. Every Drive bible copy
is therefore **SUPERSEDED** for product direction.

This inverts the naive assumption behind "sync docs down from Drive". Drive's
genuine unique value is its **competitor research corpus** and **R&D material**
— not product truth.

## 2. What was ingested

| Metric                               | Count  |
| ------------------------------------ | ------ |
| Sources indexed with full provenance | **45** |
| Physically mirrored (content local)  | **2**  |
| Indexed, content not mirrored        | **43** |
| Deliberately excluded                | **6**  |
| Classified `UNRESOLVED`              | **0**  |

### Mirror location

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/exported-drive-docs/kitluy/
├── DRIVE_SOURCE_MANIFEST.md      # human-readable index
├── DRIVE_SOURCE_MANIFEST.json    # machine-readable (validated)
├── owner-decisions/              # KLDRV-0001
├── architecture/                 # KLDRV-0002
└── 13 further classification folders (empty, reserved)
```

Level A lives **outside the repository** deliberately: raw mirrors are evidence,
not deliverables, and must not compete with `docs/source/` as product truth.

## 3. Why 2 mirrored and not 45

**This was not a blind copy operation** — mission §7 forbids that, and a blind
copy would have been actively harmful here.

Each non-mirrored source carries a **complete provenance record** (Drive file ID,
URL, folder, size, modified time, authority class, supersession). That is
sufficient to retrieve it on demand. `INDEXED-NOT-MIRRORED` is a deliberate
state, not a gap.

Reasons, by group:

| Group                              | Count | Why not mirrored                                                                                                                      |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Suite + product bibles             | 12    | **Superseded** by newer local versions. Mirroring would create competing copies of product truth inside the workspace                 |
| Competitor research                | 15    | `COMPETITOR-EVIDENCE` / `COMPETITOR-DESIGN-REFERENCE`. **Not required for authorized development.** Never an implementation authority |
| R&D corpus                         | 4     | `REFERENCE` only                                                                                                                      |
| Legacy-repository operational docs | 11    | Scoped to the six standalone repositories, not the monorepo                                                                           |
| Handoffs / charters                | 3     | Legacy-repo and cross-ecosystem scope                                                                                                 |

### The two that were mirrored

| ID           | Document                                                               | Class            | Why                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `KLDRV-0001` | KitLuy Laundry POS — Native Source-of-Truth Clarification (2026-07-18) | **OWNER-LOCKED** | Highest authority class found on Drive. Establishes KitLuy Suite Supabase as sole backend and the Order → Service → Service Item model |
| `KLDRV-0002` | KitLuy Ecosystem Overview (2026-07-17)                                 | REFERENCE        | Defines the KitLuy/HSA boundary and the "Drive owns docs, Git owns code" rule                                                          |

Both were **read in full before writing**, are small, and had no local equivalent.
Each carries an immutable provenance header and a SHA-256 checksum.

## 4. Drive structure found

Primary KitLuy folder:

```text
KITLUY-SUITE-PROJECT  (18HU0PFGWIFqz-k0vE6y2kn6gvbHZ3Y4X)
└── reference-library-folder  (1t7eyQD6VYyYaSATpNf0NPocybcqy1D1j)
    ├── kitluy-concept-design/            # rebuild bibles v3.0.0 and product bibles
    ├── kitluy-vs-shopify-.../            # competitor corpus
    ├── kitluy-vs-woocommerce-.../
    ├── kitluy-vs-toast-.../
    ├── kitluy-vs-lightspeed-.../
    ├── kitluy-vs-loyverse-.../
    └── HET.KITLUY.R&D_* documents
```

Additional KitLuy material is scattered across `KITLUY_SUITE_PROJECT`,
`KITLUY-SUITE-REPO (MAIN)`, `20_KITLUY_ECOSYSTEM`, `Kitluy_Partner`,
`Kimi_Agent_KITLUY_SWARM_RESEARCH` and Drive root.

### Heavy duplication

The Suite Rebuild Bible `v1.0.0`/`v1.0.1`/`v1.0.2` and Business Bible `v1.0.0`
each exist in **six to eight Drive folders** under identical names, plus `.docx`
variants. Byte sizes match exactly across copies — true duplicates, not divergent
versions. The manifest records one representative ID per version with the others
in `duplicate_drive_ids`.

## 5. Deliberately excluded

| Item                                       | Why                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `HET-KITLUY-PROJECT.zip` (240 MB)          | **Source-code snapshot.** Workspace rule: never develop from a Drive source-code copy. The live Git repository is authoritative |
| 4 × `.bundle` Git archives                 | Backup artifacts, not documentation                                                                                             |
| `hsa-admin-portal-rebuild-bible-v1.0.0.md` | **HSA document** — not KitLuy product truth                                                                                     |
| `HSA_Business_Plan_V2_Cambodia.docx`       | **HSA document**                                                                                                                |
| `KitLuy Partner App.html` / `.jsx`         | UI prototypes, not documentation authority                                                                                      |

Per mission §8, no HSA / PlantOS / HSAL / Canvar / Netra / Rotanak / Prajna
document was ingested as KitLuy product truth.

## 6. Relationship to the existing `docs/source/` corpus

`docs/source/` already implements a **mature provenance system** that predates
this mission: `KLSRC-####` IDs, versioned inventories (v1.0.0–v1.2.0 in
md/json/csv), an `inbox/` → classify → reconcile workflow, and `pnpm docs:verify`
gates (161 classified sources verified).

The Drive mirror **complements** it — it does not replace or duplicate it.

| System                | IDs          | Origin                                | Location        |
| --------------------- | ------------ | ------------------------------------- | --------------- |
| Owner-supplied corpus | `KLSRC-####` | Owner drops into `docs/source/inbox/` | In-repo         |
| Drive mirror          | `KLDRV-####` | Pulled from Google Drive              | Workspace-level |

Where a document exists in both, the in-repo `KLSRC` copy is the working
authority and the `KLDRV` record is the upstream provenance trail.

## 7. Secret safety — **PASS**

- Both mirrored documents were **read in full before being written**. Neither
  contains credentials, tokens, private keys or connection strings.
- **No** `.env` content, service-role key, cloud access key, payment credential,
  API token, certificate private key, Minisign private key or device private key
  was copied into the mirror or the repository.
- `pnpm secret:scan` **PASSED** across 1,458 tracked files.
- No secret value appears in any file produced by this mission.

## 8. Coverage honesty

This inventory reflects Drive search results on 2026-08-07. It is a
**high-coverage working index, not a certified exhaustive census**:

- Drive search paginates; deeper pages of the broad `title contains 'kitluy'`
  sweep were not fully enumerated.
- KitLuy-relevant files that are neither KitLuy-titled nor matched by the queries
  run would not appear.
- Folders shared from other accounts may not surface.

Extend the manifest with new `KLDRV` IDs continuing the sequence — **never
renumber or overwrite existing IDs**, they are cited elsewhere.

## 9. Governing policy

Ongoing behavior is governed by `docs/authority/DRIVE_SYNC_POLICY.md`:

- normal development **does not touch Drive**;
- Drive is queried only under six named triggers;
- an authorized query fetches identified documents by ID — it does not sweep;
- conflicts are recorded, never silently resolved;
- deleted Drive documents become `SOURCE_REMOVED_OR_UNAVAILABLE`, not deletions;
- Level A files are **never edited** to resolve a contradiction.

---

**See also:** `DOCUMENT_RECONCILIATION_REPORT.md` for the conflicts this
ingestion surfaced.
