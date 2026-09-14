#!/usr/bin/env node
/**
 * `pnpm release:publish` — pack, sign, create, promote to internal, assign.
 *
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *   KITLUY_DEV_PKI_DIR=../../local-config/het-kitluy-project/dev-pki \
 *   pnpm release:publish --version 0.4.12 --target KL-1054DD1CCC8E
 *
 * ===========================================================================
 * THE ORDER IS FORCED BY WHO MINTS THE RELEASE ID
 * ===========================================================================
 *   1. pack                      the payload, its digest and its size
 *   2. create_release_draft_v1   the DATABASE mints release_artifacts.id (uuid)
 *   3. build the manifest        around THAT uuid
 *   4. sign                      with the development release_signing key
 *   5. sign_release_v1           the signature is stored, the manifest freezes
 *   6. promote_release_v1        -> 'internal'  (no approver, no PKI gate)
 *   7. assign_release_v1         one device, one governed idempotency key
 *
 * Steps 2 and 3 cannot be swapped. The device is handed `release_artifacts.id`
 * as the manifest's `releaseId` and checks the signature over it, so signing a
 * locally invented id produces a release every device refuses.
 *
 * ===========================================================================
 * WHAT THIS WILL NOT DO
 * ===========================================================================
 * Promote past `internal`. `promote_release_v1` applies the BLK-005 PKI gate
 * and the independent-approver rule to `pilot` and `stable`, and this tool has
 * no flag that reaches either — a development workstation is not where a pilot
 * promotion happens. Environment is `development`, channel is `internal`, and
 * both are refused by the database if they are anything else.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { buildManifest, packRelease, signAssignment, signManifest } from "./release-pack.mjs";
import {
  ReleaseTargetRefusal,
  assertReleaseCapable,
  resolveAssignmentScope,
  resolveDeviceByAssetTag,
  resolveReleaseTarget,
} from "./release-target.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    product: "device-shell",
    version: "",
    target: "",
    pkiDir: process.env.KITLUY_DEV_PKI_DIR ?? "",
    actor: process.env.USER ?? "developer",
    local: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === "--product") {
      args.product = next ?? "";
      i += 1;
    } else if (argv[i] === "--version") {
      args.version = next ?? "";
      i += 1;
    } else if (argv[i] === "--target") {
      args.target = next ?? "";
      i += 1;
    } else if (argv[i] === "--pki-dir") {
      args.pkiDir = next ?? "";
      i += 1;
    } else if (argv[i] === "--actor") {
      args.actor = next ?? "";
      i += 1;
    } else if (argv[i] === "--local") args.local = true;
  }
  if (args.version.trim() === "") die("--version is required and is never defaulted");
  if (args.target.trim() === "")
    die("--target <asset-tag> is required: a release is assigned to ONE device");
  if (args.pkiDir.trim() === "")
    die("set KITLUY_DEV_PKI_DIR or pass --pki-dir (see `pnpm pki:bootstrap-dev`)");
  return args;
}

function loadSigningKey(pkiDir) {
  const keyPath = join(pkiDir, "dev-release-signing.key.pem");
  const recordPath = join(pkiDir, "dev-release-signing.json");
  if (!existsSync(keyPath) || !existsSync(recordPath)) {
    die(`no release-signing key in ${pkiDir}. Run \`pnpm pki:bootstrap-dev --dir <new dir>\`.`);
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.purpose !== "release_signing") die(`${recordPath} declares purpose ${record.purpose}`);
  if (record.environment !== "development") die(`${recordPath} is not development material`);
  return { privateKey: createPrivateKey(readFileSync(keyPath, "utf8")), record };
}

const args = parseArgs(process.argv.slice(2));

let target;
try {
  target = resolveReleaseTarget({ local: args.local });
} catch (error) {
  die(String(error.message ?? error));
}
// PRINTED BEFORE ANYTHING HAPPENS. The D-22 lesson: the target belongs on
// screen next to the result, not inferred afterwards from which one changed.
console.log(`[release-publish] target ${target.label}`);

const { privateKey, record } = loadSigningKey(resolve(args.pkiDir));
console.log(
  `[release-publish] signing key ${record.keyId} v${record.keyVersion} (release_signing, development)`,
);

const client = new pg.Client({ ...target.connectionConfig });
await client.connect();

try {
  await assertReleaseCapable(client, target.label);

  const device = await resolveDeviceByAssetTag(client, args.target.trim());
  console.log(
    `[release-publish] device ${device.asset_tag} (${device.device_class}, ${device.lifecycle_state})`,
  );
  const scope = await resolveAssignmentScope(client, device.id);

  // ---- 1. pack
  const packed = packRelease({ product: args.product, version: args.version });
  console.log(
    `[release-publish] packed ${packed.artifactSizeBytes} bytes, sha256 ${packed.artifactDigestSha256.slice(0, 16)}…`,
  );

  const correlationId = randomUUID();

  // ---- 2. the database mints the release id
  const draft = await client.query(
    `select kitluy_releases.create_release_draft_v1(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10,$11,$12::bigint,$13,$14,$15::uuid) as r`,
    [
      packed.productKey,
      packed.version,
      packed.buildId,
      packed.architecture,
      packed.hardwareProfile,
      packed.environment,
      // artifact_file_ref: where the bytes live for this development run. The
      // device never resolves this — it asks the artifact source by release id.
      `local://build/releases/${packed.productKey}-${packed.version}/artifact.tar.gz`,
      packed.artifactDigestSha256,
      String(packed.artifactSizeBytes),
      packed.minSchemaVersion,
      packed.maxSchemaVersion,
      String(packed.configPrerequisiteVersion),
      packed.rollbackReleaseId === "" ? null : packed.rollbackReleaseId,
      args.actor,
      correlationId,
    ],
  );
  const releaseId = draft.rows[0].r.release_id ?? draft.rows[0].r.releaseId ?? draft.rows[0].r.id;
  if (typeof releaseId !== "string") {
    die(`create_release_draft_v1 returned ${JSON.stringify(draft.rows[0].r)} — no release id`);
  }
  console.log(`[release-publish] draft ${releaseId}`);

  // ---- 3 + 4. the manifest is built around the database's id, then signed
  const manifest = buildManifest(packed, releaseId);
  const envelope = signManifest(manifest, privateKey, record);

  // ---- 5. store the signature; the manifest columns freeze from here
  await client.query(`select kitluy_releases.sign_release_v1($1::uuid,$2,$3,$4,$5)`, [
    releaseId,
    envelope.keyId,
    envelope.keyVersion,
    envelope.signature,
    args.actor,
  ]);
  console.log(`[release-publish] signed`);

  // ---- 6. internal needs no approver and does not touch the BLK-005 gate
  const promoted = await client.query(
    `select kitluy_releases.promote_release_v1($1::uuid,'internal',$2,null) as r`,
    [releaseId, args.actor],
  );
  console.log(`[release-publish] promoted ${JSON.stringify(promoted.rows[0].r)}`);

  // ---- 7. assign to exactly one device
  const idempotencyKey = `u1-${releaseId}-${device.id}`;
  const assigned = await client.query(
    `select kitluy_releases.assign_release_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8) as r`,
    [
      releaseId,
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      packed.environment,
      device.id,
      idempotencyKey,
      args.actor,
    ],
  );
  console.log(`[release-publish] assigned ${JSON.stringify(assigned.rows[0].r)}`);

  // ---- 8. SIGN THE ASSIGNMENT ITSELF (group 0222)
  //
  // The manifest signature proves the release is genuine. It says nothing about
  // WHICH device this is for or WHERE it sits in the order — and the device
  // persists that sequence durably. Signing the assignment is what stops a
  // transport attaching a forged high sequence to an older genuine release and
  // permanently poisoning the device's high-water mark.
  //
  // Until this runs, `current_device_assignment_v1` deliberately returns
  // NOTHING for the device: an unsigned assignment is invisible rather than
  // refusable, so a device never sees one it is about to reject.
  const installation = await client.query(
    `select i.id, i.assignment_sequence, c.environment
       from kitluy_releases.device_installations i
       join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
      where i.device_id = $1::uuid and c.artifact_id = $2::uuid
      order by i.assignment_sequence desc limit 1`,
    [device.id, releaseId],
  );
  const installationRow = installation.rows[0];
  if (installationRow === undefined) die("no assignment row after assign_release_v1");
  const binding = {
    assignmentId: installationRow.id,
    deviceId: device.id,
    releaseId,
    assignmentSequence: Number(installationRow.assignment_sequence),
    environment: installationRow.environment,
  };
  const assignmentEnvelope = signAssignment(binding, privateKey, record);
  await client.query(
    `select kitluy_releases.record_assignment_signature_v1($1::uuid,$2,$3,$4,$5)`,
    [
      binding.assignmentId,
      assignmentEnvelope.keyId,
      assignmentEnvelope.keyVersion,
      assignmentEnvelope.signature,
      args.actor,
    ],
  );
  console.log(
    `[release-publish] assignment signed (sequence ${String(binding.assignmentSequence)})`,
  );

  // ---- what the device will actually be told, read back through the governed door
  const current = await client.query(
    `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
    [device.id],
  );
  const assignment = current.rows[0].a;
  if (assignment === null) {
    die(
      "the governed reader returned nothing after signing — the device would never see this release",
    );
  }
  console.log(`[release-publish] assignment_sequence ${String(assignment.assignmentSequence)}`);

  // The bytes stay on the workstation; `release-service.mjs` serves them.
  const outDir = join(REPO_ROOT, "build", "releases", releaseId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "artifact.tar.gz"), packed.archive);
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "envelope.json"), `${JSON.stringify(envelope, null, 2)}\n`);

  console.log("");
  console.log(`[release-publish] PUBLISHED ${manifest.productKey} ${manifest.version}`);
  console.log(`[release-publish]   release   ${releaseId}`);
  console.log(`[release-publish]   build     ${manifest.buildId}`);
  console.log(`[release-publish]   assigned  ${device.asset_tag}`);
  console.log(`[release-publish]   bytes     ${relative(REPO_ROOT, outDir)}/artifact.tar.gz`);
  console.log(`[release-publish]   serve     pnpm release:serve`);
} catch (error) {
  if (error instanceof ReleaseTargetRefusal) die(error.message);
  die(`${String(error.message ?? error)}${error.code === undefined ? "" : ` [${error.code}]`}`);
} finally {
  await client.end();
}
