/**
 * Store Hub local database contract surface (WS-09 DDL/tooling half).
 *
 * This module owns the values that MUST agree between the Hub-local DDL
 * (hub/migrations/**), the Hub migration runner (scripts/hub/hub-db.mjs) and
 * the Hub command layer. Everything here is pure and dependency-free: the
 * PostgreSQL adapter itself lands with the command-layer half of WS-09
 * (T002/T003) and is deliberately NOT claimed by this file.
 *
 * Authority:
 *   docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md
 *     §1 conventions, §2 the ten local schemas, §4 migration order/checksums.
 *   docs/source/offline/kitluy-offline-idempotency-and-sequencing-v1.0.0.md
 *     §2 terminal idempotency key, §3 canonical request hash, §19 errors.
 *   docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md
 *     G1 (canonical key format governs), G2 (sync vocabularies), G7 (PG16).
 *
 * LOCAL ONLY: hubDatabaseUrl() refuses a non-local connection string, mirroring
 * packages/payments-persistence/src/db.ts. Production Hub migrations are
 * human-operated and never automatic (KL-INF-P1-037, OWNER-LOCKED).
 */
import { createHash } from "node:crypto";

export const HUB_DB_URL_ENV = "KITLUY_HUB_DB_URL";

/** Development default: a SEPARATE database in the local Postgres instance. */
export const DEFAULT_LOCAL_HUB_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local";

/** Schema contract §2, verbatim and exhaustive. */
export const CANONICAL_EDGE_SCHEMAS = [
  "edge_identity",
  "edge_config",
  "edge_core",
  "edge_laundry",
  "edge_payments",
  "edge_documents",
  "edge_files",
  "edge_sync",
  "edge_hardware",
  "edge_audit",
] as const;
export type CanonicalEdgeSchema = (typeof CANONICAL_EDGE_SCHEMAS)[number];

/**
 * Migration control plane (recorded gap G6). Not one of the ten §2 business
 * schemas; it holds only the checksum-registered migration journal.
 */
export const HUB_MIGRATION_CONTROL_SCHEMA = "edge_ops" as const;

/** Database roles, schema contract §3. */
export const HUB_DATABASE_ROLES = [
  "kitluy_migrator",
  "kitluy_hub_runtime",
  "kitluy_sync_worker",
  "kitluy_backup",
  "kitluy_support_ro",
] as const;

/**
 * Persisted per-event delivery state — the CANONICAL `edge_sync.delivery_state`
 * enum, ALIGNED by hub migration 0015 per owner amendment
 * KLD-2026-07-28-001-A01 §2 (`sending` -> `in_flight`, `blocked` -> `rejected`).
 *
 * TRANSPORT AND CLOUD-PROCESSING LIFECYCLE ONLY. `rejected` means a DURABLE
 * cloud rejection and is never used for a temporary network error, rate
 * limiting, a scheduled retry, an in-progress attempt, a local operator pause
 * or an unverified timeout. `reconciliation_required` is deliberately ABSENT:
 * it lives in the orthogonal conflict dimension below (§3).
 *
 * The array order mirrors the enum's `enumsortorder`; `RENAME VALUE` preserves
 * member OIDs, so the two amended labels sit in their original 0001 positions.
 */
export const EDGE_DELIVERY_STATES = [
  "pending",
  "in_flight",
  "acknowledged",
  "retry_wait",
  "rejected",
  "dead_letter",
] as const;
export type EdgeDeliveryState = (typeof EDGE_DELIVERY_STATES)[number];

/**
 * The ORTHOGONAL conflict/reconciliation dimension (`edge_sync.reconciliation_state`,
 * added by 0015 per amendment §3). A SEPARATE type from
 * {@link EDGE_DELIVERY_STATES} precisely so `reconciliation_required` can never
 * become a delivery state. `cleared` is distinct from `none`: "reconciled by an
 * authorized actor" and "never needed reconciliation" are different facts and
 * only the first has an audit trail.
 */
export const EDGE_RECONCILIATION_STATES = ["none", "required", "cleared"] as const;
export type EdgeReconciliationState = (typeof EDGE_RECONCILIATION_STATES)[number];

/**
 * Command-level sync state (WS-09-T004 truthful-sync-state vocabulary).
 * A DIFFERENT SUBJECT from EDGE_DELIVERY_STATES: this describes what happened
 * to a COMMAND, not to one row's delivery attempt (gap G2 keeps the two apart).
 * WS-09 may only ever record `committed_locally`; `cloud_acknowledged` and
 * `cloud_rejected` belong to WS-10 after a REAL cloud response.
 */
export const HUB_COMMAND_SYNC_STATES = [
  "committed_locally",
  "pending_cloud_sync",
  "cloud_acknowledged",
  "cloud_rejected",
  "reconciliation_required",
] as const;
export type HubCommandSyncState = (typeof HUB_COMMAND_SYNC_STATES)[number];

/**
 * Amendment KLD-2026-07-28-001-A01 §4: "External status is derived by ONE
 * shared mapping function or view ... Services must not maintain divergent
 * mappings."
 *
 * The mapping is owned by `@kitluy/sync-protocol.projectExternalSyncStatus`,
 * the shared package BOTH sides can reach — the Hub reports status to
 * terminals and the cloud reports it to management surfaces. The Hub database
 * expresses the same mapping as this SQL function so it is usable inside views;
 * the two are held equal over the entire delivery x reconciliation cross
 * product by `test/sync-transmission.test.ts`, so changing one without the
 * other fails the build instead of drifting silently.
 *
 * This constant NAMES the SQL side. No module reimplements the mapping a third
 * time — callers read `edge_sync.outbox_status.external_status`, invoke this
 * function, or call the shared TypeScript one.
 */
export const EXTERNAL_SYNC_STATUS_FUNCTION = "edge_sync.external_sync_status" as const;

/** Offline contract §19 error behaviour, as raised by the Hub procedures. */
export const HUB_IDEMPOTENCY_ERRORS = {
  payloadMismatch: "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
  keyMalformed: "EDGE_IDEMPOTENCY_KEY_MALFORMED",
  replayRejected: "EDGE_SEQUENCE_REPLAY_REJECTED",
  sequenceGap: "EDGE_SEQUENCE_GAP",
  versionConflict: "EDGE_AGGREGATE_VERSION_CONFLICT",
  scopeMismatch: "EDGE_SCOPE_MISMATCH",
  terminalUnknown: "EDGE_TERMINAL_UNKNOWN",
} as const;

// ---------------------------------------------------------------------------
// Local-only connection guard (KL-INF-P1-037, OWNER-LOCKED).
// ---------------------------------------------------------------------------
export function hubDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env[HUB_DB_URL_ENV] ?? DEFAULT_LOCAL_HUB_DB_URL;
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `${HUB_DB_URL_ENV} must point at a local development database (KL-INF-P1-037).`,
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Terminal idempotency key — offline contract §2, recorded gap G1.
//
//   kl1.{terminal_device_uuid}.{client_sequence}
//
// The shipped @kitluy/sync-protocol helper emits the NON-CANONICAL
// `location:{id}:hub:{id}:seq:{n}` shape (its comment mis-cites "Hub §8.5,
// verbatim"). The canonical contract governs; correcting the package is
// tracked as KLREQ-020 and is coordinated, not incidental. The Hub DDL CHECKs
// this exact shape, so the non-canonical form cannot be persisted.
// ---------------------------------------------------------------------------
export const CANONICAL_IDEMPOTENCY_KEY_PREFIX = "kl1" as const;

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const CANONICAL_IDEMPOTENCY_KEY_REGEX = new RegExp(`^kl1\\.(${UUID_PATTERN})\\.([0-9]{1,20})$`);

export interface ParsedIdempotencyKey {
  readonly terminalDeviceId: string;
  /** Unsigned 64-bit terminal counter; bigint so 2^53 is not a ceiling. */
  readonly clientSequence: bigint;
}

/**
 * §2 rule 1: `client_sequence` is an unsigned 64-bit integer held in the
 * terminal secure application store; rule 2: it increments BEFORE a mutation
 * is sent; rule 4: a reimage starts a new sequence namespace, it never resets.
 */
export function buildIdempotencyKey(
  terminalDeviceId: string,
  clientSequence: bigint | number,
): string {
  const sequence = typeof clientSequence === "bigint" ? clientSequence : BigInt(clientSequence);
  if (!new RegExp(`^${UUID_PATTERN}$`).test(terminalDeviceId)) {
    throw new Error(`terminalDeviceId must be a UUID, received '${terminalDeviceId}'.`);
  }
  if (sequence < 0n || sequence > 18446744073709551615n) {
    throw new Error("clientSequence must be an unsigned 64-bit integer (offline contract §2).");
  }
  return `${CANONICAL_IDEMPOTENCY_KEY_PREFIX}.${terminalDeviceId}.${sequence.toString()}`;
}

export function isCanonicalIdempotencyKey(key: string): boolean {
  return CANONICAL_IDEMPOTENCY_KEY_REGEX.test(key);
}

export function parseIdempotencyKey(key: string): ParsedIdempotencyKey {
  const match = CANONICAL_IDEMPOTENCY_KEY_REGEX.exec(key);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `${HUB_IDEMPOTENCY_ERRORS.keyMalformed}: '${key}' is not kl1.{terminal_device_uuid}.{client_sequence}.`,
    );
  }
  return { terminalDeviceId: match[1], clientSequence: BigInt(match[2]) };
}

// ---------------------------------------------------------------------------
// Canonical request hash — offline contract §3.
//
//   SHA-256( method \n route template \n RFC8785-canonical JSON body \n
//            terminal_device_id \n session_id \n profile_code )
//
// Volatile transport fields (request_id, retry count, local network address)
// are excluded by construction: they are not inputs to this function.
// ---------------------------------------------------------------------------
export interface CanonicalRequest {
  readonly method: string;
  /** Normalized route TEMPLATE, e.g. "/v1/bookings/{bookingId}/payments". */
  readonly routeTemplate: string;
  readonly body: unknown;
  readonly terminalDeviceId: string;
  readonly sessionId: string;
  /** Canonical dotted logical profile, e.g. "laundry.t1.intake_cashier". */
  readonly profileCode: string;
}

/**
 * RFC 8785 (JCS) canonical JSON, restricted to the value space the LAN API
 * permits: object keys sorted by UTF-16 code unit, no insignificant
 * whitespace, no non-finite numbers. Anything outside that space throws rather
 * than being silently normalized — a hash that quietly accepts ambiguous input
 * would defeat §3.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("Canonical JSON cannot represent NaN or Infinity (RFC 8785).");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      // Money is integer minor units carried as bigint; JSON has no bigint, so
      // the wire form is a decimal string and the caller must convert first.
      throw new Error("Convert bigint to a string before hashing (money contract §4).");
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`Canonical JSON cannot represent ${typeof value}.`);
  }
}

export function canonicalRequestHash(request: CanonicalRequest): string {
  const material = [
    request.method.toUpperCase(),
    request.routeTemplate,
    canonicalJson(request.body),
    request.terminalDeviceId,
    request.sessionId,
    request.profileCode,
  ].join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Migration checksum — schema contract §4 ("Migrations are additive and
// checksum-registered. An applied file is never edited."). The same digest the
// runner journals in edge_ops.migration_journal.
// ---------------------------------------------------------------------------
export function migrationChecksum(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

/** Schema contract §4 migration order, by filename. */
export const HUB_MIGRATION_ORDER = [
  "0000_extensions_and_roles.sql",
  "0001_types_and_helpers.sql",
  "0002_identity.sql",
  "0003_configuration.sql",
  "0004_core.sql",
  "0005_laundry.sql",
  "0006_payments_and_cash.sql",
  "0007_documents_and_print.sql",
  "0008_files.sql",
  "0009_sync.sql",
  "0010_hardware.sql",
  "0011_audit_and_security.sql",
  "0012_indexes_and_constraints.sql",
  "0013_views_and_procedures.sql",
  "0014_seed_reference_profiles.sql",
  // WS-10 (Cycle 9): the ADDITIVE forward migration mandated by owner amendment
  // KLD-2026-07-28-001-A01. 0001 keeps its bytes and its journalled sha256.
  "0015_sync_delivery_state_alignment.sql",
  "0016_sync_outbox_leasing.sql",
  "0017_sync_transmission_batches.sql",
  "0018_hub_effect_keys.sql",
  "0019_sync_delivery_outcomes.sql",
  "0020_revoke_public_execute.sql",
  "0021_cloud_inbox_and_provider_outcomes.sql",
  "0022_signed_grants_and_activation.sql",
  "0023_operator_repair_and_recovery.sql",
  "0024_governed_marker_and_scope_hierarchy.sql",
  "0025_grant_scope_isolation.sql",
  "0026_amendment_projection_and_transitions.sql",
  // WS-11-T003 Step 4: trusted snapshot signing keys and durable persistence
  // of signed revocation snapshots, so a Hub can enforce revocation offline
  // (KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001).
  "0027_revocation_trust_and_snapshot.sql",
  "0028_revocation_reader_least_privilege.sql",
  "0029_offline_device_record_enforcement.sql",
  "0030_governed_snapshot_staging.sql",
] as const;

/**
 * §1 money representation: integer minor units, explicit currency and
 * exponent. KHR exponent 0, USD exponent 2. No floating point, ever
 * (repository rule 12).
 */
export interface HubMoney {
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

export function assertHubMoney(money: HubMoney): void {
  if (typeof money.amountMinor !== "bigint") {
    throw new Error("amountMinor must be a bigint (integer minor units, §1).");
  }
  if (!/^[A-Z]{3}$/.test(money.currencyCode)) {
    throw new Error(
      `currencyCode must be an ISO 4217 alpha-3 code, received '${money.currencyCode}'.`,
    );
  }
  if (
    !Number.isInteger(money.currencyExponent) ||
    money.currencyExponent < 0 ||
    money.currencyExponent > 4
  ) {
    throw new Error("currencyExponent must be an integer between 0 and 4 (§1).");
  }
}
