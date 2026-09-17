/**
 * Physical terminals and terminal pairing sessions — the Partner's half of
 * "type the code" for a Pi Terminal.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §6, §7, §17; migration
 * group 0213 (the seat, the session, the doors and the
 * `kitluy_terminal_issuance_service` identity); KLD-2026-09-04-TERMINAL-
 * PROVISIONING-CLARIFICATIONS-001 (no QR; optional name).
 *
 * ===========================================================================
 * THE SAME DISCIPLINE AS HUB PAIRING-CODE ISSUANCE
 * ===========================================================================
 * Everything `hub-pairing-issuance.ts` records holds here: the code is
 * generated in this process from the database's own alphabet, only its digest
 * reaches the database, it is returned once and never logged; the door is
 * reached as a least-privilege identity that holds no table access; authority
 * was decided BEFORE any of these functions run, by `authorizePartnerRequest`
 * with a separate Store-scope conjunct.
 *
 * Reads (list, session status, ownership) use the server's trusted identity
 * after authorization, exactly as `readPairingSession` does.
 */
import { createHash } from "node:crypto";

import type pg from "pg";

import { generateCode, HUB_PAIRING_TTL_SECONDS } from "./hub-pairing-issuance.js";

export interface TerminalProvisioningDeps {
  readonly pool: pg.Pool;
}

export interface PhysicalTerminalDto {
  readonly physicalTerminalId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly locationReference: string | null;
  readonly label: string;
  readonly terminalProfileKeys: readonly string[];
  readonly boundDevice: null | {
    readonly deviceId: string;
    readonly deviceReference: string;
    readonly lifecycle: string;
    readonly assignmentState: string | null;
  };
  readonly lastSession: null | {
    readonly sessionId: string;
    readonly state: string;
    readonly expiresAt: string;
    readonly pairedAt: string | null;
    readonly failedAttemptCount: number;
    readonly locked: boolean;
  };
  /**
   * What the bound Terminal last reported about its own runtime (cloud group
   * 0229): its Store Hub link, its POS release and the POS runtime state.
   * DEVICE-REPORTED — signed by the Terminal's identity key, not observed by
   * the Store Hub — and aged by the CLOUD's receipt clock. Null when the seat
   * has no bound device or the device has never reported.
   */
  readonly runtime: TerminalRuntimeDto | null;
  readonly createdAt: string;
}

export interface TerminalRuntimeDto {
  readonly source: "device_reported";
  readonly receivedAt: string;
  readonly ageSeconds: number;
  readonly hubLink: null | {
    readonly phase: string;
    readonly hubDeviceId: string | null;
    readonly checkedAt: string;
    /**
     * The Terminal PIN as the STORE HUB answered the terminal (report v2). Its
     * own evidence for the Partner ladder's "PIN set"; null when the terminal
     * reported v1 or the Hub did not answer. Never a PIN, never a verifier.
     */
    readonly terminalPin: null | {
      readonly state: "setup_required" | "set" | "reset_required";
      readonly setAt: string | null;
      readonly lockedUntil: string | null;
    };
  };
  readonly application: null | {
    readonly product: string;
    readonly installedReleaseId: string | null;
    readonly installedVersion: string | null;
    readonly journalPhase: string;
    readonly lastOutcome: string | null;
    readonly runningReleaseId: string | null;
    readonly unitActive: boolean;
  };
  readonly pos: null | {
    readonly state: string;
    readonly refusalCode: string | null;
    readonly applicationVersion: string;
    readonly configurationVersion: number | null;
    readonly configurationFreshness: string | null;
    /** Unlocked by the Terminal PIN (v2), or signed in (a v1 report). Never who. */
    readonly terminalUnlocked: boolean;
  };
}

export interface TerminalRefusal {
  readonly kind: "refused";
  readonly code: string;
  readonly detail: string;
}

export interface IssuedTerminalPairingCode {
  /** Plaintext. Returned ONCE and never persisted. */
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly physicalTerminalId: string;
  readonly label: string;
  readonly terminalProfileKeys: readonly string[];
  readonly storeHubReference: string | null;
  readonly environment: string | null;
}

export interface TerminalPairingSessionStatus {
  readonly sessionId: string;
  readonly physicalTerminalId: string;
  readonly digitalStoreId: string;
  /** `open` · `consumed` · `revoked` · `expired` · `locked` — the stored state. */
  readonly state: string;
  readonly pairedAt: string | null;
  readonly pairedDeviceId: string | null;
  readonly pairedDeviceReference: string | null;
  readonly failedAttemptCount: number;
  readonly lockedAt: string | null;
  readonly expiresAt: string;
  readonly terminalProfileKeys: readonly string[];
}

export interface StoreHubReadiness {
  readonly deviceReference: string | null;
  /** `active` · `pending_trust` · `none`. Anything else is reported verbatim. */
  readonly state: string;
}

interface DoorRow {
  readonly result: Record<string, unknown>;
}

const UNMAPPED_DETAIL = "the request was refused";

function refusalOf(result: Record<string, unknown>, fallbackCode: string): TerminalRefusal {
  const code = typeof result.refusal_code === "string" ? result.refusal_code : fallbackCode;
  const detail = typeof result.detail === "string" ? result.detail : UNMAPPED_DETAIL;
  return { kind: "refused", code, detail };
}

/**
 * One transaction as `kitluy_terminal_issuance_service`. Rolls back on any
 * throw; the caller sees a refusal without a SQLSTATE, function name or row
 * identity.
 */
async function asIssuer<T>(
  deps: TerminalProvisioningDeps,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role kitluy_terminal_issuance_service");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: readonly unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, [...params]);
  return rows[0]?.result ?? {};
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Reads (trusted identity, after authorization)
// ---------------------------------------------------------------------------

interface TerminalRow {
  id: string;
  digital_store_id: string;
  store_location_id: string;
  location_reference: string | null;
  label: string;
  terminal_profile_keys: string[] | null;
  created_at: Date | string;
  bound_device_id: string | null;
  bound_device_reference: string | null;
  bound_lifecycle: string | null;
  bound_assignment_state: string | null;
  session_id: string | null;
  session_state: string | null;
  session_expires_at: Date | string | null;
  session_paired_at: Date | string | null;
  session_failed: string | number | null;
  session_locked_at: Date | string | null;
  runtime_report: Record<string, unknown> | null;
  runtime_received_at: Date | string | null;
  runtime_age_seconds: string | number | null;
}

const TERMINAL_SELECT = `
  select pt.id, pt.digital_store_id, pt.store_location_id,
         sl.location_code || ' — ' || sl.name           as location_reference,
         pt.label, pt.created_at,
         coalesce((select array_agg(r.terminal_profile_key order by r.ordinal, r.added_at)
                     from kitluy_devices.physical_terminal_roles r
                    where r.physical_terminal_id = pt.id and r.removed_at is null),
                  '{}'::text[])                           as terminal_profile_keys,
         d.id                                            as bound_device_id,
         d.asset_tag                                     as bound_device_reference,
         d.lifecycle_state::text                         as bound_lifecycle,
         a.state::text                                   as bound_assignment_state,
         s.id                                            as session_id,
         s.state                                         as session_state,
         s.expires_at                                    as session_expires_at,
         s.paired_at                                     as session_paired_at,
         s.failed_attempt_count                          as session_failed,
         s.locked_at                                     as session_locked_at,
         rs.report                                       as runtime_report,
         rs.received_at                                  as runtime_received_at,
         rs.report_age_seconds                           as runtime_age_seconds
    from kitluy_devices.physical_terminals pt
    left join kitluy_core.store_locations sl on sl.id = pt.store_location_id
    left join kitluy_devices.devices d on d.id = pt.bound_device_id
    left join kitluy_devices.device_assignments a on a.id = pt.bound_assignment_id
    left join lateral (
      select * from kitluy_devices.terminal_pairing_sessions s
       where s.physical_terminal_id = pt.id
       order by s.created_at desc limit 1) s on true
    left join kitluy_devices.device_runtime_status_read rs on rs.device_id = d.id`;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The runtime facts a Partner may see, copied field by field from the stored
 * v1 report (which group 0229 and the registry already validated). Nothing is
 * derived here: no rung, no "operational", no merged state.
 */
function toRuntimeDto(row: TerminalRow): TerminalRuntimeDto | null {
  const report = row.runtime_report;
  if (report === null || row.runtime_received_at === null || row.runtime_age_seconds === null) {
    return null;
  }
  const hub = report["hubLink"] as Record<string, unknown> | null | undefined;
  const app = report["application"] as Record<string, unknown> | null | undefined;
  const pos = report["pos"] as Record<string, unknown> | null | undefined;
  return {
    source: "device_reported",
    receivedAt: iso(row.runtime_received_at),
    ageSeconds: Number(row.runtime_age_seconds),
    hubLink:
      hub === null || hub === undefined
        ? null
        : {
            phase: text(hub["phase"]) ?? "unknown",
            hubDeviceId: text(hub["hubDeviceId"]),
            checkedAt: text(hub["checkedAt"]) ?? "",
            terminalPin: terminalPinDto(hub["terminalPin"]),
          },
    application:
      app === null || app === undefined
        ? null
        : {
            product: text(app["product"]) ?? "unknown",
            installedReleaseId: text(app["installedReleaseId"]),
            installedVersion: text(app["installedVersion"]),
            journalPhase: text(app["journalPhase"]) ?? "unknown",
            lastOutcome: text(app["lastOutcome"]),
            runningReleaseId: text(app["runningReleaseId"]),
            unitActive: app["unitActive"] === true,
          },
    pos:
      pos === null || pos === undefined
        ? null
        : {
            state: text(pos["state"]) ?? "unknown",
            refusalCode: text(pos["refusalCode"]),
            applicationVersion: text(pos["applicationVersion"]) ?? "unknown",
            configurationVersion:
              typeof pos["configurationVersion"] === "number" ? pos["configurationVersion"] : null,
            configurationFreshness: text(pos["configurationFreshness"]),
            terminalUnlocked: pos["terminalUnlocked"] === true || pos["staffSignedIn"] === true,
          },
  };
}

function terminalPinDto(value: unknown): NonNullable<TerminalRuntimeDto["hubLink"]>["terminalPin"] {
  if (value === null || typeof value !== "object") return null;
  const pin = value as Record<string, unknown>;
  const state = pin["state"];
  if (state !== "setup_required" && state !== "set" && state !== "reset_required") return null;
  return { state, setAt: text(pin["setAt"]), lockedUntil: text(pin["lockedUntil"]) };
}

function toTerminalDto(row: TerminalRow): PhysicalTerminalDto {
  return {
    physicalTerminalId: row.id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.store_location_id,
    locationReference: row.location_reference,
    label: row.label,
    terminalProfileKeys: row.terminal_profile_keys ?? [],
    boundDevice:
      row.bound_device_id === null || row.bound_device_reference === null
        ? null
        : {
            deviceId: row.bound_device_id,
            deviceReference: row.bound_device_reference,
            lifecycle: row.bound_lifecycle ?? "unknown",
            assignmentState: row.bound_assignment_state,
          },
    lastSession:
      row.session_id === null || row.session_state === null || row.session_expires_at === null
        ? null
        : {
            sessionId: row.session_id,
            state: row.session_state,
            expiresAt: iso(row.session_expires_at),
            pairedAt: row.session_paired_at === null ? null : iso(row.session_paired_at),
            failedAttemptCount: Number(row.session_failed ?? 0),
            locked: row.session_locked_at !== null,
          },
    runtime: row.bound_device_id === null ? null : toRuntimeDto(row),
    createdAt: iso(row.created_at),
  };
}

/**
 * The seats of ONE Store. The caller passes a Store it has already been
 * authorized for; this function deliberately does no authorization of its own.
 */
export async function listPhysicalTerminals(
  deps: TerminalProvisioningDeps,
  digitalStoreId: string,
): Promise<readonly PhysicalTerminalDto[]> {
  const { rows } = await deps.pool.query<TerminalRow>(
    `${TERMINAL_SELECT}
   where pt.digital_store_id = $1::uuid
   order by pt.created_at, pt.label`,
    [digitalStoreId],
  );
  return rows.map(toTerminalDto);
}

export async function readPhysicalTerminal(
  deps: TerminalProvisioningDeps,
  physicalTerminalId: string,
): Promise<PhysicalTerminalDto | null> {
  const { rows } = await deps.pool.query<TerminalRow>(
    `${TERMINAL_SELECT}
   where pt.id = $1::uuid`,
    [physicalTerminalId],
  );
  const row = rows[0];
  return row === undefined ? null : toTerminalDto(row);
}

/** Which Store a seat belongs to, for the ownership check. Null when absent. */
export async function readPhysicalTerminalScope(
  deps: TerminalProvisioningDeps,
  physicalTerminalId: string,
): Promise<{ readonly digitalStoreId: string } | null> {
  const { rows } = await deps.pool.query<{ digital_store_id: string }>(
    `select digital_store_id from kitluy_devices.physical_terminals where id = $1::uuid`,
    [physicalTerminalId],
  );
  const id = rows[0]?.digital_store_id;
  return id === undefined ? null : { digitalStoreId: id };
}

export async function readTerminalPairingSession(
  deps: TerminalProvisioningDeps,
  sessionId: string,
): Promise<TerminalPairingSessionStatus | null> {
  const { rows } = await deps.pool.query<{
    id: string;
    physical_terminal_id: string;
    digital_store_id: string;
    state: string;
    paired_at: Date | string | null;
    paired_device_id: string | null;
    asset_tag: string | null;
    failed_attempt_count: string | number;
    locked_at: Date | string | null;
    expires_at: Date | string;
    terminal_profile_keys: string[] | null;
  }>(
    `select s.id, s.physical_terminal_id, s.digital_store_id, s.state::text as state,
            s.paired_at, s.paired_device_id, d.asset_tag, s.failed_attempt_count,
            s.locked_at, s.expires_at, s.terminal_profile_keys
       from kitluy_devices.terminal_pairing_sessions s
       left join kitluy_devices.devices d on d.id = s.paired_device_id
      where s.id = $1::uuid`,
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    sessionId: row.id,
    physicalTerminalId: row.physical_terminal_id,
    digitalStoreId: row.digital_store_id,
    state: row.state,
    pairedAt: row.paired_at === null ? null : iso(row.paired_at),
    pairedDeviceId: row.paired_device_id,
    pairedDeviceReference: row.asset_tag,
    failedAttemptCount: Number(row.failed_attempt_count ?? 0),
    lockedAt: row.locked_at === null ? null : iso(row.locked_at),
    expiresAt: iso(row.expires_at),
    terminalProfileKeys: row.terminal_profile_keys ?? [],
  };
}

/**
 * Whether each Store has a Store Hub that can serve terminals.
 *
 * `active` means a projected assignment for a `store_hub` device — written
 * only by successful activation (0121), the same fact the session door checks.
 * `pending_trust` is a paired Hub still waiting on activation. `none` is the
 * honest answer for a shop with no Hub. Read with the trusted identity after
 * the caller has been authorized for these Stores.
 */
export async function readStoreHubReadiness(
  deps: TerminalProvisioningDeps,
  digitalStoreIds: readonly string[],
): Promise<ReadonlyMap<string, StoreHubReadiness>> {
  const out = new Map<string, StoreHubReadiness>();
  if (digitalStoreIds.length === 0) return out;
  const { rows } = await deps.pool.query<{
    digital_store_id: string;
    asset_tag: string | null;
    state: string;
  }>(
    `select x.digital_store_id, x.asset_tag, x.state
       from (
         select p.digital_store_id, d.asset_tag, 'active'::text as state, 0 as rank, p.projected_at as at
           from kitluy_devices.device_assignment_projections p
           join kitluy_devices.devices d on d.id = p.device_id and d.device_class = 'store_hub'
          where p.digital_store_id = any ($1::uuid[])
         union all
         select a.digital_store_id, d.asset_tag, a.state::text, 1, a.valid_from
           from kitluy_devices.device_assignments a
           join kitluy_devices.devices d on d.id = a.device_id and d.device_class = 'store_hub'
          where a.digital_store_id = any ($1::uuid[]) and a.state = 'pending_trust'
       ) x
      order by x.digital_store_id, x.rank, x.at`,
    [[...digitalStoreIds]],
  );
  for (const r of rows) {
    if (!out.has(r.digital_store_id)) {
      out.set(r.digital_store_id, { deviceReference: r.asset_tag, state: r.state });
    }
  }
  for (const id of digitalStoreIds) {
    if (!out.has(id)) out.set(id, { deviceReference: null, state: "none" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Governed writes (as kitluy_terminal_issuance_service)
// ---------------------------------------------------------------------------

export async function definePhysicalTerminal(
  deps: TerminalProvisioningDeps,
  input: {
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    /** Null means "generate one" (owner clarification 2026-09-04). */
    readonly label: string | null;
    readonly terminalProfileKeys: readonly string[];
    readonly operatorRef: string;
  },
): Promise<{ readonly kind: "defined"; readonly terminal: PhysicalTerminalDto } | TerminalRefusal> {
  let id: string;
  try {
    const result = await asIssuer(deps, (client) =>
      callDoor(
        client,
        "kitluy_devices.define_physical_terminal_v1($1::uuid, $2::uuid, $3, $4::text[], $5)",
        [
          input.digitalStoreId,
          input.storeLocationId,
          input.label,
          [...input.terminalProfileKeys],
          input.operatorRef,
        ],
      ),
    );
    if (result.outcome !== "DEFINED" || typeof result.physical_terminal_id !== "string") {
      return refusalOf(result, "KLUY-PHYSTERM-NOT-DEFINED");
    }
    id = result.physical_terminal_id;
  } catch {
    return { kind: "refused", code: "KLUY-PHYSTERM-NOT-DEFINED", detail: UNMAPPED_DETAIL };
  }
  const terminal = await readPhysicalTerminal(deps, id);
  if (terminal === null) {
    return { kind: "refused", code: "KLUY-PHYSTERM-NOT-DEFINED", detail: UNMAPPED_DETAIL };
  }
  return { kind: "defined", terminal };
}

export async function setPhysicalTerminalRoles(
  deps: TerminalProvisioningDeps,
  input: {
    readonly physicalTerminalId: string;
    readonly terminalProfileKeys: readonly string[];
    readonly operatorRef: string;
  },
): Promise<{ readonly kind: "set"; readonly terminal: PhysicalTerminalDto } | TerminalRefusal> {
  try {
    const result = await asIssuer(deps, (client) =>
      callDoor(client, "kitluy_devices.set_physical_terminal_roles_v1($1::uuid, $2::text[], $3)", [
        input.physicalTerminalId,
        [...input.terminalProfileKeys],
        input.operatorRef,
      ]),
    );
    if (result.outcome !== "ROLES_SET") return refusalOf(result, "KLUY-PHYSTERM-ROLES-NOT-SET");
  } catch {
    return { kind: "refused", code: "KLUY-PHYSTERM-ROLES-NOT-SET", detail: UNMAPPED_DETAIL };
  }
  const terminal = await readPhysicalTerminal(deps, input.physicalTerminalId);
  if (terminal === null) {
    return {
      kind: "refused",
      code: "KLUY-PHYSTERM-NOT-FOUND",
      detail: "no such physical terminal",
    };
  }
  return { kind: "set", terminal };
}

/**
 * Open a pairing session for ONE seat. The code is generated here from the
 * database's own alphabet, shown once, and never persisted or logged.
 */
export async function openTerminalPairingSession(
  deps: TerminalProvisioningDeps,
  input: { readonly physicalTerminalId: string; readonly operatorRef: string },
): Promise<
  { readonly kind: "issued"; readonly issued: IssuedTerminalPairingCode } | TerminalRefusal
> {
  try {
    return await asIssuer(deps, async (client) => {
      const { rows: alphabetRows } = await client.query<{ alphabet: string }>(
        "select kitluy_devices.hub_claim_code_alphabet_v1() as alphabet",
      );
      const alphabet = alphabetRows[0]?.alphabet;
      if (alphabet === undefined || alphabet.length === 0) {
        throw new Error("KLUY-TERMCODE-ALPHABET-UNAVAILABLE");
      }
      const code = generateCode(alphabet);
      const result = await callDoor(
        client,
        "kitluy_devices.open_terminal_pairing_session_v1($1::uuid, $2, $3::integer, $4)",
        [
          input.physicalTerminalId,
          createHash("sha256").update(code, "utf8").digest("hex"),
          HUB_PAIRING_TTL_SECONDS,
          input.operatorRef,
        ],
      );
      if (result.outcome !== "OPENED" || typeof result.session_id !== "string") {
        // Returning (not throwing) keeps the door's refusal; nothing was written.
        return refusalOf(result, "KLUY-TERMSESSION-NOT-OPENED");
      }
      return {
        kind: "issued",
        issued: {
          code,
          sessionId: result.session_id,
          expiresAt: iso(result.expires_at),
          physicalTerminalId: input.physicalTerminalId,
          label: typeof result.label === "string" ? result.label : "",
          terminalProfileKeys: strings(result.terminal_profile_keys),
          storeHubReference:
            typeof result.store_hub_reference === "string" ? result.store_hub_reference : null,
          environment: typeof result.environment === "string" ? result.environment : null,
        },
      };
    });
  } catch {
    return {
      kind: "refused",
      code: "KLUY-TERMSESSION-NOT-OPENED",
      detail: "the pairing session could not be opened",
    };
  }
}

export async function cancelTerminalPairingSession(
  deps: TerminalProvisioningDeps,
  input: { readonly sessionId: string; readonly operatorRef: string },
): Promise<{ readonly kind: "cancelled" | "already_closed" | "unknown"; readonly state: string }> {
  try {
    const result = await asIssuer(deps, (client) =>
      callDoor(client, "kitluy_devices.cancel_terminal_pairing_session_v1($1::uuid, $2, $3)", [
        input.sessionId,
        input.operatorRef,
        "operator_cancelled",
      ]),
    );
    const state = typeof result.state === "string" ? result.state : "unknown";
    if (result.outcome === "CANCELLED") return { kind: "cancelled", state };
    if (result.outcome === "ALREADY_CLOSED") return { kind: "already_closed", state };
    return { kind: "unknown", state };
  } catch {
    return { kind: "unknown", state: "unknown" };
  }
}
