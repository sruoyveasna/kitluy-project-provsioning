# CLAUDE.md — instructions for AI build agents in the KitLuy repository

## Before any work

1. Read `PROJECT_HOME.md`.
2. Read `docs/authority/kitluy-source-of-truth-index-v1.0.0.md` and
   `docs/authority/kitluy-authority-and-precedence-v1.0.0.md`.
3. Read `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
   — know what is actually built vs scaffolded.
4. Read the latest handoff in `00_AI_HANDOFF/` (see `000_INDEX.md`).

## Hard rules

1. Work only within the requested scope; record out-of-scope findings instead
   of fixing them silently.
2. Preserve product boundaries: apps never import other apps' internals;
   shared packages never import app code; neutral Core (`packages/`) never
   contains Laundry or other vertical terminology; provider clients stay
   behind adapters.
3. **Never auto-apply production migrations** (OWNER-LOCKED KL-INF-P1-037) —
   not from CI, not from app startup, not from this session.
4. **Never expose secrets.** No credentials in code, config, logs or docs.
   `.env.example` holds names only. Run `pnpm secret:scan` before finishing.
5. **Never call scaffolded functionality implemented.** Statuses advance only
   with evidence recorded in the evidence register.
6. **Never bypass the Store Hub** for normal Store operations — POS terminals
   do not write directly to Supabase.
7. **Never weaken RLS or permission checks.** Frontend visibility is not
   authorization. Four-eyes rules cannot be relaxed (`@kitluy/approvals`).
8. **Record conflicts instead of silently resolving them** in
   `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`,
   preserving the higher-authority decision.
9. Unknown owner/legal/commercial/production/credential/domain/provider values
   stay `[REQUIRED: description]` — never guessed.
10. Preserve the owner-locked T1–T4 Laundry model
    (`verticals/phase1-laundry`); reject any three-terminal mapping.
11. Financial, custody, inventory-movement and audit records are append-only;
    corrections are compensating records.
12. No floating-point money — use `@kitluy/money`.

## Before finishing any session

1. Run `pnpm verify` and report the ACTUAL result — never claim a command
   passed unless it was executed successfully.
2. Create a handoff note in `00_AI_HANDOFF/<area>/` using the template in
   `000_INDEX.md`.
3. Update `00_AI_HANDOFF/000_INDEX.md`.
4. Update the evidence register for any status that changed (with evidence).

## Reusable task template

```markdown
### Task

<one sentence>

### Authority

<spec/decision that authorizes this work, e.g. "RB v4 §10.2", "KLV4-DEC-005">

### Scope

In: <files/boundaries>. Out: <explicitly excluded>.

### Evidence target

<which register entries move, e.g. "SCAFFOLDED → BUILT for X, tests Y">

### Steps

1. Read PROJECT_HOME.md, authority pack, latest handoff.
2. <implementation steps>
3. pnpm verify (must pass).
4. Record conflicts/required values discovered.
5. Write handoff + update index + evidence register.
```

## Repository conventions

- Node version from `.nvmrc`; pnpm version pinned in `package.json`.
- Catalog versions in `pnpm-workspace.yaml` — never pin duplicates in leaves.
- Strict TypeScript; `pnpm lint`/`pnpm format` before finishing.
- Source citations in code comments for every rule taken from a spec
  (e.g. "Hub spec §11.2"), so the Rebuild Test holds.
