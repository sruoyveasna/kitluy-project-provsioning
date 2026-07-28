/**
 * Store Hub local database contract tests (WS-09 DDL/tooling half).
 *
 * These assert the values that MUST agree between the Hub-local DDL
 * (hub/migrations/**), the migration runner (scripts/hub/hub-db.mjs) and the
 * Hub command layer. The DDL side is asserted separately in SQL by
 * hub/tests/assertions.sql via `pnpm hub:db:test`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_EDGE_SCHEMAS,
  DEFAULT_LOCAL_HUB_DB_URL,
  EDGE_DELIVERY_STATES,
  EDGE_RECONCILIATION_STATES,
  EXTERNAL_SYNC_STATUS_FUNCTION,
  HUB_COMMAND_SYNC_STATES,
  HUB_DATABASE_ROLES,
  HUB_DB_URL_ENV,
  HUB_IDEMPOTENCY_ERRORS,
  HUB_MIGRATION_ORDER,
  assertHubMoney,
  buildIdempotencyKey,
  canonicalJson,
  canonicalRequestHash,
  hubDatabaseUrl,
  isCanonicalIdempotencyKey,
  migrationChecksum,
  parseIdempotencyKey,
} from "../src/hub-database.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "hub", "migrations");

describe("local-only connection guard (KL-INF-P1-037)", () => {
  it("defaults to the separate local Hub database", () => {
    expect(hubDatabaseUrl({})).toBe(DEFAULT_LOCAL_HUB_DB_URL);
    expect(DEFAULT_LOCAL_HUB_DB_URL).toContain("kitluy_hub_local");
  });

  it("accepts an explicit local override", () => {
    const url = "postgresql://postgres:postgres@localhost:54322/kitluy_hub_local";
    expect(hubDatabaseUrl({ [HUB_DB_URL_ENV]: url })).toBe(url);
  });

  it("refuses a non-local target", () => {
    expect(() =>
      hubDatabaseUrl({ [HUB_DB_URL_ENV]: "postgresql://hub@hub.prod.example:5432/kitluy_hub" }),
    ).toThrow(/local development database/);
  });
});

describe("canonical idempotency key (offline contract §2, gap G1)", () => {
  const terminal = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1";

  it("builds the canonical kl1 shape", () => {
    // The verbatim example from offline contract §2.
    expect(buildIdempotencyKey(terminal, 8821n)).toBe(
      "kl1.0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1.8821",
    );
  });

  it("round-trips through parse", () => {
    const key = buildIdempotencyKey(terminal, 18446744073709551615n);
    const parsed = parseIdempotencyKey(key);
    expect(parsed.terminalDeviceId).toBe(terminal);
    // Unsigned 64-bit: 2^53 must not be a ceiling.
    expect(parsed.clientSequence).toBe(18446744073709551615n);
  });

  it("rejects the NON-CANONICAL @kitluy/sync-protocol shape (KLREQ-020)", () => {
    const legacy =
      "location:e0000000-0000-4000-8000-000000000003:hub:e0000000-0000-4000-8000-000000000010:seq:7";
    expect(isCanonicalIdempotencyKey(legacy)).toBe(false);
    expect(() => parseIdempotencyKey(legacy)).toThrow(HUB_IDEMPOTENCY_ERRORS.keyMalformed);
  });

  it("rejects malformed keys", () => {
    expect(isCanonicalIdempotencyKey("kl1.not-a-uuid.1")).toBe(false);
    expect(isCanonicalIdempotencyKey(`kl2.${terminal}.1`)).toBe(false);
    expect(isCanonicalIdempotencyKey(`kl1.${terminal}.`)).toBe(false);
    expect(isCanonicalIdempotencyKey(`kl1.${terminal}.-1`)).toBe(false);
    expect(() => buildIdempotencyKey("not-a-uuid", 1n)).toThrow(/must be a UUID/);
    expect(() => buildIdempotencyKey(terminal, -1n)).toThrow(/unsigned 64-bit/);
  });

  it("matches the CHECK constraint pattern used by the Hub DDL", () => {
    const helper = readFileSync(join(MIGRATIONS_DIR, "0001_types_and_helpers.sql"), "utf8");
    expect(helper).toContain("is_canonical_idempotency_key");
    expect(helper).toContain("^kl1\\.");
    // Every relation that stores a key must CHECK it.
    const withKeys = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    const columnCount = (withKeys.match(/^\s+idempotency_key\s+text/gm) ?? []).length;
    const checkCount = (withKeys.match(/is_canonical_idempotency_key\(idempotency_key\)/g) ?? [])
      .length;
    expect(columnCount).toBeGreaterThanOrEqual(5);
    expect(checkCount).toBe(columnCount);
  });
});

describe("canonical request hash (offline contract §3)", () => {
  const base = {
    method: "post",
    routeTemplate: "/v1/bookings/{bookingId}/payments",
    body: { amount_minor: "3000", currency_code: "USD", currency_exponent: 2 },
    terminalDeviceId: "e0000000-0000-4000-8000-000000000020",
    sessionId: "e0000000-0000-4000-8000-000000000030",
    profileCode: "laundry.t1.intake_cashier",
  };

  it("produces a lowercase-hex sha256 the DDL char(64) CHECK accepts", () => {
    expect(canonicalRequestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key order and HTTP method casing", () => {
    const reordered = {
      ...base,
      method: "POST",
      body: { currency_exponent: 2, currency_code: "USD", amount_minor: "3000" },
    };
    expect(canonicalRequestHash(reordered)).toBe(canonicalRequestHash(base));
  });

  it("changes when the business payload changes (§19 payload mismatch)", () => {
    const tampered = { ...base, body: { ...base.body, amount_minor: "1" } };
    expect(canonicalRequestHash(tampered)).not.toBe(canonicalRequestHash(base));
  });

  it("changes when the actor context changes", () => {
    expect(canonicalRequestHash({ ...base, profileCode: "laundry.t4.pickup_scan_out" })).not.toBe(
      canonicalRequestHash(base),
    );
    expect(
      canonicalRequestHash({ ...base, sessionId: "e0000000-0000-4000-8000-000000000033" }),
    ).not.toBe(canonicalRequestHash(base));
  });

  it("excludes volatile transport fields by construction", () => {
    // request_id, retry count and local address are simply not inputs.
    expect(Object.keys(base).sort()).toEqual([
      "body",
      "method",
      "profileCode",
      "routeTemplate",
      "sessionId",
      "terminalDeviceId",
    ]);
  });

  it("canonicalises JSON per RFC 8785 and refuses ambiguous values", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
    expect(() => canonicalJson(Number.NaN)).toThrow(/NaN or Infinity/);
    expect(() => canonicalJson({ amount: 1n })).toThrow(/bigint/);
  });
});

describe("migration set (schema contract §4)", () => {
  it("lists exactly the canonical §4 order and nothing else", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(onDisk).toEqual([...HUB_MIGRATION_ORDER]);
  });

  it("computes the same checksum the runner journals", () => {
    const first = HUB_MIGRATION_ORDER[0];
    const contents = readFileSync(join(MIGRATIONS_DIR, first), "utf8");
    expect(migrationChecksum(contents)).toMatch(/^[0-9a-f]{64}$/);
    expect(migrationChecksum(contents)).toBe(migrationChecksum(contents));
    expect(migrationChecksum(`${contents}\n-- edited`)).not.toBe(migrationChecksum(contents));
  });

  it("creates the ten canonical §2 schemas and no other business schema", () => {
    const extensions = readFileSync(join(MIGRATIONS_DIR, "0000_extensions_and_roles.sql"), "utf8");
    for (const schema of CANONICAL_EDGE_SCHEMAS) {
      expect(extensions).toContain(`create schema if not exists ${schema};`);
    }
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    // Recorded gaps G5 and G8: these are NOT canonical schemas.
    for (const rejected of ["edge_finance", "edge_commands", "edge_events", "edge_print"]) {
      expect(all).not.toContain(`create schema if not exists ${rejected}`);
    }
  });

  it("declares every §3 database role", () => {
    const extensions = readFileSync(join(MIGRATIONS_DIR, "0000_extensions_and_roles.sql"), "utf8");
    for (const role of HUB_DATABASE_ROLES) {
      expect(extensions).toContain(role);
    }
  });

  it("uses no PostgreSQL 16-only feature (recorded gap G7: dev runs 15.8)", () => {
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n")
      .toLowerCase();
    for (const pg16Only of [
      "any_value(",
      "json_array(",
      "json_object(",
      "pg_maintain",
      "sql_body",
    ]) {
      expect(all).not.toContain(pg16Only);
    }
  });

  it("uses no floating-point or `money` column type (repository rule 12)", () => {
    const all = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    expect(all).not.toMatch(/\b(float4|float8|double\s+precision)\b/i);
    expect(all).not.toMatch(/^\s+\w+\s+money\b/im);
  });
});

describe("sync vocabularies (recorded gap G2)", () => {
  it("keeps the persisted delivery state exactly as amendment A01 §2 aligns it", () => {
    expect([...EDGE_DELIVERY_STATES]).toEqual([
      "pending",
      "in_flight",
      "acknowledged",
      "retry_wait",
      "rejected",
      "dead_letter",
    ]);
  });

  it("keeps reconciliation_required OUT of the delivery dimension (amendment §3)", () => {
    expect(EDGE_DELIVERY_STATES as readonly string[]).not.toContain("reconciliation_required");
    expect([...EDGE_RECONCILIATION_STATES]).toEqual(["none", "required", "cleared"]);
    const overlap = EDGE_RECONCILIATION_STATES.filter((s) =>
      (EDGE_DELIVERY_STATES as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it("aligns the enum by an ADDITIVE forward migration, never by editing 0001", () => {
    const applied = readFileSync(join(MIGRATIONS_DIR, "0001_types_and_helpers.sql"), "utf8");
    // 0001 is APPLIED and checksum-registered (§4): its bytes still carry the
    // pre-amendment labels, and that is the correct outcome.
    expect(applied).toContain("'pending','sending','acknowledged','retry_wait','blocked'");
    const alignment = readFileSync(
      join(MIGRATIONS_DIR, "0015_sync_delivery_state_alignment.sql"),
      "utf8",
    );
    expect(alignment).toContain("rename value 'sending' to 'in_flight'");
    expect(alignment).toContain("rename value 'blocked' to 'rejected'");
    expect(alignment).not.toMatch(/alter\s+type\s+edge_sync\.delivery_state\s+add\s+value/i);
  });

  it("keeps ONE shared external-status mapping with conflict override first", () => {
    const alignment = readFileSync(
      join(MIGRATIONS_DIR, "0015_sync_delivery_state_alignment.sql"),
      "utf8",
    );
    expect(EXTERNAL_SYNC_STATUS_FUNCTION).toBe("edge_sync.external_sync_status");
    expect(alignment).toContain("create function edge_sync.external_sync_status");
    // Conflict override is evaluated BEFORE any delivery-state branch.
    const body = alignment.slice(
      alignment.indexOf("create function edge_sync.external_sync_status"),
    );
    const conflictBranch = body.indexOf("p_reconciliation_state = 'required'");
    const firstDeliveryBranch = body.indexOf("p_delivery_state =");
    expect(conflictBranch).toBeGreaterThan(-1);
    expect(conflictBranch).toBeLessThan(firstDeliveryBranch);
    // The projection reuses the approved five-value registry; no sixth value.
    for (const status of [
      "reconciliation_required",
      "cloud_acknowledged",
      "cloud_rejected",
      "pending_cloud_sync",
    ]) {
      expect(HUB_COMMAND_SYNC_STATES as readonly string[]).toContain(status);
    }
  });

  it("keeps the command sync state a DIFFERENT, non-overlapping subject", () => {
    const overlap = HUB_COMMAND_SYNC_STATES.filter((s) =>
      (EDGE_DELIVERY_STATES as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
    expect(HUB_COMMAND_SYNC_STATES).toContain("pending_cloud_sync");
  });

  it("never fabricates a cloud acknowledgement in the DDL", () => {
    const sync = readFileSync(join(MIGRATIONS_DIR, "0009_sync.sql"), "utf8");
    expect(sync).toContain("outbox_ack_ck");
    expect(sync).toContain("cloud_ack_id is not null");
  });
});

describe("money contract (§1; repository rule 12)", () => {
  it("accepts integer minor units with an explicit currency and exponent", () => {
    expect(() =>
      assertHubMoney({ amountMinor: 3000n, currencyCode: "USD", currencyExponent: 2 }),
    ).not.toThrow();
    expect(() =>
      assertHubMoney({ amountMinor: 12000n, currencyCode: "KHR", currencyExponent: 0 }),
    ).not.toThrow();
  });

  it("refuses anything that is not integer minor units", () => {
    expect(() =>
      assertHubMoney({
        amountMinor: 30.5 as unknown as bigint,
        currencyCode: "USD",
        currencyExponent: 2,
      }),
    ).toThrow(/bigint/);
    expect(() =>
      assertHubMoney({ amountMinor: 1n, currencyCode: "usd", currencyExponent: 2 }),
    ).toThrow(/alpha-3/);
    expect(() =>
      assertHubMoney({ amountMinor: 1n, currencyCode: "USD", currencyExponent: 9 }),
    ).toThrow(/between 0 and 4/);
  });
});
