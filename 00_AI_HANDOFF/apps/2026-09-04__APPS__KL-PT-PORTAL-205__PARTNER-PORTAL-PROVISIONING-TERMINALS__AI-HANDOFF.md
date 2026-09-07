# Partner Portal: Provisioning → Terminals (Slice 2C)

## 0. Identity

| Field         | Value                                                                                                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task id       | `KL-PT-PORTAL-205`                                                                                                                                                                                                                        |
| Area          | apps (`apps/kitluy-partner-pwa-portal`)                                                                                                                                                                                                   |
| Date          | 2026-09-04                                                                                                                                                                                                                                |
| Authority     | `KLD-2026-09-03-TERMINAL-PROVISIONING-001` §6, §17; `KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001` (no QR, optional name, Hub tab default); program plan "Phase 2 detailed", Slice 2C; the Management API contract of Slice 2B |
| Branch        | `claude/fix-firstboot-esm-and-ssh-hostkeys` (working tree, uncommitted — committing is the owner's call)                                                                                                                                  |
| Status        | `PARTIAL` — source, tests and build complete; a browser run against the local stack with a real Partner session NOT RUN; no Pi has typed a code                                                                                           |
| Hosted writes | none                                                                                                                                                                                                                                      |

## 1. Outcome

- The Partner Portal has hash routing and two screens per Store: the existing Store Hub pairing screen (moved, behaviour unchanged, now the "Store Hub" tab and the default landing) and the new **Provisioning → Terminals** tab at `#/stores/{storeId}/terminals`. The Store id lives in the hash, nothing in browser storage.
- On the Terminals tab a Partner sees the Store Hub's readiness first (active / paired-awaiting-certificate / none / not reported), the seats of the Store with their role short codes, Location, bound device and a provisioning ladder, a form to define a seat (optional name, Location, role checkboxes from the vertical vocabulary), and per seat an "Open pairing session" action that shows the 8-character code once with a countdown, live status polling, failed-attempt count and Cancel. No QR anywhere.
- **The Hub precondition fails closed**: Pair is offered only when the API reports the Store Hub `active`; a pending, absent or unreported Hub replaces the button with the reason and a link to the Hub tab.
- **The ladder reports, never infers**: eight rungs in the owner's order (Hub active → code issued → code used → connected to Hub → activated → app installed → PIN set → active); each is done, next, blocked or "not yet reported"; a bound device makes "issued" and "used" done, an `active` lifecycle makes "activated" done, and nothing marks app / PIN / serving until something reports them. A rung that is not reported is said to be not a failure.
- **Role vocabulary comes from the vertical package** (`@kitluy-verticals/phase1-laundry`, now a dependency), offered only when the API reports the Store's vertical as laundry; labels are app messages in both locales; unknown keys on existing seats render verbatim and marked "not recognised".
- The transport was extracted once (`management-request.ts`) and both clients use it; the Hub client keeps its exact contract (a 404 stays `unavailable` for it) and its tests pass unchanged. One `PairingCodeDisplay` renders both Hub and terminal codes so the two cannot drift.

## 2. Source-of-truth checked

The owner decisions and clarifications; the Slice 2B routes (`services/kitluy-management-api/src/http.ts`, `openapi.yaml`); `apps/kitluy-admin-pwa-portal/src/routing.ts` (the routing precedent); the existing Partner Portal sources and tests; `verticals/phase1-laundry/src/terminal-profiles.ts`.

## 3. Files inspected

All of `apps/kitluy-partner-pwa-portal/src` and `test`, `packages/web-ui/src/index.tsx`, `packages/localization`, the Admin Portal's `routing.ts`, `App.tsx` and `views.tsx`.

## 4. Files changed

| File                                                                                    | Change                                                                                                                                                                 | Authority               | Secret? |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------- |
| `src/routing.ts`                                                                        | NEW: `home` · `hub{storeId}` · `terminals{storeId}` · `unknown`; total parser; `storeRoute`, `routeHref`                                                               | plan 2C                 | no      |
| `src/management-request.ts`                                                             | NEW: the one transport (`ok` · `unauthenticated` · `denied` · `not_found` · `refused` · `unavailable`)                                                                 | plan 2C                 | no      |
| `src/pairing-client.ts`                                                                 | rewired onto the shared transport; public API unchanged; `PartnerStore` gains optional `vertical` and `hub`                                                            | plan 2C                 | no      |
| `src/terminals-client.ts`                                                               | NEW: list, define (blank name omitted), open session, status, cancel; every 200 re-validated                                                                           | plan 2C                 | no      |
| `src/terminal-roles.ts`                                                                 | NEW: vocabulary from the vertical; label (optional, ≤64) and role validation                                                                                           | plan 2C, clarifications | no      |
| `src/terminal-presentation.ts`                                                          | NEW: Hub readiness and gate, the ladder, code face precedence                                                                                                          | plan 2C                 | no      |
| `src/views.tsx`                                                                         | NEW: `NoticePanel`, `StoreNav`, `HubReadinessLine`, `PairingCodeDisplay`, `DefineTerminalForm`, `ProvisioningLadder`, `TerminalPairPanel`, `TerminalsView`             | plan 2C                 | no      |
| `src/hub-screen.tsx`                                                                    | the Hub screen, moved out of `App.tsx`, on the shared display; Store from the route                                                                                    | plan 2C                 | no      |
| `src/terminals-screen.tsx`                                                              | NEW: effects only (load, define then re-read, open after clearing, 1 s tick, 3 s poll that survives transient failure and stops on paired/locked/gone/expired, cancel) | plan 2C                 | no      |
| `src/App.tsx`                                                                           | shell, sign-in, Store navigation, routing; sign-in heading now the portal's                                                                                            | plan 2C                 | no      |
| `src/messages.ts`                                                                       | ~70 keys in both locales, Khmer first; none names a permission, role, table or code                                                                                    | plan 2C                 | no      |
| `package.json`                                                                          | `@kitluy-verticals/phase1-laundry: workspace:*` (lockfile updated)                                                                                                     | plan 2C                 | no      |
| `test/routing.test.ts`, `test/terminals-logic.test.ts`, `test/terminals-views.test.tsx` | NEW (4 + 20 + 12)                                                                                                                                                      | plan 2C                 | no      |
| `README.md`                                                                             | rewritten: boundary, rules, routes, configuration, run recipe, tests                                                                                                   | this handoff            | no      |

## 5. Implementation details

### Functional behavior

`SignedIn` loads the Stores once, redirects `#/` to the first Store's Hub tab, and renders `StoreNav` plus the routed screen keyed by Store id (a Store change remounts the screen, which clears any code on screen). `TerminalsScreen` keeps the issued code in component state only. `deriveLadder` is a pure function of `{hub, terminal, session}` and the clock.

### UI/localization/accessibility

Every string in both locales; `aria-label` per section (`store`, `terminals`, `define-terminal`, `provisioning-ladder`, `terminal-pairing`, `pairing-code`); the ungrouped code in `aria-label`; colour redundant with words; `data-*` hooks for tests (`data-hub-readiness`, `data-blocked`, `data-rung`/`data-rung-state`, `data-paired`, `data-locked`, `data-cancelled`, `data-gone`, `data-vocabulary`, `data-form-error`).

### Permissions/audit/security

None decided in the browser. The API decides `fleet.terminal_pairing_code.issue` and Store scope per request; the portal only avoids offering dead ends.

## 6. Acceptance criteria evidence

| Criterion                                                                               | Result                         | Evidence                                              |
| --------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- |
| Terminals list, define form, Pair action, code once with countdown, status poll, Cancel | PASS (source + renderToString) | `terminals-views.test.tsx`, `terminals-logic.test.ts` |
| Hub precondition shown, Pair withheld unless `active`; unreported fails closed          | PASS                           | logic + views tests                                   |
| Ladder with the eight rungs; unreported rungs say so; done rungs never demoted          | PASS                           | logic tests (nine scenarios)                          |
| Exact request shapes: no tenant, blank name omitted, cancel body `{}`, encoded ids      | PASS                           | logic tests                                           |
| The code never appears in an href or src; no QR                                         | PASS                           | views test                                            |
| Existing Hub pairing tests pass unchanged                                               | PASS                           | `pairing-logic.test.ts` 18/18                         |
| A Partner defines a seat and opens a session in a browser against `kitluy-fresh`        | NOT RUN                        | owner step (§13)                                      |

## 7. Validation performed

| Command                                                                                    | Result                                                                         | Notes                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kitluy-apps/kitluy-partner-pwa-portal typecheck`                           | PASS                                                                           |                                                                                                                                                                                                                                                                                                    |
| `pnpm --filter @kitluy-apps/kitluy-partner-pwa-portal test` (three `VITE_*` names blanked) | PASS 56/56                                                                     | on this workstation without blanking, the smoke test's "unconfigured" assertion fails because Vite loads the app's `.env.local` under vitest — pre-existing, environmental, recorded in Slice 2A                                                                                                   |
| `pnpm exec eslint` on `src` and `test`                                                     | PASS                                                                           |                                                                                                                                                                                                                                                                                                    |
| `pnpm exec prettier --check`                                                               | PASS                                                                           |                                                                                                                                                                                                                                                                                                    |
| `pnpm --filter @kitluy-apps/kitluy-partner-pwa-portal build`                               | PASS (94 modules)                                                              |                                                                                                                                                                                                                                                                                                    |
| `pnpm docs:registry-check`, `pnpm secret:scan`                                             | PASS (64 rows carry evidence; 1879 files clean)                                |                                                                                                                                                                                                                                                                                                    |
| `pnpm verify`                                                                              | FAIL on Format check, Lint, Unit tests, Docs link check; every other step PASS | unit-test failures: test/governed-emergency-concurrency.integration.test.ts, test/scope-consumption-concurrency.integration.test.ts — the same pre-existing set (device-identity concurrency suites); the Partner Portal suite ran inside the unit-test step. Log: `scratchpad/pnpm-verify-2c.log` |

## 8. Not run / not verified

- A browser session against the local Management API and `kitluy-fresh` with a real Partner login (define "Front Counter 01", open a session, see the code and the ladder). The API side is proven by its own tests and the database by section 58; the browser wiring is proven by `renderToString` only.
- The 3-second poll loop and the 1-second tick are effects; they follow the Hub screen's proven shape and are not unit-tested.

## 9. Risks and known limitations

| Severity | Risk/limitation                                                                                                                                                                  | Impact                    | Mitigation/follow-up     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------ |
| LOW      | The portal now depends on `@kitluy-verticals/phase1-laundry` resolved from `dist`; a fresh checkout must build the vertical before typecheck or dev (turbo's `^build` covers CI) | local setup               | README recipe            |
| LOW      | The ladder's "connected to Hub", "app installed", "PIN set" and "active" rungs have no reporter yet                                                                              | always "not yet reported" | Phases 3–5               |
| LOW      | Both portals' smoke tests assume no `VITE_*` under vitest                                                                                                                        | false red locally         | follow-up recorded in 2A |

## 10. Blockers and open decisions

None. Owner may reorder tabs or wording.

## 11. Rollback / recovery

Revert the files in §4 and the lockfile line; no data changed.

## 12. Review focus

`terminal-presentation.ts` (`deriveLadder`, `canOpenTerminalSession`), `terminals-screen.tsx` effects (poll stop conditions), `terminals-client.ts` body shapes, `messages.ts` Khmer.

## 13. Next step

1. Owner: run the Management API and the Partner Portal locally, sign in as the Partner, open the Terminals tab for the demo Store, add "Front Counter 01" with T1 + T2, open a session and read the code. The Hub must be `active` for the Pair action to appear.
2. Slice 2D: Admin creates a Digital Store (plan "Phase 2 detailed", Slice 2D).

## 14. Truth statement

- Production modified by primary coding agent: `NO`.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO` — IMPLEMENTED-IN-DEV at source, test and build level; the browser run is NOT RUN.
