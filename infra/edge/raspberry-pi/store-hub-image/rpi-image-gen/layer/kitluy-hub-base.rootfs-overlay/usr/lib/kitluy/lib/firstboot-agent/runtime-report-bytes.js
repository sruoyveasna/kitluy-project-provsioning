/**
 * The DEVICE copy of the runtime report preimage (T1-STORE-OPERATIONS-001).
 *
 * The authoritative contract is `packages/device-identity/src/device-runtime-report.ts`.
 * The firstboot agent ships node built-ins only (the image carries no
 * node_modules), so the bytes it signs are built here, and
 * `test/runtime-report-drift.test.ts` fails if they differ by one byte.
 */
import { createHash } from "node:crypto";
/** The kind this agent signs (v2: Terminal PIN evidence). */
export const DEVICE_RUNTIME_REPORT_KIND = "kitluy.device-runtime-report.v2";
const KNOWN_KINDS = [
    "kitluy.device-runtime-report.v1",
    DEVICE_RUNTIME_REPORT_KIND,
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX64 = /^[0-9a-f]{64}$/u;
function hasControlCharacter(value) {
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f)
            return true;
    }
    return false;
}
/** Canonical JSON: keys sorted at every depth, arrays in order, no whitespace. */
export function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
    const record = value;
    return `{${Object.keys(record)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
        .join(",")}}`;
}
export function deviceRuntimeReportBytes(input) {
    if (!HEX64.test(input.identityPublicKeyFingerprint)) {
        throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex");
    }
    if (!UUID.test(input.deviceId) ||
        !Number.isSafeInteger(input.reportSequence) ||
        input.reportSequence < 1) {
        throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: device id or report sequence is invalid");
    }
    if (hasControlCharacter(input.observedAt) || input.observedAt.length > 64) {
        throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: observedAt is invalid");
    }
    const kind = input.report?.schema;
    if (typeof kind !== "string" || !KNOWN_KINDS.includes(kind)) {
        throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: the report declares no known kind");
    }
    const digest = createHash("sha256").update(canonicalJson(input.report), "utf8").digest("hex");
    return new Uint8Array(Buffer.from([
        kind,
        input.identityPublicKeyFingerprint,
        input.deviceId.toLowerCase(),
        String(input.reportSequence),
        input.observedAt,
        digest,
    ].join("\n"), "utf8"));
}
//# sourceMappingURL=runtime-report-bytes.js.map