# kitluy-partner-pwa-portal

Partner PWA Portal — the Partner's back office for one active Digital Store context.

**Status:** BUILT for two screens per Store: Store Hub pairing (proven on
hardware, BRINGUP-001 to 003) and **Provisioning → Terminals** (Slice 2C of the
Pi Terminal provisioning program, 2026-09-04) against the Management API routes
of group 0213. Statuses per capability live in the implementation status and
evidence register; nothing here is a register claim.

## Boundary

- A browser holding the Partner's own session. It never reads `kitluy_devices`
  or `kitluy_core` directly: both are closed to the data API, and every governed
  door is granted to a service identity only. Every call goes to the Management
  API and every answer is decided server-side.
- Authorization is backend + RLS truth. Hiding a control here is never
  authorization; the API re-decides permission and Store scope per request.
- Consumes shared contracts from `packages/` and the terminal profile keys from
  `@kitluy-verticals/phase1-laundry`. The labels for those keys are this app's
  messages, offered only when the API reports the Store's vertical as laundry.

## Rules

- A one-time pairing code (Hub or terminal) is shown once and is never logged,
  stored, put in a URL or drawn from one. There is no QR: the installer types
  the code on the device (owner clarification 2026-09-04).
- Every data surface fails closed: a 200 with an unexpected body is
  "unavailable", never an empty list; an unconfigured deployment says so.
- The Store Hub is the precondition of every terminal. When the API reports the
  Hub as anything but `active` — or does not report it — the Pair action is
  replaced by the reason. Nothing is inferred.
- The provisioning ladder shows what was REPORTED: done, next, blocked, or "not
  yet reported". A step nothing reported is not a failure.
- Unknown terminal profile keys on an existing terminal are shown verbatim and
  marked "not recognised"; they are never coerced.

## Routes (hash)

| Hash                           | Screen                                      |
| ------------------------------ | ------------------------------------------- |
| `#/`                           | the first Store's Hub tab, once Stores load |
| `#/stores/{storeId}/hub`       | Store Hub pairing (PRT-SCR-061)             |
| `#/stores/{storeId}/terminals` | Provisioning → Terminals (PRT-SCR-062)      |

The Store id in the hash is the Partner's active Digital Store context, made
reload-safe without browser storage.

## Configuration

Names only — values live outside git.

| Variable                               | Purpose                |
| -------------------------------------- | ---------------------- |
| `VITE_KITLUY_SUPABASE_URL`             | Project URL (public).  |
| `VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY` | Publishable key ONLY.  |
| `VITE_KITLUY_MANAGEMENT_API_URL`       | Management API origin. |

## Running locally

```bash
pnpm --filter @kitluy-verticals/phase1-laundry build      # terminal profile keys, resolved from dist
pnpm --filter @kitluy-services/kitluy-management-api build
node services/kitluy-management-api/dist/main.js           # its env names: see that service's README
pnpm --filter @kitluy-apps/kitluy-partner-pwa-portal dev
```

## Tests

`pnpm --filter @kitluy-apps/kitluy-partner-pwa-portal test` — pure logic
(transport classification, exact request shapes, countdown, Hub gate, ladder
derivation, role vocabulary and validation) and `renderToString` views for every
operator-visible state. The smoke test asserts the unconfigured case; a
workstation whose `.env.local` is loaded by Vite under vitest makes that one
assertion fail (known, environmental).
