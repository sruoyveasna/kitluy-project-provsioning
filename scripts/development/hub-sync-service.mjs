#!/usr/bin/env node
/**
 * `pnpm dev:hub-sync` — the DEVELOPMENT producer a Store Hub pulls its
 * terminal projections from (HUB-TERMINAL-SYNC-001, 2026-09-19).
 *
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *   KITLUY_DEV_PKI_DIR=../../local-config/het-kitluy-project/dev-pki \
 *   pnpm dev:hub-sync --port 8792
 *
 * ===========================================================================
 * WHAT THIS REPLACES
 * ===========================================================================
 * Until today a newly paired Pi Terminal reached its Store Hub only after a
 * person ran `hub-terminal-projection.mjs` on a workstation, carried the JSON
 * to the Hub, ran `hub-provision-terminal --delivery`, then published the
 * configuration by hand — once per terminal, every time. The owner's ruling:
 * "I am not able to ask you to do it every time like this."
 *
 * This service is the cloud half of doing it automatically. The Hub asks; this
 * answers with the same facts the hand-copy carried, read through one governed
 * door (group 0232) instead of an ad-hoc query.
 *
 * ===========================================================================
 * ONE ROUTE, TWO SIGNATURES
 * ===========================================================================
 *   POST /hub-sync/v1/terminal-projections
 *
 *   in:  a request SIGNED by the Hub's Ed25519 device identity key — the key
 *        the cloud fingerprinted when the Hub registered. Verified HERE, then
 *        the door refuses unless that fingerprint is the Hub's current sealed
 *        enrollment (group 0224 predicate). A caller with its own key signs
 *        validly and reads nothing.
 *   out: an ENVELOPE of terminal projections SIGNED by the development hub-sync
 *        delivery key (purpose `transport_signing`; KLD-2026-07-28-002 keeps it
 *        separate from the release key). The Hub verifies it against the public
 *        trust record baked into its image and applies only what verified. The
 *        envelope echoes the request nonce, so a captured answer cannot be
 *        replayed to a later request.
 *
 * Scope is never the caller's to name: the door reads the Hub's own active
 * assignment and returns only terminals assigned to that Tenant / Digital
 * Store / Store Location.
 *
 * ===========================================================================
 * DEVELOPMENT ONLY, AND IT SAYS SO
 * ===========================================================================
 * Plain HTTP on the workstation LAN. What keeps it safe is not the transport:
 * the request is signed, the answer is signed, and nothing in the answer is a
 * secret — device ids, asset tags, certificate serials, public-key fingerprints,
 * validity windows and profile lists are public facts about credentials the
 * cloud already issued. The production producer (BLK-006) replaces this file;
 * the door it reads through stays.
 */
import { createPrivateKey, createPublicKey, randomUUID, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { resolveDevTarget } from "./dev-target.mjs";
import {
  HUB_SYNC_ENVELOPE_KIND,
  HUB_SYNC_REQUEST_KIND,
  HUB_SYNC_SIGNING_PURPOSE,
  HUB_SYNC_TRUST_RECORD_KIND,
  NONCE,
  REQUEST_MAX_SKEW_SECONDS,
  SIGNATURE,
  TERMINAL_PROJECTION_KIND,
  UUID,
  hubSyncEnvelopeBytes,
  hubSyncRequestBytes,
  publicKeyFingerprint,
  signBytes,
  verifyBytes,
} from "./hub-sync-contract.mjs";

export const HUB_SYNC_ROUTE = "/hub-sync/v1/terminal-projections";
const HARDWARE_PROFILE_CODE = "hw.compute.terminal";
const MAX_BODY_BYTES = 16 * 1024;
/** The role the door is granted to; the DSN's own identity SETs it per query. */
const DOOR_ROLE = "kitluy_edge_sync_service";

function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

/** The development hub-sync delivery signer, from the dev PKI directory. */
export function loadHubSyncSigner(pkiDir) {
  const keyPath = join(pkiDir, "dev-hub-sync-signing.key.pem");
  const recordPath = join(pkiDir, "dev-hub-sync-signing.json");
  if (!existsSync(keyPath) || !existsSync(recordPath)) {
    throw new Error(
      `the development hub-sync signing key is not in ${pkiDir || "(KITLUY_DEV_PKI_DIR unset)"}; ` +
        "mint it with: node scripts/pki/bootstrap-dev-pki.mjs --dir <pki> --hub-sync-key-only",
    );
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.kind !== HUB_SYNC_TRUST_RECORD_KIND)
    throw new Error(`${recordPath} is not a hub-sync trust record`);
  if (record.purpose !== HUB_SYNC_SIGNING_PURPOSE)
    throw new Error(`${recordPath} declares purpose ${record.purpose}`);
  if (record.environment !== "development")
    throw new Error(`${recordPath} is not development material`);
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error(`${keyPath} is not an Ed25519 key`);
  // The record must describe THIS key, or the Hub would refuse every envelope.
  if (publicKeyFingerprint(record.publicKeyPem) !== record.keyId) {
    throw new Error(`${recordPath} keyId does not match its own public key`);
  }
  if (
    publicKeyFingerprint(createPublicKey(privateKey).export({ type: "spki", format: "pem" })) !==
    record.keyId
  ) {
    throw new Error(`${keyPath} is not the key ${recordPath} describes`);
  }
  return { privateKey, keyId: record.keyId, keyVersion: record.keyVersion };
}

/**
 * Parse and VERIFY a Hub's request. Returns the verified identity fingerprint
 * and hub id, or a refusal code (never echoed with the body).
 */
export function verifyHubSyncRequest(body, now = new Date()) {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { ok: false, code: "MALFORMED" };
  // The CLOSED shape: exactly these fields, nothing smuggled beside them.
  const expected = [
    "hubDeviceId",
    "identityPublicKeyPem",
    "kind",
    "nonce",
    "requestedAt",
    "signature",
  ];
  const keys = Object.keys(body).sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return { ok: false, code: "MALFORMED" };
  }
  if (body.kind !== HUB_SYNC_REQUEST_KIND) return { ok: false, code: "WRONG_KIND" };
  if (typeof body.hubDeviceId !== "string" || !UUID.test(body.hubDeviceId))
    return { ok: false, code: "MALFORMED" };
  if (typeof body.nonce !== "string" || !NONCE.test(body.nonce))
    return { ok: false, code: "MALFORMED" };
  if (typeof body.signature !== "string" || !SIGNATURE.test(body.signature))
    return { ok: false, code: "MALFORMED" };
  if (typeof body.requestedAt !== "string" || Number.isNaN(Date.parse(body.requestedAt)))
    return { ok: false, code: "MALFORMED" };
  if (typeof body.identityPublicKeyPem !== "string" || body.identityPublicKeyPem.length > 512)
    return { ok: false, code: "MALFORMED" };
  if (body.identityPublicKeyPem.includes("PRIVATE KEY")) return { ok: false, code: "MALFORMED" };
  const skew = Math.abs(Date.parse(body.requestedAt) - now.getTime()) / 1000;
  if (skew > REQUEST_MAX_SKEW_SECONDS) return { ok: false, code: "STALE" };
  let publicKey;
  try {
    publicKey = createPublicKey(body.identityPublicKeyPem);
  } catch {
    return { ok: false, code: "MALFORMED" };
  }
  if (publicKey.asymmetricKeyType !== "ed25519") return { ok: false, code: "MALFORMED" };
  const fingerprint = publicKeyFingerprint(body.identityPublicKeyPem);
  const bytes = hubSyncRequestBytes({
    identityPublicKeyFingerprint: fingerprint,
    hubDeviceId: body.hubDeviceId,
    requestedAt: body.requestedAt,
    nonce: body.nonce,
  });
  if (!verifyBytes(publicKey, bytes, body.signature))
    return { ok: false, code: "SIGNATURE_INVALID" };
  return {
    ok: true,
    hubDeviceId: body.hubDeviceId.toLowerCase(),
    identityFingerprint: fingerprint,
    nonce: body.nonce,
  };
}

/**
 * THE X.509 SERIAL COMES FROM THE CERTIFICATE, NOT FROM THE COLUMN.
 *
 * `certificate_x509_serial` stores the DER integer bytes, and DER pads a
 * positive integer with a leading 0x00 whenever its high bit is set. The Hub
 * matches the serial it OBSERVES in the TLS handshake (`normalizeHex(peerCert
 * .serialNumber)`), which has no pad — so a projection of the padded form
 * matches nothing (hardware, 2026-09-11). Reading the certificate removes the
 * guesswork; when no PEM is stored the pad is stripped by hand.
 */
export function x509SerialOf(row) {
  if (
    typeof row.certificate_pem === "string" &&
    row.certificate_pem.includes("BEGIN CERTIFICATE")
  ) {
    return new X509Certificate(row.certificate_pem).serialNumber.toLowerCase();
  }
  if (typeof row.certificate_x509_serial === "string" && row.certificate_x509_serial !== "") {
    return row.certificate_x509_serial.toLowerCase().replace(/^00(?=[89a-f])/u, "");
  }
  return null;
}

/** One door row → the delivery `hub-provision-terminal` already understands. */
export function deliveryFromRow(row, producedAt) {
  const serial = x509SerialOf(row);
  if (serial === null) return null;
  return {
    kind: TERMINAL_PROJECTION_KIND,
    producedAt,
    terminalDeviceId: row.device_id,
    terminalName: row.asset_tag,
    hardwareProfileCode: HARDWARE_PROFILE_CODE,
    // The terminal's own ACTIVE assignment id stands in for the installation
    // (no cloud installation row exists for a terminal; the assignment is the
    // stable Store-scoped identifier of "this terminal, here, this time").
    installationId: row.assignment_id,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.store_location_id,
    assignmentGeneration: row.assignment_generation,
    profileCodes: Array.isArray(row.profile_keys) ? row.profile_keys : [],
    seatLabel: typeof row.seat_label === "string" ? row.seat_label : null,
    credentialId: row.credential_id,
    certificateGeneration: row.certificate_generation,
    x509CertificateSerial: serial,
    identityKeyFingerprint:
      typeof row.identity_key_fingerprint === "string" ? row.identity_key_fingerprint : null,
    credentialSerialLabel: row.credential_serial_label,
    publicKeyFingerprint: row.public_key_fingerprint,
    issuer: row.issuer_reference ?? "KitLuy Development Device Issuing CA NON-PRODUCTION",
    issuedAt: new Date(row.not_before).toISOString(),
    expiresAt: new Date(row.not_after).toISOString(),
  };
}

/** Read the door as the sync service role, on one connection, in one transaction. */
export async function readProjections(pool, hubDeviceId, identityFingerprint) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${DOOR_ROLE}`);
    const { rows } = await client.query(
      "select kitluy_devices.read_hub_terminal_projections_v1($1::uuid, $2) as answer",
      [hubDeviceId, identityFingerprint],
    );
    await client.query("rollback");
    return rows[0]?.answer ?? { outcome: "REFUSED", code: "NO_ANSWER" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Build and sign the envelope for a verified request and a door answer. */
export function buildSignedEnvelope(answer, nonce, signer, now = new Date()) {
  const producedAt = now.toISOString();
  const scope = answer.hub;
  const terminals = [];
  const skipped = [];
  for (const row of answer.terminals ?? []) {
    const delivery = deliveryFromRow(
      {
        ...row,
        tenant_id: scope.tenantId,
        digital_store_id: scope.digitalStoreId,
        store_location_id: scope.storeLocationId,
      },
      producedAt,
    );
    if (delivery === null) skipped.push(row.asset_tag);
    else terminals.push(delivery);
  }
  const envelope = {
    kind: HUB_SYNC_ENVELOPE_KIND,
    producedAt,
    requestNonce: nonce,
    hub: {
      deviceId: scope.deviceId,
      assetTag: scope.assetTag,
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      assignmentGeneration: scope.assignmentGeneration,
    },
    terminals,
  };
  const signature = {
    algorithm: "ed25519",
    keyId: signer.keyId,
    keyVersion: signer.keyVersion,
    value: signBytes(signer.privateKey, hubSyncEnvelopeBytes(envelope)),
  };
  return { body: { envelope, signature }, skipped };
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return { ok: false };
    chunks.push(chunk);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

export function createHubSyncHandler({ pool, signer, log = console }) {
  return async function handle(request, response) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/health")
      return json(response, 200, { status: "ok", route: HUB_SYNC_ROUTE });
    if (url.pathname !== HUB_SYNC_ROUTE) return json(response, 404, { error: "no such route" });
    if (request.method !== "POST") return json(response, 405, { error: "POST only" });
    const correlationId = randomUUID();
    const body = await readBody(request);
    if (!body.ok) return json(response, 400, { code: "VALIDATION_FAILED", correlationId });
    const verdict = verifyHubSyncRequest(body.value);
    if (!verdict.ok) {
      log.warn(`[hub-sync] refused ${verdict.code} (${correlationId})`);
      // One status for every refusal; the reason is in the log by code only.
      return json(response, 403, { code: "REFUSED", correlationId });
    }
    let answer;
    try {
      answer = await readProjections(pool, verdict.hubDeviceId, verdict.identityFingerprint);
    } catch (error) {
      log.error(
        `[hub-sync] door unavailable (${correlationId}): ${String(error.message ?? error)}`,
      );
      return json(response, 503, {
        code: "DEPENDENCY_UNAVAILABLE",
        correlationId,
        retryable: true,
      });
    }
    if (answer.outcome !== "OK") {
      log.warn(
        `[hub-sync] door refused ${answer.code} for hub ${verdict.hubDeviceId} (${correlationId})`,
      );
      return json(response, 403, { code: "REFUSED", correlationId });
    }
    const { body: signed, skipped } = buildSignedEnvelope(answer, verdict.nonce, signer);
    log.info(
      `[hub-sync] ${answer.hub.assetTag}: ${String(signed.envelope.terminals.length)} terminal(s) ` +
        `[${signed.envelope.terminals.map((t) => `${t.terminalName}:${t.profileCodes.join("+") || "-"}`).join(", ")}]` +
        (skipped.length > 0 ? ` skipped without an X.509 serial: ${skipped.join(", ")}` : "") +
        ` (${correlationId})`,
    );
    return json(response, 200, signed);
  };
}

// ---------------------------------------------------------------------------
// Entrypoint (skipped when imported by a test).
// ---------------------------------------------------------------------------
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 8792: 8787 is the fleet service, 8790 the management API, 8791 the
  // release source. Reachable and correct are different questions.
  const args = { port: 8792, local: false };
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--port") {
      args.port = Number(process.argv[i + 1]);
      i += 1;
    } else if (process.argv[i] === "--local") args.local = true;
  }
  if (!Number.isInteger(args.port) || args.port < 1024) die("--port must be an integer above 1023");

  let target;
  try {
    target = resolveDevTarget({ local: args.local });
  } catch (error) {
    die(String(error.message ?? error));
  }
  let signer;
  try {
    signer = loadHubSyncSigner(process.env.KITLUY_DEV_PKI_DIR ?? "");
  } catch (error) {
    die(String(error.message ?? error));
  }

  const pool = new pg.Pool({ ...target.connectionConfig, max: 4 });
  try {
    const probe = await pool.connect();
    try {
      const { rows } = await probe.query(
        "select count(*)::int as n from pg_proc where proname = 'read_hub_terminal_projections_v1'",
      );
      if (rows[0].n !== 1)
        die(
          `${target.label} has no group 0232 door (read_hub_terminal_projections_v1); apply the migration first`,
        );
      await probe.query("begin");
      await probe.query(`set local role ${DOOR_ROLE}`);
      await probe.query("rollback");
    } finally {
      probe.release();
    }
  } catch (error) {
    die(String(error.message ?? error));
  }

  const handler = createHubSyncHandler({ pool, signer });
  const server = createServer((request, response) => {
    handler(request, response).catch((error) => {
      console.error("[hub-sync] request failed:", String(error.message ?? error));
      if (!response.headersSent) json(response, 500, { code: "INTERNAL_ERROR" });
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE")
      die(`port ${String(args.port)} is already in use; free it or pass --port`);
    die(`the hub-sync producer could not listen: ${error.message}`);
  });
  server.listen(args.port, "0.0.0.0", () => {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
    console.log("");
    console.log("[hub-sync] DEVELOPMENT hub-sync producer — terminal projections for a Store Hub");
    console.log(`[hub-sync]   target    ${target.label}`);
    console.log(
      `[hub-sync]   signer    ${signer.keyId} v${String(signer.keyVersion)} (transport_signing, development)`,
    );
    console.log(`[hub-sync]   listening 0.0.0.0:${String(args.port)}  POST ${HUB_SYNC_ROUTE}`);
    for (const address of addresses) {
      // The value a Store Hub's /etc/kitluy/hub.env must carry.
      console.log(`[hub-sync]   HUB_SYNC_URL=http://${address}:${String(args.port)}`);
    }
    console.log("");
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}
