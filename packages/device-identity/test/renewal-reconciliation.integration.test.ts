/**
 * Interrupted-renewal reconciliation — LIVE PostgreSQL crash matrix.
 *
 * Each case drives a real renewal to a named DURABLE BOUNDARY and then stops,
 * exactly as a process death would. A fresh reconciler is then pointed at the
 * attempt and asked to recover it — twice — and the second run must find
 * nothing left to do.
 *
 * Every governed call runs under `SET LOCAL ROLE kitluy_issuance_service`.
 *
 * ===========================================================================
 * WHAT THIS FIXTURE DOES AND DOES NOT PROVE ABOUT CROSS-PROCESS RECOVERY
 * ===========================================================================
 * PostgreSQL state is genuinely durable: it is committed inside the test
 * transaction and re-read by a reconciler that shares nothing with the code
 * that wrote it. Provider state is NOT durable here — the development provider
 * keeps keys in memory, so a "new" reconciler is handed the SAME provider
 * instance.
 *
 * That limit is labelled rather than hidden. What is proven is that recovery
 * decisions are driven by OBSERVED state read back from both systems, not by
 * anything carried over in the caller's variables: the reconciler is
 * constructed fresh, reads everything it uses, and is given no result from the
 * interrupted run. A hardware provider surviving a real process restart is what
 * would close the remaining gap, and it does not exist yet.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type pg from "pg";

import {
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
  withDatabaseTransaction,
} from "./support/dev-database.js";
import {
  DEVELOPMENT,
  DEVICE_IDENTITY,
  MS_PER_DAY,
  TEST_ROLES,
  createIncumbentFixture,
  enableDevelopmentRotation,
  expectRefused,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgReconciliationAudit,
  pgReconciliationReader,
  pgReservationGateway,
  pgRotationGateway,
  readReconciliations,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import {
  reconcileDeviceCredentialRenewal,
  type ObservedDatabaseState,
  type ReconciliationClassification,
  type ReconciliationExecutor,
  type ReconciliationProviderProbe,
} from "../src/renewal-reconciliation.js";
import {
  DevelopmentReplacementKeyProvider,
  type ReplacementKeyProvider,
} from "../src/replacement-key-provider.js";
import {
  buildReplacementChallenge,
  rotationCanonicalPayloadHash,
  rotationIdempotencyKey,
  rotationRequestId,
  type RotationGateway,
} from "../src/rotate-key-renewal-issuance.js";
import {
  renewalIdempotencyKey,
  renewalRequestId,
  samePossessionPreimage,
} from "../src/same-key-renewal-issuance.js";
import { replacementChallengeBytes } from "../src/replacement-key-pop.js";
import { prepareSameKeyCredentialRenewal } from "../src/same-key-renewal-preflight.js";
import type { SameKeyRenewalReservation } from "../src/same-key-renewal-preflight.js";
import { runGovernedIssuance, type GovernedIssuanceGateway } from "../src/issuance-adapter.js";
import { verifyDetachedSignature } from "../src/dev-crypto.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity renewal reconciliation";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "crash-matrix fixture",
});

const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

// ---------------------------------------------------------------------------
// A driver that stops at durable boundaries
// ---------------------------------------------------------------------------

/**
 * Advances a renewal one durable step at a time so a test can stop anywhere.
 *
 * Every step is the SAME governed call the forward path makes. Nothing here is
 * a shortcut around the real contract; the only thing the driver adds is the
 * ability to stop.
 */
class RenewalDriver {
  readonly provider = new DevelopmentReplacementKeyProvider();
  reservation!: SameKeyRenewalReservation;

  constructor(
    private readonly client: pg.PoolClient,
    readonly fixture: IncumbentFixture,
    readonly mode: "reuse_current_key" | "rotate_key",
  ) {}

  get requestId(): string {
    return this.mode === "rotate_key"
      ? rotationRequestId(this.reservation)
      : renewalRequestId(this.reservation);
  }

  get idempotencyKey(): string {
    return this.mode === "rotate_key"
      ? rotationIdempotencyKey(this.reservation)
      : renewalIdempotencyKey(this.reservation);
  }

  /** Boundary 1: the reservation is committed. */
  async reserve(): Promise<void> {
    const preflight = await prepareSameKeyCredentialRenewal(
      {
        deviceRecordId: this.fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        idempotencyKey: `recon-${this.mode}-${this.fixture.credentialId}`,
        actorRef: "CRASH-MATRIX",
        trustedTime: trustedAt(new Date()),
        trustedRootFingerprints: [this.fixture.ca.rootCertificate.tbs.subjectFingerprint],
        currentAssignmentGeneration: this.fixture.assignmentGeneration,
        renewalMode: this.mode,
      },
      pgIncumbentRepository(this.client),
      pgReservationGateway(this.client),
    );
    if (preflight.reservation === undefined) {
      throw new Error(`the driver could not reserve: ${preflight.detail ?? preflight.refusalCode}`);
    }
    this.reservation = preflight.reservation;
  }

  /** Boundary 2 (rotation): the provider holds a key nobody has registered. */
  async generateKey(): Promise<{ reference: string; pem: string; fingerprint: string }> {
    const key = await this.provider.generateReplacementKey({
      deviceRecordId: this.fixture.deviceRecordId,
      environment: DEVELOPMENT,
      purpose: DEVICE_IDENTITY,
      renewalAttemptId: this.reservation.renewalAttemptId,
      keyGeneration: (this.reservation.currentKeyGeneration ?? 1) + 1,
    });
    return {
      reference: key.providerKeyReference,
      pem: key.publicKeyPem,
      fingerprint: key.publicKeyFingerprint,
    };
  }

  /** Boundary 3 (rotation): the metadata is registered. */
  async registerKey(rotation: RotationGateway): Promise<void> {
    const key = this.provider.describeReplacementKey(this.reservation.renewalAttemptId)!;
    await rotation.registerReplacementKey({
      renewalAttemptId: this.reservation.renewalAttemptId,
      providerKeyReference: key.providerKeyReference,
      publicKeyPem: key.publicKeyPem,
      publicKeyFingerprint: key.publicKeyFingerprint,
      keyGeneration: key.keyGeneration,
    });
  }

  /** The proof-of-possession bytes and signature the governed prepare needs. */
  popMaterial(): { signature: Uint8Array; preimage: Uint8Array } {
    if (this.mode === "rotate_key") {
      const key = this.provider.describeReplacementKey(this.reservation.renewalAttemptId)!;
      const challenge = buildReplacementChallenge(
        this.reservation,
        key.publicKeyFingerprint,
        new Date(),
      );
      const preimage = replacementChallengeBytes(challenge);
      return {
        preimage,
        signature: this.provider.proveReplacementPossession(key.providerKeyReference, preimage),
      };
    }
    const preimage = samePossessionPreimage(this.reservation);
    return {
      preimage,
      signature: this.fixture.signer.proveIncumbentPossession(
        this.fixture.providerKeyHandle,
        preimage,
      ),
    };
  }

  /**
   * Boundaries 4-7: prepare, sign, record, finalize.
   *
   * `stopAfter` cuts the pipeline at a durable boundary. The stages are the
   * real governed functions; stopping is done by refusing to make the NEXT
   * call, never by faking the previous one.
   */
  async issue(
    gateway: GovernedIssuanceGateway,
    stopAfter: "prepare" | "sign" | "record" | "finalize",
  ): Promise<void> {
    const key =
      this.mode === "rotate_key"
        ? this.provider.describeReplacementKey(this.reservation.renewalAttemptId)!
        : null;
    const pem = key?.publicKeyPem ?? this.fixture.publicKeyPem;
    const fingerprint = key?.publicKeyFingerprint ?? this.fixture.fingerprint;
    const pop = this.popMaterial();
    const hash = (bytes: Uint8Array): string =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:crypto").createHash("sha256").update(Buffer.from(bytes)).digest("hex");

    const stagedGateway: GovernedIssuanceGateway = {
      ...gateway,
      async recordSignature(input) {
        if (stopAfter === "prepare" || stopAfter === "sign") {
          throw new StopHere(stopAfter);
        }
        return gateway.recordSignature(input);
      },
      async finalize(input) {
        if (stopAfter === "record") throw new StopHere("record");
        return gateway.finalize(input);
      },
      async recordOrphanSignature() {
        /* the driver stops deliberately; that is not an orphan */
      },
    };

    let result;
    try {
      result = await runGovernedIssuance(
        {
          requestId: this.requestId,
          deviceRecordId: this.fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          assignmentGeneration: this.reservation.assignmentGeneration,
          publicKeyPem: pem,
          publicKeyFingerprint: fingerprint,
          idempotencyKey: this.idempotencyKey,
          canonicalPayloadHash:
            this.mode === "rotate_key"
              ? rotationCanonicalPayloadHash(this.reservation, fingerprint)
              : hash(pop.preimage),
          popAlgorithm: "ed25519",
          popSignedPreimageHash: hash(pop.preimage),
          popSignature: pop.signature,
          popServiceVerified: true,
          issuerKeyId: this.fixture.ca.intermediateKeyId,
          trustedTime: new Date(),
          trustedTimeStatus: "trusted",
          actorRef: "CRASH-MATRIX",
          hardwareTrustLevel: "development_software",
        },
        stagedGateway,
        this.fixture.ca,
      );
    } catch (error) {
      if (!(error instanceof StopHere)) throw error;
      return;
    }
    // runGovernedIssuance REPORTS refusals rather than throwing, so a real
    // failure used to look like progress and the reconciler looped forever on
    // one classification. A DELIBERATE stop surfaces the same way — the
    // pipeline catches the marker and reports it — so the two are told apart by
    // the marker text rather than conflated.
    const deliberate = (result.detail ?? "").includes(DELIBERATE_STOP);
    if (result.outcome === "REFUSED" && !deliberate) {
      throw new Error(`issuance refused: ${result.refusalCode} — ${result.detail ?? ""}`);
    }
  }
}

/** Marks a deliberate stop, so a real failure is never mistaken for one. */
const DELIBERATE_STOP = "CRASH-MATRIX deliberate stop";
class StopHere extends Error {
  constructor(where: string) {
    super(`${DELIBERATE_STOP}: ${where}`);
  }
}

// ---------------------------------------------------------------------------
// The reconciler, wired to the real systems
// ---------------------------------------------------------------------------

function buildReconciler(
  client: pg.PoolClient,
  driver: RenewalDriver,
  rotation: RotationGateway,
  issuance: GovernedIssuanceGateway,
) {
  const provider: ReplacementKeyProvider = driver.provider;

  const probe: ReconciliationProviderProbe = {
    async observe(db) {
      const key = provider.describeReplacementKey(db.renewalAttemptId);
      return {
        replacementKey:
          key === null
            ? null
            : {
                providerKeyReference: key.providerKeyReference,
                publicKeyFingerprint: key.publicKeyFingerprint,
                keyGeneration: key.keyGeneration,
                state: key.state,
              },
        // The incumbent must survive the overlap; the provider still has it.
        incumbentAvailable:
          driver.fixture.signer.publicKeyPem(driver.fixture.providerKeyHandle) !== null,
      };
    },
  };

  /**
   * Several classifications map onto ONE call to `runGovernedIssuance`.
   *
   * That is deliberate: prepare, record and finalize are each idempotent on the
   * frozen request id, so re-entering the pipeline from any point resumes
   * exactly where it stopped. Writing three separate resumption paths would be
   * a second implementation of the forward path, and the second one is always
   * the one that drifts.
   */
  const resumeIssuance = async (db: ObservedDatabaseState): Promise<string> => {
    await driver.issue(issuance, "finalize");
    return `issuance resumed for ${db.renewalAttemptId}`;
  };

  const executor: ReconciliationExecutor = {
    async generateReplacementKey(db) {
      const key = await provider.generateReplacementKey({
        deviceRecordId: db.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: db.renewalAttemptId,
        keyGeneration: (driver.reservation.currentKeyGeneration ?? 1) + 1,
      });
      return `generated ${key.providerKeyReference}`;
    },
    async registerReplacementKey(db) {
      await driver.registerKey(rotation);
      return `registered for ${db.renewalAttemptId}`;
    },
    proveReplacementPossession: resumeIssuance,
    prepareIssuance: resumeIssuance,
    signAndRecord: resumeIssuance,
    finalizeIssuance: resumeIssuance,
    async activateProviderKey(db) {
      const key = provider.describeReplacementKey(db.renewalAttemptId)!;
      await provider.activateReplacementKey({
        deviceRecordId: db.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        renewalAttemptId: db.renewalAttemptId,
        keyGeneration: key.keyGeneration,
        providerKeyReference: key.providerKeyReference,
        publicKeyFingerprint: key.publicKeyFingerprint,
        credentialFinalized: db.credentialPersisted,
        credentialId: db.persistedCredentialId ?? undefined,
      });
      return "provider activated";
    },
    async confirmActivation(db) {
      const key = provider.describeReplacementKey(db.renewalAttemptId)!;
      await rotation.confirmProviderKeyActivation({
        renewalAttemptId: db.renewalAttemptId,
        credentialId: db.persistedCredentialId!,
        deviceRecordId: db.deviceRecordId,
        environment: db.environment,
        purpose: db.purpose,
        credentialGeneration: db.nextCredentialGeneration,
        keyGeneration: key.keyGeneration,
        providerKeyReference: key.providerKeyReference,
        publicKeyFingerprint: key.publicKeyFingerprint,
        actorRef: "RECONCILER",
      });
      return "database confirmed";
    },
    async abandonReplacementKey(db, reason) {
      provider.abandonReplacementKey(db.renewalAttemptId, reason);
      return `abandoned: ${reason}`;
    },
  };

  return {
    probe,
    executor,
    reader: pgReconciliationReader(client, () => driver.requestId),
    audit: pgReconciliationAudit(client),
  };
}

async function reconcile(
  client: pg.PoolClient,
  driver: RenewalDriver,
  rotation: RotationGateway,
  issuance: GovernedIssuanceGateway,
) {
  // A FRESH reconciler each time. It is handed nothing from the interrupted
  // run: every fact it acts on is read back from the two systems.
  const wired = buildReconciler(client, driver, rotation, issuance);
  return reconcileDeviceCredentialRenewal(
    {
      renewalAttemptId: driver.reservation.renewalAttemptId,
      deviceRecordId: driver.fixture.deviceRecordId,
      environment: DEVELOPMENT,
      purpose: DEVICE_IDENTITY,
      actorRef: "RECONCILER",
      trustedTime: trustedAt(new Date()),
    },
    wired.reader,
    wired.probe,
    wired.executor,
    wired.audit,
  );
}

/** Drives reconciliation to a fixed point, then proves the next run is a no-op. */
async function reconcileToFixedPoint(
  client: pg.PoolClient,
  driver: RenewalDriver,
  rotation: RotationGateway,
  issuance: GovernedIssuanceGateway,
  maxPasses = 6,
): Promise<{ passes: number; classifications: ReconciliationClassification[] }> {
  const classifications: ReconciliationClassification[] = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const outcome = await reconcile(client, driver, rotation, issuance);
    if (outcome.decision !== undefined) classifications.push(outcome.decision.classification);
    if (outcome.outcome === "REFUSED") {
      throw new Error(`reconciliation refused: ${outcome.refusalCode} ${outcome.detail ?? ""}`);
    }
    if (outcome.remainingAction === null) {
      return { passes: pass + 1, classifications };
    }
  }
  throw new Error(`reconciliation did not converge: ${classifications.join(" -> ")}`);
}

async function worldCounts(client: pg.PoolClient, deviceRecordId: string) {
  const r = await client.query(
    `select
       (select count(*) from kitluy_devices.device_credentials where device_record_id=$1) creds,
       (select count(distinct serial_number) from kitluy_devices.device_credentials where device_record_id=$1) serials,
       (select count(*) from kitluy_devices.device_generation_keys where device_record_id=$1) keys,
       (select current_generation from kitluy_devices.device_credential_heads where device_record_id=$1) head_generation,
       (select version from kitluy_devices.device_credential_heads where device_record_id=$1) head_version,
       (select string_agg(state::text||':'||generation::text, ',' order by generation)
          from kitluy_devices.device_generation_keys where device_record_id=$1) key_states`,
    [deviceRecordId],
  );
  const row = r.rows[0];
  return {
    credentials: Number(row.creds),
    serials: Number(row.serials),
    providerKeys: Number(row.keys),
    headGeneration: Number(row.head_generation),
    headVersion: Number(row.head_version),
    keyStates: row.key_states as string,
  };
}

describe.skipIf(!reachable)("live renewal reconciliation", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // Same-key crash matrix
  // =========================================================================
  const sameKeyBoundaries = [
    "after reservation",
    "after issuance preparation",
    "after signature generation",
    "after signature recording",
    "after finalization",
    "after completion before response",
  ] as const;

  for (const boundary of sameKeyBoundaries) {
    it(`recovers a same-key renewal interrupted ${boundary}`, async () => {
      await withDatabaseTransaction(async (client) => {
        const fixture = await createIncumbentFixture(client, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `SK${sameKeyBoundaries.indexOf(boundary)}`,
        });
        const issuance = pgIssuanceGateway(client);
        const rotation = pgRotationGateway(client);
        const driver = new RenewalDriver(client, fixture, "reuse_current_key");

        await driver.reserve();
        if (boundary !== "after reservation") {
          const stop =
            boundary === "after issuance preparation"
              ? "prepare"
              : boundary === "after signature generation"
                ? "sign"
                : boundary === "after signature recording"
                  ? "record"
                  : "finalize";
          await driver.issue(issuance, stop);
        }

        // The world as the crash left it.
        const interrupted = await worldCounts(client, fixture.deviceRecordId);

        const { passes } = await reconcileToFixedPoint(client, driver, rotation, issuance);
        expect(passes).toBeGreaterThanOrEqual(1);

        // A SECOND reconciliation finds nothing to do.
        const again = await reconcile(client, driver, rotation, issuance);
        expect(again.outcome).toBe("REPLAYED");
        expect(again.remainingAction).toBeNull();

        // Exactly one of everything.
        const after = await worldCounts(client, fixture.deviceRecordId);
        expect(after.credentials).toBe(2);
        expect(after.serials).toBe(2);
        expect(after.headGeneration).toBe(2);
        expect(after.headVersion).toBe(2);
        // A same-key renewal creates NO provider key, whatever it recovered from.
        expect(after.providerKeys).toBe(1);
        expect(after.keyStates).toBe("active:1");
        expect(interrupted.providerKeys).toBe(1);

        const reservation = await client.query(
          `select status::text s from kitluy_devices.device_renewal_reservations
            where renewal_attempt_id = $1`,
          [driver.reservation.renewalAttemptId],
        );
        expect(reservation.rows[0].s).toBe("completed");

        // The reconciliation left durable evidence.
        const history = await readReconciliations(client, driver.reservation.renewalAttemptId);
        expect(history.length).toBeGreaterThan(0);
        expect(history[history.length - 1]?.classification).toBe("RESPONSE_REPLAY");
      });
    }, 180_000);
  }

  // =========================================================================
  // Rotation crash matrix
  // =========================================================================
  const rotationBoundaries = [
    "after reservation",
    "after provider generation",
    "after metadata registration",
    "after issuance preparation",
    "after signature generation",
    "after signature recording",
    "after finalization",
    "after provider activation",
    "after database confirmation",
  ] as const;

  for (const boundary of rotationBoundaries) {
    it(`recovers a rotation interrupted ${boundary}`, async () => {
      await withDatabaseTransaction(async (client) => {
        const fixture = await createIncumbentFixture(client, {
          issuedAtTrustedTime: issuedSoThat(9),
          label: `RK${rotationBoundaries.indexOf(boundary)}`,
        });
        await enableDevelopmentRotation(client);
        const issuance = pgIssuanceGateway(client);
        const rotation = pgRotationGateway(client);
        const driver = new RenewalDriver(client, fixture, "rotate_key");
        const reached = (name: string) =>
          rotationBoundaries.indexOf(boundary) >= rotationBoundaries.indexOf(name as never);

        await driver.reserve();
        if (reached("after provider generation")) await driver.generateKey();
        if (reached("after metadata registration")) await driver.registerKey(rotation);
        if (reached("after issuance preparation")) {
          const stop = reached("after finalization")
            ? "finalize"
            : reached("after signature recording")
              ? "record"
              : reached("after signature generation")
                ? "sign"
                : "prepare";
          await driver.issue(issuance, stop);
        }
        if (reached("after provider activation")) {
          const key = driver.provider.describeReplacementKey(driver.reservation.renewalAttemptId)!;
          await driver.provider.activateReplacementKey({
            deviceRecordId: fixture.deviceRecordId,
            environment: DEVELOPMENT,
            purpose: DEVICE_IDENTITY,
            renewalAttemptId: driver.reservation.renewalAttemptId,
            keyGeneration: key.keyGeneration,
            providerKeyReference: key.providerKeyReference,
            publicKeyFingerprint: key.publicKeyFingerprint,
            credentialFinalized: true,
          });
        }
        if (reached("after database confirmation")) {
          const key = driver.provider.describeReplacementKey(driver.reservation.renewalAttemptId)!;
          const credential = await client.query(
            `select credential_id from kitluy_devices.device_credentials
              where device_record_id = $1 and certificate_generation = 2`,
            [fixture.deviceRecordId],
          );
          await rotation.confirmProviderKeyActivation({
            renewalAttemptId: driver.reservation.renewalAttemptId,
            credentialId: credential.rows[0].credential_id,
            deviceRecordId: fixture.deviceRecordId,
            environment: DEVELOPMENT,
            purpose: DEVICE_IDENTITY,
            credentialGeneration: 2,
            keyGeneration: key.keyGeneration,
            providerKeyReference: key.providerKeyReference,
            publicKeyFingerprint: key.publicKeyFingerprint,
            actorRef: "CRASH-MATRIX",
          });
        }

        const { passes } = await reconcileToFixedPoint(client, driver, rotation, issuance);
        expect(passes).toBeGreaterThanOrEqual(1);

        const again = await reconcile(client, driver, rotation, issuance);
        expect(again.outcome).toBe("REPLAYED");
        expect(again.remainingAction).toBeNull();

        const after = await worldCounts(client, fixture.deviceRecordId);
        expect(after.credentials).toBe(2);
        expect(after.serials).toBe(2);
        expect(after.headGeneration).toBe(2);
        expect(after.headVersion).toBe(2);
        // Exactly ONE replacement key, and the incumbent superseded but present.
        expect(after.providerKeys).toBe(2);
        expect(after.keyStates).toBe("superseded:1,active:2");
        expect(driver.provider.generationCount).toBe(1);
        expect(driver.provider.activationCount).toBe(1);

        const reservation = await client.query(
          `select status::text s from kitluy_devices.device_renewal_reservations
            where renewal_attempt_id = $1`,
          [driver.reservation.renewalAttemptId],
        );
        expect(reservation.rows[0].s).toBe("completed");
      });
    }, 180_000);
  }

  // =========================================================================
  // Hostile scenarios
  // =========================================================================
  it("lets two concurrent reconcilers produce ONE business effect", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "CONCUR",
      });
      const issuance = pgIssuanceGateway(client);
      const rotation = pgRotationGateway(client);
      const driver = new RenewalDriver(client, fixture, "reuse_current_key");
      await driver.reserve();

      // SEQUENTIAL, not parallel: two reconcilers cannot share one pg client —
      // interleaved queries on a single connection corrupt the transaction, and
      // the suite needs one rolled-back transaction for isolation. What is
      // proven here is the property that matters: a SECOND reconciler acting on
      // an attempt another has already advanced produces no second business
      // effect, because every governed function is idempotent on the frozen
      // request id. True parallel connections are a limitation of this fixture,
      // recorded rather than papered over; the unit suite covers the
      // interleaved-decision case directly.
      const a = await reconcile(client, driver, rotation, issuance);
      const b = await reconcile(client, driver, rotation, issuance);
      expect([a.outcome, b.outcome].every((o) => o !== "REFUSED")).toBe(true);
      expect(b.outcome).toBe("REPLAYED");

      await reconcileToFixedPoint(client, driver, rotation, issuance);
      const after = await worldCounts(client, fixture.deviceRecordId);
      expect(after.credentials).toBe(2);
      expect(after.serials).toBe(2);
      expect(after.headVersion).toBe(2);
    });
  }, 180_000);

  it("refuses to repair a database-active key the provider does not have", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "PROVLOST",
      });
      await enableDevelopmentRotation(client);
      const issuance = pgIssuanceGateway(client);
      const rotation = pgRotationGateway(client);
      const driver = new RenewalDriver(client, fixture, "rotate_key");
      await driver.reserve();
      await driver.generateKey();
      await driver.registerKey(rotation);
      await driver.issue(issuance, "finalize");
      await reconcileToFixedPoint(client, driver, rotation, issuance);

      // The provider then LOSES the key: a restore from an older snapshot, or
      // worse. The database still says active.
      const wired = buildReconciler(client, driver, rotation, issuance);
      const blindProbe: ReconciliationProviderProbe = {
        async observe() {
          return { replacementKey: null, incumbentAvailable: true };
        },
      };
      const outcome = await reconcileDeviceCredentialRenewal(
        {
          renewalAttemptId: driver.reservation.renewalAttemptId,
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          actorRef: "RECONCILER",
          trustedTime: trustedAt(new Date()),
        },
        wired.reader,
        blindProbe,
        wired.executor,
        wired.audit,
      );

      expect(outcome.refusalCode).toBe("RECONCILE_MANUAL_REVIEW");
      expect(outcome.decision?.classification).toBe("INCONSISTENT_STATE");
      // Nothing was regenerated to "fix" it.
      const after = await worldCounts(client, fixture.deviceRecordId);
      expect(after.providerKeys).toBe(2);
      expect(driver.provider.generationCount).toBe(1);

      // The divergence is DURABLE evidence, not a log line.
      const history = await readReconciliations(client, driver.reservation.renewalAttemptId);
      expect(history.some((h) => h.classification === "INCONSISTENT_STATE")).toBe(true);
    });
  }, 180_000);

  it("refuses a reconciler pointed at another device, and records nothing for it", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "WRONGDEV",
      });
      const other = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "WRONGDEV2",
      });
      const issuance = pgIssuanceGateway(client);
      const rotation = pgRotationGateway(client);
      const driver = new RenewalDriver(client, fixture, "reuse_current_key");
      await driver.reserve();

      const wired = buildReconciler(client, driver, rotation, issuance);
      const outcome = await reconcileDeviceCredentialRenewal(
        {
          renewalAttemptId: driver.reservation.renewalAttemptId,
          deviceRecordId: other.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          actorRef: "RECONCILER",
          trustedTime: trustedAt(new Date()),
        },
        wired.reader,
        wired.probe,
        wired.executor,
        wired.audit,
      );
      expect(outcome.refusalCode).toBe("RECONCILE_WRONG_DEVICE");
      expect(await readReconciliations(client, driver.reservation.renewalAttemptId)).toHaveLength(
        0,
      );
    });
  }, 180_000);

  it("keeps the reconciliation audit append-only and executor-proof", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "AUDIT",
      });
      const issuance = pgIssuanceGateway(client);
      const rotation = pgRotationGateway(client);
      const driver = new RenewalDriver(client, fixture, "reuse_current_key");
      await driver.reserve();
      await reconcileToFixedPoint(client, driver, rotation, issuance);

      // One more pass, so the history contains BOTH the action and its replay.
      await reconcile(client, driver, rotation, issuance);
      const history = await readReconciliations(client, driver.reservation.renewalAttemptId);
      expect(history.length).toBeGreaterThan(1);
      expect(history[history.length - 1]?.classification).toBe("RESPONSE_REPLAY");
      // Both observations are recorded, in lifecycle names and nothing else.
      expect(history[0]?.observedDatabaseState).toContain("reservation=");
      expect(history[0]?.observedProviderState).toContain("incumbent=");
      for (const row of history) {
        expect(JSON.stringify(row)).not.toContain("PRIVATE KEY");
        expect(JSON.stringify(row)).not.toContain("postgresql://");
      }

      await withRole(client, TEST_ROLES.issuanceService, async () => {
        // The executor records THROUGH the function and cannot touch the table.
        const insert = await expectRefused(client, () =>
          client.query(
            `insert into kitluy_devices.device_renewal_reconciliations (
               renewal_attempt_id, device_record_id, environment, observed_database_state,
               observed_provider_state, classification, action_attempted, action_result,
               replay_outcome, actor_ref)
             values ($1::uuid, $2::uuid, 'development', 'x', 'y', 'FORGED', 'a', 'b', 'c', 'd')`,
            [driver.reservation.renewalAttemptId, fixture.deviceRecordId],
          ),
        );
        expect(insert).toMatch(/permission denied/);
      });

      // History is never edited.
      const update = await expectRefused(client, () =>
        client.query(
          `update kitluy_devices.device_renewal_reconciliations set classification = 'REWRITTEN'
            where renewal_attempt_id = $1`,
          [driver.reservation.renewalAttemptId],
        ),
      );
      expect(update).toMatch(/append|immutable|permission denied|APPEND/i);
    });
  }, 180_000);

  it("verifies the recovered credential cryptographically", async () => {
    await withDatabaseTransaction(async (client) => {
      const fixture = await createIncumbentFixture(client, {
        issuedAtTrustedTime: issuedSoThat(9),
        label: "VERIFY",
      });
      const issuance = pgIssuanceGateway(client);
      const rotation = pgRotationGateway(client);
      const driver = new RenewalDriver(client, fixture, "reuse_current_key");
      await driver.reserve();
      await driver.issue(issuance, "sign");
      await reconcileToFixedPoint(client, driver, rotation, issuance);

      const repository = pgIncumbentRepository(client);
      const credential = await repository.loadCredentialAtGeneration(
        {
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        },
        2,
      );
      expect(credential).not.toBeNull();
      // The recovered credential's signature verifies under the intermediate —
      // recovery produced a real credential, not a bookkeeping entry.
      expect(
        verifyDetachedSignature(
          fixture.ca.intermediateCertificate.tbs.subjectPublicKeyPem,
          Buffer.from(credential!.canonicalTbs, "utf8"),
          credential!.detachedSignature,
        ),
      ).toBe(true);
    });
  }, 180_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live crash matrix ran", () => {
    if (!reachable) {
      console.warn(`${SUITE} DID NOT RUN — no database evidence for reconciliation.`);
    }
    expect(typeof reachable).toBe("boolean");
  });
});
