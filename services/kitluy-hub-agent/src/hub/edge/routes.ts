/**
 * Store LAN terminal routes — WS-11-T004-P04B (§3 lifecycle authorization,
 * §5 activation transport, §6 pairing transport).
 *
 * ===========================================================================
 * WHAT AUTHORIZES A REQUEST HERE
 * ===========================================================================
 * The mTLS handshake proves possession of a CA-chained certificate — and
 * NOTHING else (§3: certificate validity alone is insufficient). Every
 * request is then revalidated against the Hub's governed projections: the
 * peer's certificate serial must map to a projected terminal and a CURRENT
 * operational credential, the lifecycle matrix gates the capability, and the
 * governed doors re-derive scope, profile, generation and credential facts
 * once more inside their own transactions. A session route additionally
 * requires the authenticated terminal to OWN the session it names — another
 * terminal's valid certificate opens nothing.
 *
 * LIFECYCLE MATRIX (§3): credential issued but terminal not yet activated →
 * activation routes only; activated but unpaired → activation replay and
 * pairing; paired → pairing replay/receipt (operational routes are later
 * work); revoked, expired, replaced or mismatched → denied. Activation
 * TRUTH stays in the cloud (P03A): the Hub is an authenticated LAN gateway
 * through {@link CloudActivationGateway}, and the projected
 * `terminal_device.lifecycle_status` this matrix reads is exactly that — a
 * projection of cloud activation truth, delivered by the (still unbuilt)
 * cloud→Hub delivery path, never authored here.
 *
 * The pairing routes COMPOSE the proven P03B/P03C TerminalPairingComposition
 * — no pairing logic is recreated. The activation routes compose the cloud
 * authority through the gateway port; when the cloud is unreachable the
 * result is a RETRYABLE unavailability (this is provisioning, not normal
 * offline Store operation), while pairing keeps working from the Hub
 * database alone.
 *
 * Wire encoding: signatures and signing payloads travel as UNPADDED
 * base64url (§3 locked binary encoding); compositions speak standard base64
 * internally. Nothing here logs a nonce, signature, payload, certificate
 * body or key.
 */
import { randomUUID } from "node:crypto";

import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  type KitluyErrorCode,
} from "@kitluy/api-errors";
import {
  terminalPairingProofBytes,
  type PairingTranscript,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubPool } from "../db.js";
import { acceptTerminalHeartbeat, type TerminalHeartbeatBody } from "../terminal-health.js";
import type {
  TerminalPairingComposition,
  PairingChallengeMaterial,
  PairingSigner,
  SafeLogger,
} from "../pairing.js";
import {
  closeStaffSession,
  openStaffSession,
  readAuthorityTime,
  readCurrentConfigurationDelivery,
  readRuntimeEligibility,
  refreshStaffSession,
} from "./runtime-bootstrap.js";
import type { EdgeDiscoveryAuthority } from "./discovery.js";
import type { EdgeRequest, EdgeResponse, EdgeRequestHandler } from "./transport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const SIGNATURE_B64URL = /^[A-Za-z0-9_-]{1,120}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,96}$/;
const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
const MAX_PEM_CHARS = 1024;

export const WELL_KNOWN_DISCOVERY_PATH = "/.well-known/kitluy-edge-discovery/v1";
export const EDGE_ACTIVATION_CHALLENGES_PATH = "/edge/v1/terminal-activation/challenges";
export const EDGE_ACTIVATION_COMPLETE_PATH = "/edge/v1/terminal-activation/complete";
export const EDGE_PAIRING_SESSIONS_PATH = "/edge/v1/terminal-pairing/sessions";
export const EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH = "/edge/v1/terminal-health/heartbeats";
/** Route-level bound per the Edge API policy: a heartbeat is small telemetry. */
export const MAX_HEARTBEAT_BODY_BYTES = 4 * 1024;

// T1 bootstrap reads (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001; canonical
// literals mirrored in @kitluy/edge-contracts EDGE_RUNTIME_BOOTSTRAP_READ_PATHS).
export const EDGE_RUNTIME_AUTHORITY_TIME_PATH = "/edge/v1/runtime/authority-time";
export const EDGE_RUNTIME_ELIGIBILITY_PATH = "/edge/v1/runtime/eligibility";
export const EDGE_CONFIGURATION_CURRENT_PATH = "/edge/v1/configuration/current";

// Staff sessions (KLD-2026-07-26-002 Group 1 routes; permissions per
// Amendment 002). `sessions/switch` remains contract-only — not served here.
export const EDGE_SESSIONS_OPEN_PATH = "/edge/v1/sessions/open";
export const EDGE_SESSIONS_REFRESH_PATH = "/edge/v1/sessions/refresh";
export const EDGE_SESSIONS_CLOSE_PATH = "/edge/v1/sessions/close";

// ---------------------------------------------------------------------------
// The cloud activation gateway port (§5)
// ---------------------------------------------------------------------------

/**
 * The approved authenticated Hub-to-cloud service path for the P03A
 * activation authority. The HUB NEVER holds cloud database credentials
 * (§5: no direct production-database access) — a production implementation
 * speaks HTTPS to the cloud device-registry service under the Hub's own
 * service identity, whose authentication values remain BLK-006. Until those
 * exist, {@link unavailableActivationGateway} is the shipped default: every
 * call reports the cloud authority unreachable, which the routes surface as
 * a RETRYABLE unavailability.
 */
export interface CloudActivationGateway {
  prepareActivation(input: {
    readonly terminalAssignmentId: string;
    readonly redemptionIdempotencyKey: string;
  }): Promise<CloudActivationOutcome<CloudActivationChallenge>>;
  completeActivation(input: {
    readonly activationChallengeId: string;
    readonly signatureBase64: string;
    readonly terminalPublicKeyPem: string;
    readonly idempotencyKey: string;
  }): Promise<CloudActivationOutcome<CloudActivationState>>;
}

export interface CloudActivationOutcome<T> {
  /** The cloud composition's closed result vocabulary, passed through verbatim. */
  readonly result: string;
  readonly correlationId: string;
  readonly data?: T;
}

export interface CloudActivationChallenge {
  readonly activationChallengeId: string;
  readonly challengeVersion: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly certificateId: string;
  readonly certificateSerial: string;
  readonly certificateFingerprint: string;
  readonly terminalProfileKey: string;
  readonly signatureAlgorithm: string;
  readonly signingPayloadEncoding: string;
  /** Unpadded base64url of the exact kitluy.activation-ack.v1 bytes (P04A1 rule). */
  readonly signingPayload: string;
}

export interface CloudActivationState {
  readonly activationId: string;
  readonly certificateId: string;
  readonly acknowledgedAt: string;
  readonly activatedAt: string;
}

/** Thrown by a gateway that cannot reach the cloud authority. */
export class CloudActivationUnavailableError extends Error {
  constructor() {
    super("the cloud activation authority is unreachable");
    this.name = "CloudActivationUnavailableError";
  }
}

/** The shipped default: fails closed as UNREACHABLE until BLK-006 values exist. */
export function unavailableActivationGateway(): CloudActivationGateway {
  return {
    prepareActivation(): Promise<never> {
      return Promise.reject(new CloudActivationUnavailableError());
    },
    completeActivation(): Promise<never> {
      return Promise.reject(new CloudActivationUnavailableError());
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical error mapping
// ---------------------------------------------------------------------------

/**
 * Every composition/gateway refusal maps onto the canonical registry code.
 * Merged families stay merged (no row-existence oracle); the specific closed
 * result travels in `details.result`, exactly the P04A discipline.
 */
const CANONICAL_ERROR: Readonly<Record<string, KitluyErrorCode>> = {
  // shared
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // route-level authorization
  TERMINAL_NOT_RECOGNIZED: "DEVICE_NOT_ASSIGNED",
  // terminal-health heartbeats (WS-11-T005-P02)
  HEARTBEAT_REPLAY_REJECTED: "RESOURCE_VERSION_CONFLICT",
  HEARTBEAT_BODY_TOO_LARGE: "VALIDATION_FAILED",
  CREDENTIAL_NOT_CURRENT: "DEVICE_NOT_ASSIGNED",
  ACTIVATION_REQUIRED: "DEVICE_NOT_ASSIGNED",
  SESSION_NOT_OWNED: "SCOPE_PERMISSION_DENIED",
  // pairing families (P03B closed vocabulary)
  PAIR_VERSION_INCOMPATIBLE: "VALIDATION_FAILED",
  PAIR_ASSIGNMENT_MISMATCH: "SCOPE_PERMISSION_DENIED",
  PAIR_CERT_INVALID: "SCOPE_PERMISSION_DENIED",
  PAIR_HUB_NOT_ACTIVE: "DEPENDENCY_UNAVAILABLE",
  PAIR_DEVICE_NOT_ELIGIBLE: "DEVICE_NOT_ASSIGNED",
  PAIR_PROFILE_FORBIDDEN: "PROFILE_NOT_ALLOWED",
  PAIR_CHALLENGE_FAILED: "SCOPE_PERMISSION_DENIED",
  PAIR_CHALLENGE_EXPIRED: "RESOURCE_VERSION_CONFLICT",
  PAIR_NONCE_REJECTED: "RESOURCE_VERSION_CONFLICT",
  PAIR_SESSION_OUTSTANDING: "RESOURCE_VERSION_CONFLICT",
  PAIR_SESSION_UNKNOWN: "RESOURCE_NOT_FOUND",
  PAIR_SESSION_CONSUMED: "RESOURCE_VERSION_CONFLICT",
  PAIR_PROOF_REQUIRED: "RESOURCE_VERSION_CONFLICT",
  PAIR_TRANSCRIPT_CONFLICT: "RESOURCE_VERSION_CONFLICT",
  RECEIPT_NOT_FOUND: "RESOURCE_NOT_FOUND",
  // activation families (cloud closed vocabulary, passed through the gateway)
  ACTIVATION_ACK_INVALID: "SCOPE_PERMISSION_DENIED",
  ACTIVATION_CHALLENGE_EXPIRED: "RESOURCE_VERSION_CONFLICT",
  ACTIVATION_CHALLENGE_CONSUMED: "RESOURCE_VERSION_CONFLICT",
  CREDENTIAL_INELIGIBLE: "SCOPE_PERMISSION_DENIED",
  REDEMPTION_REQUIRED: "RESOURCE_VERSION_CONFLICT",
  CHALLENGE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  HUB_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ASSIGNMENT_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ENROLLMENT_INELIGIBLE: "SCOPE_PERMISSION_DENIED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  PKI_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  CLOUD_UNAVAILABLE: "HUB_UNREACHABLE",
  // T1 runtime eligibility (WS-12-T001-P02 closed vocabulary)
  HUB_NOT_OPERATIONAL: "DEPENDENCY_UNAVAILABLE",
  HUB_RETIRED: "DEVICE_NOT_ASSIGNED",
  HUB_REPLACEMENT_BLOCKED: "DEPENDENCY_UNAVAILABLE",
  HUB_ASSIGNMENT_MISSING: "DEPENDENCY_UNAVAILABLE",
  ASSIGNMENT_SCOPE_MISMATCH: "SCOPE_PERMISSION_DENIED",
  ASSIGNMENT_GENERATION_STALE: "RESOURCE_VERSION_CONFLICT",
  PAIRING_REQUIRED: "DEVICE_NOT_ASSIGNED",
  PROFILE_NOT_GRANTED: "PROFILE_NOT_ALLOWED",
  PROFILE_NOT_T1: "PROFILE_NOT_ALLOWED",
  CONTAINMENT_PROHIBITS: "DEVICE_NOT_ASSIGNED",
  CONFIGURATION_MISSING: "DEPENDENCY_UNAVAILABLE",
  DELIVERY_SIGNER_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  // staff sessions (WS-12-T001-P02 closed vocabulary)
  STAFF_UNKNOWN: "AUTHENTICATION_REQUIRED",
  STAFF_DISABLED: "AUTHENTICATION_REQUIRED",
  STAFF_CREDENTIAL_INVALID: "AUTHENTICATION_REQUIRED",
  STAFF_SCOPE_MISMATCH: "SCOPE_PERMISSION_DENIED",
  STAFF_PROFILE_NOT_AUTHORIZED: "PROFILE_NOT_ALLOWED",
  SESSION_PERMISSION_DENIED: "SCOPE_PERMISSION_DENIED",
  SESSION_OCCUPIED: "RESOURCE_VERSION_CONFLICT",
  SESSION_UNKNOWN: "RESOURCE_NOT_FOUND",
  SESSION_EXPIRED: "AUTHENTICATION_REQUIRED",
  SESSION_CLOSED: "RESOURCE_VERSION_CONFLICT",
};

const CANONICAL_MESSAGE: Readonly<Partial<Record<KitluyErrorCode, string>>> = {
  VALIDATION_FAILED: "the request is invalid",
  AUTHENTICATION_REQUIRED: "staff authentication is required or the session is not usable",
  DEVICE_NOT_ASSIGNED: "the authenticated terminal is not eligible for this capability",
  PROFILE_NOT_ALLOWED: "the requested terminal profile is not granted",
  SCOPE_PERMISSION_DENIED: "the presented authority was refused",
  RESOURCE_VERSION_CONFLICT: "the flow has moved past this request",
  RESOURCE_NOT_FOUND: "no such resource",
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST:
    "the idempotency key was already used with a different request",
  DEPENDENCY_UNAVAILABLE: "a required authority is unavailable",
  HUB_UNREACHABLE: "the cloud activation authority is unreachable; retry later",
  INTERNAL_ERROR: "the operation failed and the details are not disclosed",
};

function refusal(result: string, correlationId: string): EdgeResponse {
  const code = CANONICAL_ERROR[result] ?? "INTERNAL_ERROR";
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      details: { result, retryable: isRetryable(code) },
    }),
  };
}

function invalid(
  correlationId: string,
  detail: string,
  fields: readonly string[] = [],
): EdgeResponse {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: {
        result: "REQUEST_INVALID",
        retryable: false,
        ...(fields.length > 0 ? { fields: fields.slice(0, 16) } : {}),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Body plumbing
// ---------------------------------------------------------------------------

function parseBody(rawBody: string): Record<string, unknown> | null {
  if (rawBody === "") return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function contentTypeIsJson(headers: EdgeRequest["headers"], method: string): boolean {
  if (method === "GET") return true;
  const raw = headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && /^application\/json\s*(;.*)?$/i.test(value.trim());
}

function unknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): readonly string[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => key.slice(0, 64));
}

function requireShaped(body: Record<string, unknown>, key: string, shape: RegExp): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return shape.test(trimmed) ? trimmed : null;
}

function idempotencyKeyFrom(headers: EdgeRequest["headers"]): string | null {
  const raw = headers["idempotency-key"];
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => v.trim());
  if (values.length === 0 || new Set(values).size > 1) return null;
  const key = values[0] ?? "";
  return IDEMPOTENCY_KEY.test(key) ? key : null;
}

/** Unpadded base64url (the LAN wire form) to the compositions' standard base64. */
function base64UrlToBase64(value: string): string {
  const translated = value.replace(/-/g, "+").replace(/_/g, "/");
  return translated + "=".repeat((4 - (translated.length % 4)) % 4);
}
function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// The per-request authorization gate (§3)
// ---------------------------------------------------------------------------

interface AuthorizedTerminal {
  readonly terminalDeviceId: string;
  readonly certificateSerial: string;
  readonly lifecycleStatus: string;
  /** The projection of CLOUD activation truth (never authored on the Hub). */
  readonly activated: boolean;
}

type GateOutcome =
  | { readonly ok: true; readonly terminal: AuthorizedTerminal }
  | { readonly ok: false; readonly result: string };

/**
 * Maps the OBSERVED mTLS peer onto the projected terminal and credential.
 * Merged refusals on purpose: an unknown serial, a foreign serial and an
 * ineligible credential all answer identically, so the LAN carries no
 * row-existence oracle. The governed doors re-derive everything again.
 */
async function authorizePeer(pool: HubPool, certificateSerial: string): Promise<GateOutcome> {
  interface Row {
    readonly id: string;
    readonly lifecycle_status: string;
    readonly cred_status: string;
    readonly revoked: boolean;
    readonly expired: boolean;
  }
  const rows = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query<Row>(
        `select t.id, t.lifecycle_status, c.status as cred_status,
                (c.revoked_at is not null) as revoked,
                (c.expires_at <= now()) as expired
           from edge_identity.terminal_device t
           join edge_identity.device_credential c
             on c.certificate_serial = t.certificate_serial
          where t.certificate_serial = $1`,
        [certificateSerial],
      );
      return result.rows;
    },
    HUB_RUNTIME_ROLE,
  );
  const row = rows[0];
  if (row === undefined) return { ok: false, result: "TERMINAL_NOT_RECOGNIZED" };
  if (row.lifecycle_status === "revoked" || row.lifecycle_status === "retired") {
    return { ok: false, result: "TERMINAL_NOT_RECOGNIZED" };
  }
  if (row.cred_status !== "active" || row.revoked || row.expired) {
    return { ok: false, result: "CREDENTIAL_NOT_CURRENT" };
  }
  return {
    ok: true,
    terminal: {
      terminalDeviceId: row.id,
      certificateSerial,
      lifecycleStatus: row.lifecycle_status,
      activated: row.lifecycle_status === "active",
    },
  };
}

/** A session route additionally requires the caller to OWN the session. */
async function sessionOwnedBy(
  pool: HubPool,
  sessionId: string,
  terminalDeviceId: string,
): Promise<"owned" | "foreign" | "unknown"> {
  const rows = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query<{ terminal_device_id: string }>(
        `select terminal_device_id from edge_identity.pairing_session where id = $1::uuid`,
        [sessionId],
      );
      return result.rows;
    },
    HUB_RUNTIME_ROLE,
  );
  const row = rows[0];
  if (row === undefined) return "unknown";
  return row.terminal_device_id === terminalDeviceId ? "owned" : "foreign";
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export interface EdgeTerminalRouterDeps {
  readonly pool: HubPool;
  /** Hub environment for outbound fleet reports; development in local runs. */
  readonly environment?: string;
  readonly pairing: TerminalPairingComposition;
  readonly activationGateway: CloudActivationGateway;
  readonly discovery: EdgeDiscoveryAuthority;
  /**
   * Signs per-terminal configuration DELIVERIES with the Hub operational
   * key (WS-12-T001-P02 §3). Absent → the configuration route fails closed
   * with DELIVERY_SIGNER_UNAVAILABLE; nothing is delivered unsigned.
   */
  readonly deliverySigner?: PairingSigner;
  readonly logger?: SafeLogger;
}

const NO_LOG: SafeLogger = { info: () => undefined };

/** The locked pairing challenge lifetime (owner package §6); the 0032 door clamps too. */
export const PAIRING_CHALLENGE_LIFETIME_SECONDS = 300 as const;

type Matched =
  | {
      readonly route:
        | "discovery"
        | "activation-challenges"
        | "activation-complete"
        | "pairing-sessions"
        | "terminal-health-heartbeats"
        | "runtime-authority-time"
        | "runtime-eligibility"
        | "configuration-current"
        | "sessions-open"
        | "sessions-refresh"
        | "sessions-close";
    }
  | {
      readonly route: "pairing-proof" | "pairing-complete" | "pairing-receipt";
      readonly sessionId: string;
    };

function matchRoute(method: string, path: string): Matched | "METHOD_NOT_ALLOWED" | null {
  const clean = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (clean === WELL_KNOWN_DISCOVERY_PATH) {
    return method === "GET" ? { route: "discovery" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_ACTIVATION_CHALLENGES_PATH) {
    return method === "POST" ? { route: "activation-challenges" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_ACTIVATION_COMPLETE_PATH) {
    return method === "POST" ? { route: "activation-complete" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_PAIRING_SESSIONS_PATH) {
    return method === "POST" ? { route: "pairing-sessions" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH) {
    return method === "POST" ? { route: "terminal-health-heartbeats" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_RUNTIME_AUTHORITY_TIME_PATH) {
    return method === "GET" ? { route: "runtime-authority-time" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_RUNTIME_ELIGIBILITY_PATH) {
    return method === "GET" ? { route: "runtime-eligibility" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_CONFIGURATION_CURRENT_PATH) {
    return method === "GET" ? { route: "configuration-current" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_OPEN_PATH) {
    return method === "POST" ? { route: "sessions-open" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_REFRESH_PATH) {
    return method === "POST" ? { route: "sessions-refresh" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === EDGE_SESSIONS_CLOSE_PATH) {
    return method === "POST" ? { route: "sessions-close" } : "METHOD_NOT_ALLOWED";
  }
  const sub =
    /^\/edge\/v1\/terminal-pairing\/sessions\/([^/]+)\/(terminal-proof|complete|receipt)$/.exec(
      clean,
    );
  if (sub !== null) {
    const sessionId = sub[1] ?? "";
    if (!UUID.test(sessionId)) return null;
    const tail = sub[2];
    if (tail === "terminal-proof") {
      return method === "POST" ? { route: "pairing-proof", sessionId } : "METHOD_NOT_ALLOWED";
    }
    if (tail === "complete") {
      return method === "POST" ? { route: "pairing-complete", sessionId } : "METHOD_NOT_ALLOWED";
    }
    return method === "GET" ? { route: "pairing-receipt", sessionId } : "METHOD_NOT_ALLOWED";
  }
  return null;
}

export function createEdgeTerminalRouter(deps: EdgeTerminalRouterDeps): EdgeRequestHandler {
  const logger = deps.logger ?? NO_LOG;

  function log(operation: string, correlationId: string, status: number, result: string): void {
    logger.info({ operation, correlationId, status, result });
  }

  return {
    async handle(request: EdgeRequest): Promise<EdgeResponse> {
      const correlationId = randomUUID();
      const finish = (operation: string, response: EdgeResponse, result: string): EdgeResponse => {
        log(operation, correlationId, response.status, result);
        return response;
      };

      const matched = matchRoute(request.method, request.path);
      if (matched === null) {
        return finish(
          "edge:unmatched",
          {
            status: httpStatusFor("RESOURCE_NOT_FOUND"),
            body: errorEnvelope("RESOURCE_NOT_FOUND", "no such route", { correlationId }),
          },
          "RESOURCE_NOT_FOUND",
        );
      }
      if (matched === "METHOD_NOT_ALLOWED") {
        return finish(
          "edge:unmatched",
          {
            status: 405,
            body: errorEnvelope("VALIDATION_FAILED", "method not allowed", { correlationId }),
          },
          "METHOD_NOT_ALLOWED",
        );
      }
      const operation = `edge:${matched.route}`;

      // The signed discovery record is served to ANY CA-authenticated peer:
      // it exists to be verified BEFORE deeper trust, and it carries only
      // what the record binds.
      if (matched.route === "discovery") {
        return finish(
          operation,
          { status: 200, body: deps.discovery.wellKnownPayload() },
          "SIGNED_RECORD",
        );
      }

      if (!contentTypeIsJson(request.headers, request.method)) {
        return finish(
          operation,
          invalid(correlationId, "Content-Type must be application/json"),
          "REQUEST_INVALID",
        );
      }
      const body = parseBody(request.rawBody);
      if (body === null) {
        return finish(
          operation,
          invalid(correlationId, "a JSON object body is required"),
          "REQUEST_INVALID",
        );
      }

      // §3: certificate validity alone is insufficient — every request maps
      // the peer onto the projected terminal and credential first.
      const gate = await authorizePeer(deps.pool, request.peer.certificateSerial);
      if (!gate.ok) {
        return finish(operation, refusal(gate.result, correlationId), gate.result);
      }
      const terminal = gate.terminal;

      // The bootstrap reads and session routes refuse query parameters
      // outright — the unknown-fields discipline applied to the URL.
      const queryString = request.path.split("?")[1] ?? "";
      const environment = deps.environment ?? "development";

      try {
        switch (matched.route) {
          case "runtime-authority-time": {
            if (queryString !== "") {
              return finish(
                operation,
                invalid(correlationId, "query parameters are not accepted"),
                "REQUEST_INVALID",
              );
            }
            const payload = await readAuthorityTime(deps.pool);
            return finish(
              operation,
              { status: 200, body: { result: "AUTHORITY_TIME", correlationId, ...payload } },
              "AUTHORITY_TIME",
            );
          }
          case "runtime-eligibility": {
            if (queryString !== "") {
              return finish(
                operation,
                invalid(correlationId, "query parameters are not accepted"),
                "REQUEST_INVALID",
              );
            }
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            const eligibility = await readRuntimeEligibility(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment,
            );
            if (eligibility.outcome === "refused") {
              return finish(
                operation,
                refusal(eligibility.refusal, correlationId),
                eligibility.refusal,
              );
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: "ELIGIBLE", correlationId, eligibility: eligibility.payload },
              },
              "ELIGIBLE",
            );
          }
          case "configuration-current": {
            if (queryString !== "") {
              return finish(
                operation,
                invalid(correlationId, "query parameters are not accepted"),
                "REQUEST_INVALID",
              );
            }
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            if (deps.deliverySigner === undefined) {
              return finish(
                operation,
                refusal("DELIVERY_SIGNER_UNAVAILABLE", correlationId),
                "DELIVERY_SIGNER_UNAVAILABLE",
              );
            }
            const delivery = await readCurrentConfigurationDelivery(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment,
              deps.deliverySigner,
              correlationId,
            );
            if (delivery.outcome === "refused") {
              return finish(operation, refusal(delivery.refusal, correlationId), delivery.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: "CONFIGURATION_DELIVERY", correlationId, ...delivery.body },
              },
              "CONFIGURATION_DELIVERY",
            );
          }
          case "sessions-open": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            const idempotencyKey = idempotencyKeyFrom(request.headers);
            if (idempotencyKey === null) {
              return finish(
                operation,
                invalid(correlationId, "an Idempotency-Key header is required"),
                "REQUEST_INVALID",
              );
            }
            const unknown = unknownFields(body, ["actorId", "passcode", "profileCode"]);
            if (unknown.length > 0) {
              return finish(
                operation,
                invalid(correlationId, "unknown fields", unknown),
                "REQUEST_INVALID",
              );
            }
            const actorId = requireShaped(body, "actorId", UUID);
            const profileCode = requireShaped(body, "profileCode", PROFILE);
            const passcode = typeof body["passcode"] === "string" ? body["passcode"] : null;
            if (
              actorId === null ||
              profileCode === null ||
              passcode === null ||
              passcode.length < 4 ||
              passcode.length > 128
            ) {
              return finish(
                operation,
                invalid(
                  correlationId,
                  "actorId, passcode and profileCode are required and bounded",
                ),
                "REQUEST_INVALID",
              );
            }
            // The same eligibility family the bootstrap reads prove — a
            // terminal that cannot operate cannot open a staff session.
            const gateResult = await readRuntimeEligibility(
              deps.pool,
              terminal.terminalDeviceId,
              terminal.certificateSerial,
              environment,
            );
            if (gateResult.outcome === "refused") {
              return finish(
                operation,
                refusal(gateResult.refusal, correlationId),
                gateResult.refusal,
              );
            }
            const opened = await openStaffSession(deps.pool, {
              terminalDeviceId: terminal.terminalDeviceId,
              actorId,
              passcode,
              profileCode,
            });
            if (opened.outcome === "refused") {
              return finish(operation, refusal(opened.refusal, correlationId), opened.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: opened.result, correlationId, session: opened.session },
              },
              opened.result,
            );
          }
          case "sessions-refresh":
          case "sessions-close": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            const idempotencyKey = idempotencyKeyFrom(request.headers);
            if (idempotencyKey === null) {
              return finish(
                operation,
                invalid(correlationId, "an Idempotency-Key header is required"),
                "REQUEST_INVALID",
              );
            }
            const unknown = unknownFields(body, ["sessionId"]);
            if (unknown.length > 0) {
              return finish(
                operation,
                invalid(correlationId, "unknown fields", unknown),
                "REQUEST_INVALID",
              );
            }
            const sessionId = requireShaped(body, "sessionId", UUID);
            if (sessionId === null) {
              return finish(
                operation,
                invalid(correlationId, "sessionId is required"),
                "REQUEST_INVALID",
              );
            }
            const action =
              matched.route === "sessions-refresh" ? refreshStaffSession : closeStaffSession;
            const outcome = await action(deps.pool, {
              terminalDeviceId: terminal.terminalDeviceId,
              sessionId,
            });
            if (outcome.outcome === "refused") {
              return finish(operation, refusal(outcome.refusal, correlationId), outcome.refusal);
            }
            return finish(
              operation,
              {
                status: 200,
                body: { result: outcome.result, correlationId, session: outcome.session },
              },
              outcome.result,
            );
          }
          case "activation-challenges":
            return finish(
              operation,
              await handleActivationChallenges(deps, body, correlationId),
              "HANDLED",
            );
          case "activation-complete":
            return finish(
              operation,
              await handleActivationComplete(deps, request, body, correlationId),
              "HANDLED",
            );
          case "terminal-health-heartbeats":
            return finish(
              operation,
              await handleTerminalHealthHeartbeat(deps, terminal, request, body, correlationId),
              "HANDLED",
            );
          case "pairing-sessions": {
            // LIFECYCLE MATRIX: pairing requires the ACTIVATED projection.
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            return finish(
              operation,
              await handlePairingSessions(deps, terminal, body, correlationId),
              "HANDLED",
            );
          }
          case "pairing-proof":
          case "pairing-complete":
          case "pairing-receipt": {
            if (!terminal.activated) {
              return finish(
                operation,
                refusal("ACTIVATION_REQUIRED", correlationId),
                "ACTIVATION_REQUIRED",
              );
            }
            const ownership = await sessionOwnedBy(
              deps.pool,
              matched.sessionId,
              terminal.terminalDeviceId,
            );
            if (ownership === "unknown") {
              return finish(
                operation,
                refusal("PAIR_SESSION_UNKNOWN", correlationId),
                "PAIR_SESSION_UNKNOWN",
              );
            }
            if (ownership === "foreign") {
              // Merged with unknown at the canonical layer? Deliberately NOT:
              // the caller ALREADY proved a valid certificate, and the 403
              // names no other row — but a foreign session id must never act.
              return finish(
                operation,
                refusal("SESSION_NOT_OWNED", correlationId),
                "SESSION_NOT_OWNED",
              );
            }
            if (matched.route === "pairing-proof") {
              return finish(
                operation,
                await handlePairingProof(deps, matched.sessionId, body, correlationId),
                "HANDLED",
              );
            }
            if (matched.route === "pairing-complete") {
              return finish(
                operation,
                await handlePairingComplete(deps, matched.sessionId, body, correlationId),
                "HANDLED",
              );
            }
            return finish(
              operation,
              await handlePairingReceipt(deps, matched.sessionId, correlationId),
              "HANDLED",
            );
          }
        }
      } catch (error) {
        if (error instanceof CloudActivationUnavailableError) {
          // §5: a RETRYABLE unavailability while the cloud authority is
          // unreachable — provisioning waits; it never fabricates.
          return finish(
            operation,
            refusal("CLOUD_UNAVAILABLE", correlationId),
            "CLOUD_UNAVAILABLE",
          );
        }
        return finish(operation, refusal("INTERNAL_ERROR", correlationId), "INTERNAL_ERROR");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Activation handlers (§5) — the Hub as authenticated LAN gateway
// ---------------------------------------------------------------------------

const ACTIVATION_CHALLENGE_FIELDS = ["terminalAssignmentId", "redemptionIdempotencyKey"] as const;

async function handleActivationChallenges(
  deps: EdgeTerminalRouterDeps,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  const unknown = unknownFields(body, ACTIVATION_CHALLENGE_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const terminalAssignmentId = requireShaped(body, "terminalAssignmentId", UUID);
  const redemptionIdempotencyKey = requireShaped(body, "redemptionIdempotencyKey", IDEMPOTENCY_KEY);
  const missing = [
    ...(terminalAssignmentId === null ? ["terminalAssignmentId"] : []),
    ...(redemptionIdempotencyKey === null ? ["redemptionIdempotencyKey"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.activationGateway.prepareActivation({
    terminalAssignmentId: terminalAssignmentId as string,
    redemptionIdempotencyKey: redemptionIdempotencyKey as string,
  });
  if (outcome.result === "ALREADY_ACTIVATED") {
    return { status: 200, body: { result: "ALREADY_ACTIVATED", correlationId } };
  }
  if (outcome.result !== "ACTIVATION_PREPARED" || outcome.data === undefined) {
    return refusal(outcome.result, correlationId);
  }
  const challenge = outcome.data;
  // The P04A1 discipline: ONE opaque signable payload; the terminal signs
  // exactly these bytes and reconstructs nothing.
  return {
    status: 201,
    body: {
      result: "ACTIVATION_PREPARED",
      correlationId,
      challenge: {
        activationChallengeId: challenge.activationChallengeId,
        protocolVersion: challenge.challengeVersion,
        signatureAlgorithm: challenge.signatureAlgorithm,
        signingPayloadEncoding: challenge.signingPayloadEncoding,
        signingPayload: challenge.signingPayload,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        certificateId: challenge.certificateId,
        certificateSerial: challenge.certificateSerial,
        certificateFingerprint: challenge.certificateFingerprint,
        terminalProfileKey: challenge.terminalProfileKey,
      },
    },
  };
}

const ACTIVATION_COMPLETE_FIELDS = [
  "activationChallengeId",
  "protocolVersion",
  "signature",
  "terminalPublicKeyPem",
] as const;

const ACTIVATION_PROTOCOL_VERSION = "kitluy.activation-ack.v1";

async function handleActivationComplete(
  deps: EdgeTerminalRouterDeps,
  request: EdgeRequest,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  const unknown = unknownFields(body, ACTIVATION_COMPLETE_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  if (body["protocolVersion"] !== ACTIVATION_PROTOCOL_VERSION) {
    return invalid(correlationId, "unsupported activation protocol version", ["protocolVersion"]);
  }
  const activationChallengeId = requireShaped(body, "activationChallengeId", UUID);
  const signature = requireShaped(body, "signature", SIGNATURE_B64URL);
  const pemRaw = body["terminalPublicKeyPem"];
  const terminalPublicKeyPem =
    typeof pemRaw === "string" &&
    pemRaw.length <= MAX_PEM_CHARS &&
    pemRaw.includes("BEGIN PUBLIC KEY") &&
    pemRaw.includes("END PUBLIC KEY")
      ? pemRaw
      : null;
  const idempotencyKey = idempotencyKeyFrom(request.headers);
  const missing = [
    ...(activationChallengeId === null ? ["activationChallengeId"] : []),
    ...(signature === null ? ["signature"] : []),
    ...(terminalPublicKeyPem === null ? ["terminalPublicKeyPem"] : []),
    ...(idempotencyKey === null ? ["idempotency-key"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.activationGateway.completeActivation({
    activationChallengeId: activationChallengeId as string,
    signatureBase64: base64UrlToBase64(signature as string),
    terminalPublicKeyPem: terminalPublicKeyPem as string,
    idempotencyKey: idempotencyKey as string,
  });
  if (
    (outcome.result === "ACTIVATED" || outcome.result === "ALREADY_ACTIVATED") &&
    outcome.data !== undefined
  ) {
    return {
      status: 200,
      body: {
        result: outcome.result,
        correlationId,
        activation: {
          activationId: outcome.data.activationId,
          certificateId: outcome.data.certificateId,
          acknowledgedAt: outcome.data.acknowledgedAt,
          activatedAt: outcome.data.activatedAt,
        },
      },
    };
  }
  return refusal(outcome.result, correlationId);
}

// ---------------------------------------------------------------------------
// Pairing handlers (§6) — composing the proven P03B/P03C authority
// ---------------------------------------------------------------------------

const PAIRING_SESSION_FIELDS = [
  "requestedProfileCode",
  "terminalNonce",
  "protocolVersion",
  "environment",
] as const;

function transcriptFromChallenge(c: PairingChallengeMaterial): PairingTranscript {
  return {
    pairingSessionId: c.pairingSessionId,
    protocolVersion: c.protocolVersion,
    purpose: c.purpose,
    tenantId: c.tenantId,
    digitalStoreId: c.digitalStoreId,
    storeLocationId: c.storeLocationId,
    environment: c.environment as TrustEnvironment,
    hubDeviceId: c.hubDeviceId,
    hubAssignmentGeneration: c.hubAssignmentGeneration,
    hubCertificateSerial: c.hubCertificateSerial,
    hubCertificateFingerprint: c.hubCertificateFingerprint,
    terminalDeviceId: c.terminalDeviceId,
    terminalAssignmentGeneration: c.terminalAssignmentGeneration,
    terminalProfileKey: c.terminalProfileKey,
    terminalCertificateSerial: c.terminalCertificateSerial,
    terminalCertificateFingerprint: c.terminalCertificateFingerprint,
    terminalNonce: c.terminalNonce,
    hubNonce: c.hubNonce,
    issuedAt: new Date(c.issuedAt),
    expiresAt: new Date(c.expiresAt),
  };
}

async function handlePairingSessions(
  deps: EdgeTerminalRouterDeps,
  terminal: AuthorizedTerminal,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  const unknown = unknownFields(body, PAIRING_SESSION_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const requestedProfileCode = requireShaped(body, "requestedProfileCode", PROFILE);
  const terminalNonce = requireShaped(body, "terminalNonce", HEX64);
  const protocolVersion = requireShaped(body, "protocolVersion", /^[0-9.]{1,16}$/);
  const environment = requireShaped(body, "environment", /^(development|pilot|production)$/);
  const missing = [
    ...(requestedProfileCode === null ? ["requestedProfileCode"] : []),
    ...(terminalNonce === null ? ["terminalNonce"] : []),
    ...(protocolVersion === null ? ["protocolVersion"] : []),
    ...(environment === null ? ["environment"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.pairing.preparePairing({
    // THE AUTHENTICATED TERMINAL — never a body field. A terminal pairs as
    // the device its certificate proves, or not at all.
    terminalDeviceId: terminal.terminalDeviceId,
    requestedProfileCode: requestedProfileCode as string,
    terminalNonce: terminalNonce as string,
    protocolVersion: protocolVersion as string,
    environment: environment as string,
    // The locked lifetime. The 0032 door clamps to 300 s of HUB-authoritative
    // time regardless of this process's clock — no skew grace.
    expiresAt: new Date(Date.now() + PAIRING_CHALLENGE_LIFETIME_SECONDS * 1000),
  });
  if (outcome.result !== "PAIRING_PREPARED" || outcome.data === undefined) {
    return refusal(outcome.result, correlationId);
  }
  const challenge = outcome.data;
  // The P04A1 discipline applied to the pairing hello: the terminal signs
  // the EXACT canonical terminal-proof bytes, shipped as one opaque value.
  const signingPayload = Buffer.from(
    terminalPairingProofBytes(transcriptFromChallenge(challenge)),
  ).toString("base64url");
  return {
    status: 201,
    body: {
      result: "PAIRING_PREPARED",
      correlationId,
      session: {
        ...challenge,
        signatureAlgorithm: "ed25519",
        signingPayloadEncoding: "base64url",
        signingPayload,
      },
    },
  };
}

const PAIRING_PROOF_FIELDS = ["signature", "terminalPublicKeyPem"] as const;

async function handlePairingProof(
  deps: EdgeTerminalRouterDeps,
  sessionId: string,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  const unknown = unknownFields(body, PAIRING_PROOF_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const signature = requireShaped(body, "signature", SIGNATURE_B64URL);
  const pemRaw = body["terminalPublicKeyPem"];
  const terminalPublicKeyPem =
    typeof pemRaw === "string" &&
    pemRaw.length <= MAX_PEM_CHARS &&
    pemRaw.includes("BEGIN PUBLIC KEY") &&
    pemRaw.includes("END PUBLIC KEY")
      ? pemRaw
      : null;
  const missing = [
    ...(signature === null ? ["signature"] : []),
    ...(terminalPublicKeyPem === null ? ["terminalPublicKeyPem"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }
  const outcome = await deps.pairing.verifyTerminalProofAndRecord({
    pairingSessionId: sessionId,
    signatureBase64: base64UrlToBase64(signature as string),
    terminalPublicKeyPem: terminalPublicKeyPem as string,
  });
  if (outcome.result !== "TERMINAL_PROOF_RECORDED" || outcome.data === undefined) {
    return refusal(outcome.result, correlationId);
  }
  return {
    status: 200,
    body: {
      result: "TERMINAL_PROOF_RECORDED",
      correlationId,
      transcriptHash: outcome.data.transcriptHash,
    },
  };
}

async function handlePairingComplete(
  deps: EdgeTerminalRouterDeps,
  sessionId: string,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  const unknown = unknownFields(body, []);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const outcome = await deps.pairing.produceHubProofAndComplete({ pairingSessionId: sessionId });
  if (
    (outcome.result !== "PAIRED" && outcome.result !== "ALREADY_PAIRED") ||
    outcome.data === undefined
  ) {
    return refusal(outcome.result, correlationId);
  }
  const state = outcome.data;
  return {
    status: 200,
    body: {
      result: outcome.result,
      correlationId,
      pairing: {
        pairingSessionId: state.pairingSessionId,
        receiptId: state.receiptId,
        transcriptHash: state.transcriptHash,
        receipt: {
          ...state.receipt,
          pairedAt: state.receipt.pairedAt.toISOString(),
          validUntil: state.receipt.validUntil?.toISOString() ?? null,
        },
        receiptSignature: base64ToBase64Url(state.receiptSignatureBase64),
        hubProofSignature: base64ToBase64Url(state.hubProofSignatureBase64),
        pairedAt: state.pairedAt,
      },
    },
  };
}

async function handlePairingReceipt(
  deps: EdgeTerminalRouterDeps,
  sessionId: string,
  correlationId: string,
): Promise<EdgeResponse> {
  const outcome = await deps.pairing.reconcilePairingReceipt({ pairingSessionId: sessionId });
  if (outcome.result !== "RECEIPT_FOUND" || outcome.data === undefined) {
    return refusal(outcome.result, correlationId);
  }
  const state = outcome.data;
  return {
    status: 200,
    body: {
      result: "RECEIPT_FOUND",
      correlationId,
      pairing: {
        pairingSessionId: state.pairingSessionId,
        receiptId: state.receiptId,
        transcriptHash: state.transcriptHash,
        receipt: {
          ...state.receipt,
          pairedAt: state.receipt.pairedAt.toISOString(),
          validUntil: state.receipt.validUntil?.toISOString() ?? null,
        },
        receiptSignature: base64ToBase64Url(state.receiptSignatureBase64),
        pairedAt: state.pairedAt,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal health heartbeats (WS-11-T005-P02).
//
// Scope is DERIVED from the authenticated certificate and Hub relational
// authority; the body can neither supply nor override Tenant/Store/Location/
// Hub/assignment/profile/credential identity - unknown fields are refused,
// and none of the allowed fields name an identity. The terminal-observed
// timestamp is diagnostic only; Hub receipt time is the liveness authority.
// ---------------------------------------------------------------------------
const HEARTBEAT_ALLOWED_FIELDS = [
  "heartbeatSequence",
  "uptimeSeconds",
  "applicationVersion",
  "releaseVersion",
  "configSnapshotVersion",
  "queueDepth",
  "localDatabaseAvailable",
  "peripheralSummary",
  "diskFreeBytes",
  "observedAt",
  "reasonCodes",
] as const;

const PERIPHERAL_STATES = new Set([
  "unknown",
  "ready",
  "busy",
  "degraded",
  "disconnected",
  "misconfigured",
  "unsupported",
  "maintenance_required",
]);

const VERSION_TEXT = /^[A-Za-z0-9_.:+-]{1,64}$/;
const REASON_CODE = /^[a-z0-9_]{1,48}$/;

function boundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

async function handleTerminalHealthHeartbeat(
  deps: EdgeTerminalRouterDeps,
  terminal: AuthorizedTerminal,
  request: EdgeRequest,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<EdgeResponse> {
  if (Buffer.byteLength(request.rawBody, "utf8") > MAX_HEARTBEAT_BODY_BYTES) {
    return refusal("HEARTBEAT_BODY_TOO_LARGE", correlationId);
  }
  const unknown = unknownFields(body, HEARTBEAT_ALLOWED_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown heartbeat fields are refused", unknown);
  }
  const heartbeatSequence = boundedInt(body["heartbeatSequence"], 1, Number.MAX_SAFE_INTEGER);
  const uptimeSeconds = boundedInt(body["uptimeSeconds"], 0, Number.MAX_SAFE_INTEGER);
  const configSnapshotVersion = boundedInt(
    body["configSnapshotVersion"],
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const applicationVersion = body["applicationVersion"];
  if (
    heartbeatSequence === null ||
    uptimeSeconds === null ||
    configSnapshotVersion === null ||
    typeof applicationVersion !== "string" ||
    !VERSION_TEXT.test(applicationVersion)
  ) {
    return invalid(
      correlationId,
      "heartbeatSequence, uptimeSeconds, configSnapshotVersion and applicationVersion are required and bounded",
    );
  }
  const releaseVersion = body["releaseVersion"];
  if (
    releaseVersion !== undefined &&
    (typeof releaseVersion !== "string" || !VERSION_TEXT.test(releaseVersion))
  ) {
    return invalid(correlationId, "releaseVersion is bounded text");
  }
  const queueDepth =
    body["queueDepth"] === undefined ? undefined : boundedInt(body["queueDepth"], 0, 1_000_000);
  if (body["queueDepth"] !== undefined && queueDepth === null) {
    return invalid(correlationId, "queueDepth is a bounded integer");
  }
  const diskFreeBytes =
    body["diskFreeBytes"] === undefined
      ? undefined
      : boundedInt(body["diskFreeBytes"], 0, Number.MAX_SAFE_INTEGER);
  if (body["diskFreeBytes"] !== undefined && diskFreeBytes === null) {
    return invalid(correlationId, "diskFreeBytes is a bounded integer");
  }
  const localDatabaseAvailable = body["localDatabaseAvailable"];
  if (localDatabaseAvailable !== undefined && typeof localDatabaseAvailable !== "boolean") {
    return invalid(correlationId, "localDatabaseAvailable is a boolean");
  }
  const peripheralSummary = body["peripheralSummary"];
  if (
    peripheralSummary !== undefined &&
    (typeof peripheralSummary !== "string" || !PERIPHERAL_STATES.has(peripheralSummary))
  ) {
    return invalid(
      correlationId,
      "peripheralSummary is one of the eight canonical peripheral states",
    );
  }
  const observedAt = body["observedAt"];
  if (
    observedAt !== undefined &&
    (typeof observedAt !== "string" ||
      observedAt.length > 40 ||
      Number.isNaN(Date.parse(observedAt)))
  ) {
    return invalid(correlationId, "observedAt is an ISO timestamp (diagnostic only)");
  }
  const reasonCodes = body["reasonCodes"];
  if (
    reasonCodes !== undefined &&
    (!Array.isArray(reasonCodes) ||
      reasonCodes.length > 8 ||
      reasonCodes.some((code) => typeof code !== "string" || !REASON_CODE.test(code)))
  ) {
    return invalid(correlationId, "reasonCodes is a bounded array of short codes");
  }

  const heartbeat: TerminalHeartbeatBody = {
    heartbeatSequence,
    uptimeSeconds,
    applicationVersion,
    configSnapshotVersion,
    ...(releaseVersion !== undefined ? { releaseVersion } : {}),
    ...(queueDepth !== undefined && queueDepth !== null ? { queueDepth } : {}),
    ...(localDatabaseAvailable !== undefined ? { localDatabaseAvailable } : {}),
    ...(peripheralSummary !== undefined ? { peripheralSummary } : {}),
    ...(diskFreeBytes !== undefined && diskFreeBytes !== null ? { diskFreeBytes } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
    ...(reasonCodes !== undefined ? { reasonCodes: reasonCodes as readonly string[] } : {}),
  };

  const outcome = await acceptTerminalHeartbeat(
    deps.pool,
    terminal.terminalDeviceId,
    heartbeat,
    deps.environment ?? "development",
    deps.logger,
  );
  if (outcome.result === "HEARTBEAT_REPLAY_REJECTED") {
    return refusal("HEARTBEAT_REPLAY_REJECTED", correlationId);
  }
  return {
    status: 200,
    body: { result: outcome.result, correlationId, heartbeat: outcome },
  };
}
