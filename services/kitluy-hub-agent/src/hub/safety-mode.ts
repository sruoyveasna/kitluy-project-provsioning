/**
 * Store Hub SAFETY MODES (WS-09-T005).
 *
 * A safety mode is a Hub-wide health verdict that REFUSES work. It is a
 * separate gate that sits BEFORE the command pipeline; it never participates in
 * the pipeline's decision order (Store Hub spec §9), never relaxes a pipeline
 * check, and — the invariant that governs this whole module — NO safety mode
 * ever fabricates success. Every blocked operation raises {@link
 * HubSafetyModeError}; there is no code path that returns a synthesized result.
 *
 * Authority:
 *   - WS-09-T005 "Safety modes": Hub read-only mode, disk pressure, migration
 *     failure, database corruption suspicion, configuration incompatibility,
 *     device revocation, expired actor session, clock anomaly.
 *   - KLD-2026-07-26-002 Group 5: `HUB_READ_ONLY` = HTTP 503, mutations stay
 *     BLOCKED, retry only `after-hub-write-health-recovers`.
 *   - Store Hub Phase 1 spec Part 18 (failure and degraded-mode matrix):
 *     "Disk nearing full -> Restrict noncritical files first";
 *     "Database corruption suspected -> Stop sensitive writes";
 *     "Configuration package invalid -> Keep current known-good config".
 *   - File cache and transfer protocol §13 (disk watermarks, verbatim ladder).
 *   - Offline idempotency and sequencing contract §16 (clock handling).
 *   - Recovery and replacement runbook §4 (`IR-DB`, `IR-FILE`), §11 (database
 *     corruption: "Put Hub in maintenance/read-only mode"), §12 (A/B rollback:
 *     "verify local schema compatibility").
 *   - Local database schema contract §4 (migrations are checksum-registered;
 *     an applied file is never edited).
 *   - Configuration snapshot contract §17 (`CFG_*` rejection vocabulary).
 *
 * ERROR-CODE DISCIPLINE. Every code this module emits is a REGISTERED code from
 * `@kitluy/api-errors`. No code is invented here. Where the canonical registry
 * has no specific code for a refusal, the closest REGISTERED code is emitted
 * fail-closed and the gap is recorded in {@link HUB_SAFETY_ERROR_CODE_GAPS} so
 * the missing registry row is visible rather than papered over.
 *
 * DEVICE REVOCATION AND EXPIRED ACTOR SESSION are deliberately NOT modes here:
 * they are per-request authorisation dimensions already enforced fail-closed by
 * `authorizeHubCommand` (`EDGE_DEVICE_REVOKED`, `EDGE_SESSION_EXPIRED`). A
 * safety mode can only ever ADD a refusal on top of them — see
 * {@link PIPELINE_ENFORCED_DIMENSIONS}.
 */
import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  messageKeyFor,
  retryGuidanceFor,
  type KitluyErrorCode,
  type KitluyErrorEnvelope,
  type KitluyRetryGuidance,
} from "@kitluy/api-errors";
import type { HubClient } from "./db.js";
import { auditRepo } from "./repositories/index.js";
import { uuidv7 } from "./uuid.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The approved WS-09-T005 safety modes this module evaluates. */
export const HUB_SAFETY_MODES = [
  "hub_read_only",
  "migration_mismatch",
  "database_corruption_suspected",
  "configuration_incompatible",
  "disk_pressure",
  "clock_anomaly",
] as const;
export type HubSafetyMode = (typeof HUB_SAFETY_MODES)[number];

/**
 * Authorisation dimensions that stay OUTSIDE this module because the command
 * pipeline already enforces them fail-closed for every request. Recorded so a
 * reader cannot conclude that a "normal" safety assessment means authorised.
 */
export const PIPELINE_ENFORCED_DIMENSIONS = [
  "EDGE_DEVICE_REVOKED",
  "EDGE_SESSION_EXPIRED",
] as const;

/**
 * Operation classes a safety mode can refuse.
 *
 * `read` is never refused by any mode: `HUB_READ_ONLY` "blocks mutations while
 * preserving policy-permitted reads" (KLD-2026-07-26-002 Group 5), and the
 * 90-95% watermark band explicitly says "preserve business evidence".
 */
export const HUB_OPERATION_KINDS = [
  "read",
  /** An ordinary business mutation (Booking, custody, print queue, …). */
  "mutation",
  /** Finalized payment, cash, finance, custody or audit write (KLD-FIN-001). */
  "sensitive_write",
  /** A new large file entering the local file cache. */
  "large_file_write",
  /** Nonessential capture or export (photo capture, report export). */
  "nonessential_capture",
  /** Needs a payment/provider round trip. */
  "provider_dependent",
  /** Needs certificate validation, rotation or pairing. */
  "certificate_sensitive",
] as const;
export type HubOperationKind = (typeof HUB_OPERATION_KINDS)[number];

/** Every operation class except `read`. */
export const MUTATING_OPERATION_KINDS: readonly HubOperationKind[] = HUB_OPERATION_KINDS.filter(
  (kind) => kind !== "read",
);

/** Configuration snapshot contract §17 rejection vocabulary, verbatim. */
export const CFG_REJECTION_CODES = [
  "CFG_SIGNATURE_INVALID",
  "CFG_HASH_MISMATCH",
  "CFG_SCOPE_MISMATCH",
  "CFG_VERSION_REGRESSION",
  "CFG_VERSION_HASH_COLLISION",
  "CFG_SCHEMA_UNSUPPORTED",
  "CFG_HUB_VERSION_INCOMPATIBLE",
  "CFG_DEPENDENCY_MISSING",
  "CFG_VALIDATION_FAILED",
  "CFG_ACTIVATION_HEALTH_FAILED",
  "CFG_NO_ROLLBACK_TARGET",
] as const;
export type CfgRejectionCode = (typeof CFG_REJECTION_CODES)[number];

/**
 * Registry gaps discovered while implementing these modes. Each names a refusal
 * for which `@kitluy/api-errors` publishes NO specific code, the registered code
 * emitted instead, and the reason. Recorded rather than resolved
 * (CLAUDE.md hard rule 8; repository rule 9).
 */
export const HUB_SAFETY_ERROR_CODE_GAPS = [
  {
    refusal: "disk watermark blocks a new large file or a nonessential capture/export",
    absentCode: "FILE_QUOTA_EXCEEDED",
    absentCodeSource: "kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md §20",
    emitted: "DEPENDENCY_UNAVAILABLE",
    reason:
      "local storage capacity is a required internal dependency; the file-cache protocol names FILE_QUOTA_EXCEEDED but the canonical API error registry publishes no counterpart row",
  },
  {
    refusal: "applied migration set does not match the expected Hub schema version",
    absentCode: "[REQUIRED: registered API error code for a Hub schema/migration version mismatch]",
    absentCodeSource: "recovery runbook §12 'verify local schema compatibility'",
    emitted: "HUB_READ_ONLY",
    reason:
      "runbook §11 step 1 places such a Hub in maintenance/read-only mode, so the observable client contract IS Hub read-only",
  },
  {
    refusal: "database corruption is suspected",
    absentCode: "[REQUIRED: registered API error code for suspected local database corruption]",
    absentCodeSource:
      "Phase 1 spec Part 18 'Database corruption suspected -> Stop sensitive writes'",
    emitted: "HUB_READ_ONLY",
    reason: "runbook §11 step 1 places such a Hub in maintenance/read-only mode",
  },
  {
    refusal: "NTP offset exceeds 30 minutes and trusted time is not restored",
    absentCode: "[REQUIRED: registered API error code for an untrusted Hub clock]",
    absentCodeSource: "offline idempotency and sequencing contract §16",
    emitted: "DEPENDENCY_UNAVAILABLE",
    reason:
      "trusted time is a required internal dependency of provider-dependent and certificate-sensitive actions; §16 blocks only those two classes, so the Hub is NOT read-only and HUB_READ_ONLY would misreport it",
  },
] as const;

/**
 * Hub-local evidence label for a clock anomaly. The offline contract §16 says
 * the Hub "records a security/health event" but publishes no event code, and
 * `edge_audit.security_event.event_code` is free text whose table comment
 * already anticipates "clock anomalies (§16)". Recorded as an owed canonical
 * value rather than presented as governed vocabulary.
 */
export const HUB_CLOCK_ANOMALY_EVENT_CODE = "EDGE_CLOCK_OFFSET_EXCEEDED" as const;
export const REQUIRED_CLOCK_ANOMALY_EVENT_CODE =
  "[REQUIRED: canonical security/health event code for an NTP clock anomaly (offline contract §16 names the event but not its code)]";

/**
 * The Hub heartbeat records `disk_free_bytes` but no partition capacity, so the
 * §13 USED PERCENTAGE cannot be derived from the database. The percentage is an
 * OS-level reading supplied by the caller; no collector exists in WS-09.
 */
export const REQUIRED_DISK_CAPACITY_SOURCE =
  "[REQUIRED: Hub data-partition capacity source — edge_hardware.device_heartbeat records disk_free_bytes only, so the file-cache protocol §13 used-percentage watermark cannot be derived Hub-side]";

// ---------------------------------------------------------------------------
// Disk watermark ladder — file cache and transfer protocol §13, verbatim.
// ---------------------------------------------------------------------------

export type HubDiskBand = "normal" | "watch" | "degraded" | "critical" | "safety_read_only_risk";

/** §13 boundaries: <70 | 70-80 | 80-90 | 90-95 | >=95. */
export const HUB_DISK_WATERMARKS = {
  watch: 70,
  degraded: 80,
  critical: 90,
  safetyReadOnlyRisk: 95,
} as const;

export function diskBandFor(usedPercent: number): HubDiskBand {
  if (!Number.isFinite(usedPercent)) {
    // An unreadable watermark is treated as the WORST band: a safety ladder
    // that guesses "normal" on missing data is not a safety ladder.
    return "safety_read_only_risk";
  }
  if (usedPercent >= HUB_DISK_WATERMARKS.safetyReadOnlyRisk) return "safety_read_only_risk";
  if (usedPercent >= HUB_DISK_WATERMARKS.critical) return "critical";
  if (usedPercent >= HUB_DISK_WATERMARKS.degraded) return "degraded";
  if (usedPercent >= HUB_DISK_WATERMARKS.watch) return "watch";
  return "normal";
}

// ---------------------------------------------------------------------------
// Clock handling — offline contract §16.
// ---------------------------------------------------------------------------

/** §16: "If offset exceeds 5 minutes … warning and … security/health event". */
export const CLOCK_WARNING_OFFSET_SECONDS = 300;
/** §16: "If offset exceeds 30 minutes and trusted time cannot be restored …". */
export const CLOCK_BLOCKING_OFFSET_SECONDS = 1800;

export type HubClockAnomalyLevel = "none" | "warning" | "blocking";

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface HubMigrationEntry {
  readonly filename: string;
  readonly checksumSha256: string;
}

export interface HubMigrationObservation {
  /** The migration set this Hub release expects to be applied (§4). */
  readonly expected: readonly HubMigrationEntry[];
  /** What `edge_ops.migration_journal` actually reports. */
  readonly applied: readonly HubMigrationEntry[];
}

export interface HubConfigurationObservation {
  /** False when the ACTIVE configuration cannot be used by this Hub release. */
  readonly compatible: boolean;
  /** Configuration snapshot contract §17 cause, when one is known. */
  readonly cause?: CfgRejectionCode;
  /**
   * Part 18: "Configuration package invalid -> Keep current known-good config".
   * Operations continue on a known-good ACTIVE snapshot; only the absence of
   * one turns configuration incompatibility into a blocking safety mode.
   */
  readonly knownGoodActive: boolean;
}

export interface HubSafetyObservations {
  /** Operator/HET-declared read-only mode (runbook §5, §11). */
  readonly readOnlyDeclared: boolean;
  readonly readOnlyReason?: string;
  /** Data-partition used percentage (§13). See {@link REQUIRED_DISK_CAPACITY_SOURCE}. */
  readonly diskUsedPercent: number;
  readonly migration: HubMigrationObservation;
  /** Runbook §4 `IR-DB` / Part 18 "Database corruption suspected". */
  readonly databaseIntegritySuspect: boolean;
  readonly databaseIntegrityFinding?: string;
  readonly configuration: HubConfigurationObservation;
  /** Signed NTP offset in seconds (§16); sign is irrelevant, magnitude governs. */
  readonly clockOffsetSeconds: number;
  /** §16: a >30 min offset blocks only while trusted time "cannot be restored". */
  readonly trustedTimeRestored?: boolean;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export type HubSafetySeverity = "info" | "warning" | "degraded" | "critical";

export interface HubSafetyFinding {
  readonly mode: HubSafetyMode;
  readonly severity: HubSafetySeverity;
  readonly detail: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface HubOperationRefusal {
  readonly operation: HubOperationKind;
  readonly mode: HubSafetyMode;
  readonly code: KitluyErrorCode;
  readonly reason: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface HubSafetyAssessment {
  readonly findings: readonly HubSafetyFinding[];
  readonly refusals: readonly HubOperationRefusal[];
  readonly diskBand: HubDiskBand;
  readonly clock: {
    readonly offsetSeconds: number;
    readonly level: HubClockAnomalyLevel;
    /** §16: a warning-level or worse offset MUST be recorded as evidence. */
    readonly securityEventRequired: boolean;
  };
  /** True when at least one mode is active — never used to imply authorisation. */
  readonly degraded: boolean;
  /**
   * Literal `true`. Policy-permitted reads survive every safety mode
   * (KLD-2026-07-26-002 Group 5), and the literal type makes it impossible for
   * a caller to narrow this module into blocking a read.
   */
  readonly readsPermitted: true;
}

// ---------------------------------------------------------------------------
// Refusal
// ---------------------------------------------------------------------------

/**
 * The ONLY outcome a blocked operation can produce. There is deliberately no
 * "degraded success" shape: a safety mode refuses, it never invents a result,
 * a payment outcome or a cloud acknowledgement.
 */
export class HubSafetyModeError extends Error {
  readonly code: KitluyErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly retryGuidance: KitluyRetryGuidance;
  readonly messageKey: string;
  readonly mode: HubSafetyMode;
  readonly operation: HubOperationKind;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(refusal: HubOperationRefusal) {
    super(`${refusal.code}: ${refusal.reason}`);
    this.name = "HubSafetyModeError";
    this.code = refusal.code;
    this.httpStatus = httpStatusFor(refusal.code);
    this.retryable = isRetryable(refusal.code);
    this.retryGuidance = retryGuidanceFor(refusal.code);
    this.messageKey = messageKeyFor(refusal.code);
    this.mode = refusal.mode;
    this.operation = refusal.operation;
    this.details = { safety_mode: refusal.mode, operation: refusal.operation, ...refusal.evidence };
  }

  /** Canonical envelope; the message never leaks provider or OS internals. */
  toEnvelope(correlationId?: string): KitluyErrorEnvelope {
    return errorEnvelope(this.code, this.message, {
      ...(correlationId !== undefined ? { correlationId } : {}),
      details: this.details,
    });
  }
}

export function isHubSafetyModeError(
  error: unknown,
  code?: KitluyErrorCode,
): error is HubSafetyModeError {
  if (!(error instanceof HubSafetyModeError)) return false;
  return code === undefined || error.code === code;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function blockAll(
  refusals: HubOperationRefusal[],
  mode: HubSafetyMode,
  code: KitluyErrorCode,
  reason: string,
  evidence: Readonly<Record<string, unknown>>,
  kinds: readonly HubOperationKind[] = MUTATING_OPERATION_KINDS,
): void {
  for (const operation of kinds) {
    refusals.push({ operation, mode, code, reason, evidence });
  }
}

function diffMigrations(observation: HubMigrationObservation): {
  missing: string[];
  unexpected: string[];
  checksumDrift: string[];
} {
  const applied = new Map(observation.applied.map((entry) => [entry.filename, entry]));
  const expected = new Map(observation.expected.map((entry) => [entry.filename, entry]));
  const missing: string[] = [];
  const checksumDrift: string[] = [];
  for (const [filename, entry] of expected) {
    const appliedEntry = applied.get(filename);
    if (!appliedEntry) {
      missing.push(filename);
      continue;
    }
    if (appliedEntry.checksumSha256 !== entry.checksumSha256) checksumDrift.push(filename);
  }
  const unexpected = [...applied.keys()].filter((filename) => !expected.has(filename));
  return {
    missing: missing.sort(),
    unexpected: unexpected.sort(),
    checksumDrift: checksumDrift.sort(),
  };
}

/**
 * Evaluate every approved safety mode against one set of observations.
 *
 * Refusals are pushed in a FIXED precedence order — read-only, migration
 * mismatch, corruption suspicion, configuration incompatibility, disk pressure,
 * clock anomaly — so a blocked operation always reports the most fundamental
 * reason rather than whichever mode happened to be evaluated first.
 */
export function evaluateHubSafety(observations: HubSafetyObservations): HubSafetyAssessment {
  const findings: HubSafetyFinding[] = [];
  const refusals: HubOperationRefusal[] = [];

  // 1 ------------------------------------------------- declared read-only mode
  if (observations.readOnlyDeclared) {
    const evidence = { reason: observations.readOnlyReason ?? "declared by operator/HET" };
    findings.push({
      mode: "hub_read_only",
      severity: "critical",
      detail: "Hub is in read-only safety mode; mutations are blocked and reads are preserved.",
      evidence,
    });
    blockAll(
      refusals,
      "hub_read_only",
      "HUB_READ_ONLY",
      "the Store Hub is in read-only safety mode; no mutation is accepted until write health recovers.",
      evidence,
    );
  }

  // 2 ------------------------------------------------------ migration mismatch
  const migration = diffMigrations(observations.migration);
  if (
    migration.missing.length > 0 ||
    migration.unexpected.length > 0 ||
    migration.checksumDrift.length > 0
  ) {
    const evidence = {
      missing_migrations: migration.missing,
      unexpected_migrations: migration.unexpected,
      checksum_drift: migration.checksumDrift,
      expected_count: observations.migration.expected.length,
      applied_count: observations.migration.applied.length,
    };
    findings.push({
      mode: "migration_mismatch",
      severity: "critical",
      detail:
        "the applied migration set does not match the expected Hub schema version (schema contract §4; runbook §12).",
      evidence,
    });
    blockAll(
      refusals,
      "migration_mismatch",
      "HUB_READ_ONLY",
      "the Hub schema does not match the expected migration set; mutations are refused until the schema is reconciled.",
      evidence,
    );
  }

  // 3 --------------------------------------------- database corruption suspicion
  if (observations.databaseIntegritySuspect) {
    const evidence = {
      finding: observations.databaseIntegrityFinding ?? "integrity check reported a suspicion",
      incident_code: "IR-DB",
    };
    findings.push({
      mode: "database_corruption_suspected",
      severity: "critical",
      detail: "local database corruption is suspected; sensitive writes are stopped (Part 18).",
      evidence,
    });
    blockAll(
      refusals,
      "database_corruption_suspected",
      "HUB_READ_ONLY",
      "local database corruption is suspected; the Hub is in maintenance/read-only mode (runbook §11).",
      evidence,
    );
  }

  // 4 ------------------------------------------- configuration incompatibility
  if (!observations.configuration.compatible) {
    const evidence = {
      cfg_code: observations.configuration.cause ?? null,
      known_good_active: observations.configuration.knownGoodActive,
    };
    findings.push({
      mode: "configuration_incompatible",
      // Part 18 keeps the Store running on the known-good package, so an
      // incompatible NEW package is degraded, not critical.
      severity: observations.configuration.knownGoodActive ? "degraded" : "critical",
      detail: observations.configuration.knownGoodActive
        ? "an incompatible configuration package was rejected; the Hub keeps the current known-good configuration (Part 18)."
        : "no compatible configuration is active; the Hub refuses to operate on unknown configuration.",
      evidence,
    });
    if (!observations.configuration.knownGoodActive) {
      blockAll(
        refusals,
        "configuration_incompatible",
        "CONFIG_VERSION_INCOMPATIBLE",
        "no compatible configuration snapshot is active for this Location; the Hub refuses to guess configuration.",
        evidence,
      );
    }
  }

  // 5 ------------------------------------------------------------ disk pressure
  const diskBand = diskBandFor(observations.diskUsedPercent);
  if (diskBand !== "normal") {
    const evidence = { disk_used_percent: observations.diskUsedPercent, disk_band: diskBand };
    const severity: HubSafetySeverity =
      diskBand === "watch"
        ? "info"
        : diskBand === "degraded"
          ? "warning"
          : diskBand === "critical"
            ? "degraded"
            : "critical";
    findings.push({
      mode: "disk_pressure",
      severity,
      detail: `data-partition watermark band '${diskBand}' (file-cache protocol §13).`,
      evidence,
    });
    if (diskBand === "critical" || diskBand === "safety_read_only_risk") {
      // 90-95% "Block nonessential captures/exports; preserve business evidence".
      blockAll(
        refusals,
        "disk_pressure",
        "DEPENDENCY_UNAVAILABLE",
        "the Hub data partition is above the critical watermark; nonessential captures, exports and new large files are blocked so business evidence is preserved.",
        evidence,
        ["large_file_write", "nonessential_capture"],
      );
    }
    if (diskBand === "safety_read_only_risk") {
      // >=95% "Block new large files and unsafe mutations; alert HET".
      blockAll(
        refusals,
        "disk_pressure",
        "HUB_READ_ONLY",
        "the Hub data partition is at the safety read-only watermark; unsafe mutations are blocked until space is recovered.",
        evidence,
        ["mutation", "sensitive_write", "provider_dependent", "certificate_sensitive"],
      );
    }
  }

  // 6 ------------------------------------------------------------ clock anomaly
  const offsetMagnitude = Math.abs(observations.clockOffsetSeconds);
  const trustedTimeRestored = observations.trustedTimeRestored === true;
  let clockLevel: HubClockAnomalyLevel = "none";
  if (offsetMagnitude > CLOCK_BLOCKING_OFFSET_SECONDS && !trustedTimeRestored) {
    clockLevel = "blocking";
  } else if (offsetMagnitude > CLOCK_WARNING_OFFSET_SECONDS) {
    clockLevel = "warning";
  }
  if (clockLevel !== "none") {
    const evidence = {
      clock_offset_seconds: observations.clockOffsetSeconds,
      trusted_time_restored: trustedTimeRestored,
      // §16: "Local ordering still uses sequences" — never wall clock.
      local_ordering_source: "edge_sync.hub_sequence_seq",
    };
    findings.push({
      mode: "clock_anomaly",
      severity: clockLevel === "blocking" ? "critical" : "warning",
      detail:
        clockLevel === "blocking"
          ? "NTP offset exceeds 30 minutes and trusted time is not restored; provider-dependent and certificate-sensitive actions are blocked (§16)."
          : "NTP offset exceeds 5 minutes; a security/health event is recorded and the operator is warned (§16).",
      evidence,
    });
    if (clockLevel === "blocking") {
      blockAll(
        refusals,
        "clock_anomaly",
        "DEPENDENCY_UNAVAILABLE",
        "trusted time is unavailable; provider-dependent and certificate-sensitive actions are blocked. Local ordering is unaffected because it uses sequences, never the wall clock.",
        evidence,
        ["provider_dependent", "certificate_sensitive"],
      );
    }
  }

  return {
    findings,
    refusals,
    diskBand,
    clock: {
      offsetSeconds: observations.clockOffsetSeconds,
      level: clockLevel,
      securityEventRequired: clockLevel !== "none",
    },
    degraded: findings.length > 0,
    readsPermitted: true,
  };
}

/** The first (highest-precedence) refusal for `operation`, if any. */
export function findHubOperationRefusal(
  assessment: HubSafetyAssessment,
  operation: HubOperationKind,
): HubOperationRefusal | undefined {
  return assessment.refusals.find((refusal) => refusal.operation === operation);
}

export function isHubOperationPermitted(
  assessment: HubSafetyAssessment,
  operation: HubOperationKind,
): boolean {
  return findHubOperationRefusal(assessment, operation) === undefined;
}

/** Throws {@link HubSafetyModeError} when a safety mode refuses `operation`. */
export function assertHubOperationPermitted(
  assessment: HubSafetyAssessment,
  operation: HubOperationKind,
): void {
  const refusal = findHubOperationRefusal(assessment, operation);
  if (refusal) throw new HubSafetyModeError(refusal);
}

/**
 * Run `work` ONLY when no safety mode refuses `operation`.
 *
 * This is the safety gate: it sits in front of the command pipeline and never
 * inside it, so the pipeline's authorisation order is untouched. A refusal
 * means `work` is never invoked — nothing is half-executed and nothing is
 * reported as succeeded.
 */
export async function withHubSafetyGate<T>(
  assessment: HubSafetyAssessment,
  operation: HubOperationKind,
  work: () => Promise<T>,
): Promise<T> {
  assertHubOperationPermitted(assessment, operation);
  return work();
}

/** Operator/health summary. Reports observed state only; claims nothing else. */
export function describeHubSafety(assessment: HubSafetyAssessment): {
  readonly degraded: boolean;
  readonly modes: readonly HubSafetyMode[];
  readonly blockedOperations: readonly HubOperationKind[];
  readonly diskBand: HubDiskBand;
  readonly clockLevel: HubClockAnomalyLevel;
  readonly readsPermitted: true;
} {
  const modes = [...new Set(assessment.findings.map((finding) => finding.mode))];
  const blockedOperations = [...new Set(assessment.refusals.map((refusal) => refusal.operation))];
  return {
    degraded: assessment.degraded,
    modes,
    blockedOperations,
    diskBand: assessment.diskBand,
    clockLevel: assessment.clock.level,
    readsPermitted: true,
  };
}

// ---------------------------------------------------------------------------
// Database-backed observation sources
// ---------------------------------------------------------------------------

/**
 * The checksum-registered migration ledger (§4; recorded gap G6). This is the
 * ONLY Hub-side authority on which migrations are applied.
 */
export async function readAppliedMigrations(
  client: HubClient,
): Promise<readonly HubMigrationEntry[]> {
  const result = await client.query<{ filename: string; checksum_sha256: string }>(
    `select filename, checksum_sha256 from edge_ops.migration_journal order by filename`,
  );
  return result.rows.map((row) => ({
    filename: row.filename,
    checksumSha256: row.checksum_sha256,
  }));
}

/**
 * Latest reported NTP offset for a Hub device (§16). Returns `undefined` when no
 * heartbeat carries one — an ABSENT reading is never reported as offset zero.
 */
export async function readReportedClockOffsetSeconds(
  client: HubClient,
  hubDeviceId: string,
): Promise<number | undefined> {
  const result = await client.query<{ offset_seconds: string | null }>(
    `select details_json ->> 'ntp_offset_seconds' as offset_seconds
       from edge_hardware.device_heartbeat
      where device_id = $1 and details_json ? 'ntp_offset_seconds'
      order by observed_at desc
      limit 1`,
    [hubDeviceId],
  );
  const raw = result.rows[0]?.offset_seconds;
  if (raw === null || raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ClockAnomalyEventInput {
  readonly tenantId: string | null;
  readonly digitalStoreId: string | null;
  readonly locationId: string | null;
  readonly hubDeviceId: string;
  readonly offsetSeconds: number;
  readonly level: Exclude<HubClockAnomalyLevel, "none">;
}

/**
 * Record the §16 security/health event for a clock anomaly.
 *
 * Writing evidence is NOT a business mutation, so it is permitted while the Hub
 * is otherwise refusing writes — a safety mode that silently dropped its own
 * evidence would be unauditable.
 */
export async function recordClockAnomalyEvent(
  client: HubClient,
  input: ClockAnomalyEventInput,
): Promise<void> {
  await auditRepo.recordSecurityEvent(client, {
    id: uuidv7(),
    tenantId: input.tenantId,
    digitalStoreId: input.digitalStoreId,
    locationId: input.locationId,
    eventCode: HUB_CLOCK_ANOMALY_EVENT_CODE,
    severity: input.level === "blocking" ? "high" : "medium",
    deviceId: input.hubDeviceId,
    certificateSerial: null,
    details: {
      clock_offset_seconds: input.offsetSeconds,
      level: input.level,
      warning_threshold_seconds: CLOCK_WARNING_OFFSET_SECONDS,
      blocking_threshold_seconds: CLOCK_BLOCKING_OFFSET_SECONDS,
      canonical_code_gap: REQUIRED_CLOCK_ANOMALY_EVENT_CODE,
    },
  });
}
