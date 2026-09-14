/**
 * The install sequence end to end, with real crypto, real archives and a real
 * filesystem — only the two sources, the unit restart and the clock are fakes.
 *
 * The tests that matter most here are the ones that assert what happens to the
 * RUNNING release when something goes wrong. A refusal that quietly disturbs
 * what is on screen is not a refusal, and acceptance test D checks exactly that
 * property on hardware; these are its unit-level counterpart.
 */
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArtifactSource } from "../src/release-artifact.js";
import type { AssignmentSource, ReleaseAssignment } from "../src/release-assignment.js";
import { runInstallPass, type HealthProbe, type UnitControl } from "../src/release-install.js";
import {
  U1_PERMITTED_PRODUCT,
  activeReleaseId,
  readJournal,
  releaseDir,
  storePaths,
  type StorePaths,
} from "../src/release-store.js";
import {
  canonicalReleaseAssignmentBytes,
  canonicalReleaseManifestBytes,
  type ReleaseSignatureEnvelope,
  type SignedReleaseManifestBody,
  type TrustedReleaseKey,
} from "../src/release-verify.js";

/** This device's own server record id, which the assignment signature binds. */
const DEVICE_ID = "050f9ea4-4478-48f3-8061-b30fdea04b9b";

const BLOCK = 512;

/** A minimal tar writer — enough for a payload with a package.json. */
function tar(files: ReadonlyArray<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const content = Buffer.from(file.content, "utf8");
    const header = Buffer.alloc(BLOCK);
    header.write(file.name.slice(0, 100), 0, 100, "ascii");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    const padded = Buffer.alloc(Math.ceil(content.length / BLOCK) * BLOCK);
    content.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

function payload(marker: string): Buffer {
  return gzipSync(
    tar([
      { name: "package.json", content: JSON.stringify({ main: "index.js", marker }) },
      { name: "index.js", content: `// ${marker}` },
    ]),
  );
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const TRUSTED: TrustedReleaseKey = {
  keyId: "dev-release-signing",
  keyVersion: 1,
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  state: "current",
  purpose: "release_signing",
};

const ACCEPTANCE = {
  productKey: "device-shell",
  architecture: "arm64",
  hardwareProfile: "KL-PI5-TERMINAL-DEV",
  environment: "development",
  eligibleChannels: ["internal"],
  schemaVersion: 1,
  configurationVersion: 0,
} as const;

function signedFor(
  releaseId: string,
  artifact: Buffer,
  version: string,
  overrides: Partial<SignedReleaseManifestBody> = {},
): { manifest: SignedReleaseManifestBody; envelope: ReleaseSignatureEnvelope } {
  const manifest: SignedReleaseManifestBody = {
    manifestVersion: 1,
    releaseId,
    productKey: "device-shell",
    version,
    buildId: "git-test",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: createHash("sha256").update(artifact).digest("hex"),
    artifactSizeBytes: artifact.length,
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
    ...overrides,
  };
  const envelope: ReleaseSignatureEnvelope = {
    keyId: TRUSTED.keyId,
    keyVersion: TRUSTED.keyVersion,
    algorithm: "ed25519",
    signature: Buffer.from(
      edSign(null, canonicalReleaseManifestBytes(manifest), privateKey),
    ).toString("base64"),
  };
  return { manifest, envelope };
}

function assignmentSource(assignment: ReleaseAssignment | null): AssignmentSource {
  return {
    fetchAssignment: () => Promise.resolve(assignment),
    describe: () => "test assignment source",
  };
}

function artifactSource(bytes: Buffer, touched?: { used: boolean }): ArtifactSource {
  return {
    fetchChunk: (_releaseId, offset, maxBytes) => {
      if (touched !== undefined) touched.used = true;
      if (offset >= bytes.length) return Promise.resolve(null);
      return Promise.resolve(new Uint8Array(bytes.subarray(offset, offset + maxBytes)));
    },
    describe: () => "test artifact source",
  };
}

const healthy: HealthProbe = { probe: () => Promise.resolve({ healthy: true, detail: "ok" }) };
const unhealthy: HealthProbe = {
  probe: () => Promise.resolve({ healthy: false, detail: "the shell is not running" }),
};

let root: string;
let paths: StorePaths;
let restarts: number;
let unit: UnitControl;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-install-"));
  paths = storePaths(U1_PERMITTED_PRODUCT, root);
  restarts = 0;
  unit = {
    restart: () => {
      restarts += 1;
      return Promise.resolve();
    },
  };
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The clock and sleep are injected so the 20-second gate runs instantly. */
function fastClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let clock = 0;
  return {
    now: () => clock,
    sleep: (ms: number) => {
      clock += ms;
      return Promise.resolve();
    },
  };
}

function deps(
  assignment: ReleaseAssignment | null,
  artifact: Buffer,
  health: HealthProbe = healthy,
  extra: Partial<Parameters<typeof runInstallPass>[0]> = {},
) {
  const clock = fastClock();
  return {
    paths,
    assignments: assignmentSource(assignment),
    artifacts: artifactSource(artifact),
    trustedKeys: [TRUSTED],
    deviceId: DEVICE_ID,
    acceptance: ACCEPTANCE,
    unit,
    health,
    availableBytes: () => 1_000_000_000,
    ...clock,
    ...extra,
  };
}

/** Wrap an already-signed manifest in a correctly signed assignment. */
function signedAssignment(
  releaseId: string,
  sequence: number,
  manifest: SignedReleaseManifestBody,
  envelope: ReleaseSignatureEnvelope,
  environment = "development",
) {
  const binding = {
    assignmentId: `inst-${releaseId}-${String(sequence)}`,
    deviceId: DEVICE_ID,
    releaseId,
    assignmentSequence: sequence,
    environment,
  };
  return {
    ...binding,
    manifest,
    envelope,
    assignmentEnvelope: {
      keyId: TRUSTED.keyId,
      keyVersion: TRUSTED.keyVersion,
      algorithm: "ed25519" as const,
      signature: Buffer.from(
        edSign(null, canonicalReleaseAssignmentBytes(binding), privateKey),
      ).toString("base64"),
    },
  };
}

function assignmentFor(releaseId: string, sequence: number, artifact: Buffer, version: string) {
  const { manifest, envelope } = signedFor(releaseId, artifact, version);
  const binding = {
    assignmentId: `inst-${releaseId}-${String(sequence)}`,
    deviceId: DEVICE_ID,
    releaseId,
    assignmentSequence: sequence,
    environment: "development",
  };
  return {
    ...binding,
    manifest,
    envelope,
    assignmentEnvelope: {
      keyId: TRUSTED.keyId,
      keyVersion: TRUSTED.keyVersion,
      algorithm: "ed25519" as const,
      signature: Buffer.from(
        edSign(null, canonicalReleaseAssignmentBytes(binding), privateKey),
      ).toString("base64"),
    },
  };
}

describe("the happy path", () => {
  it("installs, restarts and commits after three healthy probes", async () => {
    const artifact = payload("v2");
    const result = await runInstallPass(deps(assignmentFor("r2", 1, artifact, "0.4.12"), artifact));

    expect(result).toEqual({ outcome: "INSTALLED", releaseId: "r2", version: "0.4.12" });
    expect(activeReleaseId(paths)).toBe("r2");
    expect(restarts).toBe(1);

    const journal = readJournal(paths);
    expect(journal.phase).toBe("COMMITTED");
    expect(journal.committedVersion).toBe("0.4.12");
    expect(journal.lastAssignmentSequence).toBe(1);

    // The manifest that admitted the release travels with it.
    const recorded = JSON.parse(
      readFileSync(join(releaseDir(paths, "r2"), "manifest.json"), "utf8"),
    ) as { verifiedBy: string };
    expect(recorded.verifiedBy).toBe("dev-release-signing");
  });

  it("does nothing when nothing is assigned", async () => {
    const result = await runInstallPass(deps(null, payload("v1")));
    expect(result.outcome).toBe("NOTHING_TO_DO");
    expect(activeReleaseId(paths)).toBeNull();
  });
});

describe("acceptance scenario D — a tampered artifact never disturbs what is running", () => {
  async function installFirst(): Promise<void> {
    const artifact = payload("good");
    await runInstallPass(deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact));
    expect(activeReleaseId(paths)).toBe("r1");
  }

  it("refuses bytes that do not match the signed digest, and keeps running", async () => {
    await installFirst();
    const honest = payload("v2");
    const assignment = assignmentFor("r2", 2, honest, "0.4.12");

    // A byte is flipped WITHIN the artifact, after signing. Appending bytes
    // instead would prove nothing: the device reads exactly artifactSizeBytes
    // and never sees anything past it, so trailing junk cannot reach it. The
    // tamper that matters is one inside the range the device actually reads.
    const tampered = Buffer.from(honest);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;

    const result = await runInstallPass({
      ...deps(assignment, honest),
      artifacts: artifactSource(tampered),
    });

    expect(result).toMatchObject({ outcome: "REFUSED", code: "ARTIFACT_DIGEST_MISMATCH" });
    expect(activeReleaseId(paths)).toBe("r1");
    expect(restarts).toBe(1); // only the first install restarted anything
    expect(readJournal(paths).lastResult?.outcome).toBe("REFUSED");
  });

  it("ignores trailing bytes past the signed size rather than being confused by them", async () => {
    await installFirst();
    const honest = payload("v2");
    const assignment = assignmentFor("r2", 2, honest, "0.4.12");
    const withJunk = Buffer.concat([honest, Buffer.from("junk the device must never read")]);

    const result = await runInstallPass({
      ...deps(assignment, honest),
      artifacts: artifactSource(withJunk),
    });

    // Correct, and worth pinning: the signed size bounds the read, so a source
    // that pads the response cannot change what is installed.
    expect(result).toMatchObject({ outcome: "INSTALLED", releaseId: "r2" });
  });

  it("refuses a source that returns MORE than the chunk it was asked for", async () => {
    await installFirst();
    const honest = payload("v2");
    const assignment = assignmentFor("r2", 2, honest, "0.4.12");
    const overrunning: ArtifactSource = {
      fetchChunk: (_releaseId, offset) =>
        offset >= honest.length
          ? Promise.resolve(null)
          : // Twice what any caller could have asked for.
            Promise.resolve(new Uint8Array(Buffer.alloc(honest.length * 2, 0x41))),
      describe: () => "an overrunning source",
    };

    const result = await runInstallPass({ ...deps(assignment, honest), artifacts: overrunning });

    expect(result).toMatchObject({ outcome: "REFUSED", code: "ARTIFACT_OVERSIZED" });
    expect(activeReleaseId(paths)).toBe("r1");
  });

  it("refuses a tampered MANIFEST before fetching a single byte", async () => {
    await installFirst();
    const artifact = payload("v2");
    const assignment = assignmentFor("r2", 2, artifact, "0.4.12");
    const tamperedManifest = { ...assignment.manifest, version: "9.9.9" };
    const touched = { used: false };

    const result = await runInstallPass({
      ...deps({ ...assignment, manifest: tamperedManifest }, artifact),
      artifacts: artifactSource(artifact, touched),
    });

    expect(result).toMatchObject({ outcome: "REFUSED", code: "SIGNATURE_INVALID" });
    expect(touched.used).toBe(false);
    expect(activeReleaseId(paths)).toBe("r1");
  });

  it("refuses an archive that tries to escape, after the digest verifies", async () => {
    await installFirst();
    // A perfectly signed, digest-correct archive whose CONTENT is hostile. This
    // is the case that proves a valid signature does not waive safe extraction.
    const hostile = gzipSync(tar([{ name: "../../escaped.js", content: "x" }]));
    const assignment = assignmentFor("r2", 2, hostile, "0.4.12");

    const result = await runInstallPass(deps(assignment, hostile));

    expect(result).toMatchObject({ outcome: "REFUSED", code: "ENTRY_NAME_TRAVERSAL" });
    expect(activeReleaseId(paths)).toBe("r1");
  });
});

describe("acceptance scenario B — an unhealthy release rolls back by itself", () => {
  it("restores the previous release and blocks automatic retry", async () => {
    const first = payload("v1");
    await runInstallPass(deps(assignmentFor("r1", 1, first, "0.4.11"), first));

    const second = payload("v2");
    const result = await runInstallPass(
      deps(assignmentFor("r2", 2, second, "0.4.12"), second, unhealthy),
    );

    expect(result.outcome).toBe("ROLLED_BACK");
    expect(activeReleaseId(paths)).toBe("r1");
    const journal = readJournal(paths);
    expect(journal.failedRolledBackReleaseIds).toContain("r2");

    // And the same release is refused if it is offered again.
    const retry = await runInstallPass(deps(assignmentFor("r2", 3, second, "0.4.12"), second));
    expect(retry).toMatchObject({
      outcome: "REFUSED",
      code: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK",
    });
    expect(activeReleaseId(paths)).toBe("r1");
  });

  it("rolls back to the image copy when there is no previous release", async () => {
    const artifact = payload("v1");
    const result = await runInstallPass(
      deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact, unhealthy),
    );
    expect(result.outcome).toBe("ROLLED_BACK");
    // No previous release: `current` is removed so the launcher falls back.
    expect(activeReleaseId(paths)).toBeNull();
  });

  it("commits only after THREE consecutive successes, not the first", async () => {
    let observations = 0;
    const flaky: HealthProbe = {
      probe: () => {
        observations += 1;
        // healthy, healthy, UNHEALTHY, then healthy for ever
        return Promise.resolve(
          observations === 3
            ? { healthy: false, detail: "a blip" }
            : { healthy: true, detail: "ok" },
        );
      },
    };
    const artifact = payload("v1");
    const result = await runInstallPass(
      deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact, flaky),
    );
    expect(result.outcome).toBe("INSTALLED");
    // Two successes, a failure that resets the run, then three more.
    expect(observations).toBeGreaterThanOrEqual(6);
  });
});

describe("refusals never touch the running release", () => {
  it("refuses a full disk before staging anything", async () => {
    const artifact = payload("v1");
    const result = await runInstallPass({
      ...deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact),
      availableBytes: () => 1,
    });
    expect(result).toMatchObject({ outcome: "REFUSED", code: "INSUFFICIENT_DISK" });
    expect(activeReleaseId(paths)).toBeNull();
  });

  it("refuses a release built for another device", async () => {
    const artifact = payload("v1");
    const { manifest, envelope } = signedFor("r1", artifact, "0.4.11", {
      hardwareProfile: "SOMEBODY-ELSE",
    });
    const result = await runInstallPass(
      deps(signedAssignment("r1", 1, manifest, envelope), artifact),
    );
    expect(result).toMatchObject({ outcome: "REFUSED", code: "RELEASE_WRONG_HARDWARE_PROFILE" });
  });

  it("refuses a PILOT release offered to a development device", async () => {
    const artifact = payload("v1");
    const { manifest, envelope } = signedFor("r1", artifact, "0.4.11", { environment: "pilot" });
    // Both signed statements agree on `pilot`, so the assignment gate passes and
    // the ACCEPTANCE gate is what refuses it — which is the layer this test is
    // about. Signing the assignment as `development` instead would have been
    // refused one step earlier for a different and less interesting reason.
    const result = await runInstallPass(
      deps(signedAssignment("r1", 1, manifest, envelope, "pilot"), artifact),
    );
    expect(result).toMatchObject({ outcome: "REFUSED", code: "RELEASE_WRONG_ENVIRONMENT" });
  });

  it("refuses a signature from a key the device does not trust", async () => {
    const artifact = payload("v1");
    const assignment = assignmentFor("r1", 1, artifact, "0.4.11");
    const result = await runInstallPass({
      ...deps(assignment, artifact),
      trustedKeys: [{ ...TRUSTED, keyId: "somebody-else" }],
    });
    expect(result).toMatchObject({ outcome: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
  });

  it("refuses a revoked key even though the signature is good", async () => {
    const artifact = payload("v1");
    const assignment = assignmentFor("r1", 1, artifact, "0.4.11");
    const result = await runInstallPass({
      ...deps(assignment, artifact),
      trustedKeys: [{ ...TRUSTED, state: "revoked" }],
    });
    expect(result).toMatchObject({ outcome: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
  });

  it("refuses when the device holds no trust material at all", async () => {
    const artifact = payload("v1");
    const touched = { used: false };
    const result = await runInstallPass({
      ...deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact),
      trustedKeys: [],
      artifacts: artifactSource(artifact, touched),
    });
    expect(result).toMatchObject({ outcome: "REFUSED", code: "ASSIGNMENT_SIGNATURE_INVALID" });
    expect(touched.used).toBe(false);
  });

  it("rolls back when the unit will not restart", async () => {
    const first = payload("v1");
    await runInstallPass(deps(assignmentFor("r1", 1, first, "0.4.11"), first));
    const second = payload("v2");
    const result = await runInstallPass({
      ...deps(assignmentFor("r2", 2, second, "0.4.12"), second),
      unit: { restart: () => Promise.reject(new Error("systemctl refused")) },
    });
    expect(result.outcome).toBe("ROLLED_BACK");
    expect(activeReleaseId(paths)).toBe("r1");
  });
});

describe("resumption after a power cut", () => {
  it("resumes a health gate the journal says never finished", async () => {
    const artifact = payload("v1");
    await runInstallPass(deps(assignmentFor("r1", 1, artifact, "0.4.11"), artifact));

    // Put the journal back into HEALTH_PENDING, as a cut mid-gate would leave it.
    const { writeJournal } = await import("../src/release-store.js");
    writeJournal(paths, { ...readJournal(paths), phase: "HEALTH_PENDING", target: "r1" });

    const source = assignmentSource(null); // nothing new assigned
    const clock = fastClock();
    const result = await runInstallPass({
      paths,
      assignments: source,
      artifacts: artifactSource(artifact),
      trustedKeys: [TRUSTED],
      deviceId: DEVICE_ID,
      acceptance: ACCEPTANCE,
      unit,
      health: healthy,
      availableBytes: () => 1_000_000_000,
      ...clock,
    });

    expect(result.outcome).toBe("INSTALLED");
    expect(activeReleaseId(paths)).toBe("r1");
  });
});

describe("the assignment source is the authority, not the artifact source", () => {
  it("never asks the byte source what it has", async () => {
    const artifact = payload("v1");
    const probe = vi.fn(() => Promise.resolve(null));
    const result = await runInstallPass({
      ...deps(null, artifact),
      artifacts: { fetchChunk: probe, describe: () => "should not be called" },
    });
    expect(result.outcome).toBe("NOTHING_TO_DO");
    expect(probe).not.toHaveBeenCalled();
  });
});
