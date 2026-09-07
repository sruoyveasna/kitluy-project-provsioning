/**
 * The governed route a Store Hub uses to obtain its operational X.509.
 *
 * Authority: owner instruction 2026-08-28 Step 2 ("do not invent a second
 * certificate issuance API… if transport wiring is missing, add the smallest
 * versioned route required"); the composition in `first-operational-issuance.ts`.
 *
 * ===========================================================================
 * THIS ROUTE DECIDES NOTHING
 * ===========================================================================
 * It is transport. It parses a `kitluy.csr.v1` request, hands it to
 * `issueFirstOperationalCertificate`, and renders the answer. Every security
 * decision — proof of possession, generation allocation, serial, validity
 * window, issuer, environment, trusted time — is made behind the governed doors
 * and is deliberately NOT expressible in this body.
 *
 * In particular the request cannot carry `popServiceVerified`. That value is the
 * SERVER's own verdict, computed inside the trusted computing base, and a field
 * for it would be an invitation. The parser refuses unknown fields outright, so
 * adding one later fails the request rather than being silently ignored.
 *
 * ===========================================================================
 * WHAT THE DEVICE IS TRUSTED FOR
 * ===========================================================================
 * Only the bytes it signed. The request names a device and proves possession of
 * a key; if the proof does not verify against the presented key, or the key is
 * not one this environment can issue for, the composition refuses and this route
 * renders the refusal code verbatim. A device cannot become another device by
 * claiming its id, because the governed doors check the assignment, the
 * lifecycle state and the generation head before anything is spent.
 */
import { randomUUID } from "node:crypto";

import { issueFirstOperationalCertificate } from "./first-operational-issuance.js";
import type { HardwareTrustLevel } from "@kitluy/device-identity";
import type pg from "pg";
import { errorEnvelope, httpStatusFor } from "@kitluy/api-errors";

import { advanceDeviceTrust } from "./device-trust-advance.js";
import type {
  BootstrapRouteRequest,
  BootstrapRouteResponse,
} from "./provisioning-routes.js";

export const OPERATIONAL_CERTIFICATE_PREFIX = "/v1/operational-certificate";

/** Bounded, for the same reason every bootstrap route is. */
const MAX_REQUEST_BYTES = 16 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Exactly the `kitluy.csr.v1` fields, and nothing that decides an outcome.
 *
 * `assignmentGeneration` is present because the device signs it; credential
 * generation is absent because the server allocates it.
 */
const BODY_FIELDS: readonly string[] = [
  "requestId",
  "deviceRecordId",
  "environment",
  "operationalPublicKeyPem",
  "publicKeyFingerprint",
  "hardwareTrustLevel",
  "assignmentGeneration",
  "requestedPurpose",
  "requestedAt",
  "nonce",
  "correlationId",
  "proofOfPossession",
];

export interface OperationalCertificateRouterDeps {
  readonly pool: pg.Pool;
  /** Overridable so tests can drive a configured PKI without a global. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * WHY THIS ROUTE LOGS AT ALL.
   *
   * It was the ONLY governed route that emitted nothing — not a request, not a
   * refusal. During the first hardware bring-up a Hub sat refused for hours while
   * the server said nothing, and the device could not help either: the client
   * reads `payload.code`/`payload.details` but `errorEnvelope` nests both under
   * `error`, so every refusal reached the Pi as the generic `OPCERT_REFUSED`.
   * The precise code existed on both sides of the wire and was visible on neither.
   *
   * Never logs key material, a CSR, or a certificate — only the typed code and
   * the correlation id, which is what joins a device's console to these logs.
   */
  readonly logger?: { info(fields: Record<string, unknown>): void };
}

export interface OperationalCertificateRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

function invalid(correlationId: string, detail: string): BootstrapRouteResponse {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: { retryable: false },
    }) as unknown as Record<string, unknown>,
  };
}

function parseBody(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createOperationalCertificateRouter(
  deps: OperationalCertificateRouterDeps,
): OperationalCertificateRouter {
  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationHeader = request.headers["x-correlation-id"];
      const correlationId =
        typeof correlationHeader === "string" && UUID.test(correlationHeader)
          ? correlationHeader
          : randomUUID();

      if (request.path !== OPERATIONAL_CERTIFICATE_PREFIX) {
        return {
          status: httpStatusFor("RESOURCE_NOT_FOUND"),
          body: errorEnvelope("RESOURCE_NOT_FOUND", "no such certificate route", {
            correlationId,
            details: { retryable: false },
          }) as unknown as Record<string, unknown>,
        };
      }
      if (request.method.toUpperCase() !== "POST") {
        return invalid(correlationId, "method not allowed");
      }
      // Size first: it costs a length read, where JSON.parse over an unbounded
      // body is work a caller can force.
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return invalid(correlationId, "request body exceeds the maximum size");
      }

      const body = parseBody(request.rawBody);
      if (body === null) return invalid(correlationId, "body must be a JSON object");

      const unknown = Object.keys(body).filter((key) => !BODY_FIELDS.includes(key));
      if (unknown.length > 0) {
        // Refused, not ignored. An ignored unknown field is how a caller
        // discovers that `popServiceVerified` is silently accepted one day.
        return invalid(correlationId, `unknown field: ${unknown[0]}`);
      }

      const text = (key: string): string | null =>
        typeof body[key] === "string" && (body[key] as string).length > 0
          ? (body[key] as string)
          : null;

      const requestId = text("requestId");
      const deviceRecordId = text("deviceRecordId");
      const environment = text("environment");
      const operationalPublicKeyPem = text("operationalPublicKeyPem");
      const publicKeyFingerprint = text("publicKeyFingerprint");
      const hardwareTrustLevel = text("hardwareTrustLevel");
      const requestedPurpose = text("requestedPurpose");
      const requestedAt = text("requestedAt");
      const nonce = text("nonce");
      const proofOfPossession = text("proofOfPossession");
      const assignmentGeneration = body.assignmentGeneration;

      if (requestId === null || !UUID.test(requestId)) {
        return invalid(correlationId, "requestId must be a uuid");
      }
      if (deviceRecordId === null || !UUID.test(deviceRecordId)) {
        return invalid(correlationId, "deviceRecordId must be a uuid");
      }
      if (environment === null) return invalid(correlationId, "environment must be a string");
      if (operationalPublicKeyPem === null || !operationalPublicKeyPem.includes("PUBLIC KEY")) {
        return invalid(correlationId, "operationalPublicKeyPem must be a PEM public key");
      }
      if (publicKeyFingerprint === null || !HEX64.test(publicKeyFingerprint)) {
        return invalid(correlationId, "publicKeyFingerprint must be a sha-256 hex digest");
      }
      if (hardwareTrustLevel === null) {
        return invalid(correlationId, "hardwareTrustLevel must be a string");
      }
      if (requestedPurpose !== "device_identity") {
        return invalid(correlationId, "requestedPurpose must be device_identity");
      }
      if (requestedAt === null || Number.isNaN(Date.parse(requestedAt))) {
        return invalid(correlationId, "requestedAt must be an ISO-8601 instant");
      }
      if (nonce === null || !UUID.test(nonce)) return invalid(correlationId, "nonce must be a uuid");
      if (proofOfPossession === null) {
        return invalid(correlationId, "proofOfPossession must be base64");
      }
      if (typeof assignmentGeneration !== "number" || !Number.isInteger(assignmentGeneration)) {
        return invalid(correlationId, "assignmentGeneration must be an integer");
      }

      let signature: Buffer;
      try {
        signature = Buffer.from(proofOfPossession, "base64");
      } catch {
        return invalid(correlationId, "proofOfPossession must be base64");
      }
      if (signature.length === 0) {
        return invalid(correlationId, "proofOfPossession must not be empty");
      }

      // The device's `requestedAt` is carried through because it is part of the
      // SIGNED preimage and the proof would not verify without it. It does NOT
      // become the certificate's validity anchor — group 0204 (finding C-2)
      // moved that to the server's own governed clock, and this route has no way
      // to influence it.
      let outcome: Awaited<ReturnType<typeof issueFirstOperationalCertificate>>;
      try {
        outcome = await issueFirstOperationalCertificate(
          deps.pool,
          {
            deviceRecordId,
            environment,
            assignmentGeneration,
            hardwareTrustLevel: hardwareTrustLevel as HardwareTrustLevel,
            operationalPublicKeyPem,
            operationalKeyHandle: `hub:${deviceRecordId}:${requestId}`,
            proofOfPossession: new Uint8Array(signature),
            requestId,
            nonce,
            correlationId,
            requestedAt: new Date(requestedAt),
            trustedTimeStatus: "trusted",
            actorRef: `device/${deviceRecordId}`,
          },
          deps.env,
        );
      } catch (error) {
        // `assertDevelopmentOnly` THROWS for pilot and production rather than
        // refusing, because being asked to sign one is a misconfiguration and
        // not a normal answer. Rendered as a refusal here so a device sees a
        // typed code instead of a 500.
        return {
          status: httpStatusFor("VALIDATION_FAILED"),
          body: errorEnvelope(
            "VALIDATION_FAILED",
            error instanceof Error ? error.message : "issuance refused",
            { correlationId, details: { retryable: false, refusalCode: "OPCERT_ENVIRONMENT" } },
          ) as unknown as Record<string, unknown>,
        };
      }

      if (outcome.outcome === "REFUSED") {
        // The typed refusal code is preserved verbatim. `OPCERT_CA_UNAVAILABLE`
        // and `OPCERT_POSSESSION_PROOF_FAILED` need completely different
        // operator actions, and a surface that flattened them to "refused" would
        // make the difference invisible.
        const retryable = outcome.refusalCode === "OPCERT_CA_UNAVAILABLE";
        deps.logger?.info({
          event: "operational-certificate-refused",
          correlationId,
          refusalCode: outcome.refusalCode,
          retryable,
          detail: outcome.detail,
        });
        return {
          status: httpStatusFor(retryable ? "DEPENDENCY_UNAVAILABLE" : "VALIDATION_FAILED"),
          body: errorEnvelope(
            retryable ? "DEPENDENCY_UNAVAILABLE" : "VALIDATION_FAILED",
            outcome.detail,
            {
              correlationId,
              details: { retryable, refusalCode: outcome.refusalCode },
            },
          ) as unknown as Record<string, unknown>,
        };
      }

      // THE CERTIFICATE WAS THE LAST MISSING PRECONDITION, SO RE-CHECK TRUST HERE.
      //
      // Activation is gated on four facts: an accepted claim, a live assignment,
      // trusted time, and an operational certificate. `advanceDeviceTrust` runs
      // once, during pairing — and at that moment the certificate does not exist
      // yet, because the Hub generates its operational key at firstboot and only
      // asks for a certificate AFTER it is paired. So pairing's attempt is
      // correctly `blocked`, and nothing ever reconsidered it.
      //
      // The result was a Store Hub that registered, was approved, paired,
      // established trusted time and obtained a valid certificate — and then sat
      // at `awaiting_trust` for ever, with every precondition satisfied and no
      // one left to notice. Observed on hardware 2026-08-31.
      //
      // This is the moment the last precondition becomes true, so this is where
      // the question gets asked again. `attempt_activate_device_v1` is idempotent
      // and refuses politely when a precondition is still missing, so a device
      // that is not ready simply stays put.
      //
      // Deliberately NOT fatal: the certificate is already issued and durable. If
      // activation fails the device still holds a valid identity, and the failure
      // is logged rather than turned into a refusal that would tell the Hub its
      // certificate did not work.
      try {
        const advanced = await advanceDeviceTrust(deps.pool, {
          deviceRecordId,
          environment,
          actorRef: "device/operational-certificate",
        });
        deps.logger?.info({
          event: "post-issuance-trust-advance",
          correlationId,
          result: advanced.kind,
          ...(advanced.kind === "advanced"
            ? { lifecycleState: advanced.lifecycleState }
            : { detail: advanced.detail }),
        });
      } catch (error) {
        deps.logger?.info({
          event: "post-issuance-trust-advance",
          correlationId,
          result: "error",
          detail: error instanceof Error ? error.message : "unknown",
        });
      }

      // NO private key, NO CA key material, NO issuer secrets. The chain is
      // public certificates and the metadata is what the device must verify
      // against.
      return {
        status: 200,
        body: {
          outcome: outcome.outcome,
          correlationId,
          credentialId: outcome.credentialId,
          certificateGeneration: outcome.certificateGeneration,
          serialNumber: outcome.serialNumber,
          certificateSha256: outcome.certificateSha256,
          certificatePem: outcome.certificatePem,
          chainPem: outcome.chainPem,
          publicKeyAlgorithm: outcome.publicKeyAlgorithm,
          ...(outcome.notBefore === undefined ? {} : { notBefore: outcome.notBefore }),
          ...(outcome.notAfter === undefined ? {} : { notAfter: outcome.notAfter }),
        },
      };
    },
  };
}
