/**
 * Assignment authority, replay and downgrade (U1 requirements 1 and 2).
 *
 * The distinction under test is the one the owner drew: a GOVERNED downgrade is
 * ordinary and must work; an ARBITRARY downgrade must have no code path. Both
 * live in `evaluateAssignment`, which is pure, so every branch is reachable
 * without a network or a filesystem.
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  evaluateAssignment,
  withAcceptedSequence,
  type ReleaseAssignment,
} from "../src/release-assignment.js";
import { emptyJournal, U1_PERMITTED_PRODUCT, type ReleaseJournal } from "../src/release-store.js";
import {
  canonicalReleaseAssignmentBytes,
  type SignedReleaseManifestBody,
  type TrustedReleaseKey,
} from "../src/release-verify.js";

// Real keys and real signatures: the point of group 0222 is that an unsigned or
// wrongly-signed assignment is refused, which a stub signature cannot exercise.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const TRUSTED: TrustedReleaseKey = {
  keyId: "dev-release-signing",
  keyVersion: 1,
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  state: "current",
  purpose: "release_signing",
};
const DEVICE_ID = "050f9ea4-4478-48f3-8061-b30fdea04b9b";
const TRUST = { deviceId: DEVICE_ID, trustedKeys: [TRUSTED] };

/** Sign a binding with the test key. */
function signBinding(binding: {
  assignmentId: string;
  deviceId: string;
  releaseId: string;
  assignmentSequence: number;
  environment: string;
}) {
  return {
    keyId: TRUSTED.keyId,
    keyVersion: TRUSTED.keyVersion,
    algorithm: "ed25519" as const,
    signature: Buffer.from(
      edSign(null, canonicalReleaseAssignmentBytes(binding), privateKey),
    ).toString("base64"),
  };
}

function manifest(releaseId: string, version = "1.0.0"): SignedReleaseManifestBody {
  return {
    manifestVersion: 1,
    releaseId,
    productKey: "device-shell",
    version,
    buildId: "git-abc123",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: "a".repeat(64),
    artifactSizeBytes: 1024,
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
  };
}

/** A correctly signed assignment for THIS device. */
function assignment(releaseId: string, sequence: number, version = "1.0.0"): ReleaseAssignment {
  const assignmentId = `inst-${releaseId}-${String(sequence)}`;
  const binding = {
    assignmentId,
    deviceId: DEVICE_ID,
    releaseId,
    assignmentSequence: sequence,
    environment: "development",
  };
  return {
    ...binding,
    manifest: manifest(releaseId, version),
    envelope: { keyId: "k1", keyVersion: 1, algorithm: "ed25519", signature: "x" },
    assignmentEnvelope: signBinding(binding),
  };
}

const base: ReleaseJournal = emptyJournal(U1_PERMITTED_PRODUCT);

describe("evaluateAssignment", () => {
  it("installs a fresh assignment", () => {
    expect(evaluateAssignment(base, assignment("r1", 1), TRUST).kind).toBe("INSTALL");
  });

  it("does nothing when nothing is assigned", () => {
    expect(evaluateAssignment(base, null, TRUST).kind).toBe("NOTHING_ASSIGNED");
  });

  it("does nothing when the assigned release is already running", () => {
    const journal = { ...base, committed: "r1", lastAssignmentSequence: 1 };
    const verdict = evaluateAssignment(journal, assignment("r1", 1), TRUST);
    expect(verdict.kind).toBe("ALREADY_CURRENT");
  });
});

describe("replay protection — the authoritative release-assignment sequence", () => {
  it("refuses an assignment whose sequence is older than the accepted one", () => {
    const journal = { ...base, lastAssignmentSequence: 5 };
    const verdict = evaluateAssignment(journal, assignment("r-old", 4), TRUST);
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_STALE" });
  });

  it("accepts the SAME sequence again — a re-poll is not a replay", () => {
    const journal = { ...base, lastAssignmentSequence: 5 };
    expect(evaluateAssignment(journal, assignment("r5", 5), TRUST).kind).toBe("INSTALL");
  });

  it("records the high-water mark and never lowers it", () => {
    let journal = withAcceptedSequence(base, 7);
    expect(journal.lastAssignmentSequence).toBe(7);
    journal = withAcceptedSequence(journal, 3);
    expect(journal.lastAssignmentSequence).toBe(7);
    journal = withAcceptedSequence(journal, 9);
    expect(journal.lastAssignmentSequence).toBe(9);
  });
});

describe("downgrade", () => {
  // The second, independent line: a device's own memory of what it has already
  // installed, which holds even if the cloud sequence were rewound by a restore.
  it("refuses a release this device has already installed and moved past", () => {
    const journal = { ...base, supersededReleaseIds: ["r1"], lastAssignmentSequence: 1 };
    const verdict = evaluateAssignment(journal, assignment("r1", 1), TRUST);
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_SUPERSEDED" });
  });

  it("ALLOWS a governed downgrade — an older VERSION under a newer sequence", () => {
    // The case that must keep working: the owner deliberately assigns 1.0.0
    // after 1.1.0 was running. Assigning it creates a NEW device_installations
    // row, so it arrives with a HIGHER sequence. Version is never compared.
    const journal = {
      ...base,
      committed: "r-new",
      supersededReleaseIds: ["r-older-still"],
      lastAssignmentSequence: 4,
    };
    const verdict = evaluateAssignment(journal, assignment("r-rollforward", 5, "1.0.0"), TRUST);
    expect(verdict.kind).toBe("INSTALL");
  });
});

describe("rollback interaction", () => {
  it("refuses automatic retry of a release that failed its health gate", () => {
    const journal = { ...base, failedRolledBackReleaseIds: ["r2"] };
    const verdict = evaluateAssignment(journal, assignment("r2", 3), TRUST);
    expect(verdict).toMatchObject({
      kind: "REFUSED",
      code: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK",
    });
  });

  it("reports the rollback block even when the sequence is newer", () => {
    const journal = { ...base, failedRolledBackReleaseIds: ["r2"], lastAssignmentSequence: 1 };
    const verdict = evaluateAssignment(journal, assignment("r2", 99), TRUST);
    expect(verdict).toMatchObject({
      kind: "REFUSED",
      code: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK",
    });
  });

  it("a DIFFERENT release after a rollback installs normally", () => {
    const journal = { ...base, failedRolledBackReleaseIds: ["r2"] };
    expect(evaluateAssignment(journal, assignment("r3", 4), TRUST).kind).toBe("INSTALL");
  });
});

describe("malformed assignments", () => {
  it("refuses an assignment with no release id", () => {
    const verdict = evaluateAssignment(base, { ...assignment("r1", 1), releaseId: "" }, TRUST);
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_MALFORMED" });
  });

  it("refuses a sequence below one", () => {
    const verdict = evaluateAssignment(base, assignment("r1", 0), TRUST);
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_MALFORMED" });
  });

  it("refuses a non-integer sequence", () => {
    const verdict = evaluateAssignment(
      base,
      { ...assignment("r1", 1), assignmentSequence: 1.5 },
      TRUST,
    );
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_MALFORMED" });
  });

  it("refuses an assignment whose manifest names a different release", () => {
    const verdict = evaluateAssignment(
      base,
      { ...assignment("r1", 1), manifest: manifest("r2") },
      TRUST,
    );
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_RELEASE_ID_MISMATCH" });
  });
});

/**
 * The attacks group 0222 exists to stop. Before it, `assignmentSequence` arrived
 * over plain HTTP with nothing binding it to anything, and the device wrote it
 * to a DURABLE journal.
 */
describe("a transport cannot choose the sequence (group 0222)", () => {
  it("POISONING: a forged high sequence on a genuine old release is refused", () => {
    // The release and its manifest signature are entirely genuine — this is a
    // real release the publisher signed. Only the SEQUENCE is forged, and the
    // assignment signature no longer covers the forged value.
    const genuine = assignment("r-old", 5, "1.0.0");
    const forged: ReleaseAssignment = { ...genuine, assignmentSequence: 999_999 };

    const verdict = evaluateAssignment(base, forged, TRUST);

    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
    // And the high-water mark is untouched, which is the durable damage the
    // whole mechanism exists to prevent.
    expect(base.lastAssignmentSequence).toBeNull();
  });

  it("MISDIRECTION: an assignment minted for another device is refused", () => {
    const forAnotherBoard = assignment("r1", 1);
    const binding = {
      assignmentId: "inst-other",
      deviceId: "11111111-2222-3333-4444-555555555555",
      releaseId: "r1",
      assignmentSequence: 1,
      environment: "development",
    };
    const properlySignedForSomebodyElse: ReleaseAssignment = {
      ...forAnotherBoard,
      ...binding,
      assignmentEnvelope: signBinding(binding),
    };

    // The signature is VALID — it just is not about this device.
    const verdict = evaluateAssignment(base, properlySignedForSomebodyElse, TRUST);
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_NOT_FOR_THIS_DEVICE" });
  });

  it("refuses an assignment carrying no signature at all", () => {
    const unsigned: ReleaseAssignment = {
      ...assignment("r1", 1),
      assignmentEnvelope: undefined as unknown as ReleaseAssignment["assignmentEnvelope"],
    };
    expect(evaluateAssignment(base, unsigned, TRUST)).toMatchObject({
      kind: "REFUSED",
      code: "ASSIGNMENT_UNSIGNED",
    });
  });

  it("refuses a signature from a key the device does not trust", () => {
    const other = generateKeyPairSync("ed25519");
    const a = assignment("r1", 1);
    const envelope = {
      ...a.assignmentEnvelope,
      signature: Buffer.from(
        edSign(
          null,
          canonicalReleaseAssignmentBytes({
            assignmentId: a.assignmentId,
            deviceId: a.deviceId,
            releaseId: a.releaseId,
            assignmentSequence: a.assignmentSequence,
            environment: a.environment,
          }),
          other.privateKey,
        ),
      ).toString("base64"),
    };
    expect(evaluateAssignment(base, { ...a, assignmentEnvelope: envelope }, TRUST)).toMatchObject({
      kind: "REFUSED",
      code: "ASSIGNMENT_SIGNATURE_INVALID",
    });
  });

  it("refuses a revoked signing key even with a valid signature", () => {
    const verdict = evaluateAssignment(base, assignment("r1", 1), {
      deviceId: DEVICE_ID,
      trustedKeys: [{ ...TRUSTED, state: "revoked" }],
    });
    expect(verdict).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
  });

  it("refuses a swapped assignmentId, which would let one signature cover many", () => {
    const a = assignment("r1", 1);
    expect(
      evaluateAssignment(base, { ...a, assignmentId: "inst-somebody-elses" }, TRUST),
    ).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
  });

  it("refuses a swapped releaseId even when the manifest agrees with it", () => {
    // Both the manifest and the assignment name r2, but the assignment
    // signature was made over r1 — so the two signed statements disagree.
    const a = assignment("r1", 1);
    const swapped: ReleaseAssignment = { ...a, releaseId: "r2", manifest: manifest("r2") };
    expect(evaluateAssignment(base, swapped, TRUST)).toMatchObject({
      kind: "REFUSED",
      code: "ASSIGNMENT_SIGNATURE_INVALID",
    });
  });

  it("refuses when the signed assignment environment disagrees with the signed manifest", () => {
    const binding = {
      assignmentId: "inst-x",
      deviceId: DEVICE_ID,
      releaseId: "r1",
      assignmentSequence: 1,
      environment: "pilot",
    };
    const crossed: ReleaseAssignment = {
      ...binding,
      manifest: manifest("r1"), // says development
      envelope: { keyId: "k1", keyVersion: 1, algorithm: "ed25519", signature: "x" },
      assignmentEnvelope: signBinding(binding),
    };
    expect(evaluateAssignment(base, crossed, TRUST)).toMatchObject({
      kind: "REFUSED",
      code: "ASSIGNMENT_ENVIRONMENT_MISMATCH",
    });
  });

  it("DOMAIN SEPARATION: a manifest signature cannot be replayed as an assignment one", () => {
    // The same key signs both kinds of statement. The leading domain tag is what
    // keeps that safe, and this is the test that says so.
    const a = assignment("r1", 1);
    const manifestBytesSignature = Buffer.from(
      edSign(null, new TextEncoder().encode("kitluy.release-manifest.v1"), privateKey),
    ).toString("base64");
    expect(
      evaluateAssignment(
        base,
        {
          ...a,
          assignmentEnvelope: { ...a.assignmentEnvelope, signature: manifestBytesSignature },
        },
        TRUST,
      ),
    ).toMatchObject({ kind: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
  });

  it("still accepts a genuine, correctly signed assignment", () => {
    expect(evaluateAssignment(base, assignment("r1", 1), TRUST).kind).toBe("INSTALL");
  });
});
