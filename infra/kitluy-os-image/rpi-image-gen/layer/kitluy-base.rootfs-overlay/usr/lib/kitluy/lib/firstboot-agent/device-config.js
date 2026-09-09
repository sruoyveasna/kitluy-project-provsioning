/**
 * The Terminal's device-configuration verbs, and the refusals that bound them.
 *
 * ===========================================================================
 * WHY A BROKER EXISTS AT ALL
 * ===========================================================================
 * `kitluy-device-shell.service` runs the Settings GUI as `kitluy-terminal` with
 * `CapabilityBoundingSet=` (empty), `NoNewPrivileges=yes`, `ProtectSystem=strict`
 * and exactly one writable path. It therefore CANNOT join a Wi-Fi network or set
 * the backlight, and that hardening is not negotiable — a kiosk that renders
 * whatever the cloud sends it must not also be the process that can reconfigure
 * the machine.
 *
 * So the privileged verbs live in a root service and the GUI is a CLIENT of it.
 * This module is that service's whole decision surface: what may be asked, what
 * the answer looks like, and what is refused. `bin/device-config-broker.ts` adds
 * only a socket.
 *
 * ===========================================================================
 * A CLOSED VERB LIST, NOT A COMMAND CHANNEL
 * ===========================================================================
 * `network-ui.ts` states the rule this follows: an installer "must not be dropped
 * into a general Linux administration surface… This screen offers two verbs and
 * no way out of them." The same applies with more force here, because the caller
 * is a browser engine. There is no `exec`, no path argument, no interface name
 * from the client, and no verb that composes into one. An unrecognised verb is
 * refused by name — never attempted.
 *
 * ===========================================================================
 * THE PASSPHRASE
 * ===========================================================================
 * A Wi-Fi PSK crosses this boundary. It is never logged, never echoed in a
 * response, and never included in a refusal message. `joinNetwork` already
 * delivers it to `wpa_passphrase` over stdin rather than argv so it does not
 * appear in the process table; this module's job is not to undo that.
 */
import { joinNetwork, readNetworkStatus, scanAccessPoints, displaySsid, ssidToHex, withoutNetwork, } from "./network.js";
/**
 * Every verb this broker will ever answer. Adding one is a deliberate edit here
 * and in the preload surface test; nothing is dispatched by string concatenation.
 */
export const VERBS = [
    "network.status",
    "network.scan",
    "network.join",
    "network.forget",
    "display.getBrightness",
    "display.setBrightness",
];
/**
 * A request line longer than this is refused unread rather than parsed.
 *
 * A scan reply is large; a REQUEST never is. The largest legitimate one is a
 * join carrying a 64-character PSK and a 64-character SSID hex, which is under
 * 300 bytes. 4 KiB is generous and still bounds what one client can make the
 * broker allocate.
 */
export const MAX_REQUEST_BYTES = 4096;
const HEX = /^[0-9a-fA-F]*$/;
function refuse(code, message) {
    return { ok: false, code, message };
}
/**
 * Parse one line into a request, or refuse it.
 *
 * Separate from `handle` so a malformed line is refused before any dependency is
 * consulted: nothing privileged should run to discover that the input was junk.
 */
export function parseRequest(line) {
    if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) {
        return refuse("REQUEST_TOO_LARGE", "The request was refused unread.");
    }
    let raw;
    try {
        raw = JSON.parse(line);
    }
    catch {
        return refuse("MALFORMED", "The request was not JSON.");
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return refuse("MALFORMED", "The request was not an object.");
    }
    const verb = raw.verb;
    if (typeof verb !== "string") {
        return refuse("MALFORMED", "The request named no verb.");
    }
    if (!VERBS.includes(verb)) {
        // The verb is echoed only after the allow-list rejected it, and only when it
        // is short and printable: an unknown verb is attacker-controlled text on its
        // way to a journal, and a journal is read by people.
        const safe = /^[\w.-]{1,40}$/.test(verb) ? verb : "(unprintable)";
        return refuse("UNKNOWN_VERB", `No such verb: ${safe}`);
    }
    if (verb === "network.join" || verb === "network.forget") {
        const ssidHex = raw.ssidHex;
        if (typeof ssidHex !== "string" || ssidHex === "" || !HEX.test(ssidHex) || ssidHex.length % 2 !== 0) {
            return refuse("MALFORMED", "The network identifier was not hex.");
        }
        // 32 bytes is the 802.11 maximum; a longer one cannot be a real SSID.
        if (ssidHex.length > 64) {
            return refuse("MALFORMED", "The network identifier is too long to be an SSID.");
        }
        if (verb === "network.forget")
            return { verb, ssidHex };
        const psk = raw.psk;
        if (psk !== undefined && typeof psk !== "string") {
            return refuse("MALFORMED", "The passphrase was not text.");
        }
        // WPA2 bounds. Checked HERE so a hopeless value never reaches wpa_passphrase,
        // whose own error would be less useful to the person standing at the till.
        if (typeof psk === "string" && psk !== "" && (psk.length < 8 || psk.length > 63)) {
            return refuse("PSK_LENGTH", "A Wi-Fi password is between 8 and 63 characters.");
        }
        return psk === undefined ? { verb, ssidHex } : { verb, ssidHex, psk };
    }
    if (verb === "display.setBrightness") {
        const percent = raw.percent;
        if (typeof percent !== "number" || !Number.isFinite(percent)) {
            return refuse("MALFORMED", "The brightness was not a number.");
        }
        // Clamped, never refused: a slider that reports 0 must not black out a till
        // in a shop, and one that reports 137 is a bug in the client, not an attack.
        const clamped = Math.min(100, Math.max(1, Math.round(percent)));
        return { verb, percent: clamped };
    }
    return { verb };
}
export function toAccessPointDto(ap) {
    return {
        ssid: displaySsid(ap.ssidBytes),
        ssidHex: ssidToHex(ap.ssidBytes),
        signal: ap.signal,
        secured: ap.secured,
    };
}
/** Execute one already-parsed request. */
export async function handle(request, deps = {}) {
    try {
        switch (request.verb) {
            case "network.status":
                return { ok: true, data: (deps.status ?? readNetworkStatus)() };
            case "network.scan": {
                const found = await (deps.scan ?? scanAccessPoints)();
                return { ok: true, data: found.map(toAccessPointDto) };
            }
            case "network.join": {
                const run = deps.join;
                const outcome = run
                    ? await run(request.ssidHex, request.psk)
                    : await joinNetwork({
                        // The ORIGINAL bytes, not the printable form: an SSID the radio
                        // broadcast with a control byte in it must be stored as broadcast
                        // or the device joins a network that does not exist.
                        ssid: Buffer.from(request.ssidHex, "hex"),
                        passphrase: request.psk ?? "",
                    });
                return { ok: true, data: outcome };
            }
            case "network.forget": {
                if (deps.forget === undefined)
                    return refuse("UNAVAILABLE", "Not supported on this device.");
                await deps.forget(request.ssidHex);
                return { ok: true, data: { forgotten: true } };
            }
            case "display.getBrightness": {
                if (deps.getBrightness === undefined)
                    return { ok: true, data: { percent: null } };
                return { ok: true, data: { percent: await deps.getBrightness() } };
            }
            case "display.setBrightness": {
                if (deps.setBrightness === undefined) {
                    return refuse("UNAVAILABLE", "This screen's brightness cannot be set.");
                }
                await deps.setBrightness(request.percent);
                return { ok: true, data: { percent: request.percent } };
            }
        }
    }
    catch (error) {
        // The message is the broker's own, never the underlying error's: a failure
        // from `wpa_passphrase` or a sysfs write can quote its input, and one of
        // those inputs is the shop's Wi-Fi password.
        return refuse("FAILED", `The device refused to apply that change (${request.verb}).`);
    }
}
/** Parse and execute. The one entry point the socket needs. */
export async function serve(line, deps = {}) {
    const parsed = parseRequest(line);
    if ("ok" in parsed)
        return parsed;
    return handle(parsed, deps);
}
export { withoutNetwork };
//# sourceMappingURL=device-config.js.map