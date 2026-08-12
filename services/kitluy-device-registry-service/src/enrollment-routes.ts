/**
 * The factory-enrollment HTTP surface — `/v1/device-enrollment`.
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2);
 *            KLSRC-0162 §4 (enrollment is automatic), §35 (not Store pairing).
 *
 * This is the endpoint whose absence the device agent has been reporting.
 * `services/kitluy-device-firstboot-agent/src/bin/enrollment-bootstrap.ts`
 * states in its own header that "the cloud factory-enrollment endpoint DOES
 * NOT EXIST YET" and that when it does, the only change needed there is to
 * inject a real `EnrollmentClient`. This file is that endpoint.
 *
 * ===========================================================================
 * TRANSPORT CONVENTIONS ARE BORROWED, NOT REINVENTED
 * ===========================================================================
 * Request cap, rate limiter, correlation-id handling and the refusal envelope
 * all come from `provisioning-routes.ts`. Two device-facing bootstrap surfaces
 * that behaved differently under load or error would be two surfaces to reason
 * about; this is deliberately the same one twice.
 *
 * ===========================================================================
 * ENUMERATION RESISTANCE
 * ===========================================================================
 * The composition layer already collapses every ticket-authority refusal to
 * `TICKET_REFUSED`. This layer must not undo that, so `TICKET_REFUSED` and
 * `PROOF_INVALID` map to the SAME canonical code, the SAME fixed message and
 * therefore the SAME status and body. An attacker holding a guessed ticket
 * reference learns nothing about whether it exists, has expired, was revoked,
 * or was already redeemed.
 *
 * `auditDetail` — which carries the specific internal cause — is logged and
 * never placed in a response.
 */
import { randomUUID } from "node:crypto";

import {
  errorEnvelope,
  httpStatusFor,
  isRetryable,
  type KitluyErrorCode,
} from "@kitluy/api-errors";
import {
  MANUFACTURING_ENROLLMENT_POP_PURPOSE,
  type ManufacturingEnrollmentPopChallenge,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import type { RequestHeaders } from "./authentication.js";
import type { EnrollmentComposition, EnrollmentResultCode } from "./enrollment-composition.js";
import {
  BootstrapRateLimiter,
  MAX_REQUEST_BYTES,
  type BootstrapRouteRequest,
  type BootstrapRouteResponse,
} from "./provisioning-routes.js";
import type { SafeLogger } from "./provisioning-composition.js";

export const DEVICE_ENROLLMENT_PREFIX = "/v1/device-enrollment";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const TICKET_REFERENCE = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Unpadded base64url; a 64-byte Ed25519 signature is 86 chars. */
const SIGNATURE_BASE64URL = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_PUBLIC_KEY_PEM_CHARS = 4096;

/**
 * Result → canonical error. `TICKET_REFUSED` and `PROOF_INVALID` deliberately
 * share a code: see the header. Splitting them would make the endpoint an
 * oracle for which half of the credential was wrong.
 */
const CANONICAL_ERROR: Readonly<Record<EnrollmentResultCode, KitluyErrorCode>> = {
  CHALLENGE_ISSUED: "INTERNAL_ERROR",
  ENROLLED: "INTERNAL_ERROR",
  TICKET_REFUSED: "SCOPE_PERMISSION_DENIED",
  PROOF_INVALID: "SCOPE_PERMISSION_DENIED",
  CHALLENGE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  ENROLLMENT_REFUSED: "VALIDATION_FAILED",
  TIME_TOKEN_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  REQUEST_INVALID: "VALIDATION_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

/** Fixed safe text per canonical code. Never echoes a caller value. */
const CANONICAL_MESSAGE: Readonly<Partial<Record<KitluyErrorCode, string>>> = {
  SCOPE_PERMISSION_DENIED: "the presented enrollment authority was refused",
  RESOURCE_NOT_FOUND: "no such enrollment challenge",
  DEPENDENCY_UNAVAILABLE: "the enrollment time authority is unavailable",
  VALIDATION_FAILED: "the request is invalid",
  INTERNAL_ERROR: "the operation failed and the details are not disclosed",
};

export interface EnrollmentRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface EnrollmentRouterDeps {
  readonly composition: EnrollmentComposition;
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
  readonly environment?: TrustEnvironment;
}

function headerValues(headers: RequestHeaders, name: string): readonly string[] {
  const raw = headers[name];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function correlationIdFrom(headers: RequestHeaders): string {
  const value = headerValues(headers, "x-correlation-id")[0];
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim() : randomUUID();
}

function contentTypeIsJson(headers: RequestHeaders): boolean {
  const value = headerValues(headers, "content-type")[0];
  return (
    typeof value === "string" && value.toLowerCase().split(";")[0]?.trim() === "application/json"
  );
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

function stringField(body: Record<string, unknown>, key: string, shape: RegExp): string | null {
  const value = body[key];
  return typeof value === "string" && shape.test(value) ? value : null;
}

function refusal(result: EnrollmentResultCode, correlationId: string): BootstrapRouteResponse {
  const code = CANONICAL_ERROR[result];
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, CANONICAL_MESSAGE[code] ?? "the request was refused", {
      correlationId,
      // NOTE: `result` is intentionally the COARSE code, never `auditDetail`.
      details: { result, retryable: isRetryable(code) },
    }) as unknown as Record<string, unknown>,
  };
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

type MatchedRoute = "challenges" | "redemptions";

function matchRoute(method: string, path: string): MatchedRoute | "METHOD_NOT_ALLOWED" | null {
  const clean = path.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (clean === `${DEVICE_ENROLLMENT_PREFIX}/challenges`) {
    return method === "POST" ? "challenges" : "METHOD_NOT_ALLOWED";
  }
  if (clean === `${DEVICE_ENROLLMENT_PREFIX}/redemptions`) {
    return method === "POST" ? "redemptions" : "METHOD_NOT_ALLOWED";
  }
  return null;
}

export function createEnrollmentRouter(deps: EnrollmentRouterDeps): EnrollmentRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();
  const environment: TrustEnvironment = deps.environment ?? "development";
  const log = deps.logger;

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = correlationIdFrom(request.headers);
      const route = matchRoute(request.method, request.path);

      if (route === null) {
        return {
          status: httpStatusFor("RESOURCE_NOT_FOUND"),
          body: errorEnvelope("RESOURCE_NOT_FOUND", "no such route", {
            correlationId,
          }) as unknown as Record<string, unknown>,
        };
      }
      if (route === "METHOD_NOT_ALLOWED") {
        return {
          status: 405,
          body: errorEnvelope("VALIDATION_FAILED", "method not allowed", {
            correlationId,
          }) as unknown as Record<string, unknown>,
        };
      }

      // Size before parse: a caller must not be able to make the process do
      // JSON work proportional to an unbounded body.
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return invalid(correlationId, "request body exceeds the permitted size");
      }
      if (!contentTypeIsJson(request.headers)) {
        return invalid(correlationId, "content-type must be application/json");
      }

      // Rate limited per source, BEFORE any database work. The limiter is
      // keyed on the source address rather than the ticket, because keying on
      // the credential would let an attacker probe many references cheaply.
      const decision = limiter.consume(`${request.sourceIp}:${route}`);
      if (!decision.allowed) {
        return {
          status: httpStatusFor("RATE_LIMITED"),
          body: errorEnvelope("RATE_LIMITED", "too many enrollment attempts", {
            correlationId,
            details: { retryable: true },
          }) as unknown as Record<string, unknown>,
          headers: { "retry-after": String(decision.retryAfterSeconds) },
        };
      }

      const body = parseBody(request.rawBody);
      if (body === null) return invalid(correlationId, "body must be a JSON object");

      if (route === "challenges") {
        const ticketReference = stringField(body, "ticketReference", TICKET_REFERENCE);
        const ticketDigest = stringField(body, "ticketDigest", HEX64);
        const publicKeyFingerprintValue = stringField(body, "publicKeyFingerprint", HEX64);

        // NO TICKET PRESENTED — the development open-enrollment path
        // (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001). A copied SD card carries no
        // ticket by design, so this is how a cloned card enrolls at all. When
        // the deployment has it disabled the composition refuses with the same
        // `TICKET_REFUSED` as a bad ticket, so an enabled and a disabled
        // deployment are indistinguishable from outside.
        if (ticketReference === null && ticketDigest === null) {
          const publicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem : "";
          const publicKeyAlgorithm =
            typeof body.publicKeyAlgorithm === "string" ? body.publicKeyAlgorithm : "";
          const keyStorageClass =
            typeof body.keyStorageClass === "string" ? body.keyStorageClass : "";
          const deviceClass = typeof body.deviceClass === "string" ? body.deviceClass : "";

          if (
            publicKeyFingerprintValue === null ||
            publicKeyPem.length === 0 ||
            publicKeyPem.length > MAX_PUBLIC_KEY_PEM_CHARS ||
            publicKeyAlgorithm.length === 0 ||
            keyStorageClass.length === 0 ||
            deviceClass.length === 0
          ) {
            return invalid(correlationId, "the request is missing or malformed required fields");
          }

          const openOutcome = await deps.composition.openChallengeWithoutTicket({
            deviceClass,
            publicKeyFingerprint: publicKeyFingerprintValue,
            publicKeyPem,
            publicKeyAlgorithm,
            keyStorageClass,
          });

          if (openOutcome.auditDetail !== undefined) {
            log?.info({
              event: "open_enrollment_challenge_refused",
              correlationId,
              result: openOutcome.result,
              detail: openOutcome.auditDetail,
            });
          }
          if (openOutcome.result !== "CHALLENGE_ISSUED" || openOutcome.data === undefined) {
            return refusal(openOutcome.result, correlationId);
          }

          const oc = openOutcome.data;
          return {
            status: 201,
            body: {
              challenge: {
                challengeId: oc.challengeId,
                purpose: oc.purpose,
                environment: oc.environment,
                presentedKeyFingerprint: publicKeyFingerprintValue,
                nonce: oc.nonce,
                issuedAt: oc.issuedAt.toISOString(),
                expiresAt: oc.expiresAt.toISOString(),
                signatureAlgorithm: oc.signatureAlgorithm,
                signingPayloadEncoding: oc.signingPayloadEncoding,
              },
              correlationId,
            },
          };
        }
        const publicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem : "";
        const publicKeyAlgorithm =
          typeof body.publicKeyAlgorithm === "string" ? body.publicKeyAlgorithm : "";
        const keyStorageClass =
          typeof body.keyStorageClass === "string" ? body.keyStorageClass : "";

        if (
          ticketReference === null ||
          ticketDigest === null ||
          publicKeyFingerprintValue === null ||
          publicKeyPem.length === 0 ||
          publicKeyPem.length > MAX_PUBLIC_KEY_PEM_CHARS ||
          publicKeyAlgorithm.length === 0 ||
          keyStorageClass.length === 0
        ) {
          return invalid(correlationId, "the request is missing or malformed required fields");
        }

        const outcome = await deps.composition.openChallenge({
          ticketReference,
          ticketDigest,
          publicKeyFingerprint: publicKeyFingerprintValue,
          publicKeyPem,
          publicKeyAlgorithm,
          keyStorageClass,
        });

        if (outcome.auditDetail !== undefined) {
          log?.info({
            event: "enrollment_challenge_refused",
            correlationId,
            result: outcome.result,
            detail: outcome.auditDetail,
          });
        }
        if (outcome.result !== "CHALLENGE_ISSUED" || outcome.data === undefined) {
          return refusal(outcome.result, correlationId);
        }

        const c = outcome.data;
        return {
          status: 201,
          body: {
            challenge: {
              challengeId: c.challengeId,
              purpose: c.purpose,
              environment: c.environment,
              presentedKeyFingerprint: publicKeyFingerprintValue,
              nonce: c.nonce,
              issuedAt: c.issuedAt.toISOString(),
              expiresAt: c.expiresAt.toISOString(),
              signatureAlgorithm: c.signatureAlgorithm,
              signingPayloadEncoding: c.signingPayloadEncoding,
            },
            correlationId,
          },
        };
      }

      // --- redemptions -----------------------------------------------------
      const challengeId = stringField(body, "challengeId", UUID);
      const signatureB64 = stringField(body, "signature", SIGNATURE_BASE64URL);
      const publicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem : "";
      const assetTag = typeof body.assetTag === "string" ? body.assetTag : "";
      const nonce = stringField(body, "nonce", HEX64);
      const presentedKeyFingerprint = stringField(body, "presentedKeyFingerprint", HEX64);
      const issuedAt = typeof body.issuedAt === "string" ? new Date(body.issuedAt) : null;
      const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null;
      const signals = Array.isArray(body.signals) ? body.signals : null;

      if (
        challengeId === null ||
        signatureB64 === null ||
        nonce === null ||
        presentedKeyFingerprint === null ||
        publicKeyPem.length === 0 ||
        publicKeyPem.length > MAX_PUBLIC_KEY_PEM_CHARS ||
        assetTag.length === 0 ||
        assetTag.length > 128 ||
        issuedAt === null ||
        Number.isNaN(issuedAt.getTime()) ||
        expiresAt === null ||
        Number.isNaN(expiresAt.getTime()) ||
        signals === null
      ) {
        return invalid(correlationId, "the request is missing or malformed required fields");
      }

      const challenge: ManufacturingEnrollmentPopChallenge = {
        challengeId,
        purpose: MANUFACTURING_ENROLLMENT_POP_PURPOSE,
        environment,
        presentedKeyFingerprint,
        nonce,
        issuedAt,
        expiresAt,
      };

      const outcome = await deps.composition.redeem({
        challengeId,
        challenge,
        signature: Buffer.from(signatureB64, "base64url"),
        publicKeyPem,
        assetTag,
        signals,
        expectation: {
          environment,
          presentedKeyFingerprint,
          nonce,
          expiresAt,
        },
      });

      if (outcome.auditDetail !== undefined) {
        log?.info({
          event: "enrollment_redemption_refused",
          correlationId,
          result: outcome.result,
          detail: outcome.auditDetail,
        });
      }
      if (outcome.result !== "ENROLLED" || outcome.data === undefined) {
        return refusal(outcome.result, correlationId);
      }

      const d = outcome.data;
      return {
        status: 201,
        body: {
          // Bootstrap/fleet facts only. There is deliberately no tenant,
          // digitalStore, storeLocation, storeHub, terminalProfile or vertical
          // here, because none exists until Store pairing (§35).
          deviceRecordId: d.deviceRecordId,
          fleetEnrollment: d.fleetEnrollment,
          storeAssignment: d.storeAssignment,
          environment: d.environment,
          trustedTimeToken: {
            token: {
              protocolVersion: d.timeToken.protocolVersion,
              issuer: d.timeToken.issuer,
              deviceRecordId: d.timeToken.deviceRecordId,
              challengeId: d.timeToken.challengeId,
              environment: d.timeToken.environment,
              issuedAt: d.timeToken.issuedAt.toISOString(),
              expiresAt: d.timeToken.expiresAt.toISOString(),
            },
            signature: d.timeTokenSignature,
          },
          correlationId,
        },
      };
    },
  };
}
