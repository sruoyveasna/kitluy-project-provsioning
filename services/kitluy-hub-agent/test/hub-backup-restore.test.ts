/**
 * Development-grade backup / restore round trip (WS-09-T005).
 *
 * STATUS CEILING: DEVELOPMENT-GRADE ONLY. This proves that `scripts/hub/hub-db.mjs
 * backup|reset|restore` round-trips the Hub-local database with command-layer
 * data in it. NO production-certified disaster recovery is claimed — that needs
 * hardware and pilot evidence (WS-09-T005 status ceiling).
 *
 * DESTRUCTIVE: it drops and recreates `kitluy_hub_local`, so it is OPT-IN and
 * must run alone. Enable with `KITLUY_HUB_DESTRUCTIVE_TESTS=1`. In every other
 * run it SKIPS VISIBLY and is never counted as executed evidence
 * (KLD-EVIDENCE-001).
 *
 * The round trip is: run real commands -> fingerprint -> backup -> `reset`
 * (which really drops the database and re-applies the migrations from zero, so
 * the data is provably gone) -> restore -> fingerprint again.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  addBookingLine,
  createBookingDraft,
  confirmIntake,
  registerGarment,
} from "../src/hub/commands/booking-commands.js";
import { recordCashPayment } from "../src/hub/commands/payment-commands.js";
import { queueReceiptPrint } from "../src/hub/commands/print-commands.js";
import {
  ACTOR_CASHIER,
  LOCATION,
  STORE,
  T1,
  TENANT,
  TEST_LOCATION_CODE,
  bookingRow,
  bookingVersion,
  businessDate,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionOpenShift,
  provisionTerminal,
  relationFingerprint,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "backup";
const enabled = process.env["KITLUY_HUB_DESTRUCTIVE_TESTS"] === "1";
const available = enabled && (await hubReachable());
if (!enabled) {
  console.warn(
    "SKIPPED kitluy-hub-agent backup/restore suite: DESTRUCTIVE — set KITLUY_HUB_DESTRUCTIVE_TESTS=1 and run this file alone.",
  );
} else if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent backup/restore suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

/** Repo root — `hub-db.mjs` resolves `hub/**` and `hub/.backups` relative to it. */
const REPO_ROOT = resolve(process.cwd(), "..", "..");

function hubDb(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["scripts/hub/hub-db.mjs", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, KITLUY_ENV: process.env["KITLUY_ENV"] ?? "local" },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Relations the round trip must preserve, grouped exactly as WS-09-T005 lists
 * them. Every one is asserted individually, so a restore that silently lost one
 * table cannot hide behind a matching total.
 */
const PRESERVED_RELATIONS: Readonly<Record<string, readonly string[]>> = {
  "migration ledger": ["edge_ops.migration_journal"],
  configuration: [
    "edge_config.configuration_snapshot",
    "edge_config.configuration_section",
    "edge_config.configuration_activation",
  ],
  assignments: [
    "edge_identity.hub_assignment",
    "edge_config.terminal_profile_assignment",
    "edge_identity.terminal_device",
  ],
  "actor sessions": ["edge_identity.terminal_session", "edge_identity.staff_cache"],
  bookings: ["edge_laundry.booking", "edge_laundry.booking_line"],
  garments: ["edge_laundry.garment", "edge_laundry.tag"],
  "custody history": ["edge_laundry.custody_event", "edge_laundry.status_event"],
  storage: ["edge_laundry.storage_position", "edge_laundry.storage_assignment"],
  payments: [
    "edge_payments.payment",
    "edge_payments.payment_attempt",
    "edge_payments.tender_leg",
    "edge_payments.refund_adjustment",
    "edge_core.cash_movement",
  ],
  allocations: ["edge_core.business_sequence", "edge_core.shift"],
  idempotency: ["edge_sync.command_result"],
  "command results": ["edge_sync.command_result"],
  "event outbox": ["edge_sync.local_event", "edge_sync.outbox"],
  "sync journal": ["edge_sync.sequence_gap", "edge_sync.sync_cursor", "edge_sync.inbox"],
  audit: ["edge_audit.audit_event", "edge_audit.security_event"],
  "print jobs": [
    "edge_documents.print_job",
    "edge_documents.print_attempt",
    "edge_documents.receipt",
  ],
  "file metadata": ["edge_files.asset", "edge_files.asset_chunk", "edge_files.file_transfer_job"],
};

/** Content digest (not just a row count) for the relations that carry truth. */
const CONTENT_DIGESTS: Readonly<Record<string, string>> = {
  "edge_sync.command_result":
    "select md5(string_agg(idempotency_key || '|' || request_hash || '|' || commit_status || '|' || coalesce(sync_state,''), ',' order by idempotency_key)) as d from edge_sync.command_result",
  "edge_laundry.booking":
    "select md5(string_agg(id::text || '|' || booking_number || '|' || status || '|' || total_minor::text || '|' || paid_minor::text || '|' || aggregate_version::text, ',' order by id)) as d from edge_laundry.booking",
  "edge_laundry.custody_event":
    "select md5(string_agg(id::text || '|' || to_custody_state || '|' || payload_sha256, ',' order by local_sequence)) as d from edge_laundry.custody_event",
  "edge_sync.outbox":
    "select md5(string_agg(event_id::text || '|' || delivery_state || '|' || hub_sequence::text, ',' order by hub_sequence)) as d from edge_sync.outbox",
  "edge_audit.audit_event":
    "select md5(string_agg(id::text || '|' || event_code || '|' || payload_sha256, ',' order by local_sequence)) as d from edge_audit.audit_event",
  "edge_payments.payment":
    "select md5(string_agg(id::text || '|' || state || '|' || amount_minor::text || '|' || idempotency_key, ',' order by id)) as d from edge_payments.payment",
  "edge_ops.migration_journal":
    "select md5(string_agg(filename || '|' || checksum_sha256, ',' order by filename)) as d from edge_ops.migration_journal",
};

async function contentDigests(p: pg.Pool): Promise<ReadonlyMap<string, string>> {
  const digests = new Map<string, string>();
  for (const [relation, sql] of Object.entries(CONTENT_DIGESTS)) {
    const result = await p.query<{ d: string | null }>(sql);
    digests.set(relation, result.rows[0]?.d ?? "<empty>");
  }
  return digests;
}

function fingerprintSha(counts: ReadonlyMap<string, number>): string {
  const body = [...counts.entries()]
    .map(([relation, rows]) => `${relation}=${rows}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

describe.skipIf(!available)("Hub development-grade backup and restore round trip", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let today: string;
  let bookingId: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    await provisionOpenShift(p, t1.terminalDeviceId, ACTOR_CASHIER);

    // Command-layer data must exist BEFORE the backup: T005 requires the round
    // trip to be re-proven now that commands write real rows.
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    bookingId = created.aggregateId as string;
    await addBookingLine(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      line: {
        serviceId: "e0000000-0000-4000-8000-000000000f01",
        serviceVersion: 3n,
        displayName: "Backup round-trip line",
        unitPriceMinor: 3300n,
        unitCode: "piece",
        pieceCount: 1,
      },
    });
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `BK-${bookingId.slice(-10)}`,
      garmentType: "shirt",
    });
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: (await bookingRow(p, bookingId)).balance_minor,
      locationCode: TEST_LOCATION_CODE,
    });
    await queueReceiptPrint(p, {
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      documentType: "payment_receipt",
      documentId: bookingId,
      templateVersion: 3n,
      payloadSha256: "2".repeat(64),
      createdBy: ACTOR_CASHIER,
      terminalDeviceId: t1.terminalDeviceId,
    });
  }, 120_000);

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  it("preserves every WS-09-T005 relation across backup -> reset -> restore", async () => {
    const countsBefore = await relationFingerprint(p);
    const digestsBefore = await contentDigests(p);
    // The shipped fixtures deliberately carry WS-10-shaped outbox rows
    // (`acknowledged`, `retry_wait`). They must survive UNCHANGED, and the
    // restore must not invent, drop or advance any of them.
    const nonPendingBefore = (
      await p.query<{ event_id: string; delivery_state: string; cloud_ack_id: string | null }>(
        `select event_id, delivery_state, cloud_ack_id from edge_sync.outbox
            where delivery_state <> 'pending' order by event_id`,
      )
    ).rows;
    const shaBefore = fingerprintSha(countsBefore);
    expect(countsBefore.get("edge_sync.command_result")).toBeGreaterThan(0);
    expect(countsBefore.get("edge_laundry.booking")).toBeGreaterThan(0);
    expect(countsBefore.get("edge_sync.outbox")).toBeGreaterThan(0);
    console.info(`hub backup/restore: fingerprint BEFORE sha256=${shaBefore}`);

    // --- backup ---------------------------------------------------------
    const backup = hubDb("backup");
    expect(backup.stderr + backup.stdout).not.toMatch(/REFUSED|FAILED/);
    expect(backup.status).toBe(0);
    const backupName = /backup written .*[\\/]([^\\/\s]+\.dump)/.exec(backup.stdout)?.[1];
    expect(backupName, backup.stdout).toBeTruthy();
    const dumpSha = /sha256\s+([0-9a-f]{64})/.exec(backup.stdout)?.[1];
    const recordedFingerprint = /fingerprint_sha256\s+([0-9a-f]{64})/.exec(backup.stdout)?.[1];
    expect(dumpSha).toMatch(/^[0-9a-f]{64}$/);
    expect(recordedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    console.info(
      `hub backup/restore: dump=${backupName} sha256=${dumpSha} runner_fingerprint=${recordedFingerprint}`,
    );

    // --- drop / reset: the data must provably be GONE ---------------------
    await p.end().catch(() => undefined);
    const reset = hubDb("reset");
    expect(reset.status).toBe(0);
    let scratch = pool();
    const countsAfterReset = await relationFingerprint(scratch);
    expect(countsAfterReset.get("edge_laundry.booking")).toBe(0);
    expect(countsAfterReset.get("edge_sync.command_result")).toBe(0);
    // The schema itself came back from zero, so the ledger is full again.
    expect(countsAfterReset.get("edge_ops.migration_journal")).toBe(
      countsBefore.get("edge_ops.migration_journal"),
    );
    await scratch.end().catch(() => undefined);

    // --- restore ---------------------------------------------------------
    const restore = hubDb("restore", backupName!);
    expect(restore.stdout + restore.stderr).not.toMatch(/VERIFICATION FAILED/);
    expect(restore.status).toBe(0);

    scratch = pool();
    const countsAfter = await relationFingerprint(scratch);
    const digestsAfter = await contentDigests(scratch);
    const shaAfter = fingerprintSha(countsAfter);
    console.info(`hub backup/restore: fingerprint AFTER  sha256=${shaAfter}`);

    // Per-relation, group by group — never a single aggregate number.
    for (const [group, relations] of Object.entries(PRESERVED_RELATIONS)) {
      for (const relation of relations) {
        expect(countsBefore.has(relation), `${group}: ${relation} exists`).toBe(true);
        expect(countsAfter.get(relation), `${group}: ${relation} row count`).toBe(
          countsBefore.get(relation),
        );
      }
    }
    // Content, not just cardinality.
    for (const [relation, digest] of digestsBefore) {
      expect(digestsAfter.get(relation), `${relation} content digest`).toBe(digest);
    }
    // WS-11-T006-P02: restore INTENTIONALLY writes the restored_quarantine
    // mode change and its append-only event (owner decision §3), so the
    // replacement-state relations are excluded from the equality — their
    // delta is asserted exactly instead.
    const stripReplacement = (sha: ReadonlyMap<string, number>): string =>
      fingerprintSha(
        new Map([...sha.entries()].filter(([r]) => !r.startsWith("edge_identity.hub_replacement"))),
      );
    expect(stripReplacement(countsAfter)).toBe(stripReplacement(countsBefore));
    expect(
      (countsAfter.get("edge_identity.hub_replacement_events") ?? 0) -
        (countsBefore.get("edge_identity.hub_replacement_events") ?? 0),
    ).toBe(1);

    // The restored Booking is byte-identical where it matters.
    const restored = await scratch.query<{ status: string; paid_minor: bigint }>(
      `select status, paid_minor from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(restored.rows[0]?.status).toBe("intake_confirmed");
    expect(restored.rows[0]?.paid_minor).toBeGreaterThan(0n);
    // Restore never fabricates, drops or advances a cloud outcome (§2).
    const nonPendingAfter = (
      await scratch.query<{
        event_id: string;
        delivery_state: string;
        cloud_ack_id: string | null;
      }>(
        `select event_id, delivery_state, cloud_ack_id from edge_sync.outbox
            where delivery_state <> 'pending' order by event_id`,
      )
    ).rows;
    expect(nonPendingAfter).toEqual(nonPendingBefore);
    await scratch.end().catch(() => undefined);

    // Re-open the suite pool so afterAll has something valid to close.
    p = pool();
  }, 600_000);

  it("refuses to restore a dump whose recorded checksum does not match", () => {
    const bogus = hubDb("restore", "definitely-not-a-real-backup.dump");
    expect(bogus.status).not.toBe(0);
    expect(bogus.stderr + bogus.stdout).toMatch(/does not exist|no backup found/i);
  });
});
