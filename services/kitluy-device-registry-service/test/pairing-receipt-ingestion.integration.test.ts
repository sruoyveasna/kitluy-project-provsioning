/**
 * CLOUD INGESTION OF HUB-ISSUED PAIRING RECEIPTS.
 *
 * WS-11-T004-P04C3, group 0176. Drives the real `PairingReceiptIngestion`
 * against the real cloud database as the real machine identity (explicit
 * `set local role kitluy_edge_sync_service` per transaction — the 0173
 * boundary applied to the 0176 identity).
 *
 * The distinction under test: the STORE HUB owns pairing and the cloud stores
 * fleet evidence. Every scenario below asks one question — can anything the
 * cloud does change what the Hub asserted? — and the answer must be no.
 *
 *   Idempotence — one receipt, one business effect, however many deliveries
 *   Freshness   — cloud time moves; HUB time never does
 *   Conflict    — a redelivery asserting different facts is refused; the
 *                 original stands
 *   Scope       — a Hub authenticated for one Store cannot ingest another's
 *   Boundary    — service_role cannot reach the door without ENTERING the
 *                 ingestion identity, which holds no table reach of its own
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PairingReceiptIngestion,
  validateReceiptEventShape,
  type AuthenticatedHubDelivery,
  type PairingReceiptEvent,
} from "../src/pairing-receipt-ingestion.js";
import type { SafeLogger } from "../src/pairing-receipt-ingestion.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000f1";
const OTHER_STORE = "00000000-0000-4000-8000-0000000000f2";
const T1 = "laundry.t1.intake_cashier";
const PAIRED_AT = "2026-08-05T10:00:00.000Z";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const live = await reachable();
if (!live) console.warn("SKIPPED: pairing-receipt ingestion — local cloud database unreachable");

const hex = (): string => (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 64);

describe.skipIf(!live)("cloud pairing-receipt ingestion (group 0176)", () => {
  let pool: pg.Pool;
  let ingestion: PairingReceiptIngestion;
  const logLines: Array<Record<string, string | number | boolean>> = [];
  const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };

  const hubDeviceId = randomUUID();

  function event(over: Partial<PairingReceiptEvent> = {}): PairingReceiptEvent {
    const receiptId = over.receiptId ?? randomUUID();
    return {
      effectKey: `kh1.${receiptId}.1`,
      receiptId,
      receiptVersion: "1.0",
      pairingSessionId: randomUUID(),
      hubDeviceId,
      terminalDeviceId: randomUUID(),
      terminalAssignmentGeneration: 1,
      terminalProfileCode: T1,
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      environment: "development",
      hubCertificateFingerprint: hex(),
      terminalCertificateFingerprint: hex(),
      hubCertificateSerial: `P04C3-HUB-${RUN}`,
      transcriptHash: hex(),
      hubReceiptSignature: Buffer.from(`sig-${RUN}`).toString("base64"),
      pairedAt: PAIRED_AT,
      correlationId: randomUUID(),
      ...over,
      // Keep the key aligned with the receipt id unless a scenario is
      // deliberately breaking that binding.
      ...(over.effectKey === undefined ? { effectKey: `kh1.${receiptId}.1` } : {}),
    };
  }

  const delivery: AuthenticatedHubDelivery = {
    hubDeviceId,
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: LOCATION,
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 6 });
    ingestion = new PairingReceiptIngestion(pool, logger);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  it("ingests one receipt and records HUB time as the pairing instant", async () => {
    const e = event();
    const first = await ingestion.ingest(e, delivery);
    expect(first.result).toBe("INGESTED");
    expect(first.receiptId).toBe(e.receiptId);
    expect(first.deliveryCount).toBe(1);
    expect(
      new Date(String(first.pairedAt)).toISOString(),
      "the cloud stores the HUB's instant verbatim",
    ).toBe(PAIRED_AT);

    const state = await ingestion.readTerminalPairingState(e.terminalDeviceId);
    expect(state.found).toBe(true);
    expect(new Date(String(state.pairedAt)).toISOString()).toBe(PAIRED_AT);
    // HUB time and CLOUD time are separate facts, and the cloud's is later.
    expect(new Date(String(state.firstReceivedAt)).getTime()).toBeGreaterThan(
      Date.parse(PAIRED_AT),
    );
    expect(state.deliveryCount).toBe(1);
  });

  it("repeated, delayed and reordered delivery creates ONE business effect", async () => {
    const e = event();
    await ingestion.ingest(e, delivery);
    const second = await ingestion.ingest(e, delivery);
    const third = await ingestion.ingest(e, delivery);
    expect(second.result).toBe("DUPLICATE_IGNORED");
    expect(third.result).toBe("DUPLICATE_IGNORED");

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = $1::uuid`,
      [e.receiptId],
    );
    expect(rows[0]?.n, "exactly one projection row").toBe("1");

    const state = await ingestion.readTerminalPairingState(e.terminalDeviceId);
    // Only the DELIVERY facts moved.
    expect(state.deliveryCount).toBe(3);
    expect(new Date(String(state.pairedAt)).toISOString(), "history never moves").toBe(PAIRED_AT);
    expect(new Date(String(state.lastReceivedAt)).getTime()).toBeGreaterThanOrEqual(
      new Date(String(state.firstReceivedAt)).getTime(),
    );
  });

  it("a redelivery asserting DIFFERENT facts is a conflict the original survives", async () => {
    const e = event();
    await ingestion.ingest(e, delivery);

    for (const mutation of [
      { transcriptHash: hex() },
      { pairedAt: "2026-08-06T10:00:00.000Z" },
      { hubReceiptSignature: Buffer.from("other").toString("base64") },
      { pairingSessionId: randomUUID() },
    ]) {
      const outcome = await ingestion.ingest({ ...e, ...mutation }, delivery);
      expect(outcome.result, JSON.stringify(mutation)).toBe("CONFLICT");
    }

    const state = await ingestion.readTerminalPairingState(e.terminalDeviceId);
    expect(state.receiptId).toBe(e.receiptId);
    expect(new Date(String(state.pairedAt)).toISOString()).toBe(PAIRED_AT);
    // A conflict is not a delivery: the count did not move.
    expect(state.deliveryCount).toBe(1);
  });

  it("two receipts cannot claim the same pairing session", async () => {
    const first = event();
    await ingestion.ingest(first, delivery);
    const second = event({ pairingSessionId: first.pairingSessionId });
    expect((await ingestion.ingest(second, delivery)).result).toBe("CONFLICT");
  });

  it("cross-Tenant and cross-Store deliveries are refused before the door", async () => {
    const e = event();
    for (const wrong of [
      { ...delivery, tenantId: OTHER_TENANT },
      { ...delivery, digitalStoreId: OTHER_STORE },
      { ...delivery, locationId: randomUUID() },
      // A Hub delivering a receipt that names a DIFFERENT Hub.
      { ...delivery, hubDeviceId: randomUUID() },
    ]) {
      expect((await ingestion.ingest(e, wrong)).result).toBe("REJECTED_SCOPE");
    }
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = $1::uuid`,
      [e.receiptId],
    );
    expect(rows[0]?.n, "a refused delivery leaves no residue").toBe("0");
  });

  it("malformed events are durably rejected without reaching the door", async () => {
    const good = event();
    expect(validateReceiptEventShape(good)).toBe(true);
    for (const bad of [
      { effectKey: "kl1.not-a-hub-key.1" },
      // The effect key's namespace must BE the receipt id (KLREQ-026 applied
      // to a Hub-originated fact): a key naming another receipt is refused.
      { effectKey: `kh1.${randomUUID()}.1` },
      { environment: "staging" },
      { terminalProfileCode: "t1" },
      { terminalAssignmentGeneration: 0 },
      { transcriptHash: "short" },
      { pairedAt: "not-a-date" },
      { hubReceiptSignature: "" },
    ]) {
      const e = { ...good, ...bad } as PairingReceiptEvent;
      expect(validateReceiptEventShape(e), JSON.stringify(bad)).toBe(false);
      expect((await ingestion.ingest(e, delivery)).result).toBe("REJECTED_SCHEMA");
    }
  });

  it("the cloud cannot move a fact the Hub asserted, even with direct SQL", async () => {
    const e = event();
    await ingestion.ingest(e, delivery);
    // service_role is the identity the service connects as. It must not be
    // able to edit fleet evidence outside the governed door.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      await expect(
        client.query(
          `update kitluy_devices.terminal_pairing_receipts set paired_at = now()
            where receipt_id = $1::uuid`,
          [e.receiptId],
        ),
      ).rejects.toThrow();
      await client.query("rollback");
    } finally {
      client.release();
    }

    const state = await ingestion.readTerminalPairingState(e.terminalDeviceId);
    expect(new Date(String(state.pairedAt)).toISOString()).toBe(PAIRED_AT);
  });

  it("the ingestion capability must be ENTERED, and carries no table reach", async () => {
    const { rows } = await pool.query<{
      effective: boolean;
      entered: boolean;
      table_reach: boolean;
      gateway_ok: boolean;
    }>(
      `select
         has_function_privilege('service_role',
           'kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid)',
           'execute') as effective,
         has_function_privilege('kitluy_edge_sync_service',
           'kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid)',
           'execute') as entered,
         (has_table_privilege('kitluy_edge_sync_service',
            'kitluy_devices.terminal_pairing_receipts', 'select')
          or has_table_privilege('kitluy_edge_sync_service',
            'kitluy_devices.terminal_pairing_receipts', 'insert')
          or has_table_privilege('kitluy_edge_sync_service',
            'kitluy_devices.terminal_pairing_receipts', 'update')) as table_reach,
         exists (select 1 from pg_roles where rolname = 'kitluy_edge_sync_gateway'
                   and not rolcanlogin and not rolinherit) as gateway_ok`,
    );
    const row = rows[0]!;
    expect(row.effective, "service_role must not EFFECTIVELY hold the capability").toBe(false);
    expect(row.entered, "the ingestion identity holds it").toBe(true);
    expect(row.table_reach, "and holds no table reach of its own").toBe(false);
    expect(row.gateway_ok, "the NOINHERIT hinge is in place").toBe(true);
  });

  it("nothing logged carries a nonce, a key, a signature or a fingerprint", () => {
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(Object.keys(line).sort()).toEqual(["correlationId", "operation", "result"]);
      const text = JSON.stringify(line);
      expect(text).not.toMatch(/PRIVATE KEY|nonce|signature/i);
      // Only the correlation UUID may appear; no 64-hex material.
      expect(text).not.toMatch(/[0-9a-f]{64}/i);
    }
  });
});
