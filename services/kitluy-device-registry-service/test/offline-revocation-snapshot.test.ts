/**
 * OFFLINE revocation containment.
 *
 * WS-11-T003 Step 4 final remediation §4. Every test here runs with NO database
 * and NO network: the whole point of a snapshot is that it answers when nothing
 * else can, so a suite that needed a connection to prove offline behaviour would
 * be proving the wrong thing.
 *
 * The snapshot BUILDER's live read is covered by the integration suite; what is
 * under test here is what a Hub does with the result.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateRevocationSnapshot,
  revocationLookupFrom,
  MAX_REVOCATION_SNAPSHOT_AGE_HOURS,
  REVOCATION_SNAPSHOT_PURPOSE,
  type RevocationSnapshot,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

import {
  enforcedRevocationUnion,
  payloadDigest,
  recomputePayloadDigest,
  scopedDigest,
  verifySnapshotScope,
  type ScopedRevocationSnapshot,
  type SnapshotScope,
} from "../src/revocation-snapshot-builder.js";

const ENVIRONMENT = "development" as const;
const MS_PER_HOUR = 3_600_000;

const SCOPE: SnapshotScope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  digitalStoreId: "22222222-2222-4222-8222-222222222222",
  storeLocationId: "33333333-3333-4333-8333-333333333333",
  environment: ENVIRONMENT,
};

const OTHER_STORE: SnapshotScope = {
  ...SCOPE,
  digitalStoreId: "44444444-4444-4444-8444-444444444444",
};

const REVOKED_SERIAL = "DEV-CERT-REVOKED-0001";
const LIVE_SERIAL = "DEV-CERT-LIVE-0002";
const REVOKED_DEVICE = "55555555-5555-4555-8555-555555555555";

const ISSUED_AT = new Date("2026-07-30T00:00:00.000Z");

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "persisted_monotonic_floor",
  floorAdvanced: false,
  anomalyType: null,
  // The realistic offline case: no network time, but a hardware RTC and a
  // persisted floor still establish trusted time (§11 minimum).
  detail: "offline snapshot suite — no network",
});

/**
 * Builds a snapshot the way the builder does, including a REAL signature flag.
 *
 * `signatureValid` is a parameter because the shipped builder emits `false` (no
 * signer exists until Step 6) and `evaluateRevocationSnapshot` refuses that. To
 * test the behaviour that will matter once a signer exists, these fixtures set it
 * explicitly and say so, rather than the builder pretending.
 */
function snapshotOf(options: {
  readonly serials: readonly string[];
  readonly devices?: readonly string[];
  readonly version?: number;
  readonly issuedAt?: Date;
  readonly signatureValid?: boolean;
  readonly declaredDigest?: string;
  readonly purpose?: RevocationSnapshot["purpose"];
  readonly signerPurpose?: RevocationSnapshot["signerPurpose"];
  readonly environment?: string;
}): RevocationSnapshot {
  const devices = options.devices ?? [];
  const digest = payloadDigest(options.serials, devices);
  const issuedAt = options.issuedAt ?? ISSUED_AT;
  return {
    snapshotVersion: options.version ?? 1,
    purpose: options.purpose ?? REVOCATION_SNAPSHOT_PURPOSE,
    environment: options.environment ?? ENVIRONMENT,
    issuedAt,
    validUntil: new Date(
      issuedAt.getTime() + MAX_REVOCATION_SNAPSHOT_AGE_HOURS[ENVIRONMENT] * MS_PER_HOUR,
    ),
    payloadSha256: options.declaredDigest ?? digest,
    computedPayloadSha256: digest,
    signerKeyId: "offline-suite-signer",
    signerPurpose: options.signerPurpose ?? REVOCATION_SNAPSHOT_PURPOSE,
    revokedCertificateSerials: [...options.serials].sort(),
    revokedDeviceRecordIds: [...devices].sort(),
    signatureValid: options.signatureValid ?? true,
  };
}

const scoped = (
  snapshot: RevocationSnapshot,
  scope: SnapshotScope = SCOPE,
): ScopedRevocationSnapshot => ({
  snapshot,
  scope,
  scopedDigest: scopedDigest(scope, snapshot.payloadSha256),
});

// NAMED FOR WHAT IT PROVES. This block was called "a revoked credential is denied
// while the Store Hub is offline", which overclaims: the shipped builder emits
// `signatureValid: false`, and `evaluateRevocationSnapshot` refuses an unsigned
// snapshot with `enforceKnownRevocations: false`. So offline containment is NOT in
// force today, and these fixtures set the flag explicitly to exercise the
// behaviour that becomes real once Step 6 lands a signer. The shipped `false` case
// is covered honestly by "refuses an unsigned snapshot" below.
describe("once a snapshot is signed, a revoked credential is denied offline", () => {
  it("refuses the revoked serial from the snapshot alone", () => {
    const snapshot = snapshotOf({ serials: [REVOKED_SERIAL], devices: [REVOKED_DEVICE] });
    const verdict = evaluateRevocationSnapshot({
      snapshot,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.enforceKnownRevocations).toBe(true);

    const lookup = revocationLookupFrom(snapshot);
    expect(lookup.isCertificateRevoked(REVOKED_SERIAL)).toBe(true);
    expect(lookup.isDeviceRevoked(REVOKED_DEVICE)).toBe(true);
  });

  it("still lets a non-revoked credential work", () => {
    const snapshot = snapshotOf({ serials: [REVOKED_SERIAL] });
    const lookup = revocationLookupFrom(snapshot);
    expect(lookup.isCertificateRevoked(LIVE_SERIAL)).toBe(false);
    // Containment must not become an outage: a Store whose whole fleet stopped
    // working because one terminal was revoked is a worse failure than the one
    // being prevented.
    expect(lookup.isDeviceRevoked("66666666-6666-4666-8666-666666666666")).toBe(false);
  });

  it("keeps enforcing a STALE snapshot's revocations while refusing it as current", () => {
    const maxAge = MAX_REVOCATION_SNAPSHOT_AGE_HOURS[ENVIRONMENT];
    const snapshot = snapshotOf({ serials: [REVOKED_SERIAL] });
    const verdict = evaluateRevocationSnapshot({
      snapshot,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + (maxAge + 24) * MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    // §6.7: not current. §6.1: what it knows is still enforced. A Hub that
    // discarded a stale snapshot would FORGET revocations, which is worse than
    // holding them.
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_STALE");
    expect(verdict.enforceKnownRevocations).toBe(true);
    expect(verdict.entersRestrictedMode).toBe(true);
    expect(revocationLookupFrom(snapshot).isCertificateRevoked(REVOKED_SERIAL)).toBe(true);
  });

  it("identifies staleness with the environment's own window", () => {
    for (const environment of ["development", "pilot", "production"] as const) {
      const maxAge = MAX_REVOCATION_SNAPSHOT_AGE_HOURS[environment];
      const snapshot = { ...snapshotOf({ serials: [] }), environment };
      const justInside = evaluateRevocationSnapshot({
        snapshot,
        trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + (maxAge - 1) * MS_PER_HOUR)),
        environment,
        acceptedVersion: null,
      });
      const justOutside = evaluateRevocationSnapshot({
        snapshot,
        trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + (maxAge + 1) * MS_PER_HOUR)),
        environment,
        acceptedVersion: null,
      });
      expect(justInside.accepted, `${environment} inside window`).toBe(true);
      expect(justOutside.rejectionCode, `${environment} outside window`).toBe("SNAPSHOT_STALE");
    }
  });
});

describe("a malformed or foreign snapshot fails closed", () => {
  it("refuses a snapshot whose declared digest does not match its payload", () => {
    const snapshot = snapshotOf({
      serials: [REVOKED_SERIAL],
      declaredDigest: "0".repeat(64),
    });
    const verdict = evaluateRevocationSnapshot({
      snapshot,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_CHECKSUM_MISMATCH");
    // A snapshot that failed INTEGRITY is not a source of revocation facts —
    // unlike a stale one, whose contents are still true.
    expect(verdict.enforceKnownRevocations).toBe(false);
  });

  it("recomputes the digest itself rather than trusting the sender's two numbers", () => {
    // Both digest fields come from the wire. Comparing them to each other proves
    // nothing about the payload; a Hub must compute one.
    const tampered: RevocationSnapshot = {
      ...snapshotOf({ serials: [REVOKED_SERIAL] }),
      revokedCertificateSerials: [],
    };
    expect(recomputePayloadDigest(tampered)).not.toBe(tampered.payloadSha256);
  });

  it("refuses an unsigned snapshot, which is what the shipped builder emits", () => {
    const snapshot = snapshotOf({ serials: [REVOKED_SERIAL], signatureValid: false });
    const verdict = evaluateRevocationSnapshot({
      snapshot,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    // The honest consequence of having no signer until Step 6: offline snapshots
    // are BUILT and REFUSED, rather than accepted on trust.
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_SIGNATURE_INVALID");
    expect(verdict.enforceKnownRevocations).toBe(false);
  });

  it("refuses a cross-purpose signer and a foreign environment", () => {
    const wrongEnv = evaluateRevocationSnapshot({
      snapshot: snapshotOf({ serials: [], environment: "production" }),
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(wrongEnv.rejectionCode).toBe("SNAPSHOT_WRONG_ENVIRONMENT");

    const wrongSigner = evaluateRevocationSnapshot({
      snapshot: snapshotOf({ serials: [], signerPurpose: "device_certificate_signing" }),
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(wrongSigner.rejectionCode).toBe("SNAPSHOT_CROSS_PURPOSE_SIGNER");
  });

  it("REJECTS a snapshot built for another Digital Store", () => {
    // `evaluateRevocationSnapshot` has no notion of Tenant, Store or Location, so
    // a snapshot for another Store in the same environment passes every one of its
    // checks. This is the gap `verifySnapshotScope` exists to close.
    const foreign = scoped(snapshotOf({ serials: [REVOKED_SERIAL] }), OTHER_STORE);
    const envOnly = evaluateRevocationSnapshot({
      snapshot: foreign.snapshot,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(envOnly.accepted).toBe(true);

    const verdict = verifySnapshotScope(foreign, SCOPE);
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_SCOPE_MISMATCH");
    // The other Store's identifiers must not appear in the reason: a Hub log that
    // printed them would leak fleet topology to whoever held the Hub.
    expect(verdict.detail ?? "").not.toContain(OTHER_STORE.digitalStoreId);
  });

  it("accepts a correctly scoped snapshot", () => {
    expect(verifySnapshotScope(scoped(snapshotOf({ serials: [REVOKED_SERIAL] })), SCOPE)).toEqual({
      accepted: true,
    });
  });

  it("refuses a snapshot re-labelled for this Store without recomputing its digest", () => {
    const built = scoped(snapshotOf({ serials: [REVOKED_SERIAL] }), OTHER_STORE);
    // The attack: change the scope label, keep everything else. The scope is
    // inside the digest, so exactly this changes and nothing else does.
    const relabelled: ScopedRevocationSnapshot = { ...built, scope: SCOPE };
    const verdict = verifySnapshotScope(relabelled, SCOPE);
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_SCOPED_DIGEST_MISMATCH");
  });

  it("treats absent scope fields as malformed rather than as wildcards", () => {
    const built = scoped(snapshotOf({ serials: [] }));
    for (const field of ["tenantId", "digitalStoreId", "storeLocationId", "environment"] as const) {
      const holed = {
        ...built,
        scope: { ...built.scope, [field]: "" } as unknown as SnapshotScope,
      };
      expect(verifySnapshotScope(holed, SCOPE).rejectionCode).toBe("SNAPSHOT_MALFORMED");
    }
    expect(
      verifySnapshotScope(built, { ...SCOPE, tenantId: "" } as unknown as SnapshotScope)
        .rejectionCode,
    ).toBe("SNAPSHOT_MALFORMED");
  });

  it("refuses a malformed scoped digest", () => {
    const built = scoped(snapshotOf({ serials: [] }));
    expect(verifySnapshotScope({ ...built, scopedDigest: "nope" }, SCOPE).rejectionCode).toBe(
      "SNAPSHOT_MALFORMED",
    );
  });
});

describe("later synchronization cannot restore a revoked credential", () => {
  it("refuses an older snapshot version outright", () => {
    const verdict = evaluateRevocationSnapshot({
      snapshot: snapshotOf({ serials: [], version: 4 }),
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: 7,
    });
    // Replaying yesterday's list is the simplest way to undo a revocation.
    expect(verdict.rejectionCode).toBe("SNAPSHOT_VERSION_ROLLBACK");
  });

  it("KEEPS a revocation a newer snapshot dropped", () => {
    // The failure this prevents: a newer, correctly signed, correctly scoped,
    // monotonically versioned snapshot that simply omits a serial. Replacing the
    // set would un-revoke it. Decision §2.4 RULING 3 makes revocation
    // irreversible, so the set only grows.
    const current = {
      revokedCertificateSerials: [REVOKED_SERIAL],
      revokedDeviceRecordIds: [REVOKED_DEVICE],
    };
    const newer = snapshotOf({ serials: [LIVE_SERIAL], version: 2 });
    const union = enforcedRevocationUnion(current, newer);

    expect(union.revokedCertificateSerials).toContain(REVOKED_SERIAL);
    expect(union.revokedCertificateSerials).toContain(LIVE_SERIAL);
    expect(union.revokedDeviceRecordIds).toContain(REVOKED_DEVICE);
    // And the loss is REPORTED, because a snapshot that lost entries is a
    // publication defect somebody needs to look at.
    expect(union.retainedDespiteAbsence).toContain(REVOKED_SERIAL);
    expect(union.retainedDespiteAbsence).toContain(REVOKED_DEVICE);
  });

  it("reports nothing retained when a snapshot only adds", () => {
    const union = enforcedRevocationUnion(
      { revokedCertificateSerials: [REVOKED_SERIAL], revokedDeviceRecordIds: [] },
      snapshotOf({ serials: [REVOKED_SERIAL, LIVE_SERIAL], version: 2 }),
    );
    expect(union.retainedDespiteAbsence).toEqual([]);
    expect(union.revokedCertificateSerials).toEqual([LIVE_SERIAL, REVOKED_SERIAL].sort());
  });

  it("round-trips through serialization without losing its denial", () => {
    // RENAMED. This was called "survives a reboot", which overclaimed: there is no
    // Hub-side persistence, so nothing here is read back from storage and no
    // reboot is modelled. What it actually proves is narrower and still worth
    // having — a snapshot that has been through JSON keeps its digest and its
    // denial once `Date` fields are rehydrated, which is the part a future
    // persistence layer would otherwise get silently wrong.
    //
    // Reboot survival, atomic apply and last-known-good retention remain NOT
    // implemented and are recorded as outstanding.
    const snapshot = snapshotOf({ serials: [REVOKED_SERIAL], devices: [REVOKED_DEVICE] });
    const persisted = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    const rehydrated: RevocationSnapshot = {
      ...(persisted as unknown as RevocationSnapshot),
      issuedAt: new Date(String(persisted.issuedAt)),
      validUntil: new Date(String(persisted.validUntil)),
    };

    expect(recomputePayloadDigest(rehydrated)).toBe(snapshot.payloadSha256);
    const verdict = evaluateRevocationSnapshot({
      snapshot: rehydrated,
      trustedTime: trustedAt(new Date(ISSUED_AT.getTime() + 2 * MS_PER_HOUR)),
      environment: ENVIRONMENT,
      acceptedVersion: rehydrated.snapshotVersion,
    });
    expect(verdict.accepted).toBe(true);
    expect(revocationLookupFrom(rehydrated).isCertificateRevoked(REVOKED_SERIAL)).toBe(true);
    expect(verifySnapshotScope(scoped(rehydrated), SCOPE).accepted).toBe(true);
  });

  it("cannot judge freshness at all in restricted trust mode", () => {
    // An RTC-less Hub that booted offline with no floor has no "now", and
    // guessing one is the failure §12 exists to prevent (KLRISK-DEVICE-003 / G12).
    const verdict = evaluateRevocationSnapshot({
      snapshot: snapshotOf({ serials: [REVOKED_SERIAL] }),
      trustedTime: {
        status: "restricted_no_trusted_time",
        trustedTime: null,
        source: null,
        floorAdvanced: false,
        anomalyType: null,
        detail: "no RTC, booted offline",
      } as unknown as TrustedTimeEvaluation,
      environment: ENVIRONMENT,
      acceptedVersion: null,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejectionCode).toBe("SNAPSHOT_RESTRICTED_TRUST_MODE");
  });
});

describe("the canonical payload is reproducible", () => {
  it("does not depend on row order", () => {
    expect(payloadDigest(["b", "a"], ["y", "x"])).toBe(payloadDigest(["a", "b"], ["x", "y"]));
  });

  it("separates the two identifier kinds", () => {
    // Without a separator, `certs:['ab'] devices:[]` and `certs:['a'] devices:['b']`
    // would digest identically, and a device id could be smuggled in as a serial.
    expect(payloadDigest(["ab"], [])).not.toBe(payloadDigest(["a"], ["b"]));
  });

  it("is unambiguous WITHIN a kind", () => {
    // The attack this closes: replace two revoked serials with their
    // concatenation, leave `payloadSha256` untouched, and every integrity check
    // still passes — so two real credentials are silently un-revoked, and
    // `enforcedRevocationUnion` cannot help because a first-sync Hub has nothing
    // to union against.
    //
    // This is also the case an independent reviewer reported as BROKEN, having
    // read the U+001F separator as an empty string — the byte is invisible in most
    // diffs. It is asserted here so the question is settled by a test rather than
    // by reading.
    expect(payloadDigest(["DEV-CERT-A", "DEV-CERT-B"], [])).not.toBe(
      payloadDigest(["DEV-CERT-ADEV-CERT-B"], []),
    );
    expect(payloadDigest([], ["11111111-1111-4111-8111-111111111111"])).not.toBe(
      payloadDigest([], ["11111111-1111-4111-8111-11111111111", "1"]),
    );
  });

  it("distinguishes an empty set from a set holding one empty string", () => {
    // Termination rather than joining. Neither value is reachable from the
    // database and both mean "nothing revoked", so this was an edge case rather
    // than a live hole — but a digest with any ambiguity is the wrong thing to
    // hand a future signer.
    expect(payloadDigest([], [])).not.toBe(payloadDigest([""], []));
    expect(payloadDigest([], [])).not.toBe(payloadDigest([], [""]));
  });

  it("binds the scope into the scoped digest", () => {
    const digest = payloadDigest([REVOKED_SERIAL], []);
    expect(scopedDigest(SCOPE, digest)).not.toBe(scopedDigest(OTHER_STORE, digest));
  });
});
