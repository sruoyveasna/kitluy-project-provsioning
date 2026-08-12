# Edge platform — baseline

**Date:** 2026-08-07
**Repository:** `~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project`
**Branch:** `main` · **HEAD at intake:** `e9a7c39`
**Mission:** cloud Supabase foundation for KitLuy edge provisioning + begin `kitluy-os-image`

---

## 1. The headline finding

**The cloud edge/device backend the mission asks for is already built.** It was
delivered by WS-11 (T001–T008) and WS-12 (T001–T002) across cloud migration
groups `0120`–`0187`. The mission's implementation sequence E01–E10 describes
work that exists and passes its tests.

The genuine greenfield is E11–E19:

| Unit    | Area                                                           | State at intake                                 |
| ------- | -------------------------------------------------------------- | ----------------------------------------------- |
| E01–E10 | Supabase device/enrollment/assignment/config/release/RLS/audit | **already IMPLEMENTED-IN-DEV**                  |
| E11     | Admin provisioning UI                                          | **skeleton** — `App.tsx` + `main.tsx` only      |
| E12     | Partner provisioning UI                                        | **skeleton** — `App.tsx` + `main.tsx` only      |
| E13–E16 | `kitluy-os-image`                                              | **specification only** — a single 7-line README |
| E17–E19 | vertical slices                                                | blocked on E13–E16 and on a cloud target        |

Accordingly this mission did **not** re-implement E03–E10. Doing so would have
duplicated governed schema and violated the mission's own instruction not to
invent enum values where canonical registries exist (§2, §10).

---

## 2. Supabase baseline

| Measure                        | Value                                             |
| ------------------------------ | ------------------------------------------------- |
| Canonical migrations at intake | **86** (`supabase/migrations/`, plus a README)    |
| Migration version range        | `20260726180000` → `20260807040000`               |
| Device-related migrations      | 68 (groups `0120`–`0187`)                         |
| Schemas created                | 11 `kitluy_*` schemas                             |
| `kitluy_devices` relations     | **66** (64 tables, 2 views)                       |
| `kitluy_releases` relations    | 5                                                 |
| `kitluy_config` relations      | 4                                                 |
| Supabase Edge Functions        | **0** — `supabase/functions/` holds only a README |
| Hub migrations                 | 42 (`hub/migrations/`)                            |

Governed contracts are implemented as **SQL functions plus Node services**, not
as Supabase Edge Functions. That is the existing architecture and was preserved.

## 3. Service baseline

| Service                                    | Real?                  | Evidence                                                           |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------ |
| `kitluy-device-registry-service`           | **yes** — 79 TS files  | provisioning, revocation, pairing-receipt, health ingestion routes |
| `kitluy-hub-agent`                         | **yes** — 155 TS files | 30 `/edge/v1` LAN routes                                           |
| `kitluy-provisioning-service`              | no — 3-file scaffold   | health check + version only                                        |
| `kitluy-edge-operations-api`               | no — 3-file scaffold   | health check + version only                                        |
| `kitluy-management-api`                    | no — 3-file scaffold   | health check + version only                                        |
| `kitluy-configuration-projection-service`  | no — 3-file scaffold   | health check + version only                                        |
| `kitluy-device-release-and-update-service` | no — 3-file scaffold   | health check + version only                                        |

The cloud provisioning surface that actually exists is
`kitluy-device-registry-service`, under `/v1/terminal-provisioning`
(`/challenges`, `/challenges/{id}/verify`, `/redemptions`) and
`/v1/device-credentials/*`.

## 4. Portal baseline

Both portals are Vite skeletons with no routes, no data layer and no design
system usage: 11 files (Admin) and 12 files (Partner), of which two each are
source. There is no provisioning UI of any kind.

## 5. `kitluy-os-image` baseline

One file: `README.md`, 7 lines, specification-only, carrying three `[REQUIRED]`
blockers (Pi OS release pin, signing key custody, secure-element model). No
build system, no overlay, no firstboot, no agent.

> The README carried an **unrelated uncommitted modification** at intake. It was
> preserved untouched, as the mission required.

## 6. Environment baseline

| Tool                                  | Result                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| Node (repo requirement `>=22.12 <23`) | system default `v24.14.1`; `nvm use 22.23.0` used throughout       |
| pnpm                                  | 9.15.9 (matches `packageManager`)                                  |
| Docker                                | 29.6.2, available                                                  |
| Supabase CLI                          | 2.90.0, available                                                  |
| Host `psql`                           | **absent** — the repo's documented `docker exec` fallback was used |

**Port conflict found.** `supabase/config.toml` declares ports 54321–54323, all
three of which were occupied by the running `hsa_eco` local stack. The KitLuy
canonical stack therefore could not start under its own configuration.

Rather than stop an unrelated ecosystem's stack or edit tracked configuration,
validation ran from an **isolated scratch workdir** (`--workdir`) on ports
54341–54344, symlinking the repository's real `migrations/`, `seed/` and
`tests/`. The repository was not modified to make the validation run.

This port collision is a **recorded environment condition**, not a defect in the
repository: see `05_CLOUD_SUPABASE_PLAN.md` §5.

---

## 7. Git baseline

Branch `main`, HEAD `e9a7c39`, 12 modified and 11 untracked paths at intake, all
pre-existing and unrelated to this mission. `origin` push URL is disabled
(`disabled://push-requires-owner-approval`) and was **not** touched.
