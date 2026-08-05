/**
 * Terminal credential PROJECTION delivery — WS-11-T004-P04C1.
 *
 * Authority: the P04C owner package §15-§16; offline contract §8 (the Hub
 * persists a cloud message, verifies it, and applies only what it verified);
 * hub migration 0033 (the governed projection door); capability-census row 28
 * ("Credential delivery to Store Hub"), which P04B's LAN lifecycle matrix has
 * been READING since the transport shipped and which nothing had WRITTEN.
 *
 * THE PATH, and the ones that do not exist:
 *
 *   cloud credential authority -> SIGNED WS-10 DELIVERY -> Hub projection
 *   cloud ------------------------X---- direct DB write on the Hub
 *   terminal ---------------------X---- "here is my credential, trust it"
 *
 * The Hub never authors credential identity, the terminal, the assignment,
 * the T1-T4 profile, the Store scope, the environment or the certificate
 * status. It verifies the CLOUD's signature on a delivery and hands the facts
 * to the door, which refuses anything that contradicts what is already
 * projected. A terminal cannot deliver its own credential projection: this
 * module is reachable only from the signed cloud-to-Hub path, and the LAN
 * transport exposes no route to it.
 *
 * WHAT IS NOT REDELIVERED HERE. P04A already returns the issued PUBLIC
 * credential to the terminal at redemption, so this is not a second delivery
 * of the material to the terminal and not a second issuance — it is the HUB
 * being told, authoritatively, that a credential it will authorize against
 * exists. Those are different facts with different audiences, and collapsing
 * them would put credential truth in two places.
 *
 * NO PRIVATE MATERIAL, BY CONSTRUCTION. The payload vocabulary below is the
 * public metadata only; {@link assertNoPrivateKeyMaterial} re-checks the whole
 * delivered value before anything is applied, so a future producer that
 * attached a private key gets a refusal rather than a durable secret in the
 * inbox.
 */
import { assertNoPrivateKeyMaterial } from "@kitluy/device-identity";
import type { HubClient } from "../db.js";
import { uuidv7 } from "../uuid.js";
import { SyncDeliveryError } from "./errors.js";
import { acceptCloudMessage, recordInboxApplied, type CloudMessage } from "./inbox.js";

/** The cloud message type this module applies. */
export const CREDENTIAL_PROJECTION_MESSAGE_TYPE = "device.terminal_credential_projected" as const;

/** The only payload schema version accepted. */
export const CREDENTIAL_PROJECTION_SCHEMA_VERSION = 1 as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
const ENVIRONMENTS = ["development", "pilot", "production"] as const;
const STATUSES = ["active", "revoked", "expired", "superseded", "retired"] as const;

/**
 * The PUBLIC facts a credential projection delivery carries.
 *
 * There is deliberately no field a private key, a provisioning code, a nonce
 * or a database credential could occupy.
 */
export interface CredentialProjectionPayload {
  readonly credentialId: string;
  readonly terminalDeviceId: string;
  readonly certificateSerial: string;
  readonly publicKeyFingerprint: string;
  readonly credentialType: string;
  readonly issuer: string;
  readonly credentialStatus: (typeof STATUSES)[number];
  readonly rotationGeneration: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly environment: (typeof ENVIRONMENTS)[number];
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly storeHubDeviceId: string;
  readonly terminalProfileKey: string;
  readonly terminalAssignmentGeneration: number;
}

export type CredentialProjectionOutcome = "projected" | "duplicate_ignored" | "rejected";

export interface CredentialProjectionResult {
  readonly messageId: string;
  readonly outcome: CredentialProjectionOutcome;
  readonly projectionId?: string;
  readonly credentialId?: string;
  readonly errorCode?: string;
}

function requireString(payload: Record<string, unknown>, field: string, pattern?: RegExp): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `Credential projection payload field '${field}' is missing or malformed.`,
      { field },
    );
  }
  return value;
}

function requireGeneration(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `Credential projection payload field '${field}' must be a generation integer >= 1.`,
      { field },
    );
  }
  return value;
}

/**
 * Parse a delivery payload into the closed vocabulary above.
 *
 * Every field is validated by SHAPE here, and by RELATIONAL TRUTH in the door.
 * The split is deliberate: a malformed payload is a durable schema rejection
 * (the cloud sent nonsense and retrying sends the same nonsense), while a
 * contradicted fact is the door's refusal against what this Hub already holds.
 */
export function parseCredentialProjectionPayload(
  payload: Readonly<Record<string, unknown>>,
): CredentialProjectionPayload {
  assertNoPrivateKeyMaterial(payload, "delivery.payload");
  const record = payload as Record<string, unknown>;

  const environment = requireString(record, "environment");
  if (!(ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `Credential projection environment '${environment}' is not a trust environment.`,
      { field: "environment" },
    );
  }
  const credentialStatus = requireString(record, "credentialStatus");
  if (!(STATUSES as readonly string[]).includes(credentialStatus)) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `Credential projection status '${credentialStatus}' is not recognised.`,
      { field: "credentialStatus" },
    );
  }

  return {
    credentialId: requireString(record, "credentialId", UUID),
    terminalDeviceId: requireString(record, "terminalDeviceId", UUID),
    certificateSerial: requireString(record, "certificateSerial"),
    publicKeyFingerprint: requireString(record, "publicKeyFingerprint", HEX64),
    credentialType: requireString(record, "credentialType"),
    issuer: requireString(record, "issuer"),
    credentialStatus: credentialStatus as CredentialProjectionPayload["credentialStatus"],
    rotationGeneration: requireGeneration(record, "rotationGeneration"),
    issuedAt: requireString(record, "issuedAt"),
    expiresAt: requireString(record, "expiresAt"),
    environment: environment as CredentialProjectionPayload["environment"],
    tenantId: requireString(record, "tenantId", UUID),
    digitalStoreId: requireString(record, "digitalStoreId", UUID),
    locationId: requireString(record, "locationId", UUID),
    storeHubDeviceId: requireString(record, "storeHubDeviceId", UUID),
    terminalProfileKey: requireString(record, "terminalProfileKey", PROFILE),
    terminalAssignmentGeneration: requireGeneration(record, "terminalAssignmentGeneration"),
  };
}

interface ProjectionRow {
  readonly id: string;
  readonly credential_id: string;
  readonly outcome: string;
}

/**
 * Apply ONE signed credential-projection delivery.
 *
 * The order is the contract, and it is the inbox's order (offline §8):
 *   1. the message is persisted and its signature verified BEFORE anything is
 *      applied. An unverifiable delivery is recorded as `rejected` with its
 *      body intact, so the refusal is auditable rather than a silent drop;
 *   2. a redelivered message returns its ORIGINAL result — the delivery is
 *      answered with what happened the first time, never recomputed;
 *   3. only then does the governed door see the facts, and the door is the
 *      one that decides whether they may move this Hub's projection.
 *
 * Everything runs in the CALLER's transaction, so the inbox row, the
 * projections and the evidence commit together or not at all.
 */
export async function applyCredentialProjectionDelivery(
  client: HubClient,
  message: CloudMessage,
  verify: (message: CloudMessage) => boolean,
  correlationId: string,
  now: Date = new Date(),
): Promise<CredentialProjectionResult> {
  if (message.messageType !== CREDENTIAL_PROJECTION_MESSAGE_TYPE) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `applyCredentialProjectionDelivery received message type '${message.messageType}'.`,
      { messageType: message.messageType },
    );
  }
  if (message.schemaVersion !== CREDENTIAL_PROJECTION_SCHEMA_VERSION) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCHEMA",
      `Credential projection schema version ${message.schemaVersion} is not ${CREDENTIAL_PROJECTION_SCHEMA_VERSION}.`,
      { schemaVersion: message.schemaVersion },
    );
  }

  const acceptance = await acceptCloudMessage(client, message, verify, now);
  if (acceptance.outcome === "rejected") {
    return {
      messageId: message.messageId,
      outcome: "rejected",
      ...(acceptance.errorCode ? { errorCode: acceptance.errorCode } : {}),
    };
  }
  if (acceptance.outcome === "duplicate") {
    const original = acceptance.originalResult ?? {};
    return {
      messageId: message.messageId,
      outcome: "duplicate_ignored",
      ...(typeof original["projectionId"] === "string"
        ? { projectionId: original["projectionId"] }
        : {}),
      ...(typeof original["credentialId"] === "string"
        ? { credentialId: original["credentialId"] }
        : {}),
    };
  }

  const facts = parseCredentialProjectionPayload(message.payload);
  // The delivery envelope's scope and the payload's scope must be the SAME
  // scope. A payload that names another Store inside a correctly-scoped
  // envelope is exactly the transplant this check exists for.
  if (
    facts.tenantId !== message.tenantId ||
    facts.digitalStoreId !== message.digitalStoreId ||
    facts.locationId !== message.locationId
  ) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_SCOPE",
      "The credential projection payload names a different scope than its delivery envelope.",
      { messageId: message.messageId },
    );
  }

  const projectionId = uuidv7();
  const { rows } = await client.query<ProjectionRow>(
    `select (edge_identity.project_terminal_credential_v1(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::integer,
       $11::timestamptz, $12::timestamptz, $13, $14::uuid, $15::uuid, $16::uuid,
       $17::uuid, $18, $19::integer, $20::uuid)).*`,
    [
      projectionId,
      message.messageId,
      facts.credentialId,
      facts.terminalDeviceId,
      facts.certificateSerial,
      facts.publicKeyFingerprint,
      facts.credentialType,
      facts.issuer,
      facts.credentialStatus,
      facts.rotationGeneration,
      facts.issuedAt,
      facts.expiresAt,
      facts.environment,
      facts.tenantId,
      facts.digitalStoreId,
      facts.locationId,
      facts.storeHubDeviceId,
      facts.terminalProfileKey,
      facts.terminalAssignmentGeneration,
      correlationId,
    ],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new SyncDeliveryError(
      "EDGE_CLOUD_REJECTED_PERMANENT",
      "The credential projection door returned no row.",
      { messageId: message.messageId },
    );
  }

  const result = { projectionId: row.id, credentialId: row.credential_id };
  await recordInboxApplied(client, message.messageId, result);
  return {
    messageId: message.messageId,
    // The door returns the ORIGINAL row when the same delivery was already
    // applied, so its id differs from the one this attempt minted. That is
    // how a retried apply reports "nothing changed" truthfully.
    outcome: row.id === projectionId ? "projected" : "duplicate_ignored",
    projectionId: row.id,
    credentialId: row.credential_id,
  };
}

export interface ProjectedCredential {
  readonly credentialId: string;
  readonly terminalDeviceId: string;
  readonly certificateSerial: string;
  readonly publicKeyFingerprint: string;
  readonly status: string;
  readonly projectedAt: string;
}

/** Read-only view of what a terminal's credential projection currently says. */
export async function findProjectedCredential(
  client: HubClient,
  credentialId: string,
): Promise<ProjectedCredential | undefined> {
  const { rows } = await client.query<{
    credential_id: string;
    terminal_device_id: string;
    certificate_serial: string;
    public_key_fingerprint: string;
    status: string;
    projected_at: string;
  }>(
    `select p.credential_id, p.terminal_device_id, p.certificate_serial,
            p.public_key_fingerprint, c.status, p.projected_at::text as projected_at
       from edge_identity.credential_projection p
       join edge_identity.device_credential c on c.id = p.credential_id
      where p.credential_id = $1
      order by p.projected_at desc
      limit 1`,
    [credentialId],
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : {
        credentialId: row.credential_id,
        terminalDeviceId: row.terminal_device_id,
        certificateSerial: row.certificate_serial,
        publicKeyFingerprint: row.public_key_fingerprint,
        status: row.status,
        projectedAt: row.projected_at,
      };
}
