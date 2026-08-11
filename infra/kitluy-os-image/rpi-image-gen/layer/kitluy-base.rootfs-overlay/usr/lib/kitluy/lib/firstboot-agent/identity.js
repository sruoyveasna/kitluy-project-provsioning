/**
 * Device-side identity bootstrap for the KitLuy OS firstboot service.
 *
 * Authority:
 *   00_AI_HANDOFF/000_ACTIVE_PHASE.md §10 — the owner-fixed identity model
 *   @kitluy/device-identity — THE IDENTITY RULE
 *   KLD-2026-07-28-002 (BLK-005) — key custody and trust environments
 *
 * ===========================================================================
 * THE IDENTITY RULE, RESTATED WHERE IT IS ENFORCED
 * ===========================================================================
 * The primary identity is an opaque, server-generated `device_record_id`. This
 * agent NEVER derives an identity from MAC address, board serial or storage
 * serial. Those are collected as BINDING and TAMPER signals and sent as
 * evidence; a changed signal quarantines the device server-side and requires
 * governed re-enrollment. Hashing them into a local identity would make a
 * repaired device a different device and a cloned device the same device.
 *
 * ===========================================================================
 * WHAT NEVER LEAVES THE DEVICE
 * ===========================================================================
 * The private key. It is generated on the device, stored on the encrypted data
 * partition, and only ever used to produce signatures. There is no code path
 * in this module that serialises it into a request body, a log line or an
 * error message — `IdentityRecord` deliberately has no private-key field, so a
 * caller cannot transmit one by accident.
 */
/**
 * Establish device identity, exactly once, safely on every rerun.
 *
 * The three outcomes are distinguished on purpose. `recreated` is not a
 * success dressed up as one — it means a previous attempt left unusable
 * material behind, and the fleet needs to be able to see that happened.
 */
export async function bootstrapIdentity(deps) {
    const existing = await deps.store.read();
    if (existing !== null) {
        if (!existing.complete) {
            return recreate(deps, "previous firstboot did not complete (torn write)");
        }
        const usable = await deps.keys.verifyKeyUsable(existing.privateKeyHandle);
        if (!usable) {
            // The key is gone or the secure element changed. Re-keying locally is
            // correct; the SERVER decides whether this device keeps its record — a
            // new key against a known record is a governed re-enrollment, not a
            // silent new identity.
            return recreate(deps, "stored private key is no longer usable");
        }
        return { kind: "reused", identity: toRecord(existing) };
    }
    const created = await create(deps);
    return { kind: "created", identity: toRecord(created) };
}
async function recreate(deps, reason) {
    const created = await create(deps);
    return { kind: "recreated", identity: toRecord(created), reason };
}
async function create(deps) {
    const { publicKeyPem, privateKeyHandle } = await deps.keys.generateKeyPair();
    const hardwareSignals = await deps.hardware.collect();
    const identity = {
        publicKeyPem,
        privateKeyHandle,
        hardwareSignals,
        createdAt: deps.now().toISOString(),
        complete: true,
    };
    await deps.store.write(identity);
    return identity;
}
function toRecord(stored) {
    // Explicit field selection, not a spread-and-delete: a future field added to
    // StoredIdentity must be opted IN to transmission, never opted out of it.
    const record = {
        publicKeyPem: stored.publicKeyPem,
        hardwareSignals: stored.hardwareSignals,
        createdAt: stored.createdAt,
    };
    return stored.deviceRecordId === undefined
        ? record
        : { ...record, deviceRecordId: stored.deviceRecordId };
}
//# sourceMappingURL=identity.js.map