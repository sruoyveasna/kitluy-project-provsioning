/**
 * Pinned Store-Hub LAN client — WS-12-T001.
 *
 * The terminal side of the P04A transport: TLS 1.3 only, the client
 * certificate presented for mutual authentication, and the SERVER identity
 * judged by certificate-fingerprint PINNING — the same discipline the
 * hub-agent LAN integration harness proved. Hostname verification is
 * replaced, not relaxed: a certificate whose SHA-256 differs from the pinned
 * fingerprint terminates the connection with `KLUY-TERMINAL-HUB-CERT-MISMATCH`
 * regardless of what any CA says.
 *
 * TRANSPORT CREDENTIALS ARE INJECTED. Production private-key custody is
 * BLK-005 material; the shipped default provider REFUSES, so no composition
 * can silently run mTLS on an unprotected key.
 */
import { createHash } from "node:crypto";
import { request, type RequestOptions } from "node:https";
import type { PeerCertificate } from "node:tls";

export interface TransportCredentials {
  readonly certificatePem: string;
  readonly keyPem: string;
  /** PEM of the CA that signs Hub server certificates (development chain). */
  readonly hubCaPem: string;
}

export interface TransportCredentialProvider {
  obtain(): TransportCredentials;
}

/** The shipped default: fail closed until real custody wiring exists. */
export function unavailableTransportCredentials(): TransportCredentialProvider {
  return {
    obtain(): TransportCredentials {
      throw new Error(
        "KLUY-TERMINAL-TRANSPORT-NO-CREDENTIALS: no transport credential custody is wired; " +
          "mTLS cannot be established (BLK-005 gates production key custody)",
      );
    },
  };
}

/** Pure pinning predicate — exported so the check itself is testable. */
export function serverCertificateMatchesPin(
  certificateDer: Buffer,
  pinnedFingerprint: string,
): boolean {
  const actual = createHash("sha256").update(certificateDer).digest("hex");
  return actual === pinnedFingerprint.toLowerCase();
}

export interface LanResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * One HTTPS request to the Hub with mutual TLS and a pinned server
 * certificate. Never follows redirects; never retries — retry policy belongs
 * to the caller, which knows which refusals are retryable.
 */
export function pinnedHubRequest(input: {
  readonly hostname: string;
  readonly port: number;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly pinnedCertificateFingerprint: string;
  readonly credentials: TransportCredentials;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}): Promise<LanResponse> {
  return new Promise((resolve, reject) => {
    const payload =
      input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body), "utf8");
    const options: RequestOptions = {
      hostname: input.hostname,
      port: input.port,
      method: input.method,
      path: input.path,
      cert: input.credentials.certificatePem,
      key: input.credentials.keyPem,
      ca: input.credentials.hubCaPem,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      timeout: input.timeoutMs ?? 10_000,
      headers: {
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json", "content-length": String(payload.length) }),
        ...input.headers,
      },
      checkServerIdentity: (_host: string, certificate: PeerCertificate): Error | undefined =>
        serverCertificateMatchesPin(certificate.raw, input.pinnedCertificateFingerprint)
          ? undefined
          : new Error(
              "KLUY-TERMINAL-HUB-CERT-MISMATCH: the presented server certificate is not the pinned Hub certificate",
            ),
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
            reject(new Error("KLUY-TERMINAL-HUB-RESPONSE-MALFORMED: non-JSON response body"));
            return;
          }
        }
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("KLUY-TERMINAL-HUB-TIMEOUT: the Hub did not respond in time"));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
