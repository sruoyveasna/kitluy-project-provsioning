/**
 * Advancing a paired device to `active`.
 *
 * Authority: KLD-2026-07-28-002 (BLK-005) — development certificate
 * implementation AUTHORIZED, pilot and production BLOCKED;
 * KLD-2026-07-21-003 (activation is certificate-backed);
 * KLREC-2026-08-11-EDGE-004 §2 and §3; migration groups 0198 (activation
 * identity, trusted-time bridge) and 0199 (the separate certificate issuer);
 * group 0123 (trusted time), group 0124 (activation).
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A Hub that paired rested at `awaiting_trust` for ever. Nothing in the product
 * called `attempt_activate_device_v1` — it had no non-test caller anywhere —
 * nothing established trusted time, and nothing issued a certificate. Three
 * governed steps were implemented in the database and none was reachable.
 *
 * The widely-held belief was that certificates blocked this. For DEVELOPMENT
 * they never did: group 0122 §5 inserted an active development
 * `pki_trust_configuration` row when the owner approved BLK-005. The gates in
 * order are trusted time, then a certificate, then activation.
 *
 * ===========================================================================
 * TWO IDENTITIES, AND WHY IT COSTS AN EXTRA TRANSACTION
 * ===========================================================================
 * `set local role` dies with its transaction, so a second role requires a second
 * transaction. That is not overhead to engineer away — it IS the separation of
 * duty:
 *
 *   kitluy_activation_service          trusted time, activation
 *   kitluy_device_certificate_issuer   certificate issuance
 *
 * Group 0199 asserts on apply that the issuer cannot activate and the activation
 * identity cannot issue. So no single identity in this flow can mint an
 * operational credential and then consume it, which is the whole point: an
 * activation service that issued its own certificate would be checking its own
 * homework.
 *
 * ===========================================================================
 * WHAT THIS LAYER DOES NOT DECIDE
 * ===========================================================================
 * Not the time source, not the key, not the serial, not the validity window, not
 * the issuing CA. The device offers nothing — a Pi 5 has no battery-backed RTC
 * and holds no signed time token — so the only source is the control plane's own
 * clock, offered as `authenticated_network`. That is explicitly NOT a production
 * source: it carries no signature a device could verify offline, and production
 * needs NTS or a signed `trusted_time_bootstrap` token, both still unimplemented
 * and neither weakened here. The environment is passed to the governed doors,
 * which refuse pilot and production themselves.
 */
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole } from "./database.js";

export type TrustAdvanceOutcome =
  | {
      readonly kind: "advanced";
      /** Where the device actually landed. `active` only when everything held. */
      readonly lifecycleState: string;
      readonly trustedTimeStatus: string;
      /** `ISSUED` first time, `ALREADY_ISSUED` on a retry. */
      readonly certificate: string;
    }
  | {
      readonly kind: "blocked";
      readonly lifecycleState: string;
      readonly trustedTimeStatus: string;
      readonly certificate: string;
      /** The governed refusal code, verbatim. Names the NEXT real obstacle. */
      readonly refusalCode: string;
      readonly detail: string;
    }
  | { readonly kind: "failed"; readonly detail: string };

interface TrustedTimeRow {
  status: string;
}
interface ActivationRow {
  outcome: string;
  lifecycle_state: string;
  refusal_code: string | null;
  refusal_message: string | null;
}
interface IssuanceRow {
  result: { outcome?: string; refusal_code?: string } | null;
}

/**
 * Establish trusted time, issue a development certificate, then activate.
 *
 * Never throws. A device that has just paired must not have its pairing reported
 * as a failure because a later step could not complete — the Store assignment is
 * real either way.
 */
export async function advanceDeviceTrust(
  pool: pg.Pool,
  input: {
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly actorRef: string;
  },
): Promise<TrustAdvanceOutcome> {
  let trustedTimeStatus = "unknown";
  let certificate = "NOT_ATTEMPTED";

  try {
    // --- 1. Trusted time, as the activation identity -------------------------
    trustedTimeStatus = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
      const { rows } = await c.query<TrustedTimeRow>(
        `select (kitluy_devices.establish_device_trusted_time_v1(
                   $1::uuid, $2::text, null, now(), null, gen_random_uuid())).*`,
        [input.deviceRecordId, input.environment],
      );
      return rows[0]?.status ?? "unknown";
    });

    // --- 2. Certificate, as the ISSUER identity ------------------------------
    // A separate transaction because it is a separate authority. See the header.
    certificate = await withServiceRole(pool, REGISTRY_ROLES.certificateIssuer, async (c) => {
      const { rows } = await c.query<IssuanceRow>(
        `select kitluy_devices.issue_development_device_certificate_v1(
                  $1::uuid, $2::text, $3::text) as result`,
        [input.deviceRecordId, input.environment, input.actorRef],
      );
      const r = rows[0]?.result;
      return r?.outcome === "REFUSED"
        ? (r.refusal_code ?? "REFUSED")
        : (r?.outcome ?? "NO_OUTCOME");
    });

    // --- 3. Activation, back as the activation identity ----------------------
    const act = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
      const { rows } = await c.query<ActivationRow>(
        `select (kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, $3::text)).*`,
        [input.deviceRecordId, input.environment, input.actorRef],
      );
      return rows[0];
    });

    if (act === undefined) {
      return { kind: "failed", detail: "activation returned no outcome" };
    }
    if (act.outcome === "ACTIVATED" || act.lifecycle_state === "active") {
      return {
        kind: "advanced",
        lifecycleState: act.lifecycle_state,
        trustedTimeStatus,
        certificate,
      };
    }
    return {
      kind: "blocked",
      lifecycleState: act.lifecycle_state,
      trustedTimeStatus,
      certificate,
      // Verbatim. `KLUY-DEVICE-NO-CERTIFICATE` and `KLUY-DEVICE-TIME-RESTRICTED`
      // demand completely different next actions, and a surface that flattened
      // them to "not active yet" would make the difference invisible.
      refusalCode: act.refusal_code ?? "KLUY-DEVICE-ACTIVATION-REFUSED",
      detail: act.refusal_message ?? "activation was refused",
    };
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : "trust advance failed",
    };
  }
}
