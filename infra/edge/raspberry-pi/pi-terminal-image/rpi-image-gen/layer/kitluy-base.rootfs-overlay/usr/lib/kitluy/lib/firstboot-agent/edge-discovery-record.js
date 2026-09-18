/**
 * The Store Hub's signed discovery record, as the Pi Terminal reads it.
 *
 * AGENT-LOCAL BY THE SAME RULE AS `device-registration-bytes.ts` AND
 * `hub-claim-bytes.ts`: this agent ships with no runtime dependencies, so the
 * canonical constants and byte layout live here and a DRIFT TEST asserts they
 * still equal `@kitluy/device-identity`'s. If the package moves, the test
 * fails; the two never diverge silently.
 *
 * WHAT THIS VERIFIES, AND WHAT IT DOES NOT.
 *
 * The record is signed with the Hub's Ed25519 DEVICE IDENTITY key
 * (`/var/lib/kitluy/identity/device-identity.key.pem` on the Hub). Verifying
 * that signature needs the Hub's operational PUBLIC key, which the cloud
 * delivers to a terminal — and that delivery is part of the same BLK-006
 * producer that has not been built. The well-known payload carries the record
 * and the signature but NOT the key, so a terminal cannot bootstrap it from the
 * response either.
 *
 * So `checkRecord` below verifies everything that does NOT need that key:
 * protocol version, scope, environment, port, validity window, and — the
 * load-bearing one — that `hubCertificateFingerprint` is the certificate the
 * connection actually presented. That last check is what binds the record to
 * this Hub rather than a replayed copy of someone else's.
 *
 * The signature is reported as `unverified` and NEVER as verified. A terminal
 * that cannot check a signature says so; it does not quietly treat absence of
 * a key as a pass.
 */
/** Domain separator. Distinct from every pairing/PoP/activation domain. */
export const EDGE_DISCOVERY_KIND = "kitluy.edge-discovery.v1";
/** The one service type a KitLuy Store Hub advertises (owner package §4). */
export const EDGE_DISCOVERY_SERVICE_TYPE = "_kitluy-edge._tcp.local";
/** The one LAN port a KitLuy Store Hub serves (owner package §3). */
export const EDGE_LAN_PORT = 7443;
/** Locked timing (owner package §4). */
export const EDGE_DISCOVERY_VALIDITY_SECONDS = 90;
/**
 * Clock-skew tolerance on `issuedAt` — the device copy of
 * `@kitluy/device-identity` `EDGE_DISCOVERY_CLOCK_SKEW_SECONDS` (the drift test
 * holds them equal). Two NTP-synchronized boards differ by milliseconds; the
 * Hub mints the record on demand with its own clock, so without this a record
 * minted for the request itself was refused as "in the future" (hardware,
 * 2026-09-17). Bounded by the Hub's refresh interval; expiry stays strict.
 */
export const EDGE_DISCOVERY_CLOCK_SKEW_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
export function isSignedDiscoveryPayload(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const record = value.record;
    if (typeof record !== "object" || record === null)
        return false;
    const r = record;
    const strings = [
        "protocolVersion",
        "recordId",
        "hubDeviceId",
        "hubCertificateFingerprint",
        "tenantId",
        "digitalStoreId",
        "storeLocationId",
        "environment",
        "hostname",
        "issuedAt",
        "expiresAt",
    ];
    for (const field of strings)
        if (typeof r[field] !== "string")
            return false;
    if (typeof r.port !== "number")
        return false;
    return typeof value.signature === "string";
}
/**
 * Judge a record against what this terminal knows about its own Store, the
 * environment its image declares, and the certificate it is looking at.
 */
export function checkRecord(payload, expectation, now) {
    const scopeChecked = expectation.tenantId !== undefined &&
        expectation.digitalStoreId !== undefined &&
        expectation.storeLocationId !== undefined;
    const refuse = (refusalCode, detail) => ({
        accepted: false,
        refusalCode,
        detail,
        signature: "unverified",
        scopeChecked,
    });
    const r = payload.record;
    if (!UUID.test(r.hubDeviceId) || !HEX64.test(r.hubCertificateFingerprint)) {
        return refuse("DISCOVERY_MALFORMED", "the record's identifiers are not well formed");
    }
    if (r.protocolVersion !== EDGE_DISCOVERY_KIND) {
        return refuse("DISCOVERY_WRONG_VERSION", `protocolVersion is '${r.protocolVersion}'`);
    }
    if (scopeChecked &&
        (r.tenantId !== expectation.tenantId ||
            r.digitalStoreId !== expectation.digitalStoreId ||
            r.storeLocationId !== expectation.storeLocationId)) {
        return refuse("DISCOVERY_WRONG_SCOPE", "the Hub serves a different Store than this terminal");
    }
    if (r.environment !== expectation.environment) {
        return refuse("DISCOVERY_WRONG_ENVIRONMENT", `the Hub is '${r.environment}', this terminal is '${expectation.environment}'`);
    }
    if (r.port !== EDGE_LAN_PORT) {
        return refuse("DISCOVERY_WRONG_PORT", `the record names port ${String(r.port)}`);
    }
    const issuedAt = Date.parse(r.issuedAt);
    const expiresAt = Date.parse(r.expiresAt);
    if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) {
        return refuse("DISCOVERY_MALFORMED", "the validity window is not a pair of timestamps");
    }
    if (now.getTime() + EDGE_DISCOVERY_CLOCK_SKEW_SECONDS * 1000 < issuedAt)
        return refuse("DISCOVERY_NOT_YET_VALID", "issuedAt is in the future");
    if (now.getTime() >= expiresAt)
        return refuse("DISCOVERY_EXPIRED", "the record has expired");
    // THE ANCHOR. Everything above judges what the record SAYS; this judges what
    // the connection IS. A replayed record from another Hub fails here.
    if (r.hubCertificateFingerprint.toLowerCase() !==
        expectation.observedCertificateFingerprint.toLowerCase()) {
        return refuse("DISCOVERY_CERTIFICATE_MISMATCH", "the record names a certificate this connection did not present");
    }
    return { accepted: true, signature: "unverified", scopeChecked };
}
//# sourceMappingURL=edge-discovery-record.js.map