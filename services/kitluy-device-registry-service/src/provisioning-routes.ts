/**
 * Cloud terminal-provisioning bootstrap routes — WS-11-T004-P04A.
 *
 * Authority: KLD-2026-08-05-TERMINAL-TRANSPORT-001 (the terminal transport
 * and pairing-completion owner decision); pairing protocol §7 (the cloud-side
 * provisioning flow); migration groups 0162–0174; the P02C/P02C1 composition
 * boundary (`kitluy_provisioning_service` entered per transaction).
 *
 * ===========================================================================
 * WHAT AUTHORIZES A REQUEST HERE
 * ===========================================================================
 * Nothing resembling a session. These are PRE-CREDENTIAL routes: the caller
 * is a factory-fresh terminal whose only authority is (a) its sealed
 * manufacturing-enrollment key, proven by Ed25519 signature over a
 * server-issued challenge, and (b) a one-time provisioning code, which
 * authorizes one assignment attempt but is not identity. Both are revalidated
 * by the governed doors on every call, so this layer never trusts an earlier
 * outcome. The revocation surface's refusing authenticator is deliberately
 * NOT reused: a staff session, browser cookie, shared terminal secret or
 * Supabase key must never appear on this surface (owner decision §1).
 *
 * The caller therefore may name WHAT it is asking about (assignment id,
 * challenge id, its code, its enrolled key) and never WHO is allowed or
 * WHERE it belongs: Tenant, Store, Location, Hub, environment, profile,
 * terminal state, credential id and every timestamp are server-derived, and
 * an unknown body field is a refusal rather than something to ignore.
 *
 * ===========================================================================
 * TRANSPORT DISCIPLINE
 * ===========================================================================
 * This layer owns the raw request text so the 16 KiB owner maximum, the
 * content type and JSON well-formedness are enforced HERE and count toward
 * the rate limit (owner decision §2: malformed attempts count). The rate
 * limiter runs before any database or signature work; its key is source IP
 * plus manufacturing-enrollment fingerprint — never the raw code, never the
 * signature. Outcomes map onto the canonical `@kitluy/api-errors` vocabulary;
 * SQLSTATEs, function names, schema/role names, digests and row identities
 * cannot pass through the closed composition result vocabulary this layer
 * consumes.
 */
import { randomUUID } from "node:crypto";
import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  type KitluyErrorCode,
} from "@kitluy/api-errors";
import { publicKeyFingerprint } from "@kitluy/device-identity";

import type { RequestHeaders } from "./authentication.js";
import type {
  ProvisioningResultCode,
  SafeLogger,
  TerminalProvisioningComposition,
} from "./provisioning-composition.js";

/**
 * The bootstrap request as the transport hands it over. `rawBody` is the
 * undecoded UTF-8 text (this layer owns size/shape validation) and `sourceIp`
 * is the TRANSPORT-OBSERVED peer address — never a forwarded-for header,
 * which is caller data (owner decision §2).
 */
export interface BootstrapRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: RequestHeaders;
  readonly sourceIp: string;
  readonly rawBody: string;
}

export interface BootstrapRouteResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  /** Transport headers this response requires (e.g. Retry-After on 429). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The PUBLIC challenge contract a terminal consumes (WS-11-T004-P04A1) —
 * the `challenge` object of a 201 response from
 * `POST /v1/terminal-provisioning/challenges`.
 *
 * A terminal's whole signing procedure is: base64url-decode
 * `signingPayload`, sign those exact bytes with its manufacturing-enrollment
 * private key (`signatureAlgorithm`), and POST the unpadded-base64url
 * signature with `challengeVersion` as `protocolVersion` to
 * `/v1/terminal-provisioning/challenges/{challengeId}/verify` along with its
 * own public key PEM. No database access, no scope inputs, no timestamp
 * handling, no server canonicalization code.
 */
export interface TerminalSignableChallenge {
  readonly challengeId: string;
  /** Doubles as the verify route's `protocolVersion` value. */
  readonly challengeVersion: string;
  readonly purpose: string;
  readonly nonce: string;
  readonly issuedAt: string;
  /** Authoritative expiry; an expired challenge stays unusable regardless of a retained payload. */
  readonly expiresAt: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  /** Locked: "ed25519" (KLD-2026-08-05-TERMINAL-TRANSPORT-001). */
  readonly signatureAlgorithm: string;
  /** Locked: "base64url" (unpadded). */
  readonly signingPayloadEncoding: string;
  /** The EXACT canonical kitluy.provisioning-pop.v1 bytes, base64url. Sign verbatim. */
  readonly signingPayload: string;
}

export interface TerminalProvisioningRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface TerminalProvisioningRouterDeps {
  readonly composition: TerminalProvisioningComposition;
  /** Injectable for tests; a real limiter with the default clock otherwise. */
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
}

// ---------------------------------------------------------------------------
// Owner-locked transport constants (KLD-2026-08-05-TERMINAL-TRANSPORT-001 §2)
// ---------------------------------------------------------------------------

/** Request maximum: 16 KiB of raw body text. */
export const MAX_REQUEST_BYTES = 16 * 1024;
/** Sustained rate: 10 requests per minute per key. */
const WINDOW_LIMIT = 10;
const WINDOW_MS = 60_000;
/** Burst 3: at most three requests may arrive faster than the refill. */
const BURST_CAPACITY = 3;
const REFILL_INTERVAL_MS = WINDOW_MS / WINDOW_LIMIT;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Exact 8-character Crockford presentation shape (0162 vocabulary). */
const CROCKFORD = /^[0-9A-Za-z]{8}$/;
/** Same bound the composition and the 0171 door enforce. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,96}$/;
/**
 * Detached Ed25519 signature: 64 bytes is 86 chars of UNPADDED base64url
 * (owner decision: the wire form is unpadded base64url; padding is malformed).
 */
const SIGNATURE_BASE64URL = /^[A-Za-z0-9_-]{1,120}$/;
/** SHA-256 fingerprint of the SPKI DER, as `publicKeyFingerprint` emits. */
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;
/** The one challenge protocol this surface speaks (migration 0170 CHECK). */
export const CHALLENGE_PROTOCOL_VERSION = "kitluy.provisioning-pop.v1";
const MAX_PUBLIC_KEY_PEM_CHARS = 1024;

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

export interface RateDecision {
  readonly allowed: boolean;
  /** Whole seconds until a retry could succeed; 0 when allowed. */
  readonly retryAfterSeconds: number;
}

/**
 * In-process token-bucket-plus-window limiter: burst 3 (one token refilled
 * every 6 s) AND a hard 10-per-rolling-minute window, both per key. The clock
 * is injectable so tests measure the policy, not wall time. Per-instance by
 * design — a shared store is a BLK-006 deployment value (owner decision §2).
 */
export class BootstrapRateLimiter {
  private readonly now: () => number;
  private readonly buckets = new Map<
    string,
    { tokens: number; lastRefillMs: number; windowStartMs: number; windowCount: number }
  >();

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateDecision {
    const nowMs = this.now();
    this.pruneIfLarge(nowMs);
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        tokens: BURST_CAPACITY,
        lastRefillMs: nowMs,
        windowStartMs: nowMs,
        windowCount: 0,
      };
      this.buckets.set(key, bucket);
    }
    const refilled = Math.floor((nowMs - bucket.lastRefillMs) / REFILL_INTERVAL_MS);
    if (refilled > 0) {
      bucket.tokens = Math.min(BURST_CAPACITY, bucket.tokens + refilled);
      bucket.lastRefillMs += refilled * REFILL_INTERVAL_MS;
    }
    if (nowMs - bucket.windowStartMs >= WINDOW_MS) {
      bucket.windowStartMs = nowMs;
      bucket.windowCount = 0;
    }
    if (bucket.tokens < 1) {
      const waitMs = REFILL_INTERVAL_MS - (nowMs - bucket.lastRefillMs);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    if (bucket.windowCount >= WINDOW_LIMIT) {
      const waitMs = bucket.windowStartMs + WINDOW_MS - nowMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    bucket.tokens -= 1;
    bucket.windowCount += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Bounded memory: drop buckets idle past two windows once the map grows. */
  private pruneIfLarge(nowMs: number): void {
    if (this.buckets.size < 4096) return;
    for (const [key, bucket] of this.buckets) {
      if (
        nowMs - bucket.lastRefillMs > 2 * WINDOW_MS &&
        nowMs - bucket.windowStartMs > 2 * WINDOW_MS
      ) {
        this.buckets.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Canonical error mapping
// ---------------------------------------------------------------------------

/**
 * Every closed composition result maps to exactly one canonical registry
 * code. Total by construction: a new `ProvisioningResultCode` fails the
 * typecheck here rather than escaping unmapped. Success codes are handled by
 * the route handlers and never reach this table at runtime; they carry a safe
 * fallback anyway so the table stays total.
 *
 * The activation-family rows are unreachable from the three bootstrap
 * operations (activation transport is WS-11-T004-P04B); they fail closed as
 * INTERNAL_ERROR rather than inventing a contract for a surface that does
 * not exist yet.
 */
const CANONICAL_ERROR: Readonly<Record<ProvisioningResultCode, KitluyErrorCode>> = {
  CHALLENGE_ISSUED: "INTERNAL_ERROR",
  PROOF_VERIFIED: "INTERNAL_ERROR",
  PROOF_ALREADY_VERIFIED: "INTERNAL_ERROR",
  REDEEMED: "INTERNAL_ERROR",
  REDEMPTION_REPLAYED: "INTERNAL_ERROR",
  // One transport class for every governed refusal of the presented code, the
  // proof or the scope: the one-time authorization was not accepted. The
  // registry text leaks no policy internals, and merged door families
  // (missing vs inactive assignment, 0164) stay merged here.
  CODE_INVALID: "SCOPE_PERMISSION_DENIED",
  CODE_LOCKED: "SCOPE_PERMISSION_DENIED",
  CODE_EXPIRED: "SCOPE_PERMISSION_DENIED",
  CODE_REVOKED: "SCOPE_PERMISSION_DENIED",
  CODE_REDEEMED: "SCOPE_PERMISSION_DENIED",
  PROOF_INVALID: "SCOPE_PERMISSION_DENIED",
  PROOF_BINDING_MISMATCH: "SCOPE_PERMISSION_DENIED",
  HUB_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ASSIGNMENT_INACTIVE: "SCOPE_PERMISSION_DENIED",
  ENROLLMENT_INELIGIBLE: "SCOPE_PERMISSION_DENIED",
  // Flow-state conflicts: the resource moved on; the caller must obtain a
  // fresh challenge rather than replay this request.
  CODE_ALREADY_PROVEN: "RESOURCE_VERSION_CONFLICT",
  CHALLENGE_EXPIRED: "RESOURCE_VERSION_CONFLICT",
  CREDENTIAL_CONFLICT: "RESOURCE_VERSION_CONFLICT",
  CHALLENGE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  // BLK-005 fail-closed (pilot/production) and missing trusted time: the
  // signing authority is unavailable. The registry's backoff guidance is
  // honest for the trusted-time case and harmless for BLK-005, which no
  // amount of retrying can open.
  PKI_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  ACTIVATION_PREPARED: "INTERNAL_ERROR",
  ACTIVATION_ACK_INVALID: "INTERNAL_ERROR",
  ACTIVATION_CHALLENGE_EXPIRED: "INTERNAL_ERROR",
  ACTIVATION_CHALLENGE_CONSUMED: "INTERNAL_ERROR",
  CREDENTIAL_INELIGIBLE: "INTERNAL_ERROR",
  REDEMPTION_REQUIRED: "INTERNAL_ERROR",
  ACTIVATED: "INTERNAL_ERROR",
  ALREADY_ACTIVATED: "INTERNAL_ERROR",
};

/** Fixed safe text per canonical code. Never echoes caller values. */
const CANONICAL_MESSAGE: Readonly<Partial<Record<KitluyErrorCode, string>>> = {
  SCOPE_PERMISSION_DENIED: "the presented provisioning authority was refused",
  RESOURCE_VERSION_CONFLICT: "the provisioning flow has moved past this request",
  RESOURCE_NOT_FOUND: "no such challenge",
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST:
    "the idempotency key was already used with a different request",
  DEPENDENCY_UNAVAILABLE: "the credential authority is unavailable for this environment",
  VALIDATION_FAILED: "the request is invalid",
  INTERNAL_ERROR: "the operation failed and the details are not disclosed",
};

function refusal(result: ProvisioningResultCode, correlationId: string): BootstrapRouteResponse {
  const code = CANONICAL_ERROR[result];
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      details: { result, retryable: isRetryable(code) },
    }) as unknown as Record<string, unknown>,
  };
}

function invalid(
  correlationId: string,
  detail: string,
  fields: readonly string[] = [],
): BootstrapRouteResponse {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: {
        result: "REQUEST_INVALID",
        retryable: false,
        ...(fields.length > 0 ? { fields: fields.slice(0, 16) } : {}),
      },
    }) as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Header and body plumbing
// ---------------------------------------------------------------------------

function headerValues(headers: RequestHeaders, name: string): readonly string[] {
  const raw = headers[name];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** Optional caller label; regenerated when absent or malformed. Never authority. */
function correlationIdFrom(headers: RequestHeaders): string {
  const value = headerValues(headers, "x-correlation-id")[0];
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim() : randomUUID();
}

type IdempotencyHeader =
  { readonly ok: true; readonly key: string } | { readonly ok: false; readonly detail: string };

function idempotencyKeyFrom(headers: RequestHeaders): IdempotencyHeader {
  const values = headerValues(headers, "idempotency-key").map((v) => v.trim());
  if (values.length === 0) {
    return { ok: false, detail: "the Idempotency-Key header is required" };
  }
  if (new Set(values).size > 1) {
    return { ok: false, detail: "conflicting Idempotency-Key header values were presented" };
  }
  const key = values[0] ?? "";
  if (!IDEMPOTENCY_KEY.test(key)) {
    return { ok: false, detail: "the Idempotency-Key header is malformed" };
  }
  return { ok: true, key };
}

function contentTypeIsJson(headers: RequestHeaders): boolean {
  const value = headerValues(headers, "content-type")[0] ?? "";
  return /^application\/json\s*(;.*)?$/i.test(value.trim());
}

/**
 * Strict object parse of the bounded raw text. Arrays, scalars and malformed
 * JSON are all the same refusal; nothing is coerced.
 */
function parseBody(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whitelist validation: any field outside the route's contract is refused by
 * NAME, never silently dropped. This is what keeps Tenant, Store, Location,
 * Hub, profile, environment, state, credential id and timestamps out of
 * caller hands — they are simply not in any allowed set.
 */
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

/** Unpadded base64url (the wire form) to the standard base64 the composition takes. */
function base64UrlToBase64(signature: string): string {
  const translated = signature.replace(/-/g, "+").replace(/_/g, "/");
  return translated + "=".repeat((4 - (translated.length % 4)) % 4);
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

const ROUTE_PREFIX = "/v1/terminal-provisioning";
export const TERMINAL_PROVISIONING_PREFIX = ROUTE_PREFIX;

type MatchedRoute =
  | { readonly route: "challenges" | "redemptions"; readonly challengeId?: undefined }
  | { readonly route: "verify"; readonly challengeId: string };

function matchRoute(method: string, path: string): MatchedRoute | "METHOD_NOT_ALLOWED" | null {
  const clean = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (clean === `${ROUTE_PREFIX}/challenges`) {
    return method === "POST" ? { route: "challenges" } : "METHOD_NOT_ALLOWED";
  }
  if (clean === `${ROUTE_PREFIX}/redemptions`) {
    return method === "POST" ? { route: "redemptions" } : "METHOD_NOT_ALLOWED";
  }
  const verifyMatch = /^\/v1\/terminal-provisioning\/challenges\/([^/]+)\/verify$/.exec(clean);
  if (verifyMatch !== null) {
    const challengeId = verifyMatch[1] ?? "";
    if (!UUID.test(challengeId)) return null;
    return method === "POST" ? { route: "verify", challengeId } : "METHOD_NOT_ALLOWED";
  }
  return null;
}

const NO_LOG: SafeLogger = { info: () => undefined };

export function createTerminalProvisioningRouter(
  deps: TerminalProvisioningRouterDeps,
): TerminalProvisioningRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();
  const logger = deps.logger ?? NO_LOG;

  /**
   * One limiter consultation per request, malformed or not. The fingerprint
   * component is best-available caller-declared identity — a bucketing key,
   * never a verified one (verification is the doors' job).
   */
  function limit(
    sourceIp: string,
    fingerprint: string,
    correlationId: string,
  ): BootstrapRouteResponse | null {
    const decision = limiter.consume(`${sourceIp}|${fingerprint}`);
    if (decision.allowed) return null;
    return {
      status: httpStatusFor("RATE_LIMITED"),
      headers: { "retry-after": String(decision.retryAfterSeconds) },
      body: errorEnvelope("RATE_LIMITED", "too many provisioning requests", {
        correlationId,
        details: { retryable: true },
      }) as unknown as Record<string, unknown>,
    };
  }

  function log(operation: string, correlationId: string, status: number, result: string): void {
    // Safe fields only: no code, nonce, signature, key material or IP.
    logger.info({ operation, correlationId, status, result });
  }

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = correlationIdFrom(request.headers);
      const finish = (
        operation: string,
        response: BootstrapRouteResponse,
        result: string,
      ): BootstrapRouteResponse => {
        log(operation, correlationId, response.status, result);
        return response;
      };

      const matched = matchRoute(request.method, request.path);
      if (matched === null) {
        return finish(
          "route:unmatched",
          {
            status: httpStatusFor("RESOURCE_NOT_FOUND"),
            body: errorEnvelope("RESOURCE_NOT_FOUND", "no such route", {
              correlationId,
            }) as unknown as Record<string, unknown>,
          },
          "RESOURCE_NOT_FOUND",
        );
      }
      if (matched === "METHOD_NOT_ALLOWED") {
        return finish(
          "route:unmatched",
          {
            status: 405,
            body: errorEnvelope("VALIDATION_FAILED", "method not allowed", {
              correlationId,
            }) as unknown as Record<string, unknown>,
          },
          "METHOD_NOT_ALLOWED",
        );
      }
      const operation = `route:${matched.route}`;

      // TRANSPORT SHAPE FIRST — and every refusal below still consumes from
      // the limiter, keyed without a fingerprint, because malformed attempts
      // count (owner decision §2).
      if (!contentTypeIsJson(request.headers)) {
        const limited = limit(request.sourceIp, "-", correlationId);
        if (limited !== null) return finish(operation, limited, "RATE_LIMITED");
        return finish(
          operation,
          invalid(correlationId, "Content-Type must be application/json"),
          "REQUEST_INVALID",
        );
      }
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        const limited = limit(request.sourceIp, "-", correlationId);
        if (limited !== null) return finish(operation, limited, "RATE_LIMITED");
        return finish(
          operation,
          invalid(correlationId, "the request exceeds the 16 KiB maximum"),
          "REQUEST_INVALID",
        );
      }
      const body = parseBody(request.rawBody);
      if (body === null) {
        const limited = limit(request.sourceIp, "-", correlationId);
        if (limited !== null) return finish(operation, limited, "RATE_LIMITED");
        return finish(
          operation,
          invalid(correlationId, "a JSON object body is required"),
          "REQUEST_INVALID",
        );
      }

      // The rate key's fingerprint component, per route (owner decision §2).
      let fingerprint = "-";
      if (matched.route === "challenges") {
        const declared = body["enrollmentKeyFingerprint"];
        if (typeof declared === "string" && FINGERPRINT_HEX.test(declared.trim())) {
          fingerprint = declared.trim();
        }
      } else if (matched.route === "verify") {
        const pem = body["terminalPublicKeyPem"];
        if (typeof pem === "string" && pem.length <= MAX_PUBLIC_KEY_PEM_CHARS) {
          try {
            fingerprint = publicKeyFingerprint(pem);
          } catch {
            fingerprint = "-";
          }
        }
      }
      const limited = limit(request.sourceIp, fingerprint, correlationId);
      if (limited !== null) return finish(operation, limited, "RATE_LIMITED");

      const idempotency = idempotencyKeyFrom(request.headers);
      if (!idempotency.ok) {
        return finish(
          operation,
          invalid(correlationId, idempotency.detail, ["idempotency-key"]),
          "REQUEST_INVALID",
        );
      }

      switch (matched.route) {
        case "challenges":
          return finish(
            operation,
            await handleChallenges(deps.composition, body, correlationId),
            "HANDLED",
          );
        case "verify":
          return finish(
            operation,
            await handleVerify(deps.composition, body, matched.challengeId, correlationId),
            "HANDLED",
          );
        case "redemptions":
          return finish(
            operation,
            await handleRedemptions(deps.composition, body, idempotency.key, correlationId),
            "HANDLED",
          );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const CHALLENGE_FIELDS = [
  "terminalAssignmentId",
  "provisioningCode",
  "enrollmentKeyFingerprint",
] as const;

async function handleChallenges(
  composition: TerminalProvisioningComposition,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<BootstrapRouteResponse> {
  const unknown = unknownFields(body, CHALLENGE_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const terminalAssignmentId = requireShaped(body, "terminalAssignmentId", UUID);
  const provisioningCode = requireShaped(body, "provisioningCode", CROCKFORD);
  const enrollmentKeyFingerprint = requireShaped(body, "enrollmentKeyFingerprint", FINGERPRINT_HEX);
  const missing = [
    ...(terminalAssignmentId === null ? ["terminalAssignmentId"] : []),
    ...(provisioningCode === null ? ["provisioningCode"] : []),
    ...(enrollmentKeyFingerprint === null ? ["enrollmentKeyFingerprint"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }

  const outcome = await composition.presentCodeAndIssueChallenge({
    terminalAssignmentId: terminalAssignmentId as string,
    presentedCode: provisioningCode as string,
    // The manufacturing-enrollment key reference is WHO presented (owner
    // decision §1); the governed evaluator records it as the presenter ref.
    terminalReference: enrollmentKeyFingerprint as string,
  });
  if (outcome.result !== "CHALLENGE_ISSUED" || outcome.data === undefined) {
    return refusal(outcome.result, correlationId);
  }
  // The composition's approved terminal-facing material ONLY: no digest, no
  // scope identifiers as separate fields, no enrollment data (P02C contract;
  // owner decision §1). `signingPayload` (P04A1) is the ONE opaque value a
  // terminal signs — the exact canonical kitluy.provisioning-pop.v1 bytes as
  // unpadded base64url — so a real terminal needs no database access, no
  // server canonicalization code and no timestamp reformatting. Challenge
  // material, not a secret; still never logged.
  const challenge: TerminalSignableChallenge = {
    challengeId: outcome.data.challengeId,
    challengeVersion: outcome.data.challengeVersion,
    purpose: outcome.data.purpose,
    nonce: outcome.data.nonce,
    issuedAt: outcome.data.issuedAt,
    expiresAt: outcome.data.expiresAt,
    terminalAssignmentId: outcome.data.terminalAssignmentId,
    terminalProfileKey: outcome.data.terminalProfileKey,
    signatureAlgorithm: outcome.data.signatureAlgorithm,
    signingPayloadEncoding: outcome.data.signingPayloadEncoding,
    signingPayload: outcome.data.signingPayload,
  };
  return {
    status: 201,
    body: {
      result: "CHALLENGE_ISSUED",
      correlationId,
      challenge: { ...challenge },
    },
  };
}

const VERIFY_FIELDS = ["protocolVersion", "signature", "terminalPublicKeyPem"] as const;

async function handleVerify(
  composition: TerminalProvisioningComposition,
  body: Record<string, unknown>,
  challengeId: string,
  correlationId: string,
): Promise<BootstrapRouteResponse> {
  const unknown = unknownFields(body, VERIFY_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const protocolVersion = body["protocolVersion"];
  if (protocolVersion !== CHALLENGE_PROTOCOL_VERSION) {
    return invalid(correlationId, "unsupported challenge protocol version", ["protocolVersion"]);
  }
  const signature = requireShaped(body, "signature", SIGNATURE_BASE64URL);
  const pemRaw = body["terminalPublicKeyPem"];
  const terminalPublicKeyPem =
    typeof pemRaw === "string" &&
    pemRaw.length <= MAX_PUBLIC_KEY_PEM_CHARS &&
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

  const outcome = await composition.verifyProofAndRecord({
    challengeId,
    signatureBase64: base64UrlToBase64(signature as string),
    terminalPublicKeyPem: terminalPublicKeyPem as string,
  });
  if (outcome.result === "PROOF_VERIFIED" || outcome.result === "PROOF_ALREADY_VERIFIED") {
    // Safe, NON-AUTHORITATIVE verification status (§5.3): the verified proof
    // is single-use input to redemption, not a grant of anything.
    return {
      status: 200,
      body: {
        result: outcome.result,
        correlationId,
        ...(outcome.data !== undefined
          ? {
              verification: {
                verifiedAt: outcome.data.verifiedAt,
                expiresAt: outcome.data.expiresAt,
              },
            }
          : {}),
      },
    };
  }
  return refusal(outcome.result, correlationId);
}

const REDEMPTION_FIELDS = ["terminalAssignmentId", "provisioningCode", "challengeId"] as const;

async function handleRedemptions(
  composition: TerminalProvisioningComposition,
  body: Record<string, unknown>,
  idempotencyKey: string,
  correlationId: string,
): Promise<BootstrapRouteResponse> {
  const unknown = unknownFields(body, REDEMPTION_FIELDS);
  if (unknown.length > 0) {
    return invalid(correlationId, "unknown fields are refused, not ignored", unknown);
  }
  const terminalAssignmentId = requireShaped(body, "terminalAssignmentId", UUID);
  const provisioningCode = requireShaped(body, "provisioningCode", CROCKFORD);
  const challengeId = requireShaped(body, "challengeId", UUID);
  const missing = [
    ...(terminalAssignmentId === null ? ["terminalAssignmentId"] : []),
    ...(provisioningCode === null ? ["provisioningCode"] : []),
    ...(challengeId === null ? ["challengeId"] : []),
  ];
  if (missing.length > 0) {
    return invalid(correlationId, "required fields are absent or malformed", missing);
  }

  const outcome = await composition.redeemProvisioning({
    terminalAssignmentId: terminalAssignmentId as string,
    presentedCode: provisioningCode as string,
    challengeId: challengeId as string,
    idempotencyKey,
  });
  if (
    (outcome.result === "REDEEMED" || outcome.result === "REDEMPTION_REPLAYED") &&
    outcome.data !== undefined
  ) {
    // The composition's approved PUBLIC credential material. Serial and every
    // credential fact are server-derived (P02C); no delivery, activation,
    // pairing or sync claim exists in this vocabulary (§5.4).
    return {
      status: outcome.result === "REDEEMED" ? 201 : 200,
      body: {
        result: outcome.result,
        correlationId,
        credential: { ...outcome.data },
      },
    };
  }
  return refusal(outcome.result, correlationId);
}
