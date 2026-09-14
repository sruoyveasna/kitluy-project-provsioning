#!/usr/bin/env node
/**
 * DEVELOPMENT producer for the Store Hub terminal projection.
 *
 * THE CLOUD IS THE CREDENTIAL AUTHORITY, AND THIS SPEAKS FOR IT.
 *
 * A Store Hub never authors a terminal's identity. It holds a projection that
 * the cloud delivers, signed, through `edge_sync.inbox` (hub/migrations/0033).
 * The Hub-side consumer of that delivery is built and proven; the cloud-side
 * PRODUCER and its transport are not built and are blocked on BLK-006.
 *
 * Until they exist, a Hub on real hardware holds no terminals at all, and every
 * `/edge/v1` call from a genuine activated Pi Terminal is refused
 * TERMINAL_NOT_RECOGNIZED. This script is the development stand-in: it READS
 * the facts the cloud already holds about an activated terminal and prints the
 * delivery an operator hands to `hub-provision-terminal` on the Hub.
 *
 * It invents nothing. Every field below is copied from a row the cloud wrote
 * when it issued the certificate — which is exactly what makes it a stand-in
 * for a producer rather than a way around one.
 *
 * NOTHING SECRET IS PRINTED. A serial, a public-key fingerprint and a validity
 * window are public facts about a certificate; no private key, and no
 * credential that would let anything authenticate as the terminal.
 *
 * Usage:
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *     node scripts/development/hub-terminal-projection.mjs --serial DEV-XXXXXXXXXXXXXXXX
 *   ... --asset-tag KL-XXXXXXXXXXXX      (the same thing, addressed by asset tag)
 *
 * The device images register against the kitluy-fresh stack on :54372, which is
 * NOT the LOCAL_DSN default (:54392). Pass KITLUY_DEV_FLEET_DSN, or the query
 * finds nothing and says so rather than guessing.
 */
import { X509Certificate } from "node:crypto";
import pg from "pg";
import { resolveDevTarget } from "./dev-target.mjs";

const HARDWARE_PROFILE_CODE = "hw.compute.terminal";
const DELIVERY_KIND = "kitluy.hub.development-terminal-projection.v1";

function parseArgs(argv) {
  const out = { serial: null, assetTag: null, local: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--serial") out.serial = argv[(i += 1)] ?? null;
    else if (arg === "--asset-tag") out.assetTag = argv[(i += 1)] ?? null;
    else if (arg === "--local") out.local = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument '${arg}'`);
  }
  return out;
}

const QUERY = `
  select d.id                       as device_id,
         d.asset_tag,
         d.device_class,
         d.lifecycle_state,
         a.id                       as assignment_id,
         a.tenant_id,
         a.digital_store_id,
         a.store_location_id,
         a.assignment_generation,
         a.state                    as assignment_state,
         c.credential_id,
         c.serial_number,
         cert.certificate_x509_serial,
         c.public_key_fingerprint,
         c.not_before,
         c.not_after,
         c.state                    as credential_state,
         c.environment,
         cert.issuer_reference,
         cert.certificate_pem,
         (select e.device_public_key_fingerprint
            from kitluy_devices.manufacturing_enrollments e
           where e.device_id = d.id
           order by e.created_at desc, e.enrollment_sequence desc
           limit 1)                            as identity_key_fingerprint,
         (select coalesce(array_agg(r.terminal_profile_key order by r.ordinal), '{}')
            from kitluy_devices.physical_terminals pt
            join kitluy_devices.physical_terminal_roles r
              on r.physical_terminal_id = pt.id and r.removed_at is null
           where pt.bound_device_id = d.id)          as profile_keys
    from kitluy_devices.devices d
    join kitluy_devices.device_assignments a
      on a.device_id = d.id and a.state = 'active'
    join kitluy_devices.device_credentials c
      on c.device_record_id = d.id and c.revoked_at is null
    left join kitluy_devices.device_certificates cert
      on cert.credential_id = c.credential_id
   where ($1::text is null or c.serial_number = $1)
     and ($2::text is null or d.asset_tag = $2)
   order by c.certificate_generation desc
   limit 1`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {
    console.error(
      "Usage: hub-terminal-projection.mjs (--serial DEV-... | --asset-tag KL-...) [--local]",
    );
    process.exit(0);
  }
  if (args.serial === null && args.assetTag === null) {
    throw new Error(
      "REFUSED: give --serial or --asset-tag; this tool never picks a terminal for you",
    );
  }

  const target = resolveDevTarget({ local: args.local });
  console.error(`Preflight\n  target: ${target.label}`);

  const pool = new pg.Pool({ ...target.connectionConfig, max: 1 });
  let row;
  try {
    const result = await pool.query(QUERY, [args.serial, args.assetTag]);
    row = result.rows[0];
  } finally {
    await pool.end().catch(() => undefined);
  }

  if (row === undefined) {
    throw new Error(
      "REFUSED: no ACTIVE assignment with an unrevoked credential matches. " +
        "Check the terminal is activated, and that the DSN points at the stack the " +
        "device images register against (KITLUY_DEV_FLEET_DSN, usually :54372).",
    );
  }
  if (row.device_class !== "terminal") {
    throw new Error(`REFUSED: ${row.asset_tag} is a '${row.device_class}', not a terminal`);
  }
  if (row.lifecycle_state !== "active") {
    throw new Error(`REFUSED: ${row.asset_tag} is '${row.lifecycle_state}', not active`);
  }
  if (new Date(row.not_after).getTime() <= Date.now()) {
    throw new Error(`REFUSED: the credential expired at ${new Date(row.not_after).toISOString()}`);
  }
  // THE SERIAL COMES FROM THE CERTIFICATE, NOT FROM THE COLUMN.
  //
  // `certificate_x509_serial` stores the DER integer bytes, and DER pads a
  // positive integer with a leading 0x00 whenever its high bit is set. So a
  // certificate whose serial begins 0x8F is stored as `008fc0600ad6a2b60c`
  // while OpenSSL, Node and therefore the HUB all render it `8fc0600ad6a2b60c`.
  // Projecting the padded form writes a row that looks right and matches
  // nothing, and the terminal is refused TERMINAL_NOT_RECOGNIZED.
  //
  // This bites on roughly half of all serials — the ones whose first byte is
  // >= 0x80 — which is why it passed on 2026-09-10 (serial began 0x3F) and
  // failed on 2026-09-11 (0x8F). Reading the certificate removes the guesswork:
  // `X509Certificate.serialNumber` is the same value `normalizeHex(peerCert
  // .serialNumber)` produces on the Hub.
  let x509Serial;
  if (
    typeof row.certificate_pem === "string" &&
    row.certificate_pem.includes("BEGIN CERTIFICATE")
  ) {
    x509Serial = new X509Certificate(row.certificate_pem).serialNumber.toLowerCase();
  } else if (
    typeof row.certificate_x509_serial === "string" &&
    row.certificate_x509_serial !== ""
  ) {
    // No PEM to read: strip the DER pad by hand, and say so.
    x509Serial = row.certificate_x509_serial.toLowerCase().replace(/^00(?=[89a-f])/, "");
    console.error(`  note: no certificate PEM stored; serial de-padded from the column`);
  } else {
    throw new Error(
      "REFUSED: the cloud holds neither a certificate nor an X.509 serial for this credential. " +
        "That serial is the only thing the Hub sees during the TLS handshake; without it a " +
        "projection matches nothing.",
    );
  }

  // The terminal's own ACTIVE assignment id stands in for the installation.
  // `edge_identity.terminal_device.installation_id` has no foreign key and the
  // cloud has no installation row for a terminal; the assignment is the stable,
  // Store-scoped identifier of "this terminal, in this place, this time round",
  // which is what the field is for. The BLK-006 delivery will carry the real one.
  const delivery = {
    kind: DELIVERY_KIND,
    producedAt: new Date().toISOString(),
    terminalDeviceId: row.device_id,
    terminalName: row.asset_tag,
    hardwareProfileCode: HARDWARE_PROFILE_CODE,
    installationId: row.assignment_id,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.store_location_id,
    assignmentGeneration: row.assignment_generation,
    // The profiles the Partner granted this terminal, in their own order. The
    // Hub will not pair a terminal into a profile it holds no ACTIVE, SIGNED
    // configuration grant for, so these travel with the projection even though
    // applying them needs the configuration plane the delivery signer gates.
    profileCodes: row.profile_keys ?? [],
    credentialId: row.credential_id,
    // THE X.509 SERIAL, NOT THE KITLUY ONE, AND THE DIFFERENCE IS LOAD-BEARING.
    //
    // The Hub identifies a peer by what it observes during the TLS handshake:
    // `normalizeHex(peerCertificate.serialNumber)` — the certificate's own
    // serial, colons stripped, lowercased (hub/edge/transport.ts). The KitLuy
    // label `DEV-3F8BAE6ECD675D48` never appears on the wire. A projection
    // carrying the label is accepted by the database and then matches nothing,
    // so the terminal is refused TERMINAL_NOT_RECOGNIZED against a row that
    // looks correct — observed on hardware 2026-09-10.
    x509CertificateSerial: x509Serial,
    // THE KEY THE TERMINAL SIGNS ITS PAIRING PROOF WITH.
    //
    // A terminal holds two keys: the RSA operational key that carries mutual
    // TLS, and the Ed25519 device identity key that firstboot created and the
    // cloud fingerprinted at registration. The pairing transcript binds the
    // SIGNING one (hub migration 0042), so the Hub needs this fingerprint
    // projected alongside the operational credential or every pairing is
    // refused PAIR_CHALLENGE_FAILED.
    identityKeyFingerprint: row.identity_key_fingerprint ?? null,
    credentialSerialLabel: row.serial_number,
    publicKeyFingerprint: row.public_key_fingerprint,
    issuer: row.issuer_reference ?? "KitLuy Development Device Issuing CA NON-PRODUCTION",
    issuedAt: new Date(row.not_before).toISOString(),
    expiresAt: new Date(row.not_after).toISOString(),
  };

  console.error(
    `  terminal: ${row.asset_tag} (${row.device_class}, assignment generation ${row.assignment_generation})\n` +
      `  credential: ${row.serial_number} state=${row.credential_state} env=${row.environment}\n` +
      `  identity key: ${row.identity_key_fingerprint ?? "(none — pairing will be refused)"}\n` +
      `  x509 serial: ${x509Serial}${
        row.certificate_x509_serial !== x509Serial
          ? ` (column says ${row.certificate_x509_serial} — DER pad stripped)`
          : ""
      }\n` +
      `  profiles: ${(row.profile_keys ?? []).join(", ") || "(none granted)"}\n` +
      `  store: tenant ${row.tenant_id} / store ${row.digital_store_id} / location ${row.store_location_id}\n`,
  );
  console.log(JSON.stringify(delivery, null, 2));
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(2);
});
