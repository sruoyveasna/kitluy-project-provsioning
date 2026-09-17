/**
 * The edge bridge — how the POS on a Pi Terminal reaches its Store Hub without
 * ever holding the Terminal's operational private key.
 *
 * Authority: owner mission T1-STORE-OPERATIONS-001 §12-§13 and §19 ("operational
 * private key is never exposed to renderer JS"; "Pi Terminal performs normal
 * Store writes through Hub, not Supabase"); the Store Hub LAN API routes it
 * forwards (`services/kitluy-hub-agent/src/hub/edge/routes.ts`); the split this
 * service already makes with the Device Shell (`bin/terminal-edge.ts`).
 *
 * ===========================================================================
 * WHY A BRIDGE, AND WHY IN THIS PROCESS
 * ===========================================================================
 * The POS runs as `kitluy-terminal` with an empty CapabilityBoundingSet. The
 * operational key in /var/lib/kitluy/operational is 0700 root and must stay
 * that way. The POS desktop app was written to do mutual TLS itself with an
 * injected key, and its shipped key provider deliberately refuses.
 *
 * This process ALREADY holds the key, already finds the Hub, already verifies
 * the discovery record and pins the Hub's certificate, and already pairs. So it
 * answers the POS on a unix socket and makes the Hub request itself, over the
 * same pinned mutual-TLS client it uses for its own reads. The key never leaves
 * root; the Hub sees exactly the Terminal it would have seen.
 *
 * ===========================================================================
 * WHAT THE BRIDGE ADDS: NOTHING BUT A NARROWER DOOR
 * ===========================================================================
 * Every authorization decision stays on the Hub: the peer certificate, the
 * pairing receipt and its generation, the profile grant, containment, the staff
 * session and its permissions. The bridge grants no authority of its own.
 *
 * What it does do is REFUSE:
 *   - any route not on a closed list — pairing, activation, heartbeats and
 *     discovery are this service's own business and a kiosk process cannot
 *     reach them;
 *   - any header but the two the Hub routes read (the idempotency key and the
 *     staff session id; the transport sets its own content type);
 *   - any query string but the one the customer search takes;
 *   - any body larger than the Hub would accept, or that is not JSON;
 *   - any request before this service has a VERIFIED, PINNED Hub endpoint.
 *
 * The socket is 0660 root:kitluy-terminal inside a 0750 root:kitluy-terminal
 * directory: the Device Shell and the POS (both `kitluy-terminal`) can connect,
 * nothing else can.
 *
 * NOTHING A REQUEST CARRIES IS LOGGED. Intake bodies hold customer names and
 * phone numbers; the log names the route template and the status only.
 */
import { chmodSync, chownSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { EdgeStatus } from "./edge-session.js";
import {
  edgeRequest,
  readTransportCredentials,
  type CredentialsOutcome,
  type EdgeResponse,
} from "./edge-transport.js";

export const EDGE_BRIDGE_DIR = "/run/kitluy-terminal-edge";
export const EDGE_BRIDGE_SOCKET = `${EDGE_BRIDGE_DIR}/bridge.sock`;
/** The Device Shell's and the POS's user. The socket is group-owned by it. */
export const BRIDGE_CLIENT_GROUP = "kitluy-terminal";
export const BRIDGE_STATUS_PATH = "/bridge/v1/status";
/** Larger than any T1 intake body the Hub accepts; smaller than anything else. */
export const MAX_BRIDGE_REQUEST_BYTES = 64 * 1024;

export type BridgeMethod = "GET" | "POST" | "PATCH";

/** The Hub endpoint this service verified and pinned on its last attempt. */
export interface PinnedHubEndpoint {
  readonly host: string;
  readonly port: number;
  readonly certificateFingerprint: string;
  readonly hubDeviceId: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface BridgeRoute {
  readonly name: string;
  readonly method: BridgeMethod;
  readonly pattern: RegExp;
  /** The ONLY query parameters allowed; absent means none. */
  readonly query?: readonly string[];
}

/**
 * THE CLOSED LIST. The runtime bootstrap reads, the staff session door, and the
 * T1 intake routes (WS-12-T001 / T002) — nothing else.
 */
export const BRIDGE_ROUTES: readonly BridgeRoute[] = [
  { name: "authority-time", method: "GET", pattern: /^\/edge\/v1\/runtime\/authority-time$/u },
  { name: "eligibility", method: "GET", pattern: /^\/edge\/v1\/runtime\/eligibility$/u },
  { name: "configuration", method: "GET", pattern: /^\/edge\/v1\/configuration\/current$/u },
  { name: "sessions.open", method: "POST", pattern: /^\/edge\/v1\/sessions\/open$/u },
  { name: "sessions.refresh", method: "POST", pattern: /^\/edge\/v1\/sessions\/refresh$/u },
  { name: "sessions.close", method: "POST", pattern: /^\/edge\/v1\/sessions\/close$/u },
  {
    name: "customers.search",
    method: "GET",
    pattern: /^\/edge\/v1\/customers\/search$/u,
    query: ["phone"],
  },
  {
    name: "customers.read",
    method: "GET",
    pattern: new RegExp(`^/edge/v1/customers/${UUID}$`, "u"),
  },
  { name: "customers.create", method: "POST", pattern: /^\/edge\/v1\/customers$/u },
  {
    name: "customers.consent",
    method: "POST",
    pattern: new RegExp(`^/edge/v1/customers/${UUID}/consent-decisions$`, "u"),
  },
  {
    name: "drafts.create",
    method: "POST",
    pattern: /^\/edge\/v1\/laundry\/bookings\/drafts$/u,
  },
  {
    name: "drafts.read",
    method: "GET",
    pattern: new RegExp(`^/edge/v1/laundry/bookings/drafts/${UUID}$`, "u"),
  },
  {
    name: "drafts.update",
    method: "PATCH",
    pattern: new RegExp(`^/edge/v1/laundry/bookings/drafts/${UUID}$`, "u"),
  },
  {
    name: "drafts.cancel",
    method: "POST",
    pattern: new RegExp(`^/edge/v1/laundry/bookings/drafts/${UUID}/cancel$`, "u"),
  },
];

/** Request headers the Hub routes read. Every other header is dropped. */
export const FORWARDED_HEADERS: readonly string[] = ["idempotency-key", "x-kitluy-session-id"];

/** What the POS may know about the board it runs on. Public identifiers only. */
export interface BridgeTerminalFacts {
  readonly deviceId: string | null;
  readonly assignmentGeneration: number | null;
  readonly profileCodes: readonly string[];
}

export interface BridgeDependencies {
  readonly environment: string;
  readonly pinnedEndpoint: () => PinnedHubEndpoint | null;
  readonly latestStatus: () => EdgeStatus | null;
  readonly terminalFacts: () => BridgeTerminalFacts;
  readonly readCredentials?: () => CredentialsOutcome;
  readonly request?: typeof edgeRequest;
  readonly log?: (line: string) => void;
}

export interface BridgeRequest {
  readonly method: string;
  /** Path and query, as received. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Buffer;
}

export interface BridgeResponse {
  readonly status: number;
  readonly body: unknown;
}

function refusal(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): BridgeResponse {
  // The Hub's own envelope shape, so the POS classifies a bridge refusal with
  // the same `details.result` reader it uses for a Hub refusal.
  return { status, body: { error: { code, message, details: { result: code, retryable } } } };
}

type Matched =
  | { readonly ok: true; readonly route: BridgeRoute; readonly forwardPath: string }
  | { readonly ok: false; readonly response: BridgeResponse };

/** Match a request against the closed list. Pure, and exported for the tests. */
export function matchBridgeRoute(method: string, url: string): Matched {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://bridge.invalid");
  } catch {
    return {
      ok: false,
      response: refusal(400, "EDGE_BRIDGE_REQUEST_INVALID", "the request path is malformed", false),
    };
  }
  // A path is compared exactly as sent: `..`, `%2F` and friends never match a
  // pattern, so they are refused rather than normalised into one.
  const rawPath = url.split("?")[0] ?? "";
  const route = BRIDGE_ROUTES.find((r) => r.method === method && r.pattern.test(rawPath));
  if (route === undefined) {
    return {
      ok: false,
      response: refusal(
        404,
        "EDGE_BRIDGE_ROUTE_NOT_ALLOWED",
        "the edge bridge does not forward this route",
        false,
      ),
    };
  }
  const allowed = new Set(route.query ?? []);
  const keys = [...parsed.searchParams.keys()];
  if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) {
    return {
      ok: false,
      response: refusal(
        400,
        "EDGE_BRIDGE_REQUEST_INVALID",
        "the route does not take that query string",
        false,
      ),
    };
  }
  const query = keys.length === 0 ? "" : `?${parsed.searchParams.toString()}`;
  return { ok: true, route, forwardPath: `${rawPath}${query}` };
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value.length === 1 ? value[0] : undefined;
}

/**
 * One bridge request. Never throws: every failure is a response the POS can
 * classify.
 */
export async function handleBridgeRequest(
  deps: BridgeDependencies,
  request: BridgeRequest,
): Promise<BridgeResponse> {
  const log = deps.log ?? (() => undefined);

  if (request.method === "GET" && request.url === BRIDGE_STATUS_PATH) {
    const status = deps.latestStatus();
    const endpoint = deps.pinnedEndpoint();
    return {
      status: 200,
      body: {
        edge:
          status === null
            ? null
            : {
                phase: status.phase,
                detail: status.detail,
                checkedAt: status.checkedAt,
                ...(status.reads === undefined ? {} : { reads: status.reads }),
              },
        // Which Hub this bridge would talk to — the verified, pinned one — or
        // null. No certificate body, no key, no fingerprint of ours.
        hub:
          endpoint === null
            ? null
            : { hubDeviceId: endpoint.hubDeviceId, host: endpoint.host, port: endpoint.port },
        terminal: deps.terminalFacts(),
      },
    };
  }

  const matched = matchBridgeRoute(request.method, request.url);
  if (!matched.ok) {
    log(`refused ${request.method} (route not allowed)`);
    return matched.response;
  }
  const { route, forwardPath } = matched;

  let body: unknown;
  if (request.method !== "GET") {
    if (request.body.length > MAX_BRIDGE_REQUEST_BYTES) {
      return refusal(413, "EDGE_BRIDGE_REQUEST_INVALID", "the request body is too large", false);
    }
    try {
      body =
        request.body.length === 0 ? {} : (JSON.parse(request.body.toString("utf8")) as unknown);
    } catch {
      return refusal(400, "EDGE_BRIDGE_REQUEST_INVALID", "the request body is not JSON", false);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return refusal(
        400,
        "EDGE_BRIDGE_REQUEST_INVALID",
        "the request body is not an object",
        false,
      );
    }
  } else if (request.body.length > 0) {
    return refusal(400, "EDGE_BRIDGE_REQUEST_INVALID", "a GET carries no body", false);
  }

  const credentials = (deps.readCredentials ?? readTransportCredentials)();
  if (!credentials.available) {
    return refusal(
      503,
      "ACTIVATION_REQUIRED",
      "this terminal holds no operational certificate yet",
      true,
    );
  }
  const endpoint = deps.pinnedEndpoint();
  if (endpoint === null) {
    return refusal(
      503,
      "EDGE_NOT_CONNECTED",
      "no verified Store Hub endpoint yet; the terminal edge is still looking",
      true,
    );
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = headerValue(request.headers[name]);
    if (value !== undefined) headers[name] = value;
  }

  let response: EdgeResponse;
  try {
    response = await (deps.request ?? edgeRequest)({
      host: endpoint.host,
      port: endpoint.port,
      method: route.method,
      path: forwardPath,
      credentials: credentials.credentials,
      environment: deps.environment,
      // PINNED, always. The bridge never makes an unpinned request: the first,
      // unpinned discovery fetch is this service's own and is not forwardable.
      pinnedCertificateFingerprint: endpoint.certificateFingerprint,
      ...(body === undefined ? {} : { body }),
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const mismatch = message.includes("KLUY-TERMINAL-HUB-CERT-MISMATCH");
    log(`${route.name} -> transport failure${mismatch ? " (certificate mismatch)" : ""}`);
    return refusal(
      502,
      mismatch ? "HUB_CERT_MISMATCH" : "EDGE_HUB_UNREACHABLE",
      mismatch
        ? "the Store Hub presented a certificate other than the pinned one"
        : "the Store Hub did not answer over the pinned mutual-TLS link",
      !mismatch,
    );
  }
  // The pin already proved the certificate; this proves it is still the DEVICE
  // the discovery record named.
  if (response.peerDeviceId !== null && response.peerDeviceId !== endpoint.hubDeviceId) {
    log(`${route.name} -> refused (peer device mismatch)`);
    return refusal(502, "HUB_CERT_MISMATCH", "the pinned certificate names another device", false);
  }
  log(`${route.name} -> ${String(response.status)}`);
  return { status: response.status, body: response.body };
}

function readRequest(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BRIDGE_REQUEST_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(overflow ? null : Buffer.concat(chunks));
    });
    req.on("error", () => {
      resolve(null);
    });
  });
}

function send(res: ServerResponse, response: BridgeResponse): void {
  const text = JSON.stringify(response.body ?? null);
  res.writeHead(response.status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** The group id of `kitluy-terminal`, from /etc/group; null when absent. */
export function groupId(name: string, groupFile = "/etc/group"): number | null {
  try {
    for (const line of readFileSync(groupFile, "utf8").split("\n")) {
      const [group, , gid] = line.split(":");
      if (group === name && gid !== undefined && /^\d+$/u.test(gid)) return Number(gid);
    }
  } catch {
    // Unreadable: treated as absent, which fails closed below.
  }
  return null;
}

/**
 * Listen on the unix socket. Ownership is set BEFORE the mode widens, so there
 * is no window in which anyone but root can connect (the broker's discipline).
 * Without the client group the socket stays 0600 root: the POS then reports
 * the bridge unreachable, which is true, rather than the socket being opened to
 * everyone.
 */
export async function startEdgeBridge(
  deps: BridgeDependencies,
  options: {
    readonly socketPath?: string;
    readonly directory?: string;
    readonly group?: string;
    readonly groupFile?: string;
  } = {},
): Promise<Server> {
  const socketPath = options.socketPath ?? EDGE_BRIDGE_SOCKET;
  const directory = options.directory ?? EDGE_BRIDGE_DIR;
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((req, res) => {
    void readRequest(req).then(async (body) => {
      if (body === null) {
        send(
          res,
          refusal(413, "EDGE_BRIDGE_REQUEST_INVALID", "the request body is too large", false),
        );
        return;
      }
      send(
        res,
        await handleBridgeRequest(deps, {
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const gid = groupId(options.group ?? BRIDGE_CLIENT_GROUP, options.groupFile);
  if (gid === null) {
    chmodSync(socketPath, 0o600);
    deps.log?.(
      `bridge listening on ${socketPath} (group ${options.group ?? BRIDGE_CLIENT_GROUP} not found; root only)`,
    );
    return server;
  }
  try {
    // The owner stays whoever runs this — root on a device (the unit has no
    // User=), the test user in a test. Only the GROUP is changed.
    const uid = process.getuid?.() ?? 0;
    chownSync(directory, uid, gid);
    chmodSync(directory, 0o750);
    chownSync(socketPath, uid, gid);
    chmodSync(socketPath, 0o660);
    deps.log?.(
      `bridge listening on ${socketPath} for group ${options.group ?? BRIDGE_CLIENT_GROUP}`,
    );
  } catch {
    chmodSync(socketPath, 0o600);
    deps.log?.(`bridge listening on ${socketPath} (could not set group ownership; root only)`);
  }
  return server;
}
