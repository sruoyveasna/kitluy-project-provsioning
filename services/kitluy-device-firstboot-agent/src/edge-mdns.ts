/**
 * One-shot mDNS query for the Store Hub's `_kitluy-edge._tcp.local` service.
 *
 * WHY A HAND-ROLLED QUERY.
 *
 * The Pi Terminal image ships `avahi-daemon` but NOT `avahi-browse`/
 * `avahi-resolve`, so there is nothing to shell out to; and this agent ships
 * with ZERO runtime dependencies by design (its `package.json` `dependencies`
 * is empty and `package-bootstrap-runtime.sh` copies only the agent's own
 * compiled modules), so a library is not an option either. What is left is a
 * DNS message, which is small and well specified.
 *
 * DELIBERATELY MINIMAL. This resolves PTR -> SRV -> A and nothing else. It is a
 * HINT, not a trust decision: the multicast answer carries no scope, no
 * fingerprint and no signature, and everything trustworthy comes from the
 * signed record fetched over mutual TLS from the address it points at. A
 * hostile answer costs a failed handshake, not a wrong Hub.
 */
import { createSocket, type Socket } from "node:dgram";
import { EDGE_DISCOVERY_SERVICE_TYPE, EDGE_LAN_PORT } from "./edge-discovery-record.js";

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_SRV = 33;

export interface EdgeCandidate {
  /** An address the Hub answers on: an IPv4 literal, or a `.local` name. */
  readonly host: string;
  readonly port: number;
  readonly instance: string;
}

function encodeName(name: string): Buffer {
  const parts = name.replace(/\.$/, "").split(".");
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const label = Buffer.from(part, "utf8");
    if (label.length > 63) throw new Error("mDNS label too long");
    chunks.push(Buffer.from([label.length]), label);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/** Reads a name, following compression pointers. Returns the offset AFTER it. */
function decodeName(buffer: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let cursor = offset;
  let next = -1;
  // Bounded: a pointer loop would otherwise hang the agent for ever.
  for (let hops = 0; hops < 128; hops += 1) {
    if (cursor >= buffer.length) break;
    const length = buffer[cursor] ?? 0;
    if (length === 0) {
      cursor += 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | (buffer[cursor + 1] ?? 0);
      if (next === -1) next = cursor + 2;
      cursor = pointer;
      continue;
    }
    labels.push(buffer.subarray(cursor + 1, cursor + 1 + length).toString("utf8"));
    cursor += 1 + length;
  }
  return { name: labels.join("."), next: next === -1 ? cursor : next };
}

interface ResourceRecord {
  readonly name: string;
  readonly type: number;
  readonly rdata: Buffer;
  readonly rdataOffset: number;
}

function parseRecords(buffer: Buffer): readonly ResourceRecord[] {
  if (buffer.length < 12) return [];
  const counts = {
    questions: buffer.readUInt16BE(4),
    answers: buffer.readUInt16BE(6),
    authority: buffer.readUInt16BE(8),
    additional: buffer.readUInt16BE(10),
  };
  let offset = 12;
  for (let i = 0; i < counts.questions; i += 1) {
    offset = decodeName(buffer, offset).next + 4;
  }
  const total = counts.answers + counts.authority + counts.additional;
  const records: ResourceRecord[] = [];
  for (let i = 0; i < total; i += 1) {
    if (offset + 10 > buffer.length) break;
    const { name, next } = decodeName(buffer, offset);
    const type = buffer.readUInt16BE(next);
    const rdlength = buffer.readUInt16BE(next + 8);
    const rdataOffset = next + 10;
    if (rdataOffset + rdlength > buffer.length) break;
    records.push({
      name,
      type,
      rdata: buffer.subarray(rdataOffset, rdataOffset + rdlength),
      rdataOffset,
    });
    offset = rdataOffset + rdlength;
  }
  return records;
}

/** Socket seam so tests drive the parser without touching the network. */
export interface MulticastPort {
  send(message: Buffer): void;
  onMessage(handler: (message: Buffer) => void): void;
  close(): void;
}

export function udpMulticastPort(): MulticastPort {
  let socket: Socket | null = createSocket({ type: "udp4", reuseAddr: true });
  const pending: Buffer[] = [];
  let ready = false;
  socket.on("error", () => undefined);
  socket.bind(0, () => {
    try {
      socket?.addMembership(MDNS_ADDRESS);
    } catch {
      // A board with no multicast route still gets a clean "found nothing".
    }
    ready = true;
    for (const message of pending.splice(0)) {
      socket?.send(message, MDNS_PORT, MDNS_ADDRESS, () => undefined);
    }
  });
  return {
    send(message: Buffer): void {
      if (!ready) {
        pending.push(message);
        return;
      }
      socket?.send(message, MDNS_PORT, MDNS_ADDRESS, () => undefined);
    },
    onMessage(handler: (message: Buffer) => void): void {
      socket?.on("message", handler);
    },
    close(): void {
      try {
        socket?.close();
      } catch {
        // Already closed; nothing to report.
      }
      socket = null;
    },
  };
}

/** Build the PTR question for the service type. Exported for the test. */
export function buildServiceQuery(serviceType: string = EDGE_DISCOVERY_SERVICE_TYPE): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0); // mDNS ignores the id
  header.writeUInt16BE(0, 2); // standard query
  header.writeUInt16BE(1, 4); // one question
  const question = Buffer.concat([
    encodeName(serviceType),
    Buffer.from([0x00, TYPE_PTR, 0x00, 0x01]),
  ]);
  return Buffer.concat([header, question]);
}

/** Collect the candidates a set of mDNS responses describes. */
export function collectCandidates(
  messages: readonly Buffer[],
  serviceType: string = EDGE_DISCOVERY_SERVICE_TYPE,
): readonly EdgeCandidate[] {
  const instances = new Set<string>();
  const srv = new Map<string, { target: string; port: number }>();
  const addresses = new Map<string, string>();

  for (const message of messages) {
    for (const record of parseRecords(message)) {
      if (record.type === TYPE_PTR && record.name === serviceType) {
        instances.add(decodeName(message, record.rdataOffset).name);
      } else if (record.type === TYPE_SRV && record.rdata.length >= 7) {
        const port = record.rdata.readUInt16BE(4);
        const target = decodeName(message, record.rdataOffset + 6).name;
        srv.set(record.name, { target, port });
      } else if (record.type === TYPE_A && record.rdata.length === 4) {
        addresses.set(record.name, Array.from(record.rdata).join("."));
      }
    }
  }

  const candidates: EdgeCandidate[] = [];
  const seen = new Set<string>();
  for (const instance of instances) {
    const service = srv.get(instance);
    // An SRV that never arrived still leaves the instance usable: the TXT-free
    // fallback is the service type's one locked port (owner package §3).
    const port = service?.port ?? EDGE_LAN_PORT;
    const target = service?.target;
    const host = (target === undefined ? undefined : addresses.get(target)) ?? target;
    if (host === undefined || host === "") continue;
    const key = `${host}:${String(port)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ host, port, instance });
  }
  return candidates;
}

/**
 * Ask the LAN who serves `_kitluy-edge._tcp.local`, and answer with whatever
 * replied inside the window. Never throws: "nobody answered" is an empty list.
 */
export async function discoverEdgeCandidates(
  options: {
    readonly port?: MulticastPort;
    readonly timeoutMs?: number;
    readonly serviceType?: string;
  } = {},
): Promise<readonly EdgeCandidate[]> {
  const serviceType = options.serviceType ?? EDGE_DISCOVERY_SERVICE_TYPE;
  const port = options.port ?? udpMulticastPort();
  const received: Buffer[] = [];
  try {
    port.onMessage((message) => received.push(message));
    port.send(buildServiceQuery(serviceType));
    await new Promise((resolve) => setTimeout(resolve, options.timeoutMs ?? 2_000));
  } finally {
    port.close();
  }
  return collectCandidates(received, serviceType);
}
