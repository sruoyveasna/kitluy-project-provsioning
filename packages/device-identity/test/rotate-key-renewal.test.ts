/**
 * Optional `rotate_key` renewal and provider activation — focused unit tests.
 *
 * The CA is real, both device keys are real, the proof of possession is a real
 * Ed25519 signature over the real challenge bytes, and every canonical TBS is
 * the one `tbsBytes` produces. Nothing that decides trust is stubbed.
 */
import { describe, it, expect } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";

import {
  DevelopmentCertificateAuthority,
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
  DevelopmentReplacementKeyProvider,
  ReplacementKeyError,
} from "../src/replacement-key-provider.js";
import {
  buildReplacementChallenge,
  completeRotateKeyCredentialRenewal,
  rotationIdempotencyKey,
  rotationRequestId,
  type ActivationConfirmation,
  type RegisteredReplacementKey,
  type ReplacementKeyRow,
  type RotateKeyRenewalInput,
  type RotationGateway,
} from "../src/rotate-key-renewal-issuance.js";
import { replacementChallengeBytes, verifyReplacementKeyPop } from "../src/replacement-key-pop.js";
import { requestBytes } from "../src/certificate-issuance.js";
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
const OTHER_ATTEMPT = "66666666-6666-4666-8666-666666666666";
const INCUMBENT_HANDLE = "dev-device:incumbent";

const T0 = new Date("2026-07-01T00:00:00.000Z");
const INCUMBENT_NOT_AFTER = new Date(T0.getTime() + 30 * MS_PER_DAY);
const NOW = new Date(INCUMBENT_NOT_AFTER.getTime() - 9 * MS_PER_DAY);
const NEW_NOT_BEFORE = "2026-07-22T00:00:00.000Z";
const NEW_NOT_AFTER = "2026-08-21T00:00:00.000Z";

const sha256 = (v: string): string =>
  createHash("sha256").update(Buffer.from(v, "utf8")).digest("hex");

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
// A real CA and a real incumbent
// ---------------------------------------------------------------------------

interface World {
  readonly ca: DevelopmentCertificateAuthority;
  readonly incumbentPem: string;
  readonly incumbentFingerprint: string;
  readonly incumbentLinks: StoredChainLink[];
  readonly provider: DevelopmentReplacementKeyProvider;
}

function buildWorld(): World {
  const ca = new DevelopmentCertificateAuthority({
    notBefore: new Date(T0.getTime() - 365 * MS_PER_DAY),
    notAfter: new Date(T0.getTime() + 3650 * MS_PER_DAY),
  });
  const { publicKey } = generateKeyPairSync("ed25519");
  const incumbentPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const incumbentFingerprint = publicKeyFingerprint(incumbentPem);

  const incumbent = ca.issueDeviceCertificate({
    deviceRecordId: DEVICE,
    subjectPublicKeyPem: incumbentPem,
    subjectFingerprint: incumbentFingerprint,
    hardwareTrustLevel: "development_software",
    certificateGeneration: 1,
    notBefore: T0,
    notAfter: INCUMBENT_NOT_AFTER,
    serialNumber: "DEV-ROT-GEN1",
    certificateId: CURRENT_CREDENTIAL,
  });

  const link = (p: number, role: string, c: Certificate): StoredChainLink => ({
    linkPosition: p,
    role,
    canonicalTbs: Buffer.from(tbsBytes(c.tbs)).toString("utf8"),
    detachedSignature: c.signature,
  });

  return {
    ca,
    incumbentPem,
    incumbentFingerprint,
    incumbentLinks: [
      link(0, "root", ca.rootCertificate),
      link(1, "intermediate", ca.intermediateCertificate),
      link(2, "device", incumbent),
    ],
    provider: new DevelopmentReplacementKeyProvider(),
  };
}

// ---------------------------------------------------------------------------
// Fake governed database
// ---------------------------------------------------------------------------

interface DbOptions {
  readonly mutateCanonicalTbs?: (c: string) => string;
  readonly registeredState?: string;
  readonly registeredFingerprint?: string;
  readonly registeredKeyGeneration?: number;
  readonly confirmThrows?: string;
  readonly registerThrows?: string;
  readonly pendingStateAfterFinalize?: string;
}

interface FakeDb {
  readonly issuance: GovernedIssuanceGateway;
  readonly rotation: RotationGateway;
  readonly calls: string[];
  readonly prepareInputs: PrepareInput[];
  readonly recorded: Uint8Array[];
  readonly finalizeCalls: { requestId: string; chainLinks: readonly ChainLinkInput[] }[];
  readonly confirmations: number;
  head: { generation: number; version: number };
}

function fakeDb(world: World, options: DbOptions = {}): FakeDb {
  const calls: string[] = [];
  const prepareInputs: PrepareInput[] = [];
  const recorded: Uint8Array[] = [];
  const finalizeCalls: { requestId: string; chainLinks: readonly ChainLinkInput[] }[] = [];
  const head = { generation: 1, version: 1 };
  let finalized = false;
  let confirmations = 0;
  let registeredRow: ReplacementKeyRow | null = null;

  const db: FakeDb = {
    calls,
    prepareInputs,
    recorded,
    finalizeCalls,
    head,
    get confirmations() {
      return confirmations;
    },

    issuance: {
      async prepare(input): Promise<PreparedReservation> {
        calls.push("prepare");
        prepareInputs.push(input);
        if (finalized) {
          return {
            outcome: "ALREADY_ISSUED",
            requestId: input.requestId,
            credentialId: NEXT_CREDENTIAL,
            serialNumber: "DEV-ROT-GEN2",
            certificateGeneration: 2,
          };
        }
        const canonical = Buffer.from(
          tbsBytes({
            certificateId: NEXT_CREDENTIAL,
            serialNumber: "DEV-ROT-GEN2",
            role: "device",
            purpose: "device_identity",
            environment: "development",
            subjectFingerprint: input.publicKeyFingerprint,
            subjectPublicKeyPem: input.publicKeyPem,
            issuerKeyId: world.ca.intermediateKeyId,
            deviceRecordId: input.deviceRecordId,
            certificateGeneration: 2,
            hardwareTrustLevel: "development_software",
            productionEligible: false,
            notBefore: NEW_NOT_BEFORE,
            notAfter: NEW_NOT_AFTER,
          }),
        ).toString("utf8");
        const served = options.mutateCanonicalTbs?.(canonical) ?? canonical;
        return {
          outcome: "RESERVED",
          requestId: input.requestId,
          credentialId: NEXT_CREDENTIAL,
          serialNumber: "DEV-ROT-GEN2",
          certificateGeneration: 2,
          assignmentGeneration: 1,
          issuerKeyId: world.ca.intermediateKeyId,
          notBefore: NEW_NOT_BEFORE,
          notAfter: NEW_NOT_AFTER,
          canonicalTbs: served,
          canonicalTbsHash: sha256(served),
          headVersionSeen: 1,
          alreadySigned: false,
        };
      },
      async recordSignature(input) {
        calls.push("recordSignature");
        recorded.push(input.detachedSignature);
        return { outcome: "RECORDED" };
      },
      async finalize(input): Promise<FinalizedCredential> {
        calls.push("finalize");
        finalizeCalls.push({ requestId: input.requestId, chainLinks: input.chainLinks });
        if (finalized) {
          return {
            outcome: "ALREADY_ISSUED",
            credentialId: NEXT_CREDENTIAL,
            serialNumber: "DEV-ROT-GEN2",
            certificateGeneration: 2,
          };
        }
        finalized = true;
        head.generation = 2;
        head.version += 1;
        // TASK D: the credential exists; the provider has NOT been asked.
        if (registeredRow !== null) {
          registeredRow = {
            ...registeredRow,
            state: options.pendingStateAfterFinalize ?? "credential_issued_pending_activation",
          };
        }
        return {
          outcome: "ISSUED",
          credentialId: NEXT_CREDENTIAL,
          serialNumber: "DEV-ROT-GEN2",
          certificateGeneration: 2,
          notBefore: NEW_NOT_BEFORE,
          notAfter: NEW_NOT_AFTER,
        };
      },
      async recordOrphanSignature() {
        calls.push("recordOrphanSignature");
      },
    },

    rotation: {
      async registerReplacementKey(input): Promise<RegisteredReplacementKey> {
        calls.push("registerReplacementKey");
        if (options.registerThrows !== undefined) throw new Error(options.registerThrows);
        if (registeredRow !== null) {
          if (registeredRow.publicKeyFingerprint !== input.publicKeyFingerprint) {
            throw new Error("KLUY-KEY-ATTEMPT-TAKEN: this attempt already holds a different key");
          }
          return {
            outcome: "ALREADY_REGISTERED",
            keyId: registeredRow.keyId,
            state: registeredRow.state,
            providerKeyReference: registeredRow.providerKeyReference,
          };
        }
        registeredRow = {
          keyId: "key-1",
          state: options.registeredState ?? "generated",
          keyGeneration: options.registeredKeyGeneration ?? input.keyGeneration,
          generation: 2,
          publicKeyFingerprint: options.registeredFingerprint ?? input.publicKeyFingerprint,
          providerKeyReference: input.providerKeyReference,
          renewalAttemptId: input.renewalAttemptId,
        };
        return {
          outcome: "REGISTERED",
          keyId: registeredRow.keyId,
          state: registeredRow.state,
          providerKeyReference: registeredRow.providerKeyReference,
        };
      },
      async loadReplacementKey() {
        return registeredRow;
      },
      async loadReservationStatus() {
        if (registeredRow === null) return "key_generation_pending";
        if (registeredRow.state === "active") return "completed";
        if (finalized) return "activation_pending";
        return "pop_pending";
      },
      async confirmProviderKeyActivation(): Promise<ActivationConfirmation> {
        calls.push("confirmProviderKeyActivation");
        if (options.confirmThrows !== undefined) throw new Error(options.confirmThrows);
        const already = registeredRow?.state === "active";
        if (registeredRow !== null) registeredRow = { ...registeredRow, state: "active" };
        confirmations += 1;
        return { outcome: already ? "ALREADY_ACTIVE" : "ACTIVATED", keyId: "key-1" };
      },
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Repository + reservation
// ---------------------------------------------------------------------------

const RESERVED: ReservedRenewalRow = {
  outcome: "RESERVED",
  renewalAttemptId: ATTEMPT,
  renewalMode: "rotate_key",
  currentCredentialId: CURRENT_CREDENTIAL,
  currentCredentialGeneration: 1,
  nextCredentialGeneration: 2,
  assignmentGeneration: 1,
  credentialHeadVersion: 1,
  status: "key_generation_pending",
};

function fakeRepository(
  world: World,
  db: FakeDb,
  options: { incumbentKeyState?: string; incumbentKeyGeneration?: number | null } = {},
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
    serialNumber: "DEV-ROT-GEN1",
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    certificateGeneration: 1,
    assignmentGeneration: 1,
    publicKeyFingerprint: world.incumbentFingerprint,
    issuerKeyId: world.ca.intermediateKeyId,
    hardwareTrustLevel: "development_software",
    state: "issued",
    revokedAt: null,
    canonicalTbs: world.incumbentLinks[2]!.canonicalTbs,
    detachedSignature: world.incumbentLinks[2]!.detachedSignature,
  };

  const persisted = (): { record: IncumbentCredentialRecord; links: StoredChainLink[] } => {
    const replacement = world.provider.describeReplacementKey(ATTEMPT);
    const fingerprint = replacement?.publicKeyFingerprint ?? world.incumbentFingerprint;
    const pem = replacement?.publicKeyPem ?? world.incumbentPem;
    const canonical = Buffer.from(
      tbsBytes({
        certificateId: NEXT_CREDENTIAL,
        serialNumber: "DEV-ROT-GEN2",
        role: "device",
        purpose: "device_identity",
        environment: "development",
        subjectFingerprint: fingerprint,
        subjectPublicKeyPem: pem,
        issuerKeyId: world.ca.intermediateKeyId,
        deviceRecordId: DEVICE,
        certificateGeneration: 2,
        hardwareTrustLevel: "development_software",
        productionEligible: false,
        notBefore: NEW_NOT_BEFORE,
        notAfter: NEW_NOT_AFTER,
      }),
    ).toString("utf8");
    return {
      record: {
        ...incumbent,
        credentialId: NEXT_CREDENTIAL,
        serialNumber: "DEV-ROT-GEN2",
        certificateGeneration: 2,
        publicKeyFingerprint: fingerprint,
        canonicalTbs: canonical,
        detachedSignature: db.recorded[0] ?? new Uint8Array([0]),
      },
      links: [
        world.incumbentLinks[0]!,
        world.incumbentLinks[1]!,
        {
          linkPosition: 2,
          role: "device",
          canonicalTbs: canonical,
          detachedSignature: db.recorded[0] ?? new Uint8Array([0]),
        },
      ],
    };
  };

  return {
    async loadCredentialHead() {
      return head;
    },
    async loadCredentialAtGeneration(_s, generation) {
      if (generation === 1) return incumbent;
      if (generation === 2 && db.head.generation === 2) return persisted().record;
      return null;
    },
    async loadCredentialChainLinks(credentialId) {
      if (credentialId === CURRENT_CREDENTIAL) return world.incumbentLinks;
      if (credentialId === NEXT_CREDENTIAL) return persisted().links;
      return [];
    },
    async loadRevocationState() {
      return { credentialRevoked: false, deviceRevoked: false };
    },
    async loadCurrentProviderKey(): Promise<ProviderKeyRecord | null> {
      return {
        keyId: "incumbent-key",
        deviceRecordId: DEVICE,
        environment: "development",
        purpose: "device_identity",
        generation: 1,
        keyGeneration:
          options.incumbentKeyGeneration === undefined ? 1 : options.incumbentKeyGeneration,
        publicKeyFingerprint: world.incumbentFingerprint,
        providerKeyReference: INCUMBENT_HANDLE,
        state: options.incumbentKeyState ?? "active",
      };
    },
  };
}

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

function rotationInput(world: World): RotateKeyRenewalInput {
  return {
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    idempotencyKey: "a".repeat(64),
    actorRef: "UNIT-TEST",
    trustedTime: trustedAt(NOW),
    trustedRootFingerprints: [world.ca.rootCertificate.tbs.subjectFingerprint],
    currentAssignmentGeneration: 1,
  };
}

async function run(
  world: World,
  db: FakeDb,
  repositoryOptions: Parameters<typeof fakeRepository>[2] = {},
  reservation: ReservedRenewalRow = RESERVED,
  order?: string[],
) {
  return completeRotateKeyCredentialRenewal(
    rotationInput(world),
    fakeRepository(world, db, repositoryOptions),
    fakeReservationGateway(reservation, order),
    db.rotation,
    db.issuance,
    world.ca,
    world.provider,
  );
}

const SCOPE = {
  deviceRecordId: DEVICE,
  environment: "development",
  purpose: "device_identity",
  renewalAttemptId: ATTEMPT,
  keyGeneration: 2,
} as const;

// ===========================================================================
// Policy and reservation
// ===========================================================================
describe("rotation policy and reservation", () => {
  it("is refused when the database says rotation is not permitted", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, db),
      {
        async reserveRenewal() {
          throw new Error(
            "KLUY-RENEWAL-ROTATION-NOT-PERMITTED: key rotation is disabled for development pending [REQUIRED: renewal_key_rotation_owner_decision]",
          );
        },
      },
      db.rotation,
      db.issuance,
      world.ca,
      world.provider,
    );

    expect(outcome.refusalCode).toBe("ROTATION_NOT_PERMITTED");
    expect(outcome.detail).toContain("[REQUIRED: renewal_key_rotation_owner_decision]");
    // Asking for the mode authorized nothing, and no key was generated.
    expect(world.provider.generationCount).toBe(0);
  });

  it("is refused when no policy exists at all — no code default may authorize one", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, db),
      {
        async reserveRenewal() {
          throw new Error(
            "KLUY-RENEWAL-NO-POLICY: no renewal policy is configured for development",
          );
        },
      },
      db.rotation,
      db.issuance,
      world.ca,
      world.provider,
    );
    expect(outcome.refusalCode).toBe("ROTATION_NOT_PERMITTED");
    expect(world.provider.generationCount).toBe(0);
  });

  it("reserves BEFORE it generates a key", async () => {
    const world = buildWorld();
    const order: string[] = [];
    const db = fakeDb(world);
    const watched = {
      ...db.rotation,
      async registerReplacementKey(i: Parameters<RotationGateway["registerReplacementKey"]>[0]) {
        order.push("register");
        return db.rotation.registerReplacementKey(i);
      },
    };
    const provider = new DevelopmentReplacementKeyProvider();
    const generating = {
      ...provider,
      generateReplacementKey: async (s: typeof SCOPE) => {
        order.push("generate");
        return provider.generateReplacementKey(s);
      },
      describeReplacementKey: provider.describeReplacementKey.bind(provider),
      proveReplacementPossession: provider.proveReplacementPossession.bind(provider),
      activateReplacementKey: provider.activateReplacementKey.bind(provider),
      abandonReplacementKey: provider.abandonReplacementKey.bind(provider),
    };

    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, { ...db, recorded: db.recorded } as FakeDb),
      fakeReservationGateway(RESERVED, order),
      watched,
      db.issuance,
      world.ca,
      generating,
    );

    expect(outcome.outcome).toBe("REFUSED"); // the fake repo cannot see this provider
    // What matters is the ORDER: nothing is generated before a reservation.
    expect(order[0]).toBe("reserve");
    expect(order.indexOf("generate")).toBeGreaterThan(order.indexOf("reserve"));
  });

  it("refuses when the database froze a mode other than rotate_key", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db, {}, { ...RESERVED, renewalMode: "reuse_current_key" });
    // The shared preflight catches the disagreement first.
    expect(outcome.refusalCode).toBe("ROTATION_PREFLIGHT_REFUSED");
    expect(outcome.preflightRefusalCode).toBe("RENEWAL_PREFLIGHT_RESERVATION_MODE_MISMATCH");
    expect(world.provider.generationCount).toBe(0);
  });

  it("carries a competing reservation through with its own code", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, db),
      {
        async reserveRenewal() {
          throw new Error(
            "KLUY-RENEWAL-ALREADY-RESERVED: generation 2 already has an open reservation",
          );
        },
      },
      db.rotation,
      db.issuance,
      world.ca,
      world.provider,
    );
    expect(outcome.refusalCode).toBe("ROTATION_PREFLIGHT_REFUSED");
    expect(outcome.preflightRefusalCode).toBe("RENEWAL_PREFLIGHT_ALREADY_RESERVED");
    expect(outcome.detail).toContain("KLUY-RENEWAL-ALREADY-RESERVED");
  });

  it("falls back to the credential generation when a key predates the key_generation column", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    // Group 0130 SPLIT key generation from credential generation; keys
    // registered before it carry null. The preflight falls back to the
    // credential generation the key was registered against — which for a
    // generation-1 key is 1 — so rotation still knows the next one is 2.
    const outcome = await run(world, db, { incumbentKeyGeneration: null });
    expect(outcome.outcome).toBe("ROTATED");
    expect(outcome.rotated?.previousKeyGeneration).toBe(1);
    expect(outcome.rotated?.keyGeneration).toBe(2);
  });
});

// ===========================================================================
// Key generation
// ===========================================================================
describe("replacement key generation", () => {
  it("returns the SAME key, reference and fingerprint for the same attempt", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const first = await provider.generateReplacementKey(SCOPE);
    const second = await provider.generateReplacementKey(SCOPE);

    expect(second.providerKeyReference).toBe(first.providerKeyReference);
    expect(second.publicKeyFingerprint).toBe(first.publicKeyFingerprint);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
    expect(provider.generationCount).toBe(1);
    expect(first.state).toBe("generated");
  });

  it("refuses to serve one attempt's key to another attempt, device, scope or generation", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    await provider.generateReplacementKey(SCOPE);

    await expect(
      provider.generateReplacementKey({ ...SCOPE, deviceRecordId: OTHER_DEVICE }),
    ).rejects.toThrow(/PROVIDER_KEY_WRONG_DEVICE/);
    await expect(
      provider.generateReplacementKey({ ...SCOPE, purpose: "transport_signing" }),
    ).rejects.toThrow(/PROVIDER_KEY_WRONG_SCOPE/);
    await expect(provider.generateReplacementKey({ ...SCOPE, keyGeneration: 3 })).rejects.toThrow(
      /PROVIDER_KEY_WRONG_GENERATION/,
    );

    // A DIFFERENT attempt gets its OWN key, never this one.
    const other = await provider.generateReplacementKey({
      ...SCOPE,
      renewalAttemptId: OTHER_ATTEMPT,
    });
    const mine = provider.describeReplacementKey(ATTEMPT)!;
    expect(other.providerKeyReference).not.toBe(mine.providerKeyReference);
    expect(other.publicKeyFingerprint).not.toBe(mine.publicKeyFingerprint);
    expect(provider.generationCount).toBe(2);
  });

  it("exposes no private-key surface at all", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const descriptor = await provider.generateReplacementKey(SCOPE);
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(provider) as object),
      ...Object.keys(provider),
      ...Object.keys(descriptor),
      ...Object.keys(descriptor.metadata),
      // `exportable` is the NEGATIVE flag that says the key cannot leave, so it
      // is excluded from the name sweep and asserted false on its own below.
    ].filter((n) => n !== "exportable");
    expect(surface.some((n) => /export|private|secret|reveal|unwrap/i.test(n))).toBe(false);
    expect(descriptor.metadata.exportable).toBe(false);
    expect(descriptor.metadata.generatedOnDevice).toBe(true);
    expect(JSON.stringify(descriptor)).not.toContain("PRIVATE KEY");
  });

  it("publishes metadata that matches the key it generated", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const descriptor = await provider.generateReplacementKey(SCOPE);
    expect(publicKeyFingerprint(descriptor.publicKeyPem)).toBe(descriptor.publicKeyFingerprint);
    expect(descriptor.metadata.publicKeyFingerprint).toBe(descriptor.publicKeyFingerprint);
    expect(descriptor.keyGeneration).toBe(2);
    expect(descriptor.renewalAttemptId).toBe(ATTEMPT);
  });

  it("advances the key generation by exactly one, and the credential generation separately", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("ROTATED");
    expect(outcome.rotated?.previousKeyGeneration).toBe(1);
    expect(outcome.rotated?.keyGeneration).toBe(2);
    expect(outcome.rotated?.previousCredentialGeneration).toBe(1);
    expect(outcome.rotated?.credentialGeneration).toBe(2);
    expect(world.provider.generationCount).toBe(1);
  });

  it("refuses a provider that returns the incumbent key as a replacement", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const impostor = {
      ...world.provider,
      generateReplacementKey: async () => ({
        providerKeyReference: "dev-replacement:impostor",
        publicKeyPem: world.incumbentPem,
        publicKeyFingerprint: world.incumbentFingerprint,
        keyGeneration: 2,
        renewalAttemptId: ATTEMPT,
        deviceRecordId: DEVICE,
        environment: "development",
        purpose: "device_identity",
        state: "generated" as const,
        metadata: {
          publicKeyFingerprint: world.incumbentFingerprint,
          algorithm: "ed25519",
          hardwareTrustLevel: "development_software" as const,
          exportable: false,
          generatedOnDevice: true,
        },
      }),
      describeReplacementKey: world.provider.describeReplacementKey.bind(world.provider),
      proveReplacementPossession: world.provider.proveReplacementPossession.bind(world.provider),
      activateReplacementKey: world.provider.activateReplacementKey.bind(world.provider),
      abandonReplacementKey: world.provider.abandonReplacementKey.bind(world.provider),
    };

    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, db),
      fakeReservationGateway(),
      db.rotation,
      db.issuance,
      world.ca,
      impostor,
    );
    expect(outcome.refusalCode).toBe("ROTATION_REPLACEMENT_REUSES_INCUMBENT");
    expect(db.calls).not.toContain("registerReplacementKey");
  });
});

// ===========================================================================
// Registration and proof of possession
// ===========================================================================
describe("registration and proof of possession", () => {
  it("registers the generated key and proceeds", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);
    expect(outcome.outcome).toBe("ROTATED");
    expect(db.calls).toContain("registerReplacementKey");
  });

  it("refuses when the registered fingerprint is not the generated one", async () => {
    const world = buildWorld();
    const db = fakeDb(world, { registeredFingerprint: "d".repeat(64) });
    const outcome = await run(world, db);
    expect(outcome.refusalCode).toBe("ROTATION_REGISTRATION_DIVERGED");
    expect(db.calls).not.toContain("prepare");
  });

  it("refuses when the registered key generation is not the reserved one", async () => {
    const world = buildWorld();
    const db = fakeDb(world, { registeredKeyGeneration: 9 });
    const outcome = await run(world, db);
    expect(outcome.refusalCode).toBe("ROTATION_REGISTRATION_DIVERGED");
  });

  it("carries a database registration refusal through with its reason intact", async () => {
    const world = buildWorld();
    const db = fakeDb(world, {
      registerThrows: "KLUY-RENEWAL-NOT-ROTATION: only rotate_key generates a replacement key",
    });
    const outcome = await run(world, db);
    expect(outcome.refusalCode).toBe("ROTATION_REGISTRATION_REFUSED");
    expect(outcome.detail).toContain("KLUY-RENEWAL-NOT-ROTATION");
  });

  it("proves possession with the REPLACEMENT key over the renewal-bound challenge", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);
    expect(outcome.outcome).toBe("ROTATED");

    const replacement = world.provider.describeReplacementKey(ATTEMPT)!;
    const challenge = buildReplacementChallenge(
      outcome.reservation!,
      replacement.publicKeyFingerprint,
      NOW,
    );
    // The PoP signature the pipeline sent is the one over THESE bytes.
    const verdict = verifyReplacementKeyPop(
      challenge,
      db.prepareInputs[0]!.popSignature,
      replacement.publicKeyPem,
      {
        renewalAttemptId: ATTEMPT,
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentGeneration: 1,
        nextGeneration: 2,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        providerKeyFingerprint: replacement.publicKeyFingerprint,
        providerKeyState: "generated",
      },
      trustedAt(NOW),
      publicKeyFingerprint,
    );
    expect(verdict.verified).toBe(true);
  });

  it("refuses an ENROLLMENT proof of possession — the domain separator differs", async () => {
    const world = buildWorld();
    const provider = new DevelopmentReplacementKeyProvider();
    const replacement = await provider.generateReplacementKey(SCOPE);

    // A genuine signature over `kitluy.csr.v1` bytes, offered as a renewal PoP.
    const enrollmentBytes = requestBytes({
      requestId: "rq-enrol",
      deviceRecordId: DEVICE,
      environment: "development",
      devicePublicKeyPem: replacement.publicKeyPem,
      publicKeyFingerprint: replacement.publicKeyFingerprint,
      hardwareTrustLevel: "development_software",
      assignmentGeneration: 1,
      requestedPurpose: "device_identity",
      requestedAt: NOW,
      nonce: "n",
      correlationId: "c",
      proofOfPossession: new Uint8Array(),
    });
    const enrollmentSignature = provider.proveReplacementPossession(
      replacement.providerKeyReference,
      enrollmentBytes,
    );

    const challenge = buildReplacementChallenge(
      {
        renewalAttemptId: ATTEMPT,
        renewalMode: "rotate_key",
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentCredentialGeneration: 1,
        nextCredentialGeneration: 2,
        credentialHeadVersion: 1,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        currentPublicKeyFingerprint: world.incumbentFingerprint,
        currentKeyGeneration: 1,
        reservationStatus: "key_generation_pending",
        replacementKeyReference: null,
      },
      replacement.publicKeyFingerprint,
      NOW,
    );
    const verdict = verifyReplacementKeyPop(
      challenge,
      enrollmentSignature,
      replacement.publicKeyPem,
      {
        renewalAttemptId: ATTEMPT,
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentGeneration: 1,
        nextGeneration: 2,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        providerKeyFingerprint: replacement.publicKeyFingerprint,
        providerKeyState: "generated",
      },
      trustedAt(NOW),
      publicKeyFingerprint,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  const bindingAttacks: ReadonlyArray<
    readonly [string, Partial<Parameters<typeof buildReplacementChallenge>[0]>, string]
  > = [
    ["another renewal attempt", { renewalAttemptId: OTHER_ATTEMPT }, "POP_WRONG_RENEWAL_ATTEMPT"],
    ["another device", { deviceRecordId: OTHER_DEVICE }, "POP_WRONG_DEVICE"],
    ["another incumbent", { currentCredentialId: NEXT_CREDENTIAL }, "POP_WRONG_CURRENT_CREDENTIAL"],
    [
      "another current generation",
      { currentCredentialGeneration: 5 },
      "POP_WRONG_CURRENT_GENERATION",
    ],
    ["another next generation", { nextCredentialGeneration: 9 }, "POP_WRONG_NEXT_GENERATION"],
    [
      "another assignment generation",
      { assignmentGeneration: 4 },
      "POP_WRONG_ASSIGNMENT_GENERATION",
    ],
    ["another purpose", { purpose: "transport_signing" }, "POP_WRONG_PURPOSE"],
  ];

  for (const [name, override, expected] of bindingAttacks) {
    it(`refuses a GENUINE signature bound to ${name}`, async () => {
      const world = buildWorld();
      const provider = new DevelopmentReplacementKeyProvider();
      const replacement = await provider.generateReplacementKey(SCOPE);

      const base = {
        renewalAttemptId: ATTEMPT,
        renewalMode: "rotate_key" as const,
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentCredentialGeneration: 1,
        nextCredentialGeneration: 2,
        credentialHeadVersion: 1,
        assignmentGeneration: 1,
        environment: "development" as const,
        purpose: "device_identity",
        currentPublicKeyFingerprint: world.incumbentFingerprint,
        currentKeyGeneration: 1,
        reservationStatus: "key_generation_pending",
        replacementKeyReference: null,
      };
      // Signed for real, over the DIFFERENTLY BOUND challenge. The maths is
      // valid; the binding is not, and that is what has to refuse.
      const forged = buildReplacementChallenge(
        { ...base, ...override },
        replacement.publicKeyFingerprint,
        NOW,
      );
      const signature = provider.proveReplacementPossession(
        replacement.providerKeyReference,
        replacementChallengeBytes(forged),
      );

      const verdict = verifyReplacementKeyPop(
        forged,
        signature,
        replacement.publicKeyPem,
        {
          renewalAttemptId: ATTEMPT,
          deviceRecordId: DEVICE,
          currentCredentialId: CURRENT_CREDENTIAL,
          currentGeneration: 1,
          nextGeneration: 2,
          assignmentGeneration: 1,
          environment: "development",
          purpose: "device_identity",
          providerKeyFingerprint: replacement.publicKeyFingerprint,
          providerKeyState: "generated",
        },
        trustedAt(NOW),
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe(expected);
    });
  }

  it("refuses a proof whose fingerprint is not the registered key's", async () => {
    const world = buildWorld();
    const db = fakeDb(world, { registeredState: "generated" });
    const provider = new DevelopmentReplacementKeyProvider();
    const replacement = await provider.generateReplacementKey(SCOPE);
    const challenge = buildReplacementChallenge(
      {
        renewalAttemptId: ATTEMPT,
        renewalMode: "rotate_key",
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentCredentialGeneration: 1,
        nextCredentialGeneration: 2,
        credentialHeadVersion: 1,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        currentPublicKeyFingerprint: world.incumbentFingerprint,
        currentKeyGeneration: 1,
        reservationStatus: "key_generation_pending",
        replacementKeyReference: null,
      },
      replacement.publicKeyFingerprint,
      NOW,
    );
    const signature = provider.proveReplacementPossession(
      replacement.providerKeyReference,
      replacementChallengeBytes(challenge),
    );
    const verdict = verifyReplacementKeyPop(
      challenge,
      signature,
      replacement.publicKeyPem,
      {
        renewalAttemptId: ATTEMPT,
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentGeneration: 1,
        nextGeneration: 2,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        // The DATABASE says a different key. The proof is refused whatever the
        // challenge claims about itself.
        providerKeyFingerprint: "e".repeat(64),
        providerKeyState: "generated",
      },
      trustedAt(NOW),
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_FINGERPRINT_MISMATCH");
    void db;
  });

  it("refuses an expired proof against trusted time", async () => {
    const world = buildWorld();
    const provider = new DevelopmentReplacementKeyProvider();
    const replacement = await provider.generateReplacementKey(SCOPE);
    const reservation = {
      renewalAttemptId: ATTEMPT,
      renewalMode: "rotate_key" as const,
      deviceRecordId: DEVICE,
      currentCredentialId: CURRENT_CREDENTIAL,
      currentCredentialGeneration: 1,
      nextCredentialGeneration: 2,
      credentialHeadVersion: 1,
      assignmentGeneration: 1,
      environment: "development" as const,
      purpose: "device_identity",
      currentPublicKeyFingerprint: world.incumbentFingerprint,
      currentKeyGeneration: 1,
      reservationStatus: "key_generation_pending",
      replacementKeyReference: null,
    };
    const challenge = buildReplacementChallenge(
      reservation,
      replacement.publicKeyFingerprint,
      NOW,
      60,
    );
    const signature = provider.proveReplacementPossession(
      replacement.providerKeyReference,
      replacementChallengeBytes(challenge),
    );
    const verdict = verifyReplacementKeyPop(
      challenge,
      signature,
      replacement.publicKeyPem,
      {
        renewalAttemptId: ATTEMPT,
        deviceRecordId: DEVICE,
        currentCredentialId: CURRENT_CREDENTIAL,
        currentGeneration: 1,
        nextGeneration: 2,
        assignmentGeneration: 1,
        environment: "development",
        purpose: "device_identity",
        providerKeyFingerprint: replacement.publicKeyFingerprint,
        providerKeyState: "generated",
      },
      // Two minutes later, against TRUSTED time.
      trustedAt(new Date(NOW.getTime() + 120_000)),
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_EXPIRED");
  });

  it("refuses a proof from an ABANDONED key before the signature is checked", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const replacement = await provider.generateReplacementKey(SCOPE);
    provider.abandonReplacementKey(ATTEMPT, "lost the renewal");

    expect(() =>
      provider.proveReplacementPossession(replacement.providerKeyReference, Buffer.from("x")),
    ).toThrow(/PROVIDER_KEY_ABANDONED/);
    expect(provider.describeReplacementKey(ATTEMPT)?.state).toBe("abandoned");
  });
});

// ===========================================================================
// Issuance
// ===========================================================================
describe("rotation issuance", () => {
  it("signs the database bytes unchanged, with the CA intermediate", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);
    expect(outcome.outcome).toBe("ROTATED");

    const replacement = world.provider.describeReplacementKey(ATTEMPT)!;
    const canonical = Buffer.from(
      tbsBytes({
        certificateId: NEXT_CREDENTIAL,
        serialNumber: "DEV-ROT-GEN2",
        role: "device",
        purpose: "device_identity",
        environment: "development",
        subjectFingerprint: replacement.publicKeyFingerprint,
        subjectPublicKeyPem: replacement.publicKeyPem,
        issuerKeyId: world.ca.intermediateKeyId,
        deviceRecordId: DEVICE,
        certificateGeneration: 2,
        hardwareTrustLevel: "development_software",
        productionEligible: false,
        notBefore: NEW_NOT_BEFORE,
        notAfter: NEW_NOT_AFTER,
      }),
    ).toString("utf8");

    const { verifyDetachedSignature } = await import("../src/dev-crypto.js");
    // Verifies under the INTERMEDIATE — so the intermediate signed it, and it
    // signed exactly the database's bytes.
    expect(
      verifyDetachedSignature(
        world.ca.intermediateCertificate.tbs.subjectPublicKeyPem,
        Buffer.from(canonical, "utf8"),
        db.recorded[0]!,
      ),
    ).toBe(true);
    // And NOT under the replacement device key: the device does not self-sign.
    expect(
      verifyDetachedSignature(
        replacement.publicKeyPem,
        Buffer.from(canonical, "utf8"),
        db.recorded[0]!,
      ),
    ).toBe(false);
  });

  it("presents the REPLACEMENT fingerprint to preparation, never the incumbent", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);
    const replacement = world.provider.describeReplacementKey(ATTEMPT)!;

    expect(db.prepareInputs[0]?.publicKeyFingerprint).toBe(replacement.publicKeyFingerprint);
    expect(db.prepareInputs[0]?.publicKeyFingerprint).not.toBe(world.incumbentFingerprint);
    expect(outcome.rotated?.replacementPublicKeyFingerprint).toBe(replacement.publicKeyFingerprint);
    // The identity the database derives the serial from is DERIVED, not chosen.
    expect(db.prepareInputs[0]?.idempotencyKey).toBe(rotationIdempotencyKey(outcome.reservation!));
    expect(db.prepareInputs[0]?.requestId).toBe(rotationRequestId(outcome.reservation!));
  });

  it("refuses a canonical TBS the database did not build", async () => {
    const world = buildWorld();
    const db = fakeDb(world, {
      mutateCanonicalTbs: (c) => c.replace("DEV-ROT-GEN2", "DEV-ROT-FORGED"),
    });
    const outcome = await run(world, db);
    expect(outcome.refusalCode).toBe("ROTATION_CANONICAL_TBS_DIVERGENCE");
    expect(db.recorded).toHaveLength(0);
    expect(db.calls).not.toContain("finalize");
  });

  it("leaves the key PENDING after finalization, and refuses to call that ready", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const states: string[] = [];
    const watching = {
      ...db.rotation,
      async loadReplacementKey(id: string) {
        const row = await db.rotation.loadReplacementKey(id);
        if (row !== null) states.push(row.state);
        return row;
      },
    };
    const outcome = await completeRotateKeyCredentialRenewal(
      rotationInput(world),
      fakeRepository(world, db),
      fakeReservationGateway(),
      watching,
      db.issuance,
      world.ca,
      world.provider,
    );

    expect(outcome.outcome).toBe("ROTATED");
    // The state observed immediately after finalization is the pending one.
    expect(states).toContain("credential_issued_pending_activation");
    // And the ORDER holds: pending is seen before active.
    expect(states.indexOf("credential_issued_pending_activation")).toBeLessThan(
      states.lastIndexOf("active"),
    );
  });

  it("refuses when finalization left the key in some other state", async () => {
    const world = buildWorld();
    const db = fakeDb(world, { pendingStateAfterFinalize: "active" });
    const outcome = await run(world, db);
    // A key that became `active` on credential insert is the exact claim
    // migration 0130 TASK D forbids.
    expect(outcome.refusalCode).toBe("ROTATION_PENDING_STATE_UNEXPECTED");
    expect(outcome.credentialIssuedButNotActivated?.replacementKeyState).toBe("active");
    expect(db.calls).not.toContain("confirmProviderKeyActivation");
  });
});

// ===========================================================================
// Activation
// ===========================================================================
describe("provider activation and database confirmation", () => {
  it("activates in the provider, confirms in the database, and reports readiness", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("ROTATED");
    expect(world.provider.activationCount).toBe(1);
    expect(db.confirmations).toBe(1);
    expect(outcome.readiness).toMatchObject({
      credentialCryptographicallyValid: true,
      replacementKeyActiveInProvider: true,
      databaseActivationConfirmed: true,
      operationallyReady: true,
    });
    expect(outcome.rotated?.keyRotated).toBe(true);
  });

  it("is idempotent in the provider for an identical activation", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const key = await provider.generateReplacementKey(SCOPE);
    const request = {
      ...SCOPE,
      providerKeyReference: key.providerKeyReference,
      publicKeyFingerprint: key.publicKeyFingerprint,
      credentialFinalized: true,
    };
    const first = await provider.activateReplacementKey(request);
    const second = await provider.activateReplacementKey(request);
    expect(first.state).toBe("active");
    expect(second.state).toBe("active");
    expect(provider.activationCount).toBe(1);
  });

  it("refuses activation with a wrong provider reference or fingerprint", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const key = await provider.generateReplacementKey(SCOPE);
    const base = {
      ...SCOPE,
      providerKeyReference: key.providerKeyReference,
      publicKeyFingerprint: key.publicKeyFingerprint,
      credentialFinalized: true,
    };

    await expect(
      provider.activateReplacementKey({ ...base, providerKeyReference: "dev-replacement:other" }),
    ).rejects.toThrow(/PROVIDER_KEY_WRONG_ATTEMPT/);
    await expect(
      provider.activateReplacementKey({ ...base, publicKeyFingerprint: "f".repeat(64) }),
    ).rejects.toThrow(/PROVIDER_KEY_FINGERPRINT_MISMATCH/);
    await expect(
      provider.activateReplacementKey({ ...base, deviceRecordId: OTHER_DEVICE }),
    ).rejects.toThrow(/PROVIDER_KEY_WRONG_DEVICE/);
    await expect(provider.activateReplacementKey({ ...base, keyGeneration: 7 })).rejects.toThrow(
      /PROVIDER_KEY_WRONG_GENERATION/,
    );
    expect(provider.activationCount).toBe(0);
  });

  it("refuses to activate an abandoned or destroyed key", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const key = await provider.generateReplacementKey(SCOPE);
    provider.abandonReplacementKey(ATTEMPT, "loser");
    await expect(
      provider.activateReplacementKey({
        ...SCOPE,
        providerKeyReference: key.providerKeyReference,
        publicKeyFingerprint: key.publicKeyFingerprint,
        credentialFinalized: true,
      }),
    ).rejects.toThrow(/PROVIDER_KEY_ABANDONED/);
  });

  it("refuses to abandon a key that is already active — that would abandon the winner", async () => {
    const provider = new DevelopmentReplacementKeyProvider();
    const key = await provider.generateReplacementKey(SCOPE);
    await provider.activateReplacementKey({
      ...SCOPE,
      providerKeyReference: key.providerKeyReference,
      publicKeyFingerprint: key.publicKeyFingerprint,
      credentialFinalized: true,
    });
    expect(() => provider.abandonReplacementKey(ATTEMPT, "cleanup")).toThrow(ReplacementKeyError);
  });

  it("carries a database confirmation refusal through, with the credential still recorded", async () => {
    const world = buildWorld();
    const db = fakeDb(world, {
      confirmThrows: "KLUY-ACTIVATION-WRONG-FINGERPRINT: the fingerprint does not match",
    });
    const outcome = await run(world, db);

    expect(outcome.refusalCode).toBe("ROTATION_ACTIVATION_CONFIRMATION_REFUSED");
    expect(outcome.detail).toContain("KLUY-ACTIVATION-WRONG-FINGERPRINT");
    // The credential IS on disk, and the result says so rather than implying
    // the whole rotation vanished.
    expect(outcome.credentialIssuedButNotActivated?.credentialGeneration).toBe(2);
    expect(outcome.readiness).toBeUndefined();
  });

  it("does not destroy or abandon the incumbent key anywhere in the flow", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);

    expect(outcome.outcome).toBe("ROTATED");
    // The incumbent is REPORTED, and this module never asked anyone to retire
    // it: supersession belongs to confirm_provider_key_activation_v1, after the
    // replacement is active.
    expect(outcome.rotated?.incumbentProviderKeyReference).toBe(INCUMBENT_HANDLE);
    expect(outcome.rotated?.incumbentPublicKeyFingerprint).toBe(world.incumbentFingerprint);
    expect(db.calls).not.toContain("abandonReplacementKey");
    expect(db.calls.filter((c) => c === "confirmProviderKeyActivation")).toHaveLength(1);
  });

  it("returns no caller-usable trust verdict", async () => {
    const world = buildWorld();
    const db = fakeDb(world);
    const outcome = await run(world, db);
    const flattened = JSON.stringify(outcome);
    expect(flattened).not.toContain('"signatureValid"');
    expect(outcome.readiness?.consumersMustReVerifyAtAuthenticationBoundary).toBe(true);
  });
});
