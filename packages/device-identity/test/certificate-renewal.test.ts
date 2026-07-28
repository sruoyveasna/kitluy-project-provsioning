import { describe, expect, it } from "vitest";

import { evaluateRenewalEligibility, type RenewalContext } from "../src/certificate-renewal.js";
import {
  DEVICE,
  RESTRICTED_STATUSES,
  certificate,
  days,
  noRevocations,
  NOW,
  revokes,
  trusted,
} from "./consumer-fixtures.js";

/**
 * A credential VIEW expiring exactly `n` days after trusted NOW.
 * Renewal reasons about windows, not signatures — the signature was already
 * established by certificate.validity, and re-verifying it here would say
 * nothing new while implying renewal is a second trust decision.
 */
const expiringIn = (n: number) => ({
  ...certificate({ notBefore: days(n - 30), notAfter: days(n) }),
  certificateGeneration: 1,
  publicKeyFingerprint: "a".repeat(64),
});

const ctx = (over: Partial<RenewalContext> = {}): RenewalContext => ({
  certificate: expiringIn(20),
  trustedTime: trusted(),
  environment: "development",
  deviceRecordId: DEVICE,
  revocations: noRevocations,
  existingOverlapDays: 0,
  ...over,
});

describe("certificate.renewal_eligibility", () => {
  it("refuses renewal with more than 10 days remaining", () => {
    const r = evaluateRenewalEligibility(ctx({ certificate: expiringIn(20) }));
    expect(r.eligible).toBe(false);
    expect(r.refusalCode).toBe("RENEWAL_TOO_EARLY");
    expect(r.daysRemaining).toBeCloseTo(20, 5);
  });

  it("allows renewal at EXACTLY 10 days remaining", () => {
    // Inclusive on purpose: a device that wakes once a day would otherwise
    // step straight over its own renewal window.
    const r = evaluateRenewalEligibility(ctx({ certificate: expiringIn(10) }));
    expect(r.eligible).toBe(true);
    expect(r.daysRemaining).toBeCloseTo(10, 5);
  });

  it("allows renewal inside the window", () => {
    expect(evaluateRenewalEligibility(ctx({ certificate: expiringIn(3) })).eligible).toBe(true);
  });

  it("refuses renewal of an EXPIRED certificate and routes to recovery", () => {
    const r = evaluateRenewalEligibility(ctx({ certificate: expiringIn(-1) }));
    expect(r.refusalCode).toBe("RENEWAL_CERTIFICATE_EXPIRED");
    expect(r.requiresRecovery).toBe(true);
  });

  it("allows an existing overlap below the 3-day development maximum", () => {
    expect(
      evaluateRenewalEligibility(ctx({ certificate: expiringIn(5), existingOverlapDays: 2 }))
        .eligible,
    ).toBe(true);
  });

  it("refuses an overlap exceeding 3 days", () => {
    const r = evaluateRenewalEligibility(
      ctx({ certificate: expiringIn(5), existingOverlapDays: 4 }),
    );
    expect(r.refusalCode).toBe("RENEWAL_OVERLAP_EXCEEDED");
  });

  it("reports OVERLAP rather than TOO_EARLY when both would apply", () => {
    // A device already holding two certificates past the limit must not be told
    // it is merely too early — that would hide the real problem.
    const r = evaluateRenewalEligibility(
      ctx({ certificate: expiringIn(25), existingOverlapDays: 9 }),
    );
    expect(r.refusalCode).toBe("RENEWAL_OVERLAP_EXCEEDED");
  });

  it("refuses normal renewal of a REVOKED certificate", () => {
    const r = evaluateRenewalEligibility(
      ctx({ certificate: expiringIn(5), revocations: revokes("SER-1") }),
    );
    expect(r.refusalCode).toBe("RENEWAL_CERTIFICATE_REVOKED");
    expect(r.requiresRecovery).toBe(true);
  });

  it("fails closed with no trusted time and in restricted trust mode", () => {
    expect(
      evaluateRenewalEligibility(ctx({ trustedTime: { ...trusted(), trustedTime: null } }))
        .refusalCode,
    ).toBe("RENEWAL_NO_TRUSTED_TIME");
    for (const status of RESTRICTED_STATUSES) {
      expect(
        evaluateRenewalEligibility(ctx({ trustedTime: trusted(NOW, status) })).refusalCode,
      ).toBe("RENEWAL_RESTRICTED_TRUST_MODE");
    }
  });

  it("requires a NEW key pair unless an approved provider policy says otherwise", () => {
    // Section 5.1. No such policy is approved today, so this is true in every
    // path — including the refusals, because the answer does not depend on
    // whether renewal happens to be permitted right now.
    expect(evaluateRenewalEligibility(ctx({ certificate: expiringIn(5) })).requiresNewKeyPair).toBe(
      true,
    );
    expect(
      evaluateRenewalEligibility(ctx({ certificate: expiringIn(25) })).requiresNewKeyPair,
    ).toBe(true);
    expect(
      evaluateRenewalEligibility(ctx({ certificate: expiringIn(5), approvedKeyReusePolicy: true }))
        .requiresNewKeyPair,
    ).toBe(false);
  });

  it("becomes eligible purely by trusted time advancing", () => {
    const cert = expiringIn(20);
    expect(evaluateRenewalEligibility(ctx({ certificate: cert })).eligible).toBe(false);
    expect(
      evaluateRenewalEligibility(ctx({ certificate: cert, trustedTime: trusted(days(12)) }))
        .eligible,
    ).toBe(true);
  });
});
