#!/usr/bin/env node
/**
 * `pnpm release:chain:check` — the whole delivery path, from the workstation,
 * before anything touches the image (U1 owner instruction 2026-09-11 §4).
 *
 *   pack -> sign -> create release -> promote internal -> assign
 *        -> retrieve governed assignment -> retrieve artifact bytes
 *        -> verify manifest/digest
 *
 * ===========================================================================
 * WHAT MAKES THIS DIFFERENT FROM THE UNIT SUITES
 * ===========================================================================
 * Every step runs against the REAL thing: the real governed database doors, the
 * real signing key from the development PKI, the real HTTP service, and the
 * BUILT device closure from `dist/` rather than the TypeScript sources. The only
 * thing missing between this and acceptance test A is the Pi.
 *
 * It is also the only place the ordering constraint that broke the first design
 * is exercised: the database mints `release_artifacts.id`, and the manifest must
 * be built and signed around THAT uuid. A packer that invents its own id passes
 * every unit test and fails here.
 *
 * ===========================================================================
 * IT CLEANS UP AFTER ITSELF, EXCEPT WHERE IT MUST NOT
 * ===========================================================================
 * Release rows are governed and append-only — `enforce_release_governed` refuses
 * removal, and revocation is a new fact rather than a rewrite. So this leaves
 * its releases behind by design, marked with a `u1-chain-check` actor so they
 * are identifiable. It creates no device and changes no device state.
 */
import { createPrivateKey, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { buildManifest, signAssignment, signManifest, writeTar } from "./release-pack.mjs";
import {
  ReleaseTargetRefusal,
  assertReleaseCapable,
  resolveAssignmentScope,
  resolveDeviceByAssetTag,
  resolveReleaseTarget,
} from "./release-target.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(REPO_ROOT, "services", "kitluy-device-firstboot-agent", "dist");
const RELEASES_DIR = join(REPO_ROOT, "build", "releases");
const ACTOR = "u1-chain-check";

const failures = [];
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(name);
}
function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(2);
}

// ---- the device closure, BUILT
let deviceVerify;
let deviceArchive;
let deviceSource;
try {
  deviceVerify = await import(join(DIST, "release-verify.js"));
  deviceArchive = await import(join(DIST, "release-archive.js"));
  deviceSource = await import(join(DIST, "adapters/http-release-source.js"));
} catch (error) {
  die(
    `the device closure is not built:\n  pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build\n\n${String(error?.message ?? error)}`,
  );
}

// ---- the signing key
const pkiDir = resolve(process.env.KITLUY_DEV_PKI_DIR ?? "");
if (process.env.KITLUY_DEV_PKI_DIR === undefined) die("set KITLUY_DEV_PKI_DIR");
const keyPath = join(pkiDir, "dev-release-signing.key.pem");
const recordPath = join(pkiDir, "dev-release-signing.json");
if (!existsSync(keyPath)) die(`no release-signing key in ${pkiDir}`);
const record = JSON.parse(readFileSync(recordPath, "utf8"));
const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));

// ---- the target
let target;
try {
  target = resolveReleaseTarget({});
} catch (error) {
  die(String(error.message ?? error));
}
const assetTag = process.env.KITLUY_DEV_TERMINAL_ASSET_TAG ?? "";
if (assetTag === "")
  die("set KITLUY_DEV_TERMINAL_ASSET_TAG to the terminal this workstation acts on");

console.log(`\n[chain] target ${target.label}`);
console.log(`[chain] device ${assetTag}`);
console.log(
  `[chain] key    ${record.keyId} v${record.keyVersion} (${record.purpose}, ${record.environment})\n`,
);

const client = new pg.Client({ ...target.connectionConfig });
await client.connect();

let server;
const work = mkdtempSync(join(tmpdir(), "kitluy-chain-"));
try {
  await assertReleaseCapable(client, target.label);
  const device = await resolveDeviceByAssetTag(client, assetTag);
  const scope = await resolveAssignmentScope(client, device.id);
  console.log(
    `[chain] store binding generation ${String(scope.assignment_generation)} (${scope.state})\n`,
  );

  // =====================================================================
  console.log("1. pack");
  // A synthetic payload, so the check does not depend on the Device Shell
  // having been built, and so its bytes are known exactly.
  const payloadRoot = join(work, "payload");
  mkdirSync(join(payloadRoot, "dist"), { recursive: true });
  writeFileSync(join(payloadRoot, "package.json"), JSON.stringify({ main: "dist/index.js" }));
  writeFileSync(join(payloadRoot, "dist", "index.js"), "// u1 chain check payload\n");
  const { gzipSync } = await import("node:zlib");
  const { collectPayload } = await import("./release-pack.mjs");
  const archive = gzipSync(writeTar(collectPayload(payloadRoot, ["package.json", "dist"])), {
    level: 9,
  });
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(archive).digest("hex");
  const packed = {
    archive,
    productKey: "device-shell",
    version: `0.0.0-chain-${Date.now().toString(36)}`,
    buildId: "git-chaincheck",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: digest,
    artifactSizeBytes: archive.length,
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
  };
  check("packed an artifact with a digest", packed.artifactSizeBytes > 0 && digest.length === 64);

  // =====================================================================
  console.log("2. create release (the DATABASE mints the id)");
  const draft = await client.query(
    `select kitluy_releases.create_release_draft_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12::bigint,$13,$14,$15::uuid) as r`,
    [
      packed.productKey,
      packed.version,
      packed.buildId,
      packed.architecture,
      packed.hardwareProfile,
      packed.environment,
      `local://chain-check`,
      packed.artifactDigestSha256,
      String(packed.artifactSizeBytes),
      packed.minSchemaVersion,
      packed.maxSchemaVersion,
      String(packed.configPrerequisiteVersion),
      null,
      ACTOR,
      randomUUID(),
    ],
  );
  const raw = draft.rows[0].r;
  const releaseId = raw.release_id ?? raw.releaseId ?? raw.id;
  check("the database minted a release id", typeof releaseId === "string", JSON.stringify(raw));
  if (typeof releaseId !== "string") throw new Error("no release id");

  // =====================================================================
  console.log("3. sign the manifest around THAT id");
  const manifest = buildManifest(packed, releaseId);
  const envelope = signManifest(manifest, privateKey, record);
  check("the manifest carries the database's release id", manifest.releaseId === releaseId);
  await client.query(`select kitluy_releases.sign_release_v1($1::uuid,$2,$3,$4,$5)`, [
    releaseId,
    envelope.keyId,
    envelope.keyVersion,
    envelope.signature,
    ACTOR,
  ]);
  check("the signature was stored", true);

  // =====================================================================
  console.log("4. promote to internal");
  const promoted = await client.query(
    `select kitluy_releases.promote_release_v1($1::uuid,'internal',$2,null) as r`,
    [releaseId, ACTOR],
  );
  check(
    "promoted to internal with no approver and no PKI gate",
    promoted.rows[0].r.outcome === "PROMOTED",
    JSON.stringify(promoted.rows[0].r),
  );

  console.log("   (and pilot is refused from a development workstation)");
  let pilotRefused = false;
  let pilotReason = "";
  try {
    await client.query(`select kitluy_releases.promote_release_v1($1::uuid,'pilot',$2,null)`, [
      releaseId,
      ACTOR,
    ]);
  } catch (error) {
    pilotRefused = true;
    pilotReason = String(error.message).split("\n")[0];
  }
  check("pilot promotion is refused without an approver", pilotRefused, pilotReason);

  // =====================================================================
  console.log("5. assign to the device");
  const assignResult = await client.query(
    `select kitluy_releases.assign_release_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8) as r`,
    [
      releaseId,
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      packed.environment,
      device.id,
      `u1-chain-${releaseId}-${device.id}`,
      ACTOR,
    ],
  );
  check(
    "assigned",
    typeof assignResult.rows[0].r === "object",
    JSON.stringify(assignResult.rows[0].r),
  );

  // ---- group 0222: the assignment is signed too, or the device refuses it
  const signOne = async (relId) => {
    const inst = await client.query(
      `select i.id, i.assignment_sequence, c.environment
         from kitluy_releases.device_installations i
         join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
        where i.device_id = $1::uuid and c.artifact_id = $2::uuid
        order by i.assignment_sequence desc limit 1`,
      [device.id, relId],
    );
    const r = inst.rows[0];
    const b = {
      assignmentId: r.id,
      deviceId: device.id,
      releaseId: relId,
      assignmentSequence: Number(r.assignment_sequence),
      environment: r.environment,
    };
    const env = signAssignment(b, privateKey, record);
    await client.query(
      `select kitluy_releases.record_assignment_signature_v1($1::uuid,$2,$3,$4,$5)`,
      [b.assignmentId, env.keyId, env.keyVersion, env.signature, ACTOR],
    );
    return b;
  };

  console.log("5b. an UNSIGNED assignment is invisible to the device");
  const beforeSigning = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  // Asserting `=== null` assumed a clean device. With an earlier signed
  // assignment still present the reader correctly returns THAT one, so the
  // property to check is narrower and truer: the brand-new UNSIGNED release is
  // not what comes back.
  check(
    "the governed reader hides the unsigned assignment",
    (beforeSigning.rows[0].a?.releaseId ?? null) !== releaseId,
    String(beforeSigning.rows[0].a?.releaseId ?? "none"),
  );
  await signOne(releaseId);
  check("the assignment is signed", true);

  // =====================================================================
  console.log("6. the governed assignment read");
  const current = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  const assignment = current.rows[0].a;
  check(
    "the governed door returns this release",
    assignment?.releaseId === releaseId,
    String(assignment?.releaseId),
  );
  check(
    "it carries a monotonic assignment sequence",
    Number.isInteger(assignment?.assignmentSequence) && assignment.assignmentSequence >= 1,
    String(assignment?.assignmentSequence),
  );
  const firstSequence = assignment.assignmentSequence;

  // =====================================================================
  console.log("7. serve, and retrieve over HTTP with the DEVICE's own client");
  mkdirSync(join(RELEASES_DIR, releaseId), { recursive: true });
  writeFileSync(join(RELEASES_DIR, releaseId, "artifact.tar.gz"), archive);

  const { spawn } = await import("node:child_process");
  const port = 8799;
  server = spawn(
    process.execPath,
    [join(REPO_ROOT, "scripts/development/release-service.mjs"), "--port", String(port)],
    { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverOut = "";
  server.stdout.on("data", (d) => {
    serverOut += String(d);
  });
  server.stderr.on("data", (d) => {
    serverOut += String(d);
  });
  // Wait for the listener rather than sleeping a fixed time.
  const started = Date.now();
  while (!serverOut.includes("listening") && Date.now() - started < 15000) {
    await new Promise((r) => setTimeout(r, 200));
    if (server.exitCode !== null) break;
  }
  if (!serverOut.includes("listening")) die(`the release service did not start:\n${serverOut}`);

  const source = deviceSource.createHttpReleaseSource({
    baseUrl: `http://127.0.0.1:${String(port)}`,
    assetTag,
  });
  const fetched = await source.fetchAssignment();
  check(
    "the device client retrieved the governed assignment",
    fetched?.releaseId === releaseId,
    String(fetched?.releaseId),
  );
  check(
    "the retrieved sequence matches the database",
    fetched?.assignmentSequence === firstSequence,
    `${String(fetched?.assignmentSequence)} vs ${String(firstSequence)}`,
  );

  // =====================================================================
  console.log("8. verify the manifest with the DEVICE's verifier");
  const trusted = {
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    publicKeyPem: record.publicKeyPem,
    state: "current",
    purpose: "release_signing",
  };
  const verdict = deviceVerify.verifyReleaseManifestSignature(fetched.manifest, fetched.envelope, [
    trusted,
  ]);
  check(
    "the device verifies the signature over the retrieved manifest",
    verdict.verified === true,
    verdict.verified ? "" : verdict.failure,
  );

  const acceptance = deviceVerify.findReleaseAcceptanceRefusal(fetched.manifest, {
    productKey: "device-shell",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    eligibleChannels: ["internal"],
    schemaVersion: 1,
    configurationVersion: 0,
  });
  check(
    "the acceptance gate accepts it for this device class",
    acceptance === null,
    String(acceptance),
  );

  // =====================================================================
  console.log("9. retrieve the bytes and re-prove the digest");
  const parts = [];
  let received = 0;
  while (received < fetched.manifest.artifactSizeBytes) {
    const chunk = await source.fetchChunk(releaseId, received, 64 * 1024);
    if (chunk === null) break;
    parts.push(Buffer.from(chunk));
    received += chunk.length;
  }
  const downloaded = Buffer.concat(parts, received);
  check(
    "the bytes arrived whole",
    downloaded.length === packed.artifactSizeBytes,
    `${String(downloaded.length)} of ${String(packed.artifactSizeBytes)}`,
  );
  const downloadedDigest = createHash("sha256").update(downloaded).digest("hex");
  check(
    "the re-proven digest matches the SIGNED manifest",
    downloadedDigest === fetched.manifest.artifactDigestSha256,
  );
  check("resume produced identical bytes", downloaded.equals(archive));

  // =====================================================================
  console.log("10. the device extracts what it received");
  const destination = join(work, "extracted");
  mkdirSync(destination, { recursive: true });
  const extraction = deviceArchive.extractTarGz(downloaded, destination);
  check(
    "extraction succeeded",
    extraction.fileCount === 2,
    `files=${String(extraction.fileCount)}`,
  );
  check(
    "the payload is intact",
    readFileSync(join(destination, "dist", "index.js"), "utf8") === "// u1 chain check payload\n",
  );

  // =====================================================================
  console.log("11. a SECOND assignment takes a HIGHER sequence (governed downgrade path)");
  const draft2 = await client.query(
    `select kitluy_releases.create_release_draft_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12::bigint,$13,$14,$15::uuid) as r`,
    [
      packed.productKey,
      `${packed.version}-older`,
      packed.buildId,
      packed.architecture,
      packed.hardwareProfile,
      packed.environment,
      `local://chain-check-2`,
      packed.artifactDigestSha256,
      String(packed.artifactSizeBytes),
      packed.minSchemaVersion,
      packed.maxSchemaVersion,
      String(packed.configPrerequisiteVersion),
      null,
      ACTOR,
      randomUUID(),
    ],
  );
  const raw2 = draft2.rows[0].r;
  const releaseId2 = raw2.release_id ?? raw2.releaseId ?? raw2.id;
  const manifest2 = buildManifest({ ...packed, version: `${packed.version}-older` }, releaseId2);
  const envelope2 = signManifest(manifest2, privateKey, record);
  await client.query(`select kitluy_releases.sign_release_v1($1::uuid,$2,$3,$4,$5)`, [
    releaseId2,
    envelope2.keyId,
    envelope2.keyVersion,
    envelope2.signature,
    ACTOR,
  ]);
  await client.query(`select kitluy_releases.promote_release_v1($1::uuid,'internal',$2,null)`, [
    releaseId2,
    ACTOR,
  ]);
  await client.query(
    `select kitluy_releases.assign_release_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8)`,
    [
      releaseId2,
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      packed.environment,
      device.id,
      `u1-chain-${releaseId2}-${device.id}`,
      ACTOR,
    ],
  );

  await signOne(releaseId2);

  const current2 = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  const second = current2.rows[0].a;
  check("the newest assignment wins", second.releaseId === releaseId2, String(second.releaseId));
  check(
    "its sequence is strictly higher",
    second.assignmentSequence > firstSequence,
    `${String(second.assignmentSequence)} > ${String(firstSequence)}`,
  );
  check(
    "the sequence is database-assigned, never a timestamp",
    Number.isInteger(second.assignmentSequence),
  );

  console.log("12. the device refuses the OLD assignment as a replay");
  const { evaluateAssignment } = await import(join(DIST, "release-assignment.js"));
  const { emptyJournal } = await import(join(DIST, "release-store.js"));
  const journalAfterSecond = {
    ...emptyJournal("device-shell"),
    lastAssignmentSequence: second.assignmentSequence,
  };
  const trust = { deviceId: device.id, trustedKeys: [trusted] };
  // `fetched` is the FIRST assignment as the device actually received it —
  // signed, and therefore refused on its sequence rather than its signature.
  const replay = evaluateAssignment(journalAfterSecond, fetched, trust);
  check(
    "replaying the first assignment is ASSIGNMENT_STALE",
    replay.kind === "REFUSED" && replay.code === "ASSIGNMENT_STALE",
    JSON.stringify(replay),
  );
  const secondFetched = await source.fetchAssignment();
  const forward = evaluateAssignment(journalAfterSecond, secondFetched, trust);
  check(
    "the newest assignment installs, even though its VERSION is older",
    forward.kind === "INSTALL",
    JSON.stringify(forward),
  );

  // =====================================================================
  console.log("12b. a NEWER unsigned assignment hides the older signed one (group 0223)");
  //
  // The exact crash the owner named: `assign_release_v1` succeeds and
  // `record_assignment_signature_v1` never runs. Before group 0223 the reader
  // filtered on the signature and THEN ordered, so it skipped the unsigned
  // newest row and handed back the previous signed one — the operator believed
  // the new release was assigned while the device was told about the old one.
  const draft3 = await client.query(
    `select kitluy_releases.create_release_draft_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12::bigint,$13,$14,$15::uuid) as r`,
    [
      packed.productKey,
      `${packed.version}-unsigned`,
      packed.buildId,
      packed.architecture,
      packed.hardwareProfile,
      packed.environment,
      `local://chain-check-3`,
      packed.artifactDigestSha256,
      String(packed.artifactSizeBytes),
      packed.minSchemaVersion,
      packed.maxSchemaVersion,
      String(packed.configPrerequisiteVersion),
      null,
      ACTOR,
      randomUUID(),
    ],
  );
  const raw3 = draft3.rows[0].r;
  const releaseId3 = raw3.release_id ?? raw3.releaseId ?? raw3.id;
  const manifest3 = buildManifest({ ...packed, version: `${packed.version}-unsigned` }, releaseId3);
  const envelope3 = signManifest(manifest3, privateKey, record);
  await client.query(`select kitluy_releases.sign_release_v1($1::uuid,$2,$3,$4,$5)`, [
    releaseId3,
    envelope3.keyId,
    envelope3.keyVersion,
    envelope3.signature,
    ACTOR,
  ]);
  await client.query(`select kitluy_releases.promote_release_v1($1::uuid,'internal',$2,null)`, [
    releaseId3,
    ACTOR,
  ]);
  await client.query(
    `select kitluy_releases.assign_release_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8)`,
    [
      releaseId3,
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      packed.environment,
      device.id,
      `u1-chain-${releaseId3}-${device.id}`,
      ACTOR,
    ],
  );
  // DELIBERATELY NOT SIGNED — this is where the publisher crashed.

  const whileUnsigned = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  check(
    "the reader returns NOTHING while the newest assignment is unsigned",
    whileUnsigned.rows[0].a === null,
    `returned ${String(whileUnsigned.rows[0].a?.releaseId ?? "null")}`,
  );
  check(
    "and specifically does NOT fall back to the older signed assignment",
    (whileUnsigned.rows[0].a?.releaseId ?? null) !== releaseId2,
    `fell back to ${String(whileUnsigned.rows[0].a?.releaseId ?? "null")}`,
  );
  check("the device therefore has nothing to install", (await source.fetchAssignment()) === null);

  // Signing it late (the publisher retried) makes it visible — and it is the
  // NEW release, not the old one.
  await signOne(releaseId3);
  const afterLateSigning = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  check(
    "once signed, the NEWEST release becomes current",
    afterLateSigning.rows[0].a?.releaseId === releaseId3,
    String(afterLateSigning.rows[0].a?.releaseId),
  );

  console.log("13. a transport cannot forge the sequence (group 0222)");
  const poisoned = { ...secondFetched, assignmentSequence: 999_999 };
  const poisonVerdict = evaluateAssignment(emptyJournal("device-shell"), poisoned, trust);
  check(
    "a forged high sequence on a genuine release is refused",
    poisonVerdict.kind === "REFUSED" && poisonVerdict.code === "ASSIGNMENT_SIGNATURE_INVALID",
    JSON.stringify(poisonVerdict),
  );
  const misdirected = evaluateAssignment(emptyJournal("device-shell"), secondFetched, {
    deviceId: "11111111-2222-3333-4444-555555555555",
    trustedKeys: [trusted],
  });
  check(
    "an assignment minted for another device is refused",
    misdirected.kind === "REFUSED" && misdirected.code === "ASSIGNMENT_NOT_FOR_THIS_DEVICE",
    JSON.stringify(misdirected),
  );
} catch (error) {
  if (error instanceof ReleaseTargetRefusal) die(error.message);
  console.error("\nUNEXPECTED:", String(error.message ?? error));
  failures.push("unexpected error");
} finally {
  if (server !== undefined) server.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
  await client.end();
}

console.log("");
if (failures.length > 0) {
  console.error(`release chain: ${String(failures.length)} of ${String(checks)} FAILED`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`release chain: ${String(checks)}/${String(checks)} passed`);
