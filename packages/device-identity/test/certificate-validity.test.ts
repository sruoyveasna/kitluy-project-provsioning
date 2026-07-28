import { describe, expect, it } from "vitest";

import {
  certificateGrantsProductionEligibility,
  evaluateCertificateValidity,
  type CertificateVerificationContext,
} from "../src/certificate-validity.js";
import {
  DEVICE,
  ISSUERS,
  NOW,
  OTHER_DEVICE,
  RESTRICTED_STATUSES,
  certificate,
  days,
  noRevocations,
  revokes,
  trusted,
} from "./consumer-fixtures.js";

const ctx = (
  over: Partial<CertificateVerificationContext> = {},
): CertificateVerificationContext => ({
  certificate: certificate(),
  trustedTime: trusted(),
  environment: "development",
  deviceRecordId: DEVICE,
  currentDeviceKeyGeneration: 2,
  currentAssignmentGeneration: 5,
  issuers: ISSUERS,
  revocations: noRevocations,
  signatureValid: true,
  ...over,
});

describe("certificate.validity", () => {
  it("accepts a well-formed development certificate", () => {
    const v = evaluateCertificateValidity(ctx());
    expect(v.valid).toBe(true);
    expect(v.evaluatedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("fails closed with no trusted time", () => {
    const v = evaluateCertificateValidity(
      ctx({ trustedTime: { ...trusted(), trustedTime: null } }),
    );
    expect(v.rejectionCode).toBe("CERT_NO_TRUSTED_TIME");
  });

  it("fails closed in every restricted trust mode", () => {
    for (const status of RESTRICTED_STATUSES) {
      expect(
        evaluateCertificateValidity(ctx({ trustedTime: trusted(NOW, status) })).rejectionCode,
      ).toBe("CERT_RESTRICTED_TRUST_MODE");
    }
  });

  it("rejects wrong device, environment and purpose", () => {
    expect(evaluateCertificateValidity(ctx({ deviceRecordId: OTHER_DEVICE })).rejectionCode).toBe(
      "CERT_WRONG_DEVICE",
    );
    expect(
      evaluateCertificateValidity(ctx({ certificate: certificate({ environment: "production" }) }))
        .rejectionCode,
    ).toBe("CERT_WRONG_ENVIRONMENT");
    expect(
      evaluateCertificateValidity(ctx({ certificate: certificate({ purpose: "release_signing" }) }))
        .rejectionCode,
    ).toBe("CERT_WRONG_PURPOSE");
  });

  it("rejects unknown, revoked and cross-purpose issuers", () => {
    expect(
      evaluateCertificateValidity(ctx({ certificate: certificate({ issuerKeyId: "nope" }) }))
        .rejectionCode,
    ).toBe("CERT_UNKNOWN_ISSUER");
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ issuerKeyId: "dev-revoked-ca" }) }),
      ).rejectionCode,
    ).toBe("CERT_ISSUER_REVOKED");
    // The release CA signs perfectly well. It is simply not authorized here.
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ issuerKeyId: "dev-release-ca" }) }),
      ).rejectionCode,
    ).toBe("CERT_CROSS_PURPOSE_ISSUER");
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ issuerKeyId: "prod-device-identity-ca" }) }),
      ).rejectionCode,
    ).toBe("CERT_WRONG_ENVIRONMENT");
  });

  it("rejects a malformed window and a lifetime beyond the 30-day development policy", () => {
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ notBefore: days(10), notAfter: days(5) }) }),
      ).rejectionCode,
    ).toBe("CERT_WINDOW_MALFORMED");
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ notBefore: days(-5), notAfter: days(60) }) }),
      ).rejectionCode,
    ).toBe("CERT_LIFETIME_EXCEEDS_POLICY");
  });

  it("rejects an invalid signature", () => {
    expect(evaluateCertificateValidity(ctx({ signatureValid: false })).rejectionCode).toBe(
      "CERT_SIGNATURE_INVALID",
    );
  });

  it("rejects a certificate issued before the current device-key generation", () => {
    expect(
      evaluateCertificateValidity(ctx({ certificate: certificate({ deviceKeyGeneration: 1 }) }))
        .rejectionCode,
    ).toBe("CERT_STALE_KEY_GENERATION");
  });

  it("rejects an assignment mismatch", () => {
    expect(evaluateCertificateValidity(ctx({ currentAssignmentGeneration: 6 })).rejectionCode).toBe(
      "CERT_ASSIGNMENT_MISMATCH",
    );
  });

  it("rejects not-yet-valid and expired against TRUSTED time", () => {
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ notBefore: days(5), notAfter: days(25) }) }),
      ).rejectionCode,
    ).toBe("CERT_NOT_YET_VALID");
    expect(
      evaluateCertificateValidity(
        ctx({ certificate: certificate({ notBefore: days(-40), notAfter: days(-10) }) }),
      ).rejectionCode,
    ).toBe("CERT_EXPIRED");
  });

  it("reports REVOKED, not EXPIRED, for a revoked certificate whose window also lapsed", () => {
    // Section 5.4: a revoked certificate is invalid even before expiry, so
    // reporting "expired" would understate what actually happened.
    const v = evaluateCertificateValidity(
      ctx({
        certificate: certificate({ notBefore: days(-40), notAfter: days(-10) }),
        revocations: revokes("SER-1"),
      }),
    );
    expect(v.rejectionCode).toBe("CERT_REVOKED");
  });

  it("moves from valid to expired purely by trusted time advancing", () => {
    // The certificate is untouched; only trusted time moved. This is the whole
    // point of routing validity through TrustedTime.
    expect(evaluateCertificateValidity(ctx({ trustedTime: trusted(days(20)) })).valid).toBe(true);
    expect(evaluateCertificateValidity(ctx({ trustedTime: trusted(days(30)) })).rejectionCode).toBe(
      "CERT_EXPIRED",
    );
  });

  it("never grants production eligibility", () => {
    expect(certificateGrantsProductionEligibility()).toBe(false);
  });
});
