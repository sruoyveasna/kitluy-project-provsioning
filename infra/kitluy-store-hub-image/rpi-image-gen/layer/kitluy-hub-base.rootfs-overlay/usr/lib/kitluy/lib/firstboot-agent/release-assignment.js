import { verifyReleaseAssignmentSignature, } from "./release-verify.js";
/**
 * Decide what to do with an assignment, from the journal alone. Pure: no clock,
 * no filesystem, no network — so every branch is testable and the ordering of
 * the checks is visible.
 *
 * Check order is deliberate. Malformed first (nothing else is meaningful about
 * a broken record), then the two replay checks, then the rollback block, and
 * only then "already current" — because a device that has rolled back FROM a
 * release must report that rather than report the release as current.
 */
export function evaluateAssignment(journal, assignment, 
/**
 * The device's OWN identity and trust material. Required, not optional: the
 * whole point of group 0222 is that an assignment is not believed until it is
 * proven to be for this device, and an optional parameter is a check somebody
 * eventually forgets to pass.
 */
trust) {
    if (assignment === null)
        return { kind: "NOTHING_ASSIGNED" };
    if (typeof assignment.releaseId !== "string" ||
        assignment.releaseId === "" ||
        !Number.isInteger(assignment.assignmentSequence) ||
        assignment.assignmentSequence < 1) {
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_MALFORMED",
            detail: "an assignment carries a release id and a sequence >= 1",
        };
    }
    // The manifest is the signed authority; an assignment naming a different
    // release than the manifest it carries is incoherent and is never installed.
    if (assignment.manifest.releaseId !== assignment.releaseId) {
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_RELEASE_ID_MISMATCH",
            detail: `assignment names ${assignment.releaseId}, manifest names ${assignment.manifest.releaseId}`,
        };
    }
    // ---- THE ASSIGNMENT SIGNATURE, BEFORE THE SEQUENCE IS BELIEVED.
    //
    // Order matters and is the correction group 0222 exists for. Everything below
    // this point — and in particular `lastAssignmentSequence`, which is written to
    // a DURABLE journal — treats the sequence as a fact. Believing an
    // unauthenticated number here is what let a forged high sequence poison the
    // high-water mark permanently.
    const binding = {
        assignmentId: assignment.assignmentId,
        deviceId: assignment.deviceId,
        releaseId: assignment.releaseId,
        assignmentSequence: assignment.assignmentSequence,
        environment: assignment.environment,
    };
    const signed = verifyReleaseAssignmentSignature(binding, assignment.assignmentEnvelope, trust.trustedKeys, trust.deviceId);
    if (!signed.verified) {
        if (signed.failure === "SIGNATURE_MISSING") {
            return {
                kind: "REFUSED",
                code: "ASSIGNMENT_UNSIGNED",
                detail: "the assignment carries no signature; a transport must not be able to choose a sequence",
            };
        }
        if (signed.failure === "ASSIGNMENT_NOT_FOR_THIS_DEVICE") {
            return {
                kind: "REFUSED",
                code: "ASSIGNMENT_NOT_FOR_THIS_DEVICE",
                detail: `the assignment names device ${assignment.deviceId}, not this one`,
            };
        }
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_SIGNATURE_INVALID",
            detail: `the assignment signature did not verify (${signed.failure})`,
        };
    }
    // The signed assignment environment and the signed manifest environment are
    // two separate signatures; a disagreement between them means one of the two
    // statements is not about this release.
    if (assignment.environment !== assignment.manifest.environment) {
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_ENVIRONMENT_MISMATCH",
            detail: `assignment says ${assignment.environment}, manifest says ${assignment.manifest.environment}`,
        };
    }
    const accepted = journal.lastAssignmentSequence;
    if (accepted !== null && assignment.assignmentSequence < accepted) {
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_STALE",
            detail: `sequence ${String(assignment.assignmentSequence)} is older than the accepted ${String(accepted)}`,
        };
    }
    if (journal.failedRolledBackReleaseIds.includes(assignment.releaseId)) {
        return {
            kind: "REFUSED",
            code: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK",
            detail: `${assignment.releaseId} failed its health gate and was rolled back; an operator action or a newer release is required`,
        };
    }
    if (journal.supersededReleaseIds.includes(assignment.releaseId)) {
        return {
            kind: "REFUSED",
            code: "ASSIGNMENT_SUPERSEDED",
            detail: `${assignment.releaseId} has already been installed and moved past on this device`,
        };
    }
    if (journal.committed === assignment.releaseId) {
        return { kind: "ALREADY_CURRENT", releaseId: assignment.releaseId };
    }
    return { kind: "INSTALL", assignment };
}
/**
 * Record that an assignment sequence was accepted, so a later replay of an
 * older one is refused. A high-water mark that never lowers. Persisted by the
 * caller through `writeJournal`.
 */
export function withAcceptedSequence(journal, assignmentSequence) {
    const accepted = journal.lastAssignmentSequence;
    return {
        ...journal,
        lastAssignmentSequence: accepted === null ? assignmentSequence : Math.max(accepted, assignmentSequence),
    };
}
//# sourceMappingURL=release-assignment.js.map