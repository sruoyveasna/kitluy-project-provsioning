/**
 * WS-11-T005-P02 — cloud fleet-health ingestion against the LIVE cloud
 * database (groups 0177/0178). Mirrors the pairing-receipt consumer test:
 * the class is driven directly because the signed Hub→cloud transport that
 * would authenticate deliveries remains the recorded BLK-006 gap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  HealthReportIngestion,
  type AuthenticatedHubDelivery,
  type HealthReportEvent,
} from "../src/health-report-ingestion.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const live = await reachable();
if (!live) console.warn("SKIPPED: fleet-health ingestion — local cloud database unreachable");

describe.skipIf(!live)("cloud fleet-health ingestion (groups 0177/0178)", () => {
  let pool: pg.Pool;
  let hubId: string;
  let terminalId: string;
  let generation: number;
  let ingestion: HealthReportIngestion;
  let delivery: AuthenticatedHubDelivery;
  const TENANT = "00000000-0000-4000-8000-000000000011";
  const STORE = "00000000-0000-4000-8000-000000000015";
  const LOCATION = "00000000-0000-4000-8000-000000000018";

  function event(overrides: Partial<HealthReportEvent> = {}): HealthReportEvent {
    const id = (overrides.healthReportId ?? randomUUID()).toLowerCase();
    return {
      effectKey: `kh1.${id}.1`,
      healthReportId: id,
      reportVersion: 1,
      terminalDeviceId: terminalId,
      hubDeviceId: hubId,
      assignmentGeneration: generation,
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      environment: "development",
      reportSequence: 1,
      observedAt: new Date().toISOString(),
      lastLocalContactAt: new Date().toISOString(),
      healthClassification: "healthy",
      healthReasons: [],
      softwareVersion: "1.0.0",
      releaseVersion: null,
      configurationVersion: "3",
      correlationId: randomUUID(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 4 });
    const enroll = async (profileKey: string, prefix: string): Promise<string> => {
      const { rows } = await pool.query<{ id: string }>(
        `select kitluy_devices.enroll_device_v1(
           $1, (select id from kitluy_devices.hardware_profiles where profile_key = $2),
           now(), encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'ed25519', 'software',
           'STATION-P02', 'OP-P02',
           jsonb_build_array(
             jsonb_build_object('signal_type', 'mac_address',   'signal_value', $3 || ':aa'),
             jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-' || $1),
             jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || $1))) as id`,
        [`${prefix}-${randomUUID()}`, profileKey, `f9:${randomUUID().slice(0, 5)}`],
      );
      return rows[0]?.id ?? "";
    };
    // Self-sufficient fixtures: both probe profiles (normally minted by
    // assertions.sql, which may not have run since the last reset).
    await pool.query(
      `insert into kitluy_devices.hardware_profiles
         (profile_key, display_name, device_class, manufacturer, model_identifier,
          required_signal_types, certification_status)
       values ('WS11-T001-HUB-PROBE', 'WS-11-T001 assertion Store Hub profile', 'store_hub',
               'ASSERTION-FIXTURE', 'PROBE-1',
               array['mac_address','board_serial','storage_serial']::kitluy_devices.hardware_signal_type[],
               'CERTIFIED'),
              ('WS11-T005-TERM-PROBE', 'WS-11-T005 assertion terminal profile', 'terminal',
               'ASSERTION-FIXTURE', 'PROBE-T5',
               array['mac_address','board_serial','storage_serial']::kitluy_devices.hardware_signal_type[],
               'CERTIFIED')
       on conflict (profile_key) do nothing`,
    );
    hubId = await enroll("WS11-T001-HUB-PROBE", "P02-HUB");
    terminalId = await enroll("WS11-T005-TERM-PROBE", "P02-TERM");
    const claim = async (device: string, tag: string): Promise<void> => {
      await pool.query(
        `select kitluy_devices.create_device_claim_v1(
           $1, $2::uuid, $3::uuid, $4::uuid,
           encode(sha256(convert_to($5 || '-tok', 'UTF8')), 'hex'),
           encode(sha256(convert_to($5 || '-pay', 'UTF8')), 'hex'), 900, 'OP-P02')`,
        [device, TENANT, STORE, LOCATION, tag],
      );
      await pool.query(
        `select kitluy_devices.redeem_device_claim_v1(
           encode(sha256(convert_to($2 || '-tok', 'UTF8')), 'hex'),
           encode(sha256(convert_to($2 || '-pay', 'UTF8')), 'hex'), $1, 'HUB-P02')`,
        [device, tag],
      );
    };
    const hubTag = randomUUID();
    const termTag = randomUUID();
    await claim(hubId, hubTag);
    await claim(terminalId, termTag);
    const gen = await pool.query<{ g: number }>(
      `select assignment_generation as g from kitluy_devices.device_assignments
        where device_id = $1 and state in ('pending_trust', 'active')`,
      [terminalId],
    );
    generation = gen.rows[0]?.g ?? 1;
    delivery = {
      hubDeviceId: hubId,
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
    };
    ingestion = new HealthReportIngestion({ connect: () => pool.connect() });
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it("projects a valid report, deduplicates redelivery, and keeps a delayed report as history", async () => {
    const first = event({ reportSequence: 2 });
    const projected = await ingestion.ingest(delivery, first);
    expect(projected.result).toBe("PROJECTED");
    expect(projected.projectionVersion).toBe(2);

    const redelivered = await ingestion.ingest(delivery, first);
    expect(redelivered.result).toBe("DUPLICATE_IGNORED"); // one cloud business effect

    const delayed = await ingestion.ingest(delivery, event({ reportSequence: 1 }));
    expect(delayed.result).toBe("STALE_IGNORED"); // history kept, projection unmoved

    const rows = await pool.query<{ v: string }>(
      `select projection_version::text as v from kitluy_devices.device_health_projections
        where observed_device_id = $1`,
      [terminalId],
    );
    expect(rows.rows[0]?.v).toBe("2");
  });

  it("refuses scope mismatch, malformed shape, and a foreign hub identity", async () => {
    const foreign = await ingestion.ingest(
      { ...delivery, tenantId: "00000000-0000-4000-8000-000000000012" },
      event({ reportSequence: 3 }),
    );
    expect(foreign.result).toBe("REJECTED_SCOPE");

    const malformed = await ingestion.ingest(delivery, event({ healthClassification: "stale" }));
    expect(malformed.result).toBe("REJECTED_SCHEMA");

    const swapped = await ingestion.ingest(
      { ...delivery, hubDeviceId: terminalId },
      event({ hubDeviceId: terminalId, reportSequence: 4 }),
    );
    expect(swapped.result).toBe("REJECTED_IDENTITY"); // the door: not a store_hub
  });
});
