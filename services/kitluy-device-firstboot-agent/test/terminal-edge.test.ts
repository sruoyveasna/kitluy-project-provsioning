/**
 * The Pi Terminal's Store Hub link, judged by what an operator would be told.
 *
 * Every case here is a state a real shop reaches: the terminal is not activated
 * yet, nothing answers, something answers that is not this Store's Hub, the Hub
 * answers but does not hold this terminal, and the Hub serves. Each must leave
 * a status file saying which, because that file is the only thing the Device
 * Shell can see — it cannot read the operational key that produced it.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildServiceQuery, collectCandidates } from "../src/edge-mdns.js";
import { checkRecord, type SignedDiscoveryPayload } from "../src/edge-discovery-record.js";
import { runEdgeAttempt, type EdgeStatus } from "../src/edge-session.js";
import { readTransportCredentials } from "../src/edge-transport.js";

const FINGERPRINT = "a".repeat(64);
const HUB_ID = "75cfc61f-219e-4f1e-8f42-fa46c056a292";

function workspace(): { dir: string; operationalDir: string; statusPath: string; lastPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-edge-"));
  const operationalDir = join(dir, "operational");
  mkdirSync(operationalDir, { recursive: true });
  return {
    dir,
    operationalDir,
    statusPath: join(dir, "terminal", "edge-status.json"),
    lastPath: join(dir, "terminal", "last-hub-endpoint.json"),
  };
}

function writeCredentials(dir: string): void {
  for (const name of ["operational-tls.crt.pem", "operational-tls.key.pem", "operational-tls.chain.pem"]) {
    writeFileSync(join(dir, name), "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n");
  }
}

function payload(overrides: Partial<SignedDiscoveryPayload["record"]> = {}): SignedDiscoveryPayload {
  const now = Date.now();
  return {
    record: {
      protocolVersion: "kitluy.edge-discovery.v1",
      recordId: "4691b455-6b51-4850-984b-88c3daa4d33a",
      hubDeviceId: HUB_ID,
      hubCertificateFingerprint: FINGERPRINT,
      tenantId: "00000000-0000-4000-8000-000000000011",
      digitalStoreId: "00000000-0000-4000-8000-000000000015",
      storeLocationId: "00000000-0000-4000-8000-000000000018",
      environment: "development",
      hostname: "pi5-wzbnes.local",
      port: 7443,
      issuedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      ...overrides,
    },
    signature: "AAAA",
    signatureAlgorithm: "ed25519",
  };
}

function readStatus(path: string): EdgeStatus {
  return JSON.parse(readFileSync(path, "utf8")) as EdgeStatus;
}

describe("the discovery record is judged against the connection, not just itself", () => {
  it("accepts a record whose fingerprint is the certificate actually presented", () => {
    const verdict = checkRecord(
      payload(),
      { environment: "development", observedCertificateFingerprint: FINGERPRINT },
      new Date(),
    );
    expect(verdict.accepted).toBe(true);
    // The signature is NEVER reported as verified: the Hub's public key is not
    // delivered to terminals yet (BLK-006), and silence is not a pass.
    expect(verdict.signature).toBe("unverified");
  });

  it("refuses a record replayed from a different Hub", () => {
    const verdict = checkRecord(
      payload(),
      { environment: "development", observedCertificateFingerprint: "b".repeat(64) },
      new Date(),
    );
    expect(verdict.refusalCode).toBe("DISCOVERY_CERTIFICATE_MISMATCH");
  });

  it("refuses a Hub in a different environment", () => {
    const verdict = checkRecord(
      payload({ environment: "production" }),
      { environment: "development", observedCertificateFingerprint: FINGERPRINT },
      new Date(),
    );
    expect(verdict.refusalCode).toBe("DISCOVERY_WRONG_ENVIRONMENT");
  });

  it("refuses an expired record", () => {
    const stale = payload({
      issuedAt: new Date(Date.now() - 600_000).toISOString(),
      expiresAt: new Date(Date.now() - 300_000).toISOString(),
    });
    const verdict = checkRecord(
      stale,
      { environment: "development", observedCertificateFingerprint: FINGERPRINT },
      new Date(),
    );
    expect(verdict.refusalCode).toBe("DISCOVERY_EXPIRED");
  });

  it("refuses another Store's Hub when the terminal knows its own scope", () => {
    const verdict = checkRecord(
      payload(),
      {
        environment: "development",
        observedCertificateFingerprint: FINGERPRINT,
        tenantId: "00000000-0000-4000-8000-000000000011",
        digitalStoreId: "00000000-0000-4000-8000-000000000015",
        storeLocationId: "ffffffff-0000-4000-8000-000000000018",
      },
      new Date(),
    );
    expect(verdict.refusalCode).toBe("DISCOVERY_WRONG_SCOPE");
    expect(verdict.scopeChecked).toBe(true);
  });

  it("says so when it could not check the scope, rather than implying it passed", () => {
    const verdict = checkRecord(
      payload(),
      { environment: "development", observedCertificateFingerprint: FINGERPRINT },
      new Date(),
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.scopeChecked).toBe(false);
  });
});

describe("mDNS", () => {
  it("asks a PTR question for the one service type a Hub advertises", () => {
    const query = buildServiceQuery();
    expect(query.readUInt16BE(4)).toBe(1);
    expect(query.includes(Buffer.from("_kitluy-edge", "utf8"))).toBe(true);
  });

  it("finds nothing in an empty answer rather than throwing", () => {
    expect(collectCandidates([])).toEqual([]);
    expect(collectCandidates([Buffer.alloc(4)])).toEqual([]);
  });
});

describe("one attempt, and the status an operator is left with", () => {
  it("reports NOT_ACTIVATED when no certificate has been adopted", async () => {
    const w = workspace();
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([]),
    });
    expect(status.phase).toBe("NOT_ACTIVATED");
    expect(readStatus(w.statusPath).phase).toBe("NOT_ACTIVATED");
  });

  it("reports NO_HUB_FOUND when nothing answers", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([]),
    });
    expect(status.phase).toBe("NO_HUB_FOUND");
  });

  it("reports NOT_RECOGNIZED — the projection gap — as its own state", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) =>
        Promise.resolve(
          input.path.startsWith("/.well-known")
            ? { status: 200, body: payload(), peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID }
            : {
                status: 403,
                body: { error: { code: "DEVICE_NOT_ASSIGNED", details: { result: "TERMINAL_NOT_RECOGNIZED" } } },
                peerCertificateFingerprint: FINGERPRINT,
                peerDeviceId: HUB_ID,
              },
        ),
    });
    expect(status.phase).toBe("NOT_RECOGNIZED");
    expect(status.hub?.hubDeviceId).toBe(HUB_ID);
  });

  it("reports SERVING and remembers the endpoint when the Hub answers the bootstrap reads", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) =>
        Promise.resolve({
          status: 200,
          body: input.path.startsWith("/.well-known") ? payload() : { ok: true },
          peerCertificateFingerprint: FINGERPRINT,
          peerDeviceId: HUB_ID,
        }),
    });
    expect(status.phase).toBe("SERVING");
    expect(status.reads).toEqual({ authorityTime: "ok", eligibility: "ok", configuration: "ok" });
    expect(JSON.parse(readFileSync(w.lastPath, "utf8"))).toEqual({ host: "10.0.0.5", port: 7443 });
  });

  it("pins the discovered certificate on every call after discovery", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const pins: (string | undefined)[] = [];
    await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) => {
        pins.push(input.pinnedCertificateFingerprint);
        return Promise.resolve({
          status: 200,
          body: input.path.startsWith("/.well-known") ? payload() : { ok: true },
          peerCertificateFingerprint: FINGERPRINT,
          peerDeviceId: HUB_ID,
        });
      },
    });
    expect(pins[0]).toBeUndefined();
    expect(pins.slice(1)).toEqual([FINGERPRINT, FINGERPRINT, FINGERPRINT]);
  });

  it("separates a Hub-side dependency (DEGRADED) from a refusal aimed at this terminal", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) => {
        if (input.path.startsWith("/.well-known")) {
          return Promise.resolve({ status: 200, body: payload(), peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID });
        }
        if (input.path.endsWith("/configuration/current")) {
          return Promise.resolve({
            status: 503,
            body: { error: { code: "DEPENDENCY_UNAVAILABLE", details: { result: "DELIVERY_SIGNER_UNAVAILABLE" } } },
            peerCertificateFingerprint: FINGERPRINT,
            peerDeviceId: HUB_ID,
          });
        }
        return Promise.resolve({ status: 200, body: { ok: true }, peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID });
      },
    });
    expect(status.phase).toBe("DEGRADED");
    expect(status.reads?.configuration).toContain("DELIVERY_SIGNER_UNAVAILABLE");
    // Reached, so the endpoint is worth remembering even though it is degraded.
    expect(JSON.parse(readFileSync(w.lastPath, "utf8"))).toEqual({ host: "10.0.0.5", port: 7443 });
  });

  it("does not guess a profile when the terminal holds none", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) =>
        Promise.resolve(
          input.path.startsWith("/.well-known")
            ? { status: 200, body: payload(), peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID }
            : input.path.endsWith("/eligibility")
              ? {
                  status: 403,
                  body: { error: { code: "DEVICE_NOT_ASSIGNED", details: { result: "PAIRING_REQUIRED" } } },
                  peerCertificateFingerprint: FINGERPRINT,
                  peerDeviceId: HUB_ID,
                }
              : { status: 200, body: { ok: true }, peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID },
        ),
    });
    expect(status.phase).toBe("PAIRING_REFUSED");
    expect(status.detail).toContain("no assigned profile");
  });

  it("pairs when the Hub says PAIRING_REQUIRED and a profile is held", async () => {
    const w = workspace();
    writeCredentials(w.operationalDir);
    let paired = false;
    const paths: string[] = [];
    const status = await runEdgeAttempt({
      environment: "development",
      operationalDir: w.operationalDir,
      statusPath: w.statusPath,
      lastEndpointPath: w.lastPath,
      profileCodes: ["laundry.t1.intake_cashier"],
      identityKeyPath: join(w.dir, "missing-key.pem"),
      discover: () => Promise.resolve([{ host: "10.0.0.5", port: 7443, instance: "hub" }]),
      requestFn: (input) => {
        paths.push(input.path);
        if (input.path.startsWith("/.well-known")) {
          return Promise.resolve({ status: 200, body: payload(), peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID });
        }
        if (input.path.endsWith("/eligibility") && !paired) {
          return Promise.resolve({
            status: 403,
            body: { error: { code: "DEVICE_NOT_ASSIGNED", details: { result: "PAIRING_REQUIRED" } } },
            peerCertificateFingerprint: FINGERPRINT,
            peerDeviceId: HUB_ID,
          });
        }
        if (input.path === "/edge/v1/terminal-pairing/sessions") {
          return Promise.resolve({
            status: 201,
            body: {
              session: {
                pairingSessionId: "11111111-2222-4333-8444-555555555555",
                signingPayload: Buffer.from("bytes-to-sign", "utf8").toString("base64url"),
                terminalProfileKey: "laundry.t1.intake_cashier",
              },
            },
            peerCertificateFingerprint: FINGERPRINT,
            peerDeviceId: HUB_ID,
          });
        }
        return Promise.resolve({ status: 200, body: { ok: true }, peerCertificateFingerprint: FINGERPRINT, peerDeviceId: HUB_ID });
      },
    });
    // The key is absent, so pairing must refuse with a named cause rather than
    // throwing — a terminal missing its identity key is a state, not a crash.
    expect(status.phase).toBe("PAIRING_REFUSED");
    expect(status.pairing?.result).toBe("IDENTITY_KEY_UNAVAILABLE");
    expect(paths.some((p) => p.includes("terminal-pairing/sessions"))).toBe(true);
  });

  it("treats missing operational material as waiting, not as a fault", () => {
    const w = workspace();
    const outcome = readTransportCredentials(w.operationalDir);
    expect(outcome.available).toBe(false);
  });
});

/**
 * THE STATUS FILE MUST BE READABLE BY THE DEVICE SHELL.
 *
 * `kitluy-terminal-edge.service` runs with `UMask=0077`. `writeFileSync`'s
 * `mode` option is masked by the umask, so the deliberate 0644 arrived as 0600
 * root-only on every real device — the Shell (running as `kitluy-terminal`)
 * could not read the phase it exists to display, and acceptance tooling read
 * `{}` and reported `unreported` instead of SERVING.
 *
 * The umask is set here rather than asserted about indirectly, because the
 * defect is invisible under the default 0022: 0644 & ~0022 is still 0644, so a
 * test that does not restrict the umask passes against the broken code.
 */
describe("the edge status file survives a restrictive umask", () => {
  it("is world-readable even when the umask would strip that", async () => {
    const previous = process.umask(0o077);
    try {
      const paths = workspace();
      writeCredentials(paths.operationalDir);
      await runEdgeAttempt({
        environment: "development",
        expectation: {},
        profileCodes: [],
        identityKeyPath: join(paths.operationalDir, "operational-tls.key.pem"),
        statusPath: paths.statusPath,
        lastEndpointPath: paths.lastPath,
        discover: async () => [],
      });
      const mode = statSync(paths.statusPath).mode & 0o777;
      expect(mode.toString(8)).toBe("644");
    } finally {
      process.umask(previous);
    }
  });
});
