/**
 * Release ASSIGNMENT — the deployment authority (U1 requirements 1 and 2).
 *
 * ===========================================================================
 * A DEVICE INSTALLS WHAT IT IS ASSIGNED, NOT WHAT IT IS OFFERED
 * ===========================================================================
 * The owner ruled that assignment determines what a Terminal may install, and
 * that artifact storage transports bytes only and is not deployment authority.
 * That is why this module exists separately from `release-artifact.ts`, and why
 * the order in `release-install.ts` is fixed:
 *
 *     1. ask the ASSIGNMENT source what this device is assigned
 *     2. verify the signed manifest that came with the answer
 *     3. only THEN fetch bytes, for that release id, checked against that digest
 *
 * By the time a byte source is contacted, the device already knows the release
 * id, the expected SHA-256 and the expected size. A byte source therefore cannot
 * substitute, downgrade or introduce anything: nothing ever asks it what it has.
 *
 * ===========================================================================
 * REPLAY AND DOWNGRADE (requirement 2) — THE AUTHORITATIVE SEQUENCE
 * ===========================================================================
 * The owner ruled out deriving order from `updated_at` plus campaign ids, and
 * asked first whether an authoritative release-assignment sequence already
 * existed to reuse. Every column of every `kitluy_releases` table was checked:
 * none did. Group 0182 is called "assignment identity" but corrects idempotency
 * keys, not ordering.
 *
 * `kitluy_devices.device_assignments.assignment_generation` was considered and
 * REJECTED for this job, because it orders the device's STORE BINDING: two
 * release assignments to the same device in the same Store carry the SAME
 * generation and cannot be ordered by it.
 *
 * So cloud group 0221 adds the smallest explicit mechanism — an identity column
 * on `device_installations`, the authoritative per-device release-assignment
 * row:
 *
 *     assignment_sequence bigint generated always as identity
 *
 * A database sequence: strictly increasing, never reused, and `always` so no
 * caller can supply one. `current_device_assignment_v1` returns the highest for
 * a device, and this module refuses anything lower.
 *
 *     sequence lower than accepted     -> ASSIGNMENT_STALE
 *     release id already superseded    -> ASSIGNMENT_SUPERSEDED
 *     release id already rolled back   -> INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK
 *
 * The last two are kept as a second, independent line. They cost one array
 * lookup each and they hold even if a stack is restored from a backup that
 * rewinds the sequence — the device's own journal still remembers what it has
 * installed. Belt and braces on the one path where being wrong means running
 * the wrong software.
 *
 * A GOVERNED DOWNGRADE REMAINS ORDINARY, which is the whole point of ordering by
 * assignment rather than by version: assigning an older release creates a NEW
 * `device_installations` row, which takes a HIGHER sequence and a release id the
 * device has not superseded, so it installs. Nothing here compares versions.
 */
import type { ReleaseJournal } from "./release-store.js";
import {
  verifyReleaseAssignmentSignature,
  type ReleaseAssignmentBinding,
  type ReleaseSignatureEnvelope,
  type SignedReleaseManifestBody,
  type TrustedReleaseKey,
} from "./release-verify.js";

/** What a governed assignment source returns for this device. */
export interface ReleaseAssignment {
  /** `device_installations.id` — WHICH assignment. Covered by the signature. */
  readonly assignmentId: string;
  /** The device this was minted for. Covered by the signature. */
  readonly deviceId: string;
  /** Covered by the signature; also re-checked against the manifest. */
  readonly environment: string;
  /** Detached signature over the assignment binding (group 0222). */
  readonly assignmentEnvelope: ReleaseSignatureEnvelope;
  /**
   * `kitluy_releases.device_installations.assignment_sequence` (cloud group
   * 0221). Authoritative, monotonic, database-assigned, and NOT derived from a
   * clock. This is NOT `device_assignments.assignment_generation` — see header.
   */
  readonly assignmentSequence: number;
  readonly releaseId: string;
  readonly manifest: SignedReleaseManifestBody;
  readonly envelope: ReleaseSignatureEnvelope;
}

/**
 * The authority side of the split. One implementation in U1 (a development
 * service reading the governed cloud rows); the Store Hub becomes a second at
 * U4 without this interface changing.
 */
export interface AssignmentSource {
  /** null when the device has no current assignment — a normal, quiet state. */
  fetchAssignment(): Promise<ReleaseAssignment | null>;
  /** For logs and status. Never a credential. */
  describe(): string;
}

export type AssignmentVerdict =
  | { readonly kind: "INSTALL"; readonly assignment: ReleaseAssignment }
  | { readonly kind: "ALREADY_CURRENT"; readonly releaseId: string }
  | { readonly kind: "NOTHING_ASSIGNED" }
  | { readonly kind: "REFUSED"; readonly code: AssignmentRefusal; readonly detail: string };

export type AssignmentRefusal =
  | "ASSIGNMENT_UNSIGNED"
  | "ASSIGNMENT_SIGNATURE_INVALID"
  | "ASSIGNMENT_NOT_FOR_THIS_DEVICE"
  | "ASSIGNMENT_ENVIRONMENT_MISMATCH"
  | "ASSIGNMENT_STALE"
  | "ASSIGNMENT_SUPERSEDED"
  | "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK"
  | "ASSIGNMENT_MALFORMED"
  | "ASSIGNMENT_RELEASE_ID_MISMATCH";

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
export function evaluateAssignment(
  journal: ReleaseJournal,
  assignment: ReleaseAssignment | null,
  /**
   * The device's OWN identity and trust material. Required, not optional: the
   * whole point of group 0222 is that an assignment is not believed until it is
   * proven to be for this device, and an optional parameter is a check somebody
   * eventually forgets to pass.
   */
  trust: { readonly deviceId: string; readonly trustedKeys: readonly TrustedReleaseKey[] },
): AssignmentVerdict {
  if (assignment === null) return { kind: "NOTHING_ASSIGNED" };

  if (
    typeof assignment.releaseId !== "string" ||
    assignment.releaseId === "" ||
    !Number.isInteger(assignment.assignmentSequence) ||
    assignment.assignmentSequence < 1
  ) {
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
  const binding: ReleaseAssignmentBinding = {
    assignmentId: assignment.assignmentId,
    deviceId: assignment.deviceId,
    releaseId: assignment.releaseId,
    assignmentSequence: assignment.assignmentSequence,
    environment: assignment.environment,
  };
  const signed = verifyReleaseAssignmentSignature(
    binding,
    assignment.assignmentEnvelope,
    trust.trustedKeys,
    trust.deviceId,
  );
  if (!signed.verified) {
    if (signed.failure === "SIGNATURE_MISSING") {
      return {
        kind: "REFUSED",
        code: "ASSIGNMENT_UNSIGNED",
        detail:
          "the assignment carries no signature; a transport must not be able to choose a sequence",
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
export function withAcceptedSequence(
  journal: ReleaseJournal,
  assignmentSequence: number,
): ReleaseJournal {
  const accepted = journal.lastAssignmentSequence;
  return {
    ...journal,
    lastAssignmentSequence:
      accepted === null ? assignmentSequence : Math.max(accepted, assignmentSequence),
  };
}
