/**
 * Advancing a paired device toward `active`.
 *
 * Authority: KLD-2026-07-28-002 (BLK-005) — "development certificate
 * implementation AUTHORIZED", pilot and production BLOCKED;
 * KLREC-2026-08-11-EDGE-004 §2 and §3; migration group 0198 (the
 * `kitluy_activation_service` identity and the trusted-time bridge);
 * group 0123 (the trusted-time model); group 0124 (activation).
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A Hub that paired rested at `awaiting_trust` for ever, because nothing in the
 * product called `attempt_activate_device_v1` — it had no non-test caller
 * anywhere — and nothing established the device's trusted time either. Both were
 * implemented in the database and simply unreachable.
 *
 * The widely-held belief was that certificates blocked this. They do not, for
 * development: group 0122 §5 inserted an ACTIVE development
 * `pki_trust_configuration` row when the owner approved BLK-005, so
 * `assert_pki_configuration_approved('development')` already succeeds. The real
 * gate was that a device cannot say what time it is.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE STEP FROM PAIRING
 * ===========================================================================
 * Group 0121's redemption deliberately stops at `awaiting_trust`. Folding
 * activation into it would erase a boundary the claim model draws on purpose, so
 * this runs AFTER pairing, in its own transaction, as its own identity. A pairing
 * that succeeds and an activation that refuses are two separate facts, and the
 * device is told both.
 *
 * ===========================================================================
 * WHY THE TIME SOURCE IS THE CONTROL PLANE, AND WHAT THAT IS NOT
 * ===========================================================================
 * The device offers nothing. A Raspberry Pi 5 has no battery-backed RTC, so it
 * wakes with no idea of the date, and it holds no signed time token. The only
 * source available is the control plane's own clock, offered as
 * `authenticated_network` — authenticated because it comes from a remote
 * authority over an authenticated channel rather than from local hardware.
 *
 * It is explicitly NOT a production source, and this file does not make it one.
 * It carries no signature a device could verify offline, so it cannot bootstrap a
 * Hub with no connectivity. Production needs NTS or a signed
 * `trusted_time_bootstrap` token bound to an activation challenge — both already
 * modelled in `@kitluy/device-identity`, both still unimplemented, and neither
 * weakened by this. The environment is passed through to the governed doors,
 * which refuse pilot and production themselves.
 */
import type pg from "pg";

export type TrustAdvanceOutcome =
  | {
      readonly kind: "advanced";
      /** Where the device actually landed. `active` only when everything held. */
      readonly lifecycleState: string;
      readonly trustedTimeStatus: string;
    }
  | {
      readonly kind: "blocked";
      readonly lifecycleState: string;
      readonly trustedTimeStatus: string;
      /** The governed refusal code, verbatim. Names the NEXT real obstacle. */
      readonly refusalCode: string;
      readonly detail: string;
    }
  | { readonly kind: "failed"; readonly detail: string };

interface TrustedTimeRow {
  status: string;
  restricted: boolean;
  detail: string | null;
}
interface ActivationRow {
  outcome: string;
  lifecycle_state: string;
  refusal_code: string | null;
  refusal_message: string | null;
}

/**
 * Establish trusted time, then attempt activation, in ONE transaction as
 * `kitluy_activation_service`.
 *
 * One transaction because the two are a single decision: activation reads the
 * trusted-time state this call just wrote, and a gap between them is a window in
 * which the floor could move. The identity holds exactly these two capabilities
 * and no table access — group 0198 asserts that on apply — and deliberately
 * cannot issue a certificate, because minting the credential and consuming it
 * must not be the same authority.
 *
 * Never throws. A device that has just paired must not have its pairing reported
 * as a failure because the step AFTER it could not complete.
 */
export async function advanceDeviceTrust(
  pool: pg.Pool,
  input: {
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly actorRef: string;
  },
): Promise<TrustAdvanceOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role kitluy_activation_service");

    const { rows: timeRows } = await client.query<TrustedTimeRow>(
      `select (kitluy_devices.establish_device_trusted_time_v1(
                 $1::uuid, $2::text, null, now(), null, gen_random_uuid())).*`,
      [input.deviceRecordId, input.environment],
    );
    const time = timeRows[0];
    const trustedTimeStatus = time?.status ?? "unknown";

    const { rows: actRows } = await client.query<ActivationRow>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, $3::text)).*`,
      [input.deviceRecordId, input.environment, input.actorRef],
    );
    await client.query("commit");

    const act = actRows[0];
    if (act === undefined) {
      return { kind: "failed", detail: "activation returned no outcome" };
    }
    if (act.outcome === "ACTIVATED" || act.lifecycle_state === "active") {
      return { kind: "advanced", lifecycleState: act.lifecycle_state, trustedTimeStatus };
    }
    return {
      kind: "blocked",
      lifecycleState: act.lifecycle_state,
      trustedTimeStatus,
      // The governed code, unchanged. This surface's job is to say WHICH gate is
      // still shut, not to soften it — `KLUY-DEVICE-NO-CERTIFICATE` and
      // `KLUY-DEVICE-TIME-RESTRICTED` demand completely different next actions.
      refusalCode: act.refusal_code ?? "KLUY-DEVICE-ACTIVATION-REFUSED",
      detail: act.refusal_message ?? "activation was refused",
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : "trust advance failed",
    };
  } finally {
    client.release();
  }
}
