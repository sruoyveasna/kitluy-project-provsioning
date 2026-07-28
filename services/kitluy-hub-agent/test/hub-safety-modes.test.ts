/**
 * Hub SAFETY MODES (WS-09-T005).
 *
 * Proves the approved modes refuse work with REGISTERED `@kitluy/api-errors`
 * codes, that policy-permitted reads survive every mode, and — the governing
 * invariant — that NO mode ever fabricates success.
 *
 * The DB-backed probes run against the LOCAL Hub database and SKIP VISIBLY when
 * it is unreachable; a skipped run is never reported as executed evidence
 * (KLD-EVIDENCE-001).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { isKnownErrorCode, isRetiredErrorCode } from "@kitluy/api-errors";
import { withHubTransaction } from "../src/hub/db.js";
import { HubCommandError } from "../src/hub/errors.js";
import {
  CLOCK_BLOCKING_OFFSET_SECONDS,
  CLOCK_WARNING_OFFSET_SECONDS,
  HUB_DISK_WATERMARKS,
  HUB_CLOCK_ANOMALY_EVENT_CODE,
  HUB_OPERATION_KINDS,
  HUB_SAFETY_ERROR_CODE_GAPS,
  HubSafetyModeError,
  MUTATING_OPERATION_KINDS,
  PIPELINE_ENFORCED_DIMENSIONS,
  assertHubOperationPermitted,
  describeHubSafety,
  diskBandFor,
  evaluateHubSafety,
  findHubOperationRefusal,
  isHubOperationPermitted,
  isHubSafetyModeError,
  readReportedClockOffsetSeconds,
  recordClockAnomalyEvent,
  withHubSafetyGate,
} from "../src/hub/safety-mode.js";
import { auditRepo } from "../src/hub/repositories/index.js";
import { createBookingDraft } from "../src/hub/commands/booking-commands.js";
import {
  ACTOR_CASHIER,
  HUB_DEVICE,
  LOCATION,
  REVOKED_TERMINAL,
  STORE,
  T1,
  TENANT,
  TEST_LOCATION_CODE,
  appliedMigrations,
  businessDate,
  commandKeyAt,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionTerminal,
  safetyObservations,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "safety";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent safety-mode DB probes: local Hub database (kitluy_hub_local) unreachable",
  );
}

// ===========================================================================
// Pure evaluation — no database required.
// ===========================================================================
describe("Hub safety-mode evaluation", () => {
  it("maps every file-cache protocol §13 watermark band, boundary by boundary", () => {
    expect(diskBandFor(0)).toBe("normal");
    expect(diskBandFor(69.9)).toBe("normal");
    expect(diskBandFor(HUB_DISK_WATERMARKS.watch)).toBe("watch");
    expect(diskBandFor(79.9)).toBe("watch");
    expect(diskBandFor(HUB_DISK_WATERMARKS.degraded)).toBe("degraded");
    expect(diskBandFor(89.9)).toBe("degraded");
    expect(diskBandFor(HUB_DISK_WATERMARKS.critical)).toBe("critical");
    expect(diskBandFor(94.9)).toBe("critical");
    expect(diskBandFor(HUB_DISK_WATERMARKS.safetyReadOnlyRisk)).toBe("safety_read_only_risk");
    expect(diskBandFor(100)).toBe("safety_read_only_risk");
    // An UNREADABLE watermark is treated as the worst band, never as normal.
    expect(diskBandFor(Number.NaN)).toBe("safety_read_only_risk");
  });

  it("reports a healthy Hub as not degraded and permits every operation class", () => {
    const assessment = evaluateHubSafety(safetyObservations());
    expect(assessment.degraded).toBe(false);
    expect(assessment.findings).toEqual([]);
    expect(assessment.refusals).toEqual([]);
    for (const kind of HUB_OPERATION_KINDS) {
      expect(isHubOperationPermitted(assessment, kind)).toBe(true);
    }
  });

  it("blocks EVERY mutating class with HUB_READ_ONLY 503 and preserves reads", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({ readOnlyDeclared: true, readOnlyReason: "NVMe SMART pre-failure" }),
    );
    expect(assessment.readsPermitted).toBe(true);
    expect(isHubOperationPermitted(assessment, "read")).toBe(true);
    for (const kind of MUTATING_OPERATION_KINDS) {
      const refusal = findHubOperationRefusal(assessment, kind);
      expect(refusal?.code).toBe("HUB_READ_ONLY");
    }
    let thrown: unknown;
    try {
      assertHubOperationPermitted(assessment, "mutation");
    } catch (error) {
      thrown = error;
    }
    expect(isHubSafetyModeError(thrown, "HUB_READ_ONLY")).toBe(true);
    const error = thrown as HubSafetyModeError;
    // KLD-2026-07-26-002 Group 5 semantics, verbatim.
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.retryGuidance).toBe("after-hub-write-health-recovers");
    expect(error.messageKey).toBe("api.error.hub_read_only");
    expect(error.toEnvelope("corr-1").error.code).toBe("HUB_READ_ONLY");
  });

  it("blocks nonessential captures and large files at the CRITICAL band but preserves business evidence", () => {
    const assessment = evaluateHubSafety(safetyObservations({ diskUsedPercent: 92 }));
    expect(assessment.diskBand).toBe("critical");
    expect(findHubOperationRefusal(assessment, "large_file_write")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(findHubOperationRefusal(assessment, "nonessential_capture")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    // "preserve business evidence" — a Booking/custody/payment write still runs.
    expect(isHubOperationPermitted(assessment, "mutation")).toBe(true);
    expect(isHubOperationPermitted(assessment, "sensitive_write")).toBe(true);
    expect(isHubOperationPermitted(assessment, "read")).toBe(true);
  });

  it("blocks new large files AND unsafe mutations at the >=95% safety band", () => {
    const assessment = evaluateHubSafety(safetyObservations({ diskUsedPercent: 96.4 }));
    expect(assessment.diskBand).toBe("safety_read_only_risk");
    expect(findHubOperationRefusal(assessment, "large_file_write")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(findHubOperationRefusal(assessment, "mutation")?.code).toBe("HUB_READ_ONLY");
    expect(findHubOperationRefusal(assessment, "sensitive_write")?.code).toBe("HUB_READ_ONLY");
    expect(isHubOperationPermitted(assessment, "read")).toBe(true);
  });

  it("refuses mutations when the applied migration set does not match the expected version", () => {
    const applied = [{ filename: "0001_types_and_helpers.sql", checksumSha256: "a".repeat(64) }];
    const assessment = evaluateHubSafety(
      safetyObservations({
        migration: {
          expected: [...applied, { filename: "0002_identity.sql", checksumSha256: "b".repeat(64) }],
          applied,
        },
      }),
    );
    const finding = assessment.findings.find((f) => f.mode === "migration_mismatch");
    expect(finding?.evidence["missing_migrations"]).toEqual(["0002_identity.sql"]);
    expect(findHubOperationRefusal(assessment, "mutation")?.code).toBe("HUB_READ_ONLY");
    expect(isHubOperationPermitted(assessment, "read")).toBe(true);
  });

  it("refuses mutations on migration CHECKSUM drift (an applied file is never edited, §4)", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({
        migration: {
          expected: [{ filename: "0005_laundry.sql", checksumSha256: "c".repeat(64) }],
          applied: [{ filename: "0005_laundry.sql", checksumSha256: "d".repeat(64) }],
        },
      }),
    );
    const finding = assessment.findings.find((f) => f.mode === "migration_mismatch");
    expect(finding?.evidence["checksum_drift"]).toEqual(["0005_laundry.sql"]);
    expect(findHubOperationRefusal(assessment, "sensitive_write")?.code).toBe("HUB_READ_ONLY");
  });

  it("stops sensitive writes when database corruption is suspected", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({
        databaseIntegritySuspect: true,
        databaseIntegrityFinding: "checksum failure on edge_laundry.custody_event",
      }),
    );
    const finding = assessment.findings.find((f) => f.mode === "database_corruption_suspected");
    expect(finding?.evidence["incident_code"]).toBe("IR-DB");
    expect(findHubOperationRefusal(assessment, "sensitive_write")?.code).toBe("HUB_READ_ONLY");
    expect(findHubOperationRefusal(assessment, "mutation")?.code).toBe("HUB_READ_ONLY");
    expect(isHubOperationPermitted(assessment, "read")).toBe(true);
  });

  it("KEEPS the current known-good configuration when an incompatible package is rejected", () => {
    // Part 18: "Configuration package invalid -> Keep current known-good config".
    const assessment = evaluateHubSafety(
      safetyObservations({
        configuration: {
          compatible: false,
          cause: "CFG_HUB_VERSION_INCOMPATIBLE",
          knownGoodActive: true,
        },
      }),
    );
    const finding = assessment.findings.find((f) => f.mode === "configuration_incompatible");
    expect(finding?.evidence["cfg_code"]).toBe("CFG_HUB_VERSION_INCOMPATIBLE");
    expect(assessment.refusals).toEqual([]);
    expect(isHubOperationPermitted(assessment, "mutation")).toBe(true);
  });

  it("refuses with CONFIG_VERSION_INCOMPATIBLE when no compatible configuration is active", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({
        configuration: {
          compatible: false,
          cause: "CFG_SIGNATURE_INVALID",
          knownGoodActive: false,
        },
      }),
    );
    const refusal = findHubOperationRefusal(assessment, "mutation");
    expect(refusal?.code).toBe("CONFIG_VERSION_INCOMPATIBLE");
    let thrown: unknown;
    try {
      assertHubOperationPermitted(assessment, "mutation");
    } catch (error) {
      thrown = error;
    }
    expect((thrown as HubSafetyModeError).httpStatus).toBe(409);
    expect((thrown as HubSafetyModeError).details["cfg_code"]).toBe("CFG_SIGNATURE_INVALID");
  });

  it("warns above a 5-minute clock offset without blocking anything (§16)", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({ clockOffsetSeconds: CLOCK_WARNING_OFFSET_SECONDS + 1 }),
    );
    expect(assessment.clock.level).toBe("warning");
    expect(assessment.clock.securityEventRequired).toBe(true);
    expect(assessment.refusals).toEqual([]);
  });

  it("blocks provider-dependent and certificate-sensitive actions above 30 minutes (§16)", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({ clockOffsetSeconds: -(CLOCK_BLOCKING_OFFSET_SECONDS + 60) }),
    );
    expect(assessment.clock.level).toBe("blocking");
    expect(findHubOperationRefusal(assessment, "provider_dependent")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(findHubOperationRefusal(assessment, "certificate_sensitive")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    // §16: "Local ordering still uses sequences" — ordinary local work continues.
    expect(isHubOperationPermitted(assessment, "mutation")).toBe(true);
    expect(isHubOperationPermitted(assessment, "sensitive_write")).toBe(true);
  });

  it("stops blocking once trusted time is restored", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({
        clockOffsetSeconds: CLOCK_BLOCKING_OFFSET_SECONDS + 600,
        trustedTimeRestored: true,
      }),
    );
    expect(assessment.clock.level).toBe("warning");
    expect(isHubOperationPermitted(assessment, "provider_dependent")).toBe(true);
  });

  it("reports the most fundamental reason first when several modes are active", () => {
    const assessment = evaluateHubSafety(
      safetyObservations({
        readOnlyDeclared: true,
        diskUsedPercent: 97,
        databaseIntegritySuspect: true,
      }),
    );
    // Precedence: declared read-only outranks corruption suspicion and disk.
    expect(findHubOperationRefusal(assessment, "mutation")?.mode).toBe("hub_read_only");
    expect(describeHubSafety(assessment).modes).toEqual([
      "hub_read_only",
      "database_corruption_suspected",
      "disk_pressure",
    ]);
  });

  it("emits ONLY registered @kitluy/api-errors codes — none invented, none retired", () => {
    const assessments = [
      evaluateHubSafety(safetyObservations({ readOnlyDeclared: true })),
      evaluateHubSafety(safetyObservations({ diskUsedPercent: 99 })),
      evaluateHubSafety(safetyObservations({ databaseIntegritySuspect: true })),
      evaluateHubSafety(
        safetyObservations({
          configuration: { compatible: false, knownGoodActive: false },
        }),
      ),
      evaluateHubSafety(safetyObservations({ clockOffsetSeconds: 5_000 })),
      evaluateHubSafety(
        safetyObservations({
          migration: {
            expected: [{ filename: "0001_types_and_helpers.sql", checksumSha256: "e".repeat(64) }],
            applied: [],
          },
        }),
      ),
    ];
    const codes = new Set(assessments.flatMap((a) => a.refusals.map((r) => r.code)));
    expect(codes.size).toBeGreaterThan(0);
    for (const code of codes) {
      expect(isKnownErrorCode(code)).toBe(true);
      expect(isRetiredErrorCode(code)).toBe(false);
    }
  });

  it("never fabricates success: a blocked gate throws and never runs the work", async () => {
    const assessment = evaluateHubSafety(safetyObservations({ readOnlyDeclared: true }));
    let ran = false;
    await expect(
      withHubSafetyGate(assessment, "mutation", async () => {
        ran = true;
        return "committed";
      }),
    ).rejects.toBeInstanceOf(HubSafetyModeError);
    expect(ran).toBe(false);
    // The same assessment still runs a READ through the gate.
    await expect(withHubSafetyGate(assessment, "read", async () => "projection")).resolves.toBe(
      "projection",
    );
  });

  it("keeps the registry-gap record honest: every gap names a REGISTERED fallback", () => {
    expect(HUB_SAFETY_ERROR_CODE_GAPS.length).toBeGreaterThan(0);
    for (const gap of HUB_SAFETY_ERROR_CODE_GAPS) {
      expect(gap.refusal.length).toBeGreaterThan(0);
      expect(gap.absentCodeSource.length).toBeGreaterThan(0);
      // The ABSENT code is not silently invented into the registry…
      expect(isKnownErrorCode(gap.absentCode)).toBe(false);
      // …and the code actually emitted is a registered, non-retired one.
      expect(isKnownErrorCode(gap.emitted)).toBe(true);
      expect(isRetiredErrorCode(gap.emitted)).toBe(false);
    }
    // Device revocation and expired sessions stay pipeline dimensions.
    expect([...PIPELINE_ENFORCED_DIMENSIONS]).toEqual([
      "EDGE_DEVICE_REVOKED",
      "EDGE_SESSION_EXPIRED",
    ]);
  });
});

// ===========================================================================
// Database-backed probes.
// ===========================================================================
describe.skipIf(!available)("Hub safety modes against the live Hub database", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let today: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  function draft(key: { idempotencyKey: string; clientSequence: bigint }) {
    return createBookingDraft(p, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
  }

  it("finds NO migration mismatch when the live ledger is compared with itself", async () => {
    const applied = await appliedMigrations(p);
    expect(applied.length).toBeGreaterThan(0);
    const assessment = evaluateHubSafety(
      safetyObservations({ migration: { expected: applied, applied } }),
    );
    expect(assessment.findings.some((f) => f.mode === "migration_mismatch")).toBe(false);
    expect(isHubOperationPermitted(assessment, "mutation")).toBe(true);
  });

  it("reads the reported NTP offset from the Hub heartbeat, and reports ABSENCE as absent", async () => {
    const reported = await withHubTransaction(p, (client) =>
      readReportedClockOffsetSeconds(client, HUB_DEVICE),
    );
    expect(typeof reported).toBe("number");
    expect(
      evaluateHubSafety(safetyObservations({ clockOffsetSeconds: reported! })).clock.level,
    ).toBe("none");
    // A device with no heartbeat returns undefined — never a fabricated zero.
    const missing = await withHubTransaction(p, (client) =>
      readReportedClockOffsetSeconds(client, "e0000000-0000-4000-8000-0000000009f9"),
    );
    expect(missing).toBeUndefined();
  });

  it("refuses a REAL command under Hub read-only and writes NOTHING", async () => {
    const assessment = evaluateHubSafety(
      safetyObservations({ readOnlyDeclared: true, readOnlyReason: "WS-09-T005 probe" }),
    );
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      await withHubSafetyGate(assessment, "mutation", () => draft(key));
    } catch (error) {
      thrown = error;
    }
    expect(isHubSafetyModeError(thrown, "HUB_READ_ONLY")).toBe(true);
    // The pipeline was never entered: no reservation, no event, no Booking.
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.local_event where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);

    // …and the SAME key still works once the mode clears: the refusal blocked
    // the command, it did not burn the terminal's sequence.
    const healthy = evaluateHubSafety(safetyObservations());
    const accepted = await withHubSafetyGate(healthy, "mutation", () => draft(key));
    expect(accepted.outcome).toBe("accepted");
  });

  it("permits a policy-permitted READ while the Hub is read-only", async () => {
    const assessment = evaluateHubSafety(safetyObservations({ readOnlyDeclared: true }));
    const rows = await withHubSafetyGate(assessment, "read", async () =>
      p.query<{ count: string }>(
        `select count(*)::text as count from edge_laundry.booking where location_id = $1`,
        [LOCATION],
      ),
    );
    expect(Number(rows.rows[0]?.count ?? "0")).toBeGreaterThan(0);
  });

  it("commits a business mutation at the CRITICAL watermark (business evidence is preserved)", async () => {
    const assessment = evaluateHubSafety(safetyObservations({ diskUsedPercent: 93.2 }));
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    const result = await withHubSafetyGate(assessment, "mutation", () => draft(key));
    expect(result.outcome).toBe("accepted");
    // …while the nonessential file classes stay blocked in the same band.
    expect(findHubOperationRefusal(assessment, "large_file_write")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(findHubOperationRefusal(assessment, "nonessential_capture")?.code).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
  });

  it("refuses a REAL command at the >=95% safety watermark", async () => {
    const assessment = evaluateHubSafety(safetyObservations({ diskUsedPercent: 98 }));
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      await withHubSafetyGate(assessment, "mutation", () => draft(key));
    } catch (error) {
      thrown = error;
    }
    expect(isHubSafetyModeError(thrown, "HUB_READ_ONLY")).toBe(true);
    expect((thrown as HubSafetyModeError).mode).toBe("disk_pressure");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
  });

  it("refuses a REAL command on a migration mismatch and leaves the ledger untouched", async () => {
    const applied = await appliedMigrations(p);
    const assessment = evaluateHubSafety(
      safetyObservations({
        migration: {
          expected: [...applied, { filename: "9999_future.sql", checksumSha256: "f".repeat(64) }],
          applied,
        },
      }),
    );
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      await withHubSafetyGate(assessment, "mutation", () => draft(key));
    } catch (error) {
      thrown = error;
    }
    expect(isHubSafetyModeError(thrown, "HUB_READ_ONLY")).toBe(true);
    expect((thrown as HubSafetyModeError).mode).toBe("migration_mismatch");
    const after = await appliedMigrations(p);
    expect(after.map((m) => m.filename)).toEqual(applied.map((m) => m.filename));
  });

  it("records the §16 security/health event for a clock anomaly", async () => {
    const before = await withHubTransaction(p, (client) =>
      auditRepo.countSecurityEvents(client, HUB_CLOCK_ANOMALY_EVENT_CODE),
    );
    const assessment = evaluateHubSafety(safetyObservations({ clockOffsetSeconds: 900 }));
    expect(assessment.clock.securityEventRequired).toBe(true);
    await withHubTransaction(p, (client) =>
      recordClockAnomalyEvent(client, {
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        hubDeviceId: HUB_DEVICE,
        offsetSeconds: 900,
        level: "warning",
      }),
    );
    const after = await withHubTransaction(p, (client) =>
      auditRepo.countSecurityEvents(client, HUB_CLOCK_ANOMALY_EVENT_CODE),
    );
    expect(after).toBe(before + 1);
  });

  it("keeps LOCAL ORDERING on sequences, never the wall clock, under a blocking offset", async () => {
    const assessment = evaluateHubSafety(safetyObservations({ clockOffsetSeconds: 4_000 }));
    expect(assessment.clock.level).toBe("blocking");
    const first = await withHubSafetyGate(assessment, "mutation", async () =>
      draft(await nextCommandKey(p, t1.terminalDeviceId)),
    );
    const second = await withHubSafetyGate(assessment, "mutation", async () =>
      draft(await nextCommandKey(p, t1.terminalDeviceId)),
    );
    expect(first.hubSequenceLast).not.toBeNull();
    expect(second.hubSequenceFirst! > first.hubSequenceLast!).toBe(true);
  });

  it("keeps device revocation FAIL-CLOSED whether or not a safety mode is active", async () => {
    const revoked = deviceContext(t1, { terminalDeviceId: REVOKED_TERMINAL });
    const key = commandKeyAt(REVOKED_TERMINAL, 1n);

    // (a) Hub healthy — the PIPELINE denies with its own dimension code.
    let pipelineError: unknown;
    try {
      await withHubSafetyGate(evaluateHubSafety(safetyObservations()), "mutation", () =>
        createBookingDraft(p, {
          device: revoked,
          ...key,
          businessDate: today,
          locationCode: TEST_LOCATION_CODE,
          pickupMethod: "store_pickup",
        }),
      );
    } catch (error) {
      pipelineError = error;
    }
    expect(pipelineError).toBeInstanceOf(HubCommandError);
    expect(["EDGE_DEVICE_REVOKED", "EDGE_TERMINAL_UNKNOWN"]).toContain(
      (pipelineError as HubCommandError).code,
    );

    // (b) Hub read-only — the SAFETY GATE refuses first; still no effect.
    let safetyError: unknown;
    try {
      await withHubSafetyGate(
        evaluateHubSafety(safetyObservations({ readOnlyDeclared: true })),
        "mutation",
        () =>
          createBookingDraft(p, {
            device: revoked,
            ...key,
            businessDate: today,
            locationCode: TEST_LOCATION_CODE,
            pickupMethod: "store_pickup",
          }),
      );
    } catch (error) {
      safetyError = error;
    }
    expect(isHubSafetyModeError(safetyError, "HUB_READ_ONLY")).toBe(true);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
  });

  it("keeps an EXPIRED actor session FAIL-CLOSED under a safety mode too", async () => {
    const expired = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER, { sessionExpired: true });
    const key = await nextCommandKey(p, expired.terminalDeviceId);

    let pipelineError: unknown;
    try {
      await withHubSafetyGate(evaluateHubSafety(safetyObservations()), "mutation", () =>
        createBookingDraft(p, {
          device: deviceContext(expired),
          ...key,
          businessDate: today,
          locationCode: TEST_LOCATION_CODE,
          pickupMethod: "store_pickup",
        }),
      );
    } catch (error) {
      pipelineError = error;
    }
    expect(pipelineError).toBeInstanceOf(HubCommandError);
    expect((pipelineError as HubCommandError).code).toBe("EDGE_SESSION_EXPIRED");

    let safetyError: unknown;
    try {
      await withHubSafetyGate(
        evaluateHubSafety(safetyObservations({ databaseIntegritySuspect: true })),
        "mutation",
        () =>
          createBookingDraft(p, {
            device: deviceContext(expired),
            ...key,
            businessDate: today,
            locationCode: TEST_LOCATION_CODE,
            pickupMethod: "store_pickup",
          }),
      );
    } catch (error) {
      safetyError = error;
    }
    expect(isHubSafetyModeError(safetyError, "HUB_READ_ONLY")).toBe(true);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
  });
});
