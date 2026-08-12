# Provisioning UI inventory

**Date:** 2026-08-07
**Status of E11 and E12: NOT STARTED — deliberately, and reported as such.**

---

## 1. Baseline

| Portal                           | Files (excl. `node_modules`, `dist`) | Source files          | Routes | Provisioning UI |
| -------------------------------- | ------------------------------------ | --------------------- | ------ | --------------- |
| `apps/kitluy-admin-pwa-portal`   | 11                                   | `App.tsx`, `main.tsx` | none   | none            |
| `apps/kitluy-partner-pwa-portal` | 12                                   | `App.tsx`, `main.tsx` | none   | none            |

Neither portal has routing, a data layer, an auth integration, or any use of the
`@kitluy/web-ui` design system. Both are Vite starter skeletons with a smoke
test.

## 2. Why nothing was built

The mission gates both units explicitly:

> §21 — "**Only after backend contracts exist**, inspect
> `apps/kitluy-admin-pwa-portal`."

The backend contracts do exist. The gate that does **not** clear is different:
a provisioning UI's entire purpose is to operate a fleet, and there is **no
cloud database carrying the canonical schema** for it to operate against
(`05_CLOUD_SUPABASE_PLAN.md` §2). Building fleet screens now would produce UI
that has never rendered a real device row, against an API base URL that does not
exist, and calling that "minimum provisioning capability" would misrepresent it.

Building both portals from zero — routing, auth, design system adoption, data
layer, then the eight or nine provisioning screens each — is also substantially
larger than the remaining units of this mission, and neither would be testable
end to end until the cloud target exists.

**This is reported as not done rather than partially done.** Scaling the mission
down is the owner's call, not the agent's.

## 3. What E11 and E12 need, once a cloud target exists

Both are unblocked immediately by a canonical-lineage Supabase project.

**Admin (E11)** — Device Fleet · Unassigned Devices · Device Detail · Hub
Assignment · Terminal Assignment · Device Health · Release Channel/Version ·
Revoke/Quarantine · Replacement.

Backing contracts all exist: `device_fleet_status` and `fleet_health_read`
views, `/v1/device-credentials/revocations`, `kitluy_releases.*`,
`hub_replacement_operations`.

**Partner (E12)** — Digital Store → Location → claim Store Hub → assign
permitted terminals → choose allowed terminal profile → verify online/health.

Backing contracts exist: `device_claims`, `device_provisioning_codes`
(one-time, expiring, lockout-protected), `device_terminal_assignments`.

Two constraints carry into that work:

- **A Partner must never see global unassigned fleet inventory.** Tenant
  isolation is enforced by RLS on `kitluy_devices`, which is the authority —
  frontend hiding is not authorisation.
- **Sensitive actions require authorisation, reason, re-auth where required and
  audit**, and four-eyes where `@kitluy/approvals` requires it. Those are
  server-side and already enforced; the UI must surface them, not re-implement
  them.
