# Continuation baseline — pre-existing dirty state

**Date:** 2026-08-10
**Purpose:** Record exactly which files were already dirty **before** this
continuation touched anything, so authorship of every later change is
unambiguous.

    branch ......... main
    HEAD ........... e9a7c3917ea4ef7b246bf0324d7b1f408d1d9645
    upstream ....... origin/main (0 ahead, 0 behind)
    tracked modified ... 42 files
    untracked entries .. 47 paths

**Nothing in this file was authored by the continuation.** All of it pre-existed.

---

## 1. Tracked modifications that pre-existed (42)

### 1.1 The PG16/PG17 role-model correction — 14 migrations

All carry the same reconciliation ID `KLREC-2026-08-07-PG16-CREATEROLE-001`.

    0140_revocation_approval_reader
    0151_enforce_governed_emergency_revocation
    0152_governed_emergency_post_approval
    0160_repair_job_governor_membership_leak
    0165_governed_terminal_provisioning_code_revocation
    0166_canonical_terminal_code_expiration
    0167_expired_terminal_code_replacement_issuance
    0168_ambiguous_issuance_replay_reconciliation
    0169_atomic_terminal_code_recovery
    0170_terminal_provisioning_pop_challenges
    0171_atomic_pop_bound_redemption
    0172_provisioning_composition_identity
    0173_provisioning_composer_noinherit_gateway
    0174_terminal_activation_completion

They are a single coherent change, not fourteen unrelated edits. Two shapes:

- **`0140` — borrow and return.** PostgreSQL 16 removed `CREATEROLE`'s implicit
  power to `SET ROLE` into roles it created, so the probe grants itself
  membership and returns it immediately. The recorded justification is that
  membership does not change what the probe *measures*.
- **The other 13 — narrow the assertion.** Each excludes exactly the one
  un-removable membership PG16 auto-grants to the creating role:

      and not (r.rolname = current_user and m.grantor <> m.member)

  A borrow the chain took itself has `grantor = member` and is **still** a
  finding, so the security property survives. `0173` additionally excludes the
  auto-grant's `ADMIN OPTION` row while still refusing re-delegation by any
  other member.

**Assessment against work-sequence §6.** These migration versions have **never
been applied to any authoritative cloud environment** — `het-kitluy-dev` holds
0 of 87 (verified live 2026-08-10). They are therefore a legitimate
pre-first-deployment canonical correction, and editing them in place does not
rewrite deployed history. No additive repair migration is required. This is
recorded here explicitly, as §6 demands, rather than assumed.

They are **not** "changes to make checks pass": each narrows an assertion by
exactly one provably un-removable row and documents why.

### 1.2 Test files

    supabase/tests/assertions.sql
    supabase/tests/rls-tests.sql

Also already modified before this continuation. Relevant because the earlier
`assertions.sql` run used this modified copy.

### 1.3 Other pre-existing tracked modifications (26)

    .env.example                .prettierignore
    00_AI_HANDOFF/000_BLOCKERS.md, 000_CURRENT_STATE.md, 000_INDEX.md
    AGENTS.md  CLAUDE.md  KIMI.md  PROJECT_HOME.md
    package.json  pnpm-lock.yaml  pnpm-workspace.yaml
    apps/kitluy-admin-pwa-portal/{README.md,package.json,src/App.tsx}
    apps/kitluy-pos-desktop-app/package.json
    docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md
    infra/kitluy-os-image/README.md
    packages/digital-store-context/{package.json,src/index.ts}
    services/kitluy-management-api/{README.md,openapi.yaml,package.json,
                                    src/http.ts,src/index.ts,src/main.ts}

---

## 2. Untracked work that pre-existed — highest preservation priority

Entire subsystems exist **only** in the working tree, with no git backup:

| Path                                          | What it is                                        |
| --------------------------------------------- | ------------------------------------------------- |
| `services/kitluy-device-firstboot-agent/`      | **The whole firstboot/enrollment service** — 6 src files, 8 test files, ~4,576 lines |
| `infra/kitluy-os-image/{config,rpi-image-gen,scripts,test}/` | The entire OS image build system — 20 files |
| `services/kitluy-management-api/src/{authorization,composition,fleet}.ts` + 4 tests | The admin fleet read path |
| `apps/kitluy-admin-pwa-portal/src/*` (8 files) + 2 tests | The admin portal UI |
| `scripts/database/{db-deploy-hosted-dev,hosted-dev-target,hosted-dev-target.test,migration-manifest}.mjs` | **Hosted-dev cloud deployment tooling** |
| `packages/supabase-client/`                    | Supabase client package                           |
| `supabase/migrations/…0188_factory_qa_durable_evidence.sql` | Migration 0188 (added 2026-08-10) |
| `supabase/seed/reference-data.sql`             | Seed/reference data                               |
| `00_AI_HANDOFF/edge-platform/`, `migrations/`, `preparation/` | Evidence directories |
| `apps/kitluy-pos-desktop-app/src/vertical/`    | Vertical resolver                                 |
| `packages/digital-store-context/test/`         | Tests                                             |
| `docs/authority/*.md` (4), `docs/decisions/*.md` (2) | Authority and decision records                 |

Note that `scripts/database/db-deploy-hosted-dev.mjs` already exists — cloud
deployment tooling was written before this continuation and should be used
rather than replaced.

---

## 3. Preservation rule for this continuation

Every path above is to be left byte-identical unless the work sequence
explicitly requires changing it. Any file this continuation modifies or creates
is listed in its own evidence document, so the two sets never blur.
