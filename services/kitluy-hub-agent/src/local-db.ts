/**
 * Local database adapter boundary.
 *
 * Hub spec §11.2 (OWNER-LOCKED behavior): "Every local mutation produces an
 * immutable outbox item in the same local database transaction." The adapter
 * interface makes that atomicity structural: a mutation can only enqueue
 * outbox events through the transaction it runs in.
 *
 * The production adapter targets local PostgreSQL on the Store Hub
 * (KL-HUB-P1-003, OWNER-LOCKED). The in-memory adapter below powers the
 * simulated Store Hub development mode and the offline test harness — it is
 * NOT a production store.
 */
import type { OutboxEvent } from "@kitluy/sync-protocol";
import { buildIdempotencyKey } from "@kitluy/sync-protocol";

export interface OperationalRecord {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface LocalTransaction {
  /** Persist an operational record inside this transaction. */
  put(record: OperationalRecord): void;
  /**
   * Enqueue an outbox event atomically with the mutation. Sequence and
   * idempotency key are assigned by the adapter, never by callers.
   */
  appendOutbox(
    event: Omit<OutboxEvent, "localSequence" | "idempotencyKey" | "payloadSha256">,
    payload: Readonly<Record<string, unknown>>,
  ): void;
}

export interface LocalDatabaseAdapter {
  /** Run work atomically: records and outbox items commit or roll back together. */
  transaction<T>(work: (tx: LocalTransaction) => T): T;
  getRecord(aggregateType: string, aggregateId: string): OperationalRecord | undefined;
  /** Oldest-unacknowledged-first pending outbox events (Hub §11.5). */
  pendingOutbox(): readonly OutboxEvent[];
  markAcknowledged(eventIds: readonly string[]): void;
}

/** Deterministic content hash used by the simulation (production: SHA-256). */
function simulatedPayloadHash(payload: Readonly<Record<string, unknown>>): string {
  const s = JSON.stringify(payload);
  let h = 0n;
  for (let i = 0; i < s.length; i++) h = (h * 31n + BigInt(s.charCodeAt(i))) % 2n ** 64n;
  return h.toString(16).padStart(16, "0").repeat(4);
}

interface StoredOutboxItem {
  readonly event: OutboxEvent;
  acknowledged: boolean;
}

/** Simulated Store Hub local database (development mode / test harness). */
export class InMemoryLocalDatabase implements LocalDatabaseAdapter {
  private readonly records = new Map<string, OperationalRecord>();
  private readonly outbox: StoredOutboxItem[] = [];
  private sequence = 0;

  constructor(
    private readonly locationId: string,
    private readonly hubId: string,
  ) {}

  transaction<T>(work: (tx: LocalTransaction) => T): T {
    const stagedRecords: OperationalRecord[] = [];
    const stagedOutbox: OutboxEvent[] = [];
    let staged = this.sequence;
    const tx: LocalTransaction = {
      put: (record) => {
        stagedRecords.push(record);
      },
      appendOutbox: (event, payload) => {
        staged += 1;
        stagedOutbox.push({
          ...event,
          localSequence: staged,
          idempotencyKey: buildIdempotencyKey(this.locationId, this.hubId, staged),
          payloadSha256: simulatedPayloadHash(payload),
        });
      },
    };
    // Atomicity: only commit staged records and outbox items when work() did
    // not throw. A thrown error discards both — never one without the other.
    const result = work(tx);
    for (const r of stagedRecords) this.records.set(`${r.aggregateType}:${r.aggregateId}`, r);
    for (const e of stagedOutbox) this.outbox.push({ event: e, acknowledged: false });
    this.sequence = staged;
    return result;
  }

  getRecord(aggregateType: string, aggregateId: string): OperationalRecord | undefined {
    return this.records.get(`${aggregateType}:${aggregateId}`);
  }

  pendingOutbox(): readonly OutboxEvent[] {
    return this.outbox.filter((i) => !i.acknowledged).map((i) => i.event);
  }

  markAcknowledged(eventIds: readonly string[]): void {
    for (const item of this.outbox) {
      if (eventIds.includes(item.event.eventId)) item.acknowledged = true;
    }
  }
}
