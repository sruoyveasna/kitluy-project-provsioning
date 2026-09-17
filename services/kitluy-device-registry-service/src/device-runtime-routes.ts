/**
 * `POST /v1/device-runtime/report` — a Pi Terminal reports its runtime.
 *
 * Authority: owner mission T1-STORE-OPERATIONS-001 (2026-09-17) §15-§17;
 * migration group 0229; the contract `@kitluy/device-identity`
 * (`device-runtime-report.ts`).
 *
 * ===========================================================================
 * WHAT THIS ROUTE TRUSTS: ONE SIGNATURE, CHECKED TWICE
 * ===========================================================================
 * It is pre-credential in the transport sense (plain HTTP, like the other
 * device routes on this service), so its safety cannot rest on the connection.
 * It rests on:
 *
 *   1. an Ed25519 signature over the canonical report bytes by the presented
 *      identity key, verified HERE, inside the trusted computing base;
 *   2. the database binding that key's fingerprint to the device's CURRENT
 *      SEALED enrollment (group 0229, the group 0224 predicate) — a caller that
 *      generates its own key signs validly and is refused there;
 *   3. a forward-only sequence per key, so a captured report cannot be replayed
 *      over a newer one.
 *
 * WHAT IT GRANTS: a row of device-attested runtime status, read by the
 * Management API for Partners already authorized for the Store. Nothing else —
 * no assignment, no credential, no configuration, no release.
 *
 * Every refusal is the same 403 to the caller; the reason is logged by code.
 * A report body is never logged.
 */
import { errorEnvelope, httpStatusFor, isRetryable } from "@kitluy/api-errors";
import {
  parseDeviceRuntimeReport,
  verifyDeviceRuntimeReport,
  type DeviceRuntimeReport,
} from "@kitluy/device-identity";

import type { RequestHeaders } from "./authentication.js";
import type { SafeLogger } from "./provisioning-composition.js";
import {
  BootstrapRateLimiter,
  MAX_REQUEST_BYTES,
  type BootstrapRouteRequest,
  type BootstrapRouteResponse,
} from "./provisioning-routes.js";

export const DEVICE_RUNTIME_PREFIX = "/v1/device-runtime";
export const DEVICE_RUNTIME_REPORT_PATH = `${DEVICE_RUNTIME_PREFIX}/report`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A detached Ed25519 signature: 64 bytes, unpadded base64url. */
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const BODY_FIELDS = [
  "deviceId",
  "identityPublicKeyPem",
  "reportSequence",
  "observedAt",
  "report",
  "signature",
] as const;

export interface DeviceRuntimeRecordInput {
  readonly deviceId: string;
  readonly identityKeyFingerprint: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: DeviceRuntimeReport;
}

export interface DeviceRuntimeRecordResult {
  readonly outcome: "ACCEPTED" | "STALE" | "REFUSED";
  readonly code?: string;
}

export interface DeviceRuntimeRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface DeviceRuntimeRouterDeps {
  readonly record: (input: DeviceRuntimeRecordInput) => Promise<DeviceRuntimeRecordResult>;
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
  readonly newCorrelationId?: () => string;
}

function headerValue(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function failure(
  code: "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" | "SCOPE_PERMISSION_DENIED",
  message: string,
  correlationId: string,
): BootstrapRouteResponse {
  return {
    status: httpStatusFor(code),
    body: errorEnvelope(code, message, {
      correlationId,
      details: { retryable: false },
    }) as unknown as Record<string, unknown>,
  };
}

type ParsedBody =
  | {
      readonly ok: true;
      readonly deviceId: string;
      readonly identityPublicKeyPem: string;
      readonly reportSequence: number;
      readonly observedAt: string;
      readonly report: DeviceRuntimeReport;
      readonly signature: Buffer;
    }
  | { readonly ok: false; readonly detail: string };

export function parseDeviceRuntimeBody(rawBody: string): ParsedBody {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, detail: "the body is not JSON" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "the body must be an object" };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [...BODY_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return { ok: false, detail: `the body must carry exactly: ${expected.join(", ")}` };
  }
  const deviceId = record["deviceId"];
  const pem = record["identityPublicKeyPem"];
  const sequence = record["reportSequence"];
  const observedAt = record["observedAt"];
  const signature = record["signature"];
  if (typeof deviceId !== "string" || !UUID.test(deviceId)) {
    return { ok: false, detail: "deviceId must be a uuid" };
  }
  if (typeof pem !== "string" || pem.length > 512 || !pem.includes("BEGIN PUBLIC KEY")) {
    return { ok: false, detail: "identityPublicKeyPem must be a PEM public key" };
  }
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return { ok: false, detail: "reportSequence must be a positive integer" };
  }
  if (
    typeof observedAt !== "string" ||
    observedAt.length > 40 ||
    Number.isNaN(new Date(observedAt).getTime())
  ) {
    return { ok: false, detail: "observedAt must be an instant" };
  }
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    return { ok: false, detail: "signature must be an unpadded base64url Ed25519 signature" };
  }
  const report = parseDeviceRuntimeReport(record["report"]);
  if (!report.ok) return { ok: false, detail: report.detail };
  return {
    ok: true,
    deviceId: deviceId.toLowerCase(),
    identityPublicKeyPem: pem,
    reportSequence: sequence,
    observedAt,
    report: report.value,
    signature: Buffer.from(signature, "base64url"),
  };
}

export function createDeviceRuntimeRouter(deps: DeviceRuntimeRouterDeps): DeviceRuntimeRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();
  const newCorrelationId = deps.newCorrelationId ?? (() => crypto.randomUUID());

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = newCorrelationId();
      if (request.path !== DEVICE_RUNTIME_REPORT_PATH) {
        return failure("RESOURCE_NOT_FOUND", "no such device-runtime route", correlationId);
      }
      if (request.method.toUpperCase() !== "POST") {
        return failure("VALIDATION_FAILED", "method not allowed", correlationId);
      }
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return failure("VALIDATION_FAILED", "request body exceeds the maximum size", correlationId);
      }
      const allowance = limiter.consume(request.sourceIp);
      if (!allowance.allowed) {
        return {
          status: httpStatusFor("RATE_LIMITED"),
          body: errorEnvelope("RATE_LIMITED", "too many runtime reports", {
            correlationId,
            details: { retryable: true },
          }) as unknown as Record<string, unknown>,
          headers: { "Retry-After": String(allowance.retryAfterSeconds) },
        };
      }
      const contentType = headerValue(request.headers, "content-type");
      if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return failure("VALIDATION_FAILED", "content-type must be application/json", correlationId);
      }

      const parsed = parseDeviceRuntimeBody(request.rawBody);
      if (!parsed.ok) return failure("VALIDATION_FAILED", parsed.detail, correlationId);

      const verdict = verifyDeviceRuntimeReport({
        identityPublicKeyPem: parsed.identityPublicKeyPem,
        deviceId: parsed.deviceId,
        reportSequence: parsed.reportSequence,
        observedAt: parsed.observedAt,
        report: parsed.report,
        signature: parsed.signature,
      });
      if (!verdict.verified) {
        deps.logger?.info({
          event: "device-runtime-report-refused",
          correlationId,
          code: "SIGNATURE_INVALID",
        });
        return failure("SCOPE_PERMISSION_DENIED", "the runtime report was refused", correlationId);
      }

      let result: DeviceRuntimeRecordResult;
      try {
        result = await deps.record({
          deviceId: parsed.deviceId,
          identityKeyFingerprint: verdict.identityPublicKeyFingerprint,
          reportSequence: parsed.reportSequence,
          observedAt: parsed.observedAt,
          report: parsed.report,
        });
      } catch (error) {
        deps.logger?.info({
          event: "device-runtime-report-unavailable",
          correlationId,
          cause: error instanceof Error ? error.name : "unknown",
        });
        return {
          status: httpStatusFor("DEPENDENCY_UNAVAILABLE"),
          body: errorEnvelope("DEPENDENCY_UNAVAILABLE", "runtime reporting is unavailable", {
            correlationId,
            details: { retryable: isRetryable("DEPENDENCY_UNAVAILABLE") },
          }) as unknown as Record<string, unknown>,
        };
      }

      if (result.outcome === "REFUSED") {
        deps.logger?.info({
          event: "device-runtime-report-refused",
          correlationId,
          code: result.code ?? "REFUSED",
          deviceRecordId: parsed.deviceId,
        });
        return failure("SCOPE_PERMISSION_DENIED", "the runtime report was refused", correlationId);
      }
      deps.logger?.info({
        event: "device-runtime-report",
        correlationId,
        outcome: result.outcome,
        deviceRecordId: parsed.deviceId,
        hubPhase: parsed.report.hubLink?.phase ?? "none",
        posState: parsed.report.pos?.state ?? "none",
      });
      return { status: 200, body: { correlationId, outcome: result.outcome } };
    },
  };
}
