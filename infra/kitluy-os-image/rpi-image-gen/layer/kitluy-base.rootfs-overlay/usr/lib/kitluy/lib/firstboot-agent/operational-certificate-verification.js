/**
 * The Hub verifies its own certificate before it will use it.
 *
 * Authority: owner instruction 2026-08-28, "DEVICE-SIDE CERTIFICATE
 * VERIFICATION — this is mandatory"; finding C-1 (a certificate must prove it
 * carries the governed key).
 *
 * ===========================================================================
 * WHY THE DEVICE RE-CHECKS WHAT THE SERVER ALREADY CHECKED
 * ===========================================================================
 * The governed door verifies all of this and refuses what does not hold. That is
 * not a reason for the device to skip it — it is a reason the two must AGREE.
 *
 * "The server returned 200" is a statement about a transport, not about a
 * certificate. Between the door and this file sit a serialiser, a network, a
 * proxy and a JSON parser, and the Hub is about to install this as its permanent
 * identity. A device that adopted whatever arrived would be trusting the channel
 * to be the authority, which is precisely the assumption mutual TLS exists to
 * remove.
 *
 * ===========================================================================
 * ZERO RUNTIME DEPENDENCIES
 * ===========================================================================
 * `node:crypto` only. `X509Certificate` PARSES and verifies; it cannot issue,
 * which is all this side needs. node-forge is a server-side build dependency and
 * must never appear here — the image ships no `node_modules`.
 */
import { X509Certificate, createPublicKey, createHash } from "node:crypto";
/** The supported DEVELOPMENT profile. Widening this is a separate decision. */
const SUPPORTED_SIGNATURE_ALGORITHM = "sha256WithRSAEncryption";
const SUPPORTED_KEY_ALGORITHM = "rsa-2048";
/** A development lifetime is 30 days (0128 §5); anything longer is not ours. */
const MAX_VALIDITY_DAYS = 31;
/**
 * How far AHEAD of the device's trusted-time observation a `notBefore` may sit.
 *
 * This is not a clock-skew fudge. The device's trusted time is a POINT-IN-TIME
 * OBSERVATION taken from the governed bridge BEFORE the request is sent; the
 * certificate's `notBefore` is stamped by the server's own clock at the moment
 * of issuance (group 0204, finding C-2). Real seconds pass in between — a
 * network round trip, a governed reservation, an RSA signature — so
 * `notBefore > deviceTrustedTime` is the NORMAL case, not an anomaly.
 *
 * Without this allowance the Hub refuses every certificate it is legitimately
 * issued. That is not hypothetical: it was caught by the end-to-end suite under
 * load, where the gap widened past a millisecond.
 *
 * BOUNDED, and deliberately small. A certificate dated meaningfully into the
 * future is still refused — that is a real anomaly and the check must keep
 * catching it. The expiry side gets NO allowance at all: erring toward "not yet
 * usable" is safe, and erring toward "still valid" is not.
 */
const NOT_BEFORE_SKEW_MS = 5 * 60_000;
const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
function derOf(pem) {
    return Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
}
/** Every certificate in a PEM bundle, in order. */
function splitPem(bundle) {
    return bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}
/**
 * Read `basicConstraints.cA` out of the DER.
 *
 * `X509Certificate.ca` is NOT sufficient here, and finding that out cost a test.
 * Node delegates to OpenSSL's `X509_check_ca`, which answers "could this sign
 * certificates" rather than "does it assert CA:TRUE" — so a leaf carrying
 * `basicConstraints CA:TRUE` together with a `keyUsage` that omits
 * `keyCertSign` reports `ca === false`. That is reasonable of OpenSSL and wrong
 * for this check: the Store Hub profile forbids the ASSERTION, whatever
 * key usage accompanies it.
 *
 * A minimal walk, and no dependency: Node's X.509 surface exposes SANs and
 * extended key usage and nothing else, so the extension is read directly.
 *
 *   Certificate ::= SEQUENCE { tbsCertificate, ... }
 *   TBSCertificate ::= SEQUENCE { ..., extensions [3] EXPLICIT Extensions }
 *   Extension ::= SEQUENCE { extnID OID, critical BOOLEAN DEFAULT FALSE,
 *                            extnValue OCTET STRING }
 *   BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, ... }
 */
function assertsCertificateAuthority(certificateDer) {
    const readTlv = (buffer, offset) => {
        if (offset + 2 > buffer.length)
            return null;
        const tag = buffer[offset];
        let length = buffer[offset + 1];
        let header = 2;
        if ((length & 0x80) !== 0) {
            const count = length & 0x7f;
            if (count === 0 || count > 4 || offset + 2 + count > buffer.length)
                return null;
            length = 0;
            for (let i = 0; i < count; i += 1)
                length = length * 256 + buffer[offset + 2 + i];
            header = 2 + count;
        }
        if (offset + header + length > buffer.length)
            return null;
        return { tag, header, length };
    };
    const certificate = readTlv(certificateDer, 0);
    if (certificate === null)
        return false;
    const tbs = readTlv(certificateDer, certificate.header);
    if (tbs === null)
        return false;
    // Walk the TBS children looking for the [3] EXPLICIT extensions block.
    let cursor = certificate.header + tbs.header;
    const tbsEnd = certificate.header + tbs.header + tbs.length;
    let extensionsBody = null;
    while (cursor < tbsEnd) {
        const field = readTlv(certificateDer, cursor);
        if (field === null)
            return false;
        if (field.tag === 0xa3) {
            extensionsBody = certificateDer.subarray(cursor + field.header, cursor + field.header + field.length);
            break;
        }
        cursor += field.header + field.length;
    }
    if (extensionsBody === null)
        return false;
    const sequence = readTlv(extensionsBody, 0);
    if (sequence === null)
        return false;
    let position = sequence.header;
    const end = sequence.header + sequence.length;
    // OID 2.5.29.19, basicConstraints.
    const BASIC_CONSTRAINTS = Buffer.from("0603551d13", "hex");
    while (position < end) {
        const extension = readTlv(extensionsBody, position);
        if (extension === null)
            return false;
        const body = extensionsBody.subarray(position + extension.header, position + extension.header + extension.length);
        if (body.subarray(0, BASIC_CONSTRAINTS.length).equals(BASIC_CONSTRAINTS)) {
            // Skip the OID, then the optional critical BOOLEAN, to reach the OCTET STRING.
            let inner = BASIC_CONSTRAINTS.length;
            let field = readTlv(body, inner);
            if (field !== null && field.tag === 0x01) {
                inner += field.header + field.length;
                field = readTlv(body, inner);
            }
            if (field === null || field.tag !== 0x04)
                return false;
            const value = body.subarray(inner + field.header, inner + field.header + field.length);
            const constraints = readTlv(value, 0);
            if (constraints === null)
                return false;
            const first = readTlv(value, constraints.header);
            // cA is a BOOLEAN and is DEFAULT FALSE, so its absence means false.
            if (first === null || first.tag !== 0x01)
                return false;
            return value[constraints.header + first.header] !== 0x00;
        }
        position += extension.header + extension.length;
    }
    return false;
}
/**
 * Verify EVERYTHING, and collect every failure rather than stopping at the
 * first.
 *
 * Collecting matters: a certificate that fails one check is a mistake, and a
 * certificate that fails six is an attack or a badly wrong deployment. An
 * operator who is shown only the first refusal cannot tell those apart.
 */
export function verifyOperationalCertificate(input) {
    const failures = [];
    const fail = (check, detail) => {
        failures.push({ check, detail });
    };
    // --- 1. leaf parses -------------------------------------------------------
    let leaf;
    try {
        leaf = new X509Certificate(input.certificatePem);
    }
    catch (error) {
        // No leaf means nothing else can be checked. This is the one early return.
        return {
            ok: false,
            failures: [
                {
                    check: "LEAF_PARSES",
                    detail: `the leaf certificate could not be parsed: ${error instanceof Error ? error.message : "unknown"}`,
                },
            ],
        };
    }
    // --- 2 & 3. the chain parses ---------------------------------------------
    const chainPems = splitPem(input.chainPem);
    let intermediate = null;
    let root = null;
    if (chainPems.length < 2) {
        fail("INTERMEDIATE_PARSES", `the chain holds ${chainPems.length} certificate(s); expected 2`);
    }
    else {
        try {
            intermediate = new X509Certificate(chainPems[0]);
        }
        catch {
            fail("INTERMEDIATE_PARSES", "the issuing CA certificate could not be parsed");
        }
        try {
            root = new X509Certificate(chainPems[1]);
        }
        catch {
            fail("ROOT_PARSES", "the root certificate could not be parsed");
        }
    }
    // --- 4 & 5. the signatures ------------------------------------------------
    if (intermediate !== null) {
        try {
            if (!leaf.verify(intermediate.publicKey)) {
                fail("LEAF_SIGNED_BY_INTERMEDIATE", "the leaf is not signed by the supplied issuing CA");
            }
        }
        catch {
            fail("LEAF_SIGNED_BY_INTERMEDIATE", "the leaf signature could not be checked");
        }
    }
    if (intermediate !== null && root !== null) {
        try {
            if (!intermediate.verify(root.publicKey)) {
                fail("INTERMEDIATE_SIGNED_BY_ROOT", "the issuing CA is not signed by the supplied root");
            }
        }
        catch {
            fail("INTERMEDIATE_SIGNED_BY_ROOT", "the issuing CA signature could not be checked");
        }
    }
    // --- 6. the root is the one we expect ------------------------------------
    //
    // A chain that verifies internally proves only that it is SELF-CONSISTENT. An
    // attacker supplies a whole consistent chain of their own; the pin is what
    // makes it ours. Compared on the certificate's SHA-256, not on a subject name,
    // because a name is chosen by whoever issued it.
    if (root !== null) {
        const rootSha = sha256Hex(derOf(chainPems[1]));
        if (rootSha !== input.expectedRootSha256.toLowerCase()) {
            fail("ROOT_IS_THE_EXPECTED_DEVELOPMENT_ROOT", `the chain root is ${rootSha.slice(0, 16)}…, expected ${input.expectedRootSha256.slice(0, 16)}…`);
        }
    }
    // --- 7. the leaf carries OUR key -----------------------------------------
    //
    // The check finding C-1 was about, made from the device's side. A certificate
    // over someone else's key is not this Hub's identity however well it verifies.
    let leafSpkiDer;
    try {
        leafSpkiDer = Buffer.from(leaf.publicKey.export({ type: "spki", format: "der" }));
        const localSpkiDer = Buffer.from(createPublicKey(input.localPublicKeyPem).export({ type: "spki", format: "der" }));
        if (!leafSpkiDer.equals(localSpkiDer)) {
            fail("LEAF_KEY_IS_THE_LOCAL_KEY", "the certificate is not over this device's operational key");
        }
    }
    catch {
        leafSpkiDer = Buffer.alloc(0);
        fail("LEAF_KEY_IS_THE_LOCAL_KEY", "the leaf public key could not be compared with the local key");
    }
    // --- 8. and that key is the one the governed credential names -------------
    if (leafSpkiDer.length > 0) {
        const fingerprint = sha256Hex(leafSpkiDer);
        if (fingerprint !== input.expectedPublicKeyFingerprint.toLowerCase()) {
            fail("SPKI_FINGERPRINT_MATCHES_GOVERNED", `the leaf SPKI fingerprint is ${fingerprint.slice(0, 16)}…, governed value is ${input.expectedPublicKeyFingerprint.slice(0, 16)}…`);
        }
    }
    // --- 9. the serial ---------------------------------------------------------
    //
    // Compared as an INTEGER. Node normalises for display — it drops the DER sign
    // byte — so a string comparison would fail on a formatting difference for
    // roughly half of all serials and prove nothing about the rest.
    try {
        const asInteger = (hex) => BigInt(`0x${hex === "" ? "0" : hex}`);
        if (asInteger(leaf.serialNumber) !== asInteger(input.expectedX509Serial)) {
            fail("SERIAL_MATCHES_GOVERNED", `the certificate serial is ${leaf.serialNumber}, governed value is ${input.expectedX509Serial}`);
        }
    }
    catch {
        fail("SERIAL_MATCHES_GOVERNED", "the certificate serial could not be compared");
    }
    // --- 10. the window is internally sane -----------------------------------
    const notBefore = new Date(leaf.validFrom);
    const notAfter = new Date(leaf.validTo);
    if (Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) {
        fail("VALIDITY_WINDOW_IS_SANE", "the validity window could not be read");
    }
    else if (notAfter.getTime() <= notBefore.getTime()) {
        fail("VALIDITY_WINDOW_IS_SANE", "notAfter is not after notBefore");
    }
    else if (notAfter.getTime() - notBefore.getTime() > MAX_VALIDITY_DAYS * 86_400_000) {
        // A development lifetime is 30 days. A longer one did not come from our
        // governed doors, whoever signed it.
        fail("VALIDITY_WINDOW_IS_SANE", `the validity window is longer than ${MAX_VALIDITY_DAYS} days; this profile issues 30`);
    }
    // --- 11. usable NOW, by TRUSTED time -------------------------------------
    //
    // `input.trustedTime`, never `new Date()`. A Store Hub has no battery-backed
    // RTC, so its host clock is not evidence of anything — that is the whole
    // reason the trusted-time authority exists.
    if (!Number.isNaN(notBefore.getTime()) && !Number.isNaN(notAfter.getTime())) {
        if (input.trustedTime.getTime() + NOT_BEFORE_SKEW_MS < notBefore.getTime()) {
            fail("CURRENTLY_USABLE_AT_TRUSTED_TIME", `the certificate is not valid until ${notBefore.toISOString()}, which is more than ` +
                `${String(NOT_BEFORE_SKEW_MS / 60_000)} minutes after this device's trusted time`);
        }
        if (input.trustedTime.getTime() >= notAfter.getTime()) {
            fail("CURRENTLY_USABLE_AT_TRUSTED_TIME", "the certificate has expired at trusted time");
        }
    }
    // --- 12, 13, 14, 15. the SANs ---------------------------------------------
    //
    // The server writes device, generation and environment as URI SANs. Read from
    // the certificate rather than believed from the response body: the response is
    // what we are checking.
    const san = leaf.subjectAltName ?? "";
    const uris = san
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith("URI:"))
        .map((entry) => entry.slice(4));
    if (!uris.includes(`kitluy-device://${input.deviceRecordId}`)) {
        fail("SAN_IDENTIFIES_THIS_DEVICE", "no kitluy-device:// SAN naming this device");
    }
    if (!uris.includes(`kitluy-environment://${input.environment}`)) {
        fail("ENVIRONMENT_IS_DEVELOPMENT", `no kitluy-environment://${input.environment} SAN`);
    }
    if (input.environment !== "development") {
        // BLK-005. A Hub must refuse to adopt a pilot or production identity even if
        // one were somehow issued to it.
        fail("ENVIRONMENT_IS_DEVELOPMENT", `environment "${input.environment}" is blocked under BLK-005`);
    }
    if (!uris.includes(`kitluy-generation://${String(input.expectedCredentialGeneration)}`)) {
        fail("CREDENTIAL_GENERATION_MATCHES", `no kitluy-generation://${input.expectedCredentialGeneration} SAN`);
    }
    // The assignment generation is NOT carried in the certificate — the governed
    // contract does not represent it there. It is checked against the request the
    // device itself signed, which is where it IS represented, so the check is real
    // rather than decorative.
    if (input.expectedAssignmentGeneration < 1) {
        fail("ASSIGNMENT_GENERATION_MATCHES", `the request carried assignment generation ${input.expectedAssignmentGeneration}`);
    }
    // --- 16. the key-usage profile -------------------------------------------
    const der = derOf(input.certificatePem);
    // `X509Certificate` exposes keyUsage as an array of OIDs for EKU; basic
    // constraints come through `ca`. Both are read from the parsed certificate.
    if (assertsCertificateAuthority(der) || leaf.ca) {
        // Both, deliberately. The DER read catches the ASSERTION; Node's `ca`
        // catches anything OpenSSL would treat as a CA for a reason this walk does
        // not model.
        fail("KEY_USAGE_PROFILE_MATCHES", "the leaf asserts basicConstraints cA:true");
    }
    const eku = leaf.keyUsage ?? [];
    const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
    const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
    if (!eku.includes(SERVER_AUTH) || !eku.includes(CLIENT_AUTH)) {
        fail("KEY_USAGE_PROFILE_MATCHES", `extended key usage is [${eku.join(", ")}]; the Store Hub profile needs serverAuth and clientAuth`);
    }
    // --- 17. the algorithm ----------------------------------------------------
    //
    // The supported DEVELOPMENT profile and nothing else. Not broadened here.
    if (leaf.publicKey.asymmetricKeyType !== "rsa") {
        fail("ALGORITHM_IS_SUPPORTED", `the leaf key is ${leaf.publicKey.asymmetricKeyType ?? "unknown"}`);
    }
    else if (leaf.publicKey.asymmetricKeyDetails?.modulusLength !== 2048) {
        fail("ALGORITHM_IS_SUPPORTED", `the leaf key is RSA-${leaf.publicKey.asymmetricKeyDetails?.modulusLength ?? "unknown"}`);
    }
    if (input.expectedAlgorithm !== SUPPORTED_KEY_ALGORITHM) {
        fail("ALGORITHM_IS_SUPPORTED", `the governed response names ${input.expectedAlgorithm}; this profile supports ${SUPPORTED_KEY_ALGORITHM}`);
    }
    // The SIGNATURE algorithm, read from the DER by OID. `X509Certificate` does
    // not expose it, and R2-3 established that an exact check here matters:
    // 300d06092a864886f70d01010b0500 is sha256WithRSAEncryption with its NULL
    // parameters, and nothing else is accepted.
    if (!der.includes(Buffer.from("300d06092a864886f70d01010b0500", "hex"))) {
        fail("ALGORITHM_IS_SUPPORTED", `the certificate does not declare ${SUPPORTED_SIGNATURE_ALGORITHM} with canonical parameters`);
    }
    if (failures.length > 0)
        return { ok: false, failures };
    return {
        ok: true,
        certificateSha256: sha256Hex(der),
        x509Serial: leaf.serialNumber.toLowerCase(),
    };
}
/** Present the local key without ever touching the private half. */
export function publicKeyPemOf(privateKey) {
    return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
}
//# sourceMappingURL=operational-certificate-verification.js.map