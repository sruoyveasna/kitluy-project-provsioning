/**
 * Issuing a Store Hub pairing code.
 *
 * Authority: KLD-2026-08-13-HUB-PAIRING-ROUTE-001; migration group 0193 (the
 * permission, the `kitluy_hub_issuance_service` identity and the
 * `issue_hub_claim_v1` bridge); group 0191 (the code's rules); group 0121 (the
 * claim model).
 *
 * ===========================================================================
 * THE CODE IS GENERATED HERE, AND SHOWN EXACTLY ONCE
 * ===========================================================================
 * Only the DIGEST reaches the database. `device_claims.claim_token_sha256` is
 * what is stored, so the plaintext exists in this process and in the HTTP
 * response, and nowhere else — not in a log line, not in an audit row, not in a
 * second read model. That is why the route returns it once and the Portal must
 * show it once: there is no "show me that code again" endpoint, because there is
 * nothing to show it from.
 *
 * ===========================================================================
 * WHY THE ALPHABET IS DRAWN FROM THE DATABASE
 * ===========================================================================
 * `kitluy_devices.hub_claim_code_alphabet_v1()` is the canonical 32 characters,
 * and group 0192 kept it readable by `authenticated` for precisely this reason.
 * Re-typing "0123456789ABCDEFGHJKMNPQRSTVWXYZ" into TypeScript would create a
 * second definition that can drift from the one the presenter validates against —
 * and the failure mode is a code an operator cannot type successfully.
 *
 * ===========================================================================
 * WHY THE TTL IS PASSED EXPLICITLY
 * ===========================================================================
 * `create_device_claim_v1` accepts one second to twenty-four hours. The pairing
 * protocol says fifteen minutes, and 0191 enforces it as a row constraint
 * (`device_claims_ttl_chk`). Passing 900 here is not the enforcement — the table
 * is — but passing nothing, or passing a default from somewhere else, is how a
 * caller ends up refused by a constraint it did not know about.
 */
import { createHash, randomInt } from "node:crypto";

import { hubClaimPayloadBytes } from "@kitluy/device-identity";
import type pg from "pg";

/** Pairing protocol §6.1: "Valid for 15 minutes by default." */
export const HUB_PAIRING_TTL_SECONDS = 900;
/** §6.1: "8 characters using unambiguous Crockford Base32." */
export const HUB_PAIRING_CODE_LENGTH = 8;

export interface IssuedHubPairingCode {
  /** Plaintext. Returned ONCE and never persisted. */
  readonly code: string;
  readonly claimId: string;
  readonly expiresAt: string;
  readonly deviceRecordId: string;
}

export type IssuanceResult =
  | { readonly kind: "issued"; readonly issued: IssuedHubPairingCode }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

/**
 * Refusals `create_device_claim_v1` raises, mapped for a STAFF caller.
 *
 * Unlike the device-facing surface, these are safe to distinguish: the caller is
 * an authenticated human acting inside their own Store, and "that Hub is already
 * assigned" is exactly what they need to know to stop trying. Enumeration is not
 * a concern when the actor already holds the Store.
 */
const ISSUANCE_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-DEVICE-MISSING": "no such device",
  "KLUY-DEVICE-ALREADY-CLAIMED": "that Store Hub already holds a live assignment",
  "KLUY-DEVICE-QUARANTINED": "that Store Hub is quarantined and needs governed re-enrollment",
  "KLUY-DEVICE-TERMINAL": "that Store Hub is retired or otherwise terminal",
  "KLUY-DEVICE-CLAIM-STATE": "that Store Hub is not in an enrolled state",
  "KLUY-DEVICE-CLAIM-TTL": "the requested code lifetime is outside the permitted range",
  "KLUY-DEVICE-SCOPE-UNKNOWN": "the Store or Location does not exist",
  "KLUY-DEVICE-SCOPE-CROSS-TENANT": "the Store and Location belong to different Tenants",
  "KLUY-DEVICE-SCOPE-CROSS-STORE": "the Location does not belong to that Store",
  device_claims_ttl_chk: "the requested code lifetime exceeds the fifteen-minute ceiling",
};

/**
 * A uniformly random code over the canonical alphabet.
 *
 * `randomInt` rather than `Math.random`: this value is the sole authority to
 * attach a Store Hub to a Store, so it must come from a CSPRNG. Rejection-free
 * because `randomInt(max)` is already unbiased over its range.
 */
export function generateCode(alphabet: string, length = HUB_PAIRING_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface HubPairingIssuanceDeps {
  readonly pool: pg.Pool;
}

/**
 * Issue one code for one Hub, inside one transaction as
 * `kitluy_hub_issuance_service`.
 *
 * Authorization has ALREADY happened — see `authorizePartnerRequest`. This
 * function assumes the caller may act in the named Store and does not re-derive
 * it, because the two run against different identities: authority is decided as
 * the actor, and the governed door is reached as the least-privilege service.
 * Mixing them would mean either the actor needs table privileges or the service
 * decides authority, and both are worse.
 */
export async function issueHubPairingCode(
  deps: HubPairingIssuanceDeps,
  input: {
    readonly deviceRecordId: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    readonly operatorRef: string;
  },
): Promise<IssuanceResult> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role kitluy_hub_issuance_service");

    const { rows: alphabetRows } = await client.query<{ alphabet: string }>(
      "select kitluy_devices.hub_claim_code_alphabet_v1() as alphabet",
    );
    const alphabet = alphabetRows[0]?.alphabet;
    if (alphabet === undefined || alphabet.length === 0) {
      await client.query("rollback");
      return {
        kind: "refused",
        code: "KLUY-HUBCODE-ALPHABET-UNAVAILABLE",
        detail: "the canonical code alphabet is unavailable",
      };
    }

    const code = generateCode(alphabet);
    // Device + scope, and nothing server-derived — the issuer must be able to
    // compute the same bytes the redeemer will. See `hub-claim-payload.ts` on why
    // the expiry is deliberately not part of this.
    const payloadSha256 = createHash("sha256")
      .update(
        hubClaimPayloadBytes({
          deviceRecordId: input.deviceRecordId,
          tenantId: input.tenantId,
          digitalStoreId: input.digitalStoreId,
          storeLocationId: input.storeLocationId,
        }),
      )
      .digest("hex");

    const { rows } = await client.query<{ claim_id: string }>(
      `select kitluy_devices.issue_hub_claim_v1(
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::integer, $8) as claim_id`,
      [
        input.deviceRecordId,
        input.tenantId,
        input.digitalStoreId,
        input.storeLocationId,
        createHash("sha256").update(code, "utf8").digest("hex"),
        payloadSha256,
        HUB_PAIRING_TTL_SECONDS,
        input.operatorRef,
      ],
    );
    const claimId = rows[0]?.claim_id;
    if (claimId === undefined) {
      await client.query("rollback");
      return {
        kind: "refused",
        code: "KLUY-HUBCODE-NOT-ISSUED",
        detail: "the issuance door returned no claim",
      };
    }

    // Read the authoritative expiry back rather than computing it: the row's
    // `expires_at` comes from the DATABASE clock, and a Portal that displayed a
    // locally computed deadline would count down to the wrong moment.
    const { rows: claimRows } = await client.query<{ expires_at: Date }>(
      "select expires_at from kitluy_devices.device_claims where id = $1::uuid",
      [claimId],
    );
    await client.query("commit");

    const expiresAt = claimRows[0]?.expires_at;
    return {
      kind: "issued",
      issued: {
        code,
        claimId,
        expiresAt: (expiresAt ?? new Date()).toISOString(),
        deviceRecordId: input.deviceRecordId,
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const matched = Object.keys(ISSUANCE_REFUSALS).find((c) => message.includes(c));
    if (matched !== undefined) {
      return { kind: "refused", code: matched, detail: ISSUANCE_REFUSALS[matched]! };
    }
    // Unmapped: report a refusal without echoing a SQLSTATE, function name or row
    // identity at an HTTP caller.
    return {
      kind: "refused",
      code: "KLUY-HUBCODE-ISSUANCE-FAILED",
      detail: "the pairing code could not be issued",
    };
  } finally {
    client.release();
  }
}

/**
 * The Hub's scope, resolved from the DEVICE's own Store assignment history — not
 * from the caller.
 *
 * A Hub that has never been assigned has no scope of its own, so the issuer names
 * the Store. But the request must not be trusted to name the TENANT: a caller who
 * could supply that could try to attach a Hub to a Store in another Tenant, and
 * `create_device_claim_v1` would refuse with `KLUY-DEVICE-SCOPE-CROSS-TENANT`
 * only if the mismatch happened to be inconsistent. Resolving the tenant from the
 * Store row removes the question.
 */
export async function resolveStoreScope(
  deps: HubPairingIssuanceDeps,
  digitalStoreId: string,
  storeLocationId: string,
): Promise<{ readonly tenantId: string } | null> {
  const { rows } = await deps.pool.query<{ tenant_id: string }>(
    `select ds.tenant_id
       from kitluy_core.digital_stores ds
       join kitluy_core.store_locations sl on sl.digital_store_id = ds.id
      where ds.id = $1::uuid and sl.id = $2::uuid`,
    [digitalStoreId, storeLocationId],
  );
  const tenantId = rows[0]?.tenant_id;
  return tenantId === undefined ? null : { tenantId };
}
