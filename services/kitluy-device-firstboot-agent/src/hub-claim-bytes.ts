/**
 * The canonical Store Hub claim payload, as the DEVICE builds it.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND COPY, AND WHY THAT IS SAFE
 * ===========================================================================
 * The authoritative definition lives in
 * `packages/device-identity/src/hub-claim-payload.ts`. Importing it here is not
 * possible: this agent ships INSIDE the golden image with **zero runtime
 * dependencies**, and `package-bootstrap-runtime.sh` refuses the build outright
 * if that ever stops being true —
 *
 *     REFUSED: the firstboot agent gained runtime dependencies;
 *              the image ships no node_modules.
 *
 * A copy of security-critical canonical bytes is exactly the thing that drifts
 * silently and is discovered in the field, so it is kept honest by
 * `test/hub-claim-drift.test.ts`, which builds the same input through BOTH
 * implementations and fails if a single byte differs — the same discipline
 * `enrollment-pop-bytes.ts` is held to.
 *
 * If you change the field order, the separator, or the kind string here, that
 * test fails. That is the point.
 */

/** Domain separator. MUST equal `HUB_CLAIM_PAYLOAD_KIND`. */
export const HUB_CLAIM_KIND = "kitluy.hub-claim-payload.v1" as const;

export interface HubClaimFields {
  readonly deviceRecordId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly expiresAt: Date;
}

/** Mirrors `findHubClaimSeparatorInjection`. Returns the field name, or null. */
export function findHubClaimSeparatorInjection(fields: HubClaimFields): string | null {
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

/**
 * Field order is FIXED and must match the authoritative implementation exactly.
 * The kind leads, so a hash over these bytes cannot be replayed as a hash over
 * another record type.
 */
export function hubClaimPayloadBytes(fields: HubClaimFields): Uint8Array {
  const injected = findHubClaimSeparatorInjection(fields);
  if (injected !== null) {
    throw new Error(`hub claim payload: field ${injected} contains a line separator`);
  }
  return Buffer.from(
    [
      HUB_CLAIM_KIND,
      fields.deviceRecordId,
      fields.tenantId,
      fields.digitalStoreId,
      fields.storeLocationId,
      fields.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}
