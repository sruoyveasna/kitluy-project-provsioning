/**
 * The transport for governed operational-certificate issuance.
 *
 * Authority: owner instruction 2026-08-28 Step 2; the route in
 * `services/kitluy-device-registry-service/src/operational-certificate-routes.ts`.
 *
 * ===========================================================================
 * ZERO RUNTIME DEPENDENCIES
 * ===========================================================================
 * Node's global `fetch`, an `AbortController` for the deadline, and nothing
 * else — the same shape `http-registration-client.ts` uses. The image ships no
 * `node_modules` and the packaging script refuses the build if that changes.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ===========================================================================
 * It does not retry on its own. A retry here would re-send the same signed
 * request within one boot, which is harmless, and would ALSO obscure how many
 * times a failing server was asked. Retrying is the FIRSTBOOT UNIT's decision
 * across boots, where the persisted request state makes it byte-identical and
 * therefore genuinely idempotent — that is the property finding C-3 turns on.
 *
 * It never logs the request body. The body carries no private key, but it does
 * carry a proof of possession, and a signature in a log is a signature an
 * operator can copy.
 */
import type {
  IssuanceCallResult,
  IssuanceResponse,
  OperationalCertificateClient,
} from "../operational-tls-client.js";
import type { OperationalCsrFields } from "../operational-csr-bytes.js";

export const OPERATIONAL_CERTIFICATE_PATH = "/v1/operational-certificate";

export interface HttpOperationalCertificateClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Transport and server faults are RETRYABLE; a decision about the request's
 * content is not.
 *
 * A 4xx from this route means the governed doors judged the request — a bad
 * proof, an unsupported key, a spent generation — and asking again unchanged
 * repeats the same refusal. 408/429/5xx are the transport or the server having a
 * bad moment, which a later boot may not.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function readResponse(payload: Record<string, unknown>): IssuanceResponse | null {
  const text = (key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;
  const certificatePem = text("certificatePem");
  const chainPem = text("chainPem");
  const credentialId = text("credentialId");
  const serialNumber = text("serialNumber");
  const certificateSha256 = text("certificateSha256");
  const publicKeyAlgorithm = text("publicKeyAlgorithm");
  const generation = payload.certificateGeneration;
  if (
    certificatePem === undefined ||
    chainPem === undefined ||
    credentialId === undefined ||
    serialNumber === undefined ||
    certificateSha256 === undefined ||
    publicKeyAlgorithm === undefined ||
    typeof generation !== "number"
  ) {
    return null;
  }
  const outcome = payload.outcome === "REPLAYED" ? "REPLAYED" : "ISSUED";
  return {
    outcome,
    credentialId,
    certificateGeneration: generation,
    serialNumber,
    certificateSha256,
    certificatePem,
    chainPem,
    publicKeyAlgorithm,
    ...(text("notBefore") === undefined ? {} : { notBefore: text("notBefore") as string }),
    ...(text("notAfter") === undefined ? {} : { notAfter: text("notAfter") as string }),
  };
}

export function createHttpOperationalCertificateClient(
  options: HttpOperationalCertificateClientOptions,
): OperationalCertificateClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    async request(input: {
      csr: OperationalCsrFields;
      operationalPublicKeyPem: string;
      proofOfPossessionBase64: string;
    }): Promise<IssuanceCallResult> {
      const controller = new AbortController();
      const deadline = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await doFetch(`${options.baseUrl}${OPERATIONAL_CERTIFICATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Propagated so a refusal in the cloud logs can be joined to this
            // boot without the device having to be identified another way.
            "x-correlation-id": input.csr.correlationId,
          },
          body: JSON.stringify({
            requestId: input.csr.requestId,
            deviceRecordId: input.csr.deviceRecordId,
            environment: input.csr.environment,
            operationalPublicKeyPem: input.operationalPublicKeyPem,
            publicKeyFingerprint: input.csr.publicKeyFingerprint,
            hardwareTrustLevel: input.csr.hardwareTrustLevel,
            assignmentGeneration: input.csr.assignmentGeneration,
            requestedPurpose: input.csr.requestedPurpose,
            requestedAt: input.csr.requestedAt,
            nonce: input.csr.nonce,
            proofOfPossession: input.proofOfPossessionBase64,
          }),
          signal: controller.signal,
        });

        let payload: Record<string, unknown>;
        try {
          payload = (await response.json()) as Record<string, unknown>;
        } catch {
          return {
            kind: "refused",
            refusal: {
              refusalCode: "OPCERT_MALFORMED_RESPONSE",
              detail: "the registry response was not JSON",
              retryable: isRetryableStatus(response.status),
            },
          };
        }

        if (response.ok) {
          const issued = readResponse(payload);
          if (issued === null) {
            return {
              kind: "refused",
              refusal: {
                refusalCode: "OPCERT_MALFORMED_RESPONSE",
                detail: "the registry response was missing required certificate fields",
                retryable: false,
              },
            };
          }
          return { kind: "issued", response: issued };
        }

        // The typed refusal code, preserved. `OPCERT_CA_UNAVAILABLE` and
        // `OPCERT_POSSESSION_PROOF_FAILED` demand different operator actions.
        const details = payload.details as Record<string, unknown> | undefined;
        const refusalCode =
          typeof details?.refusalCode === "string"
            ? details.refusalCode
            : typeof payload.code === "string"
              ? payload.code
              : "OPCERT_REFUSED";
        const retryable =
          typeof details?.retryable === "boolean"
            ? details.retryable
            : isRetryableStatus(response.status);
        return {
          kind: "refused",
          refusal: {
            refusalCode,
            detail: typeof payload.message === "string" ? payload.message : "issuance was refused",
            retryable,
          },
        };
      } catch (error) {
        // A timeout or a dead network. NOT a refusal: nothing was decided, and
        // the persisted request state means the next boot replays this exact
        // request rather than asking for a second identity.
        return {
          kind: "unreachable",
          detail:
            error instanceof Error && error.name === "AbortError"
              ? `the registry did not answer within ${timeoutMs}ms`
              : "the registry could not be reached",
        };
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
