# KitLuy Suite RBAC Permission Registry — Amendment 002: T1 Staff Sessions v1.0.0

**Filename:** `kitluy-suite-rbac-permission-registry-amendment-002-t1-staff-sessions-v1.0.0.md`
**Amends:** `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`
(and its `.md` table form) — the imported v1.0.0 original is NEVER edited;
this amendment is additive, the data-dictionary amendment pattern
(precedent: Amendment 001, device containment).
**Authority:** KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §4 (OWNER-APPROVED
— LOCKED, WS-12-T001-P02 owner package, 2026-08-06).
**Effect:** the canonical registry grows **109 → 114 keys**. The
`@kitluy/rbac` seed reproduces all five amendment keys and asserts 114.

## 1. New keys (owner identifiers, verbatim)

| permission             | permitted_action                                                  | resource_type    | available_scopes                              | environment_restrictions | reauthentication | approval_requirement | reason_requirement | primary_audit_event    |
| ---------------------- | ----------------------------------------------------------------- | ---------------- | --------------------------------------------- | ------------------------ | ---------------- | -------------------- | ------------------ | ---------------------- |
| staff.sessions.open    | Open a Hub-issued Edge terminal staff session                     | terminal_session | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_session.opened    |
| staff.sessions.read    | Read the state of an Edge terminal staff session                  | terminal_session | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_session.read      |
| staff.sessions.refresh | Extend an open Edge terminal staff session within governed policy | terminal_session | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_session.refreshed |
| staff.sessions.close   | Close an Edge terminal staff session and clear profile state      | terminal_session | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_session.closed    |
| pos.t1.use             | Operate the T1 POS Cashier / Intake shell                         | terminal_session | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_session.opened    |

These keys discharge the four `PERMISSION_GAP_EDGE_SESSION_*` markers in
`@kitluy/edge-contracts` (open/refresh/close mapped directly; see §2 for
switch). **Opening or restoring a session does not authorize T1 by
itself** — the effective staff session must ALSO include `pos.t1.use`.
Backend authorization, Hub policy and local relational authority remain
mandatory; renderer visibility is not authorization.

## 2. Recorded interpretation — the `switch` route

The owner decision maps "the existing four `/edge/v1/sessions/*` routes to
the corresponding session permission" while registering `open`, `read`,
`refresh` and `close`. The `sessions/switch` route (change the bound staff
actor) has no same-named key; the recorded mapping is `staff.sessions.open`
as its primary permission with `staff.sessions.close` conditional — a
switch closes the incumbent actor's session and opens the successor's.
Recorded as an interpretation, not silently invented; the owner may name a
dedicated `staff.sessions.switch` key later without breaking this mapping.
`staff.sessions.read` currently gates no served route (the T1 runtime does
not restore sessions across restart); it is registered now so the read
surface, when approved, has its key.

## 3. Reconciliations — NO new key created (owner rule: no duplicate synonyms)

- "T1 entry" needs no vertical key: `pos.t1.use` is the shell permission;
  the operational capabilities inside T1 remain the existing
  `laundry.bookings.*` / `payments.*` keys.
- Session revocation remains `identity.sessions.revoke`
  (Management-surface) and `support.session.revoke` (support surface) —
  neither is duplicated at the Edge.
