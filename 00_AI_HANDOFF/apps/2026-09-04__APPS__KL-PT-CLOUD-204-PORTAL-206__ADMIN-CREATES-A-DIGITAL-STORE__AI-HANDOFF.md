# The Admin creates a Digital Store: door, routes and screens (Slice 2D)

## 0. Identity

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task ids      | `KL-PT-CLOUD-204` (creation door and route), `KL-PT-PORTAL-206` part 2 (Admin Portal Stores list and create screen)                                                                                                                                                                                                                                                                                                |
| Area          | apps (`apps/kitluy-admin-pwa-portal`) + services (`supabase/migrations`, `services/kitluy-management-api`)                                                                                                                                                                                                                                                                                                         |
| Date          | 2026-09-04                                                                                                                                                                                                                                                                                                                                                                                                         |
| Authority     | `KLD-2026-09-03-TERMINAL-PROVISIONING-001` §2, §16 (the Admin creates the Store; the Partner never does); `KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001` (defaults: Partner visibility checkbox on by default, HIGH risk class, `partners.read` for the list); decision 6 default (single Admin with reason and audit in development, four-eyes in pilot/production); plan "Phase 2 detailed", Slice 2D |
| Branch        | `claude/fix-firstboot-esm-and-ssh-hostkeys` (working tree, uncommitted — committing is the owner's call)                                                                                                                                                                                                                                                                                                           |
| Status        | `PARTIAL` — door asserted on both local stacks, API and portal tested and built; the browser run with a real Admin session NOT RUN; hosted NOT RUN                                                                                                                                                                                                                                                                 |
| Hosted writes | none                                                                                                                                                                                                                                                                                                                                                                                                               |

## 1. Outcome

- **Migration 0215**: permission `store.digital_store.create` (HIGH, granted to `HET_PLATFORM_ADMIN`, never to a Partner role) and the door `kitluy_core.create_digital_store_v1(...)`, SECURITY DEFINER granted to `service_role` only. It creates the Store in `DRAFT` under a named Tenant with one primary vertical taken from the reference registry (`ACTIVE` only — `GROCERY` and the other roadmap verticals are refused by name), optionally the first Location and its link in the same transaction (Store before Location), optionally a `digital_store` scope for every live `DIGITAL_STORE_STAFF` assignment already scoped to a Store of that Tenant (so the Tenant's existing Partner staff see the new Store; nobody gains a role), and one `kitluy_audit.audit_logs` row naming the Admin, the permission and the reason. Blank reason, blank actor, unknown or closed Tenant, bad code shape, duplicate code, unknown Location fields and pilot/production without a second distinct approver are refused with `KLUY-STORE-*` codes.
- **Management API**: `POST /management/v1/digital-stores` (admin, `store.digital_store.create`, body exactly the allowed fields, actor from the token, 201 with the audit id, 422 with the refusal code, 404 for an unknown Tenant, 503 when unwired), `GET /management/v1/digital-stores/options` (Tenants with Partner verification status and existing Partner staff count, the vertical registry verbatim, and `fourEyesRequired` told by the server), `GET /management/v1/digital-stores` (`partners.read`; every Store with its Tenant in words and its Locations). All three in `openapi.yaml`.
- **Admin Portal**: nav links "Digital Stores" and "Create a Digital Store" gated by the two permissions (presentation only); `#/stores` list; `#/stores/new` form with Tenant picker (verification status shown), store code, name, vertical (roadmap entries disabled and labelled), optional first Location, the Partner-visibility checkbox (on by default, with the Tenant's staff count or a warning that no Partner will see the Store), reason, and a second approver only when the server says so; ready-gated submit; refusal shown verbatim; success shows the audit id and a link to the list. Both locales.
- The smoke on `kitluy-fresh` created (and rolled back) a Store with a Location and one Partner scope and wrote one audit row; assertion SECTION 59 passes standalone on both local stacks.

## 2. Source-of-truth checked

The owner decision v2.0.0 §2/§16; migration 0020 (`digital_stores`, `store_locations`, `digital_store_location_links`), 0030 (permissions, role assignments, scopes, `audit_logs`), 0035 (`current_digital_store_ids`), 0197 (the permission/door pattern), the reference registry rows on the local stacks (`vertical_code`: `LAUNDRY` active, seven roadmap), `scripts/development/seed-hosted-dev-partner.mjs` (the scope row shape), `device-approval.ts` and `handleApproveEnrollment` (the mutation pattern), the Admin Portal sources and tests.

## 3. Files inspected

As above plus the live column lists and constraints of the tables written, probed on `kitluy-fresh`.

## 4. Files changed

| File                                                                          | Change                                                                                                                                              | Authority    | Secret? |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------- |
| `supabase/migrations/20260904110000_0215_digital_store_creation.sql`          | NEW: permission + grant, the door, guard                                                                                                            | 204          | no      |
| `supabase/tests/assertions.sql`                                               | SECTION 59 appended                                                                                                                                 | 204          | no      |
| `services/kitluy-management-api/src/digital-stores.ts`                        | NEW: `createDigitalStore` (as `service_role`), `listDigitalStores`, `listStoreCreationOptions`                                                      | 204          | no      |
| `services/kitluy-management-api/src/{http,authorization,composition}.ts`      | three routes; `PERMISSION.STORE_DIGITAL_STORE_CREATE`, `PARTNERS_READ`; `stores` dep                                                                | 204          | no      |
| `services/kitluy-management-api/openapi.yaml`                                 | 2 paths (3 operations) + 3 schemas                                                                                                                  | 204          | no      |
| `services/kitluy-management-api/test/digital-store-routes.test.ts`            | NEW (9)                                                                                                                                             | 204          | no      |
| `apps/kitluy-admin-pwa-portal/src/{routing,access,management-client}.ts`      | routes `stores`, `store_new`; permission constants; DTOs and `listStores`, `getStoreCreationOptions`, `createStore`; `classifyResponse` accepts 201 | 206          | no      |
| `apps/kitluy-admin-pwa-portal/src/views.tsx`                                  | nav links; `StoreListView`; `StoreCreateView`                                                                                                       | 206          | no      |
| `apps/kitluy-admin-pwa-portal/src/App.tsx`                                    | load list and options per route; `onCreateStore` re-reads options                                                                                   | 206          | no      |
| `apps/kitluy-admin-pwa-portal/src/messages.ts`                                | 30 keys in both locales                                                                                                                             | 206          | no      |
| `apps/kitluy-admin-pwa-portal/test/store-creation.test.tsx`                   | NEW (9)                                                                                                                                             | 206          | no      |
| `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md` | one row                                                                                                                                             | this handoff | no      |

## 5. Implementation details

### Schema/data/migrations

Additive: one permission row, one grant row, one function. No table change. Applied to both local stacks by psql with ledger rows (same reason as Slice 2B).

### Permissions/audit/security

`store.digital_store.create` is Admin-only; the door is reachable by `service_role` only and never by a browser role (guarded on apply and asserted in section 59). The audit row carries `actor_id` (the Admin's user id from the verified token), `permission_key`, `reason`, `environment` and a hash of what was written. Partner visibility adds scope rows only to assignments the Tenant's staff already hold; it never creates a role assignment and never crosses Tenants.

### UI/localization/accessibility

`data-store-created`, `data-store-refused`, `data-store-status`, `data-partner-staff`, `data-notice` hooks; ready-gated submit like the approval form; both locales.

## 6. Acceptance criteria evidence

| Criterion                                                                               | Result                                                                             | Evidence                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Admin creates a Store; Partner is refused                                               | PASS                                                                               | 0215 guard + section 59 (Partner role holds no grant); route auth matrix |
| DRAFT Store with the first Location and link, and an audit row                          | PASS                                                                               | section 59; `kitluy-fresh` smoke                                         |
| Roadmap vertical, duplicate code, blank reason, pilot without a second approver refused | PASS                                                                               | section 59                                                               |
| The new Store is visible to the Tenant's existing Partner staff when asked              | PASS (scope rows written, count returned) / NOT RUN (a Partner session listing it) | section 59 count check                                                   |
| Store created from `#/stores/new`, audit id shown, appears in `#/stores`                | PASS (renderToString) / NOT RUN (browser)                                          | `store-creation.test.tsx`                                                |

## 7. Validation performed

| Command                                                                                                        | Result                                                                         | Notes                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrations:check`                                                                                     | PASS (114 files)                                                               |                                                                                                                                                                                                                                                                                                                  |
| apply 0215 by psql to `kitluy-fresh` and `kitluy-repo17`                                                       | PASS                                                                           | ledger rows recorded                                                                                                                                                                                                                                                                                             |
| door smoke on `kitluy-fresh` (rolled back)                                                                     | PASS                                                                           | CREATED, Location, 1 Partner scope, 1 audit row                                                                                                                                                                                                                                                                  |
| assertion SECTION 59 standalone on both stacks                                                                 | PASS                                                                           | `pnpm db:test` itself cannot run here (Slice 2B §8)                                                                                                                                                                                                                                                              |
| Management API typecheck, `test` (148/148), `test:contract`, eslint                                            | PASS                                                                           |                                                                                                                                                                                                                                                                                                                  |
| Admin Portal typecheck, `test` (107/107 with the three `VITE_*` names blanked), eslint, prettier, `vite build` | PASS                                                                           | the smoke-test environmental caveat of Slice 2A applies                                                                                                                                                                                                                                                          |
| `pnpm docs:registry-check`, `pnpm secret:scan`                                                                 | PASS (65 rows carry evidence; 1879 files clean)                                |                                                                                                                                                                                                                                                                                                                  |
| `pnpm verify`                                                                                                  | FAIL on Format check, Lint, Unit tests, Docs link check; every other step PASS | unit-test failures: test/governed-emergency-concurrency.integration.test.ts, test/scope-consumption-concurrency.integration.test.ts — the same pre-existing set as before this program (device-identity concurrency suites); every new suite ran inside the unit-test step. Log: `scratchpad/pnpm-verify-2d.log` |

## 8. Not run / not verified

- A browser run: sign in as the HET admin, create a Store, then sign in as the Partner and see it in the Partner Portal's Store list.
- Hosted deployment of 0213–0215 (owner-operated, KL-PT-CLOUD-603).
- `pnpm db:test` end to end (Slice 2B §8).

## 9. Risks and known limitations

| Severity | Risk/limitation                                                                                                                                                    | Impact           | Mitigation/follow-up                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------- |
| LOW      | The Tenant-status refusal lists `SUSPENDED`, `CLOSED`, `TERMINATED`; the tenant status vocabulary was not found as an enum, so other closed-like values would pass | dev data         | confirm the vocabulary at KL-PT-CLOUD-603                                  |
| LOW      | No Store edit, vertical-lock or Location-add door yet; the first Location is the only one this door creates                                                        | onboarding scope | spec routes `/digital-stores/{id}/vertical-lock`, `/store-locations` later |
| LOW      | Partner visibility reaches only staff already scoped to a Store of the Tenant; a brand-new Tenant with no staff needs the Partner seeding step first               | dev onboarding   | the form says so when the count is zero                                    |

## 10. Blockers and open decisions

None. Owner may change the visibility default or the risk class (recorded under the clarifications entry).

## 11. Rollback / recovery

Code: revert the files in §4. Database: drop the function, the permission grant and the permission row on the local stacks; no hosted change.

## 12. Review focus

`create_digital_store_v1` (the scope-propagation CTE, the audit row), `handleCreateDigitalStore` (authority before body; nested field allowlist), `StoreCreateView` readiness gate.

## 13. Next step

Phase 2 is complete at source level. Owner: run both portals against `kitluy-fresh` and walk the loop (create a Store as Admin → see it as the Partner → define a terminal seat → open a session). Then Slice 1B (the graphical Device Shell) so a Pi can type the code, and Phase 3.

## 14. Truth statement

- Production modified by primary coding agent: `NO`.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO` — IMPLEMENTED-IN-DEV with database, service and portal evidence on two local stacks; the browser run and hosted deployment are NOT RUN.
