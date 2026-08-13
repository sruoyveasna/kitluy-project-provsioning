/**
 * `/usr/lib/kitluy/firstboot-identity` — the KitLuy first-boot identity
 * entrypoint. Invoked once per boot by `kitluy-firstboot.service`.
 *
 * Authority: DEC-1 bootstrap-hybrid owner decision (2026-08-10) — first-boot
 *   identity is baked into the golden image because an updater cannot depend
 *   on itself being downloaded before first use.
 *
 * ===========================================================================
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO
 * ===========================================================================
 * It establishes a per-device identity and exits. It performs NO network I/O:
 * no enrollment, no heartbeat, no assignment poll. That separation is what
 * lets a device that has never reached the internet still hold a stable
 * identity, and it is why `kitluy-firstboot.service` can be `Type=oneshot`
 * with `RemainAfterExit=yes` and be ordered strictly before the enrollment
 * agent rather than racing it.
 *
 * ===========================================================================
 * IDEMPOTENCE IS THE CONTRACT
 * ===========================================================================
 * Run it a thousand times: the identity is created once. `bootstrapIdentity`
 * distinguishes created / reused / recreated, and all three are success — but
 * they are reported distinctly, because `recreated` means a previous attempt
 * left unusable material behind and the fleet needs to be able to see that
 * happened rather than have it smoothed into "fine".
 *
 * ===========================================================================
 * EXIT CODES
 * ===========================================================================
 *   0  identity established (created, reused or recreated)
 *   2  the stored identity is CORRUPT — refused, not overwritten
 *   3  an unexpected failure
 *
 * Exit 2 is separate on purpose. Overwriting a corrupt record would silently
 * turn an already-enrolled device into a new one and orphan its fleet record,
 * so it stops and leaves the evidence in place for a governed decision.
 */
import { bootstrapIdentity } from "../identity.js";
import { CorruptIdentityRecordError, DEFAULT_IDENTITY_DIR, FileIdentityStore, } from "../adapters/device-identity-store.js";
import { FileKeyProvider } from "../adapters/device-key-provider.js";
import { LinuxHardwareProbe } from "../adapters/linux-hardware-probe.js";
import { SERVICE_VERSION } from "../version.js";
export const EXIT_OK = 0;
export const EXIT_CORRUPT_IDENTITY = 2;
export const EXIT_FAILED = 3;
/**
 * The directory is overridable so the same binary can be exercised in CI and
 * on a workstation without a real /var/lib/kitluy.
 */
function identityDirectory() {
    const configured = process.env.KITLUY_IDENTITY_DIR;
    return configured !== undefined && configured.trim() !== ""
        ? configured.trim()
        : DEFAULT_IDENTITY_DIR;
}
export function buildDeps(directory) {
    return {
        store: new FileIdentityStore({ directory }),
        keys: new FileKeyProvider({ directory }),
        hardware: new LinuxHardwareProbe(),
        now: () => new Date(),
    };
}
/**
 * Structured, single-line, non-secret output.
 *
 * The public key is NOT printed even though it is public: journal lines are
 * routinely pasted into tickets, and a device's public key next to its serial
 * is a correlation gift for no operational benefit. What an operator needs is
 * the outcome and how many binding signals were collected.
 */
function report(fields) {
    const line = Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" && v.includes(" ") ? JSON.stringify(v) : v}`)
        .join(" ");
    process.stdout.write(`${line}\n`);
}
export async function main() {
    const directory = identityDirectory();
    try {
        const outcome = await bootstrapIdentity(buildDeps(directory));
        const signalCount = Object.values(outcome.identity.hardwareSignals).filter((v) => v !== undefined).length;
        report({
            event: "kitluy.firstboot.identity",
            outcome: outcome.kind,
            agent_version: SERVICE_VERSION,
            hardware_signals: signalCount,
            enrolled: outcome.identity.deviceRecordId === undefined ? "false" : "true",
            ...(outcome.kind === "recreated" ? { reason: outcome.reason } : {}),
        });
        if (signalCount === 0) {
            // Not fatal: identity does not depend on these. But a device that can
            // report no binding evidence at all cannot be tamper-checked later, and
            // that should be visible at the moment it happens.
            report({
                event: "kitluy.firstboot.warning",
                detail: "no hardware binding signals could be read",
            });
        }
        return EXIT_OK;
    }
    catch (error) {
        if (error instanceof CorruptIdentityRecordError) {
            report({
                event: "kitluy.firstboot.refused",
                reason: "corrupt_identity_record",
                detail: "existing identity is unreadable; refusing to mint a replacement",
            });
            return EXIT_CORRUPT_IDENTITY;
        }
        report({
            event: "kitluy.firstboot.failed",
            // `message` only — a stack trace here can carry a key path.
            detail: error instanceof Error ? error.message : "unknown error",
        });
        return EXIT_FAILED;
    }
}
// Executed only when run as a program, so the module stays importable by tests.
if (process.argv[1] !== undefined && process.argv[1].includes("firstboot-identity")) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
//# sourceMappingURL=firstboot-identity.js.map