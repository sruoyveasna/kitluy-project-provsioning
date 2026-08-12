/**
 * The preflight reads that protect a card before a ticket is spent.
 *
 * Both of these exist because of failures observed against a real database,
 * not because they seemed prudent:
 *
 *   - resolving a hardware profile inside the door's ARGUMENT list evaluates
 *     the subselect in the CALLER's context, so it demanded a table read that
 *     `kitluy_fleet_service` does not have, and the tool died with
 *     `permission denied for table hardware_profiles`;
 *   - defaulting the station key to the hostname produced
 *     `UNREGISTERED_ENROLLMENT_STATION` and a QUARANTINED device — after the
 *     single-use ticket had already been consumed.
 */
import { describe, expect, it } from "vitest";

import { parseArguments } from "../src/bin/prepare-card.js";
import { readEnrollmentStation, resolveHardwareProfileId } from "../src/factory-gateway.js";
import type { DatabaseHandle } from "../src/factory-gateway.js";

function dbReturning(rows: Record<string, unknown>[]): DatabaseHandle {
  return { query: () => Promise.resolve({ rows: rows as never[] }) };
}

describe("hardware profile resolution", () => {
  it("returns the id of an active profile", async () => {
    const id = await resolveHardwareProfileId(
      dbReturning([{ id: "1c3770b6-18d3-48a4-aa91-5f4ae7ddeb2a" }]),
      "KL-PI5-TERMINAL",
    );
    expect(id).toBe("1c3770b6-18d3-48a4-aa91-5f4ae7ddeb2a");
  });

  it("returns null for an unknown or inactive profile rather than a null id", async () => {
    // Passing null onward would reach the door as a null uuid and refuse there,
    // telling the operator issuance failed instead of that the key was wrong.
    expect(await resolveHardwareProfileId(dbReturning([]), "NOPE")).toBeNull();
  });

  it("filters on is_active in SQL, not in the caller", async () => {
    let seenSql = "";
    await resolveHardwareProfileId(
      {
        query: (sql: string) => {
          seenSql = sql;
          return Promise.resolve({ rows: [] as never[] });
        },
      },
      "KL-PI5-TERMINAL",
    );
    expect(seenSql).toContain("is_active");
  });
});

describe("enrollment station preflight", () => {
  it("reports an unregistered station as unregistered, not as an error", async () => {
    const facts = await readEnrollmentStation(dbReturning([]), "station/laptop");
    expect(facts).toEqual({ registered: false, status: null, environment: null });
  });

  it("carries back status and environment so the caller can judge both", async () => {
    const facts = await readEnrollmentStation(
      dbReturning([{ status: "quarantined", environment: "development" }]),
      "STATION-1",
    );
    expect(facts.registered).toBe(true);
    expect(facts.status).toBe("quarantined");
    expect(facts.environment).toBe("development");
  });

  it("looks the station up by key", async () => {
    let params: readonly unknown[] = [];
    await readEnrollmentStation(
      {
        query: (_sql: string, p: readonly unknown[] = []) => {
          params = p;
          return Promise.resolve({ rows: [] as never[] });
        },
      },
      "STATION-WORKSHOP-1",
    );
    expect(params).toEqual(["STATION-WORKSHOP-1"]);
  });
});

describe("station tool arguments", () => {
  it("parses the documented flags", () => {
    expect(
      parseArguments([
        "--card",
        "/media/veasna/rootfs",
        "--profile",
        "KL-PI5-TERMINAL",
        "--station",
        "STATION-WORKSHOP-1",
      ]),
    ).toEqual({
      card: "/media/veasna/rootfs",
      profile: "KL-PI5-TERMINAL",
      station: "STATION-WORKSHOP-1",
    });
  });

  it("ignores a trailing flag with no value rather than reading the next flag as one", () => {
    // `--card --profile X` must not silently set card to "--profile".
    const parsed = parseArguments(["--card"]);
    expect(parsed.card).toBeUndefined();
  });
});
