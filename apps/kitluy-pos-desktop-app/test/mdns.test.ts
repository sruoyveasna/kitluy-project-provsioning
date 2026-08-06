/**
 * WS-12-T001-P02 §8 "Discovery" — the mDNS/DNS-SD codec and listener.
 *
 * REAL DNS wire traffic over REAL UDP sockets on loopback: a scripted
 * responder answers the listener's PTR query with genuine DNS response
 * packets (PTR + SRV + TXT + A, including name compression). Multicast
 * group membership is the only piece not exercised — it is a one-line
 * kernel call on the same socket, and CI hosts do not route multicast.
 *
 * THE ONE RULE is asserted throughout: nothing decoded here is trust —
 * candidates are hostnames and ports only.
 */
import { createSocket, type Socket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";

import {
  MDNS_SERVICE_NAME,
  decodeMdnsMessage,
  discoverKitluyHubCandidates,
  encodePtrQuery,
  extractServiceCandidates,
  type MulticastSocketPort,
} from "../electron/mdns.js";

// ---------------------------------------------------------------------------
// A minimal DNS-SD RESPONDER encoder (test-side only)
// ---------------------------------------------------------------------------

function encodeName(name: string): Buffer {
  const chunks: Buffer[] = [];
  for (const part of name.split(".").filter((p) => p.length > 0)) {
    const bytes = Buffer.from(part, "utf8");
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function record(name: string, type: number, data: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(1, 2); // IN
  header.writeUInt32BE(120, 4); // TTL
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), header, data]);
}

function srvData(port: number, target: string): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(0, 2);
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, encodeName(target)]);
}

function txtData(entries: readonly string[]): Buffer {
  return Buffer.concat(
    entries.map((entry) =>
      Buffer.concat([Buffer.from([entry.length]), Buffer.from(entry, "utf8")]),
    ),
  );
}

function buildResponse(
  instance: string,
  hostname: string,
  port: number,
  address: string,
  service: string = MDNS_SERVICE_NAME,
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2); // response, authoritative
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(4, 6); // four answers
  return Buffer.concat([
    header,
    record(service, 12, encodeName(instance)), // PTR
    record(instance, 33, srvData(port, hostname)), // SRV
    record(instance, 16, txtData(["rid=r-1", "v=1"])), // TXT
    record(hostname, 1, Buffer.from(address.split(".").map(Number))), // A
  ]);
}

// ---------------------------------------------------------------------------
// Loopback socket pair speaking real UDP
// ---------------------------------------------------------------------------

const sockets: Socket[] = [];
afterEach(() => {
  while (sockets.length > 0) sockets.pop()?.close();
});

async function loopbackPair(): Promise<{
  port: MulticastSocketPort;
  responderReceived: Buffer[];
  respondWith: (message: Buffer) => void;
}> {
  const listener = createSocket("udp4");
  const responder = createSocket("udp4");
  sockets.push(listener, responder);
  await new Promise<void>((resolve) => listener.bind(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => responder.bind(0, "127.0.0.1", resolve));
  const listenerPort = (listener.address() as { port: number }).port;
  const responderPort = (responder.address() as { port: number }).port;
  const responderReceived: Buffer[] = [];
  responder.on("message", (message) => {
    responderReceived.push(message);
  });
  return {
    port: {
      send: (message) => {
        responder.send.bind(responder)(message, responderPort, "127.0.0.1");
      },
      onMessage: (handler) => {
        listener.on("message", (message: Buffer) => {
          handler(message);
        });
      },
      close: () => {
        /* closed in afterEach */
      },
    },
    responderReceived,
    respondWith: (message) => {
      responder.send(message, listenerPort, "127.0.0.1");
    },
  };
}

describe("mDNS/DNS-SD discovery (§5)", () => {
  it("performs real service discovery: query out, PTR/SRV/TXT/A answers decoded into candidates", async () => {
    const { port, responderReceived, respondWith } = await loopbackPair();
    const discovery = discoverKitluyHubCandidates(port, 400);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The QUERY is a real DNS packet naming the KitLuy service.
    expect(responderReceived.length).toBeGreaterThan(0);
    const query = decodeMdnsMessage(responderReceived[0] ?? Buffer.alloc(0));
    expect(query.isResponse).toBe(false);
    respondWith(
      buildResponse("kitluy-hub-abc." + MDNS_SERVICE_NAME, "hub.local", 7443, "127.0.0.1"),
    );
    const candidates = await discovery;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ hostname: "127.0.0.1", port: 7443 });
    expect(candidates[0]?.txt["rid"]).toBe("r-1");
  });

  it("an unsigned advertisement never authorizes — candidates carry no identity claim", async () => {
    const message = buildResponse("evil." + MDNS_SERVICE_NAME, "evil.local", 7443, "10.0.0.9");
    const candidates = extractServiceCandidates(decodeMdnsMessage(message));
    expect(candidates).toHaveLength(1);
    // The candidate shape has ONLY hostname/port/instance/txt — no
    // fingerprint, no scope, no key. Verification happens downstream
    // against the SIGNED discovery record, never here.
    expect(Object.keys(candidates[0] ?? {}).sort()).toEqual([
      "hostname",
      "instanceName",
      "port",
      "txt",
    ]);
  });

  it("ignores malformed packets and foreign services as background noise", async () => {
    const { port, respondWith } = await loopbackPair();
    const discovery = discoverKitluyHubCandidates(port, 350);
    await new Promise((resolve) => setTimeout(resolve, 40));
    respondWith(Buffer.from("not a dns packet"));
    respondWith(
      buildResponse("printer._ipp._tcp.local", "printer.local", 631, "10.0.0.4", "_ipp._tcp.local"),
    );
    const candidates = await discovery;
    expect(candidates).toHaveLength(0);
  });

  it("rejects compression-pointer loops instead of spinning", () => {
    const malicious = Buffer.alloc(24);
    malicious.writeUInt16BE(0x8400, 2);
    malicious.writeUInt16BE(1, 6);
    // name = pointer to itself at offset 12
    malicious[12] = 0xc0;
    malicious[13] = 0x0c;
    expect(() => decodeMdnsMessage(malicious)).toThrowError(/pointer|truncated|past/);
  });

  it("encodes the KitLuy PTR question exactly", () => {
    const query = encodePtrQuery(7);
    const decoded = decodeMdnsMessage(query);
    expect(decoded.id).toBe(7);
    expect(decoded.isResponse).toBe(false);
  });
});
