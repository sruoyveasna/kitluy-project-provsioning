/**
 * Shared command-layer helpers.
 *
 * Values that are genuinely unknown stay `[REQUIRED: ...]` and are NEVER
 * guessed (repository rule 9): the Location display code and the Store currency
 * are read from the ACTIVE signed configuration snapshot or supplied explicitly,
 * and a missing value refuses the command instead of defaulting.
 */
import type { CurrencyCode } from "@kitluy/money";
import type { HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";
import { configRepo } from "../repositories/index.js";

export const REQUIRED_LOCATION_CODE =
  "[REQUIRED: cloud-assigned immutable LOCATION_CODE (3-8 chars, Appendix B display profile) — the Hub-local schema carries no location_code column and the active configuration snapshot's fixture sections do not publish one]";

export interface StoreMoneyContract {
  readonly currencyCode: CurrencyCode;
  readonly currencyExponent: number;
  readonly snapshotId: string;
  readonly snapshotVersion: bigint;
}

/**
 * Money representation for the Location, taken from the ACTIVE configuration
 * snapshot's `pricing` section (§1: `amount_minor` + `currency_code` +
 * `currency_exponent`; KHR exponent 0, USD exponent 2).
 */
export async function loadStoreMoneyContract(
  client: HubClient,
  locationId: string,
): Promise<StoreMoneyContract> {
  const active = await configRepo.findActiveConfiguration(client, locationId);
  if (!active) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `Location ${locationId} has no ACTIVE configuration snapshot; the Hub refuses to price without one.`,
      { locationId },
    );
  }
  const pricing = await configRepo.findConfigurationSection(client, active.snapshot_id, "pricing");
  if (!pricing) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `configuration snapshot ${active.snapshot_id} publishes no 'pricing' section.`,
      { snapshotId: active.snapshot_id },
    );
  }
  const currencyCode = pricing.content_json["currency_code"];
  const currencyExponent = pricing.content_json["currency_exponent"];
  if (typeof currencyCode !== "string" || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      "the 'pricing' configuration section carries no ISO-4217 currency_code.",
    );
  }
  if (typeof currencyExponent !== "number" || !Number.isInteger(currencyExponent)) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      "the 'pricing' configuration section carries no integer currency_exponent (§1).",
    );
  }
  return {
    currencyCode: currencyCode as CurrencyCode,
    currencyExponent,
    snapshotId: active.snapshot_id,
    snapshotVersion: active.snapshot_version,
  };
}

/**
 * Refuse rather than guess a display code (Appendix B).
 *
 * SHAPE (KLREC-2026-09-21-LOCATION-CODE-SHAPE-001, recorded not silently
 * resolved): Appendix B bounds the code at 3-8 alphanumerics, while the
 * owner-approved money contract (KLD-2026-09-19-T1-REAL-OPERATIONS-001
 * decision 3) names `store_locations.location_code` — `DEMO-PP-01` on the
 * development Store — as THE code in `KLB-{LOCATION_CODE}-{YYMMDD}-{SEQ}`.
 * The later, more specific owner decision wins for the code's SOURCE; this
 * check accepts that cloud shape (uppercase alphanumerics and hyphens, 3-16,
 * never starting or ending on a hyphen) and still refuses anything else.
 * `edge_core.format_display_number` upper-cases and never re-validates.
 */
export function requireLocationCode(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{1,14})?[A-Za-z0-9]$/.test(value) ||
    value.length < 3
  ) {
    throw new HubCommandError("EDGE_REQUIRED_VALUE_MISSING", REQUIRED_LOCATION_CODE, {
      field: "location_code",
    });
  }
  return value;
}

/** Optimistic concurrency: a stale expected version writes NOTHING (offline §6). */
export function assertExpectedVersion(actual: bigint, expected: bigint, aggregateId: string): void {
  if (actual !== expected) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `aggregate ${aggregateId} is at version ${actual}, expected ${expected}.`,
      { aggregateId, actual: actual.toString(), expected: expected.toString() },
    );
  }
}

/** Money crossing the wire is a decimal STRING; never a JavaScript number (§1). */
export function minorUnitsToString(value: bigint): string {
  return value.toString();
}

export function requireBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return BigInt(value);
  throw new HubCommandError(
    "EDGE_REQUIRED_VALUE_MISSING",
    `'${field}' must be integer minor units (bigint or decimal string), never a floating-point number.`,
    { field },
  );
}
