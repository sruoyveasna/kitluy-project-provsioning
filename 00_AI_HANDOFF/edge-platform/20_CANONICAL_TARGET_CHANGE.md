# Canonical Supabase target — changed by owner instruction

**Date:** 2026-08-07
**Supersedes:** the target recorded in `14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §1.
**Status:** target recorded · credentials stored · **still NOT DEPLOYED.**

---

## 1. The change

|                  | Previous                   | **Current**                                |
| ---------------- | -------------------------- | ------------------------------------------ |
| Name             | `het-kitluy-dev`           | **`kitluy-project-pos`**                   |
| Project ref      | `gkfcxxtryqmjnhujlkdr`     | **`gjgbnkhuwlwhngbtrgts`**                 |
| URL              | —                          | `https://gjgbnkhuwlwhngbtrgts.supabase.co` |
| Supabase account | org `cfgrfiqqobgdhudzonue` | **a different account**                    |
| Created          | 2026-08-07 (this session)  | 2026-08-07 (by owner)                      |

Owner instruction, 2026-08-07: `kitluy-project-pos` replaces `het-kitluy-dev`
as the canonical monorepo development target.

### 1.1 `het-kitluy-dev` is now redundant

It was created earlier the same day, owner-approved, at **$10/month**. It holds
no data and no migrations. **It has not been deleted** — deleting a project is
destructive and is the owner's action to take. Until it is deleted it continues
to bill.

### 1.2 The new project is in a different Supabase account

`gjgbnkhuwlwhngbtrgts` is **not** in organisation `cfgrfiqqobgdhudzonue`. The
Supabase connector available to this session returns
`You do not have permission to perform this action` for it.

Consequence: this project cannot be inspected or managed through the connector.
It can only be reached with credentials issued by the account that owns it.

---

## 2. Verified about the new target

Using only the stored credentials, read-only:

    REST authentication (service-role) ....... 200 OK
    tables/views exposed in `public` .......... 0
    key claims ref ............................ gjgbnkhuwlwhngbtrgts (matches)
    key role .................................. service_role
    key issued ................................ 2026-08-07T07:03:05Z

The project is live, the credentials are genuine, and `public` is empty —
consistent with a fresh project.

**Not verified:** whether non-`public` schemas exist. PostgREST exposes only
`public`, so "0 exposed tables" is a strong signal of emptiness but not proof.
A `supabase link` or a direct database connection is needed to confirm, and
that confirmation must happen **before** any migration is pushed. The lesson
from `kitluy-suite-monorepo-dev` — a project whose name implied one thing and
whose contents were another — applies here too.

---

## 3. THE PostgreSQL 17 BLOCKER ALMOST CERTAINLY STILL APPLIES

Changing the target does **not** resolve the blocker recorded in
`14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3.

The service-role key was issued **2026-08-07**, so the project was created
today, and Supabase provisions **PostgreSQL 17** for new projects. The canonical
chain fails at migration 51 of 86 on PostgreSQL 16+ because of the `CREATEROLE`
auto-membership change — a defect in the chain, not in any particular project.

The exact major version is **unconfirmed** (it needs a database connection).
Confirming it is the first thing to do once an access token exists. If it is
PostgreSQL 16 or later, the remediation described in §3.4 of that document is
required before any deployment, exactly as before.

---

## 4. Credentials

Stored outside every Git repository, at `0600`, in the workspace local-config
directory:

    ~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/supabase.env.local

Contains: project name, ref, URL, publishable key, service-role key, and two
empty placeholders for the values still required.

`pnpm secret:scan` passes over 1,458 tracked files — nothing leaked into the
repository.

### 4.1 SECURITY — the service-role key is compromised

**The service-role key was transmitted in plaintext through an AI chat
transcript on 2026-08-07.** It bypasses all row-level security and grants full
read/write access to every table in the project.

It was stored anyway by explicit owner decision, with the risk recorded rather
than hidden. **It must be rotated** (Supabase dashboard → Settings → API). Until
then, this project's database must be treated as readable and writable by anyone
who has seen that transcript.

After rotation, replace the value by editing the local file directly — never by
pasting a key into a chat.

### 4.2 Still required for deployment

The service-role key does **not** deploy migrations. The approved workflow
(`supabase link` + `supabase db push`) needs:

| Reference                     | Note                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`       | Personal access token for **the account that owns `gjgbnkhuwlwhngbtrgts`** — a token for org `cfgrfiqqobgdhudzonue` will not work |
| `KITLUY_SUPABASE_DB_PASSWORD` | For the `supabase link` prompt                                                                                                    |

Both have empty placeholders in the local file, ready to be filled in by hand.

---

## 5. Unchanged

Nothing was deployed. No migration was applied, edited or renumbered. The
canonical chain is still 86 migrations, chain digest
`64537569aaa3ab12f250324ece3761c96a43c045c45bcf020a99cff114da5325`.

Test results are unchanged: firstboot agent 43/43, os-image build gates 34/34,
rpi-image-gen integration 36/36, secret scan clean.

Git: HEAD `e9a7c39`, 0 commits, 0 pushes.

---

## 6. Next actions, in order

1. **Rotate the service-role key.** (owner)
2. **Delete `het-kitluy-dev`** to stop the $10/month, once you are satisfied the
   new target is correct. (owner — destructive, not done here)
3. **Provide an access token + database password** for the owning account.
4. **Confirm the PostgreSQL major version** of `gjgbnkhuwlwhngbtrgts`.
5. **Confirm the project is genuinely empty** across all schemas, not just `public`.
6. If PostgreSQL 16+, complete the remediation in
   `14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3.4 **before** pushing anything.
