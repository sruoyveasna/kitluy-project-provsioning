export const OPERATIONAL_CERTIFICATE_PATH = "/v1/operational-certificate";
/**
 * Transport and server faults are RETRYABLE; a decision about the request's
 * content is not.
 *
 * A 4xx from this route means the governed doors judged the request — a bad
 * proof, an unsupported key, a spent generation — and asking again unchanged
 * repeats the same refusal. 408/429/5xx are the transport or the server having a
 * bad moment, which a later boot may not.
 */
function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
function readResponse(payload) {
    const text = (key) => typeof payload[key] === "string" ? payload[key] : undefined;
    const certificatePem = text("certificatePem");
    const chainPem = text("chainPem");
    const credentialId = text("credentialId");
    const serialNumber = text("serialNumber");
    const certificateSha256 = text("certificateSha256");
    const publicKeyAlgorithm = text("publicKeyAlgorithm");
    const generation = payload.certificateGeneration;
    if (certificatePem === undefined ||
        chainPem === undefined ||
        credentialId === undefined ||
        serialNumber === undefined ||
        certificateSha256 === undefined ||
        publicKeyAlgorithm === undefined ||
        typeof generation !== "number") {
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
        ...(text("notBefore") === undefined ? {} : { notBefore: text("notBefore") }),
        ...(text("notAfter") === undefined ? {} : { notAfter: text("notAfter") }),
    };
}
export function createHttpOperationalCertificateClient(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 20_000;
    return {
        async request(input) {
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
                let payload;
                try {
                    payload = (await response.json());
                }
                catch {
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
                const details = payload.details;
                const refusalCode = typeof details?.refusalCode === "string"
                    ? details.refusalCode
                    : typeof payload.code === "string"
                        ? payload.code
                        : "OPCERT_REFUSED";
                const retryable = typeof details?.retryable === "boolean"
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
            }
            catch (error) {
                // A timeout or a dead network. NOT a refusal: nothing was decided, and
                // the persisted request state means the next boot replays this exact
                // request rather than asking for a second identity.
                return {
                    kind: "unreachable",
                    detail: error instanceof Error && error.name === "AbortError"
                        ? `the registry did not answer within ${timeoutMs}ms`
                        : "the registry could not be reached",
                };
            }
            finally {
                clearTimeout(deadline);
            }
        },
    };
}
//# sourceMappingURL=http-operational-certificate-client.js.map