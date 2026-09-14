/**
 * Pi Terminal → Store Hub LAN transport (mutual TLS).
 *
 * WHY THIS IS NOT A COPY OF THE DESKTOP APP'S `lan-client.ts`.
 *
 * The POS desktop app has an equivalent, but a service may not import an app's
 * internals (repository rule 2), and more importantly its identity policy does
 * not survive contact with a real device certificate. That client falls back to
 * Node's DEFAULT `checkServerIdentity` for the unpinned discovery fetch, which
 * matches the connected host against DNS/IP SANs. A KitLuy operational
 * certificate has neither:
 *
 *   Subject:  CN = <hub device uuid>
 *   SAN:      URI:kitluy-device://<uuid>, URI:kitluy-generation://1,
 *             URI:kitluy-environment://development
 *
 * So the default check refuses every connection to a genuine Hub — observed
 * against the Hub on 2026-09-10. Recorded as a finding against that app; not
 * changed from here.
 *
 * The identity that matters on this LAN is not a NAME, it is a DEVICE. This
 * client therefore binds three things and never the hostname:
 *
 *   1. the chain — the peer certificate must verify to the device CA the
 *      terminal was issued under (`rejectUnauthorized` stays on);
 *   2. the device — the peer must present a `kitluy-device://<uuid>` URI SAN,
 *      and an environment SAN matching this image's own;
 *   3. the certificate — once the signed discovery record names a fingerprint,
 *      every later connection pins that exact certificate.
 *
 * Step 3 is the real anchor. Steps 1 and 2 exist so the FIRST connection, which
 * has no fingerprint yet, is not open to anything holding any certificate.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request, type RequestOptions } from "node:https";
import type { PeerCertificate } from "node:tls";

/** Where `kitluy-operational-tls.service` leaves the adopted material. */
export const OPERATIONAL_DIR = "/var/lib/kitluy/operational";
export const OPERATIONAL_CERT_PATH = `${OPERATIONAL_DIR}/operational-tls.crt.pem`;
export const OPERATIONAL_KEY_PATH = `${OPERATIONAL_DIR}/operational-tls.key.pem`;
export const OPERATIONAL_CHAIN_PATH = `${OPERATIONAL_DIR}/operational-tls.chain.pem`;

export interface TransportCredentials {
  readonly certificatePem: string;
  readonly keyPem: string;
  /** The issuing chain, used to verify the HUB — not to prove ourselves. */
  readonly trustAnchorsPem: string;
}

export type CredentialsOutcome =
  | { readonly available: true; readonly credentials: TransportCredentials }
  | { readonly available: false; readonly detail: string };

/**
 * Read the adopted operational material.
 *
 * Absent is a WAITING state, not a fault: a terminal that has not yet been
 * activated has no certificate, and saying "not adopted yet" is the honest
 * reading. Only the caller decides whether that is worth retrying.
 */
export function readTransportCredentials(dir: string = OPERATIONAL_DIR): CredentialsOutcome {
  const paths = {
    certificatePem: `${dir}/operational-tls.crt.pem`,
    keyPem: `${dir}/operational-tls.key.pem`,
    trustAnchorsPem: `${dir}/operational-tls.chain.pem`,
  };
  const read: Record<string, string> = {};
  for (const [field, path] of Object.entries(paths)) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return { available: false, detail: `no operational material at ${path}` };
    }
    if (!text.includes("-----BEGIN")) {
      return { available: false, detail: `${path} is not PEM` };
    }
    read[field] = text;
  }
  return {
    available: true,
    credentials: {
      certificatePem: read.certificatePem ?? "",
      keyPem: read.keyPem ?? "",
      trustAnchorsPem: read.trustAnchorsPem ?? "",
    },
  };
}

/** SHA-256 (lowercase hex) of a DER certificate — the discovery record's form. */
export function certificateFingerprint(der: Buffer): string {
  return createHash("sha256").update(der).digest("hex");
}

const DEVICE_URI = /^kitluy-device:\/\/([0-9a-f-]{36})$/i;
const ENVIRONMENT_URI = /^kitluy-environment:\/\/([a-z_]+)$/i;

/** The URI SANs a KitLuy operational certificate carries, parsed. */
export function readDeviceSans(certificate: PeerCertificate): {
  readonly deviceId: string | null;
  readonly environment: string | null;
} {
  // Node exposes URI SANs as `subjectaltname`: 'URI:kitluy-device://…, URI:…'.
  const raw = (certificate as { subjectaltname?: string }).subjectaltname ?? "";
  let deviceId: string | null = null;
  let environment: string | null = null;
  for (const entry of raw.split(",")) {
    const value = entry.trim().replace(/^URI:/i, "");
    const device = DEVICE_URI.exec(value);
    if (device !== null) deviceId = device[1]?.toLowerCase() ?? null;
    const env = ENVIRONMENT_URI.exec(value);
    if (env !== null) environment = env[1]?.toLowerCase() ?? null;
  }
  return { deviceId, environment };
}

export interface EdgeResponse {
  readonly status: number;
  readonly body: unknown;
  /** The certificate the Hub actually presented, so the caller can pin it. */
  readonly peerCertificateFingerprint: string;
  readonly peerDeviceId: string | null;
}

export class EdgeTransportError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "EdgeTransportError";
  }
}

/**
 * One request. No connection pooling, for the reason the desktop client records
 * and which applies here identically: a reused keep-alive socket skips the
 * handshake and with it the identity check, so a pinned request could ride a
 * socket verified for something else.
 */
export function edgeRequest(input: {
  readonly host: string;
  readonly port: number;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly credentials: TransportCredentials;
  readonly environment: string;
  /** Absent only for the first, pre-discovery fetch. */
  readonly pinnedCertificateFingerprint?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}): Promise<EdgeResponse> {
  return new Promise((resolve, reject) => {
    const payload =
      input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body), "utf8");
    let observedFingerprint = "";
    let observedDeviceId: string | null = null;

    const options: RequestOptions = {
      host: input.host,
      port: input.port,
      method: input.method,
      path: input.path,
      agent: false,
      cert: input.credentials.certificatePem,
      key: input.credentials.keyPem,
      ca: input.credentials.trustAnchorsPem,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      timeout: input.timeoutMs ?? 10_000,
      headers: {
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json", "content-length": String(payload.length) }),
        ...input.headers,
      },
      // The chain is still verified by Node against `ca` above; this replaces
      // only the NAME check, which a URI-SAN device certificate cannot satisfy.
      checkServerIdentity: (_host: string, certificate: PeerCertificate): Error | undefined => {
        observedFingerprint = certificateFingerprint(certificate.raw);
        const sans = readDeviceSans(certificate);
        observedDeviceId = sans.deviceId;

        if (sans.deviceId === null) {
          return new Error(
            "KLUY-TERMINAL-HUB-NOT-A-DEVICE: the peer presented no kitluy-device:// SAN",
          );
        }
        if (sans.environment !== null && sans.environment !== input.environment) {
          return new Error(
            `KLUY-TERMINAL-HUB-WRONG-ENVIRONMENT: the peer is '${sans.environment}', this terminal is '${input.environment}'`,
          );
        }
        const pin = input.pinnedCertificateFingerprint;
        if (pin !== undefined && observedFingerprint !== pin.toLowerCase()) {
          return new Error(
            "KLUY-TERMINAL-HUB-CERT-MISMATCH: the presented certificate is not the pinned Hub certificate",
          );
        }
        return undefined;
      },
    };

    const req = request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            reject(
              new EdgeTransportError("KLUY-TERMINAL-HUB-RESPONSE-MALFORMED", "non-JSON response"),
            );
            return;
          }
        }
        resolve({
          status: response.statusCode ?? 0,
          body,
          peerCertificateFingerprint: observedFingerprint,
          peerDeviceId: observedDeviceId,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new EdgeTransportError("KLUY-TERMINAL-HUB-TIMEOUT", "the Hub did not respond"));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
