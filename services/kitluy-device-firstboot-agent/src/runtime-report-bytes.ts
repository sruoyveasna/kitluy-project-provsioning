/**
 * The DEVICE copy of the runtime report preimage (T1-STORE-OPERATIONS-001).
 *
 * The authoritative contract is `packages/device-identity/src/device-runtime-report.ts`.
 * The firstboot agent ships node built-ins only (the image carries no
 * node_modules), so the bytes it signs are built here, and
 * `test/runtime-report-drift.test.ts` fails if they differ by one byte.
 */
import { createHash } from "node:crypto";

export const DEVICE_RUNTIME_REPORT_KIND = "kitluy.device-runtime-report.v1" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX64 = /^[0-9a-f]{64}$/u;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Canonical JSON: keys sorted at every depth, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

export function deviceRuntimeReportBytes(input: {
  readonly identityPublicKeyFingerprint: string;
  readonly deviceId: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: unknown;
}): Uint8Array {
  if (!HEX64.test(input.identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-RUNTIME-REPORT-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex",
    );
  }
  if (
    !UUID.test(input.deviceId) ||
    !Number.isSafeInteger(input.reportSequence) ||
    input.reportSequence < 1
  ) {
    throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: device id or report sequence is invalid");
  }
  if (hasControlCharacter(input.observedAt) || input.observedAt.length > 64) {
    throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: observedAt is invalid");
  }
  const digest = createHash("sha256").update(canonicalJson(input.report), "utf8").digest("hex");
  return new Uint8Array(
    Buffer.from(
      [
        DEVICE_RUNTIME_REPORT_KIND,
        input.identityPublicKeyFingerprint,
        input.deviceId.toLowerCase(),
        String(input.reportSequence),
        input.observedAt,
        digest,
      ].join("\n"),
      "utf8",
    ),
  );
}
