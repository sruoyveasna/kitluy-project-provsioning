/**
 * Same-key renewal preflight — focused unit tests.
 *
 * Every certificate in this file is signed by a REAL Ed25519 development CA and
 * every refusal below is produced by real verification. There is no fake
 * verifier and no injectable verdict, because the property under test is that
 * one cannot exist.
 */
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  DevelopmentCertificateAuthority,
  publicKeyFingerprint,
  tbsBytes,
  tbsFromCanonicalBytes,
  type Certificate,
} from "../src/dev-crypto.js";
import {
  SAME_KEY_RENEWAL_MODE,
  prepareSameKeyCredentialRenewal,
  buildChainFromStoredLinks,
  type CredentialHeadRecord,
  type IncumbentCredentialRecord,
  type IncumbentCredentialRepository,
  type ProviderKeyRecord,
  type RenewalReservationGateway,
  type ReserveRenewalInput,
  type ReservedRenewalRow,
  type RevocationStateRecord,
  type SameKeyRenewalPreflightInput,
  type StoredChainLink,
} from "../src/same-key-renewal-preflight.js";
import type { TrustedTimeEvaluation, TrustedTimeStatus } from "../src/trusted-time.js";
import type { TrustEnvironment } from "../src/environments.js";

const MS_PER_DAY = 86_400_000;

const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CREDENTIAL_ID = "44444444-4444-4444-8444-444444444444";

const T0 = new Date("2026-07-01T00:00:00.000Z");
const NOT_AFTER = new Date(T0.getTime() + 30 * MS_PER_DAY);

/** Trusted time is a VALUE here, never a host clock. */
function trustedAt(instant: Date): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: instant,
    source: "authenticated_network",
    floorAdvanced: true,
    anomalyType: null,
    detail: "test fixture",
  };
}

function untrusted(status: TrustedTimeStatus): TrustedTimeEvaluation {
  return {
    status,
    trustedTime: null,
    source: "none",
    floorAdvanced: false,
    anomalyType: status === "trusted" ? null : status,
    detail: "test fixture",
  };
}

/** The instant at which exactly `days` remain before expiry. */
const daysBeforeExpiry = (days: number): Date => new Date(NOT_AFTER.getTime() - days * MS_PER_DAY);

// ---------------------------------------------------------------------------
// A real CA, a real device key, a real chain
// ---------------------------------------------------------------------------

interface Fixture {
  readonly ca: DevelopmentCertificateAuthority;
  readonly deviceCertificate: Certificate;
  readonly deviceFingerprint: string;
  readonly links: StoredChainLink[];
}

function buildFixture(
  overrides: {
    readonly deviceRecordId?: string;
    readonly certificateGeneration?: number;
    readonly notBefore?: Date;
    readonly notAfter?: Date;
  } = {},
): Fixture {
  const ca = new DevelopmentCertificateAuthority({
    notBefore: new Date(T0.getTime() - 365 * MS_PER_DAY),
    notAfter: new Date(T0.getTime() + 3650 * MS_PER_DAY),
  });
  const { publicKey } = generateKeyPairSync("ed25519");
  const devicePublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const deviceFingerprint = publicKeyFingerprint(devicePublicKeyPem);

  const deviceCertificate = ca.issueDeviceCertificate({
    deviceRecordId: overrides.deviceRecordId ?? DEVICE,
    subjectPublicKeyPem: devicePublicKeyPem,
    subjectFingerprint: deviceFingerprint,
    hardwareTrustLevel: "development_software",
    certificateGeneration: overrides.certificateGeneration ?? 1,
    notBefore: overrides.notBefore ?? T0,
    notAfter: overrides.notAfter ?? NOT_AFTER,
    serialNumber: "DEV-UNIT-0001",
    certificateId: CREDENTIAL_ID,
  });

  return {
    ca,
    deviceCertificate,
    deviceFingerprint,
    links: storedLinks(ca.rootCertificate, ca.intermediateCertificate, deviceCertificate),
  };
}

function storedLinks(
  root: Certificate,
  intermediate: Certificate,
  device: Certificate,
): StoredChainLink[] {
  const link = (linkPosition: number, role: string, cert: Certificate): StoredChainLink => ({
    linkPosition,
    role,
    canonicalTbs: Buffer.from(tbsBytes(cert.tbs)).toString("utf8"),
    detachedSignature: cert.signature,
  });
  return [link(0, "root", root), link(1, "intermediate", intermediate), link(2, "device", device)];
}

// ---------------------------------------------------------------------------
// Fakes for the two boundaries
// ---------------------------------------------------------------------------

interface RepositoryState {
  head: CredentialHeadRecord | null;
  credential: IncumbentCredentialRecord | null;
  links: readonly StoredChainLink[];
  revocation: RevocationStateRecord;
  providerKey: ProviderKeyRecord | null;
}

function fakeRepository(state: RepositoryState): IncumbentCredentialRepository & {
  readonly generationsRequested: number[];
} {
  const generationsRequested: number[] = [];
  return {
    generationsRequested,
    async loadCredentialHead() {
      return state.head;
    },
    async loadCredentialAtGeneration(_scope, generation) {
      // Recorded so a test can prove the incumbent was fetched BY GENERATION —
      // i.e. derived from the head — and never by a caller-named id.
      generationsRequested.push(generation);
      if (state.credential === null) return null;
      return state.credential.certificateGeneration === generation ? state.credential : null;
    },
    async loadCredentialChainLinks() {
      return state.links;
    },
    async loadRevocationState() {
      return state.revocation;
    },
    async loadCurrentProviderKey() {
      return state.providerKey;
    },
  };
}

function fakeGateway(
  respond: (input: ReserveRenewalInput, callIndex: number) => ReservedRenewalRow,
): RenewalReservationGateway & { readonly calls: ReserveRenewalInput[] } {
  const calls: ReserveRenewalInput[] = [];
  return {
    calls,
    async reserveRenewal(input) {
      calls.push(input);
      return respond(input, calls.length - 1);
    },
  };
}

function throwingGateway(message: string): RenewalReservationGateway & {
  readonly calls: ReserveRenewalInput[];
} {
  const calls: ReserveRenewalInput[] = [];
  return {
    calls,
    async reserveRenewal(input) {
      calls.push(input);
      throw new Error(message);
    },
  };
}

const RESERVED_ROW: ReservedRenewalRow = {
  outcome: "RESERVED",
  renewalAttemptId: "55555555-5555-4555-8555-555555555555",
  renewalMode: SAME_KEY_RENEWAL_MODE,
  currentCredentialId: CREDENTIAL_ID,
  currentCredentialGeneration: 1,
  nextCredentialGeneration: 2,
  assignmentGeneration: 1,
  credentialHeadVersion: 1,
  status: "issuance_pending",
};

// ---------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------

interface ScenarioOptions {
  readonly fixture?: Fixture;
  readonly environment?: TrustEnvironment;
  readonly purpose?: string;
  readonly deviceRecordId?: string;
  readonly headGeneration?: number;
  readonly headVersion?: number;
  readonly credentialGeneration?: number;
  readonly credentialAssignmentGeneration?: number;
  readonly currentAssignmentGeneration?: number;
  readonly credentialFingerprint?: string;
  readonly credentialState?: string;
  readonly revokedAt?: Date | null;
  readonly revocation?: RevocationStateRecord;
  readonly providerKeyState?: string;
  readonly providerKeyFingerprint?: string;
  readonly providerKeyScopeDevice?: string;
  readonly providerKeyPresent?: boolean;
  readonly headPresent?: boolean;
  readonly credentialPresent?: boolean;
  readonly links?: readonly StoredChainLink[];
}

function scenario(options: ScenarioOptions = {}) {
  const fixture = options.fixture ?? buildFixture();
  const environment = options.environment ?? "development";
  const purpose = options.purpose ?? "device_identity";
  const deviceRecordId = options.deviceRecordId ?? DEVICE;
  const headGeneration = options.headGeneration ?? 1;
  const fingerprint = options.credentialFingerprint ?? fixture.deviceFingerprint;

  const head: CredentialHeadRecord | null =
    options.headPresent === false
      ? null
      : {
          deviceRecordId,
          environment,
          purpose,
          currentGeneration: headGeneration,
          previousGeneration: null,
          overlapEndsAt: null,
          version: options.headVersion ?? 1,
        };

  const credential: IncumbentCredentialRecord | null =
    options.credentialPresent === false
      ? null
      : {
          credentialId: CREDENTIAL_ID,
          serialNumber: "DEV-UNIT-0001",
          deviceRecordId,
          environment,
          purpose,
          certificateGeneration: options.credentialGeneration ?? headGeneration,
          assignmentGeneration: options.credentialAssignmentGeneration ?? 1,
          publicKeyFingerprint: fingerprint,
          issuerKeyId: fixture.ca.intermediateKeyId,
          hardwareTrustLevel: "development_software",
          state: options.credentialState ?? "issued",
          revokedAt: options.revokedAt ?? null,
          canonicalTbs: Buffer.from(tbsBytes(fixture.deviceCertificate.tbs)).toString("utf8"),
          detachedSignature: fixture.deviceCertificate.signature,
        };

  const providerKey: ProviderKeyRecord | null =
    options.providerKeyPresent === false
      ? null
      : {
          keyId: "66666666-6666-4666-8666-666666666666",
          deviceRecordId: options.providerKeyScopeDevice ?? deviceRecordId,
          environment,
          purpose,
          generation: headGeneration,
          keyGeneration: 1,
          publicKeyFingerprint: options.providerKeyFingerprint ?? fixture.deviceFingerprint,
          providerKeyReference: "dev-device:handle",
          state: options.providerKeyState ?? "active",
        };

  const repository = fakeRepository({
    head,
    credential,
    links: options.links ?? fixture.links,
    revocation: options.revocation ?? { credentialRevoked: false, deviceRevoked: false },
    providerKey,
  });

  const input = (overrides: Partial<SameKeyRenewalPreflightInput> = {}) =>
    ({
      deviceRecordId,
      environment,
      purpose,
      idempotencyKey: "a".repeat(64),
      actorRef: "UNIT-TEST",
      trustedTime: trustedAt(daysBeforeExpiry(9)),
      trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
      currentAssignmentGeneration: options.currentAssignmentGeneration ?? 1,
      ...overrides,
    }) satisfies SameKeyRenewalPreflightInput;

  return { fixture, repository, input };
}

const okGateway = () => fakeGateway(() => RESERVED_ROW);

// ===========================================================================
// Canonical TBS parsing — the chain loader depends on it
// ===========================================================================
describe("canonical TBS parsing", () => {
  it("round-trips a real certificate through its canonical bytes", () => {
    const { deviceCertificate } = buildFixture();
    const canonical = Buffer.from(tbsBytes(deviceCertificate.tbs)).toString("utf8");
    const parsed = tbsFromCanonicalBytes(canonical);
    expect(parsed).not.toBeNull();
    expect(Buffer.from(tbsBytes(parsed!)).toString("utf8")).toBe(canonical);
    expect(parsed!.subjectPublicKeyPem.trim()).toBe(
      deviceCertificate.tbs.subjectPublicKeyPem.trim(),
    );
  });

  it("refuses a structure that does not round-trip rather than repairing it", () => {
    const { deviceCertificate } = buildFixture();
    const canonical = Buffer.from(tbsBytes(deviceCertificate.tbs)).toString("utf8");
    expect(tbsFromCanonicalBytes(`${canonical}\nextra`)).toBeNull();
    expect(tbsFromCanonicalBytes(canonical.replace("kitluy.cert.v1", "kitluy.cert.v2"))).toBeNull();
    expect(tbsFromCanonicalBytes("too\nshort")).toBeNull();
  });

  it("refuses a canonical form that claims production eligibility", () => {
    const { deviceCertificate } = buildFixture();
    const canonical = Buffer.from(tbsBytes(deviceCertificate.tbs)).toString("utf8");
    const lines = canonical.split("\n");
    lines[lines.length - 3] = "true";
    expect(tbsFromCanonicalBytes(lines.join("\n"))).toBeNull();
  });

  it("refuses an incomplete or duplicated chain", () => {
    const { links } = buildFixture();
    expect(buildChainFromStoredLinks(links.slice(0, 2))).toBeNull();
    expect(buildChainFromStoredLinks([...links, links[0]!])).toBeNull();
    expect(buildChainFromStoredLinks(links)).not.toBeNull();
  });
});

// ===========================================================================
// Incumbent selection
// ===========================================================================
describe("incumbent selection", () => {
  it("selects the current credential from the credential head", async () => {
    const { repository, input } = scenario();
    const gateway = okGateway();
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);

    expect(outcome.outcome).toBe("RESERVED");
    // The incumbent was fetched BY GENERATION — the head's — not by any id the
    // caller supplied.
    expect(repository.generationsRequested).toEqual([1]);
  });

  it("refuses a caller that substitutes another issued credential", async () => {
    const { repository, input } = scenario();
    const gateway = okGateway();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ assertedCurrentCredentialId: OTHER_CREDENTIAL_ID }),
      repository,
      gateway,
    );

    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT");
    expect(gateway.calls).toHaveLength(0);
  });

  it("refuses when no credential head exists", async () => {
    const { repository, input } = scenario({ headPresent: false });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NO_CREDENTIAL_HEAD");
  });

  it("refuses when the head points at no credential", async () => {
    const { repository, input } = scenario({ credentialPresent: false });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NO_CURRENT_CREDENTIAL");
  });

  it("refuses a head/credential generation mismatch", async () => {
    // The head says 2; the repository only holds generation 1. A renewal that
    // proceeded here would renew a superseded generation.
    const { repository, input } = scenario({ headGeneration: 2, credentialGeneration: 1 });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NO_CURRENT_CREDENTIAL");
  });

  it("refuses a stale assignment generation", async () => {
    const { repository, input } = scenario({
      credentialAssignmentGeneration: 1,
      currentAssignmentGeneration: 2,
    });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_STALE_ASSIGNMENT_GENERATION");
  });

  it("refuses a stale head version", async () => {
    const { repository, input } = scenario({ headVersion: 4 });
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ expectedCredentialHeadVersion: 3 }),
      repository,
      okGateway(),
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_STALE_HEAD_VERSION");
  });

  it("refuses an incomplete stored chain", async () => {
    const fixture = buildFixture();
    const { repository, input } = scenario({ fixture, links: fixture.links.slice(0, 2) });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_INCOMPLETE_CHAIN");
  });
});

// ===========================================================================
// Verification
// ===========================================================================
describe("incumbent verification", () => {
  it("runs the real chain verifier — a one-byte forgery is refused", async () => {
    const fixture = buildFixture();
    const forged = fixture.links.map((link) =>
      link.role === "device"
        ? { ...link, detachedSignature: flipFirstByte(link.detachedSignature) }
        : link,
    );
    const { repository, input } = scenario({ fixture, links: forged });
    const gateway = okGateway();

    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);

    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");
    // Nothing was reserved against a credential that did not verify.
    expect(gateway.calls).toHaveLength(0);
  });

  it("has no caller-supplied signature verdict on its input boundary", async () => {
    const fixture = buildFixture();
    const forged = fixture.links.map((link) =>
      link.role === "device"
        ? { ...link, detachedSignature: flipFirstByte(link.detachedSignature) }
        : link,
    );
    const { repository, input } = scenario({ fixture, links: forged });

    // A caller asserting its own trust verdict changes NOTHING: there is no
    // such field, and the cast below is the closest a caller can get.
    const smuggled = {
      ...input(),
      signatureValid: true,
      isVerified: true,
      chainVerified: true,
    } as unknown as SameKeyRenewalPreflightInput;

    const outcome = await prepareSameKeyCredentialRenewal(smuggled, repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
  });

  it("treats state = issued as bookkeeping, not as proof that a signature verifies", async () => {
    const fixture = buildFixture();
    const forged = fixture.links.map((link) =>
      link.role === "device"
        ? { ...link, detachedSignature: flipFirstByte(link.detachedSignature) }
        : link,
    );
    // The row says `issued`, which is exactly the claim under test.
    const { repository, input } = scenario({ fixture, links: forged, credentialState: "issued" });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.outcome).toBe("REFUSED");
  });

  it("refuses a root that is not in this verifier's anchor set", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ trustedRootFingerprints: ["f".repeat(64)] }),
      repository,
      okGateway(),
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CHAIN_ROOT_NOT_TRUSTED");
  });

  it("refuses an intermediate from a different hierarchy", async () => {
    const fixture = buildFixture();
    const stranger = buildFixture();
    const swapped = fixture.links.map((link) =>
      link.role === "intermediate"
        ? {
            ...link,
            canonicalTbs: Buffer.from(tbsBytes(stranger.ca.intermediateCertificate.tbs)).toString(
              "utf8",
            ),
            detachedSignature: stranger.ca.intermediateCertificate.signature,
          }
        : link,
    );
    const { repository, input } = scenario({ fixture, links: swapped });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CHAIN_INTERMEDIATE_NOT_SIGNED_BY_ROOT");
  });

  it("refuses a development chain presented to a pilot verifier", async () => {
    // Rows and caller agree on `pilot`; the signed certificates say
    // `development`, and the verifier refuses on the SIGNED value.
    const { repository, input } = scenario({ environment: "pilot" });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CHAIN_ENVIRONMENT_MISMATCH");
  });

  it("refuses a credential presented for another purpose", async () => {
    // The chain verifier is pinned to device_identity internally, so it would
    // happily verify a device-identity chain here and never notice that the
    // caller asked about transport signing. The preflight pins the purpose
    // itself for exactly that reason.
    const { repository, input } = scenario({ purpose: "transport_signing" });
    const gateway = okGateway();
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_WRONG_PURPOSE");
    expect(outcome.detail).toContain("transport_signing");
    expect(gateway.calls).toHaveLength(0);
  });

  it("refuses a head whose purpose differs from the requested one", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ purpose: "configuration_signing" }),
      repository,
      okGateway(),
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_WRONG_PURPOSE");
  });

  it("refuses a credential issued for another device", async () => {
    // The chain is for DEVICE; every row and the caller say OTHER_DEVICE.
    const fixture = buildFixture();
    const { repository, input } = scenario({ fixture, deviceRecordId: OTHER_DEVICE });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_WRONG_DEVICE");
  });

  it("refuses when the credential attests to a fingerprint the record does not hold", async () => {
    const { repository, input } = scenario({ credentialFingerprint: "b".repeat(64) });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CERT_KEY_FINGERPRINT_MISMATCH");
  });

  it("reports REVOKED, not EXPIRED, for a credential that is both", async () => {
    const { repository, input } = scenario({
      revocation: { credentialRevoked: true, deviceRevoked: false },
    });
    const outcome = await prepareSameKeyCredentialRenewal(
      // Past expiry AND revoked. §5.4: saying "expired" would understate it.
      input({ trustedTime: trustedAt(daysBeforeExpiry(-2)) }),
      repository,
      okGateway(),
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED");
    expect(outcome.requiresRecovery).toBe(true);
  });

  it("refuses when trusted time is not established", async () => {
    const { repository, input } = scenario();
    for (const status of ["uninitialized"] as const) {
      const outcome = await prepareSameKeyCredentialRenewal(
        input({ trustedTime: untrusted(status) }),
        repository,
        okGateway(),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NO_TRUSTED_TIME");
    }
    for (const status of [
      "restricted_clock_rollback",
      "restricted_forward_jump",
      "restricted_rtc_failure",
      "restricted_no_trusted_source",
    ] as const) {
      const outcome = await prepareSameKeyCredentialRenewal(
        input({ trustedTime: untrusted(status) }),
        repository,
        okGateway(),
      );
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_RESTRICTED_TRUST_MODE");
    }
  });
});

// ===========================================================================
// Eligibility
// ===========================================================================
describe("renewal eligibility", () => {
  it("accepts exactly ten days remaining — the boundary is inclusive", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ trustedTime: trustedAt(daysBeforeExpiry(10)) }),
      repository,
      okGateway(),
    );
    expect(outcome.outcome).toBe("RESERVED");
    expect(outcome.daysRemaining).toBe(10);
  });

  it("accepts nine days remaining", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ trustedTime: trustedAt(daysBeforeExpiry(9)) }),
      repository,
      okGateway(),
    );
    expect(outcome.outcome).toBe("RESERVED");
    expect(outcome.daysRemaining).toBe(9);
  });

  it("refuses eleven days remaining as OUTSIDE THE WINDOW, not as an error", async () => {
    const { repository, input } = scenario();
    const gateway = okGateway();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ trustedTime: trustedAt(daysBeforeExpiry(11)) }),
      repository,
      gateway,
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW");
    expect(outcome.daysRemaining).toBe(11);
    // Not a recovery case, and nothing was reserved.
    expect(outcome.requiresRecovery).toBeUndefined();
    expect(gateway.calls).toHaveLength(0);
  });

  it("routes an expired credential to recovery", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(
      input({ trustedTime: trustedAt(daysBeforeExpiry(-1)) }),
      repository,
      okGateway(),
    );
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED");
    expect(outcome.requiresRecovery).toBe(true);
  });

  it("routes a revoked credential to recovery", async () => {
    const { repository, input } = scenario({
      revocation: { credentialRevoked: true, deviceRevoked: false },
    });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED");
    expect(outcome.requiresRecovery).toBe(true);
  });

  it("routes a revoked DEVICE to recovery", async () => {
    const { repository, input } = scenario({
      revocation: { credentialRevoked: false, deviceRevoked: true },
    });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED");
  });

  it("refuses when no provider key is registered", async () => {
    const { repository, input } = scenario({ providerKeyPresent: false });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_PROVIDER_KEY_MISSING");
  });

  it("refuses an inactive provider key", async () => {
    for (const state of ["generated", "credential_issued_pending_activation", "superseded"]) {
      const { repository, input } = scenario({ providerKeyState: state });
      const gateway = okGateway();
      const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
      expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_PROVIDER_KEY_NOT_ACTIVE");
      expect(gateway.calls).toHaveLength(0);
    }
  });

  it("refuses a provider key whose fingerprint is not the incumbent's", async () => {
    const { repository, input } = scenario({ providerKeyFingerprint: "c".repeat(64) });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_PROVIDER_KEY_FINGERPRINT_MISMATCH");
  });

  it("refuses a provider key scoped to another device", async () => {
    const { repository, input } = scenario({ providerKeyScopeDevice: OTHER_DEVICE });
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_PROVIDER_KEY_WRONG_SCOPE");
  });
});

// ===========================================================================
// Reservation
// ===========================================================================
describe("governed reservation", () => {
  it("reserves in reuse_current_key mode and carries no replacement key", async () => {
    const { repository, input } = scenario();
    const gateway = okGateway();
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);

    expect(gateway.calls[0]?.renewalMode).toBe("reuse_current_key");
    expect(outcome.reservation?.renewalMode).toBe("reuse_current_key");
    expect(outcome.reservation?.replacementKeyReference).toBeNull();
    expect(outcome.reservation?.nextCredentialGeneration).toBe(
      outcome.reservation!.currentCredentialGeneration + 1,
    );
    expect(outcome.reservation?.currentKeyGeneration).toBe(1);
    expect(outcome.reservation?.reservationStatus).toBe("issuance_pending");
  });

  it("verifies BEFORE it reserves", async () => {
    const fixture = buildFixture();
    const order: string[] = [];
    const forged = fixture.links.map((link) =>
      link.role === "device"
        ? { ...link, detachedSignature: flipFirstByte(link.detachedSignature) }
        : link,
    );
    const { repository, input } = scenario({ fixture, links: forged });
    const gateway = fakeGateway(() => {
      order.push("reserve");
      return RESERVED_ROW;
    });

    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.outcome).toBe("REFUSED");
    expect(order).toEqual([]);
  });

  it("returns a reservation and performs no issuance operation", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());

    expect(outcome.reservation).toBeDefined();
    // This unit stops at the reservation. Nothing here prepares, signs or
    // finalizes a credential, and the result shape says so.
    expect(Object.keys(outcome)).not.toContain("credential");
    expect(Object.keys(outcome)).not.toContain("certificate");
    expect(Object.keys(outcome)).not.toContain("signature");
    expect(Object.keys(outcome.reservation!)).not.toContain("privateKey");
  });

  it("takes no key provider, so no key generation can occur", async () => {
    const generateDeviceKey = vi.fn();
    const { repository, input } = scenario();
    await prepareSameKeyCredentialRenewal(input(), repository, okGateway());

    // The preflight's dependencies are (input, repository, gateway). There is
    // no seam a key provider could be threaded through, which is a stronger
    // guarantee than a provider that happens not to be called.
    expect(prepareSameKeyCredentialRenewal.length).toBe(3);
    expect(generateDeviceKey).not.toHaveBeenCalled();
  });

  it("returns the SAME attempt and generation on an idempotent retry", async () => {
    const { repository, input } = scenario();
    const gateway = fakeGateway((_in, index) =>
      index === 0 ? RESERVED_ROW : { ...RESERVED_ROW, outcome: "REPLAYED_RESERVATION" },
    );

    const first = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    const second = await prepareSameKeyCredentialRenewal(input(), repository, gateway);

    expect(first.outcome).toBe("RESERVED");
    expect(second.outcome).toBe("REPLAYED");
    expect(second.reservation?.renewalAttemptId).toBe(first.reservation?.renewalAttemptId);
    expect(second.reservation?.nextCredentialGeneration).toBe(
      first.reservation?.nextCredentialGeneration,
    );
    expect(gateway.calls[0]?.idempotencyKey).toBe(gateway.calls[1]?.idempotencyKey);
  });

  it("refuses to report success when the database froze a different mode", async () => {
    const { repository, input } = scenario();
    const gateway = fakeGateway(() => ({ ...RESERVED_ROW, renewalMode: "rotate_key" }));
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_MODE_MISMATCH");
  });

  it("refuses a reservation that carries a replacement key reference", async () => {
    const { repository, input } = scenario();
    const gateway = fakeGateway(() => ({
      ...RESERVED_ROW,
      replacementKeyReference: "dev-device:other",
    }));
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_CARRIES_REPLACEMENT_KEY");
  });

  it("refuses a reservation whose next generation is not current + 1", async () => {
    const { repository, input } = scenario();
    const gateway = fakeGateway(() => ({ ...RESERVED_ROW, nextCredentialGeneration: 3 }));
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_GENERATION_UNEXPECTED");
  });

  it("refuses a reservation made against a different incumbent", async () => {
    const { repository, input } = scenario();
    const gateway = fakeGateway(() => ({
      ...RESERVED_ROW,
      currentCredentialId: OTHER_CREDENTIAL_ID,
    }));
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT");
  });

  it("maps a competing reservation to KLUY-RENEWAL-ALREADY-RESERVED", async () => {
    const { repository, input } = scenario();
    const gateway = throwingGateway(
      "KLUY-RENEWAL-ALREADY-RESERVED: generation 2 already has an open renewal reservation",
    );
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_ALREADY_RESERVED");
    // The database's own text survives; it is never flattened.
    expect(outcome.detail).toContain("KLUY-RENEWAL-ALREADY-RESERVED");
  });

  it("preserves RENEWAL_GENERATION_CONFLICT as its own typed refusal", async () => {
    const { repository, input } = scenario();
    const gateway = throwingGateway(
      "KLUY-CRED-RENEWAL-GENERATION-CONFLICT: head moved from version 1 to 2",
    );
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    // Distinct from the early ALREADY_RESERVED fast-fail — migration 0130 is
    // explicit that collapsing the two loses the difference between a race that
    // was caught early and one caught at the head swap.
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_GENERATION_CONFLICT");
  });

  it("carries an unrecognised database refusal through without inventing a reason", async () => {
    const { repository, input } = scenario();
    const gateway = throwingGateway("KLUY-SOMETHING-NEW: a refusal this package has not seen");
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, gateway);
    expect(outcome.refusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_REFUSED");
    expect(outcome.detail).toContain("KLUY-SOMETHING-NEW");
  });

  it("returns diagnostics that do not stand in for verification", async () => {
    const { repository, input } = scenario();
    const outcome = await prepareSameKeyCredentialRenewal(input(), repository, okGateway());

    expect(outcome.diagnostics?.consumersMustReVerifyAtAuthenticationBoundary).toBe(true);
    expect(outcome.diagnostics?.credentialKind).toBe("kitluy.development-device-credential.v1");
    // No caller-usable "verified" authority anywhere in the result.
    const flattened = JSON.stringify(outcome);
    expect(flattened).not.toContain('"signatureValid"');
    expect(flattened).not.toContain('"verified"');
  });
});

function flipFirstByte(signature: Uint8Array): Uint8Array {
  const copy = new Uint8Array(signature);
  copy[0] = copy[0]! ^ 0xff;
  return copy;
}
