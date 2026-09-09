/**
 * Device registration intake.
 *
 * Contract: `docs/api/device-registration-edge-function-v1.md`
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001, plan v1.0.0 §2
 *
 * ===========================================================================
 * WHAT THIS ROUTE GRANTS: NOTHING
 * ===========================================================================
 * It is the only KitLuy surface reachable without any prior credential, so the
 * safety argument cannot rest on authentication. It rests on the outcome: the
 * best result a caller can obtain is a row in state `manufactured`, which every
 * pairing, provisioning, activation and issuance path already refuses. Trust is
 * a separate, human, audited decision taken through the Management API.
 *
 * Read that as the reason the checks below are shaped the way they are. The
 * signature is not an authorization — it stops a captured request being replayed
 * against a different key, and nothing more (§6 of the contract).
 *
 * ===========================================================================
 * WHY IT DOES NOT RUN AS `service_role`
 * ===========================================================================
 * It connects as `service_role` — that is the only credential an Edge Function
 * has — and then immediately leaves it. `service_role` holds BYPASSRLS, and an
 * unauthenticated surface must never execute a statement with it. Everything
 * touching device data happens inside one transaction as
 * `kitluy_device_registration_service`, which holds EXECUTE on exactly two
 * functions and no table privilege at all.
 *
 * ===========================================================================
 * WHY THE DATABASE IS REACHED WITH `postgres` AND NOT `supabase-js`
 * ===========================================================================
 * `supabase.rpc()` cannot express `SET LOCAL ROLE`: it sends one statement
 * without a transaction, so there is nowhere to put the role change and no way
 * to guarantee the door and the role share a transaction. A direct connection
 * can, and that is the whole security posture of this route.
 */
import postgres from "npm:postgres@3.4.5";

import {
  DEVICE_REGISTRATION_REQUEST_KIND,
  type DeviceRegistrationRequest,
  verifyDeviceRegistrationRequest,
} from "../_shared/device-registration-canonical.ts";

/** Fields a device must never set. Presence is refused, not ignored. */
const UNPERMITTED_FIELDS = [
  "tenantId",
  "digitalStoreId",
  "storeLocationId",
  "deviceRecordId",
  "deviceId",
  "lifecycleState",
  "deviceClass",
  "assignmentId",
  "scopes",
  "certificate",
] as const;

const JSON_HEADERS = { "content-type": "application/json" } as const;

function refuse(status: number, code: string, detail?: string): Response {
  return new Response(JSON.stringify({ status: "REFUSED", code, detail: detail ?? null }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * The rejection vocabulary of the canonicalizer, mapped to the contract's wire
 * codes. Kept as an explicit table rather than a string transform so the wire
 * contract cannot change because an internal name was renamed.
 */
const REJECTION_WIRE: Record<string, { status: number; code: string }> = {
  REGISTRATION_MISSING_FIELD: { status: 400, code: "KLUY-REG-MALFORMED" },
  REGISTRATION_NO_SIGNALS: { status: 400, code: "KLUY-REG-MALFORMED" },
  REGISTRATION_SIGNAL_NOT_NORMALISED: {
    status: 400,
    code: "KLUY-REG-SIGNAL-NOT-NORMALISED",
  },
  REGISTRATION_RESERVED_CHARACTER: {
    status: 400,
    code: "KLUY-REG-CANONICAL-RESERVED-CHAR",
  },
  REGISTRATION_FINGERPRINT_FORMAT: { status: 400, code: "KLUY-REG-MALFORMED" },
  REGISTRATION_FINGERPRINT_MISMATCH: {
    status: 401,
    code: "KLUY-REG-FINGERPRINT-MISMATCH",
  },
  REGISTRATION_BAD_SIGNATURE: { status: 401, code: "KLUY-REG-BAD-SIGNATURE" },
};

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

interface RegistrationResult {
  readonly status: string;
  readonly device_id: string | null;
  readonly installation_id: string | null;
  readonly installation_created: boolean;
  readonly credential_reuse_detected: boolean;
  readonly conflict_reason: string | null;
}

/**
 * The database connection.
 *
 * `KITLUY_REGISTRATION_DSN` is required and is never defaulted to a guess. A
 * wrong-but-plausible default is how a registration ends up in the wrong
 * project, and a device cannot tell the difference.
 */
function connectionString(): string | null {
  const dsn = Deno.env.get("KITLUY_REGISTRATION_DSN");
  return dsn !== undefined && dsn.length > 0 ? dsn : null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return refuse(405, "KLUY-REG-METHOD-NOT-ALLOWED");
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse(400, "KLUY-REG-MALFORMED", "body is not JSON");
  }

  if (body["kind"] !== DEVICE_REGISTRATION_REQUEST_KIND) {
    return refuse(400, "KLUY-REG-MALFORMED", "unrecognised or missing kind");
  }

  const present = UNPERMITTED_FIELDS.filter((f) => body[f] !== undefined);
  if (present.length > 0) {
    // Named in the refusal on purpose. A client that believes it may set these
    // is a client to fix, and a silent drop would hide that.
    return refuse(400, "KLUY-REG-UNPERMITTED-FIELD", present.join(", "));
  }

  const pem = body["registrationPublicKeyPem"];
  const signatureB64 = body["signature"];
  if (typeof pem !== "string" || typeof signatureB64 !== "string") {
    return refuse(400, "KLUY-REG-MALFORMED", "missing key or signature");
  }
  const signature = decodeBase64(signatureB64);
  if (signature === null) {
    return refuse(400, "KLUY-REG-MALFORMED", "signature is not base64");
  }

  const signals = Array.isArray(body["signals"]) ? body["signals"] : null;
  const evidence = body["installationEvidence"];
  if (signals === null || typeof evidence !== "object" || evidence === null) {
    return refuse(400, "KLUY-REG-MALFORMED", "missing signals or installationEvidence");
  }

  const candidate: DeviceRegistrationRequest = {
    assetTag: String(body["assetTag"] ?? ""),
    hardwareProfileKey: String(body["hardwareProfileKey"] ?? ""),
    hostname: String(body["hostname"] ?? ""),
    registrationPublicKeyFingerprint: String(body["registrationPublicKeyFingerprint"] ?? ""),
    signals: signals.map((s) => {
      const signal = (s ?? {}) as Record<string, unknown>;
      return {
        signalType: String(signal["signalType"] ?? ""),
        signalValue: String(signal["signalValue"] ?? ""),
      };
    }),
    installationEvidence: Object.fromEntries(
      Object.entries(evidence as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    ),
  };

  // Proof of possession BEFORE any database work. Nothing is created for a
  // request that cannot prove it owns the key it presented.
  const verdict = await verifyDeviceRegistrationRequest(candidate, pem, signature);
  if (!verdict.verified) {
    const wire = REJECTION_WIRE[verdict.rejection ?? ""] ?? {
      status: 400,
      code: "KLUY-REG-MALFORMED",
    };
    return refuse(wire.status, wire.code);
  }

  const dsn = connectionString();
  if (dsn === null) {
    console.error("KITLUY_REGISTRATION_DSN is not configured");
    return refuse(500, "KLUY-REG-UPSTREAM");
  }

  const sql = postgres(dsn, { max: 1, prepare: false });
  try {
    const result = await sql.begin(async (tx) => {
      // Leave BYPASSRLS behind for the rest of the transaction.
      await tx.unsafe("set local role kitluy_device_registration_service");

      const [profile] = await tx<{ id: string | null }[]>`
        select kitluy_devices.hardware_profile_id_for_key_v1(
          ${candidate.hardwareProfileKey}::text) as id`;
      if (profile?.id === null || profile?.id === undefined) {
        return { unknownProfile: true as const };
      }

      // `tx.json(...)`, NOT `JSON.stringify(...)`. postgres.js encodes a JS
      // string destined for a json parameter as a JSON *string*, so a
      // stringified array arrives as a scalar and `jsonb_array_elements` fails
      // with "cannot extract elements from a scalar" (22023). Measured, not
      // assumed: `jsonb_typeof` returns `string` for the stringified form and
      // `array` for this one.
      //
      // The database's own signal vocabulary is snake_case, so the wire's
      // camelCase is translated HERE rather than either side compromising.
      const [row] = await tx<{ r: RegistrationResult }[]>`
        select kitluy_devices.register_device_v1(
          ${candidate.assetTag}::text,
          ${profile.id}::uuid,
          ${candidate.registrationPublicKeyFingerprint}::text,
          ${candidate.hostname}::text,
          ${
            tx.json(
              candidate.signals.map((s) => ({
                signal_type: s.signalType,
                signal_value: s.signalValue,
              })),
            ) as never
          }::jsonb,
          ${tx.json(candidate.installationEvidence) as never}::jsonb,
          'device/self-registration'::text) as r`;

      // RECORD THAT THIS BOARD ANNOUNCED ITSELF (group 0216).
      //
      // `bin/cloud-registration.ts` polls this route every 60 seconds while it
      // waits for approval, so this is the ONLY liveness a device has before it
      // enrols: `device_fleet_status.last_observed_at` reads hardware-evidence
      // COMPARISONS, an enrolment-time fact that is null for every pending board.
      // Without this an Admin cannot tell a Pi unplugged yesterday from one
      // powering up in the next room — the signal was arriving all along and
      // nothing recorded it.
      //
      // In the SAME transaction and only after the registration succeeded, so the
      // device id is one this call just produced rather than anything a caller
      // supplied. The door creates nothing and decides nothing.
      //
      // Deliberately not allowed to fail the request: a liveness write is not
      // worth turning a successful registration into an error the board retries
      // forever. The door itself never raises; this catch covers the transport.
      const registered = row?.r;
      if (registered?.device_id) {
        try {
          await tx`select kitluy_devices.record_device_sighting_v1(
            ${registered.device_id}::uuid,
            ${registered.installation_id ?? null}::uuid)`;
        } catch (error) {
          console.error("record_device_sighting_v1 failed; registration stands", error);
        }
      }
      return { unknownProfile: false as const, result: registered };
    });

    if (result.unknownProfile) {
      return refuse(404, "KLUY-REG-UNKNOWN-PROFILE");
    }
    const registration = result.result;
    if (registration === undefined) {
      console.error("register_device_v1 returned no row");
      return refuse(500, "KLUY-REG-UPSTREAM");
    }

    // The response carries the device's own identity and the outcome, and
    // nothing else. No Store context, no scope, no credential — see the
    // contract's "Never present in any response".
    return new Response(
      JSON.stringify({
        status: registration.status,
        deviceId: registration.device_id,
        installationId: registration.installation_id,
        installationCreated: registration.installation_created,
        ...(registration.conflict_reason !== null
          ? { conflictReason: registration.conflict_reason }
          : {}),
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    // Logged for HET, never returned: a database error message can name schemas,
    // constraints and roles, and this caller is unauthenticated.
    console.error("registration failed", error);
    return refuse(500, "KLUY-REG-UPSTREAM");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
});
