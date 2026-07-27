/**
 * Audit/domain event names emitted by Edge routes.
 *
 * Source authority: KLD-2026-07-26-002 Group 4 (APPROVED WITH CORRECTION) —
 * canonical event names are stable semantic facts of the form
 * `<bounded_context>.<past_tense_fact>`, validated by
 * `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`. Schema versions live ONLY in the
 * envelope (`schema_version`); a `.v1` suffix must never be embedded in the
 * canonical name.
 *
 * The regex is declared locally on purpose: `@kitluy/event-contracts` is being
 * changed concurrently under a different task, and Neutral Core route contracts
 * must not take a build dependency on that churn. The pattern below is quoted
 * verbatim from the owner decision; if the two ever diverge, the owner decision
 * wins and the divergence is a conflict to record, not to reconcile silently.
 */

/** Canonical domain/audit event name pattern (KLD-2026-07-26-002 Group 4). */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isCanonicalEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name);
}

/**
 * `registered` — the name appears in
 * `docs/source/api-contracts/kitluy-domain-event-registry-v1.0.0.md`.
 * `proposed`  — the name conforms to the Group 4 grammar but is not yet in the
 *               Domain Event Registry and must be registered before release.
 */
export type AuditEventStatus = "registered" | "proposed";

/** Names registered in the Domain Event Registry v1.0.0 that Edge routes emit. */
export const REGISTERED_DOMAIN_EVENTS = [
  /** EVT-LND-001. */
  "laundry_booking.created",
  /** EVT-LND-002. */
  "laundry_booking.ready",
  /** EVT-LND-003. */
  "garment.custody_scanned_in",
  /** EVT-LND-004. */
  "garment.custody_scanned_out",
  /** EVT-PAY-001. */
  "payment.recorded",
] as const;

export function auditEventStatus(name: string): AuditEventStatus {
  return (REGISTERED_DOMAIN_EVENTS as readonly string[]).includes(name) ? "registered" : "proposed";
}

/**
 * RECONCILIATION — the RBAC permission registry CSV carries a
 * `primary_audit_event` column that uses a DIFFERENT bounded-context token for
 * the same facts (`laundry.booking_created` vs the Domain Event Registry's
 * `laundry_booking.created`; `garment.ready_scanned_in` vs
 * `garment.custody_scanned_in`). Both forms satisfy the Group 4 regex, so the
 * grammar does not disambiguate them.
 *
 * This registry uses the Domain Event Registry / Group 4 vocabulary because
 * Group 4 names it explicitly (`laundry_booking.created`, `laundry_booking.ready`,
 * `garment.custody_scanned_in`, `garment.custody_scanned_out`,
 * `payment.recorded`) and an owner decision outranks a supporting registry.
 * The divergence is recorded here rather than resolved silently
 * (CLAUDE.md hard rule 8) and is reported for the reconciliation register.
 */
export interface AuditEventReconciliationEntry {
  readonly rbacPrimaryAuditEvent: string;
  readonly canonicalEventName: string;
  readonly note: string;
}

export const AUDIT_EVENT_RECONCILIATION: readonly AuditEventReconciliationEntry[] = [
  {
    rbacPrimaryAuditEvent: "laundry.booking_created",
    canonicalEventName: "laundry_booking.created",
    note: "RBAC CSV bounded context 'laundry'; Domain Event Registry + Group 4 use 'laundry_booking'.",
  },
  {
    rbacPrimaryAuditEvent: "garment.ready_scanned_in",
    canonicalEventName: "garment.custody_scanned_in",
    note: "RBAC CSV fact 'ready_scanned_in'; Domain Event Registry EVT-LND-003 uses 'custody_scanned_in'.",
  },
  {
    rbacPrimaryAuditEvent: "garment.pickup_scanned_out",
    canonicalEventName: "garment.custody_scanned_out",
    note: "RBAC CSV fact 'pickup_scanned_out'; Domain Event Registry EVT-LND-004 uses 'custody_scanned_out'.",
  },
  {
    rbacPrimaryAuditEvent: "payment.cash_recorded",
    canonicalEventName: "payment.recorded",
    note: "RBAC CSV splits by tender; Domain Event Registry EVT-PAY-001 records one payment fact and carries the tender in the payload.",
  },
  {
    rbacPrimaryAuditEvent: "laundry.booking_completed",
    canonicalEventName: "laundry_booking.completed",
    note: "Neither registry defines a completion domain event; the Group 4 grammar form is PROPOSED and must be registered before release.",
  },
];
