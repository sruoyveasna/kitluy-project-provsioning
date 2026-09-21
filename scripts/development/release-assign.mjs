#!/usr/bin/env node
/**
 * `pnpm release:assign` — assign an EXISTING promoted release to one device
 * (the over-the-air path for a terminal that already holds an older release).
 *
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *   KITLUY_DEV_PKI_DIR=../../local-config/het-kitluy-project/dev-pki \
 *   pnpm release:assign --release <uuid> --target KL-1CB3577C26A7
 *   pnpm release:assign --product kitluy-terminal --newest --target KL-1CB3577C26A7
 *
 * WHY A SEPARATE COMMAND. `release:publish` packs, signs, promotes and assigns
 * a NEW release to one target; the release service's auto-assignment covers a
 * terminal that polls with NOTHING assigned. Neither moves a second terminal
 * onto a release that already exists — that is what happened on 2026-09-21:
 * the newer board got the catalog release, the older board kept yesterday's.
 * This closes that gap the same governed way: `assign_release_v1` (one device,
 * one idempotency key) and the development release-signing key on the
 * assignment, exactly as the publisher and the service do. The device
 * verifies both the assignment signature and the artifact digest itself.
 *
 * DEVELOPMENT ONLY (dev-target.mjs); production rollout policy is
 * [REQUIRED: owner rollout policy — who approves assignments per Store].
 */
import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import pg from "pg";

import { signAssignment } from "./release-pack.mjs";
import {
  ReleaseTargetRefusal,
  assertReleaseCapable,
  resolveAssignmentScope,
  resolveDeviceByAssetTag,
  resolveReleaseTarget,
} from "./release-target.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

const args = {
  release: "",
  product: "",
  newest: false,
  target: "",
  actor: "dev-release-assign",
  local: false,
  pkiDir: process.env.KITLUY_DEV_PKI_DIR ?? "",
};
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  const next = (process.argv[i + 1] ?? "").trim();
  if (a === "--newest") args.newest = true;
  else if (a === "--local") args.local = true;
  else if (
    a === "--release" ||
    a === "--product" ||
    a === "--target" ||
    a === "--actor" ||
    a === "--pki-dir"
  ) {
    const key = a === "--pki-dir" ? "pkiDir" : a.slice(2);
    args[key] = next;
    i += 1;
  } else die(`unknown argument '${a}'`);
}
if (args.target === "")
  die("--target <asset-tag> is required: a release is assigned to ONE device");
if (args.release === "" && !(args.newest && args.product !== "")) {
  die("give --release <uuid>, or --product <key> --newest");
}
if (args.release !== "" && !UUID.test(args.release)) die("--release must be a release id (uuid)");
if (args.pkiDir === "") die("KITLUY_DEV_PKI_DIR (or --pki-dir) must name the development PKI");

function loadSigningKey(pkiDir) {
  const keyPath = join(pkiDir, "dev-release-signing.key.pem");
  const recordPath = join(pkiDir, "dev-release-signing.json");
  if (!existsSync(keyPath) || !existsSync(recordPath)) {
    die(`the development release-signing key is not in ${pkiDir}`);
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.purpose !== "release_signing") die(`${recordPath} declares purpose ${record.purpose}`);
  if (record.environment !== "development") die(`${recordPath} is not development material`);
  return { privateKey: createPrivateKey(readFileSync(keyPath, "utf8")), record };
}

let target;
try {
  target = resolveReleaseTarget({ local: args.local });
} catch (error) {
  die(String(error.message ?? error));
}
console.log(`[release-assign] target ${target.label}`);
const signer = loadSigningKey(resolve(args.pkiDir));

const client = new pg.Client({ ...target.connectionConfig });
await client.connect();
try {
  await assertReleaseCapable(client, target.label);
  const device = await resolveDeviceByAssetTag(client, args.target);
  console.log(
    `[release-assign] device ${device.asset_tag} (${device.device_class}, ${device.lifecycle_state})`,
  );
  const scope = await resolveAssignmentScope(client, device.id);
  if (scope.state !== "active")
    die(`${device.asset_tag} has no ACTIVE Store assignment (${scope.state})`);

  let release;
  if (args.release !== "") {
    const r = await client.query(
      `select id, product_key, version, environment, channel, state from kitluy_releases.release_artifacts where id = $1::uuid`,
      [args.release],
    );
    release = r.rows[0];
    if (release === undefined) die(`no release ${args.release}`);
  } else {
    const r = await client.query(
      `select id, product_key, version, environment, channel, state from kitluy_releases.release_artifacts
        where product_key = $1 and environment = 'development' and channel = 'internal' and state = 'internal'
        order by published_at desc nulls last, created_at desc limit 1`,
      [args.product],
    );
    release = r.rows[0];
    if (release === undefined) die(`no promoted internal development release for ${args.product}`);
  }
  if (release.state !== "internal" || release.channel !== "internal") {
    die(
      `release ${release.id} is ${release.state}/${release.channel}; only a promoted internal release is assigned`,
    );
  }
  if (release.environment !== "development")
    die(`release ${release.id} is ${release.environment} material`);
  console.log(`[release-assign] release ${release.id} ${release.product_key} ${release.version}`);

  await client.query("begin");
  await client.query(
    `select kitluy_releases.assign_release_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8) as r`,
    [
      release.id,
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      "development",
      device.id,
      `assign-${release.id}-${device.id}`,
      args.actor,
    ],
  );
  const installation = await client.query(
    `select i.id, i.assignment_sequence, c.environment
       from kitluy_releases.device_installations i
       join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
      where i.device_id = $1::uuid and c.artifact_id = $2::uuid
      order by i.assignment_sequence desc limit 1`,
    [device.id, release.id],
  );
  const row = installation.rows[0];
  if (row === undefined) throw new Error("no assignment row after assign_release_v1");
  const binding = {
    assignmentId: row.id,
    deviceId: device.id,
    releaseId: release.id,
    assignmentSequence: Number(row.assignment_sequence),
    environment: row.environment,
  };
  const envelope = signAssignment(binding, signer.privateKey, signer.record);
  await client.query(
    `select kitluy_releases.record_assignment_signature_v1($1::uuid,$2,$3,$4,$5)`,
    [binding.assignmentId, envelope.keyId, envelope.keyVersion, envelope.signature, args.actor],
  );
  await client.query("commit");
  const { rows } = await client.query(
    `select kitluy_releases.current_device_product_assignment_v1($1::uuid, $2) as a`,
    [device.id, release.product_key],
  );
  const current = rows[0]?.a ?? null;
  console.log(
    `[release-assign] ASSIGNED ${device.asset_tag} ${release.product_key} <- ${release.version} seq=${String(current?.assignmentSequence ?? binding.assignmentSequence)}`,
  );
  console.log(
    "[release-assign]   the device installs on its next poll (restart kitluy-update-agent to poll now)",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  if (error instanceof ReleaseTargetRefusal) die(error.message);
  die(String(error.message ?? error));
} finally {
  await client.end().catch(() => undefined);
}
