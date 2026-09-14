#!/usr/bin/env node
/**
 * `pnpm release:pack:check` — the end-to-end proof that the workstation packer
 * and the DEVICE closure agree.
 *
 * ===========================================================================
 * WHY THIS TEST EXISTS SEPARATELY FROM THE UNIT SUITES
 * ===========================================================================
 * Every other U1 suite tests one side. This one crosses the boundary that
 * actually breaks in practice: the packer canonicalises a manifest and signs it
 * on a workstation, and the device — a different codebase, a different Node
 * version, a different machine — re-derives those bytes and verifies them. If
 * the two ever disagree by a single separator, every genuine release is refused
 * on hardware and the unit tests on both sides still pass.
 *
 * So this imports the BUILT device closure from `dist/` (not the sources), runs
 * the real signer and the real verifier, and extracts the real archive with the
 * real extractor. It is the closest thing to a hardware run that a workstation
 * can perform.
 *
 * Run it after `pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build`.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(REPO_ROOT, "services", "kitluy-device-firstboot-agent", "dist");

const failures = [];
let checks = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
    failures.push(name);
  }
}

const packer = await import(join(REPO_ROOT, "scripts", "development", "release-pack.mjs"));
let deviceVerify;
let deviceArchive;
let deviceTrust;
try {
  deviceVerify = await import(join(DIST, "release-verify.js"));
  deviceArchive = await import(join(DIST, "release-archive.js"));
  deviceTrust = await import(join(DIST, "release-trust.js"));
} catch (error) {
  console.error(
    `REFUSED: the device closure is not built. Run:\n  pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build\n\n${String(error?.message ?? error)}`,
  );
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "kitluy-pack-check-"));
try {
  // ---- a development release-signing key, shaped exactly as the dev PKI writes it
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const record = {
    kind: "kitluy.release-trust-key.v1",
    keyId: "dev-release-signing-test",
    keyVersion: 1,
    algorithm: "ed25519",
    purpose: "release_signing",
    environment: "development",
    productionEligible: false,
    state: "current",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };

  console.log("canonical bytes agree across the boundary");
  const manifest = {
    manifestVersion: 1,
    releaseId: "device-shell-0.4.12-abc123def456",
    productKey: "device-shell",
    version: "0.4.12",
    buildId: packer.buildId(),
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: "c".repeat(64),
    artifactSizeBytes: 4096,
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
  };
  const packerBytes = Buffer.from(packer.canonicalReleaseManifestBytes(manifest));
  const deviceBytes = Buffer.from(deviceVerify.canonicalReleaseManifestBytes(manifest));
  check(
    "the packer and the device produce identical canonical bytes",
    packerBytes.equals(deviceBytes),
    `packer ${packerBytes.length}B, device ${deviceBytes.length}B`,
  );

  console.log("a packed, signed release verifies on the device");
  const envelope = packer.signManifest(manifest, privateKey, record);
  const trusted = {
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    publicKeyPem: record.publicKeyPem,
    state: "current",
    purpose: "release_signing",
  };
  const verdict = deviceVerify.verifyReleaseManifestSignature(manifest, envelope, [trusted]);
  check(
    "the device verifies the packer's signature",
    verdict.verified === true,
    verdict.verified ? "" : verdict.failure,
  );

  console.log("a tampered manifest is refused");
  const tampered = { ...manifest, version: "9.9.9" };
  const tamperedVerdict = deviceVerify.verifyReleaseManifestSignature(tampered, envelope, [
    trusted,
  ]);
  check("a changed field invalidates the signature", tamperedVerdict.verified === false);

  console.log("the packer's archive extracts on the device");
  const payloadRoot = join(work, "payload-source");
  mkdirSync(join(payloadRoot, "dist"), { recursive: true });
  writeFileSync(join(payloadRoot, "package.json"), JSON.stringify({ main: "dist/index.js" }));
  writeFileSync(join(payloadRoot, "dist", "index.js"), "// payload");
  const entries = packer.collectPayload(payloadRoot, ["package.json", "dist"]);
  const { gzipSync } = await import("node:zlib");
  const archive = gzipSync(packer.writeTar(entries));
  const destination = join(work, "extracted");
  mkdirSync(destination, { recursive: true });
  const extraction = deviceArchive.extractTarGz(archive, destination);
  check(
    "the device extracts what the packer wrote",
    extraction.fileCount === 2,
    `files=${extraction.fileCount}`,
  );
  check(
    "the payload round-trips byte for byte",
    readFileSync(join(destination, "dist", "index.js"), "utf8") === "// payload",
  );

  console.log("the packer cannot produce an archive the device refuses on ownership or mode");
  // Every entry the packer writes is uid 0, gid 0, 0644/0755 and a plain file
  // or directory, by construction. Proven by extracting rather than asserted.
  check(
    "no entry is refused",
    extraction.entries.length === entries.length,
    `${extraction.entries.length} extracted of ${entries.length} packed`,
  );

  console.log("the device trust loader accepts the dev PKI record shape");
  const trustDir = join(work, "trust");
  mkdirSync(trustDir, { recursive: true });
  writeFileSync(join(trustDir, "release-signing.json"), JSON.stringify(record, null, 2));
  const registry = deviceTrust.loadReleaseTrustRegistry({ trustDir, environment: "development" });
  check(
    "the record the dev PKI writes is loadable",
    registry.keys.length === 1,
    registry.rejected.map((r) => `${r.file}:${r.refusal}`).join(","),
  );

  console.log("a wrong-purpose key is refused even though it is otherwise valid");
  const wrongPurpose = { ...record, purpose: "device_identity" };
  writeFileSync(join(trustDir, "release-signing.json"), JSON.stringify(wrongPurpose, null, 2));
  const refused = deviceTrust.loadReleaseTrustRegistry({ trustDir, environment: "development" });
  check(
    "purpose separation is enforced",
    refused.keys.length === 0 && refused.rejected[0]?.refusal === "TRUST_RECORD_WRONG_PURPOSE",
  );

  console.log("the ASSIGNMENT bytes agree across the boundary (group 0222)");
  const binding = {
    assignmentId: "018f-1111-2222",
    deviceId: "050f9ea4-4478-48f3-8061-b30fdea04b9b",
    releaseId: "018f-3333-4444",
    assignmentSequence: 42,
    environment: "development",
  };
  const packerAssignmentBytes = Buffer.from(packer.canonicalReleaseAssignmentBytes(binding));
  const deviceAssignmentBytes = Buffer.from(deviceVerify.canonicalReleaseAssignmentBytes(binding));
  check(
    "the packer and the device produce identical assignment bytes",
    packerAssignmentBytes.equals(deviceAssignmentBytes),
    `packer ${packerAssignmentBytes.length}B, device ${deviceAssignmentBytes.length}B`,
  );

  const assignmentEnvelope = packer.signAssignment(binding, privateKey, record);
  const assignmentVerdict = deviceVerify.verifyReleaseAssignmentSignature(
    binding,
    assignmentEnvelope,
    [trusted],
    binding.deviceId,
  );
  check(
    "the device verifies the publisher's assignment signature",
    assignmentVerdict.verified === true,
    assignmentVerdict.verified ? "" : assignmentVerdict.failure,
  );

  check(
    "a forged sequence breaks the assignment signature",
    deviceVerify.verifyReleaseAssignmentSignature(
      { ...binding, assignmentSequence: 999999 },
      assignmentEnvelope,
      [trusted],
      binding.deviceId,
    ).verified === false,
  );

  check(
    "an assignment for another device is refused",
    deviceVerify.verifyReleaseAssignmentSignature(
      binding,
      assignmentEnvelope,
      [trusted],
      "11111111-2222-3333-4444-555555555555",
    ).failure === "ASSIGNMENT_NOT_FOR_THIS_DEVICE",
  );

  check(
    "a MANIFEST signature cannot be replayed as an assignment signature",
    deviceVerify.verifyReleaseAssignmentSignature(binding, envelope, [trusted], binding.deviceId)
      .verified === false,
  );

  console.log("the packed archive is reproducible");
  const again = gzipSync(
    packer.writeTar(packer.collectPayload(payloadRoot, ["package.json", "dist"])),
  );
  check(
    "packing the same input twice produces identical bytes",
    Buffer.from(archive).equals(Buffer.from(again)),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("");
if (failures.length > 0) {
  console.error(`release-pack check: ${failures.length} of ${checks} FAILED`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log(`release-pack check: ${checks}/${checks} passed`);
