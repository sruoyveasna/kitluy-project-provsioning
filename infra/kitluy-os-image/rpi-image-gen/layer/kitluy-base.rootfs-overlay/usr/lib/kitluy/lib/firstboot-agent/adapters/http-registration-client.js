/**
 * The device-side transport for the cloud registration intake.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §3.1;
 *   contract `docs/api/device-registration-edge-function-v1.md`.
 *
 * ===========================================================================
 * WHY THIS IS A SIBLING OF http-enrollment-client.ts, NOT A BRANCH INSIDE IT
 * ===========================================================================
 * Plan §3.1 names `http-enrollment-client.ts` as the file to update. It is kept
 * separate deliberately, and the deviation is recorded in the handoff rather
 * than taken silently.
 *
 * The two speak different contracts to different services under different
 * authorities: factory enrolment answers a SERVER-MINTED CHALLENGE at
 * `/v1/device-enrollment/*` on the fleet service (DEC-2), while registration
 * signs its OWN CONTENT at `/functions/v1/device-registration` on Supabase
 * (§2.2). They also mean opposite things — enrolment can produce `enrolled`,
 * registration cannot produce it under any input. Folding both into one module
 * would put two authorities and two proof shapes behind one exported name, and
 * the file header could no longer state which contract it implements.
 *
 * ===========================================================================
 * WHAT LEAVES THE DEVICE, AND WHAT NEVER DOES
 * ===========================================================================
 * Leaves: the PUBLIC key and its fingerprint, board evidence, installation
 * evidence, the hostname, and a detached signature.
 *
 * Never leaves: the private key. Signing happens inside the key provider, which
 * returns a signature and has no path that returns a key. No ticket, no secret
 * and no credential is transmitted — registration has none to send, which is the
 * property that lets a generic clonable image use this route at all.
 *
 * ===========================================================================
 * THE THREE ANSWERS THAT ARE NOT ERRORS
 * ===========================================================================
 * `PENDING_APPROVAL`, `KNOWN_DEVICE_INSTALLATION_REGISTERED` and
 * `TRUST_REVIEW_REQUIRED` are all successful outcomes of a well-formed request
 * (contract §9). A client that treated the first as a failure would retry
 * forever against a device the fleet is deliberately holding; one that treated
 * the third as a crash would hide the single case a human is waiting to see.
 */
import { createHash, createPublicKey } from "node:crypto";
import { DEVICE_REGISTRATION_REQUEST_KIND, deviceRegistrationRequestBytes, validateDeviceRegistrationRequest, } from "../device-registration-bytes.js";
import { assetTagFromFingerprint } from "../registration-state.js";
/**
 * DEVICE VOCABULARY → THE GOVERNED ENUM.
 *
 * Identical discipline to `http-enrollment-client.ts`: `HardwareSignals` is
 * camelCase because it is a TypeScript interface, `kitluy_devices.
 * hardware_signal_type` is snake_case because it is a PostgreSQL enum. Sending
 * interface key names is what made every real device fail at redemption once
 * already.
 *
 * BOARD SIGNALS ONLY. Storage is absent on purpose: plan §1.4 excludes storage
 * from board resolution entirely, because a card moved to another board must
 * make a NEW device rather than carry the old identity across. Storage evidence
 * still travels — as `installationEvidence`, where it describes the install
 * instead of the board.
 */
const CANONICAL_BOARD_SIGNAL = {
    macAddress: "mac_address",
    boardSerial: "board_serial",
    socSerial: "soc_serial",
};
/** Storage signals are installation evidence, never board evidence. */
const INSTALLATION_EVIDENCE_SIGNAL = {
    storageSerial: "storageSerial",
    storageModel: "storageModel",
};
/** SHA-256 of the SPKI DER, matching what the server records. */
export function fingerprintFromPem(publicKeyPem) {
    const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
    return createHash("sha256").update(new Uint8Array(der)).digest("hex");
}
/**
 * `lower(btrim(value))`, applied on the device so the bytes signed and the bytes
 * stored are one form. The server refuses anything else (§4 field rules), so
 * normalising here is what stops a legitimate board being rejected for the
 * capitalisation of its own serial number.
 */
const normalise = (value) => value.trim().toLowerCase();
function refused(code, retryable) {
    return { kind: "refused", code, retryable };
}
/**
 * Retryable when the fault is plausibly transient.
 *
 * A 4xx from this route is a DECISION about the request's content — a bad
 * signature, an unknown profile, an unnormalised signal — and retrying it
 * unchanged just repeats the same refusal against the fleet. 408/429/5xx are the
 * transport and the server having a bad moment, which a later boot may not.
 */
function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
export function createHttpRegistrationClient(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    return {
        async register(input) {
            let fingerprint;
            try {
                fingerprint = fingerprintFromPem(input.publicKeyPem);
            }
            catch {
                return refused("REGISTRATION_KEY_UNREADABLE", false);
            }
            // --- Board evidence -------------------------------------------------
            // A signal with no canonical name is DROPPED rather than sent: an
            // unrepresentable name would refuse the whole registration, while a
            // missing one leaves the hardware profile's `required_signal_types` to
            // decide — which puts sufficiency in the database, where it belongs.
            const signals = [];
            for (const [key, canonical] of Object.entries(CANONICAL_BOARD_SIGNAL)) {
                const value = input.hardwareSignals[key];
                if (typeof value === "string" && value.trim().length > 0 && canonical !== undefined) {
                    signals.push({ signalType: canonical, signalValue: normalise(value) });
                }
            }
            // --- Installation evidence -------------------------------------------
            const installationEvidence = {
                installationId: input.installationId,
                ...(input.installationEvidence ?? {}),
            };
            for (const [key, evidenceKey] of Object.entries(INSTALLATION_EVIDENCE_SIGNAL)) {
                const value = input.hardwareSignals[key];
                if (typeof value === "string" && value.trim().length > 0 && evidenceKey !== undefined) {
                    installationEvidence[evidenceKey] = normalise(value);
                }
            }
            const fields = {
                // Derived from the key, not from hardware. The contract is explicit that
                // an asset tag is a LABEL and not an identity, and the server will not
                // rename a board it already knows under a different tag.
                assetTag: assetTagFromFingerprint(fingerprint),
                hardwareProfileKey: options.hardwareProfileKey,
                hostname: normalise(input.hostname),
                registrationPublicKeyFingerprint: fingerprint,
                signals,
                installationEvidence,
            };
            const rejection = validateDeviceRegistrationRequest(fields);
            if (rejection !== null) {
                // Not retryable: the request is malformed in a way another attempt with
                // the same inputs cannot fix. Reported with the specific rejection so the
                // console can say which field, rather than "the cloud said no".
                return refused(rejection, false);
            }
            let signature;
            try {
                signature = await options.signer.signPayload(options.privateKeyHandle, deviceRegistrationRequestBytes(fields));
            }
            catch {
                // The key is unusable. Re-keying is firstboot's job, not this
                // transport's, so there is nothing a retry here could achieve.
                return refused("REGISTRATION_SIGNING_FAILED", false);
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let status;
            let json;
            try {
                const response = await doFetch(options.registrationUrl, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        kind: DEVICE_REGISTRATION_REQUEST_KIND,
                        ...fields,
                        registrationPublicKeyPem: input.publicKeyPem,
                        signature: Buffer.from(signature).toString("base64"),
                    }),
                    signal: controller.signal,
                });
                status = response.status;
                try {
                    json = await response.json();
                }
                catch {
                    json = undefined;
                }
            }
            catch {
                // A Store network still coming up, or no network at all. Retryable by
                // definition — and the console renders this as NO CONNECTION rather than
                // as a refusal, because the fleet has said nothing about this device.
                clearTimeout(timer);
                return refused("REGISTRATION_UNREACHABLE", true);
            }
            finally {
                clearTimeout(timer);
            }
            if (status !== 200) {
                const code = typeof json?.code === "string"
                    ? json.code
                    : `REGISTRATION_${status}`;
                return refused(code, isRetryableStatus(status));
            }
            const body = json;
            switch (body?.status) {
                case "PENDING_APPROVAL":
                case "KNOWN_DEVICE_INSTALLATION_REGISTERED": {
                    if (typeof body.deviceId !== "string" || typeof body.installationId !== "string") {
                        return refused("REGISTRATION_MALFORMED_RESPONSE", false);
                    }
                    return {
                        kind: body.status === "PENDING_APPROVAL" ? "pending" : "known",
                        deviceId: body.deviceId,
                        installationId: body.installationId,
                        installationCreated: body.installationCreated === true,
                    };
                }
                case "TRUST_REVIEW_REQUIRED":
                    return {
                        kind: "trust_review",
                        // Null is a legitimate value here: ambiguous evidence means the
                        // server could not decide WHICH board this is, so there is no id to
                        // return. The contract states it explicitly (§9).
                        deviceId: typeof body.deviceId === "string" ? body.deviceId : null,
                        conflictReason: typeof body.conflictReason === "string" ? body.conflictReason : "UNSPECIFIED",
                    };
                default:
                    // A 200 whose status the device does not recognise. Not retryable:
                    // this is a contract mismatch between image and cloud, and repeating
                    // it cannot resolve it. A newer cloud status reaching an older image
                    // must be visible, not silently treated as pending.
                    return refused("REGISTRATION_UNKNOWN_STATUS", false);
            }
        },
    };
}
//# sourceMappingURL=http-registration-client.js.map