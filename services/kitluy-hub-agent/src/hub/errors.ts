/**
 * Hub command-layer error vocabulary.
 *
 * Authority:
 *   - `kitluy-offline-idempotency-and-sequencing-v1.0.0.md` §19 (error table,
 *     reproduced by the Hub procedures in hub/migrations/0013).
 *   - WS-09-T004 failure modes: "same key + different payload fails with
 *     IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST".
 *   - KLD-2026-07-26-002 Group 3: permission key, API scope, resource scope,
 *     environment scope, device/profile authorisation and approval policy are
 *     SEPARATE dimensions — each therefore carries its OWN denial code, so a
 *     denial can never be mistaken for a different dimension passing.
 *
 * Every code here is a REFUSAL. No code in this module ever describes a
 * successful cloud outcome: cloud acknowledgement belongs to WS-10.
 */

export const HUB_COMMAND_ERROR_CODES = [
  // --- offline contract §19 -------------------------------------------------
  "EDGE_IDEMPOTENCY_KEY_MALFORMED",
  "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
  /** WS-09-T004 vocabulary for the same fact as EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH. */
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "EDGE_SEQUENCE_REPLAY_REJECTED",
  "EDGE_SEQUENCE_GAP",
  "EDGE_AGGREGATE_VERSION_CONFLICT",
  "EDGE_SCOPE_MISMATCH",
  "EDGE_TERMINAL_UNKNOWN",

  // --- authorisation dimensions (fail closed, one code per dimension) -------
  "EDGE_DEVICE_CONTEXT_INVALID",
  "EDGE_DEVICE_NOT_ASSIGNED",
  "EDGE_DEVICE_REVOKED",
  "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
  "EDGE_SESSION_INVALID",
  "EDGE_SESSION_EXPIRED",
  "EDGE_PROFILE_NOT_AUTHORIZED",
  "EDGE_PERMISSION_DENIED",
  /** KLREQ-015: the route carries a `[REQUIRED: ...]` marker and stays INACTIVE. */
  "EDGE_PERMISSION_KEY_UNREGISTERED",
  "EDGE_RESOURCE_SCOPE_DENIED",
  "EDGE_ENVIRONMENT_DENIED",
  "EDGE_APPROVAL_REQUIRED",
  "EDGE_SELF_APPROVAL_FORBIDDEN",

  // --- business/engine refusals --------------------------------------------
  "EDGE_AGGREGATE_NOT_FOUND",
  "EDGE_INVALID_TRANSITION",
  "EDGE_PAYMENT_GATE_BLOCKED",
  "EDGE_CUSTODY_GATE_BLOCKED",
  "EDGE_CONFIGURATION_MISSING",
  "EDGE_REQUIRED_VALUE_MISSING",
  "EDGE_COMMAND_UNKNOWN",
  "EDGE_COMMAND_INACTIVE",
] as const;

export type HubCommandErrorCode = (typeof HUB_COMMAND_ERROR_CODES)[number];

export class HubCommandError extends Error {
  constructor(
    readonly code: HubCommandErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${message}`);
    this.name = "HubCommandError";
  }
}

/**
 * Maps a PostgreSQL error raised by the Hub procedures (0013) onto the command
 * vocabulary. The procedures raise `CODE: message` with errcode P0001, so the
 * code prefix is the authority — the message text is never parsed for meaning.
 */
export function fromDatabaseError(error: unknown): HubCommandError | undefined {
  const message = (error as { message?: string } | null)?.message;
  if (typeof message !== "string") return undefined;
  for (const code of HUB_COMMAND_ERROR_CODES) {
    if (message.startsWith(`${code}:`)) {
      return new HubCommandError(code, message.slice(code.length + 1).trim());
    }
  }
  return undefined;
}

/** True when `error` is a Hub refusal carrying `code`. */
export function isHubCommandError(error: unknown, code?: HubCommandErrorCode): boolean {
  if (!(error instanceof HubCommandError)) return false;
  return code === undefined || error.code === code;
}
