/**
 * The edge bridge (T1-STORE-OPERATIONS-001): the POS reaches the Store Hub
 * through the root terminal-edge process, and never holds the key.
 *
 * Three kinds of evidence, each needed:
 *
 *   1. THE DOOR IS NARROW. Pairing, activation, heartbeats and discovery are
 *      not forwardable; a route's query string and a request's headers are
 *      filtered; bodies are bounded.
 *   2. THE REQUEST IS THE TERMINAL'S, PINNED. Over REAL sockets — a unix socket
 *      in, real TLS 1.3 mutual authentication out — the Hub sees the Terminal's
 *      certificate, the pinned Hub certificate is enforced, and a Hub that
 *      swaps its certificate is refused.
 *   3. THE SOCKET BELONGS TO ONE GROUP, and nothing the POS sends is logged.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import {
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BRIDGE_ROUTES,
  handleBridgeRequest,
  matchBridgeRoute,
  startEdgeBridge,
  type BridgeDependencies,
  type PinnedHubEndpoint,
} from "../src/edge-bridge.js";
import { readDeviceSans, type TransportCredentials } from "../src/edge-transport.js";
import { buildChain, mintLeaf, testRsaKey } from "./support/operational-fixtures.js";

const HUB_ID = "549a41c6-21e9-4838-8b48-34a3878ba290";
const TERMINAL_ID = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const CUSTOMER = "11111111-2222-4333-8444-555555555555";

describe("the closed route list", () => {
  it.each([
    ["GET", "/edge/v1/runtime/authority-time"],
    ["GET", "/edge/v1/runtime/eligibility"],
    ["GET", "/edge/v1/configuration/current"],
    ["POST", "/edge/v1/sessions/open"],
    ["POST", "/edge/v1/sessions/refresh"],
    ["POST", "/edge/v1/sessions/close"],
    ["GET", "/edge/v1/customers/search?phone=%2B85512345678"],
    ["GET", `/edge/v1/customers/${CUSTOMER}`],
    ["POST", "/edge/v1/customers"],
    ["POST", `/edge/v1/customers/${CUSTOMER}/consent-decisions`],
    ["POST", "/edge/v1/laundry/bookings/drafts"],
    ["GET", `/edge/v1/laundry/bookings/drafts/${CUSTOMER}`],
    ["PATCH", `/edge/v1/laundry/bookings/drafts/${CUSTOMER}`],
    ["POST", `/edge/v1/laundry/bookings/drafts/${CUSTOMER}/cancel`],
  ])("forwards %s %s", (method, url) => {
    expect(matchBridgeRoute(method, url).ok).toBe(true);
  });

  // The routes that are terminal-edge's OWN business. A kiosk process that could
  // reach them could pair this board into another profile or re-activate it.
  it.each([
    ["POST", "/edge/v1/terminal-pairing/sessions"],
    ["POST", `/edge/v1/terminal-pairing/sessions/${CUSTOMER}/terminal-proof`],
    ["POST", `/edge/v1/terminal-pairing/sessions/${CUSTOMER}/complete`],
    ["POST", "/edge/v1/terminal-activation/challenges"],
    ["POST", "/edge/v1/terminal-activation/complete"],
    ["POST", "/edge/v1/terminal-health/heartbeats"],
    ["GET", "/.well-known/kitluy-edge-discovery/v1"],
    ["POST", "/edge/v1/sessions/switch"],
    ["DELETE", `/edge/v1/laundry/bookings/drafts/${CUSTOMER}`],
    ["POST", "/edge/v1/runtime/eligibility"],
    ["GET", "/edge/v1/customers/../terminal-pairing/sessions"],
    ["GET", "/edge/v1/customers/not-a-uuid"],
    ["GET", "/edge/v1%2Fterminal-pairing%2Fsessions"],
  ])("refuses %s %s", (method, url) => {
    const matched = matchBridgeRoute(method, url);
    expect(matched.ok).toBe(false);
    if (!matched.ok) expect(matched.response.status).toBe(404);
  });

  it("allows a query string only where the Hub route takes one, and only that parameter", () => {
    expect(matchBridgeRoute("GET", "/edge/v1/runtime/eligibility?x=1").ok).toBe(false);
    expect(matchBridgeRoute("GET", "/edge/v1/customers/search?phone=1&other=2").ok).toBe(false);
    expect(matchBridgeRoute("GET", "/edge/v1/customers/search?phone=1&phone=2").ok).toBe(false);
  });

  it("names no pairing or activation route at all", () => {
    for (const route of BRIDGE_ROUTES) {
      expect(route.pattern.source).not.toMatch(/pairing|activation|heartbeat|well-known/u);
    }
  });
});

function deps(overrides: Partial<BridgeDependencies> = {}): BridgeDependencies {
  return {
    environment: "development",
    pinnedEndpoint: () => ({
      host: "127.0.0.1",
      port: 7443,
      certificateFingerprint: "a".repeat(64),
      hubDeviceId: HUB_ID,
    }),
    latestStatus: () => null,
    terminalFacts: () => ({
      deviceId: TERMINAL_ID,
      assignmentGeneration: 3,
      profileCodes: ["laundry.t1.intake_cashier"],
    }),
    readCredentials: () => ({
      available: true,
      credentials: { certificatePem: "c", keyPem: "k", trustAnchorsPem: "t" },
    }),
    request: () => Promise.reject(new Error("the test did not expect a Hub request")),
    ...overrides,
  };
}

const get = (url: string, headers: Record<string, string> = {}) => ({
  method: "GET",
  url,
  headers,
  body: Buffer.alloc(0),
});

describe("refusals before any Hub request", () => {
  it("a terminal with no operational certificate is ACTIVATION_REQUIRED, and asks the Hub nothing", async () => {
    const response = await handleBridgeRequest(
      deps({ readCredentials: () => ({ available: false, detail: "none" }) }),
      get("/edge/v1/runtime/eligibility"),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).toContain("ACTIVATION_REQUIRED");
  });

  it("no verified, pinned Hub endpoint yet is EDGE_NOT_CONNECTED — never an unpinned request", async () => {
    const response = await handleBridgeRequest(
      deps({ pinnedEndpoint: () => null }),
      get("/edge/v1/runtime/eligibility"),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).toContain("EDGE_NOT_CONNECTED");
  });

  it("an oversized, non-JSON or array body is refused; a GET with a body is refused", async () => {
    const post = (body: Buffer) => ({
      method: "POST",
      url: "/edge/v1/customers",
      headers: {},
      body,
    });
    expect((await handleBridgeRequest(deps(), post(Buffer.alloc(70_000, 97)))).status).toBe(413);
    expect((await handleBridgeRequest(deps(), post(Buffer.from("not json")))).status).toBe(400);
    expect((await handleBridgeRequest(deps(), post(Buffer.from("[1]")))).status).toBe(400);
    expect(
      (
        await handleBridgeRequest(deps(), {
          ...get("/edge/v1/runtime/eligibility"),
          body: Buffer.from("{}"),
        })
      ).status,
    ).toBe(400);
  });

  it("the status answer carries no key, certificate or fingerprint material", async () => {
    const response = await handleBridgeRequest(
      deps({
        latestStatus: () => ({
          phase: "SERVING",
          detail: "connected",
          checkedAt: new Date().toISOString(),
          hub: {
            host: "127.0.0.1",
            port: 7443,
            hubDeviceId: HUB_ID,
            certificateFingerprint: "a".repeat(64),
            signature: "unverified",
            scopeChecked: false,
          },
          reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
        }),
      }),
      get("/bridge/v1/status"),
    );
    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    expect(text).toContain('"phase":"SERVING"');
    expect(text).toContain(HUB_ID);
    expect(text).toContain(TERMINAL_ID);
    expect(text).not.toContain("a".repeat(64));
    expect(text).not.toMatch(/BEGIN|PRIVATE|keyPem|certificatePem/u);
  });
});

// ---------------------------------------------------------------------------
// REAL SOCKETS: unix socket in, TLS 1.3 mutual authentication out.
// ---------------------------------------------------------------------------
interface Seen {
  method: string;
  url: string;
  headers: Record<string, unknown>;
  body: string;
  peerDeviceId: string | null;
}

describe("over real sockets, the Hub sees the Terminal and the pin holds", () => {
  let dir: string;
  let hub: HttpsServer;
  let impostor: HttpsServer;
  let bridge: Server;
  let pinned: PinnedHubEndpoint;
  let credentials: TransportCredentials;
  const seen: Seen[] = [];
  const logLines: string[] = [];
  let hubPort = 0;
  let impostorPort = 0;
  let endpoint: () => PinnedHubEndpoint | null = () => null;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kitluy-bridge-"));
    const chain = buildChain();
    const hubKey = testRsaKey();
    const hubLeaf = mintLeaf({
      chain,
      subjectPublicKeyPem: hubKey.publicKeyPem,
      deviceRecordId: HUB_ID,
      serialHex: "11",
    });
    const terminalKey = testRsaKey();
    const terminalLeaf = mintLeaf({
      chain,
      subjectPublicKeyPem: terminalKey.publicKeyPem,
      deviceRecordId: TERMINAL_ID,
      serialHex: "22",
    });
    // A second, equally valid Hub certificate: same chain, same device — the
    // pin is the only thing that tells them apart.
    const swappedKey = testRsaKey();
    const swappedLeaf = mintLeaf({
      chain,
      subjectPublicKeyPem: swappedKey.publicKeyPem,
      deviceRecordId: HUB_ID,
      serialHex: "33",
    });
    credentials = {
      certificatePem: terminalLeaf.certificatePem,
      keyPem: terminalKey.privateKeyPem,
      trustAnchorsPem: chain.chainPem,
    };

    const hubHandler = (label: string) => (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        seen.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: { ...req.headers },
          body: Buffer.concat(chunks).toString("utf8"),
          peerDeviceId: readDeviceSans(peer).deviceId,
        });
        const text = JSON.stringify({ served: label, customers: [] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(text);
      });
    };
    const tlsOptions = (certificatePem: string, keyPem: string) => ({
      cert: `${certificatePem.trim()}\n${chain.intermediatePem.trim()}\n`,
      key: keyPem,
      ca: chain.chainPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3" as const,
    });
    hub = createHttpsServer(
      tlsOptions(hubLeaf.certificatePem, hubKey.privateKeyPem),
      hubHandler("hub"),
    );
    impostor = createHttpsServer(
      tlsOptions(swappedLeaf.certificatePem, swappedKey.privateKeyPem),
      hubHandler("impostor"),
    );
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => impostor.listen(0, "127.0.0.1", r));
    hubPort = (hub.address() as AddressInfo).port;
    impostorPort = (impostor.address() as AddressInfo).port;
    pinned = {
      host: "127.0.0.1",
      port: hubPort,
      certificateFingerprint: hubLeaf.sha256,
      hubDeviceId: HUB_ID,
    };
    endpoint = () => pinned;

    const groupFile = join(dir, "group");
    writeFileSync(groupFile, `kitluy-terminal:x:${String(userInfo().gid)}:\n`);
    const socketDir = join(dir, "run");
    mkdirSync(socketDir, { mode: 0o700 });
    bridge = await startEdgeBridge(
      {
        environment: "development",
        pinnedEndpoint: () => endpoint(),
        latestStatus: () => null,
        terminalFacts: () => ({ deviceId: TERMINAL_ID, assignmentGeneration: 3, profileCodes: [] }),
        readCredentials: () => ({ available: true, credentials }),
        log: (line) => logLines.push(line),
      },
      { socketPath: join(socketDir, "bridge.sock"), directory: socketDir, groupFile },
    );
  });

  afterAll(async () => {
    await new Promise<void>((r) => bridge.close(() => r()));
    await new Promise<void>((r) => hub.close(() => r()));
    await new Promise<void>((r) => impostor.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  function viaSocket(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = httpRequest(
        {
          socketPath: join(dir, "run", "bridge.sock"),
          method,
          path,
          headers: {
            ...headers,
            ...(payload === undefined
              ? {}
              : { "content-type": "application/json", "content-length": String(payload.length) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
            });
          });
        },
      );
      req.on("error", reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  it("the socket is 0660 in a 0750 directory, group-owned by the client group", () => {
    const socket = statSync(join(dir, "run", "bridge.sock"));
    const directory = statSync(join(dir, "run"));
    expect(socket.mode & 0o777).toBe(0o660);
    expect(directory.mode & 0o777).toBe(0o750);
    expect(socket.gid).toBe(userInfo().gid);
  });

  it("forwards a staff-session read to the Hub as the TERMINAL, pinned, with only the allowed headers", async () => {
    seen.length = 0;
    const response = await viaSocket(
      "POST",
      "/edge/v1/customers",
      { displayName: "Sokha Test", phone: "+85512345678", preferredLanguage: "km-KH" },
      {
        "idempotency-key": "t1i-abc",
        "x-kitluy-session-id": "sess-1",
        authorization: "Bearer should-not-pass",
        cookie: "should-not-pass",
        "x-forwarded-for": "10.0.0.1",
      },
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ served: "hub", customers: [] });
    expect(seen).toHaveLength(1);
    const hit = seen[0];
    expect(hit?.method).toBe("POST");
    expect(hit?.url).toBe("/edge/v1/customers");
    // The Hub authenticated the TERMINAL's certificate — not a bridge identity.
    expect(hit?.peerDeviceId).toBe(TERMINAL_ID);
    expect(hit?.headers["idempotency-key"]).toBe("t1i-abc");
    expect(hit?.headers["x-kitluy-session-id"]).toBe("sess-1");
    expect(hit?.headers.authorization).toBeUndefined();
    expect(hit?.headers.cookie).toBeUndefined();
    expect(hit?.headers["x-forwarded-for"]).toBeUndefined();
    expect(JSON.parse(hit?.body ?? "{}")).toMatchObject({ phone: "+85512345678" });
  });

  it("carries the one permitted query string, and PATCH", async () => {
    seen.length = 0;
    await viaSocket("GET", "/edge/v1/customers/search?phone=%2B85512345678");
    await viaSocket("PATCH", `/edge/v1/laundry/bookings/drafts/${CUSTOMER}`, {
      expectedVersion: 1,
    });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET /edge/v1/customers/search?phone=%2B85512345678",
      `PATCH /edge/v1/laundry/bookings/drafts/${CUSTOMER}`,
    ]);
  });

  it("a Hub presenting a DIFFERENT valid certificate at the pinned address is refused, and never served", async () => {
    seen.length = 0;
    endpoint = () => ({ ...pinned, port: impostorPort });
    const response = await viaSocket("GET", "/edge/v1/runtime/eligibility");
    endpoint = () => pinned;
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).toContain("HUB_CERT_MISMATCH");
    // The TLS handshake completes before the pin is judged, so the impostor
    // may see a connection — but never a request.
    expect(seen).toEqual([]);
  });

  it("a refused route never reaches the Hub", async () => {
    seen.length = 0;
    const response = await viaSocket("POST", "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: "laundry.t2.customer_display",
    });
    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("nothing a request carried reaches the log", () => {
    const text = logLines.join("\n");
    expect(text).not.toContain("85512345678");
    expect(text).not.toContain("Sokha");
    expect(text).not.toContain("sess-1");
    expect(text).toContain("customers.create -> 200");
  });
});

describe("without the client group, the socket is root-only", () => {
  it("falls back to 0600 rather than opening the socket to everyone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-bridge-nogroup-"));
    const groupFile = join(dir, "group");
    writeFileSync(groupFile, "somebody-else:x:4242:\n");
    const server = await startEdgeBridge(deps(), {
      socketPath: join(dir, "bridge.sock"),
      directory: dir,
      groupFile,
    });
    try {
      expect(statSync(join(dir, "bridge.sock")).mode & 0o777).toBe(0o600);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
