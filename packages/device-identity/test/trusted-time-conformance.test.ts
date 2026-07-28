/**
 * Cross-layer conformance: TypeScript versus migration group 0123.
 *
 * This test reads the ACTUAL migration file. It is not a restatement of what
 * the SQL is believed to say — that is exactly how WS-10's C34/C35/C36 stayed
 * green while the code contradicted the ruling. If either layer changes a
 * vocabulary, a tolerance or a policy field name without the other, this fails.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TRUSTED_TIME_STATUSES,
  TRUSTED_TIME_SOURCES,
  isRestricted,
  type TrustedTimePolicy,
} from "../src/trusted-time.js";
import { TRUST_ENVIRONMENTS } from "../src/index.js";

const MIGRATIONS_DIR = join(process.cwd(), "..", "..", "supabase", "migrations");

const readMigration = (marker: string): string => {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.includes(marker));
  if (file === undefined) throw new Error(`migration containing "${marker}" not found`);
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
};

const sql0123 = readMigration("0123_trusted_time");
const sql0122 = readMigration("0122_device_trust_decision_alignment");

/** Extracts the members of a `create type ... as enum (...)` block. */
const enumMembers = (source: string, typeName: string): string[] => {
  const match = source.match(new RegExp(`create type ${typeName} as enum \\(([^)]*)\\)`, "i"));
  if (match === null) throw new Error(`enum ${typeName} not found`);
  return [...(match[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
};

describe("trusted-time status vocabulary", () => {
  it("matches kitluy_devices.trusted_time_status exactly, in order", () => {
    const sqlStatuses = enumMembers(sql0123, "kitluy_devices\\.trusted_time_status");
    expect(sqlStatuses).toEqual([...TRUSTED_TIME_STATUSES]);
  });

  it("matches kitluy_devices.trusted_time_source exactly, in order", () => {
    const sqlSources = enumMembers(sql0123, "kitluy_devices\\.trusted_time_source");
    expect(sqlSources).toEqual([...TRUSTED_TIME_SOURCES]);
  });

  it("agrees on which statuses are restricted", () => {
    // The SQL keys its anomaly CHECK off the `restricted%` prefix. TypeScript
    // uses startsWith. Both must classify the same members, or a status could
    // be restricted in one layer and not the other.
    expect(sql0123).toContain("status::text like 'restricted%'");
    const restricted = TRUSTED_TIME_STATUSES.filter(isRestricted);
    expect(restricted).toEqual([
      "restricted_rtc_failure",
      "restricted_clock_rollback",
      "restricted_forward_jump",
      "restricted_no_trusted_source",
    ]);
  });
});

describe("policy field names and tolerances", () => {
  const policyFields: Array<[keyof TrustedTimePolicy, string]> = [
    ["maxClockLagSeconds", "max_clock_lag_seconds"],
    ["maxForwardJumpSeconds", "trusted_time_max_forward_jump_seconds"],
    ["policyVersion", "policy_version"],
    ["signatureVerified", "signature_verified"],
  ];

  it("names every shared policy field in both layers", () => {
    for (const [, column] of policyFields) {
      expect(sql0123).toContain(column);
    }
  });

  it("carries the ruled 300-second rollback tolerance in the SQL default", () => {
    // §12.3 is RULED, so it is a default rather than a required value. If the
    // SQL default ever changes, the TypeScript test policies that mirror it
    // must change too, and this is where that is noticed.
    expect(sql0123).toMatch(/max_clock_lag_seconds integer not null default 300/);
  });

  it("keeps the forward-jump threshold NULLABLE so it fails closed", () => {
    // The owner refused to let this be invented. A NOT NULL with a default
    // would silently authorize every environment.
    expect(sql0123).toMatch(/trusted_time_max_forward_jump_seconds integer,/);
    expect(sql0123).not.toMatch(/trusted_time_max_forward_jump_seconds integer not null/);
  });
});

describe("environment rules", () => {
  it("uses the same three environments in both layers", () => {
    for (const environment of TRUST_ENVIRONMENTS) {
      expect(sql0123).toContain(`'${environment}'`);
    }
    expect(TRUST_ENVIRONMENTS).toEqual(["development", "pilot", "production"]);
  });

  it("creates a DEVELOPMENT trust policy and no pilot or production one", () => {
    const inserts = [...sql0123.matchAll(/insert into kitluy_devices\.trust_policy/gi)];
    expect(inserts).toHaveLength(1);
    expect(sql0123).toMatch(/values\s*\(\s*'development'/);
    expect(sql0123).not.toMatch(/values\s*\(\s*'production'/);
    expect(sql0123).not.toMatch(/values\s*\(\s*'pilot'/);
  });

  it("creates a DEVELOPMENT PKI configuration and no pilot or production one", () => {
    expect(sql0122).toContain("'development',");
    expect(sql0122).not.toMatch(/values\s*\(\s*'production',\s*\n?\s*'kitluy/);
  });

  it("refuses a pilot or production policy that is unsigned", () => {
    expect(sql0123).toContain("KLUY-DEVICE-POLICY-UNSIGNED");
  });

  it("never claims a verified policy signature while no signer exists", () => {
    // Step 6 builds the configuration signer. Until then a verified signature
    // would be a fabrication, and the development row must say so.
    expect(sql0123).toMatch(/signature_verified boolean not null default false/);
  });
});

describe("external error mappings", () => {
  const sharedCodes = [
    "KLUY-DEVICE-TIME-UNTRUSTED",
    "KLUY-DEVICE-TIME-RESTRICTED",
    "KLUY-DEVICE-TIME-ROLLBACK",
    "KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED",
    "KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED",
    "KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED",
  ];

  it("defines every shared refusal code in the SQL layer", () => {
    for (const code of sharedCodes) {
      expect(sql0123).toContain(code);
    }
  });

  it("defines the correction refusal codes identically in TypeScript", () => {
    const ts = readFileSync(join(process.cwd(), "src", "trusted-time.ts"), "utf8");
    for (const code of sharedCodes.filter((c) => c.includes("CORRECTION"))) {
      expect(ts).toContain(code);
    }
    expect(ts).toContain("KLUY-DEVICE-TIME-ROLLBACK");
  });

  it("adds a risk-class refusal that the SQL layer does not yet enforce", () => {
    // Recorded rather than hidden: the TypeScript validator checks the A3/A4
    // risk class, and emergency_time_correction_v1 does NOT — it checks only
    // that an approval id and a distinct approver are present. The database is
    // therefore weaker on this one point, and the gap is owed to the approvals
    // integration rather than being papered over here.
    const ts = readFileSync(join(process.cwd(), "src", "trusted-time.ts"), "utf8");
    expect(ts).toContain("KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS");
    expect(sql0123).not.toContain("KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS");
  });
});

describe("trusted-time module takes no wall clock", () => {
  it("contains no Date.now() or argument-less new Date()", () => {
    const ts = readFileSync(join(process.cwd(), "src", "trusted-time.ts"), "utf8");
    expect(ts).not.toMatch(/Date\.now\s*\(/);
    expect(ts).not.toMatch(/new Date\s*\(\s*\)/);
  });
});

describe("RV-TT-001: SQL and TypeScript agree that uninitialized is not trusted", () => {
  it("the SQL gate refuses the uninitialized status explicitly", () => {
    // assert_trusted_time_v1 raises KLUY-DEVICE-TIME-UNTRUSTED for a device
    // whose status is uninitialized. TypeScript must not be more permissive.
    expect(sql0123).toContain("v_state.status = 'uninitialized'");
    expect(sql0123).toContain("KLUY-DEVICE-TIME-UNTRUSTED");
  });

  it("trustedInstant yields a time ONLY for the trusted status", () => {
    const ts = readFileSync(join(process.cwd(), "src", "certificate-validity.ts"), "utf8");
    expect(ts).toContain('evaluation.status !== "trusted"');
  });
});
