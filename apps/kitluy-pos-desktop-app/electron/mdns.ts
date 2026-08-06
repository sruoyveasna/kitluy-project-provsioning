/**
 * Minimal mDNS/DNS-SD wire codec and listener — WS-12-T001-P02.
 *
 * Implements exactly what the locked discovery contract needs
 * (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §5): query
 * `_kitluy-edge._tcp.local` PTR over multicast UDP 5353 and decode
 * PTR/SRV/TXT/A answers into endpoint CANDIDATES.
 *
 * THE ONE RULE, restated from the P04B authority: an mDNS response is
 * DISCOVERY ONLY. Nothing decoded here is trusted — every candidate must
 * still pass the signed discovery record and full identity verification.
 * That is why this module returns hostnames and ports and never anything
 * that looks like an identity claim.
 *
 * The UDP socket is injected (`MulticastSocketPort`) so the packet codec
 * and listener logic are exercised with REAL DNS wire traffic in tests
 * without requiring multicast group membership on the test host; the
 * production factory binds a real `node:dgram` socket to 5353 and joins
 * 224.0.0.251.
 */
import { createSocket } from "node:dgram";

export const MDNS_SERVICE_NAME = "_kitluy-edge._tcp.local" as const;
export const MDNS_GROUP_ADDRESS = "224.0.0.251" as const;
export const MDNS_PORT = 5353 as const;

const TYPE_A = 1;
const TYPE_PTR = 12;
const TYPE_TXT = 16;
const TYPE_SRV = 33;
const CLASS_IN = 1;

// ---------------------------------------------------------------------------
// Wire codec
// ---------------------------------------------------------------------------

function encodeName(name: string): Buffer {
  const parts = name.split(".").filter((p) => p.length > 0);
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    if (bytes.length > 63) throw new Error("mDNS label exceeds 63 bytes");
    chunks.push(Buffer.from([bytes.length]), bytes);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

/** Encode one PTR question for the KitLuy service. */
export function encodePtrQuery(id = 0): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0, 2); // flags: standard query
  header.writeUInt16BE(1, 4); // one question
  const typeAndClass = Buffer.alloc(4);
  typeAndClass.writeUInt16BE(TYPE_PTR, 0);
  typeAndClass.writeUInt16BE(CLASS_IN, 2);
  return Buffer.concat([header, encodeName(MDNS_SERVICE_NAME), typeAndClass]);
}

interface DecodedName {
  readonly name: string;
  readonly next: number;
}

/** Decode a possibly-compressed DNS name. Bounded against pointer loops. */
function decodeName(message: Buffer, offset: number): DecodedName {
  const labels: string[] = [];
  let position = offset;
  let jumped = false;
  let next = offset;
  let hops = 0;
  for (;;) {
    if (position >= message.length) throw new Error("mDNS name runs past the message");
    const length = message[position];
    if (length === undefined) throw new Error("mDNS name truncated");
    if ((length & 0xc0) === 0xc0) {
      const low = message[position + 1];
      if (low === undefined) throw new Error("mDNS pointer truncated");
      if (!jumped) next = position + 2;
      position = ((length & 0x3f) << 8) | low;
      jumped = true;
      hops += 1;
      if (hops > 32) throw new Error("mDNS compression pointer loop");
      continue;
    }
    if (length === 0) {
      if (!jumped) next = position + 1;
      return { name: labels.join("."), next };
    }
    const start = position + 1;
    const end = start + length;
    if (end > message.length) throw new Error("mDNS label runs past the message");
    labels.push(message.subarray(start, end).toString("utf8"));
    position = end;
  }
}

export interface MdnsRecord {
  readonly name: string;
  readonly type: number;
  readonly ttlSeconds: number;
  readonly data: Buffer;
  /** Offset of `data` within the whole message (for compressed names). */
  readonly dataOffset: number;
  readonly message: Buffer;
}

export interface MdnsMessage {
  readonly id: number;
  readonly isResponse: boolean;
  readonly answers: readonly MdnsRecord[];
}

/** Decode a DNS message's answer/authority/additional records. */
export function decodeMdnsMessage(message: Buffer): MdnsMessage {
  if (message.length < 12) throw new Error("mDNS message shorter than its header");
  const id = message.readUInt16BE(0);
  const flags = message.readUInt16BE(2);
  const questionCount = message.readUInt16BE(4);
  const answerCount = message.readUInt16BE(6) + message.readUInt16BE(8) + message.readUInt16BE(10);
  let offset = 12;
  for (let i = 0; i < questionCount; i += 1) {
    const q = decodeName(message, offset);
    offset = q.next + 4;
  }
  const answers: MdnsRecord[] = [];
  for (let i = 0; i < answerCount; i += 1) {
    const { name, next } = decodeName(message, offset);
    if (next + 10 > message.length) throw new Error("mDNS record header truncated");
    const type = message.readUInt16BE(next);
    const ttlSeconds = message.readUInt32BE(next + 4);
    const dataLength = message.readUInt16BE(next + 8);
    const dataOffset = next + 10;
    const dataEnd = dataOffset + dataLength;
    if (dataEnd > message.length) throw new Error("mDNS record data truncated");
    answers.push({
      name,
      type,
      ttlSeconds,
      data: message.subarray(dataOffset, dataEnd),
      dataOffset,
      message,
    });
    offset = dataEnd;
  }
  return { id, isResponse: (flags & 0x8000) !== 0, answers };
}

export interface MdnsServiceCandidate {
  /** SRV target hostname (e.g. `hub.local`) or a resolved A address. */
  readonly hostname: string;
  readonly port: number;
  readonly instanceName: string;
  readonly txt: Readonly<Record<string, string>>;
}

/**
 * Assemble service candidates from a decoded response: PTR → instance,
 * instance SRV → target/port, instance TXT → metadata, target A → address.
 * Anything malformed is skipped — a broken advertisement is not an error
 * condition for the listener, it is background noise.
 */
export function extractServiceCandidates(decoded: MdnsMessage): readonly MdnsServiceCandidate[] {
  const instances = new Set<string>();
  for (const record of decoded.answers) {
    if (record.type !== TYPE_PTR) continue;
    if (record.name.toLowerCase() !== MDNS_SERVICE_NAME.toLowerCase()) continue;
    try {
      instances.add(decodeName(record.message, record.dataOffset).name);
    } catch {
      // skip malformed pointer data
    }
  }
  const candidates: MdnsServiceCandidate[] = [];
  for (const instance of instances) {
    let hostname: string | null = null;
    let port: number | null = null;
    const txt: Record<string, string> = {};
    const addresses: Record<string, string> = {};
    for (const record of decoded.answers) {
      try {
        if (record.type === TYPE_SRV && record.name === instance) {
          if (record.data.length < 6) continue;
          port = record.data.readUInt16BE(4);
          hostname = decodeName(record.message, record.dataOffset + 6).name;
        } else if (record.type === TYPE_TXT && record.name === instance) {
          let cursor = 0;
          while (cursor < record.data.length) {
            const length = record.data[cursor];
            if (length === undefined || length === 0) break;
            const entry = record.data.subarray(cursor + 1, cursor + 1 + length).toString("utf8");
            const eq = entry.indexOf("=");
            if (eq > 0) txt[entry.slice(0, eq)] = entry.slice(eq + 1);
            cursor += 1 + length;
          }
        } else if (record.type === TYPE_A && record.data.length === 4) {
          addresses[record.name] = Array.from(record.data.values()).join(".");
        }
      } catch {
        // skip malformed records; discovery is best-effort by design
      }
    }
    if (hostname !== null && port !== null && port > 0) {
      const resolved = addresses[hostname];
      candidates.push({
        hostname: resolved ?? hostname,
        port,
        instanceName: instance,
        txt,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Listener over an injectable socket
// ---------------------------------------------------------------------------

export interface MulticastSocketPort {
  send(message: Buffer): void;
  onMessage(listener: (message: Buffer) => void): void;
  close(): void;
}

/** Production socket: real dgram on 5353 joined to the mDNS group. */
export function multicastSocket(): MulticastSocketPort {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  socket.bind(MDNS_PORT, () => {
    try {
      socket.addMembership(MDNS_GROUP_ADDRESS);
    } catch {
      // Membership can fail on hosts without multicast; queries may still
      // be answered by unicast responders. Discovery stays best-effort.
    }
  });
  return {
    send: (message) => {
      socket.send(message, MDNS_PORT, MDNS_GROUP_ADDRESS);
    },
    onMessage: (listener) => {
      socket.on("message", (message: Buffer) => {
        listener(message);
      });
    },
    close: () => {
      socket.close();
    },
  };
}

/**
 * One bounded discovery round: query, collect KitLuy service candidates
 * until the timeout, return what was heard. The CALLER verifies — every
 * candidate is untrusted input.
 */
export function discoverKitluyHubCandidates(
  socket: MulticastSocketPort,
  timeoutMs: number,
): Promise<readonly MdnsServiceCandidate[]> {
  return new Promise((resolve) => {
    const found: MdnsServiceCandidate[] = [];
    const seen = new Set<string>();
    socket.onMessage((message) => {
      try {
        const decoded = decodeMdnsMessage(message);
        if (!decoded.isResponse) return;
        for (const candidate of extractServiceCandidates(decoded)) {
          const key = `${candidate.hostname}:${candidate.port}`;
          if (!seen.has(key)) {
            seen.add(key);
            found.push(candidate);
          }
        }
      } catch {
        // Not a parseable DNS message — ignore. Multicast is a shared bus.
      }
    });
    socket.send(encodePtrQuery());
    setTimeout(() => {
      resolve(found);
    }, timeoutMs);
  });
}
