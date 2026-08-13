/**
 * The factory-enrollment proof-of-possession canonical bytes, as the DEVICE
 * builds them.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND COPY, AND WHY THAT IS SAFE
 * ===========================================================================
 * The authoritative definition lives in
 * `packages/device-identity/src/manufacturing-enrollment-pop.ts`, and the
 * server verifies with it. Importing it here is not possible: the firstboot
 * agent ships INSIDE the golden image with **zero runtime dependencies**, and
 * `infra/kitluy-store-hub-image/scripts/package-bootstrap-runtime.sh` refuses the
 * build outright if that ever stops being true —
 *
 *     REFUSED: the firstboot agent gained runtime dependencies;
 *              the image ships no node_modules.
 *
 * That refusal is deliberate and worth keeping: a shop-floor appliance should
 * not carry the identity package's database gateways and governed refusal
 * vocabulary just to hash eight fields.
 *
 * So this is a copy — and a copy of security-critical canonical bytes is
 * exactly the thing that drifts silently and is discovered in the field. It is
 * kept honest by `test/enrollment-pop-drift.test.ts`, which builds the same
 * input through BOTH implementations and fails if a single byte differs. The
 * duplication is therefore checked by CI rather than by memory.
 *
 * If you change the field order, the separator, or the kind string here, that
 * test fails — which is the point.
 */
/** Domain separator. MUST equal `MANUFACTURING_ENROLLMENT_POP_KIND`. */
export const ENROLLMENT_POP_KIND = "kitluy.manufacturing-enrollment-pop.v1";
/** MUST equal `MANUFACTURING_ENROLLMENT_POP_PURPOSE`. */
export const ENROLLMENT_POP_PURPOSE = "manufacturing_enrollment_redemption";
/**
 * Field order is FIXED and must match the authoritative implementation exactly.
 * The kind leads, so a signature over these bytes cannot be replayed as a
 * signature over another record type.
 */
export function enrollmentPopChallengeBytes(challenge) {
    return Buffer.from([
        ENROLLMENT_POP_KIND,
        challenge.challengeId,
        challenge.purpose,
        challenge.environment,
        challenge.presentedKeyFingerprint,
        challenge.nonce,
        challenge.issuedAt.toISOString(),
        challenge.expiresAt.toISOString(),
    ].join("\n"), "utf8");
}
//# sourceMappingURL=enrollment-pop-bytes.js.map