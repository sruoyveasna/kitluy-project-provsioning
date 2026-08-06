/**
 * WS-12-T001 — T1 runtime, device session and Store Hub bootstrap:
 * the fourteen focused acceptance scenarios from the owner package §7.
 *
 * Discipline: REAL Ed25519 keys (DevelopmentDeviceKeyProvider), the REAL
 * `@kitluy/device-identity` verifiers, and the REAL encrypted terminal-local
 * store over `node:sqlite` play their production roles; only the transports
 * (discovery fetch, mTLS session) are port fakes, because this suite proves
 * the bootstrap machine, not a socket. Zero skips.
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
  type DeviceRecordId,
  type EdgeDiscoveryRecord,
  type PairingReceipt,
  type ReceiptExpectation,
  type TrustEnvironment,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";
import {
  ConfigurationSnapshotStore,
  PairingReceiptStore,
  assertNoForbiddenMaterial,
  createSqliteDriver,
  inMemorySecureKeyStore,
  type OperationalEligibility,
} from "@kitluy/terminal-local-store";

import { bootstrapT1 } from "../src/bootstrap/machine.js";
import {
  developmentConfigurationVerifier,
  devTerminalConfigurationBytes,
} from "../src/bootstrap/dev-configuration-verifier.js";
import type {
  ConfigurationFetchResult,
  DiscoveryFetchResult,
  EdgeSessionResult,
  ProtectedTerminalIdentity,
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

interface Harness {
  readonly ports: T1BootstrapPorts;
  readonly identity: ProtectedTerminalIdentity;
  readonly receipt: PairingReceipt;
  readonly hubReceiptSignatureBase64: string;
  readonly hubPem: string;
  readonly configPem: string;
  readonly logs: CapturedLog[];
  readonly stores: {
    readonly receipts: PairingReceiptStore;
    readonly configuration: ConfigurationSnapshotStore;
  };
  readonly makeConfiguration: (
    over?: Partial<SignedTerminalConfiguration>,
  ) => SignedTerminalConfiguration;
  readonly eligibility: (over?: Partial<OperationalEligibility>) => OperationalEligibility;
  readonly staff: (over?: Partial<StaffSessionCandidate>) => StaffSessionCandidate;
  readonly discoveryPayload: (over?: Partial<EdgeDiscoveryRecord>) => SignedDiscoveryWirePayload;
  readonly overrides: {
    discovery?: () => Promise<DiscoveryFetchResult>;
    establish?: () => Promise<EdgeSessionResult>;
    eligibility?: OperationalEligibility;
    configurationFetch?: () => Promise<ConfigurationFetchResult>;
    staffRestore?: () => Promise<StaffSessionCandidate | null>;
    trustedTime?: TrustedTimeEvaluation;
  };
  readonly close: () => void;
}

function trustedTime(at: Date): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: at,
    source: "persisted_floor",
    floorAdvanced: false,
    anomalyType: null,
    detail: "test trusted time",
  };
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
  const configRef = `config-signer-${randomUUID().slice(0, 8)}` as DeviceRecordId;
  void keys.generateDeviceKey(configRef, ENV);
  const configPem = keys.publicKeyPem(configRef) ?? "";

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
      hubDeviceId: scope.hubDeviceId,
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

  const makeConfiguration = (
    over: Partial<SignedTerminalConfiguration> = {},
  ): SignedTerminalConfiguration => {
    const payloadJson = JSON.stringify({ locale: "km-KH", pricingRef: "snapshot" });
    const unsigned: Omit<SignedTerminalConfiguration, "signatureBase64"> = {
      configurationVersion: 7,
      schemaVersion: 1,
      environment: ENV,
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      deviceRecordId: scope.terminalDeviceId,
      assignmentGeneration: 1,
      issuedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      validUntil: new Date(NOW.getTime() + 86_400_000).toISOString(),
      payloadSha256: sha256Hex(payloadJson),
      payloadJson,
      signerKeyId: "dev-config-signer-1",
      ...over,
    };
    const signatureBase64 =
      over.signatureBase64 ??
      Buffer.from(
        keys.provePossession(
          configRef,
          devTerminalConfigurationBytes({ ...unsigned, signatureBase64: "" }),
        ),
      ).toString("base64");
    return { ...unsigned, signatureBase64 };
  };

  const eligibility = (over: Partial<OperationalEligibility> = {}): OperationalEligibility => ({
    hubDeviceId: scope.hubDeviceId,
    hubCertificateFingerprint: receipt.hubCertificateFingerprint,
    terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
    terminalAssignmentId: installationContext.terminalAssignmentId,
    terminalAssignmentGeneration: 1,
    terminalProfileKey: receipt.terminalProfileKey,
    terminalCredentialStatus: "active",
    hubCredentialStatus: "active",
    ...over,
  });

  const staff = (over: Partial<StaffSessionCandidate> = {}): StaffSessionCandidate => ({
    actorId: randomUUID(),
    displayName: "Sokha",
    profileCodes: [T1],
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    ...over,
  });

  const logs: CapturedLog[] = [];
  const overrides: Harness["overrides"] = {};

  const ports: T1BootstrapPorts = {
    identity: { load: () => identity },
    receipts,
    discovery: {
      fetchSignedDiscovery: () =>
        overrides.discovery !== undefined
          ? overrides.discovery()
          : Promise.resolve({ outcome: "payload", payload: discoveryPayload() }),
    },
    edgeSession: {
      establish: () =>
        overrides.establish !== undefined
          ? overrides.establish()
          : Promise.resolve({
              outcome: "established",
              session: {
                hubTime: () => Promise.resolve(NOW),
                describeEligibility: () => Promise.resolve(overrides.eligibility ?? eligibility()),
                fetchConfigurationSnapshot: () =>
                  overrides.configurationFetch !== undefined
                    ? overrides.configurationFetch()
                    : Promise.resolve({ outcome: "snapshot", snapshot: makeConfiguration() }),
              },
            }),
    },
    configurationCache: {
      loadCurrent: () => configuration.loadCurrent(),
      persistValidated: (record) => {
        configuration.persistValidated(record);
      },
    },
    trustedTime: {
      evaluate: () => Promise.resolve(overrides.trustedTime ?? trustedTime(NOW)),
    },
    staffSession: {
      restore: () =>
        overrides.staffRestore !== undefined ? overrides.staffRestore() : Promise.resolve(staff()),
    },
    logger: {
      log: (event, fields) => {
        logs.push({ event, fields });
      },
    },
  };

  return {
    ports,
    identity,
    receipt,
    hubReceiptSignatureBase64,
    hubPem,
    configPem,
    logs,
    stores: { receipts, configuration },
    makeConfiguration,
    eligibility,
    staff,
    discoveryPayload,
    overrides,
    close: () => driver.close(),
  };
}

function run(h: Harness) {
  return bootstrapT1(h.ports, {
    configurationSignatureVerifier: developmentConfigurationVerifier(h.configPem),
  });
}

describe("WS-12-T001 T1 bootstrap acceptance", () => {
  it("1. first successful T1 startup walks §5 in order and enters the shell", async () => {
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
    expect(report.configuration?.configurationVersion).toBe(7);
    expect(report.staff?.displayName).toBe("Sokha");
    // The delivered snapshot is now durable local evidence.
    expect(h.stores.configuration.loadCurrent()?.snapshot.configurationVersion).toBe(7);
    // Without a restorable staff session the same startup parks, fail
    // closed, at interactive staff authentication.
    const h2 = makeHarness();
    h2.overrides.staffRestore = () => Promise.resolve(null);
    const parked = await run(h2);
    expect(parked.state).toBe("staff_authentication_required");
    expect(parked.configuration?.freshness).toBe("current");
    h.close();
    h2.close();
  });

  it("2. restart with WAN unavailable and Hub available starts normally — no cloud dependency exists", async () => {
    // The port surface itself is the proof: T1BootstrapPorts carries no
    // cloud, Supabase or WAN port, so cloud availability CANNOT be part of
    // startup. This scenario drives a full startup where the only network
    // peer is the Hub.
    const h = makeHarness();
    const report = await run(h);
    expect(report.state).toBe("ready");
    const portNames = Object.keys(h.ports);
    expect(portNames.sort()).toEqual(
      [
        "identity",
        "receipts",
        "discovery",
        "edgeSession",
        "configurationCache",
        "trustedTime",
        "staffSession",
        "logger",
      ].sort(),
    );
    h.close();
  });

  it("3. Hub discovery is verified: the signed record resolves the pinned endpoint", async () => {
    const h = makeHarness();
    const report = await run(h);
    expect(report.state).toBe("ready");
    // Tampering with the signed record must refuse resolution.
    const tampered = h.discoveryPayload();
    const forged = {
      ...tampered,
      record: { ...tampered.record, hostname: "attacker.lan" },
    };
    h.overrides.discovery = () => Promise.resolve({ outcome: "payload", payload: forged });
    const refused = await run(h);
    expect(refused.state).toBe("hub_unavailable");
    expect(refused.refusalCode).toBe("DISCOVERY_SIGNATURE_INVALID");
    h.close();
  });

  it("4. a record naming the wrong Hub is refused before any session exists", async () => {
    const h = makeHarness();
    h.overrides.discovery = () =>
      Promise.resolve({
        outcome: "payload",
        payload: h.discoveryPayload({ hubDeviceId: randomUUID() }),
      });
    const report = await run(h);
    expect(report.state).toBe("assignment_invalid");
    expect(report.refusalCode).toBe("DISCOVERY_WRONG_HUB");
    expect(report.hub).toBeUndefined();
    h.close();
  });

  it("5. a revoked or expired terminal credential is refused", async () => {
    const h = makeHarness();
    h.overrides.establish = () =>
      Promise.resolve({
        outcome: "refused",
        code: "CREDENTIAL_NOT_CURRENT",
        detail: "credential revoked, expired or superseded",
      });
    const atTransport = await run(h);
    expect(atTransport.state).toBe("credential_invalid");
    expect(atTransport.refusalCode).toBe("CREDENTIAL_NOT_CURRENT");
    // The same refusal from CURRENT Hub eligibility (revoked after session).
    const h2 = makeHarness();
    h2.overrides.eligibility = h2.eligibility({ terminalCredentialStatus: "revoked" });
    const atEligibility = await run(h2);
    expect(atEligibility.state).toBe("credential_invalid");
    expect(atEligibility.refusalCode).toBe("PAIR_DEVICE_NOT_ELIGIBLE");
    h.close();
    h2.close();
  });

  it("6. a stale assignment generation is refused", async () => {
    const h = makeHarness();
    h.overrides.eligibility = h.eligibility({ terminalAssignmentGeneration: 2 });
    const report = await run(h);
    expect(report.state).toBe("assignment_invalid");
    expect(report.refusalCode).toBe("PAIR_ASSIGNMENT_MISMATCH");
    h.close();
  });

  it("7. a non-T1 profile is refused, including retired identifiers", async () => {
    const h = makeHarness({ profile: "laundry.t2.customer_display" });
    const report = await run(h);
    expect(report.state).toBe("profile_not_authorized");
    expect(report.refusalCode).toBe("PROFILE_NOT_T1");
    // A retired pre-rename identifier is refused, never coerced.
    const h2 = makeHarness({ profile: "t2_scan_in" });
    const retired = await run(h2);
    expect(retired.state).toBe("profile_not_authorized");
    h.close();
    h2.close();
  });

  it("8. an incompatible configuration is refused", async () => {
    const h = makeHarness();
    h.overrides.configurationFetch = () =>
      Promise.resolve({
        outcome: "snapshot",
        snapshot: h.makeConfiguration({ schemaVersion: 2 }),
      });
    const report = await run(h);
    expect(report.state).toBe("configuration_incompatible");
    expect(report.refusalCode).toBe("CONFIG_SCHEMA_UNSUPPORTED");
    // A bad signature is equally not activatable.
    const h2 = makeHarness();
    h2.overrides.configurationFetch = () =>
      Promise.resolve({
        outcome: "snapshot",
        snapshot: h2.makeConfiguration({
          signatureBase64: Buffer.from("not a signature").toString("base64"),
        }),
      });
    const badSignature = await run(h2);
    expect(badSignature.state).toBe("configuration_incompatible");
    expect(badSignature.refusalCode).toBe("CONFIG_SIGNATURE_INVALID");
    h.close();
    h2.close();
  });

  it("9. a valid cached configuration carries an explicit offline freshness label", async () => {
    const h = makeHarness();
    // First startup caches the delivered snapshot.
    expect((await run(h)).state).toBe("ready");
    // Now the Hub cannot deliver one; the cached snapshot is re-verified and
    // labelled cached_offline — never presented as current.
    h.overrides.configurationFetch = () =>
      Promise.resolve({ outcome: "unavailable", detail: "no delivery route" });
    const report = await run(h);
    expect(report.state).toBe("offline_ready");
    expect(report.configuration?.freshness).toBe("cached_offline");
    expect(report.configuration?.configurationVersion).toBe(7);
    h.close();
  });

  it("10. a missing or corrupt pairing receipt fails closed", async () => {
    const missing = makeHarness({ persistReceipt: false });
    const noReceipt = await run(missing);
    expect(noReceipt.state).toBe("recovery_required");
    expect(noReceipt.refusalCode).toBe("RECEIPT_MISSING");
    missing.close();
    // Corrupt: a store opened with a DIFFERENT key cannot read its rows.
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

  it("11. staff without T1 authorization is denied", async () => {
    const h = makeHarness();
    h.overrides.staffRestore = () =>
      Promise.resolve(h.staff({ profileCodes: ["laundry.t3.ready_scan_in"] }));
    const report = await run(h);
    expect(report.state).toBe("staff_authentication_required");
    expect(report.refusalCode).toBe("STAFF_PROFILE_NOT_AUTHORIZED");
    // An expired staff session is equally unusable.
    const h2 = makeHarness();
    h2.overrides.staffRestore = () =>
      Promise.resolve(h2.staff({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() }));
    const expired = await run(h2);
    expect(expired.state).toBe("staff_authentication_required");
    expect(expired.refusalCode).toBe("STAFF_SESSION_EXPIRED");
    h.close();
    h2.close();
  });

  it("12. a process restart restores only valid durable state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-t1-restart-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const first = makeHarness({ file });
    expect((await run(first)).state).toBe("ready");
    first.close();

    // "Restart": fresh store instances over the same file, same custody.
    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const sameKey = inMemorySecureKeyStore(Buffer.from("t1-acceptance-seed"));
    const receipts = new PairingReceiptStore(driver, sameKey);
    const configuration = new ConfigurationSnapshotStore(driver, sameKey);
    const h = makeHarness({ file: ":memory:", persistReceipt: false });
    (h.ports as { receipts: unknown }).receipts = receipts;
    (h.ports as { configurationCache: unknown }).configurationCache = {
      loadCurrent: () => configuration.loadCurrent(),
      persistValidated: (record: Parameters<ConfigurationSnapshotStore["persistValidated"]>[0]) =>
        configuration.persistValidated(record),
    };
    // The identity in this harness names a DIFFERENT terminal than the file's
    // receipt — restored durable state must be re-verified, not assumed.
    const mismatched = await run(h);
    expect(["recovery_required", "credential_invalid"]).toContain(mismatched.state);
    h.close();

    // With the ORIGINAL identity, the durable receipt and configuration are
    // restored after re-verification; the Hub not delivering a snapshot now
    // yields the cached label, and staff is NOT restored (fail closed).
    const database2 = new DatabaseSync(file);
    const driver2 = createSqliteDriver(database2);
    const receipts2 = new PairingReceiptStore(driver2, sameKey);
    const configuration2 = new ConfigurationSnapshotStore(driver2, sameKey);
    const resumed = { ...first };
    const ports: T1BootstrapPorts = {
      ...first.ports,
      receipts: receipts2,
      configurationCache: {
        loadCurrent: () => configuration2.loadCurrent(),
        persistValidated: (record) => {
          configuration2.persistValidated(record);
        },
      },
      edgeSession: {
        establish: () =>
          Promise.resolve({
            outcome: "established",
            session: {
              hubTime: () => Promise.resolve(NOW),
              describeEligibility: () => Promise.resolve(resumed.eligibility()),
              fetchConfigurationSnapshot: () =>
                Promise.resolve({ outcome: "unavailable", detail: "no route" }),
            },
          }),
      },
      staffSession: { restore: () => Promise.resolve(null) },
    };
    const report = await bootstrapT1(ports, {
      configurationSignatureVerifier: developmentConfigurationVerifier(first.configPem),
    });
    expect(report.state).toBe("staff_authentication_required");
    expect(report.configuration?.freshness).toBe("cached_offline");
    driver.close();
    driver2.close();
  });

  it("stale configuration: an expired cached snapshot cannot begin operations", async () => {
    const h = makeHarness();
    // Cache a snapshot whose window is already over, then make the Hub
    // unable to deliver a fresh one.
    const expired = h.makeConfiguration({
      issuedAt: new Date(NOW.getTime() - 7_200_000).toISOString(),
      validUntil: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });
    h.stores.configuration.persistValidated({
      snapshot: expired,
      verifiedAt: new Date(NOW.getTime() - 7_000_000).toISOString(),
    });
    h.overrides.configurationFetch = () =>
      Promise.resolve({ outcome: "unavailable", detail: "no delivery route" });
    const report = await run(h);
    expect(report.state).toBe("stale_configuration");
    expect(report.refusalCode).toBe("CONFIG_EXPIRED");
    h.close();
  });

  it("hub unavailable: an unreachable Hub means Store operations cannot begin", async () => {
    const h = makeHarness();
    h.overrides.discovery = () =>
      Promise.resolve({ outcome: "unreachable", detail: "no route to host" });
    const report = await run(h);
    expect(report.state).toBe("hub_unavailable");
    expect(report.refusalCode).toBe("HUB_DISCOVERY_UNREACHABLE");
    h.close();
  });

  it("13. no terminal database or cloud service credential is exposed by the runtime surface", async () => {
    const h = makeHarness();
    const report = await run(h);
    // The report and every logged line survive the forbidden-material rule
    // that guards the terminal store: no connection string, no private key,
    // no provisioning material can ride out through the runtime surface.
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
    // Not even the PUBLIC key body: strip headers and check the base64 body.
    const pemBody = h.hubPem.replace(/-/g, "").replace(/\s/g, "").slice(20, 60);
    expect(pemBody.length).toBeGreaterThan(0);
    expect(logText.replace(/\s/g, "")).not.toContain(pemBody);
    expect(logText).not.toContain(h.hubReceiptSignatureBase64);
    expect(logText).not.toContain(h.hubReceiptSignatureBase64.slice(0, 24));
    expect(logText).not.toMatch(/bearer/i);
    // Structured events only: every field value is a primitive.
    for (const line of h.logs) {
      for (const value of Object.values(line.fields)) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
      }
    }
    h.close();
  });
});
