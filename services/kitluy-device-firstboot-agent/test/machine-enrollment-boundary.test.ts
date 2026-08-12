/**
 * The machine-enrollment boundary (mission §13), clone hygiene (§15) and the
 * heartbeat contract (§16).
 *
 * These are ARCHITECTURAL tests. They assert properties that are easy to
 * destroy with a single convenient import — a Supabase client added "just to
 * read one table" would put a browser-shaped credential on a device that ships
 * to a shop floor, and no unit test of enrollment logic would notice.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { bootstrapIdentity, type FirstbootDeps } from "../src/identity.js";
import {
  runEnrollmentStep,
  type EnrollmentAgentDeps,
  type EnrollmentClient,
  type ServerIdentityVerifier,
} from "../src/enrollment.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");

const SOURCES = ["src/index.ts", "src/identity.ts", "src/enrollment.ts"];

describe("machine-enrollment boundary", () => {
  it("declares no runtime dependencies at all", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  /**
   * Each of these on a device would be a different way of handing a shop-floor
   * appliance an authority it must never hold.
   */
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ["Supabase service-role key", /service[_-]?role/i],
    ["a Supabase client", /@supabase|createClient/i],
    ["a database password", /PGPASSWORD|DATABASE_URL|postgres:\/\//i],
    ["a human auth session", /refresh_token|access_token|signInWith/i],
    ["a shared permanent private key", /BEGIN [A-Z ]*PRIVATE KEY/],
  ];

  for (const [label, pattern] of FORBIDDEN) {
    it(`never references ${label}`, () => {
      for (const file of SOURCES) {
        const body = readFileSync(join(PKG_ROOT, file), "utf8");
        expect(pattern.test(body), `${file} references ${label}`).toBe(false);
      }
    });
  }

  it("reaches the cloud only through an injected EnrollmentClient port", () => {
    // No fetch, no http client, no socket: the transport is supplied by the
    // composition root, so the agent cannot acquire an ungoverned one.
    for (const file of SOURCES) {
      const body = readFileSync(join(PKG_ROOT, file), "utf8");
      expect(/\bfetch\s*\(|node:https?|axios|XMLHttpRequest/.test(body)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Clone hygiene (§15)
// ---------------------------------------------------------------------------

function instance(seed: string) {
  let stored: Parameters<FirstbootDeps["store"]["write"]>[0] | null = null;
  let generated = 0;
  const deps: FirstbootDeps = {
    store: {
      async read() {
        return stored;
      },
      async write(identity) {
        stored = identity;
      },
    },
    keys: {
      async generateKeyPair() {
        generated += 1;
        // A real provider generates fresh material per device; the seed here
        // stands in for "this is a physically different machine".
        return {
          publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${seed}-${generated}\n-----END PUBLIC KEY-----`,
          privateKeyHandle: `${seed}-handle-${generated}`,
        };
      },
      async verifyKeyUsable() {
        return true;
      },
    },
    hardware: {
      async collect() {
        return { macAddress: `b8:27:eb:00:00:${seed}`, boardSerial: `board-${seed}` };
      },
    },
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  };
  return deps;
}

describe("clone hygiene", () => {
  it("two devices imaged from one golden image get DIFFERENT identities", async () => {
    // The failure this guards against is the whole reason the image carries no
    // identity: if a golden image shipped one, every device flashed from it
    // would enrol as the same device and the fleet would be one row.
    const a = await bootstrapIdentity(instance("01"));
    const b = await bootstrapIdentity(instance("02"));

    expect(a.kind).toBe("created");
    expect(b.kind).toBe("created");
    expect(a.identity.publicKeyPem).not.toBe(b.identity.publicKeyPem);
    expect(a.identity.hardwareSignals.macAddress).not.toBe(b.identity.hardwareSignals.macAddress);
  });

  it("a fresh instance carries no device record id, assignment or profile", async () => {
    const a = await bootstrapIdentity(instance("03"));
    expect(a.identity.deviceRecordId).toBeUndefined();
    const serialised = JSON.stringify(a.identity);
    expect(serialised).not.toContain("assignment");
    expect(serialised).not.toContain("terminalProfile");
    expect(serialised).not.toContain("hubEndpoint");
  });
});

// ---------------------------------------------------------------------------
// Heartbeat contract (§16)
// ---------------------------------------------------------------------------

const TRUSTED: ServerIdentityVerifier = {
  async verify() {
    return { trusted: true };
  },
};

describe("heartbeat contract", () => {
  it("reports image version and release channel for an enrolled unassigned device", async () => {
    let captured: unknown;
    const client: EnrollmentClient = {
      async enroll() {
        return { kind: "enrolled", deviceRecordId: "dev-0001" };
      },
      async heartbeat(input) {
        captured = input;
        return { kind: "accepted" };
      },
      async pollAssignment() {
        return { kind: "unassigned" };
      },
    };
    const deps: EnrollmentAgentDeps = {
      client,
      serverIdentity: TRUSTED,
      deviceClass: "terminal",
      osImageVersion: "kitluy-os-0.1.0",
      releaseChannel: "internal",
    };

    const outcome = await runEnrollmentStep(
      deps,
      { publicKeyPem: "pk", hardwareSignals: {} },
      { lifecycleState: "enrolled", deviceRecordId: "dev-0001" },
    );

    expect(outcome.kind).toBe("heartbeat");
    expect(captured).toEqual({
      deviceRecordId: "dev-0001",
      osImageVersion: "kitluy-os-0.1.0",
      releaseChannel: "internal",
    });
  });

  it("carries no Store scope in the heartbeat, ever", async () => {
    let captured: Record<string, unknown> = {};
    const client: EnrollmentClient = {
      async enroll() {
        return { kind: "enrolled", deviceRecordId: "dev-0001" };
      },
      async heartbeat(input) {
        captured = input as unknown as Record<string, unknown>;
        return { kind: "accepted" };
      },
      async pollAssignment() {
        return { kind: "unassigned" };
      },
    };

    await runEnrollmentStep(
      {
        client,
        serverIdentity: TRUSTED,
        deviceClass: "store_hub",
        osImageVersion: "kitluy-os-0.1.0",
        releaseChannel: "internal",
      },
      { publicKeyPem: "pk", hardwareSignals: {} },
      { lifecycleState: "enrolled", deviceRecordId: "dev-0001" },
    );

    for (const forbidden of ["tenantId", "digitalStoreId", "locationId", "hubId"]) {
      expect(Object.keys(captured)).not.toContain(forbidden);
    }
  });

  it("a repeated heartbeat is idempotent from the agent's side", async () => {
    // The agent must not accumulate state across beats: a retry after a
    // timeout has to be indistinguishable from the first attempt.
    const seen: unknown[] = [];
    const client: EnrollmentClient = {
      async enroll() {
        return { kind: "enrolled", deviceRecordId: "dev-0001" };
      },
      async heartbeat(input) {
        seen.push(input);
        return { kind: "accepted" };
      },
      async pollAssignment() {
        return { kind: "unassigned" };
      },
    };
    const deps: EnrollmentAgentDeps = {
      client,
      serverIdentity: TRUSTED,
      deviceClass: "terminal",
      osImageVersion: "kitluy-os-0.1.0",
      releaseChannel: "internal",
    };
    const position = { lifecycleState: "enrolled" as const, deviceRecordId: "dev-0001" };

    const first = await runEnrollmentStep(
      deps,
      { publicKeyPem: "pk", hardwareSignals: {} },
      position,
    );
    const second = await runEnrollmentStep(
      deps,
      { publicKeyPem: "pk", hardwareSignals: {} },
      position,
    );

    expect(seen[0]).toEqual(seen[1]);
    expect(first).toEqual(second);
  });
});
