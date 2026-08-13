/**
 * The canonical Store Hub claim payload — the AUTHORITATIVE definition.
 *
 * ===========================================================================
 * WHY THIS FILE HAD TO EXIST BEFORE ANY HUB COULD PAIR
 * ===========================================================================
 * `kitluy_devices.device_claims.payload_sha256` carries a load-bearing promise:
 *
 *   "payload_sha256 binds the token to the exact device and scope it was issued
 *    for, so a captured token cannot be replayed against a different Tenant,
 *    Digital Store or Location."
 *
 * That promise is only as good as the two sides agreeing, byte for byte, on
 * what "the canonical claim payload (device + scope + expiry)" IS — and until
 * now nothing defined it. Three test suites each invented their own filler
 * (`JSON.stringify({ deviceRecordId })`, a bare string, a reused fixture), so
 * the column's guarantee was never actually exercised: issuer and redeemer
 * agreed only because the same test wrote both halves.
 *
 * A device that hashes a payload one way and a Partner Portal that hashes it
 * another produces `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED` on every legitimate
 * pairing, and — far worse — the scope binding silently protects nothing if
 * either side omits a scope field.
 *
 * ===========================================================================
 * WHAT IS IN THE PAYLOAD, AND WHY EACH FIELD
 * ===========================================================================
 * Every field the database binds the claim to must be present, or the binding
 * is decorative:
 *
 *   deviceRecordId  the device the claim was issued FOR
 *   tenantId        \
 *   digitalStoreId   >  the SCOPE — the whole point of the binding
 *   storeLocationId /
 *   expiresAt       so a captured payload cannot be re-presented with a longer life
 *
 * The kind string leads, so a hash over these bytes can never be mistaken for,
 * or replayed as, a hash over another record type.
 *
 * Field order is FIXED. Changing it, the separator, or the kind string breaks
 * every issued claim, which is why the drift test exists.
 */

/** Domain separator. Distinct from every other canonical byte kind. */
export const HUB_CLAIM_PAYLOAD_KIND = "kitluy.hub-claim-payload.v1" as const;

export interface HubClaimPayloadFields {
  /** The device this claim was issued for. */
  readonly deviceRecordId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly expiresAt: Date;
}

/**
 * A field carrying the separator could forge bytes identical to a DIFFERENT
 * set of fields — the classic canonicalisation break. Refusing to build such
 * bytes is stronger than refusing to verify them, because it means malformed
 * input can never be signed or stored in the first place.
 *
 * Returns the offending field name, or null when the input is safe.
 */
export function findHubClaimSeparatorInjection(fields: HubClaimPayloadFields): string | null {
  const candidates: readonly (readonly [string, string])[] = [
    ["deviceRecordId", fields.deviceRecordId],
    ["tenantId", fields.tenantId],
    ["digitalStoreId", fields.digitalStoreId],
    ["storeLocationId", fields.storeLocationId],
  ];
  for (const [name, value] of candidates) {
    if (value.includes("\n") || value.includes("\r")) return name;
  }
  return null;
}

export class HubClaimPayloadError extends Error {
  constructor(readonly field: string) {
    super(`hub claim payload: field ${field} contains a line separator`);
    this.name = "HubClaimPayloadError";
  }
}

/**
 * The canonical bytes. Both the issuer (Partner surface) and the redeemer
 * (device) MUST produce these and hash them identically.
 *
 * `expiresAt` is serialised as an ISO-8601 instant so a payload cannot mean two
 * different moments in two different timezones.
 */
export function hubClaimPayloadBytes(fields: HubClaimPayloadFields): Uint8Array {
  const injected = findHubClaimSeparatorInjection(fields);
  if (injected !== null) throw new HubClaimPayloadError(injected);

  return Buffer.from(
    [
      HUB_CLAIM_PAYLOAD_KIND,
      fields.deviceRecordId,
      fields.tenantId,
      fields.digitalStoreId,
      fields.storeLocationId,
      fields.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}
