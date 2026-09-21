/**
 * WS-12-T001 — T1 bootstrap acceptance, revised for the P02 Hub contract.
 *
 * The original fourteen §7 scenarios plus the P02 §8 machine-level
 * families: Hub authority time drives every validity judgement, the
 * configuration path verifies the Hub's DELIVERY attestation, and step 9
 * requires the registered `pos.t1.use` permission.
 *
 * Discipline unchanged: REAL Ed25519 keys, the REAL device-identity
 * verifiers and the REAL encrypted terminal-local store; only transports
 * are port fakes (the live-socket loop is the e2e integration suite).
 * Zero skips.
 */
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  EDGE_DISCOVERY_KIND,
  EDGE_LAN_PORT,
  PAIRING_PROTOCOL_VERSION,
  edgeDiscoveryRecordBytes,
  pairingReceiptBytes,
  publicKeyFingerprint,
  terminalConfigurationDeliveryBytes,
  type DeviceRecordId,
  type EdgeDiscoveryRecord,
  type PairingReceipt,
  type ReceiptExpectation,
  type TerminalConfigurationDelivery,
  type TrustEnvironment,
} from "@kitluy/device-identity";
import {
  ConfigurationSnapshotStore,
  PairingReceiptStore,
  assertNoForbiddenMaterial,
  createSqliteDriver,
  inMemorySecureKeyStore,
} from "@kitluy/terminal-local-store";

import { bootstrapT1 } from "../src/bootstrap/machine.js";
import type { AuthorityTimeResponse } from "../src/bootstrap/hub-time.js";
import type {
  ConfigurationDeliveryWire,
  EdgeOperationsSession,
  EdgeReadRefusal,
  EndpointResolution,
  ProtectedTerminalIdentity,
  RuntimeEligibilityWire,
  SignedDiscoveryWirePayload,
  SignedTerminalConfiguration,
  StaffSessionCandidate,
  T1BootstrapPorts,
} from "../src/bootstrap/ports.js";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => Parameters<typeof createSqliteDriver>[0];
};

const ENV: TrustEnvironment = "development";
const T1 = "laundry.t1.intake_cashier";
const NOW = new Date("2026-08-06T10:00:00.000Z");
const APP_VERSION = "0.1.0";
const keys = new DevelopmentDeviceKeyProvider();

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

interface CapturedLog {
  readonly event: string;
  readonly fields: Record<string, string | number | boolean>;
}

function refusal(result: string, retryable = false): EdgeReadRefusal {
  return { outcome: "refused", result, retryable, detail: `refused: ${result}` };
}

interface Harness {
  readonly ports: T1BootstrapPorts;
  readonly identity: ProtectedTerminalIdentity;
  readonly receipt: PairingReceipt;
  readonly hubReceiptSignatureBase64: string;
  readonly hubPem: string;
  readonly logs: CapturedLog[];
  readonly stores: {
    readonly receipts: PairingReceiptStore;
    readonly configuration: ConfigurationSnapshotStore;
  };
  readonly makeDelivery: (over?: Partial<SignedTerminalConfiguration>) => ConfigurationDeliveryWire;
  readonly eligibilityWire: (over?: Partial<RuntimeEligibilityWire>) => RuntimeEligibilityWire;
  readonly staff: (over?: Partial<StaffSessionCandidate>) => StaffSessionCandidate;
  readonly discoveryPayload: (over?: Partial<EdgeDiscoveryRecord>) => SignedDiscoveryWirePayload;
  readonly overrides: {
    resolve?: () => Promise<EndpointResolution>;
    establish?: T1BootstrapPorts["edgeSession"]["establish"];
    authorityTime?: () => Promise<AuthorityTimeResponse | EdgeReadRefusal>;
    eligibility?: () => Promise<
      { outcome: "eligible"; eligibility: RuntimeEligibilityWire } | EdgeReadRefusal
    >;
    configuration?: () => Promise<
      { outcome: "delivery"; wire: ConfigurationDeliveryWire } | EdgeReadRefusal
    >;
    staffAcquire?: () => Promise<StaffSessionCandidate | null>;
  };
  readonly monotonic: { value: number };
  readonly close: () => void;
}

function makeHarness(
  options: {
    readonly file?: string;
    readonly persistReceipt?: boolean;
    readonly profile?: string;
  } = {},
): Harness {
  const database = new DatabaseSync(options.file ?? ":memory:");
  const driver = createSqliteDriver(database);
  const keyStore = inMemorySecureKeyStore(Buffer.from("t1-acceptance-seed"));
  const receipts = new PairingReceiptStore(driver, keyStore);
  const configuration = new ConfigurationSnapshotStore(driver, keyStore);

  const hubRef = `hub-${randomUUID().slice(0, 8)}` as DeviceRecordId;
  void keys.generateDeviceKey(hubRef, ENV);
  const hubPem = keys.publicKeyPem(hubRef) ?? "";
  const terminalRef = `terminal-${randomUUID().slice(0, 8)}` as DeviceRecordId;
  void keys.generateDeviceKey(terminalRef, ENV);
  const terminalPem = keys.publicKeyPem(terminalRef) ?? "";

  const scope = {
    hubDeviceId: randomUUID(),
    terminalDeviceId: randomUUID(),
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
  };

  const receipt: PairingReceipt = {
    receiptId: randomUUID(),
    receiptVersion: PAIRING_PROTOCOL_VERSION,
    pairingSessionId: randomUUID(),
    transcriptHash: randomUUID().replace(/-/g, "").padEnd(64, "0"),
    hubDeviceId: scope.hubDeviceId,
    hubCertificateFingerprint: publicKeyFingerprint(hubPem),
    terminalDeviceId: scope.terminalDeviceId,
    terminalCertificateFingerprint: publicKeyFingerprint(terminalPem),
    tenantId: scope.tenantId,
    digitalStoreId: scope.digitalStoreId,
    storeLocationId: scope.storeLocationId,
    environment: ENV,
    terminalAssignmentGeneration: 1,
    terminalProfileKey: options.profile ?? T1,
    pairedAt: new Date("2026-08-05T10:00:00.000Z"),
    validUntil: null,
    correlationId: randomUUID(),
  };
  const hubReceiptSignatureBase64 = Buffer.from(
    keys.provePossession(hubRef, pairingReceiptBytes(receipt)),
  ).toString("base64");

  const expectation: ReceiptExpectation = {
    pairingSessionId: receipt.pairingSessionId,
    transcriptHash: receipt.transcriptHash,
    hubDeviceId: receipt.hubDeviceId,
    hubCertificateFingerprint: receipt.hubCertificateFingerprint,
    terminalDeviceId: receipt.terminalDeviceId,
    terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
    tenantId: receipt.tenantId,
    digitalStoreId: receipt.digitalStoreId,
    storeLocationId: receipt.storeLocationId,
    environment: receipt.environment,
    terminalAssignmentGeneration: receipt.terminalAssignmentGeneration,
    terminalProfileKey: receipt.terminalProfileKey,
  };
  const installationContext = { terminalAssignmentId: randomUUID(), activationId: randomUUID() };

  if (options.persistReceipt !== false) {
    receipts.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64,
      hubPublicKeyPem: hubPem,
      expectation,
      context: installationContext,
      at: NOW,
    });
  }

  const identity: ProtectedTerminalIdentity = {
    terminalDeviceId: scope.terminalDeviceId,
    terminalCertificateSerial: "01ab",
    terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
    environment: ENV,
    hubOperationalPublicKeyPem: hubPem,
    receiptExpectation: expectation,
    discoveryExpectation: {
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      environment: ENV,
    },
    hubEndpointHint: { hostname: "hub.store.lan", port: EDGE_LAN_PORT },
  };

  const discoveryPayload = (
    over: Partial<EdgeDiscoveryRecord> = {},
  ): SignedDiscoveryWirePayload => {
    const record: EdgeDiscoveryRecord = {
      protocolVersion: EDGE_DISCOVERY_KIND,
      recordId: randomUUID(),
      hubDeviceId: scope.hubDeviceId,
      hubCertificateFingerprint: receipt.hubCertificateFingerprint,
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      environment: ENV,
      hostname: "hub.store.lan",
      port: EDGE_LAN_PORT,
      issuedAt: new Date(NOW.getTime() - 10_000),
      expiresAt: new Date(NOW.getTime() + 80_000),
      ...over,
    };
    const signature = Buffer.from(
      keys.provePossession(hubRef, edgeDiscoveryRecordBytes(record)),
    ).toString("base64url");
    return {
      record: {
        ...record,
        issuedAt: record.issuedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      },
      signature,
      signatureAlgorithm: "ed25519",
    };
  };

  const makeDelivery = (
    over: Partial<SignedTerminalConfiguration> = {},
  ): ConfigurationDeliveryWire => {
    const payloadJson = JSON.stringify({ pricing: { currency: "KHR" } });
    const base: Omit<SignedTerminalConfiguration, "deliverySignature"> = {
      snapshotId: randomUUID(),
      configurationVersion: 7,
      schemaVersion: 1,
      environment: ENV,
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      hubDeviceId: scope.hubDeviceId,
      deviceRecordId: scope.terminalDeviceId,
      assignmentGeneration: 1,
      terminalProfileCode: T1,
      primaryVertical: "laundry",
      minimumApplicationVersion: "0.1.0",
      maximumApplicationVersion: null,
      issuedAt: new Date(NOW.getTime() - 7_200_000).toISOString(),
      effectiveAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      validUntil: new Date(NOW.getTime() + 86_400_000).toISOString(),
      manifestSha256: "1".repeat(64),
      payloadSha256: sha256Hex(payloadJson),
      payloadJson,
      signerKeyId: "demo-signing-key-1",
      correlationId: randomUUID(),
      ...over,
    };
    const deliveryFields: TerminalConfigurationDelivery = {
      snapshotId: base.snapshotId,
      configurationVersion: base.configurationVersion,
      schemaVersion: base.schemaVersion,
      tenantId: base.tenantId,
      digitalStoreId: base.digitalStoreId,
      storeLocationId: base.storeLocationId,
      environment: base.environment as TrustEnvironment,
      hubDeviceId: base.hubDeviceId,
      terminalDeviceId: base.deviceRecordId,
      assignmentGeneration: base.assignmentGeneration,
      terminalProfileCode: base.terminalProfileCode,
      primaryVertical: base.primaryVertical,
      minimumApplicationVersion: base.minimumApplicationVersion,
      maximumApplicationVersion: base.maximumApplicationVersion,
      issuedAt: new Date(base.issuedAt),
      effectiveAt: new Date(base.effectiveAt),
      validUntil: new Date(base.validUntil),
      manifestSha256: base.manifestSha256,
      payloadSha256: base.payloadSha256,
      signingKeyId: base.signerKeyId,
      correlationId: base.correlationId,
    };
    const deliverySignature =
      over.deliverySignature ??
      Buffer.from(
        keys.provePossession(hubRef, terminalConfigurationDeliveryBytes(deliveryFields)),
      ).toString("base64url");
    return {
      delivery: {
        snapshotId: deliveryFields.snapshotId,
        configurationVersion: deliveryFields.configurationVersion,
        schemaVersion: deliveryFields.schemaVersion,
        tenantId: deliveryFields.tenantId,
        digitalStoreId: deliveryFields.digitalStoreId,
        storeLocationId: deliveryFields.storeLocationId,
        environment: deliveryFields.environment,
        hubDeviceId: deliveryFields.hubDeviceId,
        terminalDeviceId: deliveryFields.terminalDeviceId,
        assignmentGeneration: deliveryFields.assignmentGeneration,
        terminalProfileCode: deliveryFields.terminalProfileCode,
        primaryVertical: deliveryFields.primaryVertical,
        minimumApplicationVersion: deliveryFields.minimumApplicationVersion,
        maximumApplicationVersion: deliveryFields.maximumApplicationVersion,
        issuedAt: deliveryFields.issuedAt.toISOString(),
        effectiveAt: deliveryFields.effectiveAt.toISOString(),
        validUntil: deliveryFields.validUntil.toISOString(),
        manifestSha256: deliveryFields.manifestSha256,
        payloadSha256: deliveryFields.payloadSha256,
        signingKeyId: deliveryFields.signingKeyId,
        correlationId: deliveryFields.correlationId,
      },
      payloadJson: base.payloadJson,
      deliverySignature,
      rollbackReference: null,
    };
  };

  const eligibilityWire = (over: Partial<RuntimeEligibilityWire> = {}): RuntimeEligibilityWire => ({
    protocolVersion: "1.0",
    tenantId: scope.tenantId,
    digitalStoreId: scope.digitalStoreId,
    storeLocationId: scope.storeLocationId,
    environment: ENV,
    hubDeviceId: scope.hubDeviceId,
    terminalDeviceId: scope.terminalDeviceId,
    assignmentId: installationContext.terminalAssignmentId,
    assignmentGeneration: 1,
    terminalProfileCode: receipt.terminalProfileKey,
    primaryVertical: "laundry",
    credentialId: randomUUID(),
    credentialGeneration: 1,
    credentialEligibility: "eligible",
    activationEligibility: "activated",
    pairingEligibility: "paired",
    pairedAt: receipt.pairedAt.toISOString(),
    containmentState: "none",
    hubReplacementState: "normal",
    requiredConfigurationVersion: 7,
    authorityTime: NOW.toISOString(),
    ...over,
  });

  const staff = (over: Partial<StaffSessionCandidate> = {}): StaffSessionCandidate => ({
    actorId: randomUUID(),
    displayName: "Sokha",
    profileCodes: [T1],
    effectivePermissions: ["staff.sessions.open", "pos.t1.use"],
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    ...over,
  });

  const logs: CapturedLog[] = [];
  const overrides: Harness["overrides"] = {};
  const monotonic = { value: 5_000 };

  const authorityResponse = (): AuthorityTimeResponse => ({
    protocolVersion: "1.0",
    authorityTime: NOW.toISOString(),
    authoritySource: "hub_database",
    responseId: randomUUID(),
    generatedAt: NOW.toISOString(),
    maxCacheAgeSeconds: 30,
    correlationId: randomUUID(),
  });

  const session: EdgeOperationsSession = {
    fetchAuthorityTime: () =>
      overrides.authorityTime !== undefined
        ? overrides.authorityTime()
        : Promise.resolve(authorityResponse()),
    fetchEligibility: () =>
      overrides.eligibility !== undefined
        ? overrides.eligibility()
        : Promise.resolve({ outcome: "eligible" as const, eligibility: eligibilityWire() }),
    fetchConfigurationDelivery: () =>
      overrides.configuration !== undefined
        ? overrides.configuration()
        : Promise.resolve({ outcome: "delivery" as const, wire: makeDelivery() }),
    openStaffSession: () => Promise.resolve(refusal("SESSION_PERMISSION_DENIED")),
    refreshStaffSession: () => Promise.resolve(refusal("SESSION_UNKNOWN")),
    closeStaffSession: () => Promise.resolve(refusal("SESSION_UNKNOWN")),
  };

  const ports: T1BootstrapPorts = {
    identity: { load: () => identity },
    receipts,
    hubEndpoint: {
      resolve: () =>
        overrides.resolve !== undefined
          ? overrides.resolve()
          : Promise.resolve({
              outcome: "reached" as const,
              source: "assigned_hostname" as const,
              hostname: "hub.store.lan",
              port: EDGE_LAN_PORT,
              payload: discoveryPayload(),
            }),
    },
    edgeSession: {
      establish: (endpoint, terminalIdentity) =>
        overrides.establish !== undefined
          ? overrides.establish(endpoint, terminalIdentity)
          : Promise.resolve({ outcome: "established" as const, session }),
    },
    configurationCache: {
      loadCurrent: () => configuration.loadCurrent(),
      persistValidated: (record) => {
        configuration.persistValidated(record);
      },
    },
    staffSession: {
      acquire: () =>
        overrides.staffAcquire !== undefined ? overrides.staffAcquire() : Promise.resolve(staff()),
    },
    logger: {
      log: (event, fields) => {
        logs.push({ event, fields });
      },
    },
    monotonicNow: () => monotonic.value,
  };

  return {
    ports,
    identity,
    receipt,
    hubReceiptSignatureBase64,
    hubPem,
    logs,
    stores: { receipts, configuration },
    makeDelivery,
    eligibilityWire,
    staff,
    discoveryPayload,
    overrides,
    monotonic,
    close: () => driver.close(),
  };
}

function run(h: Harness) {
  return bootstrapT1(h.ports, { applicationVersion: APP_VERSION });
}

describe("WS-12-T001 T1 bootstrap acceptance (P02 contract)", () => {
  it("1. first successful T1 startup walks the sequence in order and enters the shell", async () => {
    const h = makeHarness();
    const report = await run(h);
    expect(report.state).toBe("ready");
    expect(report.transitions).toEqual([
      "starting",
      "connecting_to_hub",
      "configuration_loading",
      "ready",
    ]);
    expect(report.hub).toEqual({
      hubDeviceId: h.receipt.hubDeviceId,
      hostname: "hub.store.lan",
      port: 7443,
    });
    expect(report.configuration?.freshness).toBe("current");
    expect(report.staff?.displayName).toBe("Sokha");
    expect(h.stores.configuration.loadCurrent()?.snapshot.configurationVersion).toBe(7);
    // Without an acquired staff session the same startup parks fail-closed.
    const h2 = makeHarness();
    h2.overrides.staffAcquire = () => Promise.resolve(null);
    const parked = await run(h2);
    expect(parked.state).toBe("staff_authentication_required");
    expect(parked.configuration?.freshness).toBe("current");
    h.close();
    h2.close();
  });

  it("2. startup has no cloud dependency — the port surface is Hub-only", async () => {
    const h = makeHarness();
    expect((await run(h)).state).toBe("ready");
    expect(Object.keys(h.ports).sort()).toEqual(
      [
        "identity",
        "receipts",
        "hubEndpoint",
        "edgeSession",
        "configurationCache",
        "staffSession",
        "logger",
        "monotonicNow",
      ].sort(),
    );
    h.close();
  });

  it("3. the signed discovery record is verified under HUB time and pins the endpoint", async () => {
    const h = makeHarness();
    expect((await run(h)).state).toBe("ready");
    const tampered = h.discoveryPayload();
    h.overrides.resolve = () =>
      Promise.resolve({
        outcome: "reached",
        source: "assigned_hostname",
        hostname: "hub.store.lan",
        port: 7443,
        payload: { ...tampered, record: { ...tampered.record, hostname: "attacker.lan" } },
      });
    const refused = await run(h);
    expect(refused.state).toBe("hub_unavailable");
    expect(refused.refusalCode).toBe("DISCOVERY_SIGNATURE_INVALID");
    h.close();
  });

  it("4. a record naming the wrong Hub is refused", async () => {
    const h = makeHarness();
    h.overrides.resolve = () =>
      Promise.resolve({
        outcome: "reached",
        source: "assigned_hostname",
        hostname: "hub.store.lan",
        port: 7443,
        payload: h.discoveryPayload({ hubDeviceId: randomUUID() }),
      });
    const report = await run(h);
    expect(report.state).toBe("assignment_invalid");
    expect(report.refusalCode).toBe("DISCOVERY_WRONG_HUB");
    h.close();
  });

  it("5. a revoked or expired terminal credential is refused at transport and at eligibility", async () => {
    const h = makeHarness();
    h.overrides.establish = () =>
      Promise.resolve({
        outcome: "refused",
        code: "CREDENTIAL_NOT_CURRENT",
        detail: "credential revoked, expired or superseded",
      });
    const atTransport = await run(h);
    expect(atTransport.state).toBe("credential_invalid");
    const h2 = makeHarness();
    h2.overrides.eligibility = () => Promise.resolve(refusal("CREDENTIAL_NOT_CURRENT"));
    const atRoute = await run(h2);
    expect(atRoute.state).toBe("credential_invalid");
    expect(atRoute.refusalCode).toBe("CREDENTIAL_NOT_CURRENT");
    h.close();
    h2.close();
  });

  it("6. a stale assignment generation is refused — route-level and receipt-level", async () => {
    const h = makeHarness();
    h.overrides.eligibility = () => Promise.resolve(refusal("ASSIGNMENT_GENERATION_STALE"));
    const atRoute = await run(h);
    expect(atRoute.state).toBe("assignment_invalid");
    const h2 = makeHarness();
    h2.overrides.eligibility = () =>
      Promise.resolve({
        outcome: "eligible",
        eligibility: h2.eligibilityWire({ assignmentGeneration: 2 }),
      });
    const atReceipt = await run(h2);
    expect(atReceipt.state).toBe("assignment_invalid");
    expect(atReceipt.refusalCode).toBe("PAIR_ASSIGNMENT_MISMATCH");
    h.close();
    h2.close();
  });

  it("7. a non-T1 profile is refused, including retired identifiers", async () => {
    const h = makeHarness({ profile: "laundry.t2.customer_display" });
    const report = await run(h);
    expect(report.state).toBe("profile_not_authorized");
    const h2 = makeHarness({ profile: "t2_scan_in" });
    expect((await run(h2)).state).toBe("profile_not_authorized");
    h.close();
    h2.close();
  });

  it("8. an incompatible configuration is refused: schema, application version, altered payload, altered signature", async () => {
    const h = makeHarness();
    h.overrides.configuration = () =>
      Promise.resolve({ outcome: "delivery", wire: h.makeDelivery({ schemaVersion: 2 }) });
    expect((await run(h)).refusalCode).toBe("CONFIG_SCHEMA_UNSUPPORTED");
    h.overrides.configuration = () =>
      Promise.resolve({
        outcome: "delivery",
        wire: h.makeDelivery({ minimumApplicationVersion: "9.9.9" }),
      });
    expect((await run(h)).refusalCode).toBe("CONFIG_APP_VERSION_INCOMPATIBLE");
    h.overrides.configuration = () => {
      const wire = h.makeDelivery();
      return Promise.resolve({
        outcome: "delivery",
        wire: { ...wire, payloadJson: JSON.stringify({ pricing: { currency: "USD" } }) },
      });
    };
    const alteredPayload = await run(h);
    expect(alteredPayload.state).toBe("configuration_incompatible");
    // The checksum gate catches an altered payload BEFORE signature
    // verification (declared digest no longer matches the payload).
    expect(alteredPayload.refusalCode).toBe("CONFIG_CHECKSUM_MISMATCH");
    h.overrides.configuration = () =>
      Promise.resolve({
        outcome: "delivery",
        wire: h.makeDelivery({
          deliverySignature: Buffer.from("forged-signature-material").toString("base64url"),
        }),
      });
    const alteredSignature = await run(h);
    expect(alteredSignature.state).toBe("configuration_incompatible");
    expect(alteredSignature.refusalCode).toBe("CONFIG_SIGNATURE_INVALID");
    h.close();
  });

  it("9. a valid cached configuration yields offline_ready with the explicit label; a LOWER delivery cannot replace it", async () => {
    const h = makeHarness();
    expect((await run(h)).state).toBe("ready");
    h.overrides.configuration = () => Promise.resolve(refusal("CONFIGURATION_MISSING", true));
    const cachedRun = await run(h);
    expect(cachedRun.state).toBe("offline_ready");
    expect(cachedRun.configuration?.freshness).toBe("cached_offline");
    // A lower-version delivery is refused as rollback and never replaces
    // the cache.
    h.overrides.configuration = () =>
      Promise.resolve({
        outcome: "delivery",
        wire: h.makeDelivery({ configurationVersion: 3 }),
      });
    const rollback = await run(h);
    expect(rollback.state).toBe("configuration_incompatible");
    expect(rollback.refusalCode).toBe("CONFIG_VERSION_ROLLBACK");
    expect(h.stores.configuration.loadCurrent()?.snapshot.configurationVersion).toBe(7);
    h.close();
  });

  it("10. a missing or corrupt pairing receipt fails closed", async () => {
    const missing = makeHarness({ persistReceipt: false });
    const noReceipt = await run(missing);
    expect(noReceipt.state).toBe("recovery_required");
    expect(noReceipt.refusalCode).toBe("RECEIPT_MISSING");
    missing.close();
    const dir = mkdtempSync(join(tmpdir(), "kitluy-t1-corrupt-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const first = makeHarness({ file });
    expect((await run(first)).state).toBe("ready");
    first.close();
    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const wrongKey = inMemorySecureKeyStore(Buffer.from("a-different-seed"));
    const corruptStore = new PairingReceiptStore(driver, wrongKey);
    const h = makeHarness();
    (h.ports as { receipts: unknown }).receipts = corruptStore;
    const corrupt = await run(h);
    expect(corrupt.state).toBe("recovery_required");
    expect(corrupt.refusalCode).toBe("KLUY-TERMINAL-STORE-CORRUPT");
    driver.close();
    h.close();
  });

  it("11. staff without T1 authorization is denied — profile, permission and expiry each fail closed", async () => {
    const h = makeHarness();
    h.overrides.staffAcquire = () =>
      Promise.resolve(h.staff({ profileCodes: ["laundry.t3.ready_scan_in"] }));
    expect((await run(h)).refusalCode).toBe("STAFF_PROFILE_NOT_AUTHORIZED");
    // Session membership alone never authorizes T1: pos.t1.use is REQUIRED.
    h.overrides.staffAcquire = () =>
      Promise.resolve(h.staff({ effectivePermissions: ["staff.sessions.open"] }));
    const noPermission = await run(h);
    expect(noPermission.state).toBe("staff_authentication_required");
    expect(noPermission.refusalCode).toBe("STAFF_T1_PERMISSION_MISSING");
    h.overrides.staffAcquire = () =>
      Promise.resolve(h.staff({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }));
    expect((await run(h)).refusalCode).toBe("STAFF_SESSION_EXPIRED");
    h.close();
  });

  it("12. a process restart restores only valid durable state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-t1-restart-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const first = makeHarness({ file });
    expect((await run(first)).state).toBe("ready");
    first.close();
    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const sameKey = inMemorySecureKeyStore(Buffer.from("t1-acceptance-seed"));
    const receipts2 = new PairingReceiptStore(driver, sameKey);
    const configuration2 = new ConfigurationSnapshotStore(driver, sameKey);
    const resumedPorts: T1BootstrapPorts = {
      ...first.ports,
      receipts: receipts2,
      configurationCache: {
        loadCurrent: () => configuration2.loadCurrent(),
        persistValidated: (record) => {
          configuration2.persistValidated(record);
        },
      },
      staffSession: { acquire: () => Promise.resolve(null) },
    };
    first.overrides.configuration = () => Promise.resolve(refusal("CONFIGURATION_MISSING", true));
    const resumed = await bootstrapT1(resumedPorts, { applicationVersion: APP_VERSION });
    expect(resumed.state).toBe("staff_authentication_required");
    expect(resumed.configuration?.freshness).toBe("cached_offline");
    driver.close();
  });

  it("expired authority-time anchor fails closed and is REACQUIRED, never wall-clocked", async () => {
    const h = makeHarness();
    let calls = 0;
    h.overrides.authorityTime = () => {
      calls += 1;
      return Promise.resolve({
        protocolVersion: "1.0",
        authorityTime: NOW.toISOString(),
        authoritySource: "hub_database",
        responseId: `r-${calls}`,
        generatedAt: NOW.toISOString(),
        maxCacheAgeSeconds: 30,
        correlationId: `c-${calls}`,
      });
    };
    // Advance the monotonic clock past the 30 s cache age between steps by
    // wrapping eligibility to burn the anchor.
    h.overrides.eligibility = () => {
      h.monotonic.value += 31_000;
      return Promise.resolve({ outcome: "eligible", eligibility: h.eligibilityWire() });
    };
    const report = await run(h);
    expect(report.state).toBe("ready");
    expect(calls).toBeGreaterThanOrEqual(2);
    // And a Hub that stops serving time mid-flight is a named failure.
    const h2 = makeHarness();
    let first = true;
    h2.overrides.authorityTime = () => {
      if (first) {
        first = false;
        return Promise.resolve({
          protocolVersion: "1.0",
          authorityTime: NOW.toISOString(),
          authoritySource: "hub_database",
          responseId: "r-1",
          generatedAt: NOW.toISOString(),
          maxCacheAgeSeconds: 30,
          correlationId: "c-1",
        });
      }
      return Promise.reject(new Error("hub gone"));
    };
    h2.overrides.eligibility = () => {
      h2.monotonic.value += 31_000;
      return Promise.resolve({ outcome: "eligible", eligibility: h2.eligibilityWire() });
    };
    const lost = await bootstrapT1(h2.ports, { applicationVersion: APP_VERSION });
    expect(lost.state).toBe("hub_unavailable");
    h.close();
    h2.close();
  });

  it("a malformed authority-time response has no wall-clock fallback", async () => {
    const h = makeHarness();
    h.overrides.authorityTime = () =>
      Promise.resolve({
        outcome: "refused",
        result: "HTTP_500",
        retryable: true,
        detail: "broken",
      } as EdgeReadRefusal);
    const report = await run(h);
    expect(report.state).toBe("recovery_required");
    const h2 = makeHarness();
    h2.overrides.authorityTime = () =>
      Promise.resolve(
        // authoritySource wrong → parse refuses → named failure, no fallback
        {
          protocolVersion: "1.0",
          authorityTime: NOW.toISOString(),
          authoritySource: "wall_clock",
          responseId: "r",
          generatedAt: NOW.toISOString(),
          maxCacheAgeSeconds: 30,
          correlationId: "c",
        } as unknown as AuthorityTimeResponse,
      );
    const malformed = await run(h2);
    expect(malformed.state).toBe("hub_unavailable");
    expect(malformed.refusalCode).toBe("AUTHORITY_TIME_MALFORMED");
    h.close();
    h2.close();
  });

  it("containment and hub-replacement refusals land in named states", async () => {
    const h = makeHarness();
    h.overrides.eligibility = () => Promise.resolve(refusal("CONTAINMENT_PROHIBITS"));
    expect((await run(h)).state).toBe("assignment_invalid");
    h.overrides.eligibility = () => Promise.resolve(refusal("HUB_REPLACEMENT_BLOCKED", true));
    expect((await run(h)).state).toBe("hub_unavailable");
    h.overrides.eligibility = () => Promise.resolve(refusal("HUB_RETIRED"));
    expect((await run(h)).state).toBe("assignment_invalid");
    h.close();
  });

  it("stale configuration: an expired cached snapshot cannot begin operations", async () => {
    const h = makeHarness();
    const expired = h.makeDelivery({
      issuedAt: new Date(NOW.getTime() - 10_800_000).toISOString(),
      effectiveAt: new Date(NOW.getTime() - 7_200_000).toISOString(),
      validUntil: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });
    h.stores.configuration.persistValidated({
      snapshot: {
        snapshotId: expired.delivery.snapshotId,
        configurationVersion: expired.delivery.configurationVersion,
        schemaVersion: expired.delivery.schemaVersion,
        environment: expired.delivery.environment,
        tenantId: expired.delivery.tenantId,
        digitalStoreId: expired.delivery.digitalStoreId,
        storeLocationId: expired.delivery.storeLocationId,
        hubDeviceId: expired.delivery.hubDeviceId,
        deviceRecordId: expired.delivery.terminalDeviceId,
        assignmentGeneration: expired.delivery.assignmentGeneration,
        terminalProfileCode: expired.delivery.terminalProfileCode,
        primaryVertical: expired.delivery.primaryVertical,
        minimumApplicationVersion: expired.delivery.minimumApplicationVersion,
        maximumApplicationVersion: expired.delivery.maximumApplicationVersion,
        issuedAt: expired.delivery.issuedAt,
        effectiveAt: expired.delivery.effectiveAt,
        validUntil: expired.delivery.validUntil,
        manifestSha256: expired.delivery.manifestSha256,
        payloadSha256: expired.delivery.payloadSha256,
        payloadJson: expired.payloadJson,
        signerKeyId: expired.delivery.signingKeyId,
        correlationId: expired.delivery.correlationId,
        deliverySignature: expired.deliverySignature,
      },
      verifiedAt: new Date(NOW.getTime() - 7_000_000).toISOString(),
    });
    h.overrides.configuration = () => Promise.resolve(refusal("CONFIGURATION_MISSING", true));
    const report = await run(h);
    expect(report.state).toBe("stale_configuration");
    expect(report.refusalCode).toBe("CONFIG_EXPIRED");
    h.close();
  });

  it("hub unavailable: an unreachable Hub means Store operations cannot begin", async () => {
    const h = makeHarness();
    h.overrides.resolve = () =>
      Promise.resolve({ outcome: "unreachable", detail: "no candidate answered" });
    const report = await run(h);
    expect(report.state).toBe("hub_unavailable");
    expect(report.refusalCode).toBe("HUB_DISCOVERY_UNREACHABLE");
    h.close();
  });

  it("13. no terminal database or cloud service credential is exposed by the runtime surface", async () => {
    const h = makeHarness();
    const report = await run(h);
    expect(() => assertNoForbiddenMaterial(report, "bootstrap report")).not.toThrow();
    expect(() => assertNoForbiddenMaterial(h.logs, "bootstrap logs")).not.toThrow();
    const serialized = JSON.stringify(report) + JSON.stringify(h.logs);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("service_role");
    h.close();
  });

  it("14. logs carry no private key, token, certificate body or receipt signature", async () => {
    const h = makeHarness();
    const report = await run(h);
    expect(report.state).toBe("ready");
    const logText = JSON.stringify(h.logs);
    const pemMarker = `${"-".repeat(5)}BEGIN`;
    expect(logText).not.toContain(pemMarker);
    const pemBody = h.hubPem.replace(/-/g, "").replace(/\s/g, "").slice(20, 60);
    expect(pemBody.length).toBeGreaterThan(0);
    expect(logText.replace(/\s/g, "")).not.toContain(pemBody);
    expect(logText).not.toContain(h.hubReceiptSignatureBase64);
    expect(logText).not.toContain(h.hubReceiptSignatureBase64.slice(0, 24));
    expect(logText).not.toMatch(/bearer/i);
    for (const line of h.logs) {
      for (const value of Object.values(line.fields)) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
      }
    }
    h.close();
  });

  it("15. a NOT-YET-VALID configuration is refused, retryable and consumes NOTHING", async () => {
    // Owner decision §1: NOT_YET_VALID remains retryable and non-consuming.
    const h = makeHarness();
    const seeded = await run(h);
    expect(seeded.state).toBe("ready"); // v7 is now the cache
    const future = h.makeDelivery({
      configurationVersion: 8,
      effectiveAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    h.overrides.configuration = () =>
      Promise.resolve({ outcome: "delivery" as const, wire: future });
    const refused = await run(h);
    expect(refused.state).toBe("configuration_incompatible");
    expect(refused.refusalCode).toBe("CONFIG_NOT_YET_VALID");
    // Nothing was consumed: the cache still carries v7 …
    expect(h.stores.configuration.loadCurrent()?.snapshot.configurationVersion).toBe(7);
    // … and version 8, retried once effective, installs cleanly — the
    // refusal burned neither the version nor the store.
    const effective = h.makeDelivery({ configurationVersion: 8 });
    h.overrides.configuration = () =>
      Promise.resolve({ outcome: "delivery" as const, wire: effective });
    const retried = await run(h);
    expect(retried.state).toBe("ready");
    expect(h.stores.configuration.loadCurrent()?.snapshot.configurationVersion).toBe(8);
    h.close();
  });

  it("16. a NOT-YET-VALID discovery record is refused retryably and consumes nothing", async () => {
    const h = makeHarness();
    h.overrides.resolve = () =>
      Promise.resolve({
        outcome: "reached" as const,
        source: "assigned_hostname" as const,
        hostname: "hub.store.lan",
        port: EDGE_LAN_PORT,
        payload: h.discoveryPayload({
          issuedAt: new Date(NOW.getTime() + 60_000),
          expiresAt: new Date(NOW.getTime() + 150_000),
        }),
      });
    const refused = await run(h);
    expect(refused.state).toBe("hub_unavailable");
    expect(refused.refusalCode).toBe("DISCOVERY_NOT_YET_VALID");
    // Non-consuming: the stored receipt is untouched and the next run, with
    // a currently-valid record, walks straight through to the shell.
    delete h.overrides.resolve;
    const retried = await run(h);
    expect(retried.state).toBe("ready");
    h.close();
  });

  it("17. eligibility freshness is judged under Hub time — stale and malformed responses refuse", async () => {
    const h = makeHarness();
    h.overrides.eligibility = () =>
      Promise.resolve({
        outcome: "eligible" as const,
        eligibility: h.eligibilityWire({
          authorityTime: new Date(NOW.getTime() - 60_000).toISOString(),
        }),
      });
    const stale = await run(h);
    expect(stale.state).toBe("hub_unavailable");
    expect(stale.refusalCode).toBe("ELIGIBILITY_STALE");
    h.overrides.eligibility = () =>
      Promise.resolve({
        outcome: "eligible" as const,
        eligibility: h.eligibilityWire({ authorityTime: "not-an-instant" }),
      });
    const malformed = await run(h);
    expect(malformed.state).toBe("hub_unavailable");
    expect(malformed.refusalCode).toBe("ELIGIBILITY_TIME_MALFORMED");
    h.close();
  });

  it("18. the configuration delivery signature never reaches a terminal log line", async () => {
    const h = makeHarness();
    const wire = h.makeDelivery();
    h.overrides.configuration = () => Promise.resolve({ outcome: "delivery" as const, wire });
    const report = await run(h);
    expect(report.state).toBe("ready");
    const serialized = JSON.stringify(h.logs);
    expect(serialized).not.toContain(wire.deliverySignature);
    expect(serialized).not.toContain(wire.deliverySignature.slice(0, 24));
    h.close();
  });

  it("19. a manual recovery IP gains no verification bypass — an altered record still refuses", async () => {
    // §3.5: a manual IP is endpoint-order position 6, nothing more. The
    // record it serves is verified with the SAME full discipline.
    const h = makeHarness();
    const genuine = h.discoveryPayload();
    const forged: typeof genuine = {
      ...genuine,
      record: { ...genuine.record, hubDeviceId: randomUUID() },
    };
    h.overrides.resolve = () =>
      Promise.resolve({
        outcome: "reached" as const,
        source: "manual_recovery_ip" as const,
        hostname: "10.99.99.9",
        port: EDGE_LAN_PORT,
        payload: forged,
      });
    const refused = await run(h);
    expect(refused.state).toBe("assignment_invalid");
    expect(refused.refusalCode).toBe("DISCOVERY_WRONG_HUB");
    h.close();
  });
});
