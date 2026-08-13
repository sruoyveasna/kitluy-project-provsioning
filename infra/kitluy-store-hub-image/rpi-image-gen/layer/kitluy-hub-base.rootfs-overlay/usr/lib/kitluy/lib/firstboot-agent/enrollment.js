/**
 * Cloud enrollment and fleet state machine for the KitLuy OS enrollment agent.
 *
 * Authority:
 *   00_AI_HANDOFF/000_ACTIVE_PHASE.md §10 — the LOCKED provisioning chain
 *   migration groups 0120–0122 (device lifecycle), 0162–0176 (provisioning)
 *   @kitluy/device-identity — the device lifecycle transition matrix
 *
 * ===========================================================================
 * THE STATES ARE THE CANONICAL ONES
 * ===========================================================================
 * These mirror `kitluy_devices.device_lifecycle_state`. No new enum value is
 * invented here. In particular there is no `ENROLLED_UNASSIGNED` state: that
 * condition is `enrolled` WITHOUT an active assignment, which is exactly how
 * the database models it, and inventing a state for it would put this agent
 * and the database into permanent disagreement.
 *
 * ===========================================================================
 * WHAT AN UNASSIGNED DEVICE MAY DO
 * ===========================================================================
 * Enroll, heartbeat, report health and OS version, and poll for assignment.
 * It may NOT read Store business data — and it cannot, because it holds no
 * Store scope: every scope value is server-derived and delivered only with an
 * assignment. This agent never asks for Store data and has no code to consume
 * it, so the isolation is structural rather than a check that could be missed.
 */
/**
 * States from which the agent must stop trying rather than keep calling.
 *
 * A revoked or retired device that kept retrying would generate exactly the
 * traffic pattern a stolen device produces, and would bury the real signal.
 */
const TERMINAL_STATES = new Set([
    "retired",
    "replaced",
    "quarantined",
    "restricted_investigation",
    "suspended",
]);
export function isTerminalState(state) {
    return TERMINAL_STATES.has(state);
}
/**
 * One step of the agent loop. Pure with respect to time and scheduling — the
 * caller owns the interval — so every branch is directly testable.
 */
export async function runEnrollmentStep(deps, identity, position) {
    // Server identity is checked BEFORE anything is sent, on every step. A
    // per-boot check would let a mid-session redirection through.
    const trust = await deps.serverIdentity.verify();
    if (!trust.trusted) {
        return { kind: "server_untrusted", reason: trust.reason ?? "server identity not verified" };
    }
    if (isTerminalState(position.lifecycleState)) {
        return {
            kind: "halted",
            position,
            reason: `device lifecycle state '${position.lifecycleState}' does not permit fleet communication`,
        };
    }
    // --- Not yet enrolled ---------------------------------------------------
    if (position.deviceRecordId === undefined) {
        const result = await deps.client.enroll({
            publicKeyPem: identity.publicKeyPem,
            deviceClass: deps.deviceClass,
            hardwareSignals: identity.hardwareSignals,
        });
        if (result.kind === "refused") {
            return result.retryable
                ? { kind: "retry", position, code: result.code }
                : { kind: "halted", position, reason: `enrollment refused: ${result.code}` };
        }
        return {
            kind: "enrolled",
            position: { ...position, lifecycleState: "enrolled", deviceRecordId: result.deviceRecordId },
        };
    }
    const deviceRecordId = position.deviceRecordId;
    // --- Enrolled: heartbeat, then look for an assignment -------------------
    const beat = await deps.client.heartbeat({
        deviceRecordId,
        osImageVersion: deps.osImageVersion,
        releaseChannel: deps.releaseChannel,
    });
    if (beat.kind === "refused") {
        return beat.retryable
            ? { kind: "retry", position, code: beat.code }
            : { kind: "halted", position, reason: `heartbeat refused: ${beat.code}` };
    }
    // An already-assigned device does not re-poll for assignment; its
    // configuration arrives through the governed configuration channel.
    if (position.assignmentId !== undefined) {
        return { kind: "heartbeat", position };
    }
    const poll = await deps.client.pollAssignment({ deviceRecordId });
    if (poll.kind === "refused") {
        return poll.retryable
            ? { kind: "retry", position, code: poll.code }
            : { kind: "halted", position, reason: `assignment poll refused: ${poll.code}` };
    }
    if (poll.kind === "unassigned") {
        return { kind: "heartbeat", position };
    }
    // Assignment received. The device moves to `awaiting_trust`, NOT to
    // `active`: `enrolled -> active` was removed from the transition matrix in
    // migration group 0121, and activation additionally requires certificate
    // issuance the device does not perform for itself.
    return {
        kind: "assigned",
        position: {
            ...position,
            lifecycleState: "awaiting_trust",
            assignmentId: poll.assignmentId,
            terminalProfileKey: poll.terminalProfileKey,
            configurationVersion: poll.configurationVersion,
        },
    };
}
/**
 * Configuration version acceptance.
 *
 * Newer wins; equal is a no-op; OLDER IS REFUSED. Accepting an older version
 * is how a replayed or rolled-back delivery silently downgrades a device's
 * configuration, so it is refused rather than merged.
 */
export function acceptsConfigurationVersion(current, incoming) {
    if (!Number.isInteger(incoming) || incoming < 0)
        return false;
    if (current === undefined)
        return true;
    return incoming > current;
}
//# sourceMappingURL=enrollment.js.map