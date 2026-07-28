/**
 * WS-10-T003 — idempotent cloud ingestion.
 *
 * Authority: KLD-2026-07-28-001 Group 6 (KLREQ-026 effect keys), amendment
 * KLD-2026-07-28-001-A01 §2 (no fabricated acknowledgement; a durable rejection
 * is a cloud verdict, never a transport failure), Hub spec §11.5.
 */
import { describe, expect, it } from "vitest";
import {
  ingestBatch,
  isIngestibleEffectKey,
  type ApplyOutcome,
  type IncomingBatch,
  type IncomingBatchItem,
  type IngestedEffect,
  type IngestionPorts,
} from "../src/ingestion.js";

const COMMAND_RESULT = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c2";
const TERMINAL = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1";

function item(sequence: bigint, ordinal = 0): IncomingBatchItem {
  return {
    eventId: `event-${sequence}`,
    hubSequence: sequence.toString(),
    idempotencyKey: `kh1.${COMMAND_RESULT}.${ordinal}`,
    eventType: "laundry.booking_confirmed",
    schemaVersion: 1,
    aggregateType: "booking",
    aggregateId: "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c9",
    aggregateVersion: "1",
    occurredAt: "2026-07-28T03:00:00.000Z",
    payloadSha256: "0".repeat(64),
  };
}

function batch(items: readonly IncomingBatchItem[]): IncomingBatch {
  return {
    envelopeVersion: 1,
    batchId: "b-1",
    tenantId: "t-1",
    digitalStoreId: "ds-1",
    locationId: "loc-1",
    assignmentGeneration: 1,
    leaseId: "lease-1",
    itemCount: items.length,
    firstHubSequence: items[0]?.hubSequence ?? "1",
    lastHubSequence: items[items.length - 1]?.hubSequence ?? "1",
    knownGaps: [],
    items,
  };
}

interface Recorder {
  readonly ports: IngestionPorts;
  readonly store: Map<string, IngestedEffect>;
  readonly applied: string[];
  minted: number;
}

function ports(overrides: Partial<IngestionPorts> = {}): Recorder {
  const store = new Map<string, IngestedEffect>();
  const applied: string[] = [];
  const recorder: Recorder = {
    store,
    applied,
    minted: 0,
    ports: {
      verifySignature: () => true,
      findIngested: (locationId, effectKey) => store.get(`${locationId}|${effectKey}`),
      mintCloudAckId: () => {
        recorder.minted += 1;
        return `cloud-ack-${recorder.minted}`;
      },
      apply: (_b, i) => {
        applied.push(i.idempotencyKey);
        return { kind: "applied" } satisfies ApplyOutcome;
      },
      record: (b, _i, effect) => {
        store.set(`${b.locationId}|${effect.effectKey}`, effect);
      },
      ...overrides,
    },
  };
  return recorder;
}

describe("effect-key acceptance (KLREQ-026)", () => {
  it("accepts both Hub key namespaces and nothing else", () => {
    expect(isIngestibleEffectKey(`kh1.${COMMAND_RESULT}.0`)).toBe(true);
    expect(isIngestibleEffectKey(`kl1.${TERMINAL}.8821`)).toBe(true);
    expect(isIngestibleEffectKey("location:loc-1:hub:hub-1:seq:1")).toBe(false);
    expect(isIngestibleEffectKey("kh1.not-a-uuid.0")).toBe(false);
    expect(isIngestibleEffectKey("")).toBe(false);
  });
});

describe("WS-10-T003 idempotent ingestion", () => {
  it("applies a verified, ordered batch and mints ONE cloud ack per effect", async () => {
    const r = ports();
    const result = await ingestBatch(batch([item(1n, 0), item(2n, 1)]), r.ports, "cloud-batch-1");

    expect(result.status).toBe("APPLIED");
    expect(result.signatureVerified).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.results.map((x) => x.outcome)).toEqual(["applied", "applied"]);
    expect(result.results.map((x) => x.cloudAckId)).toEqual(["cloud-ack-1", "cloud-ack-2"]);
    expect(result.cloudBatchId).toBe("cloud-batch-1");
  });

  it("re-reports the ORIGINAL outcome on replay and applies nothing twice", async () => {
    const r = ports();
    const first = await ingestBatch(batch([item(1n, 0)]), r.ports, "cloud-batch-1");
    const replay = await ingestBatch(batch([item(1n, 0)]), r.ports, "cloud-batch-2");

    expect(first.results[0]!.outcome).toBe("applied");
    expect(replay.results[0]!.outcome).toBe("duplicate_ignored");
    // The SAME acknowledgement identity, so the Hub records the same cloud fact.
    expect(replay.results[0]!.cloudAckId).toBe(first.results[0]!.cloudAckId);
    expect(r.applied).toHaveLength(1);
  });

  it("dedupes on the EFFECT KEY, not the event id", async () => {
    const r = ports();
    await ingestBatch(batch([item(1n, 0)]), r.ports, "cloud-batch-1");

    // A redelivery may carry a different event row id for the same business
    // effect; the effect key is what must not be applied twice.
    const redelivered: IncomingBatchItem = { ...item(1n, 0), eventId: "a-different-event-row" };
    const replay = await ingestBatch(batch([redelivered]), r.ports, "cloud-batch-2");

    expect(replay.results[0]!.outcome).toBe("duplicate_ignored");
    expect(r.applied).toHaveLength(1);
  });

  it("treats different ordinals of one command as DIFFERENT effects", async () => {
    const r = ports();
    const result = await ingestBatch(batch([item(1n, 0), item(2n, 1)]), r.ports, "cloud-batch-1");
    expect(result.appliedCount).toBe(2);
    expect(r.applied).toEqual([`kh1.${COMMAND_RESULT}.0`, `kh1.${COMMAND_RESULT}.1`]);
  });

  it("applies NOTHING from a batch whose signature does not verify", async () => {
    const r = ports({ verifySignature: () => false });
    const result = await ingestBatch(batch([item(1n, 0), item(2n, 1)]), r.ports, "cloud-batch-1");

    expect(result.status).toBe("REJECTED");
    expect(result.batchRejectionCode).toBe("EDGE_CLOUD_REJECTED_SIGNATURE");
    expect(result.rejectedCount).toBe(2);
    // Not one item — a forged tail must not ride in on a genuine head.
    expect(r.applied).toEqual([]);
    expect(r.store.size).toBe(0);
  });

  it("refuses a batch whose ordering is not what the Hub guarantees", async () => {
    const r = ports();
    const outOfOrder = batch([item(2n, 0), item(1n, 1)]);
    const result = await ingestBatch(
      { ...outOfOrder, firstHubSequence: "2", lastHubSequence: "1" },
      r.ports,
      "cloud-batch-1",
    );
    expect(result.status).toBe("REJECTED");
    expect(result.batchRejectionCode).toBe("EDGE_CLOUD_REJECTED_SCHEMA");
    expect(r.applied).toEqual([]);
  });

  it("refuses a batch whose declared range does not match its items", async () => {
    const r = ports();
    const result = await ingestBatch(
      { ...batch([item(1n, 0), item(2n, 1)]), lastHubSequence: "99" },
      r.ports,
      "cloud-batch-1",
    );
    expect(result.status).toBe("REJECTED");
    expect(result.results[0]!.rejectionReason).toMatch(/lastHubSequence/);
  });

  it("refuses a batch whose itemCount lies", async () => {
    const r = ports();
    const result = await ingestBatch(
      { ...batch([item(1n, 0)]), itemCount: 9 },
      r.ports,
      "cloud-batch-1",
    );
    expect(result.status).toBe("REJECTED");
    expect(result.results[0]!.rejectionReason).toMatch(/itemCount 9/);
  });

  it("durably rejects an unshaped effect key without touching the rest", async () => {
    const r = ports();
    const bad: IncomingBatchItem = { ...item(1n, 0), idempotencyKey: "location:l:hub:h:seq:1" };
    const result = await ingestBatch(batch([bad, item(2n, 1)]), r.ports, "cloud-batch-1");

    expect(result.results[0]).toMatchObject({
      outcome: "rejected",
      rejectionCode: "EDGE_CLOUD_REJECTED_SCHEMA",
    });
    expect(result.results[1]!.outcome).toBe("applied");
    expect(result.appliedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
  });

  it("carries a business rejection through as a DURABLE verdict", async () => {
    const r = ports({
      apply: () =>
        ({
          kind: "rejected",
          code: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
          reason: "Booking already closed.",
        }) satisfies ApplyOutcome,
    });
    const result = await ingestBatch(batch([item(1n, 0)]), r.ports, "cloud-batch-1");

    expect(result.results[0]).toMatchObject({
      outcome: "rejected",
      rejectionCode: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
    });
    // A durable rejection is REMEMBERED, so a replay returns the same verdict
    // instead of re-running the business decision.
    const replay = await ingestBatch(batch([item(1n, 0)]), r.ports, "cloud-batch-2");
    expect(replay.results[0]).toMatchObject({
      outcome: "rejected",
      rejectionCode: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
    });
  });

  it("keeps a hub_sequence past 2^53 exact", async () => {
    const huge = 9007199254740993n;
    const r = ports();
    const result = await ingestBatch(batch([item(huge, 0)]), r.ports, "cloud-batch-1");
    expect(result.status).toBe("APPLIED");
    expect(BigInt(result.results.length)).toBe(1n);
  });

  it("never mints an acknowledgement for an event it did not process", async () => {
    const r = ports({ verifySignature: () => false });
    await ingestBatch(batch([item(1n, 0), item(2n, 1)]), r.ports, "cloud-batch-1");
    expect(r.minted).toBe(0);
  });
});
