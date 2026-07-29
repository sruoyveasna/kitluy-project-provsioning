/**
 * Same-key renewal issuance — focused unit tests.
 *
 * The CA is real, the device key is real, and every canonical TBS below is the
 * one `tbsBytes` produces — so the cross-layer conformance check in
 * `runGovernedIssuance` is exercised for real rather than stubbed past.
 */
import { describe, it, expect, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  tbsBytes,
  type Certificate,
} from "../src/dev-crypto.js";
import type {
  ChainLinkInput,
  FinalizedCredential,
  GovernedIssuanceGateway,
  PrepareInput,
  PreparedReservation,
} from "../src/issuance-adapter.js";
import {
  completeSameKeyCredentialRenewal,
  renewalIdempotencyKey,
  renewalRequestId,
  samePossessionPreimage,
  type IncumbentDeviceKeySigner,
  type SameKeyRenewalIssuanceInput,
} from "../src/same-key-renewal-issuance.js";
import type {
  CredentialHeadRecord,
  IncumbentCredentialRecord,
  IncumbentCredentialRepository,
  ProviderKeyRecord,
  RenewalReservationGateway,
  ReservedRenewalRow,
  StoredChainLink,
} from "../src/same-key-renewal-preflight.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const MS_PER_DAY = 86_400_000;
const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE = "22222222-2222-4222-8222-222222222222";
const CURRENT_CREDENTIAL = "33333333-3333-4333-8333-333333333333";
const NEXT_CREDENTIAL = "77777777-7777-4777-8777-777777777777";
const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const KEY_HANDLE = "dev-device:unit";

const T0 = new Date("2026-07-01T00:00:00.000Z");
const INCUMBENT_NOT_AFTER = new Date(T0.getTime() + 30 * MS_PER_DAY);
/** Nine days before the incumbent expires — inside the renewal window. */
const NOW = new Date(INCUMBENT_NOT_AFTER.getTime() - 9 * MS_PER_DAY);
const NEW_NOT_BEFORE = "2026-07-22T00:00:00.000Z";
const NEW_NOT_AFTER = "2026-08-21T00:00:00.000Z";

function trustedAt(instant: Date): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: instant,
    source: "authenticated_network",
    floorAdvanced: true,
    anomalyType: null,
    detail: "unit fixture",
  };
}

// ---------------------------------------------------------------------------
// A real CA, a real device key, a real incumbent chain
// ---------------------------------------------------------------------------

interface World {
  readonly ca: DevelopmentCertificateAuthority;
  readonly provider: DevelopmentDeviceKeyProvider;
  readonly signer: IncumbentDeviceKeySigner & { readonly signCalls: string[] };
  readonly devicePublicKeyPem: string;
  readonly fingerprint: string;
  readonly incumbentLinks: StoredChainLink[];
}

function buildWorld(): World {
  const ca = new DevelopmentCertificateAuthority({
    notBefore: new Date(T0.getTime() - 365 * MS_PER_DAY),
    notAfter: new Date(T0.getTime() + 3650 * MS_PER_DAY),
  });
  const provider = new DevelopmentDeviceKeyProvider();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const devicePublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const fingerprint = publicKeyFingerprint(devicePublicKeyPem);

  const signCalls: string[] = [];
  const signer = {
    signCalls,
    publicKeyPem: (reference: string) => (reference === KEY_HANDLE ? devicePublicKeyPem : null),
    proveIncumbentPossession(reference: string, payload: Uint8Array): Uint8Array {
      if (reference !== KEY_HANDLE) throw new Error(`no key under ${reference}`);
      signCalls.push(reference);
      // Signed by the DEVICE private key, which never leaves this closure.
      return new Uint8Array(sign(null, Buffer.from(payload), privateKey));
    },
  };

  const incumbent = ca.issueDeviceCertificate({
    deviceRecordId: DEVICE,
    subjectPublicKeyPem: devicePublicKeyPem,
    subjectFingerprint: fingerprint,
    hardwareTrustLevel: "development_software",
    certificateGeneration: 1,
    notBefore: T0,
    notAfter: INCUMBENT_NOT_AFTER,
    serialNumber: "DEV-UNIT-GEN1",
    certificateId: CURRENT_CREDENTIAL,
  });

  return {
    ca,
    provider,
    signer,
    devicePublicKeyPem,
    fingerprint,
    incumbentLinks: storedLinks(ca.rootCertificate, ca.intermediateCertificate, incumbent),
  };
}

function storedLinks(root: Certificate, ica: Certificate, device: Certificate): StoredChainLink[] {
  const link = (linkPosition: number, role: string, cert: Certificate): StoredChainLink => ({
    linkPosition,
    role,
    canonicalTbs: Buffer.from(tbsBytes(cert.tbs)).toString("utf8"),
    detachedSignature: cert.signature,
  });
  return [link(0, "root", root), link(1, "intermediate", ica), link(2, "device", device)];
}

// ---------------------------------------------------------------------------
// The fake governed database
// ---------------------------------------------------------------------------

interface FakeDatabaseOptions {
  /** Mutates the canonical TBS the database returns, one field at a time. */
  readonly mutateCanonicalTbs?: (canonical: string) => string;
  readonly preparedGeneration?: number;
  readonly headVersionSeen?: number;
  readonly assignmentGeneration?: number;
  readonly credentialId?: string;
  readonly serialNumber?: string;
  readonly issuerKeyId?: string;
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly prepareThrows?: string;
  readonly recordThrows?: string;
  readonly finalizeThrows?: string;
}

interface FakeDatabase extends GovernedIssuanceGateway {
  readonly calls: string[];
  readonly prepareInputs: PrepareInput[];
  readonly recordedSignatures: Uint8Array[];
  readonly finalizeCalls: { requestId: string; chainLinks: readonly ChainLinkInput[] }[];
  readonly heads: { generation: number; version: number };
}

function fakeDatabase(world: World, options: FakeDatabaseOptions = {}): FakeDatabase {
  const calls: string[] = [];
  const prepareInputs: PrepareInput[] = [];
  const recordedSignatures: Uint8Array[] = [];
  const finalizeCalls: { requestId: string; chainLinks: readonly ChainLinkInput[] }[] = [];
  const heads = { generation: 1, version: 1 };
  let finalized = false;

  const credentialId = options.credentialId ?? NEXT_CREDENTIAL;
  const serialNumber = options.serialNumber ?? "DEV-UNIT-GEN2";
  const generation = options.preparedGeneration ?? 2;
  const issuerKeyId = options.issuerKeyId ?? world.ca.intermediateKeyId;
  const notBefore = options.notBefore ?? NEW_NOT_BEFORE;
  const notAfter = options.notAfter ?? NEW_NOT_AFTER;

  return {
    calls,
    prepareInputs,
    recordedSignatures,
    finalizeCalls,
    heads,

    async prepare(input): Promise<PreparedReservation> {
      calls.push("prepare");
      prepareInputs.push(input);
      if (options.prepareThrows !== undefined) throw new Error(options.prepareThrows);
      if (finalized) {
        return {
          outcome: "ALREADY_ISSUED",
          requestId: input.requestId,
          credentialId,
          serialNumber,
          certificateGeneration: generation,
        };
      }
      // The database BUILDS the canonical TBS. This mirrors
      // build_canonical_device_tbs_v1 field for field.
      const canonical = Buffer.from(
        tbsBytes({
          certificateId: credentialId,
          serialNumber,
          role: "device",
          purpose: "device_identity",
          environment: "development",
          subjectFingerprint: input.publicKeyFingerprint,
          subjectPublicKeyPem: input.publicKeyPem,
          issuerKeyId,
          deviceRecordId: input.deviceRecordId,
          certificateGeneration: generation,
          hardwareTrustLevel: "development_software",
          productionEligible: false,
          notBefore,
          notAfter,
        }),
      ).toString("utf8");
      const served = options.mutateCanonicalTbs?.(canonical) ?? canonical;
      return {
        outcome: "RESERVED",
        requestId: input.requestId,
        credentialId,
        serialNumber,
        certificateGeneration: generation,
        assignmentGeneration: options.assignmentGeneration ?? 1,
        issuerKeyId,
        notBefore,
        notAfter,
        canonicalTbs: served,
        canonicalTbsHash: sha256(served),
        headVersionSeen: options.headVersionSeen ?? 1,
        alreadySigned: false,
      };
    },

    async recordSignature(input) {
      calls.push("recordSignature");
      if (options.recordThrows !== undefined) throw new Error(options.recordThrows);
      recordedSignatures.push(input.detachedSignature);
      return { outcome: "RECORDED" };
    },

    async finalize(input): Promise<FinalizedCredential> {
      calls.push("finalize");
      if (options.finalizeThrows !== undefined) throw new Error(options.finalizeThrows);
      finalizeCalls.push({ requestId: input.requestId, chainLinks: input.chainLinks });
      if (finalized) {
        return {
          outcome: "ALREADY_ISSUED",
          credentialId,
          serialNumber,
          certificateGeneration: generation,
        };
      }
      finalized = true;
      // The head advances exactly once, here.
      heads.generation = generation;
      heads.version += 1;
      return {
        outcome: "ISSUED",
        credentialId,
        serialNumber,
        certificateGeneration: generation,
        notBefore,
        notAfter,
      };
    },

    async recordOrphanSignature() {
      calls.push("recordOrphanSignature");
    },
  };
}

const sha256 = (value: string): string =>
  createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

// ---------------------------------------------------------------------------
// The fake repository
// ---------------------------------------------------------------------------

interface RepositoryOptions {
  readonly providerKeyState?: string;
  readonly providerKeyFingerprint?: string;
  readonly providerKeyGeneration?: number | null;
  readonly providerKeyPresent?: boolean;
  readonly persistedMutator?: (links: StoredChainLink[]) => StoredChainLink[];
  readonly persistedFingerprint?: string;
}

function fakeRepository(
  world: World,
  db: FakeDatabase,
  options: RepositoryOptions = {},
): IncumbentCredentialRepository {
  const head: CredentialHeadRecord = {
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    currentGeneration: 1,
    previousGeneration: null,
    overlapEndsAt: null,
    version: 1,
  };

  const incumbent: IncumbentCredentialRecord = {
    credentialId: CURRENT_CREDENTIAL,
    serialNumber: "DEV-UNIT-GEN1",
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    certificateGeneration: 1,
    assignmentGeneration: 1,
    publicKeyFingerprint: world.fingerprint,
    issuerKeyId: world.ca.intermediateKeyId,
    hardwareTrustLevel: "development_software",
    state: "issued",
    revokedAt: null,
    canonicalTbs: world.incumbentLinks[2]!.canonicalTbs,
    detachedSignature: world.incumbentLinks[2]!.detachedSignature,
  };

  /** Built lazily so it reflects whatever the fake database finalized. */
  const persistedGen2 = (): { record: IncumbentCredentialRecord; links: StoredChainLink[] } => {
    const signature = db.recordedSignatures[0] ?? new Uint8Array([0]);
    const canonical = Buffer.from(
      tbsBytes({
        certificateId: NEXT_CREDENTIAL,
        serialNumber: "DEV-UNIT-GEN2",
        role: "device",
        purpose: "device_identity",
        environment: "development",
        subjectFingerprint: options.persistedFingerprint ?? world.fingerprint,
        subjectPublicKeyPem: world.devicePublicKeyPem,
        issuerKeyId: world.ca.intermediateKeyId,
        deviceRecordId: DEVICE,
        certificateGeneration: 2,
        hardwareTrustLevel: "development_software",
        productionEligible: false,
        notBefore: NEW_NOT_BEFORE,
        notAfter: NEW_NOT_AFTER,
      }),
    ).toString("utf8");
    const links: StoredChainLink[] = [
      world.incumbentLinks[0]!,
      world.incumbentLinks[1]!,
      { linkPosition: 2, role: "device", canonicalTbs: canonical, detachedSignature: signature },
    ];
    return {
      record: {
        ...incumbent,
        credentialId: NEXT_CREDENTIAL,
        serialNumber: "DEV-UNIT-GEN2",
        certificateGeneration: 2,
        publicKeyFingerprint: options.persistedFingerprint ?? world.fingerprint,
        canonicalTbs: canonical,
        detachedSignature: signature,
      },
      links: options.persistedMutator?.(links) ?? links,
    };
  };

  return {
    async loadCredentialHead() {
      return head;
    },
    async loadCredentialAtGeneration(_scope, generation) {
      if (generation === 1) return incumbent;
      if (generation === 2 && db.heads.generation === 2) return persistedGen2().record;
      return null;
    },
    async loadCredentialChainLinks(credentialId) {
      if (credentialId === CURRENT_CREDENTIAL) return world.incumbentLinks;
      if (credentialId === NEXT_CREDENTIAL) return persistedGen2().links;
      return [];
    },
    async loadRevocationState() {
      return { credentialRevoked: false, deviceRevoked: false };
    },
    async loadCurrentProviderKey(): Promise<ProviderKeyRecord | null> {
      if (options.providerKeyPresent === false) return null;
      return {
        keyId: "66666666-6666-4666-8666-666666666666",
        deviceRecordId: DEVICE,
        environment: "development",
        purpose: "device_identity",
        generation: 1,
        keyGeneration:
          options.providerKeyGeneration === undefined ? 1 : options.providerKeyGeneration,
        publicKeyFingerprint: options.providerKeyFingerprint ?? world.fingerprint,
        providerKeyReference: KEY_HANDLE,
        state: options.providerKeyState ?? "active",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Reservation gateway
// ---------------------------------------------------------------------------

const RESERVED: ReservedRenewalRow = {
  outcome: "RESERVED",
  renewalAttemptId: ATTEMPT,
  renewalMode: "reuse_current_key",
  currentCredentialId: CURRENT_CREDENTIAL,
  currentCredentialGeneration: 1,
  nextCredentialGeneration: 2,
  assignmentGeneration: 1,
  credentialHeadVersion: 1,
  status: "issuance_pending",
};

function fakeReservationGateway(
  row: ReservedRenewalRow = RESERVED,
  order?: string[],
): RenewalReservationGateway {
  return {
    async reserveRenewal() {
      order?.push("reserve");
      return row;
    },
  };
}

function issuanceInput(
  world: World,
  overrides: Partial<SameKeyRenewalIssuanceInput> = {},
): SameKeyRenewalIssuanceInput {
  return {
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    idempotencyKey: "a".repeat(64),
    actorRef: "UNIT-TEST",
    trustedTime: trustedAt(NOW),
    trustedRootFingerprints: [world.ca.rootCertificate.tbs.subjectFingerprint],
    currentAssignmentGeneration: 1,
    ...overrides,
  };
}

async function run(
  world: World,
  db: FakeDatabase,
  repositoryOptions: RepositoryOptions = {},
  inputOverrides: Partial<SameKeyRenewalIssuanceInput> = {},
  reservation: ReservedRenewalRow = RESERVED,
  order?: string[],
) {
  return completeSameKeyCredentialRenewal(
    issuanceInput(world, inputOverrides),
    fakeRepository(world, db, repositoryOptions),
    fakeReservationGateway(reservation, order),
    db,
    world.ca,
    world.signer,
  );
}

// ===========================================================================
// Preparation
// ===========================================================================
describe("same-key renewal preparation", () => {
  it("runs the preflight and its reservation BEFORE issuance preparation", async () => {
    const world = buildWorld();
    const order: string[] = [];
    const db = fakeDatabase(world);
    const wrapped: FakeDatabase = {
      ...db,
      async prepare(input) {
        order.push("prepare");
        return db.prepare(input);
      },
    };
    const outcome = await run(world, wrapped, {}, {}, RESERVED, order);

    expect(outcome.outcome).toBe("RENEWED");
    expect(order).toEqual(["reserve", "prepare"]);
  });

  it("passes the FROZEN reservation values into preparation", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("RENEWED");
    const prepared = db.prepareInputs[0]!;
    // Assignment generation comes from the RESERVATION, not read fresh.
    expect(prepared.assignmentGeneration).toBe(RESERVED.assignmentGeneration);
    expect(prepared.publicKeyFingerprint).toBe(world.fingerprint);
    expect(prepared.deviceRecordId).toBe(DEVICE);
    // The identity the database derives the credential id and serial FROM is
    // derived from the frozen attempt, never from the caller.
    expect(prepared.idempotencyKey).toBe(renewalIdempotencyKey(outcome.reservation!));
    expect(prepared.requestId).toBe(renewalRequestId(outcome.reservation!));
    expect(prepared.idempotencyKey).not.toBe("a".repeat(64));
  });

  it("refuses a reservation whose mode is not reuse_current_key", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db, {}, {}, { ...RESERVED, renewalMode: "rotate_key" });
    // The preflight refuses first — the mode never reaches issuance.
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_PREFLIGHT_REFUSED");
    expect(outcome.preflightRefusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_MODE_MISMATCH");
    expect(db.calls).not.toContain("prepare");
  });

  it("refuses when the credential head moved between reservation and preparation", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, { headVersionSeen: 4 });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_HEAD_MOVED");
    // Nothing was signed: the binding failed inside prepare.
    expect(db.calls).toEqual(["prepare"]);
    expect(db.recordedSignatures).toHaveLength(0);
  });

  it("refuses when the assignment generation moved", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, { assignmentGeneration: 3 });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_ASSIGNMENT_MOVED");
    expect(db.recordedSignatures).toHaveLength(0);
  });

  it("refuses when the database prepares a generation the reservation did not reserve", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, { preparedGeneration: 3 });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_GENERATION_MISMATCH");
    expect(db.calls).toEqual(["prepare"]);
  });

  it("returns the SAME prepared issuance, credential id and serial on retry", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const first = await run(world, db);
    const second = await run(world, db);

    expect(first.outcome).toBe("RENEWED");
    expect(second.outcome).toBe("REPLAYED");
    expect(second.renewed?.credentialId).toBe(first.renewed?.credentialId);
    expect(second.renewed?.serialNumber).toBe(first.renewed?.serialNumber);
    expect(second.renewed?.credentialGeneration).toBe(first.renewed?.credentialGeneration);
    // The head advanced ONCE across both runs.
    expect(db.heads.version).toBe(2);
  });

  it("generates no key and creates no replacement-key metadata", async () => {
    const world = buildWorld();
    const generateDeviceKey = vi.spyOn(world.provider, "generateDeviceKey");
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("RENEWED");
    expect(generateDeviceKey).not.toHaveBeenCalled();
    expect(outcome.renewed?.keyRotated).toBe(false);
    expect(outcome.renewed?.keyGenerationUnchanged).toBe(true);
    expect(outcome.renewed?.keyGeneration).toBe(1);
    // The reservation carries the field explicitly as NULL — its absence is
    // stated rather than implied — and nothing downstream ever populates it.
    expect(outcome.reservation?.replacementKeyReference).toBeNull();
  });
});

// ===========================================================================
// Canonical TBS
// ===========================================================================
describe("canonical TBS discipline", () => {
  it("signs the database bytes unchanged, and the digests agree", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("RENEWED");
    expect(db.recordedSignatures).toHaveLength(1);
    // The recorded signature verifies over the DATABASE's canonical bytes under
    // the intermediate's public key — which is only possible if exactly those
    // bytes were signed.
    const canonical = db.prepareInputs.length > 0 ? lastCanonical(db) : "";
    const { verifyDetachedSignature } = await import("../src/dev-crypto.js");
    expect(
      verifyDetachedSignature(
        world.ca.intermediateCertificate.tbs.subjectPublicKeyPem,
        Buffer.from(canonical, "utf8"),
        db.recordedSignatures[0]!,
      ),
    ).toBe(true);
  });

  const mutations: ReadonlyArray<readonly [string, (c: string) => string]> = [
    ["credential id", (c) => c.replace(NEXT_CREDENTIAL, CURRENT_CREDENTIAL)],
    ["serial number", (c) => c.replace("DEV-UNIT-GEN2", "DEV-UNIT-FORGED")],
    ["device record id", (c) => c.replace(DEVICE, OTHER_DEVICE)],
    ["credential generation", (c) => replaceLine(c, 10, "9")],
    ["environment", (c) => replaceLine(c, 5, "pilot")],
    ["purpose", (c) => replaceLine(c, 4, "transport_signing")],
    ["not_before", (c) => c.replace(NEW_NOT_BEFORE, "2026-07-01T00:00:00.000Z")],
    ["not_after", (c) => c.replace(NEW_NOT_AFTER, "2027-08-21T00:00:00.000Z")],
    ["hardware trust level", (c) => replaceLine(c, 11, "tpm_2_0")],
  ];

  for (const [field, mutate] of mutations) {
    it(`refuses a canonical TBS whose ${field} was changed`, async () => {
      const world = buildWorld();
      const db = fakeDatabase(world, { mutateCanonicalTbs: mutate });
      const outcome = await run(world, db);

      expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE");
      // NOTHING was signed and nothing recorded.
      expect(db.recordedSignatures).toHaveLength(0);
      expect(db.calls).not.toContain("finalize");
    });
  }

  it("refuses a changed issuer key id", async () => {
    const world = buildWorld();
    const stranger = buildWorld();
    const db = fakeDatabase(world, { issuerKeyId: stranger.ca.intermediateKeyId });
    const outcome = await run(world, db);

    // The CA rebuilds with its OWN issuer key id, so the bytes diverge before
    // any signature exists.
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE");
    expect(db.recordedSignatures).toHaveLength(0);
  });

  it("refuses a fingerprint the reservation did not freeze", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db, { providerKeyFingerprint: "d".repeat(64) });

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_PREFLIGHT_REFUSED");
    expect(db.calls).not.toContain("prepare");
  });

  it("refuses a TBS whose hash does not match its own bytes", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const broken: FakeDatabase = {
      ...db,
      async prepare(input) {
        const prepared = await db.prepare(input);
        return { ...prepared, canonicalTbsHash: "f".repeat(64) };
      },
    };
    const outcome = await run(world, broken);
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE");
  });
});

// ===========================================================================
// Signing
// ===========================================================================
describe("signing with the incumbent key", () => {
  it("selects the existing ACTIVE provider key and proves possession with it", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("RENEWED");
    expect(world.signer.signCalls).toEqual([KEY_HANDLE]);
    expect(outcome.renewed?.providerKeyReference).toBe(KEY_HANDLE);
    // The proof is over the renewal-bound preimage, not a bare nonce.
    const preimage = Buffer.from(samePossessionPreimage(outcome.reservation!)).toString("utf8");
    expect(preimage).toContain("kitluy.same-key-renewal-pop.v1");
    expect(preimage).toContain(ATTEMPT);
    expect(preimage).toContain(world.fingerprint);
  });

  it("refuses a provider key whose fingerprint is not the reservation's", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    // The preflight refuses this first; the point is that it never reaches the CA.
    const outcome = await run(world, db, { providerKeyFingerprint: "e".repeat(64) });
    expect(outcome.outcome).toBe("REFUSED");
    expect(world.signer.signCalls).toHaveLength(0);
  });

  for (const state of [
    "generated",
    "credential_issued_pending_activation",
    "superseded",
    "destroyed",
    "abandoned",
  ]) {
    it(`refuses a provider key in state ${state}`, async () => {
      const world = buildWorld();
      const db = fakeDatabase(world);
      const outcome = await run(world, db, { providerKeyState: state });
      expect(outcome.outcome).toBe("REFUSED");
      expect(db.calls).not.toContain("prepare");
      expect(world.signer.signCalls).toHaveLength(0);
    });
  }

  it("refuses when no provider key is registered", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db, { providerKeyPresent: false });
    expect(outcome.outcome).toBe("REFUSED");
  });

  it("exposes no private-key export surface", () => {
    const world = buildWorld();
    const surface = [
      ...Object.keys(world.signer),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(world.provider)),
      ...Object.keys(world.provider),
    ];
    expect(surface.some((name) => /export|private|secret|reveal/i.test(name))).toBe(false);
  });

  it("verifies the signature BEFORE recording it, and never records one that fails", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    // A CA that returns a signature over the right bytes but from the WRONG key.
    const stranger = buildWorld();
    const badCa = {
      ...world.ca,
      environment: world.ca.environment,
      rootCertificate: world.ca.rootCertificate,
      intermediateCertificate: world.ca.intermediateCertificate,
      intermediateKeyId: world.ca.intermediateKeyId,
      rootKeyId: world.ca.rootKeyId,
      issueDeviceCertificate(args: Parameters<typeof world.ca.issueDeviceCertificate>[0]) {
        const genuine = world.ca.issueDeviceCertificate(args);
        const forged = stranger.ca.issueDeviceCertificate(args);
        // Right TBS, wrong signature.
        return { tbs: genuine.tbs, signature: forged.signature };
      },
    } as unknown as DevelopmentCertificateAuthority;

    const outcome = await completeSameKeyCredentialRenewal(
      issuanceInput(world),
      fakeRepository(world, db),
      fakeReservationGateway(),
      db,
      badCa,
      world.signer,
    );

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_SIGNATURE_SELF_VERIFICATION_FAILED");
    expect(db.calls).not.toContain("recordSignature");
    expect(db.recordedSignatures).toHaveLength(0);
  });

  it("ignores a caller-supplied signature-valid boolean, because none exists", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, { mutateCanonicalTbs: (c) => replaceLine(c, 10, "9") });
    const smuggled = {
      ...issuanceInput(world),
      signatureValid: true,
      popServiceVerified: true,
      chainVerified: true,
    } as unknown as SameKeyRenewalIssuanceInput;

    const outcome = await completeSameKeyCredentialRenewal(
      smuggled,
      fakeRepository(world, db),
      fakeReservationGateway(),
      db,
      world.ca,
      world.signer,
    );
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE");
  });
});

// ===========================================================================
// Recording and finalization
// ===========================================================================
describe("recording and finalization", () => {
  it("records against the frozen request id and the database's own digest", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const recorded: { requestId: string; hash: string }[] = [];
    const watched: FakeDatabase = {
      ...db,
      async recordSignature(input) {
        recorded.push({ requestId: input.requestId, hash: input.canonicalTbsHash });
        return db.recordSignature(input);
      },
    };
    const outcome = await run(world, watched);

    expect(outcome.outcome).toBe("RENEWED");
    expect(recorded[0]?.requestId).toBe(`rnw-${ATTEMPT}`);
    expect(recorded[0]?.hash).toBe(sha256(lastCanonical(db)));
  });

  it("carries a database refusal of a wrong digest through with its reason intact", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, {
      recordThrows: "KLUY-CRED-TBS-MISMATCH: the caller signed a different canonical TBS",
    });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_SIGNATURE_NOT_PERSISTED");
    expect(outcome.detail).toContain("KLUY-CRED-TBS-MISMATCH");
    // A signature exists that nothing accounts for; it is REPORTED.
    expect(outcome.orphanSignature).toBeDefined();
    expect(db.calls).toContain("recordOrphanSignature");
  });

  it("carries a database refusal of the wrong credential through", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, {
      prepareThrows: "KLUY-CRED-REQUEST-PAYLOAD-CHANGED: request was used with a different payload",
    });
    const outcome = await run(world, db);
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_REFUSED_BY_DATABASE");
    expect(outcome.detail).toContain("KLUY-CRED-REQUEST-PAYLOAD-CHANGED");
  });

  it("is idempotent for an identical repeated signature", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const first = await run(world, db);
    const second = await run(world, db);

    expect(first.outcome).toBe("RENEWED");
    expect(second.outcome).toBe("REPLAYED");
    // Exactly ONE signature was ever recorded.
    expect(db.recordedSignatures).toHaveLength(1);
  });

  it("advances the credential head exactly once", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    expect(db.heads).toEqual({ generation: 1, version: 1 });

    await run(world, db);
    expect(db.heads).toEqual({ generation: 2, version: 2 });

    await run(world, db);
    // The retry replayed; it did not advance the head a second time.
    expect(db.heads).toEqual({ generation: 2, version: 2 });
  });

  it("finalizes with the CA links only — the device link is the database's to build", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    await run(world, db);

    const links = db.finalizeCalls[0]!.chainLinks;
    expect(links.map((l) => l.role)).toEqual(["root", "intermediate"]);
    expect(links.some((l) => l.role === "device")).toBe(false);
  });

  it("reports a finalization failure as RECOVERABLE, not as an orphan", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world, {
      finalizeThrows: "KLUY-CRED-RENEWAL-GENERATION-CONFLICT: head moved during signing",
    });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_FINALIZATION_FAILED");
    expect(outcome.recoverableFromRecordedSignature).toBe(true);
    expect(outcome.orphanSignature).toBeUndefined();
  });

  it("reports the four facts of a same-key renewal separately", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.renewed).toMatchObject({
      previousCredentialGeneration: 1,
      credentialGeneration: 2,
      credentialGenerationAdvanced: true,
      keyGenerationUnchanged: true,
      keyRotated: false,
      keyGeneration: 1,
    });
    expect(outcome.renewed?.publicKeyFingerprint).toBe(world.fingerprint);
  });
});

// ===========================================================================
// Post-finalization verification
// ===========================================================================
describe("post-finalization verification", () => {
  it("re-verifies the PERSISTED credential and reports no authentication authority", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db);

    expect(outcome.persistedCredential?.credentialKind).toBe(
      "kitluy.development-device-credential.v1",
    );
    expect(outcome.persistedCredential?.consumersMustReVerifyAtAuthenticationBoundary).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain('"signatureValid"');
  });

  it("refuses to report success when the persisted signature does not verify", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db, {
      // One byte of the PERSISTED device signature, flipped after finalization.
      persistedMutator: (links) =>
        links.map((link) => {
          if (link.role !== "device") return link;
          const signature = new Uint8Array(link.detachedSignature);
          signature[0] = signature[0]! ^ 0xff;
          return { ...link, detachedSignature: signature };
        }),
    });

    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_POST_VERIFICATION_FAILED");
    expect(outcome.detail).toContain("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");
    // The credential IS on disk; saying otherwise would send an operator hunting.
    expect(outcome.recoverableFromRecordedSignature).toBe(true);
  });

  it("refuses when the persisted credential attests to another key", async () => {
    const world = buildWorld();
    const db = fakeDatabase(world);
    const outcome = await run(world, db, { persistedFingerprint: "c".repeat(64) });
    expect(outcome.refusalCode).toBe("RENEWAL_ISSUANCE_POST_VERIFICATION_FAILED");
  });
});

// ---------------------------------------------------------------------------

function lastCanonical(db: FakeDatabase): string {
  const input = db.prepareInputs[0]!;
  return Buffer.from(
    tbsBytes({
      certificateId: NEXT_CREDENTIAL,
      serialNumber: "DEV-UNIT-GEN2",
      role: "device",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: input.publicKeyFingerprint,
      subjectPublicKeyPem: input.publicKeyPem,
      issuerKeyId: input.issuerKeyId,
      deviceRecordId: input.deviceRecordId,
      certificateGeneration: 2,
      hardwareTrustLevel: "development_software",
      productionEligible: false,
      notBefore: NEW_NOT_BEFORE,
      notAfter: NEW_NOT_AFTER,
    }),
  ).toString("utf8");
}

/** Replaces one line of a canonical TBS, by index, leaving the rest intact. */
function replaceLine(canonical: string, index: number, value: string): string {
  const lines = canonical.split("\n");
  // The PEM occupies several lines; indices after it are counted from the end.
  const trailing = 7;
  if (index < 7) {
    lines[index] = value;
  } else {
    lines[lines.length - trailing + (index - 8)] = value;
  }
  return lines.join("\n");
}
