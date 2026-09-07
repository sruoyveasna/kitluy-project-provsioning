export const NOT_REGISTERED = "NO_DEVICE_RECORD";
export const PERSIST_FAILED = "PAIRING_NOT_RECORDED";
/**
 * Present a code and, if the cloud accepts it, record the seat it granted.
 *
 * A pairing that the cloud accepted but the device failed to WRITE is reported
 * as `PAIRING_NOT_RECORDED` rather than as success. The seat is real — the
 * server made it — but this board cannot prove it after a reboot, and telling
 * the installer "done" would send them away from a terminal that will show an
 * empty keypad tomorrow. The refusal is non-retryable on purpose: presenting the
 * same code again cannot help, because the session has already been consumed.
 */
export async function submitPairingCode(code, deps) {
    if (deps.deviceRecordId === undefined || deps.deviceRecordId.trim() === "") {
        return {
            status: NOT_REGISTERED,
            retryable: true,
            message: "this board has not finished registering yet",
        };
    }
    const result = await deps.transport.pair({ deviceRecordId: deps.deviceRecordId, code });
    if (result.kind === "refused") {
        return { status: result.result, retryable: result.retryable, message: result.message };
    }
    const now = (deps.now ?? (() => new Date()))();
    try {
        deps.persist({
            deviceRecordId: result.deviceRecordId,
            assignmentId: result.assignmentId,
            assignmentGeneration: result.assignmentGeneration,
            activated: result.activated,
            digitalStoreReference: result.context.digitalStoreReference,
            storeLocationReference: result.context.storeLocationReference,
            physicalTerminalLabel: result.context.physicalTerminalLabel,
            terminalProfileKeys: result.context.terminalProfileKeys,
            updatedAt: now.toISOString(),
        });
    }
    catch {
        return {
            status: PERSIST_FAILED,
            retryable: false,
            message: "the seat was granted but could not be saved on this device",
        };
    }
    return { status: "PAIRED" };
}
//# sourceMappingURL=pairing.js.map