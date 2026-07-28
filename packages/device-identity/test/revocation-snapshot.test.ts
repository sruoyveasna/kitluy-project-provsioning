import { describe, expect, it } from "vitest";

import {
  evaluateRevocationSnapshot,
  revocationLookupFrom,
  type RevocationSnapshot,
  type SnapshotVerificationContext,
} from "../src/revocation-snapshot.js";
import { DEVICE, NOW, RESTRICTED_STATUSES, days, hours, trusted } from "./consumer-fixtures.js";

const snapshot = (over: Partial<RevocationSnapshot> = {}): RevocationSnapshot => ({
  snapshotVersion: 10,
  purpose: "configuration_signing",
  environment: "development",
  issuedAt: hours(-2),
  validUntil: days(7),
  payloadSha256: "b".repeat(64),
  computedPayloadSha256: "b".repeat(64),
  signerKeyId: "dev-config-signer",
  signerPurpose: "configuration_signing",
  revokedCertificateSerials: ["SER-BAD"],
  revokedDeviceRecordIds: [DEVICE],
  signatureValid: true,
  ...over,
});

const ctx = (over: Partial<SnapshotVerificationContext> = {}): SnapshotVerificationContext => ({
  snapshot: snapshot(),
  trustedTime: trusted(),
  environment: "development",
  acceptedVersion: 9,
  ...over,
});

describe("revocation_snapshot.validity", () => {
  it("accepts a fresh, correctly signed snapshot", () => {
    const v = evaluateRevocationSnapshot(ctx());
    expect(v.accepted).toBe(true);
    expect(v.entersRestrictedMode).toBe(false);
    expect(v.enforceKnownRevocations).toBe(true);
  });

  it("fails closed with no trusted time and in restricted trust mode", () => {
    expect(
      evaluateRevocationSnapshot(ctx({ trustedTime: { ...trusted(), trustedTime: null } }))
        .rejectionCode,
    ).toBe("SNAPSHOT_NO_TRUSTED_TIME");
    for (const status of RESTRICTED_STATUSES) {
      expect(
        evaluateRevocationSnapshot(ctx({ trustedTime: trusted(NOW, status) })).rejectionCode,
      ).toBe("SNAPSHOT_RESTRICTED_TRUST_MODE");
    }
  });

  it("rejects wrong environment, wrong purpose and a cross-purpose signer", () => {
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ environment: "production" }) }))
        .rejectionCode,
    ).toBe("SNAPSHOT_WRONG_ENVIRONMENT");
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ purpose: "release_signing" }) }))
        .rejectionCode,
    ).toBe("SNAPSHOT_WRONG_PURPOSE");
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ signerPurpose: "release_signing" }) }))
        .rejectionCode,
    ).toBe("SNAPSHOT_CROSS_PURPOSE_SIGNER");
  });

  it("rejects a checksum mismatch and an invalid signature", () => {
    expect(
      evaluateRevocationSnapshot(
        ctx({ snapshot: snapshot({ computedPayloadSha256: "c".repeat(64) }) }),
      ).rejectionCode,
    ).toBe("SNAPSHOT_CHECKSUM_MISMATCH");
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ signatureValid: false }) }))
        .rejectionCode,
    ).toBe("SNAPSHOT_SIGNATURE_INVALID");
  });

  it("refuses a version rollback", () => {
    // Replaying yesterday's list is how a revocation gets undone.
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ snapshotVersion: 8 }) })).rejectionCode,
    ).toBe("SNAPSHOT_VERSION_ROLLBACK");
  });

  it("treats a snapshot beyond the 30-day development maximum age as STALE", () => {
    const v = evaluateRevocationSnapshot(
      ctx({ snapshot: snapshot({ issuedAt: days(-40), validUntil: days(-9) }) }),
    );
    expect(v.accepted).toBe(false);
    expect(v.rejectionCode).toBe("SNAPSHOT_STALE");
    expect(v.entersRestrictedMode).toBe(true);
  });

  it("STILL enforces the revocations a stale snapshot carries", () => {
    // Discarding a stale snapshot would lose revocations the Hub already knows,
    // which is worse than holding them. Freshness governs what NEW trust may be
    // granted, not what has already been withdrawn.
    const v = evaluateRevocationSnapshot(
      ctx({ snapshot: snapshot({ issuedAt: days(-40), validUntil: days(-9) }) }),
    );
    expect(v.enforceKnownRevocations).toBe(true);
  });

  it("does NOT enforce revocations from a snapshot that failed integrity", () => {
    // A snapshot with a bad signature is not a source of revocation facts.
    const v = evaluateRevocationSnapshot(ctx({ snapshot: snapshot({ signatureValid: false }) }));
    expect(v.enforceKnownRevocations).toBe(false);
  });

  it("exposes a revocation lookup usable while stale", () => {
    const lookup = revocationLookupFrom(snapshot());
    expect(lookup.isCertificateRevoked("SER-BAD")).toBe(true);
    expect(lookup.isCertificateRevoked("SER-OK")).toBe(false);
    expect(lookup.isDeviceRevoked(DEVICE)).toBe(true);
  });

  it("goes stale purely by trusted time advancing", () => {
    const s = snapshot({ issuedAt: hours(-2), validUntil: days(7) });
    expect(evaluateRevocationSnapshot(ctx({ snapshot: s })).accepted).toBe(true);
    expect(
      evaluateRevocationSnapshot(ctx({ snapshot: s, trustedTime: trusted(days(40)) }))
        .rejectionCode,
    ).toBe("SNAPSHOT_STALE");
  });
});
