/**
 * Builds the OFFLINE revocation snapshot from authoritative cloud state.
 *
 * Authority: KLD-2026-07-28-002 §6.1 (a locally known revocation is enforced
 * immediately), §6.7 (no stale snapshot may be represented as current);
 * WS-11-T003 Step 4 final remediation §4; migration group 0155.
 *
 * ===========================================================================
 * WHAT RV-GW-003 WAS
 * ===========================================================================
 * `RevocationSnapshot.revokedCertificateSerials` was CALLER-SUPPLIED, and no code
 * anywhere populated it from the revocation tables. `evaluateRevocationSnapshot`
 * and `revocationLookupFrom` were both complete and both fed by whatever a caller
 * happened to pass — which in practice was an empty list. A Store Hub that lost
 * connectivity would therefore have enforced NOTHING, while the code read as
 * though offline containment existed.
 *
 * This module is the producing half: it reads the authoritative revocation set
 * through the group 0155 definer bridges and emits a scoped, versioned,
 * timestamped, digest-covered snapshot payload.
 *
 * ===========================================================================
 * WHAT IS HONESTLY NOT HERE
 * ===========================================================================
 * NO SIGNATURE. The configuration signer does not exist until Step 6 (BLK-005
 * item 8), so this module emits `signatureValid: false` and a `signerKeyId` of
 * {@link UNSIGNED_SIGNER_KEY_ID} — a `[REQUIRED: ...]` sentinel, so a snapshot
 * that reached a Hub can be SEEN to be unsigned rather than merely missing a
 * field. `evaluateRevocationSnapshot` then REFUSES it with
 * `SNAPSHOT_SIGNATURE_INVALID`.
 *
 * That refusal is the correct behaviour, not a gap: an unsigned snapshot a Hub
 * accepted would be an unsigned snapshot an attacker could also mint. The
 * consequence is stated plainly — until Step 6 lands a signer, offline snapshots
 * are BUILT and REFUSED, so offline containment is not yet in force. Review
 * condition C4 stays open, and no signature is attached anywhere in this module.
 *
 * NO HUB-SIDE PERSISTENCE. Atomic apply, last-known-good retention and
 * reboot survival belong to the Hub's own database and follow the pattern already
 * established for configuration snapshots (`recordDownloadedSnapshot` ->
 * `verifySnapshot` -> `activateSnapshot` / `rollbackSnapshot`). That half is NOT
 * implemented here and is recorded as outstanding rather than implied.
 */
import { createHash } from "node:crypto";

import {
  type RevocationSnapshot,
  type TrustEnvironment,
} from "@kitluy/device-identity";


/**
 * The relational scope a snapshot is bound to.
 *
 * All four are REQUIRED. A snapshot that did not name its Digital Store could be
 * replayed at another Store, and a snapshot that did not name its environment
 * could carry development revocations into pilot.
 */
export interface SnapshotScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
}

/** A snapshot plus the scope binding the transport must carry alongside it. */
export interface ScopedRevocationSnapshot {
  readonly snapshot: RevocationSnapshot;
  readonly scope: SnapshotScope;
  /**
   * Covers the SCOPE AND the payload together.
   *
   * `payloadSha256` covers the revoked identifiers only. If the scope were
   * outside the digest, a snapshot could be re-labelled for another Store without
   * disturbing its checksum, which is precisely the cross-Store replay §4 asks
   * to reject.
   */
  readonly scopedDigest: string;
}


/**
 * Canonical payload bytes.
 *
 * Sorted, then TERMINATED with ASCII control separators: U+001F (Unit Separator)
 * after every element, U+001E (Record Separator) between the two identifier kinds.
 * Both are named as constants below rather than written as literals, because as raw
 * bytes in a string they are INVISIBLE in most diffs and review tools — an
 * independent reviewer of this file read `join(US)` as `join("")` and reported a
 * concatenation collision that does not exist. The property is now also locked by
 * test ("is unambiguous within a kind").
 *
 * Why a separator at all: without one, `["A","B"]` and `["AB"]` would digest
 * identically, and an attacker on the transport could replace two revoked serials
 * with their concatenation while every integrity check still passed. Neither U+001F
 * nor U+001E can occur in a certificate serial or a uuid, so no element can absorb
 * its neighbour.
 *
 * Sorting is what makes the digest reproducible: two builds that read the same
 * revocations in a different row order must produce the same snapshot, or a Hub
 * would see a "new" snapshot on every poll and the monotonic version check would be
 * doing all the work.
 */
/** U+001F. Terminates every element within one identifier kind. */
const US = "";

export function canonicalPayload(
  serials: readonly string[],
  deviceRecordIds: readonly string[],
): string {
  // TERMINATED, not merely joined. A trailing US after EVERY element is what
  // distinguishes `[]` from `[""]`; joining alone made both encode to the empty
  // string. Neither value is reachable from the database (`serial_number` is NOT
  // NULL and no credential carries an empty serial) and both mean "nothing
  // revoked", so this was an edge case rather than a live hole — but a digest with
  // any ambiguity in it is the wrong thing to hand a future signer.
  const encode = (values: readonly string[]): string =>
    [...values].sort().reduce((acc, value) => acc + value + US, "");
  return `certs:${US}${encode(serials)}devices:${US}${encode(deviceRecordIds)}`;
}

export function payloadDigest(
  serials: readonly string[],
  deviceRecordIds: readonly string[],
): string {
  return createHash("sha256")
    .update(canonicalPayload(serials, deviceRecordIds), "utf8")
    .digest("hex");
}

/** Binds the scope INTO the digest. See `ScopedRevocationSnapshot.scopedDigest`. */
export function scopedDigest(scope: SnapshotScope, payloadSha256: string): string {
  return createHash("sha256")
    .update(
      [
        scope.tenantId,
        scope.digitalStoreId,
        scope.storeLocationId,
        scope.environment,
        payloadSha256,
      ].join(""),
      "utf8",
    )
    .digest("hex");
}

/*
 * ===========================================================================
 * REMOVED: `buildRevocationSnapshot` and `BuildSnapshotOptions` (group 0159)
 * ===========================================================================
 * It took a Tenant/Store/Location scope as an ARGUMENT, read the ENVIRONMENT-WIDE
 * revocation set through `loadRevocationsViaGovernedBridge` with no device, and
 * stamped the caller's scope onto the digest. Delivered to that Store's Hub the
 * scope matched and the digest recomputed, so every integrity check passed --
 * while the payload carried OTHER tenants' revoked certificate serials.
 *
 * It is NOT retained as a compatibility path. Group 0156 added correctly scoped
 * bridges and group 0159 makes the unscoped database read REFUSE outright, so
 * there is no configuration in which the old shape is the right answer.
 *
 * The replacement is `signed-snapshot-producer.ts`: it takes ONE Hub device
 * record id and DERIVES the scope from it, so a caller cannot name a scope it is
 * not entitled to.
 */

/**
 * The signer key id an UNSIGNED snapshot carries.
 *
 * A recognisable sentinel rather than an empty string, so a snapshot that reached
 * a Hub can be seen to be unsigned instead of merely missing a field.
 */
export const UNSIGNED_SIGNER_KEY_ID = "[REQUIRED: configuration signing key — BLK-005 item 8]";

export type SnapshotAcceptanceRejection =
  "SNAPSHOT_SCOPE_MISMATCH" | "SNAPSHOT_SCOPED_DIGEST_MISMATCH" | "SNAPSHOT_MALFORMED";

export interface SnapshotScopeVerdict {
  readonly accepted: boolean;
  readonly rejectionCode?: SnapshotAcceptanceRejection;
  readonly detail?: string;
}

/**
 * The SCOPE half of snapshot acceptance, which
 * `evaluateRevocationSnapshot` does not cover.
 *
 * That function checks freshness, environment, purpose, signer purpose, checksum,
 * signature and version monotonicity. It has no notion of Tenant, Digital Store
 * or Location, so a snapshot built for one Store would pass every one of its
 * checks at another Store in the same environment. This closes that gap and is
 * meant to run BEFORE it.
 *
 * Fails closed on a malformed input rather than treating absent fields as
 * wildcards.
 */
export function verifySnapshotScope(
  candidate: ScopedRevocationSnapshot,
  expected: SnapshotScope,
): SnapshotScopeVerdict {
  const reject = (
    rejectionCode: SnapshotAcceptanceRejection,
    detail: string,
  ): SnapshotScopeVerdict => ({ accepted: false, rejectionCode, detail });

  for (const [field, value] of Object.entries(expected)) {
    if (typeof value !== "string" || value.trim() === "") {
      return reject("SNAPSHOT_MALFORMED", `the expected scope has no ${field}`);
    }
  }
  const actual = candidate.scope as unknown as Record<string, unknown>;
  for (const field of ["tenantId", "digitalStoreId", "storeLocationId", "environment"] as const) {
    const value = actual[field];
    if (typeof value !== "string" || value.trim() === "") {
      return reject("SNAPSHOT_MALFORMED", `the snapshot scope has no ${field}`);
    }
    if (value !== expected[field]) {
      // The names of the two scopes are NOT included: a Hub log that printed the
      // other Store's identifiers would leak fleet topology to whoever held the
      // Hub.
      return reject("SNAPSHOT_SCOPE_MISMATCH", `the snapshot ${field} is not this device's`);
    }
  }

  if (
    typeof candidate.scopedDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.scopedDigest)
  ) {
    return reject("SNAPSHOT_MALFORMED", "the scoped digest is absent or malformed");
  }
  const recomputed = scopedDigest(candidate.scope, candidate.snapshot.payloadSha256);
  if (recomputed !== candidate.scopedDigest) {
    // Re-labelling a snapshot for another Store changes this and nothing else,
    // which is the whole reason the scope is inside the digest.
    return reject("SNAPSHOT_SCOPED_DIGEST_MISMATCH", "the scoped digest does not cover this scope");
  }

  return { accepted: true };
}

/**
 * Recomputes the payload digest from the identifiers a snapshot actually carries.
 *
 * A Hub must not trust `computedPayloadSha256` from the wire — that field exists
 * so a Hub can compare the DECLARED digest against one IT computed. Doing the
 * comparison with two numbers that both came from the sender proves nothing.
 */
export function recomputePayloadDigest(snapshot: RevocationSnapshot): string {
  return payloadDigest(snapshot.revokedCertificateSerials, snapshot.revokedDeviceRecordIds);
}

export interface EnforcedRevocations {
  readonly revokedCertificateSerials: readonly string[];
  readonly revokedDeviceRecordIds: readonly string[];
  /** Identifiers the incoming snapshot DROPPED and this union kept anyway. */
  readonly retainedDespiteAbsence: readonly string[];
}

/**
 * UNIONS a newly accepted snapshot with what the Hub already enforces.
 *
 * ===========================================================================
 * WHY UNION AND NOT REPLACE
 * ===========================================================================
 * The obvious implementation is "the newest snapshot is the truth, replace the
 * set". That would make cloud synchronization able to RESTORE a revoked
 * credential: any snapshot that omitted a serial — through a publication bug, a
 * partial read, a truncated transport, or an attacker replaying a crafted
 * payload — would silently un-revoke it, and the Hub would go back to
 * authenticating a device somebody had deliberately killed.
 *
 * Decision §2.4 RULING 3 makes revocation IRREVERSIBLE. A Hub that has once been
 * told a credential is revoked has learned something that cannot later become
 * untrue, so the set only ever grows. The database enforces the same asymmetry on
 * the write side with a one-way trigger; this is that rule applied to the offline
 * cache.
 *
 * The cost is real and accepted: a serial revoked in error stays refused at this
 * Hub until the credential is replaced, which is the correct direction to fail. A
 * dropped identifier is REPORTED in `retainedDespiteAbsence` rather than passed
 * over in silence, because a snapshot that lost entries is a publication defect
 * somebody needs to look at.
 */
export function enforcedRevocationUnion(
  current: {
    readonly revokedCertificateSerials: readonly string[];
    readonly revokedDeviceRecordIds: readonly string[];
  },
  incoming: RevocationSnapshot,
): EnforcedRevocations {
  const serials = new Set(current.revokedCertificateSerials);
  const devices = new Set(current.revokedDeviceRecordIds);

  const dropped: string[] = [];
  const incomingSerials = new Set(incoming.revokedCertificateSerials);
  const incomingDevices = new Set(incoming.revokedDeviceRecordIds);
  for (const serial of serials) if (!incomingSerials.has(serial)) dropped.push(serial);
  for (const device of devices) if (!incomingDevices.has(device)) dropped.push(device);

  for (const serial of incomingSerials) serials.add(serial);
  for (const device of incomingDevices) devices.add(device);

  return {
    revokedCertificateSerials: [...serials].sort(),
    revokedDeviceRecordIds: [...devices].sort(),
    retainedDespiteAbsence: dropped.sort(),
  };
}
