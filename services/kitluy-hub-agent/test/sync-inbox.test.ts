/**
 * WS-10-T006 — cloud-to-Hub delivery and provider payment outcomes.
 *
 * Authority: KLD-2026-07-28-001 Group 7 (KLREQ-027), offline contract §8.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { handleLanRequest } from "../src/lan-api.js";
import { InMemoryLocalDatabase } from "../src/local-db.js";
import { withHubTransaction } from "../src/hub/db.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { SyncDeliveryError } from "../src/hub/sync/errors.js";
import {
  acceptCloudMessage,
  acceptProviderOutcome,
  assertContiguous,
  assertNoDirectProviderCallback,
  findProviderOutcome,
  markProviderOutcomeApplied,
  providerOutcomeDigest,
  recordInboxApplied,
  type CloudMessage,
  type ProviderOutcome,
} from "../src/hub/sync/inbox.js";
import {
  LOCATION,
  STORE,
  TENANT,
  ensureRuntimeRoleMembership,
  hubReachable,
  pool,
} from "./hub-fixtures.js";

const available = await hubReachable();
if (!available) {
  console.warn("SKIPPED kitluy-hub-agent sync-inbox suite: Hub database unreachable");
}

const outcome = (overrides: Partial<ProviderOutcome> = {}): ProviderOutcome => ({
  providerCode: "DEV_KHQR_SIM",
  providerAccountReference: "ACC-001",
  providerEventId: `EVT-${uuidv7().slice(0, 12)}`,
  providerTransactionId: "TXN-1",
  paymentId: null,
  status: "SUCCEEDED",
  amountMinor: 2200n,
  currencyCode: "USD",
  currencyExponent: 2,
  ...overrides,
});

describe("no direct provider-to-Hub callback exists (KLREQ-027)", () => {
  it("refuses a direct callback by name, citing the decision", () => {
    expect(() => assertNoDirectProviderCallback("khqr-adapter")).toThrow(SyncDeliveryError);
    expect(() => assertNoDirectProviderCallback("khqr-adapter")).toThrow(
      /Direct provider-to-Hub callbacks are NOT authorized/,
    );
    expect(() => assertNoDirectProviderCallback("khqr-adapter")).toThrow(/KLREQ-027/);
  });

  it("leaves the Hub LAN surface with no inbound provider route at all", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    const identity = {
      hubId: "hub-1",
      storeLocationId: "loc-1",
      certificateFingerprint: "SIMULATED-DEV-MODE",
    };
    for (const path of [
      "/edge/v1/payments/provider-callback",
      "/edge/v1/payments/khqr/callback",
      "/edge/v1/sync/provider-events",
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = handleLanRequest(method, path, identity, db);
        // Not 200, and not a route that quietly exists: the mutating surface is
        // closed and there is nothing provider-shaped behind it.
        expect(res.status, `${method} ${path}`).not.toBe(200);
      }
    }
  });
});

describe("provider outcome digest (pure)", () => {
  it("hashes the FACTS, so a plain redelivery is not a contradiction", () => {
    const a = outcome({ providerEventId: "EVT-1" });
    expect(providerOutcomeDigest(a)).toBe(providerOutcomeDigest({ ...a }));
  });

  it("changes when the money, the status or the transaction changes", () => {
    const base = outcome({ providerEventId: "EVT-1" });
    expect(providerOutcomeDigest({ ...base, amountMinor: 2201n })).not.toBe(
      providerOutcomeDigest(base),
    );
    expect(providerOutcomeDigest({ ...base, status: "FAILED" })).not.toBe(
      providerOutcomeDigest(base),
    );
    expect(providerOutcomeDigest({ ...base, currencyCode: "KHR" })).not.toBe(
      providerOutcomeDigest(base),
    );
    expect(providerOutcomeDigest({ ...base, providerTransactionId: "TXN-2" })).not.toBe(
      providerOutcomeDigest(base),
    );
  });
});

describe.skipIf(!available)("WS-10-T006 signed delivery against the Hub database", () => {
  let p: pg.Pool;
  let sequence = 1000n;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    const max = await p.query<{ m: bigint }>(
      `select coalesce(max(cloud_sequence), 0)::bigint as m from edge_sync.inbox where location_id = $1`,
      [LOCATION],
    );
    sequence = (max.rows[0]?.m ?? 0n) + 1000n;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  function message(overrides: Partial<CloudMessage> = {}): CloudMessage {
    sequence += 1n;
    return {
      messageId: uuidv7(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      messageType: "payments.provider_outcome",
      schemaVersion: 1,
      cloudSequence: sequence,
      issuedAt: new Date(),
      expiresAt: null,
      payload: { kind: "provider_outcome" },
      signature: Buffer.from("beefcafe", "hex"),
      signingKeyId: "cloud-key-1",
      ...overrides,
    };
  }

  it("persists the message and verifies BEFORE applying", async () => {
    const m = message();
    const accepted = await withHubTransaction(p, (client) =>
      acceptCloudMessage(client, m, () => true),
    );
    expect(accepted.outcome).toBe("accepted");

    const row = await p.query<{ state: string; verified_at: Date | null; applied_at: Date | null }>(
      `select state::text, verified_at, applied_at from edge_sync.inbox where message_id = $1`,
      [m.messageId],
    );
    expect(row.rows[0]).toMatchObject({ state: "verified", applied_at: null });
    expect(row.rows[0]!.verified_at).not.toBeNull();

    await withHubTransaction(p, (client) =>
      recordInboxApplied(client, m.messageId, { applied: true }),
    );
    const applied = await p.query<{ state: string; applied_result: Record<string, unknown> }>(
      `select state::text, applied_result from edge_sync.inbox where message_id = $1`,
      [m.messageId],
    );
    expect(applied.rows[0]!.state).toBe("applied");
    expect(applied.rows[0]!.applied_result).toEqual({ applied: true });
  });

  it("records an UNVERIFIABLE message as rejected and never applies it", async () => {
    const m = message();
    const result = await withHubTransaction(p, (client) =>
      acceptCloudMessage(client, m, () => false),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      errorCode: "EDGE_INBOX_SIGNATURE_INVALID",
    });

    // The body is still stored, so the refusal is auditable…
    const row = await p.query<{ state: string; payload: Record<string, unknown> }>(
      `select state::text, payload from edge_sync.inbox where message_id = $1`,
      [m.messageId],
    );
    expect(row.rows[0]!.state).toBe("rejected");
    expect(row.rows[0]!.payload).toEqual({ kind: "provider_outcome" });

    // …and it can never be marked applied.
    await expect(
      withHubTransaction(p, (client) => recordInboxApplied(client, m.messageId, {})),
    ).rejects.toThrow(/applies only what it verified/);
  });

  it("records an EXPIRED message as rejected rather than silently skipping it", async () => {
    const m = message({ expiresAt: new Date(Date.now() - 60_000) });
    const result = await withHubTransaction(p, (client) =>
      // The verifier would have said yes; expiry is checked first.
      acceptCloudMessage(client, m, () => true),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      errorCode: "EDGE_INBOX_MESSAGE_EXPIRED",
    });
    const row = await p.query<{ state: string; error_code: string }>(
      `select state::text, error_code from edge_sync.inbox where message_id = $1`,
      [m.messageId],
    );
    expect(row.rows[0]).toMatchObject({
      state: "rejected",
      error_code: "EDGE_INBOX_MESSAGE_EXPIRED",
    });
  });

  it("returns the ORIGINAL result for a duplicate delivery", async () => {
    const m = message();
    await withHubTransaction(p, (client) => acceptCloudMessage(client, m, () => true));
    await withHubTransaction(p, (client) =>
      recordInboxApplied(client, m.messageId, { snapshot_version: 7 }),
    );

    const replay = await withHubTransaction(p, (client) =>
      acceptCloudMessage(client, m, () => true),
    );
    expect(replay.outcome).toBe("duplicate");
    expect(replay.originalResult).toEqual({ snapshot_version: 7 });
  });

  it("treats a reused cloud sequence as already seen", async () => {
    const first = message();
    await withHubTransaction(p, (client) => acceptCloudMessage(client, first, () => true));
    const impostor = { ...message(), cloudSequence: first.cloudSequence };
    const replay = await withHubTransaction(p, (client) =>
      acceptCloudMessage(client, impostor, () => true),
    );
    expect(replay.outcome).toBe("duplicate");
  });

  it("refuses to apply past a gap in the cloud sequence", async () => {
    const streamCode = `control-${uuidv7().slice(0, 8)}`;
    await expect(
      withHubTransaction(p, (client) => assertContiguous(client, LOCATION, streamCode, 5n)),
    ).rejects.toThrow(/does not follow 0/);
    await expect(
      withHubTransaction(p, (client) => assertContiguous(client, LOCATION, streamCode, 1n)),
    ).resolves.toBeUndefined();
  });
});

describe.skipIf(!available)("WS-10-T006 provider outcome dedupe (KLREQ-027)", () => {
  let p: pg.Pool;
  let sequence = 5000n;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    const max = await p.query<{ m: bigint }>(
      `select coalesce(max(cloud_sequence), 0)::bigint as m from edge_sync.inbox where location_id = $1`,
      [LOCATION],
    );
    sequence = (max.rows[0]?.m ?? 0n) + 5000n;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function delivery(): Promise<string> {
    sequence += 1n;
    const messageId = uuidv7();
    await p.query(
      `insert into edge_sync.inbox
         (message_id, tenant_id, digital_store_id, location_id, message_type, schema_version,
          cloud_sequence, issued_at, payload_sha256, payload, signature, signing_key_id,
          state, received_at, verified_at)
       values ($1, $2, $3, $4, 'payments.provider_outcome', 1, $5::bigint, now(),
               repeat('0', 64), '{}'::jsonb, decode('beef', 'hex'), 'cloud-key-1',
               'verified', now(), now())`,
      [messageId, TENANT, STORE, LOCATION, sequence.toString()],
    );
    return messageId;
  }

  const scope = { tenantId: TENANT, digitalStoreId: STORE, locationId: LOCATION };

  it("accepts a first-sight outcome and marks it applied", async () => {
    const inboxMessageId = await delivery();
    const o = outcome();
    const accepted = await withHubTransaction(p, (client) =>
      acceptProviderOutcome(client, { ...scope, inboxMessageId, outcome: o }),
    );
    expect(accepted.decision).toBe("accepted");

    await withHubTransaction(p, (client) =>
      markProviderOutcomeApplied(client, accepted.deliveryId),
    );
    const row = await withHubTransaction(p, (client) =>
      findProviderOutcome(client, o.providerCode, o.providerAccountReference, o.providerEventId),
    );
    expect(row?.state).toBe("applied");
  });

  it("deduplicates a redelivery of the SAME facts", async () => {
    const o = outcome();
    const first = await withHubTransaction(p, async (client) =>
      acceptProviderOutcome(client, { ...scope, inboxMessageId: await delivery(), outcome: o }),
    );
    const replay = await withHubTransaction(p, async (client) =>
      acceptProviderOutcome(client, { ...scope, inboxMessageId: await delivery(), outcome: o }),
    );
    expect(first.decision).toBe("accepted");
    expect(replay.decision).toBe("duplicate");
  });

  it("never silently overwrites a CONTRADICTORY redelivery", async () => {
    const o = outcome({ amountMinor: 2200n });
    await withHubTransaction(p, async (client) =>
      acceptProviderOutcome(client, { ...scope, inboxMessageId: await delivery(), outcome: o }),
    );

    // Same triple, different money: a contradiction, not a duplicate.
    const contradiction = await withHubTransaction(p, async (client) =>
      acceptProviderOutcome(client, {
        ...scope,
        inboxMessageId: await delivery(),
        outcome: { ...o, amountMinor: 9900n },
      }),
    );
    expect(contradiction.decision).toBe("conflict");

    const row = await withHubTransaction(p, (client) =>
      findProviderOutcome(client, o.providerCode, o.providerAccountReference, o.providerEventId),
    );
    // The ORIGINAL recording stands…
    expect(row?.amountMinor).toBe(2200n);
    expect(row?.state).toBe("conflicted");
    // …and the divergence is named for governed reconciliation.
    expect(row?.conflictId).not.toBeNull();
    const conflict = await p.query<{ conflict_type: string; state: string; data_class: string }>(
      `select conflict_type, state::text, data_class from edge_sync.sync_conflict where id = $1`,
      [row!.conflictId],
    );
    expect(conflict.rows[0]).toMatchObject({
      conflict_type: "provider_outcome_contradiction",
      state: "operator_required",
      data_class: "finance_payment",
    });
  });

  it("refuses a dedupe with no account reference — no generic silent fallback", async () => {
    const inboxMessageId = await delivery();
    await expect(
      withHubTransaction(p, (client) =>
        acceptProviderOutcome(client, {
          ...scope,
          inboxMessageId,
          outcome: outcome({ providerAccountReference: "  " }),
        }),
      ),
    ).rejects.toThrow(/never a generic silent one/);
  });

  it("keeps provider deliveries append-only", async () => {
    const o = outcome();
    const accepted = await withHubTransaction(p, async (client) =>
      acceptProviderOutcome(client, { ...scope, inboxMessageId: await delivery(), outcome: o }),
    );
    await expect(
      p.query(`delete from edge_sync.provider_outcome_delivery where id = $1`, [
        accepted.deliveryId,
      ]),
    ).rejects.toThrow(/NO-HARD-DELETE/);
  });
});
