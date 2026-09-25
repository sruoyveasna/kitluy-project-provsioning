/**
 * Applying a verified terminal-projection envelope to THIS Hub —
 * HUB-TERMINAL-SYNC-001 (2026-09-19).
 *
 * Everything here is what an operator did by hand between 2026-09-10 and
 * 2026-09-18, now done by the Hub itself from a delivery it verified:
 *
 *   1. project the Hub's OWN identity (`hub-provision-terminal --hub-self`):
 *      `hub_device`, `hub_assignment` and its two credentials, all read from
 *      the board, the pairing state and the operational certificate the cloud
 *      issued — nothing invented, the two manufacturing hashes still the
 *      self-describing development placeholders they always were;
 *   2. project each delivered terminal (`hub-provision-terminal --delivery`):
 *      `terminal_device` and its operational + identity credentials;
 *   3. publish the development configuration carrying EVERY live terminal's
 *      grants — only when the grant set actually changed — closing the previous
 *      grants in the same transaction (the step that was forgotten by hand on
 *      2026-09-18 and produced `PROFILE_NOT_T1` against a correct-looking Hub).
 *
 * The Hub never authors any of it. The cloud said which terminals, which
 * credentials and which profiles; the Hub's part is to hold that faithfully.
 *
 * WHAT IT REFUSES. A delivery outside this Hub's own Store scope (the pairing
 * state is the authority for "my Store"); an expired credential; a terminal
 * name that already belongs to a DIFFERENT device at this location, unless
 * that device can be retired (a re-flashed board arriving with a new identity
 * under the same asset tag — the old row is retired and renamed so the unique
 * name is free, and the new one takes it).
 */
import { X509Certificate, createHash, createPublicKey } from "node:crypto";
import type pg from "pg";

import type { VerticalKey } from "@kitluy/shared-types";

import { HUB_RUNTIME_ROLE, withHubTransaction, type HubClient } from "../db.js";
import { publishDevelopmentConfiguration } from "../dev-configuration.js";
import type { DevelopmentHmacBatchSigner } from "../sync/signing.js";
import { HEX64, TERMINAL_PROJECTION_KIND, UUID, canonicalJson } from "./contract.js";

export interface HubScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
}

/** What `--hub-self` read from the board; here read by the agent itself. */
export interface HubSelfFacts {
  readonly hubDeviceId: string;
  readonly assignmentId: string;
  readonly assignmentGeneration: number;
  readonly scope: HubScope;
  readonly boardSerial: string;
  readonly operationalCertificatePem: string;
  /** The Ed25519 device identity key's public PEM; null when unreadable. */
  readonly identityPublicKeyPem: string | null;
}

export interface TerminalDelivery {
  readonly kind: typeof TERMINAL_PROJECTION_KIND;
  readonly terminalDeviceId: string;
  readonly terminalName: string;
  readonly hardwareProfileCode: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly assignmentGeneration: number;
  readonly profileCodes: readonly string[];
  readonly seatLabel: string | null;
  readonly credentialId: string;
  readonly certificateGeneration: number;
  readonly x509CertificateSerial: string;
  readonly identityKeyFingerprint: string | null;
  readonly credentialSerialLabel: string;
  readonly publicKeyFingerprint: string;
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export type DeliveryRefusal = { readonly ok: false; readonly reason: string };

/**
 * The Laundry catalog as the cloud door projects it (group 0233; schema
 * kitluy.config.catalog.v1). Held opaque beyond the fields the Hub itself
 * needs: the schema, the currency and the content hash that gates republish.
 */
export interface CatalogSection {
  readonly schema: "kitluy.config.catalog.v1";
  readonly currency_code: string;
  readonly content_hash: string;
  readonly services: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

/** The Store's money contract (kitluy.config.money.v1) — the Hub's `pricing` section. */
export interface MoneySection {
  readonly schema: "kitluy.config.money.v1";
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly [key: string]: unknown;
}

export function parseCatalogSection(value: unknown): CatalogSection | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r["schema"] !== "kitluy.config.catalog.v1") return null;
  if (typeof r["currency_code"] !== "string" || !/^[A-Z]{3}$/u.test(r["currency_code"]))
    return null;
  if (typeof r["content_hash"] !== "string" || !HEX64.test(r["content_hash"])) return null;
  if (!Array.isArray(r["services"])) return null;
  return r as unknown as CatalogSection;
}

export function parseMoneySection(value: unknown): MoneySection | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r["schema"] !== "kitluy.config.money.v1") return null;
  if (typeof r["currency_code"] !== "string" || !/^[A-Z]{3}$/u.test(r["currency_code"]))
    return null;
  if (typeof r["currency_exponent"] !== "number" || !Number.isInteger(r["currency_exponent"]))
    return null;
  return r as unknown as MoneySection;
}

const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/u;
const NAME = /^[A-Za-z0-9 ._:-]{1,80}$/u;
const HARDWARE_PROFILE = /^[a-z0-9_.]{1,80}$/u;
const SERIAL = /^[0-9a-f]{2,80}$/u;
const LABEL = /^[A-Za-z0-9._:-]{1,120}$/u;

function str(record: Record<string, unknown>, key: string, pattern?: RegExp): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value === "") return undefined;
  if (pattern !== undefined && !pattern.test(value)) return undefined;
  return value;
}

function instant(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

/** Parse ONE terminal delivery against its closed shape. Same checks as the door script. */
export function parseTerminalDelivery(
  value: unknown,
): { readonly ok: true; readonly delivery: TerminalDelivery } | DeliveryRefusal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "delivery is not an object" };
  }
  const d = value as Record<string, unknown>;
  if (d["kind"] !== TERMINAL_PROJECTION_KIND) return { ok: false, reason: "wrong delivery kind" };
  const terminalDeviceId = str(d, "terminalDeviceId", UUID);
  const credentialId = str(d, "credentialId", UUID);
  const tenantId = str(d, "tenantId", UUID);
  const digitalStoreId = str(d, "digitalStoreId", UUID);
  const storeLocationId = str(d, "storeLocationId", UUID);
  const installationId = str(d, "installationId", UUID);
  const terminalName = str(d, "terminalName", NAME);
  const hardwareProfileCode = str(d, "hardwareProfileCode", HARDWARE_PROFILE);
  const x509CertificateSerial = str(d, "x509CertificateSerial", SERIAL);
  const credentialSerialLabel = str(d, "credentialSerialLabel", LABEL);
  const publicKeyFingerprint = str(d, "publicKeyFingerprint", HEX64);
  const issuer = str(d, "issuer");
  const issuedAt = instant(d, "issuedAt");
  const expiresAt = instant(d, "expiresAt");
  const generation = d["assignmentGeneration"];
  const certGeneration = d["certificateGeneration"];
  const profiles = d["profileCodes"];
  const identity = d["identityKeyFingerprint"];
  const seat = d["seatLabel"];

  for (const [name, present] of [
    ["terminalDeviceId", terminalDeviceId],
    ["credentialId", credentialId],
    ["tenantId", tenantId],
    ["digitalStoreId", digitalStoreId],
    ["storeLocationId", storeLocationId],
    ["installationId", installationId],
    ["terminalName", terminalName],
    ["hardwareProfileCode", hardwareProfileCode],
    ["x509CertificateSerial", x509CertificateSerial],
    ["credentialSerialLabel", credentialSerialLabel],
    ["publicKeyFingerprint", publicKeyFingerprint],
    ["issuer", issuer],
    ["issuedAt", issuedAt],
    ["expiresAt", expiresAt],
  ] as const) {
    if (present === undefined) return { ok: false, reason: `${name} is missing or malformed` };
  }
  if (typeof issuer !== "string" || issuer.length > 200) {
    return { ok: false, reason: "issuer is missing or too long" };
  }
  if (!Number.isInteger(generation) || (generation as number) < 1) {
    return { ok: false, reason: "assignmentGeneration must be a positive integer" };
  }
  if (!Number.isInteger(certGeneration) || (certGeneration as number) < 1) {
    return { ok: false, reason: "certificateGeneration must be a positive integer" };
  }
  if (!Array.isArray(profiles) || profiles.some((p) => typeof p !== "string" || !PROFILE.test(p))) {
    return { ok: false, reason: "profileCodes must be canonical dotted profiles" };
  }
  if (
    identity !== null &&
    identity !== undefined &&
    (typeof identity !== "string" || !HEX64.test(identity))
  ) {
    return { ok: false, reason: "identityKeyFingerprint is not a sha256 hex digest" };
  }
  if (seat !== null && seat !== undefined && (typeof seat !== "string" || seat.length > 120)) {
    return { ok: false, reason: "seatLabel is malformed" };
  }
  if (Date.parse(expiresAt as string) <= Date.parse(issuedAt as string)) {
    return { ok: false, reason: "the credential window is empty" };
  }
  return {
    ok: true,
    delivery: {
      kind: TERMINAL_PROJECTION_KIND,
      terminalDeviceId: (terminalDeviceId as string).toLowerCase(),
      terminalName: terminalName as string,
      hardwareProfileCode: hardwareProfileCode as string,
      installationId: (installationId as string).toLowerCase(),
      tenantId: (tenantId as string).toLowerCase(),
      digitalStoreId: (digitalStoreId as string).toLowerCase(),
      storeLocationId: (storeLocationId as string).toLowerCase(),
      assignmentGeneration: generation as number,
      profileCodes: [...new Set(profiles as string[])],
      seatLabel: typeof seat === "string" ? seat : null,
      credentialId: (credentialId as string).toLowerCase(),
      certificateGeneration: certGeneration as number,
      x509CertificateSerial: (x509CertificateSerial as string).toLowerCase(),
      identityKeyFingerprint: typeof identity === "string" ? identity : null,
      credentialSerialLabel: credentialSerialLabel as string,
      publicKeyFingerprint: publicKeyFingerprint as string,
      issuer,
      issuedAt: issuedAt as string,
      expiresAt: expiresAt as string,
    },
  };
}

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** A stable uuid from a label, exactly as the shell door derived it (md5 → uuid). */
function md5Uuid(label: string): string {
  const hex = createHash("md5").update(label).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface CertificateFacts {
  readonly serial: string;
  readonly publicKeyFingerprint: string;
  readonly issuer: string;
  readonly notBefore: string;
  readonly notAfter: string;
}

function certificateFacts(pem: string): CertificateFacts {
  const cert = new X509Certificate(pem);
  return {
    serial: cert.serialNumber.toLowerCase(),
    publicKeyFingerprint: sha256Hex(cert.publicKey.export({ type: "spki", format: "der" })),
    issuer: cert.issuer.replace(/\n/gu, ", ").slice(0, 180),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. The Hub's own projection.
// ---------------------------------------------------------------------------

/**
 * `hub_device`, `hub_assignment` and the Hub's two credentials, from what the
 * board holds. Idempotent: a re-run updates the same rows. An OLDER assignment
 * of this Hub under another id (a previous pairing) is ended, and the
 * generation comes from the pairing state rather than a hard-coded 1 (the
 * `--hub-self` defect noted in the 2026-09-11 handoff).
 */
export async function projectHubSelf(
  client: HubClient,
  facts: HubSelfFacts,
  /**
   * The Digital Store's primary vertical, as a registry key, taken from the
   * VERIFIED cloud envelope (group 0237). A separate argument rather than a
   * field of `HubSelfFacts` on purpose: `HubSelfFacts` is what the BOARD holds
   * -- its pairing state, its certificate, its serial -- and the vertical is
   * precisely the thing the board must NOT be the authority on.
   */
  primaryVertical: VerticalKey,
): Promise<{ readonly identityCredential: boolean }> {
  const cert = certificateFacts(facts.operationalCertificatePem);
  const identityFingerprint =
    facts.identityPublicKeyPem === null
      ? null
      : sha256Hex(
          createPublicKey(facts.identityPublicKeyPem).export({ type: "spki", format: "der" }),
        );

  await client.query(
    `insert into edge_identity.hub_device
       (id, asset_number, device_kind, lifecycle_status, trust_status,
        board_serial_hash, factory_duid_hash, root_key_fingerprint,
        manufacturing_cert_serial, created_at, updated_at)
     values ($1::uuid, $6, 'store_hub', 'deployed', 'trusted',
             $2, $3, $4, $5, now(), now())
     on conflict (id) do update
        set lifecycle_status = 'deployed',
            trust_status = 'trusted',
            manufacturing_cert_serial = excluded.manufacturing_cert_serial,
            updated_at = now()`,
    [
      facts.hubDeviceId,
      sha256Hex(facts.boardSerial),
      // Self-describing DEVELOPMENT placeholders, as the shell door wrote them:
      // no factory DUID and no root key exist in this development cloud.
      sha256Hex(`kitluy.development-projection.factory-duid:${facts.hubDeviceId}`),
      sha256Hex(`kitluy.development-projection.root-key:${facts.hubDeviceId}`),
      cert.serial,
      // Unique per Hub (the column is unique): a board projected by the shell
      // door keeps its 'KITLUY-DEV-HUB' — the update path leaves the number alone.
      `KITLUY-DEV-HUB-${facts.hubDeviceId.slice(0, 8)}`,
    ],
  );

  // ONE HUB IDENTITY AT A TIME, and that includes the board this volume used to
  // belong to.
  //
  // This used to end only the stale assignments of the SAME hub_device_id, which
  // left a reflashed Hub with two active rows: the old board's and its own. The
  // data volume is on the NVMe and the DEVELOPMENT-UNBOUND key is derived from
  // the board serial, so reflashing the SD card gives the Hub a NEW identity in
  // the cloud while the same database unlocks underneath it, carrying the old
  // identity's active assignment with it.
  //
  // What that cost (hardware, 2026-09-23): the Hub answered its own terminal
  // `403 PAIRING_REQUIRED`, and the pairing session it opened was bound to the
  // OLD identity at the OLD generation, so the terminal sat at "Connected to the
  // Store Hub" and could never get past it. Nothing self-heals it — the stale
  // row is active, belongs to a device that will never report again, and no
  // other statement looks at it. The Store's database had to be wiped by hand.
  //
  // A Hub database serves exactly one board: the identity in `facts` is that
  // board, so every other active assignment is by definition finished.
  await client.query(
    `update edge_identity.hub_assignment
        set status = 'ended', ended_at = now()
      where status = 'active' and id <> $1::uuid`,
    [facts.assignmentId],
  );
  // `primary_vertical_code` (migration 0044) is written on BOTH paths. Before
  // group 0237 it was written on neither, so every assignment this sync wrote
  // was NULL and `deriveEligibility` refused every terminal with
  // VERTICAL_UNAVAILABLE -- the Hub looked healthy and served nobody. Setting
  // it only on insert would have left exactly that: the 33 rows already on the
  // development Hub are UPDATE paths, and would never have healed.
  //
  // The update is unconditional, so a legitimate authoritative change (the
  // cloud is the sole author) lands on the next sync; it is idempotent, so a
  // repeated identical envelope writes the same value. Only the row the
  // envelope names is touched -- ended assignments keep the vertical they were
  // serving under, which is what a history is for.
  await client.query(
    `insert into edge_identity.hub_assignment
       (id, hub_device_id, tenant_id, digital_store_id, location_id,
        assignment_generation, assigned_at, ended_at, status, operational_cert_serial,
        primary_vertical_code)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, now(), null, 'active', $7, $8)
     on conflict (id) do update
        set ended_at = null,
            status = 'active',
            assignment_generation = excluded.assignment_generation,
            operational_cert_serial = excluded.operational_cert_serial,
            primary_vertical_code = excluded.primary_vertical_code`,
    [
      facts.assignmentId,
      facts.hubDeviceId,
      facts.scope.tenantId,
      facts.scope.digitalStoreId,
      facts.scope.storeLocationId,
      facts.assignmentGeneration,
      cert.serial,
      primaryVertical,
    ],
  );

  await upsertCredential(client, {
    id: md5Uuid(`kitluy.hub-operational-credential:${cert.serial}`),
    deviceId: facts.hubDeviceId,
    type: "operational_tls",
    fingerprint: cert.publicKeyFingerprint,
    serial: cert.serial,
    issuer: cert.issuer,
    issuedAt: cert.notBefore,
    expiresAt: cert.notAfter,
    generation: 1,
  });
  if (identityFingerprint !== null) {
    await upsertCredential(client, {
      id: md5Uuid(`kitluy.hub-identity-credential:${identityFingerprint}`),
      deviceId: facts.hubDeviceId,
      type: "device_identity",
      fingerprint: identityFingerprint,
      serial: identityFingerprint,
      issuer: cert.issuer,
      issuedAt: cert.notBefore,
      expiresAt: cert.notAfter,
      generation: 1,
    });
  }
  return { identityCredential: identityFingerprint !== null };
}

async function upsertCredential(
  client: HubClient,
  c: {
    readonly id: string;
    readonly deviceId: string;
    readonly type: "operational_tls" | "device_identity";
    readonly fingerprint: string;
    readonly serial: string;
    readonly issuer: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly generation: number;
  },
): Promise<void> {
  await client.query(
    `insert into edge_identity.device_credential
       (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
        issuer, issued_at, expires_at, status, rotation_generation)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, 'active', $9)
     on conflict (id) do update
        set certificate_serial = excluded.certificate_serial,
            public_key_fingerprint = excluded.public_key_fingerprint,
            expires_at = excluded.expires_at,
            status = 'active',
            revoked_at = null,
            revocation_reason = null`,
    [
      c.id,
      c.deviceId,
      c.type,
      c.fingerprint,
      c.serial,
      c.issuer,
      c.issuedAt,
      c.expiresAt,
      c.generation,
    ],
  );
}

// ---------------------------------------------------------------------------
// 2. One terminal.
// ---------------------------------------------------------------------------

export type TerminalProjectionAction = "projected" | "unchanged" | "refused";

export interface TerminalProjectionResult {
  readonly terminalName: string;
  readonly terminalDeviceId: string;
  readonly action: TerminalProjectionAction;
  readonly detail?: string;
  /** A same-name row of ANOTHER device that was retired to free the name. */
  readonly retiredPrevious?: string;
}

/**
 * Project one terminal into this Hub. The scope check against the Hub's own
 * pairing state is the caller's (done once per envelope); here the delivery
 * is trusted to be in scope and is written idempotently.
 */
export async function projectTerminal(
  client: HubClient,
  delivery: TerminalDelivery,
  now: Date = new Date(),
): Promise<TerminalProjectionResult> {
  const base = { terminalName: delivery.terminalName, terminalDeviceId: delivery.terminalDeviceId };
  if (Date.parse(delivery.expiresAt) <= now.getTime()) {
    return { ...base, action: "refused", detail: "the credential has expired" };
  }
  const profile = await client.query<{ id: string }>(
    `select id from edge_config.hardware_profile where profile_code = $1`,
    [delivery.hardwareProfileCode],
  );
  const hardwareProfileId = profile.rows[0]?.id;
  if (hardwareProfileId === undefined) {
    return {
      ...base,
      action: "refused",
      detail: `this Hub holds no hardware profile ${delivery.hardwareProfileCode}`,
    };
  }

  // Already held exactly like this? Then nothing to write.
  const existing = await client.query<{
    certificate_serial: string;
    assignment_generation: number;
    lifecycle_status: string;
    terminal_name: string;
  }>(
    `select certificate_serial, assignment_generation, lifecycle_status, terminal_name
       from edge_identity.terminal_device where id = $1::uuid`,
    [delivery.terminalDeviceId],
  );
  const current = existing.rows[0];
  const identityHeld =
    delivery.identityKeyFingerprint === null
      ? true
      : (
          await client.query(
            `select 1 from edge_identity.device_credential
              where device_id = $1::uuid and credential_type = 'device_identity'
                and public_key_fingerprint = $2 and status = 'active'`,
            [delivery.terminalDeviceId, delivery.identityKeyFingerprint],
          )
        ).rowCount === 1;
  if (
    current !== undefined &&
    current.certificate_serial === delivery.x509CertificateSerial &&
    current.assignment_generation === delivery.assignmentGeneration &&
    current.lifecycle_status === "active" &&
    current.terminal_name === delivery.terminalName &&
    identityHeld
  ) {
    return { ...base, action: "unchanged" };
  }

  // THE UNIQUE NAME. A re-flashed board registers a NEW identity under the
  // same asset tag; the row of the previous identity is retired and renamed so
  // the name is free. Anything else holding the name is a refusal.
  let retiredPrevious: string | undefined;
  const sameName = await client.query<{ id: string; lifecycle_status: string }>(
    `select id, lifecycle_status from edge_identity.terminal_device
      where location_id = $1::uuid and terminal_name = $2 and id <> $3::uuid`,
    [delivery.storeLocationId, delivery.terminalName, delivery.terminalDeviceId],
  );
  for (const row of sameName.rows) {
    await client.query(
      `update edge_identity.terminal_device
          set lifecycle_status = 'retired',
              terminal_name = $2,
              updated_at = now()
        where id = $1::uuid`,
      [row.id, `${delivery.terminalName}~retired-${row.id.slice(0, 8)}`],
    );
    await client.query(
      `update edge_identity.device_credential
          set status = 'superseded'
        where device_id = $1::uuid and status = 'active'`,
      [row.id],
    );
    retiredPrevious = row.id;
  }

  await client.query(
    `insert into edge_identity.terminal_device
       (id, tenant_id, digital_store_id, location_id, terminal_name, hardware_profile_id,
        installation_id, certificate_serial, assignment_generation, lifecycle_status,
        last_client_sequence, last_seen_at, created_at, updated_at)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid, $8, $9, 'active',
             0, now(), now(), now())
     on conflict (id) do update
        set certificate_serial    = excluded.certificate_serial,
            terminal_name         = excluded.terminal_name,
            assignment_generation = excluded.assignment_generation,
            lifecycle_status      = 'active',
            updated_at            = now()`,
    [
      delivery.terminalDeviceId,
      delivery.tenantId,
      delivery.digitalStoreId,
      delivery.storeLocationId,
      delivery.terminalName,
      hardwareProfileId,
      delivery.installationId,
      delivery.x509CertificateSerial,
      delivery.assignmentGeneration,
    ],
  );

  // A newer certificate generation supersedes this terminal's older
  // operational credentials; the identity credential is keyed by fingerprint.
  await client.query(
    `update edge_identity.device_credential
        set status = 'superseded'
      where device_id = $1::uuid and credential_type = 'operational_tls'
        and id <> $2::uuid and status = 'active'`,
    [delivery.terminalDeviceId, delivery.credentialId],
  );
  await upsertCredential(client, {
    id: delivery.credentialId,
    deviceId: delivery.terminalDeviceId,
    type: "operational_tls",
    fingerprint: delivery.publicKeyFingerprint,
    serial: delivery.x509CertificateSerial,
    issuer: delivery.issuer,
    issuedAt: delivery.issuedAt,
    expiresAt: delivery.expiresAt,
    generation: delivery.assignmentGeneration,
  });
  if (delivery.identityKeyFingerprint !== null) {
    await upsertCredential(client, {
      id: md5Uuid(`kitluy.terminal-identity-credential:${delivery.identityKeyFingerprint}`),
      deviceId: delivery.terminalDeviceId,
      type: "device_identity",
      fingerprint: delivery.identityKeyFingerprint,
      serial: delivery.identityKeyFingerprint,
      issuer: delivery.issuer,
      issuedAt: delivery.issuedAt,
      expiresAt: delivery.expiresAt,
      generation: delivery.assignmentGeneration,
    });
  }
  return {
    ...base,
    action: "projected",
    ...(retiredPrevious === undefined ? {} : { retiredPrevious }),
  };
}

// ---------------------------------------------------------------------------
// 3. Grants: what the ACTIVE snapshot grants now, versus what the cloud says.
// ---------------------------------------------------------------------------

export type GrantSet = ReadonlyMap<string, readonly string[]>;

/** The grants the eligibility read honours: max assignment_version, active snapshot. */
export async function readActiveGrantSet(client: HubClient, locationId: string): Promise<GrantSet> {
  const { rows } = await client.query<{ terminal_device_id: string; profile_code: string }>(
    `select tpa.terminal_device_id, tpa.profile_code
       from edge_config.terminal_profile_assignment tpa
       join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
      where tpa.location_id = $1::uuid
        and tpa.enabled
        and tpa.effective_from <= now()
        and (tpa.effective_until is null or tpa.effective_until > now())
        and cs.state = 'active'
        and tpa.assignment_version = (
          select max(x.assignment_version)
            from edge_config.terminal_profile_assignment x
            join edge_config.configuration_snapshot xs on xs.id = x.source_snapshot_id
           where x.terminal_device_id = tpa.terminal_device_id
             and x.enabled
             and x.effective_from <= now()
             and (x.effective_until is null or x.effective_until > now())
             and xs.state = 'active')`,
    [locationId],
  );
  const set = new Map<string, string[]>();
  for (const row of rows) {
    const list = set.get(row.terminal_device_id) ?? [];
    list.push(row.profile_code);
    set.set(row.terminal_device_id, list);
  }
  return new Map([...set].map(([k, v]) => [k, [...v].sort()]));
}

export function desiredGrantSet(deliveries: readonly TerminalDelivery[]): GrantSet {
  const set = new Map<string, readonly string[]>();
  for (const d of deliveries) {
    if (d.profileCodes.length > 0) set.set(d.terminalDeviceId, [...d.profileCodes].sort());
  }
  return set;
}

export function grantSetsEqual(a: GrantSet, b: GrantSet): boolean {
  if (a.size !== b.size) return false;
  for (const [terminal, profiles] of a) {
    const other = b.get(terminal);
    if (other === undefined || other.length !== profiles.length) return false;
    if (other.some((p, i) => p !== profiles[i])) return false;
  }
  return true;
}

/** The catalog hash and the pricing content the ACTIVE snapshot carries (null = none). */
export async function readActiveSections(
  client: HubClient,
  locationId: string,
): Promise<{
  readonly catalogHash: string | null;
  readonly pricing: Record<string, unknown> | null;
}> {
  const { rows } = await client.query<{
    section_code: string;
    content_json: Record<string, unknown>;
  }>(
    `select s.section_code, s.content_json
       from edge_config.configuration_section s
       join edge_config.active_configuration a on a.snapshot_id = s.snapshot_id
      where a.location_id = $1::uuid and s.section_code in ('catalog', 'pricing')`,
    [locationId],
  );
  const catalog = rows.find((r) => r.section_code === "catalog")?.content_json;
  const pricing = rows.find((r) => r.section_code === "pricing")?.content_json ?? null;
  const hash = catalog?.["content_hash"];
  return { catalogHash: typeof hash === "string" ? hash : null, pricing };
}

// ---------------------------------------------------------------------------
// The whole envelope.
// ---------------------------------------------------------------------------

export interface ApplyInput {
  readonly self: HubSelfFacts;
  /**
   * The assigned Digital Store's primary vertical (registry key), from the
   * verified envelope. Required: an envelope without one is refused before it
   * reaches this function, so there is no "apply without a vertical" path.
   */
  readonly primaryVertical: VerticalKey;
  readonly deliveries: readonly TerminalDelivery[];
  readonly environment: string;
  readonly now?: Date;
  /** The development configuration signer; the publisher's on-board key when absent. */
  readonly signer?: DevelopmentHmacBatchSigner;
  /** The catalog and money contract the cloud delivered; null = none published. */
  readonly catalog?: CatalogSection | null;
  readonly money?: MoneySection | null;
}

export interface ApplyOutcome {
  readonly hubProjected: true;
  readonly hubIdentityCredential: boolean;
  readonly terminals: readonly TerminalProjectionResult[];
  /** Terminals this Hub held as active that the cloud no longer names: retired. */
  readonly retiredAbsent: readonly string[];
  readonly configuration:
    | {
        readonly published: false;
        readonly reason: "unchanged" | "no_grants";
        readonly grantsWithdrawn?: number;
      }
    | {
        readonly published: true;
        readonly snapshotVersion: string;
        readonly grantsWritten: number;
        /** Which sections travelled with the grants, and why the publish happened. */
        readonly sections: readonly string[];
        readonly because: readonly ("grants" | "catalog" | "money")[];
      };
}

/**
 * Apply a verified envelope. Two transactions, deliberately:
 *   - projections (Hub self + every terminal) commit together;
 *   - the configuration publish is the publisher's own transaction, and is
 *     skipped entirely when the grant set is unchanged — so a quiet minute
 *     leaves no new snapshot version behind.
 * A failed publish leaves the projections in place; the next tick retries.
 */
export async function applyEnvelope(pool: pg.Pool, input: ApplyInput): Promise<ApplyOutcome> {
  const now = input.now ?? new Date();
  const scope = input.self.scope;
  // Scope, once, against the Hub's own pairing state. A delivery for another
  // Store is a refusal, never a write.
  const inScope: TerminalDelivery[] = [];
  const refusedScope: TerminalProjectionResult[] = [];
  for (const d of input.deliveries) {
    if (
      d.tenantId !== scope.tenantId ||
      d.digitalStoreId !== scope.digitalStoreId ||
      d.storeLocationId !== scope.storeLocationId
    ) {
      refusedScope.push({
        terminalName: d.terminalName,
        terminalDeviceId: d.terminalDeviceId,
        action: "refused",
        detail: "the delivery names another Store's scope",
      });
    } else {
      inScope.push(d);
    }
  }

  const projected = await withHubTransaction(
    pool,
    async (client) => {
      const self = await projectHubSelf(client, input.self, input.primaryVertical);
      const results: TerminalProjectionResult[] = [];
      for (const d of inScope) results.push(await projectTerminal(client, d, now));
      const retiredAbsent = await retireAbsentTerminals(
        client,
        scope.storeLocationId,
        inScope.map((d) => d.terminalDeviceId),
      );
      return { self, results, retiredAbsent };
    },
    HUB_RUNTIME_ROLE,
  );

  const live = inScope.filter((d) => {
    const r = projected.results.find((x) => x.terminalDeviceId === d.terminalDeviceId);
    return r !== undefined && r.action !== "refused";
  });
  const desired = desiredGrantSet(live);
  const current = await withHubTransaction(
    pool,
    (client) => readActiveGrantSet(client, scope.storeLocationId),
    HUB_RUNTIME_ROLE,
  );

  // What the ACTIVE snapshot carries today, so a quiet minute republishes nothing.
  const held = await withHubTransaction(
    pool,
    (client) => readActiveSections(client, scope.storeLocationId),
    HUB_RUNTIME_ROLE,
  );
  const catalog = input.catalog ?? null;
  const money = input.money ?? null;
  const because: ("grants" | "catalog" | "money")[] = [];
  if (!grantSetsEqual(desired, current)) because.push("grants");
  if (catalog !== null && held.catalogHash !== catalog.content_hash) because.push("catalog");
  if (money !== null && canonicalJson(held.pricing) !== canonicalJson(money)) because.push("money");

  let configuration: ApplyOutcome["configuration"];
  if (because.length === 0) {
    configuration = { published: false, reason: "unchanged" };
  } else if (desired.size === 0) {
    // Nothing to grant: withdraw what is open rather than activate an empty
    // configuration (which the publisher refuses, correctly).
    const withdrawn = await withHubTransaction(
      pool,
      async (client) => {
        const r = await client.query(
          `update edge_config.terminal_profile_assignment
              set effective_until = $2::timestamptz
            where location_id = $1::uuid and enabled and effective_until is null`,
          [scope.storeLocationId, now.toISOString()],
        );
        return r.rowCount ?? 0;
      },
      HUB_RUNTIME_ROLE,
    );
    configuration = { published: false, reason: "no_grants", grantsWithdrawn: withdrawn };
  } else {
    const extraSections = [
      ...(money === null
        ? []
        : [
            {
              sectionCode: "pricing",
              content: money as unknown as Record<string, unknown>,
              required: true,
            },
          ]),
      ...(catalog === null
        ? []
        : [
            {
              sectionCode: "catalog",
              content: catalog as unknown as Record<string, unknown>,
              required: false,
            },
          ]),
    ];
    const outcome = await publishDevelopmentConfiguration(pool, {
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      locationId: scope.storeLocationId,
      environment: input.environment,
      grants: [...desired].map(([terminalDeviceId, profileCodes]) => ({
        terminalDeviceId,
        profileCodes,
      })),
      supersedeOpenGrants: true,
      now,
      extraSections,
      ...(input.signer === undefined ? {} : { signer: input.signer }),
    });
    configuration = {
      published: true,
      snapshotVersion: outcome.snapshotVersion,
      grantsWritten: outcome.grantsWritten,
      sections: ["terminal_profiles", ...extraSections.map((x) => x.sectionCode)],
      because,
    };
  }

  return {
    hubProjected: true,
    hubIdentityCredential: projected.self.identityCredential,
    terminals: [...projected.results, ...refusedScope],
    retiredAbsent: projected.retiredAbsent,
    configuration,
  };
}

/**
 * THE CLOUD'S ANSWER IS THE LIST. A terminal this Hub still holds as `active`
 * at this location that the cloud no longer names — purged, unassigned, or
 * its credential gone — is retired and its credentials superseded, so nothing
 * on the Hub keeps a device the cloud has let go of (seen on hardware
 * 2026-09-19: `KL-1054DD1CCC8E`, purged from the cloud the day before, still
 * active on the Hub). Reversible: a terminal the cloud names again is
 * re-projected `active` by the ordinary path.
 */
async function retireAbsentTerminals(
  client: HubClient,
  locationId: string,
  deliveredIds: readonly string[],
): Promise<string[]> {
  const { rows } = await client.query<{ id: string; terminal_name: string }>(
    `update edge_identity.terminal_device
        set lifecycle_status = 'retired', updated_at = now()
      where location_id = $1::uuid
        and lifecycle_status = 'active'
        and not (id = any($2::uuid[]))
      returning id, terminal_name`,
    [locationId, deliveredIds],
  );
  for (const row of rows) {
    await client.query(
      `update edge_identity.device_credential
          set status = 'superseded'
        where device_id = $1::uuid and status = 'active'`,
      [row.id],
    );
  }
  return rows.map((r) => r.terminal_name);
}
