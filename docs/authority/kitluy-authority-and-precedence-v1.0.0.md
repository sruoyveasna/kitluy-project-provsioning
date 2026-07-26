# KitLuy Authority and Precedence — v1.0.0

| Field   | Value                                                                                                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version | 1.0.0 · 2026-07-26                                                                                                                                                                                                                                               |
| Status  | Created at repository bootstrap (KL-BOOTSTRAP-001). The canonical file of this name was cited by source documents but not found on this machine; this version restates the precedence rules already fixed by RB v4.0.0 §0.2 and the active Project Instructions. |

## Precedence order

When sources conflict, apply this order (highest first):

1. **Current project-owner decisions and active KitLuy Project Instructions.**
2. **Implementation evidence:** applied migrations, verified repository code,
   executable tests, production evidence.
3. **Current source-of-truth bibles:** `kitluy-suite-rebuild-bible-v4.0.0.md`,
   `kitluy-suite-business-bible-v2.0.0.md`.
4. **Current approved product, API, data, security, offline and service
   specifications** (the ten Phase 1 specs listed in the source-of-truth index).
5. **Approved handoffs** (`00_AI_HANDOFF/`).
6. **KitLuy Master Feature Registry and traceability artifacts.**
7. **Evidence-based competitor analyses and classifications.**
8. **Competitor clone or rebuild documents — design references ONLY.** They
   never establish KitLuy product truth.
9. **Superseded planning.**

## Conflict handling rules

1. Do not silently choose between conflicting sources.
2. Preserve the higher-authority decision.
3. Record the conflict in
   `kitluy-decision-and-reconciliation-register-v1.0.0.md` with affected files.
4. Do not perform destructive changes without explicit authority.

## Status vocabulary (used across all registers)

`OWNER-LOCKED` · `APPROVED TARGET` · `SPECIFIED` · `PLANNED` · `SCAFFOLDED` ·
`BUILT` · `TESTED` · `DEPLOYED` · `PILOT-PROVEN` · `PRODUCTION-PROVEN` ·
`DEFERRED` · `REJECTED` · `REQUIRED VALUE`

A capability advances only along the evidence chain:
specification → repository code → migration/schema evidence → automated tests
→ integrated tests → deployment evidence → monitoring evidence → pilot
evidence → production evidence. Never label anything `IMPLEMENTED`,
`COMPLETE` or `PRODUCTION-READY` without the supporting evidence. Scaffolded
code is not implemented functionality. Unknown owner/legal/commercial/
production/credential/domain/provider values are written
`[REQUIRED: description]` and never guessed.
