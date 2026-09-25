# 57 — The development registration endpoint survives a reboot (KITLUY-DEV-STACK-REGISTRATION-DURABILITY-001)

**Date** 2026-09-25 · **Area** edge-platform / development workstation stack · **Source** `dev` from `7b22247` · **Owner task** "KITLUY-DEV-STACK-REGISTRATION-DURABILITY-001"

| Gate               | State                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED        | **YES** — edge runtime recreated on a durable mount; `pnpm dev:stack:up / health / edge-runtime` (§2)    |
| TESTED             | **YES** — 5 unit checks (`pnpm dev:stack:check`); lint, format; `pnpm verify` (§5)                       |
| DEV STACK VERIFIED | **YES** — recreate, stop/start, restart, container-absent recreate, full reboot simulation (§4)          |
| DATA PRESERVED     | **YES** — no row added or removed in 201 fresh-DB tables; Hub DB byte-identical in 77 tables (§4.4)      |
| REAL REBOOT        | **NOT PERFORMED** — the workstation was not rebooted; the restart policy is the mechanism (§6)           |
| IMAGES             | **Unchanged** — Store Hub `f3810ab6…` and Pi Terminal `0db42539…` remain the candidates; nothing rebuilt |

---

## 1. What was broken

Both images bake `http://<workstation>:54371/functions/v1/device-registration`.
`:54371` is kong of the `kitluy-fresh` Supabase stack, which proxies
`/functions/v1/*` to the container **`supabase_edge_runtime_kitluy-fresh:8081`**
(by container name, kong.yml route `functions-v1`).

Inspected before any change:

| Property           | As created by the Supabase CLI (2026-08-29)                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| image              | `public.ecr.aws/supabase/edge-runtime:v1.73.3`                                                                              |
| function bind      | `/tmp/claude-1000/…/87481d20-…/scratchpad/fresh-stack/supabase/functions` → same path, `ro`                                 |
| workdir            | `/tmp/claude-1000/…/87481d20-…/scratchpad/fresh-stack`                                                                      |
| functions config   | `{"device-registration":{"verifyJWT":false,"entrypointPath":"supabase/functions/device-registration/index.ts"}}` (relative) |
| deno cache         | volume `supabase_edge_runtime_kitluy-fresh` → `/root/.cache/deno`                                                           |
| network / alias    | `supabase_network_kitluy-fresh`, alias `edge_runtime`; no published ports (8081 exposed)                                    |
| restart policy     | **`no`** (every other stack container: `unless-stopped`)                                                                    |
| environment        | 10 variables: local keys, JWKS, `KITLUY_REGISTRATION_DSN` (= `SUPABASE_DB_URL`), host port 54371, functions config          |
| labels, extra host | `com.docker.compose.project` / `com.supabase.cli.project` = `kitluy-fresh`; `host.docker.internal:host-gateway`             |

Only the edge runtime referenced `/tmp`. A reboot cleared the scratch path,
Docker recreated the bind source empty, the runtime answered `BOOT_ERROR`, and
with policy `no` it did not even restart (handoff 56 §5.5.1).

## 2. What changed

### 2.1 The container

`supabase_edge_runtime_kitluy-fresh` was recreated **with the same name, image,
network, alias, labels, extra host, deno-cache volume, effective command and all
10 environment values** (compared value-for-value, not printed). Three things
differ:

| Property       | Now                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| function bind  | **`/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project/supabase/functions`** → same path, **read-only**              |
| workdir        | `/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project` (so the unchanged relative entrypoint resolves into the mount) |
| restart policy | **`unless-stopped`**                                                                                                                    |

Plus a label `com.kitluy.dev-stack.functions-source=<that path>`. Port 54371
is kong's and did not change, so **the address baked into both images is
unchanged**.

**There is no copy.** The runtime serves the committed repository functions
(`supabase/functions/device-registration`, `supabase/functions/_shared`)
directly. Consequences:

- an edit to those files is served after `docker restart supabase_edge_runtime_kitluy-fresh`;
- uncommitted edits in the main working tree are served too — `pnpm dev:stack:health` reports `WARN served source vs git` when that directory is dirty;
- the main working tree must stay on `dev` (a worktree is refused as a source, see §2.2).

### 2.2 The command — `scripts/development/dev-stack.mjs`

| Command                       | Does                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:stack:up`           | starts any stopped stack container (db, auth, rest, pg_meta, edge runtime, kong, `kitluy-hub-local`), refuses if the edge runtime is not on the durable mount, starts whichever of `:8787 :8791 :8792 :8790` is not answering (detached, own session, log `workspace/scratch/<date>__dev-stack-<service>.log`), then runs `health` |
| `pnpm dev:stack:health`       | the checks in §3, plus the edge mount source, its restart policy and the git state of `supabase/functions`                                                                                                                                                                                                                         |
| `pnpm dev:stack:edge-runtime` | recreates the edge runtime on the durable mount (§2.3)                                                                                                                                                                                                                                                                             |
| `pnpm dev:stack:check`        | unit checks for the recreation arguments — no Docker                                                                                                                                                                                                                                                                               |

Host services are started with the loopback values of handoff 56 §5.5 / §5.5.2:
`KITLUY_DEV_FLEET_DSN` and `MANAGEMENT_API_DATABASE_URL` = the Supabase CLI's
local default DSN on `:54372`; `KITLUY_DEV_PKI_DIR` =
`local-config/het-kitluy-project/dev-pki`; management API `PORT=8790`,
`KITLUY_ENV=local`, `MANAGEMENT_API_AUTH_URL=http://127.0.0.1:54371`, publishable
key read from `supabase_kong_kitluy-fresh` at start. No auth was weakened.

### 2.3 How recreation works, and where its keys come from

1. Refuses if `supabase/functions` is under `/tmp` or not in the main working tree.
2. Reads the existing container (`docker inspect --type container`) and writes a
   **0600 snapshot** — image, command, env, labels, alias, extra hosts — to
   `local-config/het-kitluy-project/edge-runtime-kitluy-fresh.json` (outside the
   repository, beside `supabase.env.local`). If the container is absent (e.g.
   after `supabase stop --project-id kitluy-fresh`), it recreates from that snapshot.
3. Stops and **renames** the old container (kept for rollback).
4. `docker run` with the durable mount. Environment values pass through the
   child's environment as `--env NAME` — never on a command line, never printed.
5. Waits up to 60 s for `:54371` to answer `400 KLUY-REG-MALFORMED`; on success
   removes the renamed container, on failure removes the new one and restores
   the old.

## 3. Health answers (healthy is not always 200)

| Endpoint                  | Probe                                                            | Healthy answer                                    |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| `:54371` registration     | `POST /functions/v1/device-registration` body `{}`               | **400** `KLUY-REG-MALFORMED`                      |
| `:8787` fleet/registry    | `GET /health/ready`                                              | **200**                                           |
| `:8791` release source    | `GET /health`; `GET /release/v1/assignment`                      | **200**; **400** "a device reference is required" |
| `:8792` hub-sync producer | `GET /health`; unsigned `POST /hub-sync/v1/terminal-projections` | **200**; **403** `REFUSED`                        |
| `:8790` management API    | `GET /health/ready`                                              | **200**                                           |

## 4. Verification (all on the live stack, 2026-09-25)

### 4.1 Before

`pnpm dev:stack:health`: all seven endpoint checks OK (`:54371` 400 only because
of that morning's `/tmp` repopulation), **FAIL** edge function source
(`/tmp/claude-1000/…/87481d20-…`), **FAIL** restart policy `no`. The served
`/tmp` copy was `diff -r` identical to the repository's
`device-registration` and `_shared`, so switching the source changed no behaviour.

### 4.2 Recreate and restart

| Step                                            | `:54371`                                               |
| ----------------------------------------------- | ------------------------------------------------------ |
| recreate (from the `/tmp` container)            | 400 `KLUY-REG-MALFORMED`                               |
| `docker stop` (deliberate)                      | 502 — expected while stopped                           |
| `docker start`                                  | 400 `KLUY-REG-MALFORMED`                               |
| `docker restart`                                | 400 `KLUY-REG-MALFORMED`; log `Serving functions on …` |
| recreate again (from the durable container)     | 400                                                    |
| container removed → recreate from 0600 snapshot | 400                                                    |

`docker inspect`: bind source is the repository path, `RW=false`, workdir the
repository, policy `unless-stopped`, **zero** occurrences of `/tmp/` in the whole
container definition; env names and values identical to the original; effective
command (`Entrypoint + Cmd`) identical.

### 4.3 Reboot simulation — `pnpm dev:stack:up`

Stopped the edge runtime (`Exited (137)`) and TERMed all four host services
(no listener on `:8787 :8790 :8791 :8792`); `health` showed 7 failures. Then
`pnpm dev:stack:up` — **5.4 s, exit 0**, every check OK:

```text
OK   :54371 device-registration 400 {"status":"REFUSED","code":"KLUY-REG-MALFORMED",…}
OK   :8787 fleet/registry       200 {"status":"ok","service":"kitluy-device-registry-service",…}
OK   :8791 release source       200 {"status":"ok","target":"LOCAL stack (127.0.0.1:54372/postgres)"}
OK   :8791 release refusal      400 {"error":"a device reference is required"}
OK   :8792 hub-sync producer    200 {"status":"ok","route":"/hub-sync/v1/terminal-projections"}
OK   :8792 unsigned refusal     403 {"code":"REFUSED",…}
OK   :8790 management API       200 {"status":"ok","service":"kitluy-management-api",…}
OK   edge function source       /home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project/supabase/functions
OK   edge restart policy        unless-stopped
OK   served source vs git       clean at 7b22247
```

Logs: fleet `environment: local`, target LOCAL `:54372`; management API
`environment: local, authHost 127.0.0.1:54371`; release and hub-sync target
LOCAL. No key or DSN password appears in any of the four logs.

### 4.4 Data preserved

Row count + content md5 of every base table, before and after:

- **`kitluy-fresh`, 201 `kitluy*` tables:** every row count identical. Two
  tables' content hashes moved — `kitluy_devices.device_runtime_status`
  (terminal `KL-54A3320E1201` reported at 03:33:04Z) and
  `device_registration_sightings` (`last_seen_at` of one row at 03:35:14Z). Both
  are live boards' routine traffic: the health probe's `{}` is refused at
  `index.ts:138`, before the database is opened (line 198). No device,
  assignment or release row was added, removed or changed by this task.
- **`kitluy-hub-local` (`kitluy_hub_local`, 77 tables):** identical — Cycle-A
  continuity state untouched. The container was not stopped.

### 4.5 One self-inflicted outage — recorded, fixed

The first container-absent test crashed: `docker inspect <name>` also matches
**volumes**, and the deno-cache volume has the container's name. My test line
then removed the renamed backup unconditionally, so `:54371` was down for about
a minute until the snapshot recreate (after fixing `inspect` to
`--type container`) brought it back. A second defect was caught by comparing
old and new containers: capturing only `Entrypoint` would have dropped the
script on a second recreation (`--entrypoint sh` stores it in `Cmd`); fixed and
covered by a unit check. No data was involved; the deno cache volume was never
touched.

## 5. Checks run

| Check                                   | Result             |
| --------------------------------------- | ------------------ |
| `pnpm dev:stack:check`                  | 5 passed, 0 failed |
| `eslint` / `prettier --check` (changed) | clean              |
| `pnpm verify`                           | see §8             |

## 6. After a workstation reboot — the procedure

```bash
cd ~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
pnpm dev:stack:up
```

No `/tmp` repair, no `sudo`, no copying. Docker brings back the Supabase
containers, including the edge runtime, by restart policy; `up` starts
`kitluy-hub-local` and the four host services and prints the health table.

After changing `supabase/functions/**`: `docker restart supabase_edge_runtime_kitluy-fresh`, then `pnpm dev:stack:health`.

If the edge runtime is ever removed or found on a non-durable mount:
`pnpm dev:stack:edge-runtime`.

## 7. Still not systemd, and other open items

- **Host services are plain `node` processes**, not systemd units: `:8787`
  fleet/registry (+ its child `kitluy-device-registry-service/dist`), `:8791`
  release source, `:8792` hub-sync producer, `:8790` management API. They do not
  come back on reboot; `pnpm dev:stack:up` starts them. Making them units is a
  separate owner decision.
- **`kitluy-hub-local` keeps restart policy `no`** — deliberately not changed
  (Cycle-A continuity DB); `up` starts it.
- **The workstation was not actually rebooted.** The edge runtime now has the
  same `unless-stopped` policy that brought db/kong/auth/rest back after the
  real power cut, and its source no longer lives in `/tmp`.
- `up`/`health` need the `dist/` builds of the registry service and management
  API (`pnpm build`); `up` refuses with that message when they are missing.
- The orphaned `/tmp/claude-1000/…/87481d20-…/scratchpad/fresh-stack` directory
  (root-owned contents) was left in place; nothing references it any more.
- The 0600 snapshot holds the local stack's keys; it lives in `local-config/`,
  never in the repository.

## 8. `pnpm verify`

**Exit 1 — every failing step is the pre-existing baseline recorded in handoff
56 §9; none involves a file changed here.**

| Step                   | Result                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, Build       | PASS                                                                                                                                               |
| Contract, Offline      | PASS                                                                                                                                               |
| OpenAPI, Hub migration | PASS                                                                                                                                               |
| Secret scan            | PASS (re-run after staging, new files included)                                                                                                    |
| Clock usage            | PASS                                                                                                                                               |
| Format check           | FAIL — `EACCES` on the root-owned `infra/kitluy-os-image/build/work/chroot-v2.7.0` tree (baseline); changed files pass `prettier --check`          |
| Lint                   | FAIL — 3 errors, 8 warnings, identical to baseline (`terminal-seat-contracts`); changed files lint clean                                           |
| Unit tests             | FAIL — `@kitluy/device-identity` two concurrency suites (`kitluy_credential_issuer` granted to `postgres`, handoff 56 §8 item 2); 62/63 tasks pass |
| Migration validation   | FAIL — `0232` destructive-marker (baseline)                                                                                                        |
| Docs link check        | FAIL — the same 4 links in a July WS-11 handoff (baseline)                                                                                         |
