/**
 * Hub-local terminal pairing, from the terminal's side.
 *
 * A terminal that the Hub RECOGNISES is still not one it will serve. The
 * runtime eligibility door answers `PAIRING_REQUIRED` until the terminal has
 * completed a pairing handshake with THIS Hub — a separate fact from the cloud
 * assignment, and deliberately so: the cloud says which Store a terminal
 * belongs to, and the Hub records that this particular board, holding this
 * particular key, presented itself here.
 *
 * The handshake is three calls:
 *
 *   POST .../terminal-pairing/sessions          -> 201, a challenge
 *   POST .../sessions/{id}/terminal-proof       -> the terminal signs
 *   POST .../sessions/{id}/complete             -> the Hub signs back
 *
 * THE TERMINAL DOES NOT CANONICALISE ANYTHING. The Hub returns `signingPayload`,
 * base64url of the exact bytes to sign, and this signs those bytes verbatim.
 * That is the P04A1 discipline the route records, and it is why there is no
 * second copy of the transcript layout here to drift from the first.
 *
 * The signing key is the Ed25519 DEVICE IDENTITY key that
 * `kitluy-firstboot.service` created — not the RSA operational key that carries
 * the TLS session. Two keys, two jobs: one proves the device, one carries the
 * transport.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";
export const DEVICE_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
export const PAIRING_SESSIONS_PATH = "/edge/v1/terminal-pairing/sessions";
/** Locked by the Edge Ops contract; the Hub validates the shape. */
export const PAIRING_PROTOCOL_VERSION = "1.0";
function isChallenge(value) {
    const session = value?.session;
    return (typeof session === "object" &&
        session !== null &&
        typeof session.pairingSessionId === "string" &&
        typeof session.signingPayload === "string");
}
function resultOf(body, fallback) {
    const envelope = body;
    return envelope?.result ?? envelope?.error?.details?.result ?? envelope?.error?.code ?? fallback;
}
/** Sign the Hub's opaque payload with the device identity key. */
export function signPairingPayload(signingPayloadBase64Url, keyPath = DEVICE_IDENTITY_KEY_PATH) {
    const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
    const payload = Buffer.from(signingPayloadBase64Url, "base64url");
    // Ed25519: one-shot, no digest argument. `sign(null, …)` is the ed25519 form.
    const signature = cryptoSign(null, payload, privateKey).toString("base64url");
    const publicKeyPem = createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString();
    return { signature, publicKeyPem };
}
/**
 * Run the handshake. Never throws: every refusal is a result the caller reports.
 */
export async function pairWithHub(input) {
    const { call, base } = input;
    let opened;
    try {
        opened = await call({
            ...base,
            method: "POST",
            path: PAIRING_SESSIONS_PATH,
            body: {
                requestedProfileCode: input.requestedProfileCode,
                terminalNonce: input.nonceHex,
                protocolVersion: PAIRING_PROTOCOL_VERSION,
                environment: base.environment,
            },
        });
    }
    catch (error) {
        return {
            paired: false,
            result: "TRANSPORT_FAILED",
            detail: error instanceof Error ? error.message : "unknown",
        };
    }
    if (opened.status !== 201 || !isChallenge(opened.body)) {
        return {
            paired: false,
            result: resultOf(opened.body, `HTTP_${String(opened.status)}`),
            detail: `the Hub did not open a pairing session (HTTP ${String(opened.status)})`,
        };
    }
    const session = opened.body.session;
    let signed;
    try {
        signed = signPairingPayload(session.signingPayload, input.keyPath);
    }
    catch (error) {
        return {
            paired: false,
            result: "IDENTITY_KEY_UNAVAILABLE",
            detail: `cannot sign with the device identity key (${error instanceof Error ? error.message : "unknown"})`,
        };
    }
    const proof = await call({
        ...base,
        method: "POST",
        path: `${PAIRING_SESSIONS_PATH}/${session.pairingSessionId}/terminal-proof`,
        body: { signature: signed.signature, terminalPublicKeyPem: signed.publicKeyPem },
    }).catch((error) => ({
        status: 0,
        body: { error: { code: error instanceof Error ? error.message : "unknown" } },
        peerCertificateFingerprint: "",
        peerDeviceId: null,
    }));
    if (proof.status !== 200) {
        return {
            paired: false,
            result: resultOf(proof.body, `HTTP_${String(proof.status)}`),
            detail: "the Hub refused the terminal proof",
        };
    }
    const completed = await call({
        ...base,
        method: "POST",
        path: `${PAIRING_SESSIONS_PATH}/${session.pairingSessionId}/complete`,
        body: {},
    }).catch((error) => ({
        status: 0,
        body: { error: { code: error instanceof Error ? error.message : "unknown" } },
        peerCertificateFingerprint: "",
        peerDeviceId: null,
    }));
    const result = resultOf(completed.body, `HTTP_${String(completed.status)}`);
    if (completed.status !== 200 || (result !== "PAIRED" && result !== "ALREADY_PAIRED")) {
        return { paired: false, result, detail: "the Hub did not complete the pairing" };
    }
    const pairing = completed.body?.pairing;
    return {
        paired: true,
        profileCode: session.terminalProfileKey ?? input.requestedProfileCode,
        ...(typeof pairing?.receiptId === "string" ? { receiptId: pairing.receiptId } : {}),
    };
}
//# sourceMappingURL=edge-pairing.js.map