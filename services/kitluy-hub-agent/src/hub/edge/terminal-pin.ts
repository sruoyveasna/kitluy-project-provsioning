/**
 * The Terminal PIN on the Store Hub — TERMINAL-PIN-AND-REAL-POS-AUTH-001.
 *
 * Authority:
 *   KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§15 (LOCKED) — a 4-digit PIN
 *     created twice after the application installs, verified by the Store Hub
 *     against a salted Argon2id verifier, throttled on the Hub, reset only by a
 *     governed, audited action.
 *   KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 (owner ruling) — ONE
 *     shared Terminal PIN per device, PIN alone, no staff login or logout: the
 *     device credential plus the PIN unlock is the T1 operating credential;
 *     5 failures within 15 minutes lock the PIN for 15 minutes.
 *
 * ===========================================================================
 * TWO CREDENTIALS, BOTH REQUIRED
 * ===========================================================================
 *   device  the operational certificate: the router maps the mTLS peer onto a
 *           current credential on EVERY request, and the routes demand runtime
 *           eligibility before this module sets, verifies or changes a PIN;
 *   human   the Terminal PIN, verified here and nowhere else.
 * A PIN never stands in for the certificate — an untrusted terminal is refused
 * before its PIN is read. The certificate never stands in for the PIN — a
 * trusted terminal gets no T1 session without one.
 *
 * ===========================================================================
 * STORAGE AND ATTEMPTS
 * ===========================================================================
 * The verifier is an Argon2id PHC string with a fresh 16-byte salt, m=19456 KiB,
 * t=2, p=1 (the OWASP minimum Argon2id profile). §12 names Argon2id and no cost
 * parameters, so these are PROVISIONAL development values, recorded as such.
 *
 * Failures are counted in `edge_identity.terminal_pin`, inside the same
 * transaction as the verification and under a lock on the terminal row, so two
 * guesses at once still count as two and a reboot or a GUI restart resets
 * nothing (§13). While the PIN is locked no PIN is verified at all.
 *
 * NOTHING HERE LOGS, RETURNS OR PERSISTS A PIN.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { argon2id, argon2Verify } from "hash-wasm";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubClient, type HubPool } from "../db.js";
import { appendAuditEvent, recordSecurityEvent } from "../repositories/audit.js";
import { allocateHubSequence } from "../repositories/sync.js";
import {
  T1_PROFILE_CODE,
  T1_TERMINAL_PIN_PERMISSIONS,
  type StaffSessionPayload,
} from "./runtime-bootstrap.js";

/** Exactly four digits (§10). */
export const TERMINAL_PIN_PATTERN = /^[0-9]{4}$/u;

/** Owner ruling 2026-09-17: 5 failures within 15 minutes lock for 15 minutes. */
export const TERMINAL_PIN_FAILURE_LIMIT = 5;
export const TERMINAL_PIN_FAILURE_WINDOW_MINUTES = 15;
export const TERMINAL_PIN_LOCK_MINUTES = 15;

/**
 * How long a PIN unlock lasts. Store Hub LAN API v1.0.0: "Session tokens expire
 * after … 8 hours absolute by default". PROVISIONAL: there is no owner
 * session-policy value, and no idle lock is built in this slice.
 */
export const TERMINAL_PIN_SESSION_HOURS = 8;

/** Argon2id cost profile (provisional; see the header). */
export const TERMINAL_PIN_ARGON2 = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
} as const;

const VERIFIER_PATTERN =
  /^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u;

export type TerminalPinState = "setup_required" | "set" | "reset_required";

/** What anyone may know about a terminal's PIN. Never the PIN, never the verifier. */
export interface TerminalPinStatus {
  readonly state: TerminalPinState;
  readonly pinVersion: number;
  readonly setAt: string | null;
  /** Set only while the PIN is locked. */
  readonly lockedUntil: string | null;
  readonly attemptsBeforeLock: number;
}

export interface TerminalPinSessionPayload extends StaffSessionPayload {
  readonly credentialKind: "terminal_pin";
}

export type TerminalPinRefusal =
  | "PIN_FORMAT_INVALID"
  | "PIN_CONFIRMATION_MISMATCH"
  | "PIN_ALREADY_SET"
  | "PIN_SETUP_REQUIRED"
  | "PIN_INCORRECT"
  | "PIN_LOCKED"
  | "SESSION_UNKNOWN"
  | "SESSION_CLOSED"
  | "TERMINAL_UNKNOWN";

export type TerminalPinResult<T> =
  | { readonly outcome: "ok"; readonly result: string; readonly value: T }
  | {
      readonly outcome: "refused";
      readonly refusal: TerminalPinRefusal;
      readonly detail: string;
      /** The PIN's public state after the refusal, when it is meaningful to show. */
      readonly status?: TerminalPinStatus;
    };

// ---------------------------------------------------------------------------
// The verifier
// ---------------------------------------------------------------------------

/** A fresh Argon2id PHC verifier over a 4-digit PIN. */
export async function terminalPinVerifier(
  pin: string,
  salt: Uint8Array = randomBytes(TERMINAL_PIN_ARGON2.saltLength),
): Promise<string> {
  if (!TERMINAL_PIN_PATTERN.test(pin)) {
    throw new Error("KLUY-TERMINAL-PIN-FORMAT: a Terminal PIN is exactly four digits");
  }
  return argon2id({
    password: pin,
    salt,
    parallelism: TERMINAL_PIN_ARGON2.parallelism,
    iterations: TERMINAL_PIN_ARGON2.iterations,
    memorySize: TERMINAL_PIN_ARGON2.memorySize,
    hashLength: TERMINAL_PIN_ARGON2.hashLength,
    outputType: "encoded",
  });
}

/** Constant-work verification. A malformed PIN or verifier never verifies. */
export async function verifyTerminalPin(pin: string, verifier: string): Promise<boolean> {
  if (!TERMINAL_PIN_PATTERN.test(pin) || !VERIFIER_PATTERN.test(verifier)) return false;
  try {
    return await argon2Verify({ password: pin, hash: verifier });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface TerminalRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
}

interface PinRow {
  readonly state: "set" | "reset_required";
  readonly verifier: string | null;
  readonly pin_version: number;
  readonly set_at: Date | null;
  readonly failed_attempts: number;
  readonly first_failed_at: Date | null;
  readonly locked_until: Date | null;
}

/** Serializes every PIN operation for one terminal behind its device row. */
async function lockTerminal(
  client: HubClient,
  terminalDeviceId: string,
): Promise<TerminalRow | null> {
  const result = await client.query<TerminalRow>(
    `select id, tenant_id, digital_store_id, location_id
       from edge_identity.terminal_device where id = $1::uuid for update`,
    [terminalDeviceId],
  );
  return result.rows[0] ?? null;
}

async function readPinRow(client: HubClient, terminalDeviceId: string): Promise<PinRow | null> {
  const result = await client.query<PinRow>(
    `select state, verifier, pin_version, set_at, failed_attempts, first_failed_at, locked_until
       from edge_identity.terminal_pin where terminal_device_id = $1::uuid`,
    [terminalDeviceId],
  );
  return result.rows[0] ?? null;
}

async function hubNow(client: HubClient): Promise<Date> {
  const result = await client.query<{ now: Date }>(`select now() as now`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("the Hub database returned no transaction time");
  return row.now;
}

const WINDOW_MS = TERMINAL_PIN_FAILURE_WINDOW_MINUTES * 60_000;

function windowExpired(row: PinRow, now: Date): boolean {
  return row.first_failed_at !== null && now.getTime() - row.first_failed_at.getTime() >= WINDOW_MS;
}

function statusOf(row: PinRow | null, now: Date): TerminalPinStatus {
  if (row === null) {
    return {
      state: "setup_required",
      pinVersion: 0,
      setAt: null,
      lockedUntil: null,
      attemptsBeforeLock: TERMINAL_PIN_FAILURE_LIMIT,
    };
  }
  const locked = row.locked_until !== null && row.locked_until.getTime() > now.getTime();
  const counted = windowExpired(row, now) ? 0 : row.failed_attempts;
  return {
    state: row.state,
    pinVersion: row.pin_version,
    setAt: row.set_at === null ? null : row.set_at.toISOString(),
    lockedUntil: locked && row.locked_until !== null ? row.locked_until.toISOString() : null,
    attemptsBeforeLock: locked ? 0 : Math.max(0, TERMINAL_PIN_FAILURE_LIMIT - counted),
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

async function hubDeviceId(client: HubClient): Promise<string> {
  const { rows } = await client.query<{ hub_device_id: string }>(
    `select hub_device_id from edge_identity.hub_assignment
      where ended_at is null order by assignment_generation desc limit 1`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("the Store Hub has no live assignment to record against");
  return row.hub_device_id;
}

/** An audit fact. `details` is redacted by construction: versions and codes only. */
async function audit(
  client: HubClient,
  terminal: TerminalRow,
  input: {
    readonly eventCode: string;
    readonly actorType: "terminal_device" | "operator";
    readonly reasonCode: string | null;
    readonly correlationId: string;
    readonly details: Readonly<Record<string, string | number | boolean | null>>;
  },
): Promise<void> {
  const payload = JSON.stringify(input.details);
  await appendAuditEvent(client, {
    id: randomUUID(),
    tenantId: terminal.tenant_id,
    digitalStoreId: terminal.digital_store_id,
    locationId: terminal.location_id,
    eventCode: input.eventCode,
    actorType: input.actorType,
    actorId: input.actorType === "terminal_device" ? terminal.id : null,
    requesterId: null,
    approverId: null,
    terminalDeviceId: terminal.id,
    hubDeviceId: await hubDeviceId(client),
    profileCode: T1_PROFILE_CODE,
    resourceType: "terminal_pin",
    resourceId: terminal.id,
    reasonCode: input.reasonCode,
    correlationId: input.correlationId,
    payloadSha256: createHash("sha256").update(payload, "utf8").digest("hex"),
    details: input.details,
    localSequence: await allocateHubSequence(client),
  });
}

async function security(
  client: HubClient,
  terminal: TerminalRow,
  eventCode: string,
  severity: "low" | "medium" | "high",
  details: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await recordSecurityEvent(client, {
    id: randomUUID(),
    tenantId: terminal.tenant_id,
    digitalStoreId: terminal.digital_store_id,
    locationId: terminal.location_id,
    eventCode,
    severity,
    deviceId: terminal.id,
    certificateSerial: null,
    details,
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Open the terminal's T1 session under its PIN. Any session still open on this
 * terminal's T1 profile is superseded first: one active session per terminal
 * profile (0012), and the newest unlock is the one in front of the counter.
 */
async function openPinSession(
  client: HubClient,
  terminal: TerminalRow,
  now: Date,
): Promise<TerminalPinSessionPayload> {
  const previous = await client.query<{ generation: number }>(
    `select coalesce(max(session_generation), 0)::int as generation
       from edge_identity.terminal_session
      where terminal_device_id = $1::uuid and profile_code = $2`,
    [terminal.id, T1_PROFILE_CODE],
  );
  await client.query(
    `update edge_identity.terminal_session
        set closed_at = now(), status = 'superseded'
      where terminal_device_id = $1::uuid and profile_code = $2 and closed_at is null`,
    [terminal.id, T1_PROFILE_CODE],
  );
  const sessionId = randomUUID();
  const generation = (previous.rows[0]?.generation ?? 0) + 1;
  const expiresAt = new Date(now.getTime() + TERMINAL_PIN_SESSION_HOURS * 3_600_000);
  await client.query(
    `insert into edge_identity.terminal_session
       (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
        profile_code, opened_at, expires_at, closed_at, session_generation,
        last_event_sequence, status, credential_kind)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $5::uuid,
             $6, $7, $8, null, $9, 0, 'open', 'terminal_pin')`,
    [
      sessionId,
      terminal.tenant_id,
      terminal.digital_store_id,
      terminal.location_id,
      terminal.id,
      T1_PROFILE_CODE,
      now,
      expiresAt,
      generation,
    ],
  );
  return {
    sessionId,
    actorId: terminal.id,
    displayName: "",
    profileCode: T1_PROFILE_CODE,
    openedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sessionGeneration: generation,
    effectivePermissions: [...T1_TERMINAL_PIN_PERMISSIONS],
    authorityTime: now.toISOString(),
    credentialKind: "terminal_pin",
  };
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

export interface TerminalPinSessionView {
  readonly state: "open" | "closed" | "expired" | "unknown";
  readonly expiresAt: string | null;
}

/**
 * The PIN's public state, and — when the terminal names the session it holds —
 * whether that session is still open. Terminal-scoped: a terminal learns about
 * its own PIN and its own sessions only.
 */
export async function readTerminalPinStatus(
  pool: HubPool,
  input: { readonly terminalDeviceId: string; readonly sessionId: string | null },
): Promise<{
  readonly pin: TerminalPinStatus;
  readonly session: TerminalPinSessionView | null;
  readonly authorityTime: string;
}> {
  return withHubTransaction(
    pool,
    async (client) => {
      const now = await hubNow(client);
      const pin = statusOf(await readPinRow(client, input.terminalDeviceId), now);
      let session: TerminalPinSessionView | null = null;
      if (input.sessionId !== null) {
        const found = await client.query<{
          closed_at: Date | null;
          expires_at: Date;
          credential_kind: string;
        }>(
          `select closed_at, expires_at, credential_kind from edge_identity.terminal_session
            where id = $1::uuid and terminal_device_id = $2::uuid`,
          [input.sessionId, input.terminalDeviceId],
        );
        const row = found.rows[0];
        session =
          row === undefined || row.credential_kind !== "terminal_pin"
            ? { state: "unknown", expiresAt: null }
            : row.closed_at !== null
              ? { state: "closed", expiresAt: row.expires_at.toISOString() }
              : row.expires_at.getTime() <= now.getTime()
                ? { state: "expired", expiresAt: row.expires_at.toISOString() }
                : { state: "open", expiresAt: row.expires_at.toISOString() };
      }
      return { pin, session, authorityTime: now.toISOString() };
    },
    HUB_RUNTIME_ROLE,
  );
}

function formatRefusal<T>(detail: string): TerminalPinResult<T> {
  return { outcome: "refused", refusal: "PIN_FORMAT_INVALID", detail };
}

/**
 * §10: create the PIN, entered twice. Allowed only while no PIN is set (first
 * setup, or after a governed reset). The PIN becomes the terminal's unlock
 * immediately, as a phone's does.
 */
export async function setupTerminalPin(
  pool: HubPool,
  input: {
    readonly terminalDeviceId: string;
    readonly pin: string;
    readonly pinConfirmation: string;
    readonly correlationId: string;
  },
): Promise<
  TerminalPinResult<{
    readonly session: TerminalPinSessionPayload;
    readonly pin: TerminalPinStatus;
  }>
> {
  if (!TERMINAL_PIN_PATTERN.test(input.pin) || !TERMINAL_PIN_PATTERN.test(input.pinConfirmation)) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  if (input.pin !== input.pinConfirmation) {
    return {
      outcome: "refused",
      refusal: "PIN_CONFIRMATION_MISMATCH",
      detail: "the two entries differ; enter the new PIN twice",
    };
  }
  // Hashed before the transaction: the lock is held for bookkeeping, not KDF work.
  const verifier = await terminalPinVerifier(input.pin);
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const now = await hubNow(client);
      const row = await readPinRow(client, terminal.id);
      if (row !== null && row.state === "set") {
        return {
          outcome: "refused",
          refusal: "PIN_ALREADY_SET",
          detail: "this terminal already has a PIN; change it, or have it reset",
          status: statusOf(row, now),
        };
      }
      const version = (row?.pin_version ?? 0) + 1;
      await client.query(
        `insert into edge_identity.terminal_pin
           (terminal_device_id, tenant_id, digital_store_id, location_id, state, verifier,
            pin_version, set_at, failed_attempts, first_failed_at, locked_until,
            last_unlocked_at, updated_at)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'set', $5, $6, now(), 0, null, null,
                 now(), now())
         on conflict (terminal_device_id) do update
            set state = 'set', verifier = excluded.verifier, pin_version = excluded.pin_version,
                set_at = now(), failed_attempts = 0, first_failed_at = null,
                locked_until = null, last_unlocked_at = now(), updated_at = now()`,
        [
          terminal.id,
          terminal.tenant_id,
          terminal.digital_store_id,
          terminal.location_id,
          verifier,
          version,
        ],
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.established",
        actorType: "terminal_device",
        reasonCode: row === null ? "first_setup" : "after_reset",
        correlationId: input.correlationId,
        details: { pinVersion: version },
      });
      const session = await openPinSession(client, terminal, now);
      const after = await readPinRow(client, terminal.id);
      return {
        outcome: "ok",
        result: "PIN_ESTABLISHED",
        value: { session, pin: statusOf(after, now) },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

type AttemptVerdict =
  | { readonly verified: true; readonly row: PinRow; readonly now: Date }
  | { readonly verified: false; readonly result: TerminalPinResult<never> };

/**
 * One counted attempt against the stored PIN, under the terminal-row lock.
 * The caller commits whatever this wrote, refusal included.
 */
async function attempt(
  client: HubClient,
  terminal: TerminalRow,
  pin: string,
): Promise<AttemptVerdict> {
  const now = await hubNow(client);
  const row = await readPinRow(client, terminal.id);
  if (row === null || row.state !== "set" || row.verifier === null) {
    return {
      verified: false,
      result: {
        outcome: "refused",
        refusal: "PIN_SETUP_REQUIRED",
        detail: "this terminal has no PIN yet; create one",
        status: statusOf(row, now),
      },
    };
  }
  if (row.locked_until !== null && row.locked_until.getTime() > now.getTime()) {
    await security(client, terminal, "TERMINAL_PIN_ATTEMPT_WHILE_LOCKED", "medium", {
      pinVersion: row.pin_version,
    });
    return {
      verified: false,
      result: {
        outcome: "refused",
        refusal: "PIN_LOCKED",
        detail: "too many incorrect PINs; wait until the lock ends",
        status: statusOf(row, now),
      },
    };
  }

  if (await verifyTerminalPin(pin, row.verifier)) {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = 0, first_failed_at = null, locked_until = null,
              last_unlocked_at = now(), updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id],
    );
    const fresh = await readPinRow(client, terminal.id);
    return { verified: true, row: fresh ?? row, now };
  }

  // A failure. The window restarts once it has passed; the lock replaces it.
  const counted =
    (windowExpired(row, now) || row.first_failed_at === null ? 0 : row.failed_attempts) + 1;
  if (counted >= TERMINAL_PIN_FAILURE_LIMIT) {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = 0, first_failed_at = null,
              locked_until = now() + make_interval(mins => $2::int), updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id, TERMINAL_PIN_LOCK_MINUTES],
    );
    await security(client, terminal, "TERMINAL_PIN_LOCKED", "high", {
      pinVersion: row.pin_version,
      failures: counted,
      lockMinutes: TERMINAL_PIN_LOCK_MINUTES,
    });
  } else {
    await client.query(
      `update edge_identity.terminal_pin
          set failed_attempts = $2::int,
              first_failed_at = case when $2::int = 1 then now() else first_failed_at end,
              locked_until = null, updated_at = now()
        where terminal_device_id = $1::uuid`,
      [terminal.id, counted],
    );
    await security(client, terminal, "TERMINAL_PIN_INCORRECT", "low", {
      pinVersion: row.pin_version,
      failures: counted,
    });
  }
  const after = await readPinRow(client, terminal.id);
  const status = statusOf(after, now);
  return {
    verified: false,
    result:
      status.lockedUntil !== null
        ? {
            outcome: "refused",
            refusal: "PIN_LOCKED",
            detail: "too many incorrect PINs; the Terminal PIN is locked",
            status,
          }
        : {
            outcome: "refused",
            refusal: "PIN_INCORRECT",
            detail: "the PIN is not correct",
            status,
          },
  };
}

/** Unlock the terminal with its PIN: a T1 session bound to this device. */
export async function unlockTerminalWithPin(
  pool: HubPool,
  input: {
    readonly terminalDeviceId: string;
    readonly pin: string;
    readonly correlationId: string;
  },
): Promise<
  TerminalPinResult<{
    readonly session: TerminalPinSessionPayload;
    readonly pin: TerminalPinStatus;
  }>
> {
  if (!TERMINAL_PIN_PATTERN.test(input.pin)) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const verdict = await attempt(client, terminal, input.pin);
      if (!verdict.verified) return verdict.result;
      await audit(client, terminal, {
        eventCode: "terminal_pin.unlocked",
        actorType: "terminal_device",
        reasonCode: null,
        correlationId: input.correlationId,
        details: { pinVersion: verdict.row.pin_version },
      });
      const session = await openPinSession(client, terminal, verdict.now);
      return {
        outcome: "ok",
        result: "TERMINAL_UNLOCKED",
        value: { session, pin: statusOf(verdict.row, verdict.now) },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

/** Change the PIN: the current PIN (a counted attempt), then the new one twice. */
export async function changeTerminalPin(
  pool: HubPool,
  input: {
    readonly terminalDeviceId: string;
    readonly currentPin: string;
    readonly newPin: string;
    readonly newPinConfirmation: string;
    readonly correlationId: string;
  },
): Promise<TerminalPinResult<{ readonly pin: TerminalPinStatus }>> {
  if (
    !TERMINAL_PIN_PATTERN.test(input.currentPin) ||
    !TERMINAL_PIN_PATTERN.test(input.newPin) ||
    !TERMINAL_PIN_PATTERN.test(input.newPinConfirmation)
  ) {
    return formatRefusal("a Terminal PIN is exactly four digits");
  }
  if (input.newPin !== input.newPinConfirmation) {
    return {
      outcome: "refused",
      refusal: "PIN_CONFIRMATION_MISMATCH",
      detail: "the two entries of the new PIN differ",
    };
  }
  const verifier = await terminalPinVerifier(input.newPin);
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const verdict = await attempt(client, terminal, input.currentPin);
      if (!verdict.verified) return verdict.result;
      const version = verdict.row.pin_version + 1;
      await client.query(
        `update edge_identity.terminal_pin
            set verifier = $2, pin_version = $3, set_at = now(), updated_at = now()
          where terminal_device_id = $1::uuid`,
        [terminal.id, verifier, version],
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.changed",
        actorType: "terminal_device",
        reasonCode: null,
        correlationId: input.correlationId,
        details: { pinVersion: version },
      });
      const after = await readPinRow(client, terminal.id);
      return { outcome: "ok", result: "PIN_CHANGED", value: { pin: statusOf(after, verdict.now) } };
    },
    HUB_RUNTIME_ROLE,
  );
}

/** Lock the terminal: close the PIN session it holds. */
export async function lockTerminalSession(
  pool: HubPool,
  input: { readonly terminalDeviceId: string; readonly sessionId: string },
): Promise<TerminalPinResult<{ readonly sessionId: string }>> {
  return withHubTransaction(
    pool,
    async (client) => {
      const found = await client.query<{ closed_at: Date | null; credential_kind: string }>(
        `select closed_at, credential_kind from edge_identity.terminal_session
          where id = $1::uuid and terminal_device_id = $2::uuid for update`,
        [input.sessionId, input.terminalDeviceId],
      );
      const row = found.rows[0];
      if (row === undefined || row.credential_kind !== "terminal_pin") {
        return { outcome: "refused", refusal: "SESSION_UNKNOWN", detail: "no such session" };
      }
      if (row.closed_at !== null) {
        return { outcome: "refused", refusal: "SESSION_CLOSED", detail: "the session is closed" };
      }
      await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'locked'
          where id = $1::uuid`,
        [input.sessionId],
      );
      return { outcome: "ok", result: "TERMINAL_LOCKED", value: { sessionId: input.sessionId } };
    },
    HUB_RUNTIME_ROLE,
  );
}

/**
 * §14 reset: the verifier is invalidated, every open PIN session on the terminal
 * is closed, and the terminal returns to "PIN setup/reset required". Governed:
 * the operator reference and reason are recorded in the immutable audit journal.
 */
export async function resetTerminalPin(
  pool: HubPool,
  input: {
    readonly terminalDeviceId: string;
    readonly actorRef: string;
    readonly reasonCode: string;
    readonly correlationId: string;
  },
): Promise<
  TerminalPinResult<{ readonly pin: TerminalPinStatus; readonly sessionsClosed: number }>
> {
  if (
    !/^[A-Za-z0-9_.:-]{3,64}$/u.test(input.actorRef) ||
    !/^[a-z0-9_]{3,48}$/u.test(input.reasonCode)
  ) {
    return {
      outcome: "refused",
      refusal: "PIN_FORMAT_INVALID",
      detail: "an operator reference and a snake_case reason code are required",
    };
  }
  return withHubTransaction(
    pool,
    async (client) => {
      const terminal = await lockTerminal(client, input.terminalDeviceId);
      if (terminal === null) {
        return { outcome: "refused", refusal: "TERMINAL_UNKNOWN", detail: "unknown terminal" };
      }
      const now = await hubNow(client);
      const row = await readPinRow(client, terminal.id);
      if (row === null || row.state !== "set") {
        return {
          outcome: "ok",
          result: "PIN_SETUP_ALREADY_REQUIRED",
          value: { pin: statusOf(row, now), sessionsClosed: 0 },
        };
      }
      await client.query(
        `update edge_identity.terminal_pin
            set state = 'reset_required', verifier = null, set_at = null,
                failed_attempts = 0, first_failed_at = null, locked_until = null,
                updated_at = now()
          where terminal_device_id = $1::uuid`,
        [terminal.id],
      );
      const closed = await client.query(
        `update edge_identity.terminal_session set closed_at = now(), status = 'reset'
          where terminal_device_id = $1::uuid and credential_kind = 'terminal_pin'
            and closed_at is null`,
        [terminal.id],
      );
      await audit(client, terminal, {
        eventCode: "terminal_pin.reset",
        actorType: "operator",
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        details: { previousPinVersion: row.pin_version, operatorReference: input.actorRef },
      });
      const after = await readPinRow(client, terminal.id);
      return {
        outcome: "ok",
        result: "PIN_RESET",
        value: { pin: statusOf(after, now), sessionsClosed: closed.rowCount ?? 0 },
      };
    },
    HUB_RUNTIME_ROLE,
  );
}
