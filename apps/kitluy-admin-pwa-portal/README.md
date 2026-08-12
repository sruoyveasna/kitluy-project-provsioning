# kitluy-admin-pwa-portal

Admin PWA Portal.

**Status:** BUILT (sign-in, session restore and sign-out, route guard, fleet
list, device detail) on top of the governed Management API. Business surfaces
beyond fleet read are **not** implemented.

## Boundary

HET-internal privileged control plane. Never exposed as a Partner, Chain, Store staff or customer application; never reachable through public Partner signup (RB v4 §8.1).

Source specification: kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md (imported under `docs/source/imported/`).

## Rules

- Operational portal: fails closed when authoritative data contracts do not
  exist. No synthetic operational values.
- Consumes shared contracts and the shared design system; never imports
  another application's internals.
- Authorization is backend + RLS truth; UI hiding is never authorization.
- Exactly one Supabase client, from `@kitluy/supabase-client`. This app never
  constructs its own, and the factory refuses any privileged credential.

## How a device read actually happens

Owner decision **OD-ADMIN-FLEET-001** keeps `kitluy_devices` CLOSED to
browsers, and the schema is not exposed to the data API at all. There is
therefore **no direct device query anywhere in this application** — a browser
attempting one gets `permission denied`, which is the correct outcome. Every
fleet read goes:

```text
browser (user's JWT) → kitluy-management-api → kitluy_auth.has_permission()
                                             → kitluy_devices.device_fleet_status
```

The route guard calls `GET /management/v1/me` and renders the answer. It does
not compute authority, and hiding a link is not authorization: editing the URL
hash reaches a screen whose data the API refuses to send.

## Truthfulness rules encoded in the UI

- `quarantined`, `restricted_investigation` and `suspended` render as
  **abnormal**, and abnormal devices sort to the top of the fleet list.
- Freshness shows `UNKNOWN` or `NEVER_SEEN`. The liveness threshold is an
  unruled owner value, so this portal **never** displays "Online".
- A capped device page says so; an unreachable service says so rather than
  rendering an empty fleet that looks like good news.

## Configuration

Names only — values live outside git. Vite inlines every `VITE_` variable into
the shipped bundle, so only public values may appear:

| Variable                               | Purpose                |
| -------------------------------------- | ---------------------- |
| `VITE_KITLUY_SUPABASE_URL`             | Project URL (public).  |
| `VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY` | Publishable key ONLY.  |
| `VITE_KITLUY_MANAGEMENT_API_URL`       | Management API origin. |

An unconfigured deployment renders "this deployment is not configured" rather
than a blank page.

## Running it locally

Both processes must be up: the portal cannot read devices on its own.

```bash
# 1. Management API (server-side credentials; never in the browser)
pnpm --filter @kitluy-services/kitluy-management-api build
node services/kitluy-management-api/dist/main.js

# 2. Admin Portal
pnpm --filter @kitluy-apps/kitluy-admin-pwa-portal dev
```

Then open the printed Vite URL. Credentials for the development Admin live
outside the repository in the local-config directory recorded in the active
handoff — never in git, never in this file.

## Routes

- `#/login` — sign in.
- `#/devices` — governed fleet list (requires `fleet.read`).
- `#/devices/:id` — device detail with DERIVED provisioning readiness.

Issuing a provisioning code is a governed mutation and is deliberately absent
from this slice; the detail view says so rather than offering an inert button.
