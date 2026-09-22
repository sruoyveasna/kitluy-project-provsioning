/**
 * Fail-closed Hub authorisation.
 *
 * Every dimension is evaluated INDEPENDENTLY and carries its OWN denial code
 * (KLD-2026-07-26-002 Group 3: "permission key | API scope | resource scope |
 * environment scope | device/profile authorization | approval policy … MUST
 * NEVER be collapsed into one string, nor may one of them be used to bypass
 * another"). The order is the canonical command-pipeline order:
 *
 *   device context -> device assignment (+ assignment_generation)
 *   -> actor session (not expired) -> logical terminal profile
 *   -> permission -> resource scope -> environment -> approval
 *
 * Nothing here is advisory. Frontend visibility is not authorisation
 * (repository rule 7); this module is the gate, and a denial produces a
 * `edge_audit.security_event` at the pipeline boundary so a blocked attempt is
 * EVIDENCE, never a silent drop.
 *
 * RECORDED GAP — Hub-local permission-grant projection.
 * `edge_identity.staff_cache` carries `profile_codes` and
 * `permission_snapshot_version` but NOT the grants of that snapshot, and the
 * §6 catalogue defines no permission-grant relation. The Hub therefore
 * evaluates the permission dimension from two sources, both fail-closed:
 *   (1) DERIVED — the canonical RBAC registry's `available_scopes` column
 *       carries `terminal_role:` constraints (quoted verbatim below), so a key
 *       so constrained is derivable from the actor's cached profiles.
 *   (2) PRESENTED — grants carried on the authenticated Hub session for keys
 *       with NO `terminal_role:` constraint (`payments.refund.request`,
 *       `payments.void.request`). Each presented grant must be a canonical
 *       registry key AND match the command's Location scope exactly
 *       (`@kitluy/rbac.hasPermission` + `@kitluy/resource-scope.sameScope`).
 * An empty presented set denies. The missing projection is reported as
 * `[REQUIRED: Hub-local permission-grant projection, or an approved Hub session
 * grant-claim contract, for registry keys without a terminal_role constraint]`.
 *
 * TERMINAL PIN SESSIONS (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001;
 * T1-REAL-OPERATIONS-001 slice 2). On a Pi Terminal there is no staff login:
 * the session the Terminal PIN opens names the TERMINAL DEVICE as its actor
 * (asserted by 0043's CHECK). Such an actor has no `staff_cache` row and no
 * grants of its own; what authorizes it is the terminal's own T1 profile grant
 * from the ACTIVE snapshot (dimension 4, re-read per request), the absence of a
 * blocking containment, and the CLOSED T1 terminal surface
 * (`T1_TERMINAL_PIN_PERMISSIONS`) as the permission dimension — the same stack
 * `authorizeT1IntakeSession` applies to the T002 routes. Nothing is widened:
 * a key outside that surface denies, whatever the command declares.
 *
 * ASSIGNMENT GENERATION (KLREC-2026-09-19-ASSIGNMENT-GENERATION-SEMANTICS-001,
 * resolved by KLD-2026-09-19-T1-REAL-OPERATIONS-001 decision 2): the presented
 * generation is compared with the TERMINAL's own projected
 * `terminal_device.assignment_generation` only. The Hub's
 * `hub_assignment.assignment_generation` is a separate device counter (the
 * Hub's own seat generation, which the pairing and eligibility paths already
 * treat as such) and is used here only as the ordering namespace of the events
 * this Hub emits (offline contract §5.1), never as the terminal's expected value.
 */
import { assertFourEyes, type ApprovalDecision, type ApprovalRequest } from "@kitluy/approvals";
import { hasPermission, isCanonicalPermissionKey, type PermissionGrant } from "@kitluy/rbac";
import { KITLUY_ENVIRONMENTS, type KitluyEnvironment } from "@kitluy/shared-types";
import type { ResourceScope } from "@kitluy/resource-scope";
import {
  isLaundryTerminalProfile,
  type LaundryTerminalProfile,
} from "@kitluy-verticals/phase1-laundry";
import type { HubClient } from "./db.js";
import { HubCommandError, type HubCommandErrorCode } from "./errors.js";
import type { HubCommandDefinition } from "./command-registry.js";
import { configRepo, identityRepo } from "./repositories/index.js";
import {
  isCertificateRevokedOfflineWithin,
  isDeviceRevokedOfflineWithin,
} from "./revocation-trust.js";
import { isUuid } from "./uuid.js";
import { T1_TERMINAL_PIN_PERMISSIONS, readBlockingContainment } from "./edge/runtime-bootstrap.js";

export const PERMISSION_GAP_HUB_GRANT_PROJECTION =
  "[REQUIRED: Hub-local permission-grant projection, or an approved Hub session grant-claim contract, for registry keys without a terminal_role constraint]";

/**
 * `available_scopes` `terminal_role:` constraints, quoted VERBATIM from
 * `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`.
 * `null` means the registry row places no terminal-role restriction on the key,
 * so it CANNOT be derived from a cached profile and must be presented.
 */
export const PERMISSION_TERMINAL_ROLES: Readonly<
  Record<string, readonly LaundryTerminalProfile[] | null>
> = {
  // "store_location, terminal_role:T1"
  "laundry.bookings.create": ["laundry.t1.intake_cashier"],
  "laundry.bookings.price_override": ["laundry.t1.intake_cashier"],
  // "store_location, terminal_role:T3"
  "laundry.ready_scan_in": ["laundry.t3.ready_scan_in"],
  // "store_location, terminal_role:T4"
  "laundry.pickup_scan_out": ["laundry.t4.pickup_scan_out"],
  "laundry.booking.complete": ["laundry.t4.pickup_scan_out"],
  // "store_location, terminal_role:T1|T4"
  "payments.capture.cash": ["laundry.t1.intake_cashier", "laundry.t4.pickup_scan_out"],
  // "store_location, terminal_role:T1|T4, storefront"
  "payments.khqr.create": ["laundry.t1.intake_cashier", "laundry.t4.pickup_scan_out"],
  // "tenant, digital_store, store_location, payment" — NO terminal_role.
  "payments.refund.request": null,
  // "store_location, transaction" — NO terminal_role.
  "payments.void.request": null,
};

/**
 * RECORDED CONFLICT (not silently reconciled — CLAUDE.md hard rule 8): the RBAC
 * registry's `environment_restrictions` column uses a DIFFERENT vocabulary
 * (`store_edge/pilot/prod`, `dev/staging/pilot/prod/dr`) from the canonical
 * `KITLUY_ENVIRONMENTS` of `@kitluy/shared-types`
 * (`local | development | staging | pilot | production | disaster_recovery`).
 * No mapping between the two is approved, so the Hub validates the canonical
 * vocabulary only and reports the divergence rather than inventing a mapping.
 */
export const ENVIRONMENT_VOCABULARY_CONFLICT =
  "RBAC registry environment_restrictions ('store_edge/pilot/prod') vs KITLUY_ENVIRONMENTS — no approved mapping; recorded, not resolved.";

/** Environments the Hub command layer will operate in (KL-INF-P1-037). */
export const HUB_ALLOWED_ENVIRONMENTS: readonly KitluyEnvironment[] = ["local", "development"];

/** Everything the caller must present for ONE command attempt. */
export interface HubDeviceContext {
  readonly terminalDeviceId: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly profileCode: string;
  /** Ordering-namespace generation the terminal believes it is operating in. */
  readonly assignmentGeneration: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly environment: KitluyEnvironment;
  /** Session-carried grants for keys without a `terminal_role:` constraint. */
  readonly presentedGrants?: readonly PermissionGrant[];
}

/** Four-eyes evidence for the commands whose approved policy requires it. */
export interface HubApprovalEvidence {
  readonly request: ApprovalRequest;
  readonly decision: ApprovalDecision;
}

export interface AuthorizedCommandContext {
  readonly device: HubDeviceContext;
  readonly profile: LaundryTerminalProfile;
  readonly hubDeviceId: string;
  readonly assignmentGeneration: number;
  readonly actorDisplayName: string;
  readonly permission: string;
  /** How the permission dimension was satisfied — recorded in the audit event. */
  readonly permissionSource: "profile_derived" | "session_presented" | "terminal_pin";
  /**
   * Who the actor IS: a cached staff member, or the terminal device itself
   * under its Terminal PIN session. Recorded on the audit event and carried
   * as the event envelope's actor class.
   */
  readonly actorType: "staff" | "terminal_device";
  readonly scope: ResourceScope;
  readonly approval?: HubApprovalEvidence;
}

function deny(
  code: HubCommandErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new HubCommandError(code, message, details);
}

/**
 * Run every authorisation dimension in the canonical order. Returns only when
 * ALL of them pass; otherwise throws the code of the FIRST dimension that
 * denied, so a denial always names the real reason.
 */
export async function authorizeHubCommand(
  client: HubClient,
  definition: HubCommandDefinition,
  device: HubDeviceContext,
  options: {
    /** Scope tuple of the aggregate being mutated, when it already exists. */
    readonly targetScope?: {
      readonly tenantId: string;
      readonly digitalStoreId: string;
      readonly locationId: string;
    };
    readonly approval?: HubApprovalEvidence;
    /** Extra registry keys the payload branch requires (conditional permissions). */
    readonly requiredConditionalPermissions?: readonly string[];
  } = {},
): Promise<AuthorizedCommandContext> {
  // 1 --------------------------------------------------------- device context
  for (const [field, value] of Object.entries({
    terminalDeviceId: device.terminalDeviceId,
    sessionId: device.sessionId,
    actorId: device.actorId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
  })) {
    if (typeof value !== "string" || !isUuid(value)) {
      deny("EDGE_DEVICE_CONTEXT_INVALID", `device context field '${field}' is not a UUID.`, {
        field,
      });
    }
  }
  if (!Number.isInteger(device.assignmentGeneration) || device.assignmentGeneration < 1) {
    deny(
      "EDGE_DEVICE_CONTEXT_INVALID",
      "assignment_generation must be an integer >= 1 (offline contract §5.1).",
    );
  }
  if (!isLaundryTerminalProfile(device.profileCode)) {
    // Retired three-terminal names and pre-rename spellings are never coerced
    // onto a canonical profile (KLD-2026-07-26-002 Group 2; KLV4-DEC-005).
    deny(
      "EDGE_DEVICE_CONTEXT_INVALID",
      `'${device.profileCode}' is not a canonical logical terminal profile.`,
      { profileCode: device.profileCode },
    );
  }
  const profile: LaundryTerminalProfile = device.profileCode;

  // 2 ------------------------------------------------- device assignment (+gen)
  const assignment = await identityRepo.findActiveHubAssignment(client);
  if (!assignment || assignment.status !== "active") {
    deny("EDGE_DEVICE_NOT_ASSIGNED", "this Hub has no ACTIVE Location assignment.");
  }
  const terminal = await identityRepo.findTerminalDevice(client, device.terminalDeviceId);
  if (!terminal) {
    deny("EDGE_TERMINAL_UNKNOWN", `terminal device ${device.terminalDeviceId} is not registered.`, {
      terminalDeviceId: device.terminalDeviceId,
    });
  }
  if (terminal.lifecycle_status !== "active") {
    deny(
      "EDGE_DEVICE_REVOKED",
      `terminal device ${terminal.id} lifecycle_status is '${terminal.lifecycle_status}'.`,
      { terminalDeviceId: terminal.id, lifecycleStatus: terminal.lifecycle_status },
    );
  }
  const credentials = await identityRepo.findDeviceCredentials(client, terminal.id);
  const revoked = credentials.find((c) => c.status === "revoked");
  if (revoked) {
    deny("EDGE_DEVICE_REVOKED", `terminal device ${terminal.id} holds a REVOKED credential.`, {
      terminalDeviceId: terminal.id,
      revocationReason: revoked.revocation_reason,
    });
  }

  // 2b ------------------------------------------- OFFLINE REVOCATION ENFORCEMENT
  //
  // THE REPLICATED `status` COLUMN IS NOT AN ANSWER WHEN THE CLOUD IS UNREACHABLE.
  //
  // The check above reads `edge_identity.device_credential.status`, which is only
  // as fresh as the last successful sync. A credential revoked in the cloud while
  // this Hub is offline still reads 'active' here, so on its own that check lets a
  // compromised terminal keep operating for exactly as long as the outage lasts --
  // which is the window an attacker chooses.
  //
  // The signed snapshot exists to answer the question without the cloud, and until
  // this call it had no runtime consumer at all: it could be delivered, verified
  // and persisted, and nothing ever asked it anything (WS-11-T003 Step 4 §2).
  //
  // NOT OPTIONAL AND NOT FALLBACK-ON-ERROR. There is no `catch` here: if the
  // offline store cannot be read, the gate fails rather than admitting a device it
  // could not clear. `is_certificate_revoked_offline_v1` spans
  // `state in ('active','superseded')`, so the answer only ever GROWS -- a newer
  // snapshot that omits a serial cannot un-revoke it, and neither can a reconnect.
  //
  // The serial comes from the Hub's own credential row, never from the presenter:
  // a caller who could name the serial to check would simply name a different one.
  const hubScope = {
    tenantId: assignment.tenant_id,
    digitalStoreId: assignment.digital_store_id,
    storeLocationId: assignment.location_id,
    environment: device.environment,
    hubDeviceId: assignment.hub_device_id,
  };
  // DEVICE RECORDS, not only certificate serials.
  //
  // `revokedDeviceRecordIds` rides inside the signed bytes and, until Hub group
  // 0029, NOTHING read it back -- a signed field with no enforcement effect,
  // which is worse than not carrying it, because the signature implies the
  // contents matter.
  //
  // The Hub's OWN device record is checked first and is the sound half:
  // `hub_assignment.hub_device_id` is a cloud device record id -- the scope check
  // above compares it to the snapshot's `hubDeviceRecordId` -- so a Hub whose
  // device record was retired stops operating.
  //
  // RECORDED, NOT ASSERTED: `terminal_device.id` is a plain uuid primary key with
  // no column stating that it mirrors the cloud device record. It very likely
  // does, but "likely" is not evidence, so the terminal is checked as well and
  // the residual uncertainty is written down rather than presented as proof.
  for (const deviceRecordId of [assignment.hub_device_id, terminal.id]) {
    if (await isDeviceRevokedOfflineWithin(client, hubScope, deviceRecordId)) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `device record ${deviceRecordId} is revoked by the Hub's held revocation snapshot.`,
        {
          terminalDeviceId: terminal.id,
          deviceRecordId,
          source: "OFFLINE_REVOCATION_SNAPSHOT",
        },
      );
    }
  }

  for (const credential of credentials) {
    const offlineRevoked = await isCertificateRevokedOfflineWithin(
      client,
      hubScope,
      credential.certificate_serial,
    );
    if (offlineRevoked) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `certificate ${credential.certificate_serial} is revoked by the Hub's held revocation snapshot.`,
        {
          terminalDeviceId: terminal.id,
          certificateSerial: credential.certificate_serial,
          // Named so an operator can tell this apart from the replicated-status
          // denial above: this one fired with no cloud involved.
          source: "OFFLINE_REVOCATION_SNAPSHOT",
        },
      );
    }
  }
  if (device.assignmentGeneration !== terminal.assignment_generation) {
    // Decision 2 (KLREC-2026-09-19-ASSIGNMENT-GENERATION-SEMANTICS-001): the
    // terminal's expected value is ITS OWN projected seat generation — the one
    // the cloud assigned it and the one it paired at. A terminal re-assigned
    // in the cloud still holding the previous generation must resynchronise
    // before it may mutate (offline §5.1). The Hub's own generation is a
    // different device's counter and is not compared here.
    deny(
      "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
      `assignment_generation ${device.assignmentGeneration} does not match the terminal's projected generation ${terminal.assignment_generation}.`,
      {
        presented: device.assignmentGeneration,
        deviceGeneration: terminal.assignment_generation,
        hubGeneration: assignment.assignment_generation,
      },
    );
  }

  // 3 -------------------------------------------------------- actor session
  const session = await identityRepo.findTerminalSession(client, device.sessionId);
  if (!session) {
    deny("EDGE_SESSION_INVALID", `session ${device.sessionId} does not exist.`);
  }
  if (session.closed_at !== null || session.status !== "open") {
    deny("EDGE_SESSION_INVALID", `session ${session.id} is not open.`, { status: session.status });
  }
  if (session.terminal_device_id !== terminal.id) {
    deny("EDGE_SESSION_INVALID", `session ${session.id} belongs to a different terminal.`);
  }
  if (session.actor_id !== device.actorId) {
    deny("EDGE_SESSION_INVALID", `session ${session.id} is bound to a different actor.`);
  }
  // A Terminal PIN session's actor IS the terminal (0043 CHECK) — re-asserted
  // here so a projection edit could never let a PIN session name a person.
  const pinSession = session.credential_kind === "terminal_pin";
  if (pinSession && (session.actor_id !== terminal.id || device.actorId !== terminal.id)) {
    deny(
      "EDGE_SESSION_INVALID",
      `Terminal PIN session ${session.id} must name its terminal as actor.`,
    );
  }
  const now = await currentDatabaseTime(client);
  if (session.expires_at.getTime() <= now.getTime()) {
    deny(
      "EDGE_SESSION_EXPIRED",
      `session ${session.id} expired at ${session.expires_at.toISOString()}.`,
      {
        expiresAt: session.expires_at.toISOString(),
      },
    );
  }

  // 4 --------------------------------------------- logical terminal profile
  if (session.profile_code !== profile) {
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `session ${session.id} is open on profile '${session.profile_code}', not '${profile}'.`,
      { sessionProfile: session.profile_code, requestedProfile: profile },
    );
  }
  const profileAssignment = await configRepo.findActiveProfileAssignment(
    client,
    terminal.id,
    profile,
  );
  if (!profileAssignment) {
    // "Installer cannot self-select profiles" — the grant is cloud-assigned.
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `terminal ${terminal.id} holds no ACTIVE cloud grant for profile '${profile}'.`,
      { terminalDeviceId: terminal.id, profileCode: profile },
    );
  }
  if (!definition.allowedProfiles.includes(profile)) {
    // T2 never performs a staff mutation; T3 never releases custody; T4 never
    // records Ready intake (RB v4 §5.2-5.5; Terminal Profile Contract §6.1).
    deny(
      "EDGE_PROFILE_NOT_AUTHORIZED",
      `command '${definition.commandType}' does not allow profile '${profile}'.`,
      { commandType: definition.commandType, profileCode: profile },
    );
  }

  // 5 -------------------------------------------------------- permission key
  const scope: ResourceScope = {
    level: "store_location",
    resourceId: device.locationId,
    environment: device.environment,
  };
  const required = [definition.permission, ...(options.requiredConditionalPermissions ?? [])];
  for (const permission of required) {
    if (!isCanonicalPermissionKey(permission)) {
      deny(
        "EDGE_PERMISSION_KEY_UNREGISTERED",
        `permission '${permission}' is not in the canonical RBAC registry; unknown keys fail closed.`,
        { permission },
      );
    }
  }
  let source: AuthorizedCommandContext["permissionSource"] = "profile_derived";
  let actorType: AuthorizedCommandContext["actorType"] = "staff";
  let actorDisplayName = "";
  let staff: Awaited<ReturnType<typeof identityRepo.findStaffCache>> = undefined;
  if (pinSession) {
    // THE DEVICE IS THE ACTOR. No staff projection exists for it and none is
    // invented: the terminal's T1 grant (dimension 4 above) plus the closed
    // T1 terminal surface is the whole permission dimension, and a blocking
    // containment directive closes it — exactly the T002 intake stack.
    if ((await readBlockingContainment(client, terminal.id)) !== null) {
      deny(
        "EDGE_DEVICE_REVOKED",
        `terminal ${terminal.id} is under a blocking containment directive.`,
        {
          terminalDeviceId: terminal.id,
          source: "CONTAINMENT_DIRECTIVE",
        },
      );
    }
    for (const permission of required) {
      if (!T1_TERMINAL_PIN_PERMISSIONS.includes(permission)) {
        deny(
          "EDGE_PERMISSION_DENIED",
          `'${permission}' is not part of the T1 terminal surface a Terminal PIN session may exercise.`,
          { actorId: device.actorId, permission, credentialKind: "terminal_pin" },
        );
      }
    }
    source = "terminal_pin";
    actorType = "terminal_device";
    actorDisplayName = terminal.terminal_name;
  } else {
    staff = await identityRepo.findStaffCache(client, device.actorId);
    if (!staff) {
      deny(
        "EDGE_PERMISSION_DENIED",
        `actor ${device.actorId} has no cached permission projection.`,
        {
          actorId: device.actorId,
        },
      );
    }
    if (staff.disabled) {
      deny("EDGE_PERMISSION_DENIED", `actor ${device.actorId} is disabled.`, {
        actorId: device.actorId,
      });
    }
    if (staff.offline_valid_until.getTime() <= now.getTime()) {
      deny(
        "EDGE_PERMISSION_DENIED",
        `actor ${device.actorId} permission projection expired at ${staff.offline_valid_until.toISOString()}.`,
        { actorId: device.actorId },
      );
    }
    for (const permission of required) {
      const outcome = evaluatePermission(permission, staff.profile_codes, device, scope);
      if (outcome === "denied") {
        deny("EDGE_PERMISSION_DENIED", `actor ${device.actorId} does not hold '${permission}'.`, {
          actorId: device.actorId,
          permission,
          heldProfiles: staff.profile_codes,
        });
      }
      if (outcome === "session_presented") source = "session_presented";
    }
    actorDisplayName = staff.display_name;
  }

  // 6 -------------------------------------------------------- resource scope
  const scopeTuple = {
    tenant: device.tenantId,
    store: device.digitalStoreId,
    location: device.locationId,
  };
  const mismatches: string[] = [];
  if (assignment.tenant_id !== scopeTuple.tenant) mismatches.push("hub_assignment.tenant_id");
  if (assignment.digital_store_id !== scopeTuple.store)
    mismatches.push("hub_assignment.digital_store_id");
  if (assignment.location_id !== scopeTuple.location) mismatches.push("hub_assignment.location_id");
  if (terminal.tenant_id !== scopeTuple.tenant) mismatches.push("terminal_device.tenant_id");
  if (terminal.digital_store_id !== scopeTuple.store)
    mismatches.push("terminal_device.digital_store_id");
  if (terminal.location_id !== scopeTuple.location) mismatches.push("terminal_device.location_id");
  if (session.tenant_id !== scopeTuple.tenant) mismatches.push("terminal_session.tenant_id");
  if (session.location_id !== scopeTuple.location) mismatches.push("terminal_session.location_id");
  if (staff !== undefined) {
    if (staff.tenant_id !== scopeTuple.tenant) mismatches.push("staff_cache.tenant_id");
    if (staff.location_id !== scopeTuple.location) mismatches.push("staff_cache.location_id");
  }
  if (options.targetScope) {
    if (options.targetScope.tenantId !== scopeTuple.tenant) mismatches.push("target.tenant_id");
    if (options.targetScope.digitalStoreId !== scopeTuple.store)
      mismatches.push("target.digital_store_id");
    if (options.targetScope.locationId !== scopeTuple.location)
      mismatches.push("target.location_id");
  }
  if (mismatches.length > 0) {
    // §12 acceptance test 9: cross-Tenant, cross-Digital-Store and
    // cross-Location rows are rejected. A Tenant-only check would miss the
    // sibling-Location case, so all three columns are compared everywhere.
    deny("EDGE_RESOURCE_SCOPE_DENIED", `scope mismatch on ${mismatches.join(", ")}.`, {
      mismatches,
      ...scopeTuple,
    });
  }

  // 7 ----------------------------------------------------- environment scope
  if (!(KITLUY_ENVIRONMENTS as readonly string[]).includes(device.environment)) {
    deny("EDGE_ENVIRONMENT_DENIED", `'${device.environment}' is not a canonical environment.`);
  }
  if (!HUB_ALLOWED_ENVIRONMENTS.includes(device.environment)) {
    deny(
      "EDGE_ENVIRONMENT_DENIED",
      `the Hub command layer refuses environment '${device.environment}' (KL-INF-P1-037: development targets only).`,
      { environment: device.environment },
    );
  }

  // 8 ------------------------------------------------------- approval policy
  if (definition.approvalRequired) {
    if (!options.approval) {
      deny(
        "EDGE_APPROVAL_REQUIRED",
        `command '${definition.commandType}' requires recorded four-eyes approval evidence.`,
        { commandType: definition.commandType, riskClass: definition.riskClass },
      );
    }
    try {
      assertFourEyes(options.approval.request, options.approval.decision);
    } catch (error) {
      // @kitluy/approvals is the authority; four-eyes can never be relaxed
      // (repository rule 7).
      deny(
        "EDGE_SELF_APPROVAL_FORBIDDEN",
        error instanceof Error ? error.message : "self-approval is forbidden.",
        { commandType: definition.commandType },
      );
    }
    if (options.approval.decision.decision !== "approved") {
      deny("EDGE_APPROVAL_REQUIRED", "the presented approval decision is not 'approved'.");
    }
  }

  return {
    device,
    profile,
    hubDeviceId: assignment.hub_device_id,
    // The ordering namespace of everything this Hub emits (offline §5.1).
    assignmentGeneration: assignment.assignment_generation,
    actorDisplayName,
    permission: definition.permission,
    permissionSource: source,
    actorType,
    scope,
    ...(options.approval ? { approval: options.approval } : {}),
  };
}

type PermissionOutcome = "profile_derived" | "session_presented" | "denied";

function evaluatePermission(
  permission: string,
  heldProfiles: readonly string[],
  device: HubDeviceContext,
  scope: ResourceScope,
): PermissionOutcome {
  const terminalRoles = PERMISSION_TERMINAL_ROLES[permission];
  if (terminalRoles !== undefined && terminalRoles !== null) {
    // Derivable from the cached actor projection: the registry row restricts
    // the key to specific terminal roles, and the actor's cached profiles say
    // which of those roles the actor may work in.
    return terminalRoles.some((role) => heldProfiles.includes(role)) ? "profile_derived" : "denied";
  }
  // No terminal_role constraint (or an unknown row): the Hub holds no grant
  // projection, so ONLY an explicitly presented, canonical, exactly-scoped
  // grant can satisfy it. An absent grant denies.
  const presented = device.presentedGrants ?? [];
  return hasPermission([...presented], permission, scope) ? "session_presented" : "denied";
}

async function currentDatabaseTime(client: HubClient): Promise<Date> {
  const result = await client.query<{ now: Date }>("select now() as now");
  const value = result.rows[0]?.now;
  return value ?? new Date();
}
