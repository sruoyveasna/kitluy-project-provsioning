/**
 * WS-10-T002 — signed Hub-to-cloud transmission.
 *
 * Authority: Store Hub spec §11.5, offline contract §5 (declared sequence
 * gaps), owner amendment KLD-2026-07-28-001-A01 §2 and §4.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DELIVERY_STATES,
  RECONCILIATION_STATES,
  projectExternalSyncStatus,
} from "@kitluy/sync-protocol";
import { withHubTransaction } from "../src/hub/db.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { SyncDeliveryError } from "../src/hub/sync/errors.js";
import { leaseOutboxBatch, type OutboxLease } from "../src/hub/sync/outbox-lease.js";
import {
  BATCH_ENVELOPE_VERSION,
  assertResponseCoversBatch,
  buildBatchManifest,
  failTransmissionBatch,
  prepareSignedBatch,
  recordTransmissionBatch,
  signBatch,
  unexplainedSequences,
  type SignedBatch,
} from "../src/hub/sync/transmission.js";
import {
  DEV_BATCH_SIGNING_KEY_ENV,
  DevelopmentHmacBatchSigner,
  PRODUCTION_BATCH_SIGNING_REQUIREMENT,
  createDevelopmentBatchSigner,
  createProductionBatchSigner,
} from "../src/hub/sync/signing.js";
import {
  ACTOR_CASHIER,
  LOCATION,
  T1,
  TENANT,
  STORE,
  ensureRuntimeRoleMembership,
  hubReachable,
  pool,
  provisionTerminal,
  reserveSyncGenerationBlock,
  seedOutboxStream,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const DEV_KEY = "development-only-batch-signing-key-not-a-secret-0123456789";
const signer = new DevelopmentHmacBatchSigner("dev-key-1", Buffer.from(DEV_KEY, "utf8"));

const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent sync-transmission suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe("batch signing seam (pure)", () => {
  it("refuses to invent a production signer", () => {
    expect(() => createProductionBatchSigner()).toThrow(SyncDeliveryError);
    expect(() => createProductionBatchSigner()).toThrow(/No production Hub batch signer/);
    expect(PRODUCTION_BATCH_SIGNING_REQUIREMENT).toContain("[REQUIRED:");
    expect(PRODUCTION_BATCH_SIGNING_REQUIREMENT).toContain("BLK-005");
  });

  it("has no default development key — a hardcoded one would be a credential in source", () => {
    expect(() => createDevelopmentBatchSigner("k", {})).toThrow(/is not set/);
    expect(() =>
      createDevelopmentBatchSigner("k", { [DEV_BATCH_SIGNING_KEY_ENV]: "too-short" }),
    ).toThrow(/at least 32 bytes/);
  });

  it("refuses to run the development signer outside a development environment", () => {
    expect(() =>
      createDevelopmentBatchSigner("k", {
        KITLUY_ENV: "production",
        [DEV_BATCH_SIGNING_KEY_ENV]: DEV_KEY,
      }),
    ).toThrow(/refuses to run with KITLUY_ENV='production'/);
  });

  it("verifies its own signature and rejects a tampered manifest", () => {
    const signature = signer.sign('{"a":1}');
    expect(signer.verify('{"a":1}', signature)).toBe(true);
    expect(signer.verify('{"a":2}', signature)).toBe(false);
    expect(signer.verify('{"a":1}', { ...signature, keyId: "other" })).toBe(false);
    expect(signer.verify('{"a":1}', { ...signature, signature: "AAAA" })).toBe(false);
  });
});

describe("batch manifest (pure)", () => {
  const item = (sequence: bigint) => ({
    eventId: `event-${sequence}`,
    hubSequence: sequence,
    assignmentGeneration: 7,
    attemptCount: 1,
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: LOCATION,
    originDeviceId: "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1",
    aggregateType: "booking",
    aggregateId: `agg-${sequence}`,
    aggregateVersion: 1n,
    eventType: "laundry.booking_confirmed",
    schemaVersion: 1,
    businessDate: "2026-07-28",
    occurredAt: new Date("2026-07-28T03:00:00.000Z"),
    idempotencyKey: `kl1.0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1.${sequence}`,
    payloadSha256: "0".repeat(64),
    payload: { index: Number(sequence) },
  });

  const lease = (sequences: readonly bigint[]): OutboxLease => ({
    leaseId: "11111111-1111-4111-8111-111111111111",
    leaseOwner: "worker-a",
    locationId: LOCATION,
    assignmentGeneration: 7,
    items: sequences.map(item),
  });

  it("declares the FIRST and LAST actual hub_sequence and renders them as strings", () => {
    const manifest = buildBatchManifest({
      batchId: "22222222-2222-4222-8222-222222222222",
      lease: lease([10n, 12n]),
      knownGaps: [11n],
    });
    expect(manifest.envelopeVersion).toBe(BATCH_ENVELOPE_VERSION);
    expect(manifest.firstHubSequence).toBe("10");
    expect(manifest.lastHubSequence).toBe("12");
    expect(manifest.knownGaps).toEqual(["11"]);
    expect(manifest.itemCount).toBe(2);
  });

  it("keeps a hub_sequence past 2^53 exact on the wire", () => {
    const huge = 9007199254740993n; // 2^53 + 1 — unrepresentable as a JSON number
    const manifest = buildBatchManifest({
      batchId: "22222222-2222-4222-8222-222222222222",
      lease: lease([huge]),
      knownGaps: [],
    });
    expect(manifest.lastHubSequence).toBe("9007199254740993");
    expect(BigInt(manifest.lastHubSequence)).toBe(huge);
  });

  it("distinguishes a declared gap from real data loss", () => {
    const declared = buildBatchManifest({
      batchId: "22222222-2222-4222-8222-222222222222",
      lease: lease([1n, 3n]),
      knownGaps: [2n],
    });
    expect(unexplainedSequences(declared)).toEqual([]);

    const undeclared = buildBatchManifest({
      batchId: "22222222-2222-4222-8222-222222222222",
      lease: lease([1n, 3n]),
      knownGaps: [],
    });
    expect(unexplainedSequences(undeclared)).toEqual(["2"]);
  });

  it("refuses to transmit an empty batch", () => {
    expect(() =>
      buildBatchManifest({
        batchId: "22222222-2222-4222-8222-222222222222",
        lease: lease([]),
        knownGaps: [],
      }),
    ).toThrow(/empty batch is not transmitted/);
  });

  it("refuses to sign a manifest whose digests do not match the payloads", () => {
    const manifest = buildBatchManifest({
      batchId: "22222222-2222-4222-8222-222222222222",
      lease: lease([1n]),
      knownGaps: [],
    });
    const payloads = new Map([["event-1", { index: 1 }]]);
    // The declared digest is all zeroes, which no real payload hashes to.
    expect(() => signBatch(manifest, payloads, signer)).toThrow(/does not match the manifest/);
    expect(() => signBatch(manifest, new Map(), signer)).toThrow(/No payload for/);
  });
});

describe("cloud response coverage (pure)", () => {
  const batch = {
    manifest: {
      batchId: "b-1",
      items: [{ eventId: "e-1" }, { eventId: "e-2" }],
    },
  } as unknown as SignedBatch;

  it("accepts a response that answers every item of THIS batch", () => {
    expect(() =>
      assertResponseCoversBatch(batch, {
        batchId: "b-1",
        cloudBatchId: "cloud-1",
        results: [
          { eventId: "e-1", outcome: "applied", cloudAckId: "a1" },
          { eventId: "e-2", outcome: "applied", cloudAckId: "a2" },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses a response for a different batch", () => {
    expect(() =>
      assertResponseCoversBatch(batch, { batchId: "b-2", cloudBatchId: "c", results: [] }),
    ).toThrow(/not b-1/);
  });

  it("refuses a response with no cloud identity — the Hub mints none", () => {
    expect(() =>
      assertResponseCoversBatch(batch, { batchId: "b-1", cloudBatchId: "", results: [] }),
    ).toThrow(/no cloud batch identity/);
  });

  it("refuses a partial response and a response naming events never sent", () => {
    expect(() =>
      assertResponseCoversBatch(batch, {
        batchId: "b-1",
        cloudBatchId: "c",
        results: [{ eventId: "e-1", outcome: "applied", cloudAckId: "a1" }],
      }),
    ).toThrow(/unanswered/);
    expect(() =>
      assertResponseCoversBatch(batch, {
        batchId: "b-1",
        cloudBatchId: "c",
        results: [
          { eventId: "e-1", outcome: "applied", cloudAckId: "a1" },
          { eventId: "e-2", outcome: "applied", cloudAckId: "a2" },
          { eventId: "e-9", outcome: "applied", cloudAckId: "a9" },
        ],
      }),
    ).toThrow(/never sent/);
  });
});

describe.skipIf(!available)("WS-10-T002 signed transmission against the Hub database", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  // See the leasing suite: the block is reserved above existing rows so a
  // second run never inherits the first run's streams.
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "tx", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function leasedBatch(count: number, suite: string) {
    generation += 1;
    const gen = generation;
    await seedOutboxStream(p, {
      generation: gen,
      count,
      terminalDeviceId: terminal.terminalDeviceId,
      suite,
    });
    const batchId = uuidv7();
    const signed = await withHubTransaction(p, async (client) => {
      const lease = await leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-tx",
      });
      return prepareSignedBatch(client, { batchId, lease, signer });
    });
    return { gen, batchId, signed };
  }

  it("signs the real manifest and the signature verifies", async () => {
    const { signed } = await leasedBatch(3, "sign");
    expect(signed.manifest.itemCount).toBe(3);
    expect(signed.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(signer.verify(signed.canonicalManifest, signed.signature)).toBe(true);
  });

  it("binds every payload to the manifest by its stored digest", async () => {
    const { signed } = await leasedBatch(2, "digest");
    // The digests came from the database, and signing already verified them
    // against the payloads being shipped.
    for (const item of signed.manifest.items) {
      expect(item.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(signed.payloads.has(item.eventId)).toBe(true);
    }
    // Changing one byte of the manifest breaks the signature.
    expect(signer.verify(`${signed.canonicalManifest} `, signed.signature)).toBe(false);
  });

  it("declares journalled sequence gaps so the cloud never sees a false loss", async () => {
    generation += 1;
    const gen = generation;
    const before = await seedOutboxStream(p, {
      generation: gen,
      count: 1,
      terminalDeviceId: terminal.terminalDeviceId,
      suite: "gap-before",
    });
    // Burn a sequence exactly as a rolled-back command does, and journal it.
    const burnt = await p.query<{ allocate_hub_sequence: bigint }>(
      `select edge_sync.allocate_hub_sequence()`,
    );
    const burntSequence = burnt.rows[0]!.allocate_hub_sequence;
    await p.query(
      `select edge_sync.record_sequence_gap($1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5::integer, $6::bigint, 'transaction_rollback', 'ws-10-test', null)`,
      [uuidv7(), TENANT, STORE, LOCATION, gen, burntSequence.toString()],
    );
    const after = await seedOutboxStream(p, {
      generation: gen,
      count: 1,
      terminalDeviceId: terminal.terminalDeviceId,
      suite: "gap-after",
    });

    const signed = await withHubTransaction(p, async (client) => {
      const lease = await leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-tx",
      });
      return prepareSignedBatch(client, { batchId: uuidv7(), lease, signer });
    });

    expect(signed.manifest.firstHubSequence).toBe(before[0]!.hubSequence.toString());
    expect(signed.manifest.lastHubSequence).toBe(after[0]!.hubSequence.toString());
    expect(signed.manifest.knownGaps).toContain(burntSequence.toString());
    // The burnt value is DECLARED, so nothing inside the range is unexplained.
    expect(unexplainedSequences(signed.manifest)).toEqual([]);
  });

  it("records what was signed BEFORE it is sent, and can never rewrite it", async () => {
    const { batchId, signed } = await leasedBatch(2, "ledger");
    await withHubTransaction(p, (client) => recordTransmissionBatch(client, signed, "worker-tx"));

    const header = await p.query(
      `select outcome, item_count, manifest_sha256, signing_key_id, cloud_batch_id,
              encode(signature, 'base64') as signature
         from edge_sync.transmission_batch where id = $1`,
      [batchId],
    );
    expect(header.rows[0]).toMatchObject({
      outcome: "in_flight",
      item_count: 2,
      manifest_sha256: signed.manifestSha256,
      signing_key_id: "dev-key-1",
      // No cloud identity exists until the cloud actually answers.
      cloud_batch_id: null,
      signature: signed.signature.signature,
    });

    const items = await p.query(
      `select count(*)::int as n from edge_sync.transmission_batch_item where batch_id = $1`,
      [batchId],
    );
    expect(items.rows[0].n).toBe(2);

    // What was signed is frozen.
    await expect(
      p.query(`update edge_sync.transmission_batch set manifest_sha256 = $2 where id = $1`, [
        batchId,
        "f".repeat(64),
      ]),
    ).rejects.toThrow(/TRANSMISSION-IMMUTABLE/);
    await expect(
      p.query(`delete from edge_sync.transmission_batch where id = $1`, [batchId]),
    ).rejects.toThrow(/TRANSMISSION-IMMUTABLE/);
  });

  it("a local transport failure carries no cloud identity and completes only once", async () => {
    const { batchId, signed } = await leasedBatch(1, "fail");
    await withHubTransaction(p, (client) => recordTransmissionBatch(client, signed, "worker-tx"));
    await withHubTransaction(p, (client) =>
      failTransmissionBatch(client, batchId, "EDGE_TRANSPORT_TIMEOUT"),
    );

    const row = await p.query(
      `select outcome, failure_code, cloud_batch_id, completed_at
         from edge_sync.transmission_batch where id = $1`,
      [batchId],
    );
    expect(row.rows[0].outcome).toBe("failed");
    expect(row.rows[0].failure_code).toBe("EDGE_TRANSPORT_TIMEOUT");
    // "We could not send" is never readable as "the cloud answered".
    expect(row.rows[0].cloud_batch_id).toBeNull();

    await expect(
      withHubTransaction(p, (client) =>
        failTransmissionBatch(client, batchId, "EDGE_TRANSPORT_UNREACHABLE"),
      ),
    ).rejects.toThrow(/already completed/);
  });

  it("keeps the SQL and TypeScript external-status projections identical (amendment §4)", async () => {
    // Amendment §4 allows ONE shared mapping. Two representations are
    // unavoidable (SQL for views, TypeScript for services), so this holds them
    // equal over the ENTIRE cross product rather than trusting they agree.
    const rows = await p.query<{ d: string; r: string; sql_status: string }>(
      `select d::text as d, r::text as r,
              edge_sync.external_sync_status(d, r) as sql_status
         from unnest(enum_range(null::edge_sync.delivery_state)) d,
              unnest(enum_range(null::edge_sync.reconciliation_state)) r`,
    );
    expect(rows.rows).toHaveLength(DELIVERY_STATES.length * RECONCILIATION_STATES.length);
    for (const row of rows.rows) {
      expect(DELIVERY_STATES as readonly string[]).toContain(row.d);
      expect(RECONCILIATION_STATES as readonly string[]).toContain(row.r);
      expect(row.sql_status).toBe(
        projectExternalSyncStatus(
          row.d as (typeof DELIVERY_STATES)[number],
          row.r as (typeof RECONCILIATION_STATES)[number],
        ),
      );
    }
  });
});
