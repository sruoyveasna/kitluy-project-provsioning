/**
 * `POST /v1/terminal-pairing` — the route a Pi Terminal calls when an
 * installer types a pairing code.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §6–§7 (the Pi user
 * enters only the pairing code; pairing determines Store, Location, Hub,
 * roles, vertical and required app); migration group 0213; the transport
 * constants of KLD-2026-08-05-TERMINAL-TRANSPORT-001, reused.
 *
 * A PRE-CREDENTIAL surface, exactly like `/v1/hub-pairing`: the caller names
 * WHAT it is (`deviceRecordId`) and WHAT it was told (`code`), never WHERE it
 * belongs. Everything in `hub-pairing-routes.ts` about why one route, why a
 * wrong code is not a 400, and why the limiter runs before parsing applies
 * here unchanged.
 */
import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  type KitluyErrorCode,
} from "@kitluy/api-errors";

import type { RequestHeaders } from "./authentication.js";
import type { TrustAdvanceOutcome } from "./device-trust-advance.js";
import type { SafeLogger } from "./provisioning-composition.js";
import {
  BootstrapRateLimiter,
  MAX_REQUEST_BYTES,
  type BootstrapRouteRequest,
  type BootstrapRouteResponse,
} from "./provisioning-routes.js";
import type {
  PairedTerminalMaterial,
  TerminalPairingComposition,
  TerminalPairingResultCode,
} from "./terminal-pairing-composition.js";

export const TERMINAL_PAIRING_PREFIX = "/v1/terminal-pairing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_SHAPE = /^[A-Za-z0-9]{8}$/;

export interface TerminalPairingRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface TerminalPairingRouterDeps {
  readonly composition: TerminalPairingComposition;
  /** Optional, as for Hubs: a pairing must never fail because the step after it is unconfigured. */
  readonly advanceTrust?: (deviceRecordId: string) => Promise<TrustAdvanceOutcome>;
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
}

const CANONICAL_ERROR: Readonly<Record<TerminalPairingResultCode, KitluyErrorCode>> = {
  PAIRED: "INTERNAL_ERROR",
  CODE_REFUSED: "SCOPE_PERMISSION_DENIED",
  LOCKED: "SCOPE_PERMISSION_DENIED",
  REDEMPTION_REFUSED: "RESOURCE_VERSION_CONFLICT",
  ALREADY_ASSIGNED: "RESOURCE_VERSION_CONFLICT",
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

const SAFE_MESSAGE: Readonly<Record<TerminalPairingResultCode, string>> = {
  PAIRED: "paired",
  CODE_REFUSED: "that pairing code is not valid for this Pi Terminal",
  LOCKED: "too many failed attempts; ask for a new pairing code",
  REDEMPTION_REFUSED: "the pairing code could not be used; ask for a new one",
  ALREADY_ASSIGNED:
    "this Pi Terminal is already assigned to a Store; its assignment must be revoked before it can pair again",
  REQUEST_INVALID: "the request was malformed",
  INTERNAL_ERROR: "the pairing service is unavailable",
};

const BODY_FIELDS: readonly string[] = ["deviceRecordId", "code"];

function headerValues(headers: RequestHeaders, name: string): readonly string[] {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function correlationIdFrom(headers: RequestHeaders): string {
  const supplied = headerValues(headers, "x-correlation-id")[0];
  return supplied !== undefined && /^[A-Za-z0-9_.:-]{1,128}$/.test(supplied) ? supplied : "";
}

function contentTypeIsJson(headers: RequestHeaders): boolean {
  const value = headerValues(headers, "content-type")[0];
  if (value === undefined) return false;
  return value.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function parseBody(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function invalid(correlationId: string, detail: string): BootstrapRouteResponse {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: { result: "REQUEST_INVALID", retryable: false },
    }) as unknown as Record<string, unknown>,
  };
}

function refusal(result: TerminalPairingResultCode, correlationId: string): BootstrapRouteResponse {
  const code = CANONICAL_ERROR[result];
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, SAFE_MESSAGE[result], {
      correlationId,
      details: { result, retryable: isRetryable(code) },
    }) as unknown as Record<string, unknown>,
  };
}

function paired(
  material: PairedTerminalMaterial,
  correlationId: string,
  advance?: TrustAdvanceOutcome,
): BootstrapRouteResponse {
  return {
    status: 200,
    body: {
      correlationId,
      deviceRecordId: material.deviceRecordId,
      sessionId: material.sessionId,
      assignmentId: material.assignmentId,
      assignmentGeneration: material.assignmentGeneration,
      storeAssignment: material.storeAssignment,
      // The owner's §7 context, from server rows. The Pi never decided any of it.
      context: material.context,
      activated: advance?.kind === "advanced",
      lifecycleState:
        advance === undefined || advance.kind === "failed" ? null : advance.lifecycleState,
      trustedTime:
        advance === undefined || advance.kind === "failed" ? null : advance.trustedTimeStatus,
      activationRefusal: advance?.kind === "blocked" ? advance.refusalCode : null,
      certificate: advance === undefined || advance.kind === "failed" ? null : advance.certificate,
      detail:
        advance?.kind === "advanced"
          ? "the Pi Terminal is assigned to its seat and is active"
          : "the Pi Terminal is assigned to its seat and is awaiting trust",
    },
  };
}

export function createTerminalPairingRouter(
  deps: TerminalPairingRouterDeps,
): TerminalPairingRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = correlationIdFrom(request.headers);

      if (request.path !== TERMINAL_PAIRING_PREFIX) {
        return {
          status: httpStatusFor("RESOURCE_NOT_FOUND"),
          body: errorEnvelope("RESOURCE_NOT_FOUND", "no such pairing route", {
            correlationId,
            details: { retryable: false },
          }) as unknown as Record<string, unknown>,
        };
      }
      if (request.method.toUpperCase() !== "POST") {
        return invalid(correlationId, "method not allowed");
      }
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return invalid(correlationId, "request body exceeds the maximum size");
      }
      const decision = limiter.consume(request.sourceIp);
      if (!decision.allowed) {
        return {
          status: httpStatusFor("RATE_LIMITED"),
          body: errorEnvelope("RATE_LIMITED", "too many pairing attempts", {
            correlationId,
            details: { retryable: true },
          }) as unknown as Record<string, unknown>,
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        };
      }
      if (!contentTypeIsJson(request.headers)) {
        return invalid(correlationId, "content-type must be application/json");
      }
      const body = parseBody(request.rawBody);
      if (body === null) {
        return invalid(correlationId, "body must be a JSON object");
      }
      const unknown = Object.keys(body).filter((k) => !BODY_FIELDS.includes(k));
      if (unknown.length > 0) {
        return invalid(correlationId, `unknown field: ${unknown[0]}`);
      }
      const deviceRecordId = body.deviceRecordId;
      if (typeof deviceRecordId !== "string" || !UUID.test(deviceRecordId)) {
        return invalid(correlationId, "deviceRecordId must be a uuid");
      }
      const codeValue = body.code;
      if (typeof codeValue !== "string") {
        return invalid(correlationId, "code must be a string");
      }
      if (!CODE_SHAPE.test(codeValue)) {
        return refusal("CODE_REFUSED", correlationId);
      }

      const outcome = await deps.composition.pair({
        deviceRecordId,
        presentedCode: codeValue,
        actorRef: "device/terminal-pairing",
      });
      const responseCorrelation = correlationId === "" ? outcome.correlationId : correlationId;

      if (outcome.result === "PAIRED" && outcome.data !== undefined) {
        deps.logger?.info({
          event: "pi-terminal-paired",
          correlationId: outcome.correlationId,
          deviceRecordId,
        });
        const advance =
          deps.advanceTrust === undefined ? undefined : await deps.advanceTrust(deviceRecordId);
        if (advance !== undefined) {
          deps.logger?.info({
            event: "pi-terminal-trust-advance",
            correlationId: outcome.correlationId,
            result: advance.kind,
            lifecycleState: advance.kind === "failed" ? "unknown" : advance.lifecycleState,
          });
        }
        return paired(outcome.data, responseCorrelation, advance);
      }
      return refusal(outcome.result, responseCorrelation);
    },
  };
}
