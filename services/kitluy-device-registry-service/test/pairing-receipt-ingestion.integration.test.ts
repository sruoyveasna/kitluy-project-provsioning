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

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000f1";
// A REAL second scope (the section-56 fixture Location) for the T008
// cross-scope probes — the door reads assignments, so the hostile side must
// genuinely exist somewhere else.
const OTHER_SCOPE = {
  tenant: "00000000-0000-4000-8000-000000000012",
  store: "00000000-0000-4000-8000-000000000017",
  location: "00000000-0000-4000-8000-000000000450",
} as const;
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

  // WS-11-T008 NEW-1: group 0183 binds Hub identity, scope and assignment
  // generation in SQL, so this suite now uses REAL enrolled and assigned
  // devices. The previous fixture invented UUIDs for both sides, which is
  // exactly why the door's missing identity checks went unnoticed.
  let hubDeviceId: string;
  let secondHubId: string;

  const callDoor = async (e: PairingReceiptEvent, over: Record<string, string | null>) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `do $$ begin execute format('grant kitluy_pairing_receipt_governor to %I', current_user); end $$`,
      );
      await client.query("set local role kitluy_pairing_receipt_governor");
      await client.query(
        `select kitluy_devices.ingest_terminal_pairing_receipt_v1(
           $1, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7::int, $8,
           $9::uuid, $10::uuid, $11::uuid, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::uuid)`,
        [
          "effectKey" in over ? over.effectKey : e.effectKey,
          e.receiptId,
          e.receiptVersion,
          e.pairingSessionId,
          e.hubDeviceId,
          e.terminalDeviceId,
          e.terminalAssignmentGeneration,
          e.terminalProfileCode,
          "tenantId" in over ? over.tenantId : e.tenantId,
          "digitalStoreId" in over ? over.digitalStoreId : e.digitalStoreId,
          "locationId" in over ? over.locationId : e.locationId,
          "environment" in over ? over.environment : e.environment,
          e.hubCertificateFingerprint,
          "terminalCertificateFingerprint" in over
            ? over.terminalCertificateFingerprint
            : e.terminalCertificateFingerprint,
          e.hubCertificateSerial,
          e.transcriptHash,
          e.hubReceiptSignature,
          e.pairedAt,
          "correlationId" in over ? over.correlationId : e.correlationId,
        ],
      );
      return { refused: false, message: "" };
    } catch (error) {
      return { refused: true, message: error instanceof Error ? error.message : String(error) };
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  };

  async function liveGeneration(deviceId: string): Promise<number> {
    const { rows } = await pool.query<{ g: string }>(
      `select assignment_generation::text as g from kitluy_devices.device_assignments
        where device_id = $1::uuid and state in ('pending_trust', 'active')`,
      [deviceId],
    );
    return Number(rows[0]?.g);
  }

  async function enrolAndAssign(profileKey: string, prefix: string): Promise<string> {
    return enrolAndAssignAt(profileKey, prefix, TENANT, STORE, LOCATION);
  }

  async function enrolAndAssignAt(
    profileKey: string,
    prefix: string,
    tenantId: string,
    storeId: string,
    locationId: string,
  ): Promise<string> {
    const ref = `T008-RCPT-${prefix}-${randomUUID()}`;
    const { rows } = await pool.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1(
         $1, (select id from kitluy_devices.hardware_profiles where profile_key = $2),
         now(), encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'ed25519', 'software',
         'STATION-T008', 'OP-T008',
         jsonb_build_array(
           jsonb_build_object('signal_type', 'mac_address',   'signal_value', $3::text),
           jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-' || $1),
           jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || $1))) as id`,
      [ref, profileKey, `t8:${randomUUID().slice(0, 8)}`],
    );
    const deviceId = String(rows[0]?.id);
    const token = `t008-tok-${prefix}-${randomUUID()}`;
    const payload = `t008-pay-${prefix}-${randomUUID()}`;
    await pool.query(
      `select kitluy_devices.create_device_claim_v1(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         encode(sha256(convert_to($5, 'UTF8')), 'hex'),
         encode(sha256(convert_to($6, 'UTF8')), 'hex'), 900, 'OP-T008')`,
      [deviceId, tenantId, storeId, locationId, token, payload],
    );
    await pool.query(
      `select kitluy_devices.redeem_device_claim_v1(
         encode(sha256(convert_to($1, 'UTF8')), 'hex'),
         encode(sha256(convert_to($2, 'UTF8')), 'hex'), $3::uuid, 'HUB-T008')`,
      [token, payload, deviceId],
    );
    return deviceId;
  }

  // Each event gets its OWN assigned terminal unless a scenario supplies
  // one: the per-terminal projection is read by receipt, so a shared
  // terminal would let one test read another's receipt.
  async function event(over: Partial<PairingReceiptEvent> = {}): Promise<PairingReceiptEvent> {
    const receiptId = over.receiptId ?? randomUUID();
    const terminal =
      over.terminalDeviceId ?? (await enrolAndAssign("WS11-T005-TERM-PROBE", "TERM"));
    const generation = await liveGeneration(terminal);
    return {
      effectKey: `kh1.${receiptId}.1`,
      receiptId,
      receiptVersion: "1.0",
      pairingSessionId: randomUUID(),
      hubDeviceId,
      terminalDeviceId: terminal,
      terminalAssignmentGeneration: generation,
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

  let delivery: AuthenticatedHubDelivery;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 6 });
    ingestion = new PairingReceiptIngestion(pool, logger);
    hubDeviceId = await enrolAndAssign("WS11-T001-HUB-PROBE", "HUB");
    secondHubId = await enrolAndAssign("WS11-T001-HUB-PROBE", "HUB2");
    delivery = {
      hubDeviceId,
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
    };
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  it("ingests one receipt and records HUB time as the pairing instant", async () => {
    const e = await event();
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
    const e = await event();
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
    const e = await event();
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
    const first = await event();
    await ingestion.ingest(first, delivery);
    const second = await event({ pairingSessionId: first.pairingSessionId });
    expect((await ingestion.ingest(second, delivery)).result).toBe("CONFLICT");
  });

  it("cross-Tenant and cross-Store deliveries are refused before the door", async () => {
    const e = await event();
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
    const good = await event();
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
    const e = await event();
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

  it("T008 NEW-1: the DOOR itself binds Hub identity, scope and generation — not just the envelope", async () => {
    // Reviewer B probes B1-B4: every one of these was INGESTED before group
    // 0183 because the SQL door performed no identity or scope validation
    // and the only binding lived in the consumer's envelope check. Here the
    // envelope is made to AGREE with each hostile receipt, so the refusal
    // can only come from the door.
    const foreignHub = await enrolAndAssignAt(
      "WS11-T001-HUB-PROBE",
      "FHUB",
      OTHER_SCOPE.tenant,
      OTHER_SCOPE.store,
      OTHER_SCOPE.location,
    );
    const terminal = await enrolAndAssign("WS11-T005-TERM-PROBE", "VICTIM");
    const generation = await liveGeneration(terminal);

    // B1: a device pairing with itself.
    const selfPair = await event({ terminalDeviceId: hubDeviceId });
    expect((await ingestion.ingest(selfPair, delivery)).result).toBe("REJECTED_SCOPE");

    // B2: a Hub from ANOTHER Tenant/Store signs for this terminal, with a
    // matching (hostile) envelope.
    const wrongHub = await event({ terminalDeviceId: terminal, hubDeviceId: foreignHub });
    expect(
      (
        await ingestion.ingest(wrongHub, {
          hubDeviceId: foreignHub,
          tenantId: TENANT,
          digitalStoreId: STORE,
          locationId: LOCATION,
        })
      ).result,
    ).toBe("REJECTED_SCOPE");

    // B3: the receipt claims a scope the devices do not occupy.
    const wrongScope = await event({
      terminalDeviceId: terminal,
      tenantId: OTHER_SCOPE.tenant,
      digitalStoreId: OTHER_SCOPE.store,
      locationId: OTHER_SCOPE.location,
    });
    expect(
      (
        await ingestion.ingest(wrongScope, {
          hubDeviceId,
          tenantId: OTHER_SCOPE.tenant,
          digitalStoreId: OTHER_SCOPE.store,
          locationId: OTHER_SCOPE.location,
        })
      ).result,
    ).toBe("REJECTED_SCOPE");

    // B4: a stale assignment generation (0121 rule).
    const stale = await event({
      terminalDeviceId: terminal,
      terminalAssignmentGeneration: generation + 5,
    });
    expect((await ingestion.ingest(stale, delivery)).result).toBe("REJECTED_SCOPE");

    // NOTHING was stored by any of the four.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = any($1::uuid[])`,
      [[selfPair.receiptId, wrongHub.receiptId, wrongScope.receiptId, stale.receiptId]],
    );
    expect(rows[0]?.n, "a refused delivery must leave no receipt").toBe("0");
  });

  it("T008 NEW-2/NEW-3: a replayed effect key and a malformed digest are GOVERNED refusals, never raw SQLSTATEs", async () => {
    // Reviewer B probes B6 and B10: these escaped as 23505 and 23514.
    const first = await event();
    expect((await ingestion.ingest(first, delivery)).result).toBe("INGESTED");

    // B6 and B10 are probed AT THE DOOR, bypassing the consumer's own
    // schema check (which independently refuses a key/receipt mismatch):
    // the point is that the DATABASE governs these, not only the caller.
    const replay = await event();
    const malformed = await event();

    // B6: a DIFFERENT receipt id reusing an already-delivered effect key —
    // was a raw 23505 unique violation from tpr_effect_key_uq.
    const replayOutcome = await callDoor(replay, { effectKey: first.effectKey });
    expect(replayOutcome.refused, "the replayed effect key was accepted").toBe(true);
    expect(replayOutcome.message).toContain("KLUY-PAIRING-RECEIPT-CONFLICT");
    expect(replayOutcome.message).not.toMatch(/duplicate key value/i);

    // B10: a malformed fingerprint — was a raw 23514 check violation.
    const malformedOutcome = await callDoor(malformed, {
      terminalCertificateFingerprint: "not-a-digest",
    });
    expect(malformedOutcome.refused, "the malformed digest was accepted").toBe(true);
    expect(malformedOutcome.message).toContain("KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA");
    expect(malformedOutcome.message).not.toMatch(/violates check constraint/i);

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = any($1::uuid[])`,
      [[replay.receiptId, malformed.receiptId]],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("T008 NEW-4/NEW-6: EVERY absent field the door depends on is a governed schema refusal, never a raw not-null violation", async () => {
    // Three-valued logic: `NULL <> x` is NULL, not true, so an absent field
    // would walk past the identity/scope authority and die at the column
    // constraint — which the consumer maps to INTERNAL_ERROR, i.e. a caller
    // retries a delivery that can never succeed. NEW-4 covered the scope
    // fields; NEW-6 found the gate still omitted the effect key, the
    // environment and the correlation id.
    const absent: Array<Record<string, null>> = [
      { tenantId: null },
      { digitalStoreId: null },
      { locationId: null },
      { effectKey: null },
      { environment: null },
      { correlationId: null },
    ];
    const receiptIds: string[] = [];
    for (const over of absent) {
      const e = await event();
      receiptIds.push(e.receiptId);
      const outcome = await callDoor(e, over);
      const field = Object.keys(over)[0];
      expect(outcome.refused, `an absent ${field} was accepted`).toBe(true);
      expect(outcome.message, `absent ${field}`).toContain("KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA");
      expect(outcome.message, `absent ${field} escaped ungoverned`).not.toMatch(
        /null value in column|not-null constraint/i,
      );
    }
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = any($1::uuid[])`,
      [receiptIds],
    );
    expect(rows[0]?.n).toBe("0");
  });

  it("T008 NEW-5: the PAIRED side must be a terminal, never another Hub", async () => {
    const hubAsTerminal = await event({ terminalDeviceId: hubDeviceId, hubDeviceId: secondHubId });
    const outcome = await callDoor(hubAsTerminal, {});
    expect(outcome.refused, "a Hub was accepted as the paired terminal").toBe(true);
    expect(outcome.message).toContain("KLUY-PAIRING-RECEIPT-WRONG-HUB");
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.terminal_pairing_receipts
        where receipt_id = $1::uuid`,
      [hubAsTerminal.receiptId],
    );
    expect(rows[0]?.n).toBe("0");
  });
});
