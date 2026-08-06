# KitLuy Suite RBAC Permission Registry — Amendment 003: T1 Customer and Consent v1.0.0

**Filename:** `kitluy-suite-rbac-permission-registry-amendment-003-t1-customer-and-consent-v1.0.0.md`
**Amends:** `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`
(and its `.md` table form) — the imported v1.0.0 original is NEVER edited;
this amendment is additive (precedent: Amendments 001 and 002).
**Authority:** KLD-2026-08-06-WS12-T002-001 §2/§3/§6 (OWNER-APPROVED —
LOCKED, WS-12-T002 owner package, 2026-08-06).
**Effect:** the canonical registry grows **114 → 117 keys**. The
`@kitluy/rbac` seed reproduces all three amendment keys and asserts 117.

## 1. New keys (owner identifiers, verbatim)

| permission               | permitted_action                                                     | resource_type | available_scopes                              | environment_restrictions | reauthentication | approval_requirement | reason_requirement | primary_audit_event        |
| ------------------------ | -------------------------------------------------------------------- | ------------- | --------------------------------------------- | ------------------------ | ---------------- | -------------------- | ------------------ | -------------------------- |
| customers.read           | Search and read scoped customer records at an authorized terminal    | customer      | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_customer.read         |
| customers.create         | Create a minimal unverified customer during T1 intake                | customer      | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_customer.created      |
| customers.consent.record | Record an explicit customer consent decision with immutable evidence | customer      | tenant, digital_store, store_location, device | all                      | No               | A0_NONE              | Not required       | edge_consent.recorded      |

## 2. Reconciliations — NO new key created (owner rule: no duplicate synonyms)

- **Booking-Draft read** reuses `laundry.bookings.read` (CSV row 94, "Read
  Laundry Booking and custody status"): a draft read is a Booking-surface
  read at T1 scope.
- **Booking-Draft create/update/cancel** reuse `laundry.bookings.create`
  (CSV row 95) — the RECORDED command-registry precedent: the WS-09 Hub
  draft commands (`laundry.booking.update_draft` etc.) already map to
  `laundry.bookings.create` "rather than inventing a key", and T002 keeps
  that mapping for the served draft routes. A dedicated
  `laundry.bookings.edit_draft`/`.cancel_draft` split remains available to
  the owner later without breaking this mapping.
- **Customer search vs read** are ONE key (`customers.read`): search is a
  scoped read returning only exact normalized-phone matches inside the
  authenticated Tenant + Digital Store; a separate search key would be a
  synonym.
- Consent WITHDRAWAL is not a separate key: a withdrawal is a consent
  decision (append-only fact) and rides `customers.consent.record`.
- Phone VERIFICATION has NO key here: no T1 route may mark a phone
  verified (owner decision §2.7); the verification authority arrives with
  its own future surface and key.
