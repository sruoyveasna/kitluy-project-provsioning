/**
 * `POST /v1/hub-pairing` — the route a Store Hub CLI calls when an operator
 * types a pairing code.
 *
 * Authority: KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001; pairing protocol §6.1;
 * KLSRC-0162 §12 (Hub pairing-code entry); the transport constants of
 * KLD-2026-08-05-TERMINAL-TRANSPORT-001, reused rather than reinvented.
 *
 * ===========================================================================
 * WHAT AUTHORIZES A REQUEST HERE
 * ===========================================================================
 * Nothing resembling a session — this is a PRE-CREDENTIAL surface, like
 * `/v1/device-enrollment` and `/v1/terminal-provisioning`. The caller is an
 * enrolled but unassigned Store Hub, and its only authority is an
 * eight-character code an operator read off a Partner Portal screen and typed
 * into a console. A staff session, browser cookie or Supabase key must never
 * appear here.
 *
 * So the caller may name WHAT it is (`deviceRecordId`) and WHAT it was told
 * (`code`), and never WHERE it belongs: Tenant, Digital Store, Location,
 * assignment id and every timestamp are server-derived, and an unknown body
 * field is a refusal rather than something to ignore.
 *
 * ===========================================================================
 * WHY ONE ROUTE AND NOT TWO
 * ===========================================================================
 * Presentation and redemption are two governed steps, but they are not two
 * REQUESTS. Exposing presentation on its own would publish an oracle that says
 * "this code is correct" while consuming nothing — and the window between the
 * two calls is exactly where a second caller could redeem the claim first. One
 * route, one transaction, both doors: see `HubPairingComposition.pair`.
 *
 * ===========================================================================
 * WHY A WRONG CODE IS NOT A 400
 * ===========================================================================
 * A malformed code and a wrong code get the SAME answer, and it is not
 * `VALIDATION_FAILED`. If the shape check answered 400 and a wrong code answered
 * 403, a guesser could learn the alphabet and length for free, without spending
 * one of its five attempts. `VALIDATION_FAILED` is reserved for requests that are
 * not about a code at all — bad content type, oversized body, unknown field,
 * malformed device id.
 */
import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  type KitluyErrorCode,
} from "@kitluy/api-errors";

import type { RequestHeaders } from "./authentication.js";
import type {
  HubPairingComposition,
  HubPairingResultCode,
  PairedHubMaterial,
} from "./hub-pairing-composition.js";
import type { TrustAdvanceOutcome } from "./device-trust-advance.js";
import type { SafeLogger } from "./provisioning-composition.js";
import {
  BootstrapRateLimiter,
  MAX_REQUEST_BYTES,
  type BootstrapRouteRequest,
  type BootstrapRouteResponse,
} from "./provisioning-routes.js";

export const HUB_PAIRING_PREFIX = "/v1/hub-pairing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Transport shape only: eight characters that could be a code. The ALPHABET is
 * checked in the composition (and authoritatively by 0191), because rejecting a
 * bad alphabet here with a different status than a wrong code is the leak the
 * header describes.
 */
const CODE_SHAPE = /^[A-Za-z0-9]{8}$/;

export interface HubPairingRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface HubPairingRouterDeps {
  readonly composition: HubPairingComposition;
  /**
   * Advances a freshly paired device toward `active`. OPTIONAL: when absent the
   * device still pairs and is reported as awaiting trust, which is what happened
   * for every Hub before group 0198. A pairing must never fail because the step
   * after it is unconfigured.
   */
  readonly advanceTrust?: (deviceRecordId: string) => Promise<TrustAdvanceOutcome>;
  /** Injectable for tests; a real limiter with the default clock otherwise. */
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
}

/**
 * Coarse result -> canonical error code.
 *
 * `CODE_REFUSED` and `LOCKED` are both `SCOPE_PERMISSION_DENIED`: the caller
 * presented an authority that was refused. They differ only in the safe message,
 * which is what tells an operator whether to retype or fetch a new code.
 */
const CANONICAL_ERROR: Readonly<Record<HubPairingResultCode, KitluyErrorCode>> = {
  PAIRED: "INTERNAL_ERROR",
  CODE_REFUSED: "SCOPE_PERMISSION_DENIED",
  LOCKED: "SCOPE_PERMISSION_DENIED",
  REDEMPTION_REFUSED: "RESOURCE_VERSION_CONFLICT",
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

/**
 * Fixed safe text per RESULT, never per error code, and never echoing a caller
 * value. `LOCKED` needs its own wording — an operator who keeps typing at a
 * locked claim is wasting their time, and "refused" would not tell them.
 */
const SAFE_MESSAGE: Readonly<Record<HubPairingResultCode, string>> = {
  PAIRED: "paired",
  CODE_REFUSED: "that pairing code is not valid for this device",
  LOCKED: "too many failed attempts; ask for a new pairing code",
  REDEMPTION_REFUSED: "the pairing code could not be redeemed; ask for a new one",
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

/** An unknown field is a refusal: silently ignoring one hides a caller's mistake. */
function unknownFields(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter((k) => !allowed.includes(k));
}

function stringField(body: Record<string, unknown>, key: string, shape: RegExp): string | null {
  const value = body[key];
  return typeof value === "string" && shape.test(value) ? value : null;
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

function refusal(result: HubPairingResultCode, correlationId: string): BootstrapRouteResponse {
  const code = CANONICAL_ERROR[result];
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, SAFE_MESSAGE[result], {
      correlationId,
      // The COARSE result only. `auditDetail` never leaves the server.
      details: { result, retryable: isRetryable(code) },
    }) as unknown as Record<string, unknown>,
  };
}

function paired(
  material: PairedHubMaterial,
  correlationId: string,
  advance?: TrustAdvanceOutcome,
): BootstrapRouteResponse {
  return {
    status: 200,
    body: {
      correlationId,
      deviceRecordId: material.deviceRecordId,
      assignmentId: material.assignmentId,
      tenantId: material.tenantId,
      digitalStoreId: material.digitalStoreId,
      storeLocationId: material.storeLocationId,
      storeAssignment: material.storeAssignment,
      // Stated explicitly, and false. Pairing assigns; it does not activate.
      // Activation is certificate-backed and gated on BLK-005, so a Hub that
      // read `activated` as absent-and-therefore-fine would be wrong.
      // Reported from what the governed doors actually said, not a fixed
      // sentence. Before group 0198 nothing advanced a paired device, so this
      // always read "awaiting trust" -- true then, and a lie the moment
      // activation started working.
      activated: advance?.kind === "advanced",
      lifecycleState:
        advance === undefined || advance.kind === "failed" ? null : advance.lifecycleState,
      trustedTime:
        advance === undefined || advance.kind === "failed" ? null : advance.trustedTimeStatus,
      // The governed refusal, verbatim. KLUY-DEVICE-NO-CERTIFICATE and
      // KLUY-DEVICE-TIME-RESTRICTED demand completely different next actions.
      activationRefusal: advance?.kind === "blocked" ? advance.refusalCode : null,
      // Which certificate outcome the SEPARATE issuer reached (group 0199).
      // Reported because "no certificate yet" and "certificate refused for a
      // containment reason" are different problems for whoever is at the Hub.
      certificate: advance === undefined || advance.kind === "failed" ? null : advance.certificate,
      detail:
        advance?.kind === "advanced"
          ? "the Store Hub is assigned to its Store and is active"
          : "the Store Hub is assigned to its Store and is awaiting trust",
    },
  };
}

export function createHubPairingRouter(deps: HubPairingRouterDeps): HubPairingRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = correlationIdFrom(request.headers);

      if (request.path !== HUB_PAIRING_PREFIX) {
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

      // ORDER MATTERS, and both of these were wrong on the first pass.
      //
      // The size ceiling is checked FIRST, because it is the only check that
      // costs nothing: `Buffer.byteLength` reads a length, while `JSON.parse`
      // over an unbounded body is work an unauthenticated caller can force.
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return invalid(correlationId, "request body exceeds the maximum size");
      }

      // The limiter then runs BEFORE any parsing or database work, and a
      // malformed attempt still costs a token (owner decision §2) — otherwise a
      // caller probes shapes for free and pays only for well-formed guesses.
      //
      // Keyed on the TRANSPORT-OBSERVED peer alone. Mixing in the claimed
      // `deviceRecordId` looks tighter and is weaker: the caller chooses that
      // value, so rotating it would mint a fresh bucket per guess and defeat the
      // limiter entirely. Per-device brute force is already bounded where it
      // belongs — 0191 gives each claim five attempts and then locks it — so this
      // limiter's job is volume, which is a property of the peer.
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
      const unknown = unknownFields(body, BODY_FIELDS);
      if (unknown.length > 0) {
        return invalid(correlationId, `unknown field: ${unknown[0]}`);
      }

      const deviceRecordId = stringField(body, "deviceRecordId", UUID);
      if (deviceRecordId === null) {
        return invalid(correlationId, "deviceRecordId must be a uuid");
      }
      // A code of the wrong SHAPE is refused as a code, not as a bad request —
      // see the header. Only a non-string or absent value is a request problem,
      // because that is not an attempt at a code at all.
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
        // Names the surface, never a human. The device is the actor here.
        actorRef: "device/hub-pairing",
      });

      const responseCorrelation = correlationId === "" ? outcome.correlationId : correlationId;

      if (outcome.result === "PAIRED" && outcome.data !== undefined) {
        deps.logger?.info({
          event: "store-hub-paired",
          correlationId: outcome.correlationId,
          deviceRecordId,
        });
        // PAIRING SUCCEEDED. Now try to advance the device, and report what
        // actually happened -- including a refusal.
        //
        // Deliberately NOT allowed to change the pairing answer: the Hub IS
        // assigned to its Store whether or not it can be activated yet, and
        // turning a successful pair into an error because the next gate is shut
        // would send an operator hunting a problem with their code.
        const advance =
          deps.advanceTrust === undefined ? undefined : await deps.advanceTrust(deviceRecordId);
        if (advance !== undefined) {
          deps.logger?.info({
            event: "store-hub-trust-advance",
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
