# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| Task ID            | `ADMIN-CONTROL-PLANE` (governed fleet read slice)       |
| Task title         | Wire Management API routes + build Admin Portal UI      |
| Product/build      | `kitluy-management-api` + `kitluy-admin-pwa-portal`     |
| Primary agent      | Claude (Opus 5)                                         |
| Status             | `HANDOFF_READY`                                         |
| Branch             | `main`                                                  |
| Worktree           | `repos/het-kitluy-project` (no worktree used)           |
| Base commit        | `e9a7c39`                                               |
| Final commit       | `UNCOMMITTED` — no commit or push was requested or made |
| Handoff date       | 2026-08-10                                              |
| Requested reviewer | Owner (Veasna)                                          |

## 1. Outcome

Three governed Admin READ routes are wired and proven against the REAL
development cloud project (`gjgbnkhuwlwhngbtrgts`), and the Admin PWA Portal
now signs in, restores and ends a session, guards its routes, and renders the
fleet and one device.

Observable result of the live end-to-end probe:

| Check                                   | Result                                                   |
| --------------------------------------- | -------------------------------------------------------- |
| Real cloud sign-in                      | PASS — subject `b145d533-…`                              |
| `GET /me` no token / invalid token      | 401 / 401                                                |
| `GET /devices` no token                 | 401                                                      |
| Unknown route / malformed device id     | 404 / 404                                                |
| `GET /me` real Admin                    | 200 — 8 permissions incl. `fleet.read`                   |
| `GET /devices` real Admin               | 200 — count 3, `truncated false`, policy unruled         |
| `KL-CLOUD-HUB-0001`                     | `restricted_investigation` · NEVER_SEEN · attention      |
| `KL-CLOUD-HUB-0001-REPLAY`              | `quarantined` · NEVER_SEEN · attention                   |
| `KL-CLOUD-TERM-0001`                    | `enrolled` · NEVER_SEEN · provisionable                  |
| DTO identity-evidence leak scan         | PASS — none                                              |
| "Never invents ONLINE"                  | PASS — every device UNKNOWN/NEVER_SEEN                   |
| CORS allowed / hostile origin preflight | 204 with echoed origin / 403 with no headers             |
| Production bundle secret audit          | service-role key, DB password, admin password all ABSENT |

## 2. Source-of-truth checked

| Source                                                         | Section/path                      | Result                                        |
| -------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `CLAUDE.md` hard rules 3, 4, 5, 7                              | repository root                   | aligned                                       |
| API Error Code Registry v1.0.0 §4                              | `@kitluy/api-errors` ERROR_CODES  | aligned                                       |
| `services/kitluy-management-api/openapi.yaml` governance block | freshness, versioning, pagination | aligned (pagination gap declared, not hidden) |
| OD-ADMIN-FLEET-001 / -002, OD-ADMIN-PROVISION-001              | owner decisions                   | honoured                                      |

## 3. Files inspected

- `services/kitluy-management-api/src/{authorization,fleet,index,http,main}.ts`
- `packages/supabase-client/src/{index,admin-authorization}.ts`
- `packages/{web-ui,localization,api-errors,shared-config,observability}/src`
- `services/kitluy-device-registry-service/src/{database,main}.ts` (conventions)
- `scripts/verification/{verify,clock-usage-check,secret-scan}.mjs`

## 4. Files changed

| Path                                                                                                                 | Change summary                                           | Why                          | Generated? |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- | ---------- |
| `services/kitluy-management-api/src/http.ts`                                                                         | Added management router + CORS resolver                  | Task step 1                  | no         |
| `services/kitluy-management-api/src/composition.ts`                                                                  | NEW — env config, pool, verifier; refuses privileged key | Task step 1 composition root | no         |
| `services/kitluy-management-api/src/main.ts`                                                                         | Wired router, CORS, preflight, pool shutdown             | Task step 1                  | no         |
| `services/kitluy-management-api/openapi.yaml`                                                                        | Documented 3 routes + schemas; corrected `servers` base  | Contract accuracy            | no         |
| `services/kitluy-management-api/test/management-routes.test.ts`                                                      | NEW — 28 tests                                           | Task step 3                  | no         |
| `services/kitluy-management-api/test/composition.test.ts`                                                            | NEW — 8 tests                                            | Task step 3                  | no         |
| `services/kitluy-management-api/README.md`                                                                           | Routes, authorization model, config, known gaps          | Docs accuracy                | no         |
| `apps/kitluy-admin-pwa-portal/package.json`                                                                          | Added `@kitluy/supabase-client`                          | Task step 2                  | no         |
| `apps/kitluy-admin-pwa-portal/src/App.tsx`                                                                           | Rewritten: routing, guard, session, data                 | Task step 2                  | no         |
| `apps/kitluy-admin-pwa-portal/src/{config,routing,management-client,messages,sign-in,access,device-presentation}.ts` | NEW pure modules                                         | Task step 2                  | no         |
| `apps/kitluy-admin-pwa-portal/src/views.tsx`                                                                         | NEW — login, shell nav, fleet, detail, notice            | Task step 2                  | no         |
| `apps/kitluy-admin-pwa-portal/test/{portal-logic,views}.test.*`                                                      | NEW — 51 tests                                           | Task step 3                  | no         |
| `apps/kitluy-admin-pwa-portal/README.md`                                                                             | Status, boundary, run procedure, truthfulness rules      | Docs accuracy                | no         |
| `.env.example`                                                                                                       | Added variable NAMES for both components (no values)     | Repo convention              | no         |
| `pnpm-lock.yaml`                                                                                                     | Workspace link for the new dependency                    | `pnpm install`               | yes        |

### Allowlist verification

`PASS` — only the two target components plus `.env.example` and the lockfile
changed. The ~50 pre-existing dirty files from unrelated work were preserved
untouched; nothing was reset, cleaned or stashed.

## 5. Implementation details

### Functional behavior

- `GET /management/v1/me` — no specific permission; caller must be an ACTIVE
  Admin. Returns `userId` + canonical permission keys.
- `GET /management/v1/devices` — requires `fleet.read`. Returns the governed
  DTO page with `count`, `limit`, `truncated`, `freshnessPolicyRuled`.
- `GET /management/v1/devices/:id` — requires `fleet.read`. Returns the device
  plus DERIVED `provisioning` readiness.

**Ordering is load-bearing**: authorization runs BEFORE identifier validation
and before any fleet row is read, so an unauthenticated caller cannot use the
route as an oracle over well-formed device ids. Tests assert both the 401 and
that no `device_fleet_status` statement was issued.

### Schema/data/migrations

`NONE`. Migration count is **86 → 86** as required. No DDL was written,
applied or planned. No `SELECT TO authenticated` grant was added to any device
relation (OD-ADMIN-FLEET-001 intact).

### APIs/events/jobs/webhooks

Three GET routes as above; every other method returns 405. Denials use the
canonical registry codes `AUTHENTICATION_REQUIRED` (401) and
`SCOPE_PERMISSION_DENIED` (403), with a machine-readable
`error.details.reason` so the portal can distinguish
not-provisioned / disabled / inactive / missing-access. The missing permission
key is deliberately **never named** in a response (Registry §4).

### Permissions/audit/security

RBAC is not reimplemented — `kitluy_auth.has_permission()` is evaluated as the
`authenticated` role with the caller's subject inside a rolled-back
transaction. The composition root refuses a `service_role` JWT, an
`sb_secret_`/`sbp_` credential, or an unidentified value in the publishable
slot, and refuses to start rather than run misconfigured. CORS is an exact
origin allowlist — never `*`; a hostile-origin preflight receives 403 and no
cross-origin headers. Startup logs emit auth host and database host only.

No audit events are emitted: this slice contains no mutation.

### Offline/Store Hub/device impact

`NONE`. No heartbeat write, no Pi integration, no Hub path touched.

### UI/localization/accessibility

Khmer-first bilingual message bundle with a test asserting key parity and
non-empty values in both locales. Views use `aria-label` sections, `role=alert`
for refusals, label/input pairs, and `aria-pressed` locale toggles. Colour is a
redundant cue — the condition label carries the meaning.

Truthfulness rules encoded and tested:

- `quarantined`, `restricted_investigation`, `suspended` render **abnormal**,
  and abnormal devices sort to the top of the fleet list.
- Freshness renders `UNKNOWN` / `NEVER_SEEN` only. `ONLINE` is never produced
  while the threshold is unruled; an unrecognised value degrades to unknown,
  never to healthy.
- An unreachable service renders "unavailable", never an empty fleet.
- A capped page declares `truncated` rather than implying it is the whole fleet.

### Observability/runbooks/docs

Both READMEs document routes, configuration variable NAMES, the run procedure,
and a "known gaps" section.

## 6. Acceptance criteria evidence

| AC ID   | Result | Evidence                                                           |
| ------- | ------ | ------------------------------------------------------------------ |
| `AC-01` | PASS   | 3 routes wired; 401/403/200/404/405 asserted in 28 route tests     |
| `AC-02` | PASS   | Composition root reads env, refuses privileged creds (8 tests)     |
| `AC-03` | PASS   | Portal login/session/guard/shell/devices/detail; 53 portal tests   |
| `AC-04` | PASS   | Abnormal + freshness truthfulness asserted in logic and view tests |
| `AC-05` | PASS   | Live probe against real cloud (section 1)                          |
| `AC-06` | PASS   | `pnpm verify` fresh; every failure classified (section 7)          |

## 7. Validation performed

`pnpm verify` was run FRESH before any edit (baseline) and again after. Every
failure is classified against that baseline.

| Step                     | Result | Classification                                                                                                                                                                                                                                                                  |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check             | FAIL   | **PRE-EXISTING** — identical 48 warned entries in both runs; diff is empty. Every file is unrelated pre-existing dirty work.                                                                                                                                                    |
| Lint                     | PASS   | 0 errors (2 pre-existing warnings in unrelated files)                                                                                                                                                                                                                           |
| Typecheck                | PASS   | —                                                                                                                                                                                                                                                                               |
| Unit tests               | FAIL   | **PRE-EXISTING / ENVIRONMENTAL** — only `@kitluy/device-identity` fails, identically in both runs (12 failed / 26 passed / 1 skipped). Cause: `relation "kitluy_devices.hardware_profiles" does not exist` — the local Postgres has no migrations applied (PG17 local blocker). |
| Contract tests           | PASS   | 5/5                                                                                                                                                                                                                                                                             |
| Offline harness          | PASS   | —                                                                                                                                                                                                                                                                               |
| Build                    | PASS   | —                                                                                                                                                                                                                                                                               |
| OpenAPI validation       | PASS   | —                                                                                                                                                                                                                                                                               |
| Migration validation     | PASS   | 86 migrations                                                                                                                                                                                                                                                                   |
| Hub migration validation | PASS   | —                                                                                                                                                                                                                                                                               |
| Secret scan              | PASS   | —                                                                                                                                                                                                                                                                               |
| Clock usage              | PASS   | —                                                                                                                                                                                                                                                                               |
| Docs link check          | FAIL   | **PRE-EXISTING** — the same 4 broken links in one 2026-07-30 handoff, byte-identical in both runs.                                                                                                                                                                              |

Direct package runs (not cache): `kitluy-management-api` 80/80,
`kitluy-admin-pwa-portal` 53/53, `terminal-local-store` 20/20.

> Turbo reported `39 total` tasks at baseline and `38 total` after. The
> difference is one task (`@kitluy/terminal-local-store`) that turbo CANCELLED
> at a different point because cache state changed the ordering under
> `--concurrency=1`. It was run directly and passes 20/20. Exactly one package
> FAILED in both runs, and it is the same one.

**NEW REGRESSIONS: none.**

## 8. Not run / not verified

- No browser-driven UI test (no jsdom/testing-library in the catalog; adding
  one was out of scope). Views are verified by server rendering, and the API
  side was verified end-to-end with a real token obtained by the same password
  grant `signInWithPassword` performs.
- Sign-in through the actual rendered form was not clicked by an automated
  browser — the owner's own login is the remaining confirmation.
- Readiness does not probe the database.

## 9. Risks and known limitations

| Severity | Limitation                                   | Mitigation/follow-up                                    |
| -------- | -------------------------------------------- | ------------------------------------------------------- |
| Medium   | No cursor pagination on `/devices`           | `truncated` is reported honestly; cursor contract later |
| Low      | Readiness does not probe the database        | Recorded; add a real dependency probe                   |
| Low      | Freshness threshold unruled → always UNKNOWN | Correct by design; needs an owner ruling to improve     |
| Low      | `dist/` rebuilt for both components          | Gitignored                                              |

## 10. Blockers and open decisions

Unchanged and NOT addressed here (recorded only):

- PG17 local assertion/RLS SIGSEGV — OPEN, pre-Pilot.
- Dev credential rotation — owner-accepted risk, required before Pilot.
- Factory QA persistence — missing, pre-Pilot.
- Physical Raspberry Pi — not tested.

Open decision needed: the device liveness threshold (stale/offline seconds).
Until ruled, the portal shows UNKNOWN.

## 11. Rollback / recovery

All changes are uncommitted and confined to the two components plus
`.env.example` and `pnpm-lock.yaml`. Reverting those paths restores the prior
state; no migration, no cloud write, no schema change was made.

## 12. Review focus

- The ordering in `handleManagementRequest`: authorize → validate → read.
- `composition.ts` credential refusal and the host-only startup log.
- `device-presentation.ts`: the abnormal-state and never-invent-ONLINE rules.
- `access.ts`: unknown denial reason falls back to REFUSED, never to granted.

## 13. Next step

Provisioning issuance slice: governed `POST` reusing
`fleet.device_provisioning_code.issue`, with expiry / single-use / replay /
wrong-device-claim tests and canonical audit — then Partner Portal.

## 14. Truth statement

- Production modified by primary coding agent: `NO`.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED` in the evidence register: `NO` — the
  register was not advanced; this handoff describes code and evidence only.
