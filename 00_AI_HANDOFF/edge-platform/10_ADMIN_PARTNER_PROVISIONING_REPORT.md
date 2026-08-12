# Admin and Partner provisioning report

**Date:** 2026-08-07
**Result: NO PROVISIONING UI WAS BUILT.** E11 and E12 are NOT STARTED.

---

## 1. Statement

No Admin Portal provisioning capability was added.
No Partner Portal provisioning capability was added.
No route, screen, component or permission wiring exists in either portal that
did not exist at intake. Both remain two-source-file Vite skeletons.

This is reported as **not done**, not as partially done.

## 2. Why

The mission gates these units behind working backend contracts (§21). Those
contracts exist. The gate that does not clear is different: **there is no cloud
database carrying the canonical schema** (`05_CLOUD_SUPABASE_PLAN.md` §2).

A fleet-provisioning UI whose entire purpose is to operate real devices, built
against an API base URL that does not exist and never rendering a real device
row, would not be "minimum provisioning capability" — it would be a mockup
described as capability. That is the specific claim this repository's status
rules exist to prevent.

Building both portals from zero — routing, auth, design-system adoption, data
layer, then roughly nine screens each — is also larger than every other unit of
this mission combined, and none of it would be verifiable end to end until the
cloud target exists.

## 3. What unblocks them

One thing: **an empty Supabase project carrying the canonical lineage**, and its
reference recorded in repository configuration. Every backing contract is
already built (`03_PROVISIONING_UI_INVENTORY.md` §3).

## 4. Constraints that carry into that work

- **Partners must never see global unassigned fleet inventory.** RLS on
  `kitluy_devices` is the authority. Frontend hiding is not authorisation.
- **Sensitive actions** require authorisation, reason, re-auth where required,
  audit, and four-eyes where `@kitluy/approvals` requires it. All are enforced
  server-side already; the UI surfaces them and must not re-implement them.
- **Use the existing design system** (`@kitluy/web-ui`), not new components.
- **Do not rebuild the full portals** — only what is needed to operate and test
  provisioning.
