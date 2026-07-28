/**
 * Local database adapter boundary.
 *
 * Hub spec §11.2 (OWNER-LOCKED behavior): "Every local mutation produces an
 * immutable outbox item in the same local database transaction." The adapter
 * interface makes that atomicity structural: a mutation can only enqueue
 * outbox events through the transaction it runs in.
 *
 * The production adapter targets local PostgreSQL on the Store Hub
 * (KL-HUB-P1-003, OWNER-LOCKED) and is implemented by the WS-09 command layer
 * in `src/hub/**`. The in-memory adapter below powers the simulated Store Hub
 * development mode and the offline test harness — it is NOT a production store
 * and is NOT the source of any WS-09/WS-10 evidence.
 *
 * KLREQ-020 correction (Cycle 9). This adapter used to MINT the idempotency
 * key from the Location and Hub ids. The canonical key is TERMINAL-issued
 * (KLD-2026-07-28-001 Group 1), so the caller now supplies it exactly as a real
 * terminal command does; the adapter assigns only what the Hub actually owns,
 * the `hub_sequence` (offline contract §5).
 */
import type { OutboxEvent } from "@kitluy/sync-protocol";
import { isValidTerminalIdempotencyKey } from "@kitluy/sync-protocol";

export interface OperationalRecord {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface LocalTransaction {
  /** Persist an operational record inside this transaction. */
  put(record: OperationalRecord): void;
  /**
   * Enqueue an outbox event atomically with the mutation. The Hub assigns the
   * `hubSequence`; the TERMINAL supplies the idempotency key (offline contract
   * §2, KLD-2026-07-28-001 Group 1) — the Hub never mints one on a terminal's
   * behalf.
   */
  appendOutbox(
    event: Omit<OutboxEvent, "hubSequence" | "payloadSha256">,
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
  private sequence = 0n;

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
        // A key the Hub cannot recognise is refused rather than replaced: a
        // silently regenerated key would break the terminal's own replay
        // protection (offline contract §4).
        if (!isValidTerminalIdempotencyKey(event.idempotencyKey)) {
          throw new Error(
            `Idempotency key '${event.idempotencyKey}' is not the canonical ` +
              "kl1.{terminal_device_uuid}.{client_sequence} shape (offline contract §2).",
          );
        }
        staged += 1n;
        stagedOutbox.push({
          ...event,
          hubSequence: staged,
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
