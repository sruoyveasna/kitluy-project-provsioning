/**
 * The `kitluy.csr.v1` canonical bytes, as the DEVICE builds them.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND COPY, AND WHY THAT IS SAFE
 * ===========================================================================
 * The authoritative definition is `requestBytes()` in
 * `packages/device-identity/src/certificate-issuance.ts`, and the server
 * verifies with it. Importing it here is not possible: the firstboot agent ships
 * INSIDE the golden image with **zero runtime dependencies**, and
 * `infra/edge/raspberry-pi/store-hub-image/scripts/package-bootstrap-runtime.sh` refuses
 * the build outright if that ever stops being true.
 *
 * A copy of security-critical canonical bytes is exactly the thing that drifts
 * silently and is discovered in the field, so it is kept honest by
 * `test/operational-csr-drift.test.ts`, which builds the same input through BOTH
 * implementations and fails if a single byte differs — the same discipline
 * `enrollment-pop-bytes.ts` and `device-registration-bytes.ts` already use.
 *
 * If you change the field order, the separator, or the kind string here, that
 * test fails. That is the point.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 * CREDENTIAL GENERATION. The server allocates it, so the device cannot know it
 * in order to sign it — and a device that could name its own generation could
 * pre-empt a renewal. `assignmentGeneration` IS present and is a different
 * thing: it is the Store assignment the device already holds.
 *
 * Also absent: serial, validity window, issuer, trusted time, and
 * `popServiceVerified`. Every one of those is decided by the governed doors, and
 * a request that carried them would be asking the device to choose them.
 */
/** Domain separator. MUST equal the literal in `requestBytes()`. */
export const OPERATIONAL_CSR_KIND = "kitluy.csr.v1";
/** The only purpose this path issues for. */
export const OPERATIONAL_CSR_PURPOSE = "device_identity";
/**
 * The bytes the device signs.
 *
 * Newline-joined UTF-8, matching `requestBytes()` field for field. No length
 * prefixes and no escaping — which is inherited, not chosen, and is why the
 * drift test exists rather than a re-derivation.
 */
export function operationalCsrBytes(fields) {
    return Buffer.from([
        OPERATIONAL_CSR_KIND,
        fields.requestId,
        fields.deviceRecordId,
        fields.environment,
        fields.publicKeyFingerprint,
        fields.hardwareTrustLevel,
        String(fields.assignmentGeneration),
        fields.requestedPurpose,
        fields.requestedAt,
        fields.nonce,
        fields.correlationId,
    ].join("\n"), "utf8");
}
//# sourceMappingURL=operational-csr-bytes.js.map