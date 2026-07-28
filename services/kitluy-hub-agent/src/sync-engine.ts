/**
 * Sync engine simulation (Hub spec §11.5): collect oldest-unacknowledged
 * outbox events, push to the cloud transport, persist per-event results.
 * Reconnection is deterministic, idempotent and auditable — replaying an
 * already-applied event is acknowledged as duplicate, never double-applied.
 */
import type { OutboxEvent, SyncPushResult } from "@kitluy/sync-protocol";
import { validateBatchOrdering } from "@kitluy/sync-protocol";
import type { LocalDatabaseAdapter } from "./local-db.js";

/** Transport boundary: production is mTLS outbound to the cloud sync service. */
export interface CloudSyncTransport {
  push(batch: readonly OutboxEvent[]): Promise<readonly SyncPushResult[]>;
}

export class OfflineError extends Error {
  constructor() {
    super("WAN unavailable");
    this.name = "OfflineError";
  }
}

export interface SyncOutcome {
  readonly pushed: number;
  readonly applied: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly offline: boolean;
}

export async function runSyncCycle(
  db: LocalDatabaseAdapter,
  transport: CloudSyncTransport,
  batchSize = 100,
): Promise<SyncOutcome> {
  const pending = db.pendingOutbox().slice(0, batchSize);
  if (pending.length === 0) {
    return { pushed: 0, applied: 0, duplicates: 0, rejected: 0, offline: false };
  }
  validateBatchOrdering(pending);
  let results: readonly SyncPushResult[];
  try {
    results = await transport.push(pending);
  } catch (e) {
    if (e instanceof OfflineError) {
      // Approved local operations continue; events stay pending (Hub §11.1).
      return { pushed: 0, applied: 0, duplicates: 0, rejected: 0, offline: true };
    }
    throw e;
  }
  // A result may only acknowledge if the cloud supplied its OWN ack identity
  // (amendment KLD-2026-07-28-001-A01 §2). A response without one is not an
  // acknowledgement and must not clear the outbox row.
  const acknowledged = results
    .filter(
      (r) =>
        (r.outcome === "applied" || r.outcome === "duplicate_ignored") &&
        typeof r.cloudAckId === "string" &&
        r.cloudAckId.length > 0,
    )
    .map((r) => r.eventId);
  db.markAcknowledged(acknowledged);
  return {
    pushed: pending.length,
    applied: results.filter((r) => r.outcome === "applied").length,
    duplicates: results.filter((r) => r.outcome === "duplicate_ignored").length,
    rejected: results.filter((r) => r.outcome === "rejected").length,
    offline: false,
  };
}

/**
 * Cloud-side simulation used by the offline harness: applies events with
 * idempotency-key dedup (the real implementation is kitluy-sync-service).
 */
export class SimulatedCloud implements CloudSyncTransport {
  readonly appliedEvents: OutboxEvent[] = [];
  private readonly ackByKey = new Map<string, string>();
  online = true;

  push(batch: readonly OutboxEvent[]): Promise<readonly SyncPushResult[]> {
    if (!this.online) return Promise.reject(new OfflineError());
    return Promise.resolve(
      batch.map((event) => {
        // A replay returns the ORIGINAL acknowledgement identity, so the Hub
        // records the same cloud fact it would have recorded the first time.
        const existing = this.ackByKey.get(event.idempotencyKey);
        if (existing !== undefined) {
          return {
            eventId: event.eventId,
            outcome: "duplicate_ignored" as const,
            cloudAckId: existing,
          };
        }
        const cloudAckId = `sim-ack-${this.ackByKey.size + 1}`;
        this.ackByKey.set(event.idempotencyKey, cloudAckId);
        this.appliedEvents.push(event);
        return { eventId: event.eventId, outcome: "applied" as const, cloudAckId };
      }),
    );
  }
}
