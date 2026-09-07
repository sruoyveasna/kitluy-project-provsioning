/** The route, appended to the registry origin. Mirrors TERMINAL_PAIRING_PREFIX. */
export const TERMINAL_PAIRING_PATH = "/v1/terminal-pairing";
/**
 * Crockford Base32, length 8 — spelled out rather than expressed as ranges.
 *
 * The same literal appears in `bin/hub-pairing-ui.ts`, in the Device Shell's
 * `code-entry.ts`, and in the database as
 * `kitluy_devices.hub_claim_code_alphabet_v1()` (migration 0191, reused by the
 * terminal sessions of 0213). I, L, O and U are absent by construction. Written
 * out because a range like `A-HJ-KM-NP-TV-Z` says the same thing while hiding
 * which four letters are missing, and getting that wrong here would refuse a
 * code the portal legitimately issued.
 */
const CROCKFORD_CODE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
/**
 * What the screen should become after this answer.
 *
 * The mapping lives here, beside the vocabulary it translates, so the console
 * and the graphical shell cannot disagree about what `LOCKED` means. Anything
 * unrecognised becomes `AWAITING_CODE`: a newer registry answering with a code
 * this image has never heard of should leave the operator able to try again,
 * not stranded on a screen with no action.
 */
export function phaseForRefusal(result) {
    switch (result) {
        case "LOCKED":
            return "LOCKED";
        case "ALREADY_ASSIGNED":
            return "ALREADY_ASSIGNED";
        default:
            return "AWAITING_CODE";
    }
}
function refused(result, retryable, message) {
    return { kind: "refused", result, retryable, message };
}
/** 5xx and 429 are worth repeating; a 4xx answer about this code is not. */
function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}
function readString(source, key) {
    const value = source?.[key];
    return typeof value === "string" ? value : null;
}
export function createHttpTerminalPairingClient(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const url = `${options.registryBaseUrl.replace(/\/+$/, "")}${TERMINAL_PAIRING_PATH}`;
    return {
        async pair(input) {
            // Shape is checked here as well as on the server. Not as a security
            // measure — the server's check is the one that counts — but so a stray
            // keystroke costs a screen refresh instead of one of the attempt budget
            // the server locks the session on.
            if (!CROCKFORD_CODE.test(input.code)) {
                return refused("CODE_MALFORMED", true, "that is not a complete pairing code");
            }
            if (input.deviceRecordId.trim() === "") {
                return refused("NO_DEVICE_RECORD", false, "this board has not registered yet");
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let status;
            let json;
            try {
                const response = await doFetch(url, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        ...(options.correlationId === undefined
                            ? {}
                            : { "x-correlation-id": options.correlationId }),
                    },
                    body: JSON.stringify({ deviceRecordId: input.deviceRecordId, code: input.code }),
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
                // No network, or a Store LAN still coming up. Retryable by definition:
                // the registry has said nothing about this code, so the session is
                // untouched and the same code is still worth presenting.
                return refused("PAIRING_UNREACHABLE", true, "no connection to KitLuy");
            }
            finally {
                clearTimeout(timer);
            }
            if (status !== 200) {
                const error = json?.error;
                const details = error?.["details"];
                const result = readString(details, "result") ?? `PAIRING_${status}`;
                const retryable = typeof details?.["retryable"] === "boolean"
                    ? details["retryable"]
                    : isRetryableStatus(status);
                return refused(result, retryable, readString(error, "message") ?? "the pairing could not be completed");
            }
            const body = json;
            const deviceRecordId = readString(body, "deviceRecordId");
            const sessionId = readString(body, "sessionId");
            const assignmentId = readString(body, "assignmentId");
            const context = body?.["context"];
            // A 200 that does not carry the assignment is a contract mismatch, not a
            // pairing. Recording it as success would leave a board claiming a Store it
            // was never given, which is the one lie this whole chain exists to prevent.
            if (deviceRecordId === null ||
                sessionId === null ||
                assignmentId === null ||
                context === null ||
                typeof context !== "object") {
                return refused("PAIRING_MALFORMED_RESPONSE", false, "the pairing answer was incomplete");
            }
            // The server told us which board it paired. If that is not this board, the
            // answer belongs to something else and must not be stored as ours.
            if (deviceRecordId !== input.deviceRecordId) {
                return refused("PAIRING_DEVICE_MISMATCH", false, "the pairing answer named another device");
            }
            const generation = body?.["assignmentGeneration"];
            return {
                kind: "paired",
                deviceRecordId,
                sessionId,
                assignmentId,
                assignmentGeneration: typeof generation === "number" ? generation : 0,
                activated: body?.["activated"] === true,
                context: context,
                detail: readString(body, "detail") ?? "the Pi Terminal is assigned to its seat",
            };
        },
    };
}
//# sourceMappingURL=http-terminal-pairing-client.js.map