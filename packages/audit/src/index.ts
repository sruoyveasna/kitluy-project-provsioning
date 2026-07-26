/**
 * @kitluy/audit — append-only audit event contracts.
 *
 * Source authority: rebuild bible v4.0.0 §9.3 (audit/security events are never
 * destructively rewritten; corrections are compensating records) and §5.6
 * (minimum custody/audit record fields). Security event names come from the
 * Store Hub spec v1.0.0 §15.4.
 *
 * STATUS: BUILT + TESTED (test/audit.test.ts). Persistence is a service
 * concern; this package defines the shared envelope and the append-only rule.
 */
import type {
  CorrelationId,
  DeviceId,
  DigitalStoreId,
  StoreLocationId,
  TenantId,
  UserId,
} from "@kitluy/shared-types";

export interface AuditEvent {
  readonly auditEventId: string;
  readonly eventType: string;
  readonly occurredAt: string; // ISO-8601 with offset
  /** Business date in Asia/Phnom_Penh (RB v4 §5.6). */
  readonly businessDate: string; // YYYY-MM-DD
  readonly tenantId: TenantId;
  readonly digitalStoreId?: DigitalStoreId;
  readonly storeLocationId?: StoreLocationId;
  readonly actorUserId?: UserId;
  readonly actorDeviceId?: DeviceId;
  readonly correlationId?: CorrelationId;
  /** Reason/evidence reference for exceptions and sensitive actions. */
  readonly reason?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Security event names from Store Hub spec v1.0.0 §15.4 (verbatim). */
export const HUB_SECURITY_EVENT_TYPES = [
  "unknown_device_provisioning_attempted",
  "hardware_manifest_mismatch_detected",
  "certificate_reuse_detected",
  "cloned_installation_identity_detected",
  "secure_boot_validation_failed",
  "device_quarantined",
  "device_revoked",
  "support_session_started",
  "support_session_expired",
  "unauthorized_terminal_role_attempted",
] as const;
export type HubSecurityEventType = (typeof HUB_SECURITY_EVENT_TYPES)[number];

/**
 * An append-only, in-memory audit log. Reference implementation of the
 * append-only rule used by tests and the simulated Store Hub; durable storage
 * is a service implementation with the same contract.
 */
export class AppendOnlyAuditLog {
  private readonly events: AuditEvent[] = [];

  append(event: AuditEvent): void {
    if (this.events.some((e) => e.auditEventId === event.auditEventId)) {
      throw new Error(
        `Audit event ${event.auditEventId} already recorded; audit history is append-only — record a compensating event instead.`,
      );
    }
    this.events.push(Object.freeze({ ...event }));
  }

  /** Read-only snapshot; there is deliberately no update or delete API. */
  all(): readonly AuditEvent[] {
    return [...this.events];
  }
}
