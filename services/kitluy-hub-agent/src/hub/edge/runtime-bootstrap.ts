/**
 * T1 runtime bootstrap reads and staff sessions — WS-12-T001-P02.
 *
 * Authority: KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 (LOCKED). Three
 * bootstrap reads plus the staff-session lifecycle, all derived from Hub
 * relational authority under `kitluy_hub_runtime`:
 *
 *   authority time   — the Hub DATABASE transaction clock (§1). Wall clocks
 *                      everywhere else are diagnostic only.
 *   eligibility      — re-derives the same predicate family the pairing
 *                      door proves in SQL (0031 `assert_pairing_prerequisites_v1`),
 *                      READ-shaped: hub trust/lifecycle, replacement mode,
 *                      active hub assignment, terminal scope + generation,
 *                      credential currency, current pairing receipt, T1
 *                      profile grant, containment. No caller input can
 *                      widen it — scope comes from the authenticated
 *                      credential only (§2).
 *   staff sessions   — open/refresh/close over the EXISTING
 *                      `edge_identity.staff_cache` + `terminal_session`
 *                      authority (0002/0012/0035/0037); permission checks
 *                      through the EXISTING 0022
 *                      `edge_config.resolve_permission_grant` projection.
 *                      No new staff identity model exists here (§7).
 *
 * Session expiry: the governed bound is the cloud-authored
 * `staff_cache.offline_valid_until`; within it, a development lifetime of
 * 30 minutes applies (PROVISIONAL pending an owner session-policy value —
 * recorded, not hidden). Refresh clamps to the same governed bound and can
 * never move `expires_at` beyond it.
 */
import { createHash, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import {
  publicKeyFingerprint,
  terminalConfigurationDeliveryBytes,
  type TerminalConfigurationDelivery,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubClient, type HubPool } from "../db.js";
import { canonicalJson } from "../../hub-database.js";
import type { PairingSigner } from "../pairing.js";

export const RUNTIME_PROTOCOL_VERSION = "1.0" as const;

/** Locked maximum terminal monotonic-cache age for authority time (§1). */
export const AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS = 30 as const;

/** Development staff-session lifetime, clamped by offline_valid_until. */
export const DEV_STAFF_SESSION_LIFETIME_MINUTES = 30 as const;

export const T1_PROFILE_CODE = "laundry.t1.intake_cashier" as const;

/** The registered session permission identifiers (owner decision §4). */
export const PERMISSION_STAFF_SESSIONS_OPEN = "staff.sessions.open" as const;
export const PERMISSION_STAFF_SESSIONS_READ = "staff.sessions.read" as const;
export const PERMISSION_STAFF_SESSIONS_REFRESH = "staff.sessions.refresh" as const;
export const PERMISSION_STAFF_SESSIONS_CLOSE = "staff.sessions.close" as const;
export const PERMISSION_POS_T1_USE = "pos.t1.use" as const;

/** T002 intake permissions (Amendment 003 + the recorded draft reuse). */
export const PERMISSION_CUSTOMERS_READ = "customers.read" as const;
export const PERMISSION_CUSTOMERS_CREATE = "customers.create" as const;
export const PERMISSION_CONSENT_RECORD = "customers.consent.record" as const;
export const PERMISSION_BOOKINGS_READ = "laundry.bookings.read" as const;
export const PERMISSION_BOOKINGS_CREATE = "laundry.bookings.create" as const;

// ---------------------------------------------------------------------------
// Authority time (§1)
// ---------------------------------------------------------------------------

export interface AuthorityTimePayload {
  readonly protocolVersion: string;
  readonly authorityTime: string;
  readonly authoritySource: "hub_database";
  readonly responseId: string;
  readonly generatedAt: string;
  readonly maxCacheAgeSeconds: number;
}

export async function readAuthorityTime(pool: HubPool): Promise<AuthorityTimePayload> {
  const instant = await withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query<{ now: Date }>(`select now() as now`);
      const row = result.rows[0];
      if (row === undefined) throw new Error("the Hub database returned no transaction time");
      return row.now;
    },
    HUB_RUNTIME_ROLE,
  );
  const iso = instant.toISOString();
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    authorityTime: iso,
    authoritySource: "hub_database",
    responseId: randomUUID(),
    generatedAt: iso,
    maxCacheAgeSeconds: AUTHORITY_TIME_MAX_CACHE_AGE_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Runtime eligibility (§2)
// ---------------------------------------------------------------------------

export type EligibilityRefusal =
  | "HUB_NOT_OPERATIONAL"
  | "HUB_RETIRED"
  | "HUB_REPLACEMENT_BLOCKED"
  | "HUB_ASSIGNMENT_MISSING"
  | "ASSIGNMENT_SCOPE_MISMATCH"
  | "ASSIGNMENT_GENERATION_STALE"
  | "CREDENTIAL_NOT_CURRENT"
  | "PAIRING_REQUIRED"
  | "PROFILE_NOT_GRANTED"
  | "PROFILE_NOT_T1"
  | "CONTAINMENT_PROHIBITS";

export interface RuntimeEligibilityPayload {
  readonly protocolVersion: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  /** The Hub's relational assignment row for this terminal's profile. */
  readonly assignmentId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly credentialEligibility: "eligible";
  readonly activationEligibility: "activated";
  readonly pairingEligibility: "paired";
  readonly pairedAt: string;
  /** `none`, `investigation_flagged` (reported, non-blocking) — blocking
   *  directives never reach the payload; they refuse instead. */
  readonly containmentState: string;
  readonly hubReplacementState: string;
  readonly requiredConfigurationVersion: number | null;
  readonly authorityTime: string;
}

export type EligibilityResult =
  | { readonly outcome: "eligible"; readonly payload: RuntimeEligibilityPayload }
  | { readonly outcome: "refused"; readonly refusal: EligibilityRefusal; readonly detail: string };

interface TerminalRow extends Record<string, unknown> {
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly assignment_generation: number;
  readonly lifecycle_status: string;
}

export async function readRuntimeEligibility(
  pool: HubPool,
  terminalDeviceId: string,
  certificateSerial: string,
  environment: string,
): Promise<EligibilityResult> {
  return withHubTransaction(
    pool,
    async (client) => deriveEligibility(client, terminalDeviceId, certificateSerial, environment),
    HUB_RUNTIME_ROLE,
  );
}

async function deriveEligibility(
  client: HubClient,
  terminalDeviceId: string,
  certificateSerial: string,
  environment: string,
): Promise<EligibilityResult> {
  const refuse = (refusal: EligibilityRefusal, detail: string): EligibilityResult => ({
    outcome: "refused",
    refusal,
    detail,
  });

  // Hub self-state: trusted, deployed, replacement mode normal.
  const hub = await client.query<{
    id: string;
    lifecycle_status: string;
    trust_status: string;
  }>(
    `select id, lifecycle_status, trust_status
       from edge_identity.hub_device
      where device_kind = 'store_hub'
      order by created_at
      limit 1`,
  );
  const hubRow = hub.rows[0];
  if (hubRow === undefined) {
    return refuse("HUB_NOT_OPERATIONAL", "no Store Hub device record exists");
  }
  if (hubRow.lifecycle_status === "retired") {
    return refuse("HUB_RETIRED", "this Store Hub is retired");
  }
  if (hubRow.trust_status !== "trusted" || hubRow.lifecycle_status !== "deployed") {
    return refuse("HUB_NOT_OPERATIONAL", "this Store Hub is not trusted and deployed");
  }
  const replacement = await client.query<{ mode: string }>(
    `select mode from edge_identity.hub_replacement_state where singleton = true`,
  );
  const mode = replacement.rows[0]?.mode ?? "normal";
  if (mode !== "normal") {
    return mode === "retired_rejected"
      ? refuse("HUB_RETIRED", "this Store Hub is locally retired")
      : refuse("HUB_REPLACEMENT_BLOCKED", `hub replacement state is ${mode}`);
  }

  // The Hub's own active assignment is the scope authority.
  const hubAssignment = await client.query<{
    hub_device_id: string;
    tenant_id: string;
    digital_store_id: string;
    location_id: string;
    assignment_generation: number;
  }>(
    `select hub_device_id, tenant_id, digital_store_id, location_id, assignment_generation
       from edge_identity.hub_assignment
      where hub_device_id = $1 and ended_at is null
      order by assignment_generation desc
      limit 1`,
    [hubRow.id],
  );
  const scope = hubAssignment.rows[0];
  if (scope === undefined) {
    return refuse("HUB_ASSIGNMENT_MISSING", "this Store Hub has no active assignment");
  }

  // Terminal scope and generation, from the projection the credential names.
  const terminal = await client.query<TerminalRow>(
    `select tenant_id, digital_store_id, location_id, assignment_generation, lifecycle_status
       from edge_identity.terminal_device
      where id = $1::uuid`,
    [terminalDeviceId],
  );
  const terminalRow = terminal.rows[0];
  if (terminalRow === undefined) {
    return refuse("CREDENTIAL_NOT_CURRENT", "the terminal projection is missing");
  }
  if (
    terminalRow.tenant_id !== scope.tenant_id ||
    terminalRow.digital_store_id !== scope.digital_store_id ||
    terminalRow.location_id !== scope.location_id
  ) {
    return refuse(
      "ASSIGNMENT_SCOPE_MISMATCH",
      "the terminal belongs to another Tenant, Store or Location",
    );
  }

  // Credential row (already gated by authorizePeer; re-read for the payload).
  const credential = await client.query<{
    id: string;
    rotation_generation: number;
    status: string;
  }>(
    `select id, rotation_generation, status
       from edge_identity.device_credential
      where certificate_serial = $1`,
    [certificateSerial],
  );
  const credentialRow = credential.rows[0];
  if (credentialRow === undefined || credentialRow.status !== "active") {
    return refuse("CREDENTIAL_NOT_CURRENT", "the presented credential is not current");
  }

  // Current pairing receipt: the newest receipt for this terminal must bind
  // the CURRENT assignment generation.
  const receipt = await client.query<{
    terminal_assignment_generation: number;
    terminal_profile_code: string;
    paired_at: Date;
  }>(
    `select terminal_assignment_generation, terminal_profile_code, paired_at
       from edge_identity.pairing_receipt
      where terminal_device_id = $1::uuid
      order by paired_at desc
      limit 1`,
    [terminalDeviceId],
  );
  const receiptRow = receipt.rows[0];
  if (receiptRow === undefined) {
    return refuse("PAIRING_REQUIRED", "no pairing receipt exists for this terminal");
  }
  if (receiptRow.terminal_assignment_generation !== terminalRow.assignment_generation) {
    return refuse(
      "ASSIGNMENT_GENERATION_STALE",
      "the pairing receipt binds a superseded assignment generation",
    );
  }

  // Profile grant: enabled, effective now, sourced from the ACTIVE snapshot.
  const grant = await client.query<{ id: string; profile_code: string }>(
    `select tpa.id, tpa.profile_code
       from edge_config.terminal_profile_assignment tpa
       join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
      where tpa.terminal_device_id = $1::uuid
        and tpa.enabled
        and tpa.effective_from <= now()
        and (tpa.effective_until is null or tpa.effective_until > now())
        and cs.state = 'active'
      order by tpa.assignment_version desc
      limit 1`,
    [terminalDeviceId],
  );
  const grantRow = grant.rows[0];
  if (grantRow === undefined) {
    return refuse("PROFILE_NOT_GRANTED", "no enabled profile assignment exists");
  }
  if (grantRow.profile_code !== T1_PROFILE_CODE) {
    return refuse("PROFILE_NOT_T1", `the assigned profile is ${grantRow.profile_code}`);
  }
  if (receiptRow.terminal_profile_code !== grantRow.profile_code) {
    return refuse("ASSIGNMENT_GENERATION_STALE", "the pairing receipt binds another profile");
  }

  // Containment: blocking directives refuse; investigation is reported.
  const containment = await client.query<{ directive: string }>(
    `select directive from edge_identity.effective_containment where device_uuid = $1::uuid`,
    [terminalDeviceId],
  );
  const directive = containment.rows[0]?.directive ?? "none";
  if (
    directive === "operations_restricted" ||
    directive === "suspended" ||
    directive === "quarantined"
  ) {
    return refuse("CONTAINMENT_PROHIBITS", `containment directive ${directive} is in effect`);
  }
  const containmentState = directive === "cleared" ? "none" : directive;

  // The configuration version the Store currently requires, if any.
  const snapshot = await client.query<{ snapshot_version: string | bigint }>(
    `select snapshot_version
       from edge_config.configuration_snapshot
      where location_id = $1::uuid and state = 'active'`,
    [terminalRow.location_id],
  );
  const requiredVersion = snapshot.rows[0]?.snapshot_version;

  const nowRow = await client.query<{ now: Date }>(`select now() as now`);
  const authorityTime = nowRow.rows[0]?.now ?? new Date(0);

  return {
    outcome: "eligible",
    payload: {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      tenantId: terminalRow.tenant_id,
      digitalStoreId: terminalRow.digital_store_id,
      storeLocationId: terminalRow.location_id,
      environment,
      hubDeviceId: hubRow.id,
      terminalDeviceId,
      assignmentId: grantRow.id,
      assignmentGeneration: terminalRow.assignment_generation,
      terminalProfileCode: grantRow.profile_code,
      credentialId: credentialRow.id,
      credentialGeneration: credentialRow.rotation_generation,
      credentialEligibility: "eligible",
      activationEligibility: "activated",
      pairingEligibility: "paired",
      pairedAt: receiptRow.paired_at.toISOString(),
      containmentState,
      hubReplacementState: mode,
      requiredConfigurationVersion: requiredVersion === undefined ? null : Number(requiredVersion),
      authorityTime: authorityTime.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Current signed configuration delivery (§3)
// ---------------------------------------------------------------------------

/** Development delivery-validity bound when the snapshot has no expiry:
 * a cached configuration must be re-attested at least daily. */
export const DEV_DELIVERY_VALIDITY_HOURS = 24 as const;

export interface ConfigurationDeliveryBody {
  readonly delivery: {
    readonly snapshotId: string;
    readonly configurationVersion: number;
    readonly schemaVersion: number;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    readonly environment: string;
    readonly hubDeviceId: string;
    readonly terminalDeviceId: string;
    readonly assignmentGeneration: number;
    readonly terminalProfileCode: string;
    readonly minimumApplicationVersion: string;
    readonly maximumApplicationVersion: string | null;
    readonly issuedAt: string;
    readonly effectiveAt: string;
    readonly validUntil: string;
    readonly manifestSha256: string;
    readonly payloadSha256: string;
    readonly signingKeyId: string;
    readonly correlationId: string;
  };
  readonly payloadJson: string;
  /** Hub operational key over the canonical delivery bytes (base64url). */
  readonly deliverySignature: string;
  /**
   * The DELIVERY signer's identity (owner decision §3: "signer and
   * public-key identifier"). `delivery.signingKeyId` names the CLOUD
   * manifest key (provenance); these two name the Hub operational key that
   * produced `deliverySignature`. Envelope metadata, not signed bytes — the
   * terminal verifies the signature under the key it bound at pairing and
   * cross-checks this fingerprint against that same trusted key.
   */
  readonly deliverySignerCertificateSerial: string;
  readonly deliverySignerPublicKeyFingerprint: string;
  readonly rollbackReference: number | null;
}

export type ConfigurationDeliveryResult =
  | { readonly outcome: "delivery"; readonly body: ConfigurationDeliveryBody }
  | {
      readonly outcome: "refused";
      readonly refusal: EligibilityRefusal | "CONFIGURATION_MISSING";
      readonly detail: string;
    };

interface SectionRow extends Record<string, unknown> {
  readonly section_code: string;
  readonly content_json: unknown;
}

/**
 * Build the signed per-terminal configuration delivery. Eligibility is
 * re-derived first — an ineligible terminal receives no configuration —
 * then the ACTIVE snapshot's sections become the payload and the Hub
 * operational key attests the delivery binding (see
 * `terminal-configuration-delivery.ts` for why the cloud HMAC manifest
 * signature cannot be terminal-verified in development).
 */
export async function readCurrentConfigurationDelivery(
  pool: HubPool,
  terminalDeviceId: string,
  certificateSerial: string,
  environment: string,
  signer: PairingSigner,
  correlationId: string,
): Promise<ConfigurationDeliveryResult> {
  return withHubTransaction(
    pool,
    async (client) => {
      const eligibility = await deriveEligibility(
        client,
        terminalDeviceId,
        certificateSerial,
        environment,
      );
      if (eligibility.outcome === "refused") {
        return {
          outcome: "refused",
          refusal: eligibility.refusal,
          detail: eligibility.detail,
        };
      }
      const scope = eligibility.payload;

      const snapshot = await client.query<{
        id: string;
        snapshot_version: string | bigint;
        schema_version: number;
        created_at: Date;
        not_before: Date;
        expires_at: Date | null;
        manifest_sha256: string;
        signing_key_id: string;
      }>(
        `select id, snapshot_version, schema_version, created_at, not_before,
                expires_at, manifest_sha256, signing_key_id
           from edge_config.configuration_snapshot
          where location_id = $1::uuid and state = 'active'`,
        [scope.storeLocationId],
      );
      const snapshotRow = snapshot.rows[0];
      if (snapshotRow === undefined) {
        return {
          outcome: "refused",
          refusal: "CONFIGURATION_MISSING",
          detail: "no active configuration snapshot exists for this Location",
        };
      }

      const sections = await client.query<SectionRow>(
        `select section_code, content_json
           from edge_config.configuration_section
          where snapshot_id = $1::uuid
          order by section_code asc`,
        [snapshotRow.id],
      );
      const payload: Record<string, unknown> = {};
      for (const row of sections.rows) payload[row.section_code] = row.content_json;
      const payloadJson = canonicalJson(payload);
      const payloadSha256 = createHash("sha256")
        .update(Buffer.from(payloadJson, "utf8"))
        .digest("hex");

      // Optional application-compatibility bounds from the terminal_profiles
      // section; absent bounds constrain nothing.
      const profilesSection = payload["terminal_profiles"] as
        { readonly application_compatibility?: Record<string, unknown> } | undefined;
      const compatibility = profilesSection?.application_compatibility;
      const minimumApplicationVersion =
        typeof compatibility?.["minimum_application_version"] === "string"
          ? compatibility["minimum_application_version"]
          : "0.0.0";
      const maximumApplicationVersion =
        typeof compatibility?.["maximum_application_version"] === "string"
          ? compatibility["maximum_application_version"]
          : null;

      const nowRow = await client.query<{ now: Date }>(`select now() as now`);
      const now = nowRow.rows[0] ?? { now: new Date(0) };
      const validUntil =
        snapshotRow.expires_at ??
        new Date(now.now.getTime() + DEV_DELIVERY_VALIDITY_HOURS * 3_600_000);

      const rollback = await client.query<{ snapshot_version: string | bigint }>(
        `select snapshot_version
           from edge_config.configuration_snapshot
          where location_id = $1::uuid and state = 'staged'
          order by snapshot_version desc
          limit 1`,
        [scope.storeLocationId],
      );
      const rollbackRow = rollback.rows[0];

      const delivery: TerminalConfigurationDelivery = {
        snapshotId: snapshotRow.id,
        configurationVersion: Number(snapshotRow.snapshot_version),
        schemaVersion: snapshotRow.schema_version,
        tenantId: scope.tenantId,
        digitalStoreId: scope.digitalStoreId,
        storeLocationId: scope.storeLocationId,
        environment: environment as TrustEnvironment,
        hubDeviceId: scope.hubDeviceId,
        terminalDeviceId,
        assignmentGeneration: scope.assignmentGeneration,
        terminalProfileCode: scope.terminalProfileCode,
        minimumApplicationVersion,
        maximumApplicationVersion,
        issuedAt: snapshotRow.created_at,
        effectiveAt: snapshotRow.not_before,
        validUntil,
        manifestSha256: snapshotRow.manifest_sha256,
        payloadSha256,
        signingKeyId: snapshotRow.signing_key_id,
        correlationId,
      };
      const deliverySignature = Buffer.from(
        signer.sign(terminalConfigurationDeliveryBytes(delivery)),
      ).toString("base64url");

      return {
        outcome: "delivery",
        body: {
          delivery: {
            ...delivery,
            issuedAt: delivery.issuedAt.toISOString(),
            effectiveAt: delivery.effectiveAt.toISOString(),
            validUntil: delivery.validUntil.toISOString(),
          },
          payloadJson,
          deliverySignature,
          deliverySignerCertificateSerial: signer.certificateSerial,
          deliverySignerPublicKeyFingerprint: publicKeyFingerprint(signer.publicKeyPem),
          rollbackReference:
            rollbackRow === undefined ? null : Number(rollbackRow.snapshot_version),
        },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

// ---------------------------------------------------------------------------
// Staff credential verifier (development scheme, one-way)
// ---------------------------------------------------------------------------

/**
 * One-way verifier over a staff passcode: scrypt bound to the actor id so a
 * verifier copied between actors never verifies. This is the DEVELOPMENT
 * verifier scheme for `staff_cache.credential_verifier`; production staff
 * synchronization is cloud-authored and rides BLK-006.
 */
export function staffCredentialVerifier(actorId: string, passcode: string): Buffer {
  return scryptSync(passcode, `kitluy.staff.${actorId}`, 32, { N: 16384, r: 8, p: 1 });
}

export function verifyStaffCredential(
  actorId: string,
  passcode: string,
  storedVerifier: Buffer,
): boolean {
  if (storedVerifier.length !== 32) return false;
  const presented = staffCredentialVerifier(actorId, passcode);
  return timingSafeEqual(presented, storedVerifier);
}

// ---------------------------------------------------------------------------
// Staff sessions (§4) — open / refresh / close
// ---------------------------------------------------------------------------

export type SessionRefusal =
  | "STAFF_UNKNOWN"
  | "STAFF_DISABLED"
  | "STAFF_CREDENTIAL_INVALID"
  | "STAFF_SCOPE_MISMATCH"
  | "STAFF_PROFILE_NOT_AUTHORIZED"
  | "SESSION_PERMISSION_DENIED"
  | "SESSION_OCCUPIED"
  | "SESSION_UNKNOWN"
  | "SESSION_EXPIRED"
  | "SESSION_CLOSED";

export interface StaffSessionPayload {
  readonly sessionId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly profileCode: string;
  readonly openedAt: string;
  readonly expiresAt: string;
  readonly sessionGeneration: number;
  /** Which of the registered permissions the actor holds at this Location. */
  readonly effectivePermissions: readonly string[];
  readonly authorityTime: string;
}

export type SessionResult =
  | { readonly outcome: "ok"; readonly result: string; readonly session: StaffSessionPayload }
  | { readonly outcome: "refused"; readonly refusal: SessionRefusal; readonly detail: string };

interface GrantScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
}

async function resolveGrant(
  client: HubClient,
  scope: GrantScope,
  actorId: string,
  permissionKey: string,
): Promise<"allow" | "deny" | "unknown"> {
  const result = await client.query<{ verdict: string }>(
    `select edge_config.resolve_permission_grant(
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
              'store_location', $3::uuid, true, now()) as verdict`,
    [scope.tenantId, scope.digitalStoreId, scope.locationId, actorId, permissionKey],
  );
  return (result.rows[0]?.verdict ?? "unknown") as "allow" | "deny" | "unknown";
}

async function effectivePermissions(
  client: HubClient,
  scope: GrantScope,
  actorId: string,
): Promise<readonly string[]> {
  const keys = [
    PERMISSION_STAFF_SESSIONS_OPEN,
    PERMISSION_STAFF_SESSIONS_READ,
    PERMISSION_STAFF_SESSIONS_REFRESH,
    PERMISSION_STAFF_SESSIONS_CLOSE,
    PERMISSION_POS_T1_USE,
    PERMISSION_CUSTOMERS_READ,
    PERMISSION_CUSTOMERS_CREATE,
    PERMISSION_CONSENT_RECORD,
    PERMISSION_BOOKINGS_READ,
    PERMISSION_BOOKINGS_CREATE,
  ];
  const held: string[] = [];
  for (const key of keys) {
    if ((await resolveGrant(client, scope, actorId, key)) === "allow") held.push(key);
  }
  return held;
}

interface StaffRow extends Record<string, unknown> {
  readonly actor_id: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly display_name: string;
  readonly credential_verifier: Buffer;
  readonly profile_codes: readonly string[];
  readonly offline_valid_until: Date;
  readonly disabled: boolean;
}

function staffScope(row: StaffRow): GrantScope {
  return {
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    locationId: row.location_id,
  };
}

function sessionScope(row: {
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
}): GrantScope {
  return {
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    locationId: row.location_id,
  };
}

export async function openStaffSession(
  pool: HubPool,
  input: {
    readonly terminalDeviceId: string;
    readonly actorId: string;
    readonly passcode: string;
    readonly profileCode: string;
  },
): Promise<SessionResult> {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal: SessionRefusal, detail: string): SessionResult => ({
        outcome: "refused",
        refusal,
        detail,
      });

      const terminal = await client.query<TerminalRow & { id: string }>(
        `select id, tenant_id, digital_store_id, location_id, assignment_generation, lifecycle_status
           from edge_identity.terminal_device where id = $1::uuid`,
        [input.terminalDeviceId],
      );
      const terminalRow = terminal.rows[0];
      if (terminalRow === undefined) return refuse("SESSION_UNKNOWN", "unknown terminal");

      const staff = await client.query<StaffRow>(
        `select actor_id, tenant_id, digital_store_id, location_id, display_name,
                credential_verifier, profile_codes, offline_valid_until, disabled
           from edge_identity.staff_cache where actor_id = $1::uuid`,
        [input.actorId],
      );
      const staffRow = staff.rows[0];
      if (staffRow === undefined) return refuse("STAFF_UNKNOWN", "no such staff member");
      if (staffRow.disabled) return refuse("STAFF_DISABLED", "the staff member is disabled");
      if (
        staffRow.tenant_id !== terminalRow.tenant_id ||
        staffRow.digital_store_id !== terminalRow.digital_store_id ||
        staffRow.location_id !== terminalRow.location_id
      ) {
        return refuse("STAFF_SCOPE_MISMATCH", "the staff member belongs to another Store");
      }
      if (!verifyStaffCredential(input.actorId, input.passcode, staffRow.credential_verifier)) {
        return refuse("STAFF_CREDENTIAL_INVALID", "the presented credential does not verify");
      }
      if (!staffRow.profile_codes.includes(input.profileCode)) {
        return refuse(
          "STAFF_PROFILE_NOT_AUTHORIZED",
          "the staff member is not authorized for this profile",
        );
      }
      if (
        (await resolveGrant(
          client,
          staffScope(staffRow),
          input.actorId,
          PERMISSION_STAFF_SESSIONS_OPEN,
        )) !== "allow"
      ) {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_OPEN} is not granted`,
        );
      }

      const nowRow = await client.query<{ now: Date }>(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? new Date(0);
      if (now.getTime() >= staffRow.offline_valid_until.getTime()) {
        return refuse("STAFF_DISABLED", "the staff cache entry is beyond its governed validity");
      }

      // One active session per terminal profile (0012). A replay by the same
      // actor returns the existing open session; another actor is refused.
      const existing = await client.query<{
        id: string;
        actor_id: string;
        opened_at: Date;
        expires_at: Date;
        session_generation: number;
      }>(
        `select id, actor_id, opened_at, expires_at, session_generation
           from edge_identity.terminal_session
          where terminal_device_id = $1::uuid and profile_code = $2 and closed_at is null`,
        [input.terminalDeviceId, input.profileCode],
      );
      const open = existing.rows[0];
      if (open !== undefined) {
        if (open.expires_at.getTime() <= now.getTime()) {
          await client.query(
            `update edge_identity.terminal_session set closed_at = now(), status = 'expired' where id = $1::uuid`,
            [open.id],
          );
        } else if (open.actor_id === input.actorId) {
          const held = await effectivePermissions(client, staffScope(staffRow), input.actorId);
          return {
            outcome: "ok",
            result: "SESSION_ALREADY_OPEN",
            session: {
              sessionId: open.id,
              actorId: input.actorId,
              displayName: staffRow.display_name,
              profileCode: input.profileCode,
              openedAt: open.opened_at.toISOString(),
              expiresAt: open.expires_at.toISOString(),
              sessionGeneration: open.session_generation,
              effectivePermissions: held,
              authorityTime: now.toISOString(),
            },
          };
        } else {
          return refuse("SESSION_OCCUPIED", "another staff member's session is open");
        }
      }

      const lifetimeMs = DEV_STAFF_SESSION_LIFETIME_MINUTES * 60_000;
      const expiresAt = new Date(
        Math.min(now.getTime() + lifetimeMs, staffRow.offline_valid_until.getTime()),
      );
      const sessionId = randomUUID();
      const generation = (open?.session_generation ?? 0) + 1;
      await client.query(
        `insert into edge_identity.terminal_session
           (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
            profile_code, opened_at, expires_at, closed_at, session_generation,
            last_event_sequence, status)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                 $7, $8, $9, null, $10, 0, 'open')`,
        [
          sessionId,
          staffRow.tenant_id,
          staffRow.digital_store_id,
          staffRow.location_id,
          input.terminalDeviceId,
          input.actorId,
          input.profileCode,
          now,
          expiresAt,
          generation,
        ],
      );
      const held = await effectivePermissions(client, staffScope(staffRow), input.actorId);
      return {
        outcome: "ok",
        result: "SESSION_OPENED",
        session: {
          sessionId,
          actorId: input.actorId,
          displayName: staffRow.display_name,
          profileCode: input.profileCode,
          openedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          sessionGeneration: generation,
          effectivePermissions: held,
          authorityTime: now.toISOString(),
        },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

async function loadOwnedOpenSession(
  client: HubClient,
  sessionId: string,
  terminalDeviceId: string,
): Promise<
  | {
      readonly ok: true;
      readonly row: {
        id: string;
        actor_id: string;
        tenant_id: string;
        digital_store_id: string;
        location_id: string;
        profile_code: string;
        opened_at: Date;
        expires_at: Date;
        closed_at: Date | null;
        session_generation: number;
      };
    }
  | { readonly ok: false; readonly refusal: SessionRefusal; readonly detail: string }
> {
  const result = await client.query<{
    id: string;
    actor_id: string;
    tenant_id: string;
    digital_store_id: string;
    location_id: string;
    terminal_device_id: string;
    profile_code: string;
    opened_at: Date;
    expires_at: Date;
    closed_at: Date | null;
    session_generation: number;
  }>(
    `select id, actor_id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
            opened_at, expires_at, closed_at, session_generation
       from edge_identity.terminal_session where id = $1::uuid`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined)
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no such session" };
  if (row.terminal_device_id !== terminalDeviceId) {
    // A session id from another terminal must never act here.
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no such session" };
  }
  if (row.closed_at !== null) {
    return { ok: false, refusal: "SESSION_CLOSED", detail: "the session is closed" };
  }
  return { ok: true, row };
}

/** The authorized T1 intake context an intake route operates under. */
export interface T1IntakeAuthority {
  readonly sessionId: string;
  readonly actorId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly profileCode: string;
}

export type T1IntakeAuthorization =
  | { readonly ok: true; readonly authority: T1IntakeAuthority }
  | {
      readonly ok: false;
      readonly refusal: SessionRefusal | "T1_NOT_AUTHORIZED";
      readonly detail: string;
    };

/**
 * The full T002 authorization stack for one intake request (owner decision
 * §6): the presented session must exist, be OWNED by the authenticated
 * terminal, be open and unexpired; the session's profile must be T1; the
 * actor must hold `pos.t1.use` AND the route-specific permission — all
 * re-resolved from the projection on EVERY request, nothing cached. The
 * caller supplies only the session id and the route permission; scope,
 * actor and terminal identity come from Hub relational authority.
 */
export async function authorizeT1IntakeSession(
  client: HubClient,
  input: {
    readonly terminalDeviceId: string;
    readonly sessionId: string;
    readonly routePermission: string;
  },
): Promise<T1IntakeAuthorization> {
  const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
  if (!owned.ok) return { ok: false, refusal: owned.refusal, detail: owned.detail };
  const row = owned.row;
  const nowRow = await client.query<{ now: Date }>(`select now() as now`);
  const now = nowRow.rows[0];
  if (now === undefined) {
    return { ok: false, refusal: "SESSION_UNKNOWN", detail: "no transaction time" };
  }
  if (row.expires_at.getTime() <= now.now.getTime()) {
    return { ok: false, refusal: "SESSION_EXPIRED", detail: "the session already expired" };
  }
  if (row.profile_code !== T1_PROFILE_CODE) {
    return { ok: false, refusal: "T1_NOT_AUTHORIZED", detail: "the session is not a T1 session" };
  }
  const scope = sessionScope(row);
  if ((await resolveGrant(client, scope, row.actor_id, PERMISSION_POS_T1_USE)) !== "allow") {
    return {
      ok: false,
      refusal: "T1_NOT_AUTHORIZED",
      detail: `${PERMISSION_POS_T1_USE} is not granted`,
    };
  }
  if ((await resolveGrant(client, scope, row.actor_id, input.routePermission)) !== "allow") {
    return {
      ok: false,
      refusal: "SESSION_PERMISSION_DENIED",
      detail: `${input.routePermission} is not granted`,
    };
  }
  return {
    ok: true,
    authority: {
      sessionId: row.id,
      actorId: row.actor_id,
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      locationId: row.location_id,
      profileCode: row.profile_code,
    },
  };
}

export async function refreshStaffSession(
  pool: HubPool,
  input: { readonly terminalDeviceId: string; readonly sessionId: string },
): Promise<SessionResult> {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal: SessionRefusal, detail: string): SessionResult => ({
        outcome: "refused",
        refusal,
        detail,
      });
      const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
      if (!owned.ok) return refuse(owned.refusal, owned.detail);
      const row = owned.row;

      const nowRow = await client.query<{ now: Date }>(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? new Date(0);
      if (row.expires_at.getTime() <= now.getTime()) {
        await client.query(
          `update edge_identity.terminal_session set closed_at = now(), status = 'expired' where id = $1::uuid`,
          [row.id],
        );
        return refuse("SESSION_EXPIRED", "the session already expired");
      }
      if (
        (await resolveGrant(
          client,
          sessionScope(row),
          row.actor_id,
          PERMISSION_STAFF_SESSIONS_REFRESH,
        )) !== "allow"
      ) {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_REFRESH} is not granted`,
        );
      }
      const staff = await client.query<StaffRow>(
        `select actor_id, tenant_id, digital_store_id, location_id, display_name,
                credential_verifier, profile_codes, offline_valid_until, disabled
           from edge_identity.staff_cache where actor_id = $1::uuid`,
        [row.actor_id],
      );
      const staffRow = staff.rows[0];
      if (staffRow === undefined || staffRow.disabled) {
        return refuse("STAFF_DISABLED", "the staff member is no longer eligible");
      }
      // The governed bound: never beyond offline_valid_until.
      const lifetimeMs = DEV_STAFF_SESSION_LIFETIME_MINUTES * 60_000;
      const expiresAt = new Date(
        Math.min(now.getTime() + lifetimeMs, staffRow.offline_valid_until.getTime()),
      );
      if (expiresAt.getTime() <= now.getTime()) {
        return refuse("STAFF_DISABLED", "the staff cache entry is beyond its governed validity");
      }
      await client.query(
        `update edge_identity.terminal_session set expires_at = $2 where id = $1::uuid`,
        [row.id, expiresAt],
      );
      const held = await effectivePermissions(client, sessionScope(row), row.actor_id);
      return {
        outcome: "ok",
        result: "SESSION_REFRESHED",
        session: {
          sessionId: row.id,
          actorId: row.actor_id,
          displayName: staffRow.display_name,
          profileCode: row.profile_code,
          openedAt: row.opened_at.toISOString(),
          expiresAt: expiresAt.toISOString(),
          sessionGeneration: row.session_generation,
          effectivePermissions: held,
          authorityTime: now.toISOString(),
        },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

export async function closeStaffSession(
  pool: HubPool,
  input: { readonly terminalDeviceId: string; readonly sessionId: string },
): Promise<SessionResult> {
  return withHubTransaction(
    pool,
    async (client) => {
      const refuse = (refusal: SessionRefusal, detail: string): SessionResult => ({
        outcome: "refused",
        refusal,
        detail,
      });
      const owned = await loadOwnedOpenSession(client, input.sessionId, input.terminalDeviceId);
      if (!owned.ok) return refuse(owned.refusal, owned.detail);
      const row = owned.row;
      if (
        (await resolveGrant(
          client,
          sessionScope(row),
          row.actor_id,
          PERMISSION_STAFF_SESSIONS_CLOSE,
        )) !== "allow"
      ) {
        return refuse(
          "SESSION_PERMISSION_DENIED",
          `${PERMISSION_STAFF_SESSIONS_CLOSE} is not granted`,
        );
      }
      const nowRow = await client.query<{ now: Date }>(`select now() as now`);
      const now = nowRow.rows[0]?.now ?? new Date(0);
      await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'closed' where id = $1::uuid`,
        [row.id],
      );
      const held = await effectivePermissions(client, sessionScope(row), row.actor_id);
      return {
        outcome: "ok",
        result: "SESSION_CLOSED",
        session: {
          sessionId: row.id,
          actorId: row.actor_id,
          displayName: "",
          profileCode: row.profile_code,
          openedAt: row.opened_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          sessionGeneration: row.session_generation,
          effectivePermissions: held,
          authorityTime: now.toISOString(),
        },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}
