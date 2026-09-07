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
 * clock, read as `cloud_authoritative` INSIDE the database (group 0200).
 *
 * It does not decide WHAT TIME IT IS either, and that is R-1. The shipped
 * version passed `now()` into a `p_authenticated_network_time` parameter on the
 * governed bridge. An external security review passed `now() + 3650 days`
 * through that same parameter and permanently advanced a device's trusted-time
 * floor a decade into the future; because the floor is monotonic, every later
 * observation reads as `restricted_clock_rollback` and certificate issuance,
 * activation and renewal all refuse with no recovery. Group 0198 removed the
 * timestamps from the boundary, so this layer can REQUEST trusted time and has
 * no way to supply its value.
 *
 * `cloud_authoritative` is explicitly NOT a production source: it carries no
 * signature a device could verify offline, and production needs NTS or a signed
 * `trusted_time_bootstrap` token, both still unimplemented and neither weakened
 * here. The environment is passed to the governed doors, which refuse pilot and
 * production themselves.
 */
import type pg from "pg";

import type { HardwareTrustLevel } from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "./database.js";
import { issueFirstOperationalCertificate } from "./first-operational-issuance.js";

/**
 * What the DEVICE contributes to its own certificate.
 *
 * The operational private key is generated on the Hub and never leaves it, so
 * this layer cannot manufacture these values on the device's behalf — that is
 * the whole point of proof of possession. They arrive from the device and are
 * carried through unchanged.
 */
export interface OperationalCertificateRequest {
  readonly assignmentGeneration: number;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  /** The PUBLIC half. The private half stays on the Hub. */
  readonly operationalPublicKeyPem: string;
  readonly operationalKeyHandle: string;
  /** `kitluy.csr.v1`, signed by the device under the key above. */
  readonly proofOfPossession: Uint8Array;
  readonly requestId: string;
  readonly nonce: string;
  readonly correlationId: string;
  readonly requestedAt: Date;
}

export type TrustAdvanceOutcome =
  | {
      readonly kind: "advanced";
      /** Where the device actually landed. `active` only when everything held. */
      readonly lifecycleState: string;
      readonly trustedTimeStatus: string;
      /**
       * `ISSUED` first time, `REPLAYED` on a retry, `CSR_REQUIRED` when the
       * device has not yet presented a key, or the verbatim refusal code.
       */
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
    /**
     * Absent until the device asks. Pairing itself cannot supply it: the Hub
     * generates its operational key at firstboot and proves possession then.
     */
    readonly operationalRequest?: OperationalCertificateRequest;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<TrustAdvanceOutcome> {
  let trustedTimeStatus = "unknown";
  let certificate = "NOT_ATTEMPTED";

  try {
    // --- 1. Trusted time, as the activation identity -------------------------
    trustedTimeStatus = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
      const { rows } = await c.query<TrustedTimeRow>(
        // FROM-clause form, deliberately — the same rule `trusted-time-gateway.ts`
        // records for the identical function, and reintroduced here when this
        // caller was written.
        //
        // `select (fn(...)).*` expands the composite by re-evaluating the
        // function ONCE PER FIELD. `trusted_time_outcome` has seven fields, so
        // this ran the governed door SEVEN times per pairing: seven trusted-time
        // evaluations, seven `device_trusted_time_events` rows and seven
        // different `gen_random_uuid()` correlation ids for one event, with the
        // reported `status` taken from a later call that already saw the floor
        // its own earlier call had advanced. An audit trail that multiplies a
        // security decision by seven cannot be reconciled against what happened.
        //
        // Called in FROM it is evaluated exactly once. (Measured on this
        // schema: SELECT-list form -> 7 executions, FROM form -> 1.)
        // THE CALLER NAMES NO TIME. R-1: this call used to hand the door
        // `now()` in a `p_authenticated_network_time` parameter, and an external
        // review passed `now() + 3650 days` through the same parameter to
        // advance a device's floor ten years — permanently, because the floor is
        // monotonic. The parameters are gone from the boundary (group 0198); the
        // authoritative value is read inside the database. This layer can ask
        // for trusted time and cannot say what it is.
        `select status
           from kitluy_devices.establish_device_trusted_time_v1(
                  $1::uuid, $2::text, gen_random_uuid()
                )`,
        [input.deviceRecordId, input.environment],
      );
      return rows[0]?.status ?? "unknown";
    });

    // --- 2. Certificate, THROUGH THE GOVERNED COMPOSITION -------------------
    // This step used to call `issue_development_device_certificate_v1`, which
    // writes a METADATA-ONLY `device_certificates` row: a status, a window and a
    // fingerprint, but no `certificate_pem`, no `certificate_sha256` and no
    // `credential_id`. Nothing a TLS stack can present, and nothing bound to the
    // governed credential it claimed to represent.
    //
    // Group 0201 made activation verify the ARTIFACT and its credential linkage,
    // so that row can no longer satisfy activation — and its `status = 'active'`
    // would occupy `device_certificates_one_active_uq` against the real
    // certificate. Keeping the call would not merely be useless, it would block
    // the genuine issuance. It is therefore gone from this path rather than
    // retained beside it.
    //
    // Issuance now needs something only the DEVICE can produce, and that is not
    // an obstacle to route around: a certificate is a statement about a key, and
    // a control plane that generated that key would be certifying itself. With
    // no request, this layer does not fabricate one — it reports that the device
    // has not asked yet and lets activation refuse for the true reason.
    if (input.operationalRequest === undefined) {
      certificate = "CSR_REQUIRED";
    } else {
      const issued = await issueFirstOperationalCertificate(
        pool,
        {
          deviceRecordId: input.deviceRecordId,
          environment: input.environment,
          trustedTimeStatus,
          actorRef: input.actorRef,
          ...input.operationalRequest,
        },
        env,
      );
      // Verbatim, like every other refusal on this path.
      certificate = issued.outcome === "REFUSED" ? issued.refusalCode : issued.outcome;
    }

    // --- 3. Activation, back as the activation identity ----------------------
    const act = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
      const { rows } = await c.query<ActivationRow>(
        // FROM-clause form, for the reason recorded on the trusted-time call
        // above. `activation_outcome` has six fields, so the SELECT-list form
        // ATTEMPTED ACTIVATION SIX TIMES per pairing — six passes through the
        // only reachable activation path, each committing its own evidence
        // event, and the returned `outcome` and `lifecycle_state` read from two
        // different attempts.
        `select outcome, lifecycle_state, refusal_code, refusal_message
           from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, $3::text)`,
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
