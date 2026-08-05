/**
 * Store LAN mTLS transport — WS-11-T004-P04B (§3, locked owner contract).
 *
 * HTTPS over HTTP/1.1 + JSON; TLS 1.3 ONLY (min and max pinned — a
 * downgraded handshake is refused by OpenSSL before any request exists);
 * MANDATORY client certificate (`requestCert` + `rejectUnauthorized`, so an
 * uncertified peer dies during the handshake, not in a handler); TCP 7443 by
 * default; loopback or an explicitly approved Store-LAN interface only — a
 * wildcard bind is REFUSED at construction, because "no public WAN ingress"
 * is a property this factory can hold structurally.
 *
 * WHAT THE TRANSPORT ASSERTS AND WHAT IT DOES NOT: a completed handshake
 * proves only that the peer holds the private key of a certificate signed by
 * the configured device CA. Certificate validity alone is INSUFFICIENT —
 * the router revalidates the projected terminal, credential status,
 * lifecycle and requested capability on every request (§3). The transport
 * therefore hands the router the OBSERVED peer identity (serial +
 * certificate SHA-256), never a decision.
 *
 * No private key, certificate body, or raw TLS material is ever logged.
 */
import { createServer, type Server } from "node:https";
import type { TLSSocket } from "node:tls";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { SafeLogger } from "../pairing.js";

/** The locked LAN port (owner package §3). Tests may use an ephemeral port. */
export const EDGE_TLS_PORT = 7443 as const;

/** Bounded body read — a LAN route must not be a memory-exhaustion surface. */
const MAX_BODY_BYTES = 64 * 1024;

const NO_LOG: SafeLogger = { info: () => undefined };

/** The authenticated peer as OBSERVED during the TLS handshake. Data, not a verdict. */
export interface EdgePeerIdentity {
  /** X.509 serial, normalized lowercase hex without separators. */
  readonly certificateSerial: string;
  /** SHA-256 of the client certificate DER, normalized lowercase hex. */
  readonly certificateFingerprint: string;
  readonly subjectCommonName: string;
}

export interface EdgeRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: string;
  readonly peer: EdgePeerIdentity;
}

export interface EdgeResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface EdgeRequestHandler {
  handle(request: EdgeRequest): Promise<EdgeResponse>;
}

export interface EdgeTlsServerOptions {
  /** PEM: Hub TLS server private key. Held by the transport only. */
  readonly key: string | Buffer;
  /** PEM: Hub TLS server certificate (the one discovery records fingerprint). */
  readonly cert: string | Buffer;
  /** PEM: the device CA bundle client certificates must chain to. */
  readonly clientCa: string | Buffer | Array<string | Buffer>;
  /**
   * The Store-LAN interface to bind. REQUIRED and explicit; the wildcard
   * addresses are refused — approved interfaces are named, never implied.
   */
  readonly bindHost: string;
  readonly port?: number;
  readonly handler: EdgeRequestHandler;
  readonly logger?: SafeLogger;
}

const FORBIDDEN_BINDS = new Set(["0.0.0.0", "::", "*", ""]);

function normalizeHex(value: string): string {
  return value.replace(/:/g, "").toLowerCase();
}

/**
 * Builds (without listening) the locked §3 server. `listen()` binds the
 * approved interface; anything reaching a handler has ALREADY presented a
 * CA-chained client certificate over TLS 1.3.
 */
export function createEdgeTlsServer(options: EdgeTlsServerOptions): {
  readonly server: Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
} {
  if (FORBIDDEN_BINDS.has(options.bindHost.trim())) {
    throw new Error(
      "KLUY-EDGE-TRANSPORT-BIND-REFUSED: the Store LAN listener binds an approved interface explicitly; wildcard/public ingress is not available (owner package §3)",
    );
  }
  const logger = options.logger ?? NO_LOG;
  const server = createServer(
    {
      key: options.key,
      cert: options.cert,
      ca: options.clientCa,
      // TLS 1.3 ONLY — min and max pinned (owner package §3).
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      // MANDATORY mutual TLS: no certificate, no handshake.
      requestCert: true,
      rejectUnauthorized: true,
    },
    (req: IncomingMessage, res: ServerResponse) => {
      void serve(req, res, options.handler, logger);
    },
  );
  return {
    server,
    listen(): Promise<{ port: number }> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? EDGE_TLS_PORT, options.bindHost, () => {
          const address = server.address();
          const port = typeof address === "object" && address !== null ? address.port : 0;
          logger.info({ operation: "edgeTlsListen", correlationId: "-", result: String(port) });
          resolve({ port });
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  handler: EdgeRequestHandler,
  logger: SafeLogger,
): Promise<void> {
  try {
    const socket = req.socket as TLSSocket;
    const peerCertificate = socket.getPeerCertificate(false);
    if (
      peerCertificate === null ||
      typeof peerCertificate !== "object" ||
      typeof peerCertificate.serialNumber !== "string" ||
      peerCertificate.serialNumber === ""
    ) {
      // Unreachable under rejectUnauthorized, held anyway: no identity, no route.
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "AUTHENTICATION_REQUIRED", message: "a client certificate is required" },
        }),
      );
      return;
    }
    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "the request body exceeds the bound" },
        }),
      );
      return;
    }
    const response = await handler.handle({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: req.headers,
      rawBody,
      peer: {
        certificateSerial: normalizeHex(peerCertificate.serialNumber),
        certificateFingerprint: normalizeHex(peerCertificate.fingerprint256 ?? ""),
        subjectCommonName: String(peerCertificate.subject?.CN ?? ""),
      },
    });
    res.writeHead(response.status, {
      "content-type": "application/json",
      ...(response.headers ?? {}),
    });
    res.end(JSON.stringify(response.body));
  } catch {
    // Nothing raw reaches the socket; the routes redact their own failures.
    logger.info({ operation: "edgeTlsServe", correlationId: "-", result: "INTERNAL_ERROR" });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(
      JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "the request could not be served" },
      }),
    );
  }
}

async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD") return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
