/**
 * @kitluy/event-contracts — versioned, immutable domain-event envelope.
 *
 * Source authority: rebuild bible v4.0.0 §10.3 — events are immutable,
 * versioned and retry-safe with a minimum envelope including correlation and
 * causation IDs, idempotency key and business date. Vertical-specific event
 * names live in the vertical packages (e.g. verticals/phase1-laundry), not in
 * neutral Core.
 *
 * STATUS: BUILT (envelope + registry contract). Registry content grows with
 * spec citations only.
 */
import type { CorrelationId, IdempotencyKey } from "@kitluy/shared-types";

/**
 * Event names are versioned: `<domain>.<event_name>.v<major>` (POS spec v4
 * §15.2 catalog style, e.g. "laundry.booking_created.v1").
 */
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v\d+$/;

export function isValidEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name);
}

/** Minimum event envelope (RB v4 §10.3). */
export interface DomainEventEnvelope<TPayload = Readonly<Record<string, unknown>>> {
  readonly eventId: string;
  /** Versioned event name, e.g. "payment.khqr_confirmed.v1". */
  readonly eventType: string;
  readonly occurredAt: string; // ISO-8601 with offset
  readonly businessDate: string; // YYYY-MM-DD in Asia/Phnom_Penh
  readonly tenantId: string;
  readonly digitalStoreId?: string;
  readonly storeLocationId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly correlationId: CorrelationId;
  readonly causationId?: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly schemaVersion: string;
  readonly payload: TPayload;
}

/** Registry entry describing one event type's contract. */
export interface EventRegistration {
  readonly eventType: string;
  readonly description: string;
  readonly owningBoundary: string;
  /** Spec citation that authorizes this event, e.g. "POS spec v4.0.0 §15.2". */
  readonly source: string;
}

export class EventRegistry {
  private readonly entries = new Map<string, EventRegistration>();

  register(entry: EventRegistration): void {
    if (!isValidEventName(entry.eventType)) {
      throw new Error(
        `Invalid event name "${entry.eventType}"; expected <domain>.<event>.v<major>.`,
      );
    }
    if (this.entries.has(entry.eventType)) {
      throw new Error(`Event ${entry.eventType} already registered; versions are immutable.`);
    }
    this.entries.set(entry.eventType, entry);
  }

  get(eventType: string): EventRegistration | undefined {
    return this.entries.get(eventType);
  }

  all(): readonly EventRegistration[] {
    return [...this.entries.values()];
  }
}
