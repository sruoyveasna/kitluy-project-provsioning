# Admin Portal tells the four lifecycle stages apart, and shows a Pi Terminal's assignment (Slice 2A)

## 0. Identity

| Field         | Value                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task id       | `KL-PT-PORTAL-206` (part 1 of 2; part 2 is the Digital Store screen in Slice 2D)                                                                                                                                                  |
| Area          | apps (`apps/kitluy-admin-pwa-portal`) + one read model change in `services/kitluy-management-api`                                                                                                                                 |
| Date          | 2026-09-04                                                                                                                                                                                                                        |
| Authority     | `KLD-2026-09-03-FACTORY-ENROLLMENT-001` §7 (the Admin must distinguish NEW → APPROVED → ASSIGNED → ACTIVE); `KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001` (order 2A first); program plan "Phase 2 detailed", Slice 2A |
| Branch        | `claude/fix-firstboot-esm-and-ssh-hostkeys` (working tree, uncommitted — committing is the owner's call)                                                                                                                          |
| Status        | `PARTIAL` — source and tests complete; owner browser check against the local stack NOT RUN                                                                                                                                        |
| Hosted writes | none                                                                                                                                                                                                                              |

## 1. Outcome

- The Admin Portal now labels every value of `kitluy_devices.device_lifecycle_state` in both locales, and the four owner-locked stages read differently: `manufactured` "Waiting for approval", `enrolled` "Approved, not assigned to a Store", `awaiting_trust` "Assigned to a Store, awaiting activation", `active` "Active". Before this, `enrolled` read as a bare "Approved" (which reads as "ready") and `awaiting_trust` — the PAIRED / ASSIGNED stage — fell through to the raw enum.
- The "Pi Terminal" class filter works for the first time: it filtered on `pi_terminal`, a value the database never produces (`terminal`). The first real terminal (`KL-6783D70CB6BF`, 2026-09-03) vanished the moment an operator selected it.
- A Terminal row shows its assignment in stage words — Unassigned / Assigned, awaiting activation / Active — with the profile count and the Store's human label (`store_code — name`) under it, never a UUID. The fleet summary gained an "Assigned, awaiting activation" tile. The detail page shows the plain words and the raw enum side by side, so an operator can quote the enum over the phone.
- The Management API's fleet DTO carries `digitalStoreLabel` and `locationLabel` from left joins to `kitluy_core`, read with the trusted identity only after `authorizeRequest` — the same precedent as the Partner route's `resolveStoreScope`. The raw `*Reference` ids stay in the DTO and stay unrendered.
- Owner clarifications from the planning session are recorded in the decision register (`KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001`): no QR anywhere, no login tooling, optional terminal name, Phase 2 order.

## 2. Source-of-truth checked

`docs/decisions/kitluy-factory-enrollment-lifecycle-owner-decision-v1.0.0.md` §7 and the register's repository mapping (`manufactured` / `enrolled` / `awaiting_trust` / `active`); `supabase/migrations/…0120…` and `…0121…` for the enum (nine values) and `device_class` (`terminal`); `…0122…` for `device_fleet_status`; `services/kitluy-management-api/src/hub-pairing-issuance.ts` `listPartnerStores` for the label format; the program plan file's "Phase 2 detailed" section.

## 3. Files inspected

`apps/kitluy-admin-pwa-portal/src/{App,views,device-presentation,messages,management-client,routing,access}.ts*`, its five test files, `services/kitluy-management-api/src/{fleet,http,hub-pairing-issuance,partner-authorization}.ts` and its tests, the decision register tail.

## 4. Files changed

| File                                                                            | Change                                                                                                                                                                                                             | Authority                | Secret? |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------- |
| `apps/kitluy-admin-pwa-portal/src/messages.ts`                                  | nine `lifecycle*` keys, four `terminal*` keys, `summaryAssignedAwaiting`, `classPiTerminal` → `classTerminal`, both locales                                                                                        | plan 2A.1                | no      |
| `apps/kitluy-admin-pwa-portal/src/device-presentation.ts`                       | `LIFECYCLE_MESSAGE` map + `KNOWN_LIFECYCLES`; `lifecycleLabel` through `t()` with the verbatim fallback kept; `DeviceClassFilter` value `terminal`; `terminalAssignmentSummary()`; `FleetSummary.assignedAwaiting` | plan 2A.2                | no      |
| `apps/kitluy-admin-pwa-portal/src/views.tsx`                                    | `TerminalAssignmentCell` + `AssignmentCell` dispatcher; class option `terminal`; sixth summary tile; detail page shows label + `<code>enum</code>` and the assignment                                              | plan 2A.3                | no      |
| `apps/kitluy-admin-pwa-portal/src/management-client.ts`                         | `FleetDeviceView.digitalStoreLabel` / `locationLabel`                                                                                                                                                              | plan 2A.4                | no      |
| `services/kitluy-management-api/src/fleet.ts`                                   | DTO + row + `FLEET_FROM` with two left joins; qualified columns                                                                                                                                                    | plan 2A.4                | no      |
| `apps/kitluy-admin-pwa-portal/test/{fleet-summary,portal-logic,views}.test.ts*` | fixtures gain the two labels; `pi_terminal` → `terminal`; new assertions (nine labels in both locales, stage words, summary tile, terminal row and detail rendering, `terminalAssignmentSummary`)                  | plan 2A.5                | no      |
| `services/kitluy-management-api/test/{authorization,management-routes}.test.ts` | fixtures gain the two labels                                                                                                                                                                                       | plan 2A.5                | no      |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`          | `KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001` appended                                                                                                                                                 | owner answers 2026-09-04 | no      |
| `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`   | one row for this slice                                                                                                                                                                                             | this handoff             | no      |

## 5. Implementation details

### Functional behavior

`lifecycleLabel` is now a lookup over a nine-entry map; an unknown value is still returned verbatim (the existing test for `some_future_state` still passes). `terminalAssignmentSummary` mirrors `hubAssignmentSummary`: `null` for anything that is not a `terminal`; `pending_trust` is the ASSIGNED stage; unknown assignment states are shown verbatim. The summary bar counts `awaiting_trust` separately from `manufactured`.

### Schema/data/migrations

None. The fleet query joins `kitluy_core.digital_stores` and `kitluy_core.store_locations` on the ids the view already exposes; an unassigned device yields nulls.

### Permissions/audit/security

No authorization change. The labels are read after `authorizeRequest` with `fleet.read`, in the same trusted-identity read the fleet view already used. Nothing new reaches the browser except two human labels.

### UI/localization/accessibility

Every new string is in both locales, Khmer first; the key-parity test enforces it. Colour stays redundant with text. `data-terminal-assignment` and `data-lifecycle` hooks carry the state for tests and screen readers.

## 6. Acceptance criteria evidence

| Criterion                                                                                | Result  | Evidence                                                                                               |
| ---------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Every lifecycle enum value has a label in both locales; the four stages read differently | PASS    | `fleet-summary.test.tsx` "has a label for every value" (9), "keeps the four owner-locked stages apart" |
| The Pi Terminal filter matches a real terminal                                           | PASS    | `portal-logic.test.ts` filter cases on `terminal`; `views.test.tsx` `<option value="terminal">`        |
| A Terminal row shows stage words, profile count and Store label, never a UUID            | PASS    | `views.test.tsx` "a Pi Terminal in the fleet list"                                                     |
| API DTO carries the two labels                                                           | PASS    | `management-routes.test.ts` fixture; SQL probe on `kitluy-fresh` (§7)                                  |
| Owner sees `KL-6783D70CB6BF` as "Approved, not assigned to a Store" in the browser       | NOT RUN | owner step (§13)                                                                                       |

## 7. Validation performed

| Command                                                                     | Result                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kitluy-apps/kitluy-admin-pwa-portal typecheck`              | PASS                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm --filter @kitluy-apps/kitluy-admin-pwa-portal test`                   | 97/98 on this workstation; **98/98** with the three `VITE_*` names forced blank | the one failure is `test/smoke.test.tsx` "fails closed (no fake operational data)": it assumes no `VITE_*` value exists under vitest, but Vite loads the app's `.env.local` in test mode, so on any configured workstation the App renders as configured. Pre-existing, environmental, not caused by this slice (App.tsx is untouched). See §9.                                                                                                                                                                                                                                                                                                                                              |
| `pnpm --filter @kitluy-services/kitluy-management-api typecheck` and `test` | PASS, 129/129                                                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm exec eslint` on the changed portal and API files                      | PASS                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm exec prettier --check` on every changed file                          | PASS                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| SQL probe of the new fleet query on `kitluy-fresh` (`docker exec … psql`)   | PASS                                                                            | two rows, both labels null (neither board is assigned yet), no error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm docs:registry-check`, `pnpm secret:scan`                              | PASS (62 rows carry evidence; 1879 files clean)                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm verify`                                                               | FAIL on the same four pre-existing steps, none from this slice                  | Format: prettier cannot enter `infra/kitluy-os-image/build/work/chroot-v2.7.0/filesystem/persistent/home/pi` (rootless build tree); Lint: one unused-variable error in the untracked `scripts/database/apply-dev-supautils-hint-workaround.mjs`; Unit tests: the two `@kitluy/device-identity` concurrency suites (integration, role borrow) — the admin portal suite passed under turbo; Docs link check: four broken links in `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`. Typecheck, contract tests, offline harness, build, OpenAPI, migration validation, secret scan and clock usage PASS. Log: `scratchpad/pnpm-verify-2a.log` |

## 8. Not run / not verified

- The owner's browser check against `kitluy-fresh` (Admin Portal + Management API running locally). The rendering is proven by `renderToString`; what is not proven is the live DTO through the real route with a real admin token.

## 9. Risks and known limitations

| Severity | Risk/limitation                                                                                                                                                                  | Impact                                 | Mitigation/follow-up                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| LOW      | Both portals' smoke tests assert "unconfigured" by assuming vitest sees no `VITE_*` values; a workstation with `.env.local` makes them fail                                      | false red in `pnpm verify` locally     | follow-up: give `App` an explicit env input for tests (or clear the three names in a vitest setup file) — both portals |
| LOW      | `terminalAssignmentSummary` derives the stage from `assignmentState` and the count; profile keys and the physical terminal label arrive only with Slice 2B's `assignmentContext` | count without names for now            | Slice 2B                                                                                                               |
| LOW      | `evaluateProvisioningReadiness` still re-implements eligibility in TypeScript (one of three disagreeing definitions)                                                             | detail page may disagree with the door | Slice 2B (migration 0214 + adapter)                                                                                    |

## 10. Blockers and open decisions

None for this slice.

## 11. Rollback / recovery

Revert the nine files in §4; no data or schema changed.

## 12. Review focus

`device-presentation.ts` (the map and the verbatim fallback), `views.tsx` `TerminalAssignmentCell`, and the `FLEET_FROM` join in `fleet.ts` (left joins; qualified columns; read after authorization).

## 13. Next step

1. Owner: run the Management API against `kitluy-fresh` and the Admin Portal (`pnpm --filter @kitluy-apps/kitluy-admin-pwa-portal dev`), open Devices, confirm the terminal reads "Approved, not assigned to a Store", the Hub "Waiting for approval", and that the "Pi Terminal" filter shows the terminal.
2. Slice 2B: migrations 0213–0215, the registry `POST /v1/terminal-pairing` route, the Partner terminal routes in the Management API, and the `GET /devices/{id}` context and readiness adapter (plan "Phase 2 detailed", Slice 2B).

## 14. Truth statement

- Production modified by primary coding agent: `NO`.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO` — IMPLEMENTED-IN-DEV at source and test level; the owner's browser check is NOT RUN.
