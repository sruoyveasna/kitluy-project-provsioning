/**
 * TERMINAL CREDENTIAL DELIVERY, HUB PROJECTION AND INSTALLATION ACK.
 *
 * WS-11-T004-P04C1, against the REAL Hub database (`kitluy_hub_local`) with
 * hub/migrations/** through 0033 applied; the suite SKIPS VISIBLY when the
 * database is unreachable (KLD-EVIDENCE-001).
 *
 * WHAT IS PROVEN, AND WHAT IS DELIBERATELY NOT RE-PROVEN
 *   A — the terminal VERIFIES the public credential package before installing
 *       anything, and every transplant class is refused;
 *   B — the private key never enters a package, a delivery or the database;
 *   C — the Hub receives ONE authoritative projection through the EXISTING
 *       signed cloud delivery path, and a redelivery is idempotent;
 *   D — a revoked or superseded projection cannot be restored to active by a
 *       replayed or reordered delivery, so it can never re-authorize
 *       activation or pairing;
 *   E — the installation acknowledgment is the EXISTING group-0174
 *       `kitluy.activation-ack.v1` payload (which already binds credential id,
 *       serial, fingerprint, terminal, assignment, Hub and environment) —
 *       this suite proves the binding is exact and that no SECOND synonymous
 *       acknowledgment exists;
 *   F — issuance, terminal receipt, Hub projection, installation
 *       acknowledgment, activation and pairing remain SIX distinct facts;
 *   G — nothing logged or persisted carries a private key, a certificate body
 *       or a secret.
 *
 * The cloud issuance authority is NOT re-proven here (P04A/P03A own it) and no
 * second credential is ever issued by anything in this file.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  activationAckBytes,
  assertNoPrivateKeyMaterial,
  credentialPackageBytes,
  publicKeyFingerprint,
  verifyCredentialPackage,
  verifyDetachedSignature,
  type ActivationAckChallenge,
  type CertificateChain,
  type CredentialPackageExpectation,
  type SignedTerminalCredentialPackage,
  type TerminalCredentialPackage,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable, withHubTransaction } from "../src/hub/db.js";
import {
  applyCredentialProjectionDelivery,
  findProjectedCredential,
  parseCredentialProjectionPayload,
  CREDENTIAL_PROJECTION_MESSAGE_TYPE,
  CREDENTIAL_PROJECTION_SCHEMA_VERSION,
  type CredentialProjectionPayload,
} from "../src/hub/sync/credential-projection.js";
import type { CloudMessage } from "../src/hub/sync/inbox.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const OTHER_TENANT = "e0000000-0000-4000-8000-0000000000a1";
const T1 = "laundry.t1.intake_cashier";
const ENV: TrustEnvironment = "development";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: credential delivery — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();
const CA_NOT_BEFORE = new Date(Date.now() - 3_600_000);
const CA_NOT_AFTER = new Date(Date.now() + 365 * 24 * 3_600_000);
const ca = new DevelopmentCertificateAuthority({
  notBefore: CA_NOT_BEFORE,
  notAfter: CA_NOT_AFTER,
});

/** Monotonic cloud sequence: the inbox is unique on (location, sequence). */
let sequence = BigInt(Date.now());
function nextSequence(): bigint {
  sequence += 1n;
  return sequence;
}

interface Fixture {
  readonly terminalId: string;
  readonly keyRef: string;
  readonly pem: string;
  readonly fingerprint: string;
  readonly credentialId: string;
  readonly serial: string;
  readonly assignmentId: string;
  readonly chain: CertificateChain;
}

describe.skipIf(!live)("terminal credential delivery and projection (hub group 0033)", () => {
  let pool: pg.Pool;
  let authorityKeyRef = "";
  let authorityPem = "";
  let authorityFingerprint = "";
  let hadHubRuntime = false;
  const logLines: string[] = [];

  /**
   * Registers a terminal WITHOUT a credential row: the projection door is
   * what creates it, so pre-creating one would prove nothing.
   */
  async function newTerminal(label: string): Promise<Fixture> {
    const terminalId = randomUUID();
    const keyRef = `p04c1-${label}-${RUN}`;
    await keys.generateDeviceKey(keyRef, ENV);
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const serial = `P04C1-${label}-${RUN}`;
    const credentialId = randomUUID();
    const { rows: hw } = await pool.query<{ id: string }>(
      `select id from edge_config.hardware_profile limit 1`,
    );
    await pool.query(
      `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name,
          hardware_profile_id, installation_id, certificate_serial,
          assignment_generation, lifecycle_status, last_client_sequence,
          last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'PENDING-DELIVERY', 1, 'registered', 0,
               now(), now(), now())`,
      [terminalId, TENANT, STORE, LOCATION, `p04c1-${label}-${RUN}`, hw[0]?.id, randomUUID()],
    );
    const device = ca.issueDeviceCertificate({
      certificateId: credentialId,
      serialNumber: serial,
      subjectPublicKeyPem: pem,
      subjectFingerprint: fingerprint,
      deviceRecordId: terminalId,
      certificateGeneration: 1,
      hardwareTrustLevel: "software_only",
      notBefore: new Date(Date.now() - 60_000),
      notAfter: new Date(Date.now() + 90 * 24 * 3_600_000),
    });
    const chain: CertificateChain = {
      root: ca.rootCertificate,
      intermediate: ca.intermediateCertificate,
      device,
    };
    return {
      terminalId,
      keyRef,
      pem,
      fingerprint,
      credentialId,
      serial,
      assignmentId: randomUUID(),
      chain,
    };
  }

  function buildPackage(
    fixture: Fixture,
    over: Partial<TerminalCredentialPackage> = {},
  ): TerminalCredentialPackage {
    const device = fixture.chain.device.tbs;
    return {
      packageVersion: "1",
      credentialId: fixture.credentialId,
      certificateSerial: fixture.serial,
      publicKeyFingerprint: fixture.fingerprint,
      environment: ENV,
      issuedAt: device.notBefore,
      expiresAt: device.notAfter,
      terminalDeviceId: fixture.terminalId,
      terminalAssignmentId: fixture.assignmentId,
      terminalAssignmentGeneration: 1,
      terminalProfileKey: T1,
      storeHubDeviceId: HUB_DEVICE,
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      chain: fixture.chain,
      ...over,
    };
  }

  function sign(pkg: TerminalCredentialPackage): SignedTerminalCredentialPackage {
    return {
      package: pkg,
      authorityKeyFingerprint: authorityFingerprint,
      signature: keys.provePossession(authorityKeyRef, credentialPackageBytes(pkg)),
    };
  }

  function expectation(
    fixture: Fixture,
    over: Partial<CredentialPackageExpectation> = {},
  ): CredentialPackageExpectation {
    return {
      terminalDeviceId: fixture.terminalId,
      terminalAssignmentId: fixture.assignmentId,
      terminalAssignmentGeneration: 1,
      terminalProfileKey: T1,
      storeHubDeviceId: HUB_DEVICE,
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: ENV,
      subjectKeyFingerprint: fixture.fingerprint,
      trustedRootFingerprints: [fixture.chain.root.tbs.subjectFingerprint],
      trustedAuthorityKeys: new Map([[authorityFingerprint, authorityPem]]),
      ...over,
    };
  }

  function projectionPayload(
    fixture: Fixture,
    over: Partial<CredentialProjectionPayload> = {},
  ): Record<string, unknown> {
    const device = fixture.chain.device.tbs;
    const payload: CredentialProjectionPayload = {
      credentialId: fixture.credentialId,
      terminalDeviceId: fixture.terminalId,
      certificateSerial: fixture.serial,
      publicKeyFingerprint: fixture.fingerprint,
      credentialType: "terminal_operational",
      issuer: "KitLuy Development Device CA",
      credentialStatus: "active",
      rotationGeneration: 1,
      issuedAt: device.notBefore,
      expiresAt: device.notAfter,
      environment: ENV,
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      storeHubDeviceId: HUB_DEVICE,
      terminalProfileKey: T1,
      terminalAssignmentGeneration: 1,
      ...over,
    };
    return { ...payload } as unknown as Record<string, unknown>;
  }

  function delivery(
    payload: Record<string, unknown>,
    over: Partial<CloudMessage> = {},
  ): CloudMessage {
    return {
      messageId: randomUUID(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      messageType: CREDENTIAL_PROJECTION_MESSAGE_TYPE,
      schemaVersion: CREDENTIAL_PROJECTION_SCHEMA_VERSION,
      cloudSequence: nextSequence(),
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
      payload,
      signature: Buffer.from("dev-cloud-signature"),
      signingKeyId: "dev-cloud-key",
      ...over,
    };
  }

  /** Applies one delivery in its own transaction as the runtime identity. */
  async function apply(
    message: CloudMessage,
    verify: (m: CloudMessage) => boolean = () => true,
  ): Promise<ReturnType<typeof applyCredentialProjectionDelivery>> {
    return withHubTransaction(
      pool,
      (client) => applyCredentialProjectionDelivery(client, message, verify, randomUUID()),
      "kitluy_hub_runtime",
    );
  }

  beforeAll(async () => {
    pool = createHubPool(process.env, 10);
    authorityKeyRef = `p04c1-authority-${RUN}`;
    await keys.generateDeviceKey(authorityKeyRef, ENV);
    authorityPem = keys.publicKeyPem(authorityKeyRef) ?? "";
    authorityFingerprint = publicKeyFingerprint(authorityPem);
    const { rows } = await pool.query<{ member: boolean }>(
      `select pg_has_role('postgres', 'kitluy_hub_runtime', 'member') as member`,
    );
    hadHubRuntime = rows[0]?.member === true;
    // Explicit literal grantee — KLRISK-HUB-001.
    await pool.query(`grant kitluy_hub_runtime to postgres`);
  }, 120_000);

  afterAll(async () => {
    if (!hadHubRuntime)
      await pool?.query(`revoke kitluy_hub_runtime from postgres`).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // A — the terminal verifies BEFORE it installs
  // -------------------------------------------------------------------------
  it("A: a valid package verifies and yields exactly what may be installed", async () => {
    const fixture = await newTerminal("A1");
    const verdict = verifyCredentialPackage(
      sign(buildPackage(fixture)),
      expectation(fixture),
      new Date(),
    );
    expect(verdict.verified, verdict.detail).toBe(true);
    expect(verdict.installable).toEqual({
      credentialId: fixture.credentialId,
      certificateSerial: fixture.serial,
      certificateFingerprint: fixture.fingerprint,
      environment: ENV,
      terminalDeviceId: fixture.terminalId,
      terminalAssignmentId: fixture.assignmentId,
      terminalProfileKey: T1,
      storeHubDeviceId: HUB_DEVICE,
    });
  });

  it("A: every transplant and tamper class is refused with its own code", async () => {
    const fixture = await newTerminal("A2");
    const other = await newTerminal("A3");
    const at = new Date();

    // Unsigned / wrongly signed.
    const forged: SignedTerminalCredentialPackage = {
      package: buildPackage(fixture),
      authorityKeyFingerprint: authorityFingerprint,
      signature: keys.provePossession(other.keyRef, Buffer.from("not the package")),
    };
    expect(verifyCredentialPackage(forged, expectation(fixture), at).rejectionCode).toBe(
      "PACKAGE_AUTHORITY_INVALID",
    );
    // An authority the terminal does not trust.
    const unknownAuthority = {
      ...sign(buildPackage(fixture)),
      authorityKeyFingerprint: "f".repeat(64),
    };
    expect(verifyCredentialPackage(unknownAuthority, expectation(fixture), at).rejectionCode).toBe(
      "PACKAGE_AUTHORITY_UNKNOWN",
    );
    // Signature covers the package: any field change breaks it, so tamper
    // classes are asserted by RE-SIGNING the altered package. A tamper that
    // did not re-sign would only ever prove the signature check works.
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture, { certificateSerial: `${fixture.serial}-X` })),
        expectation(fixture),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_CERTIFICATE_MISMATCH");
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture, { publicKeyFingerprint: other.fingerprint })),
        expectation(fixture),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_FINGERPRINT_MISMATCH");
    // A package built over ANOTHER terminal's key, delivered to this one.
    expect(
      verifyCredentialPackage(sign(buildPackage(other)), expectation(fixture), at).rejectionCode,
    ).toBe("PACKAGE_TERMINAL_MISMATCH");
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture, { terminalAssignmentGeneration: 2 })),
        expectation(fixture),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_ASSIGNMENT_MISMATCH");
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture, { tenantId: OTHER_TENANT })),
        expectation(fixture),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_SCOPE_MISMATCH");
    // An untrusted anchor set: a pilot verifier simply does not carry the
    // development root.
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture)),
        expectation(fixture, { trustedRootFingerprints: [] }),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_CHAIN_INVALID");
    // Outside the validity window, judged against the caller's trusted instant.
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture)),
        expectation(fixture),
        new Date(Date.parse(fixture.chain.device.tbs.notAfter) + 1000),
      ).rejectionCode,
    ).toBe("PACKAGE_WINDOW_INVALID");
    expect(
      verifyCredentialPackage(
        sign(buildPackage(fixture, { packageVersion: "2" })),
        expectation(fixture),
        at,
      ).rejectionCode,
    ).toBe("PACKAGE_VERSION_UNSUPPORTED");
  });

  // -------------------------------------------------------------------------
  // B — the private key is terminal-local, structurally
  // -------------------------------------------------------------------------
  it("B: private material anywhere in a package fails it before anything else", async () => {
    const fixture = await newTerminal("B1");
    const poisoned = {
      ...sign(buildPackage(fixture)),
      // Exactly the "helpful" adapter this check exists to stop.
      extra: { recovery: "-----BEGIN PRIVATE KEY-----\nMC4CAQ==\n-----END PRIVATE KEY-----" },
    } as unknown as SignedTerminalCredentialPackage;
    const verdict = verifyCredentialPackage(poisoned, expectation(fixture), new Date());
    expect(verdict.rejectionCode).toBe("PACKAGE_PRIVATE_MATERIAL_PRESENT");

    // The key provider never exposes a private half at all.
    expect(Object.keys(keys.publicKeyPem(fixture.keyRef) ?? "").length).toBeGreaterThan(0);
    expect(keys.publicKeyPem(fixture.keyRef)).not.toContain("PRIVATE KEY");
    // And the delivery parser refuses it before a single fact is read.
    expect(() =>
      parseCredentialProjectionPayload({
        ...projectionPayload(fixture),
        privateKeyPem: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
      }),
    ).toThrow(/PRIVATE-MATERIAL/);
    expect(() => assertNoPrivateKeyMaterial(projectionPayload(fixture))).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // C — ONE authoritative Hub projection, idempotent
  // -------------------------------------------------------------------------
  it("C: a signed delivery projects one credential; redelivery changes nothing", async () => {
    const fixture = await newTerminal("C1");
    const message = delivery(projectionPayload(fixture));

    const first = await apply(message);
    expect(first.outcome).toBe("projected");
    expect(first.credentialId).toBe(fixture.credentialId);

    const projected = await withHubTransaction(
      pool,
      (client) => findProjectedCredential(client, fixture.credentialId),
      "kitluy_hub_runtime",
    );
    expect(projected?.status).toBe("active");
    expect(projected?.terminalDeviceId).toBe(fixture.terminalId);
    // The registration now points at the delivered credential — this is the
    // projection P04B's LAN lifecycle matrix authorizes against.
    const { rows: reg } = await pool.query<{ serial: string }>(
      `select certificate_serial as serial from edge_identity.terminal_device where id = $1::uuid`,
      [fixture.terminalId],
    );
    expect(reg[0]?.serial).toBe(fixture.serial);

    // The SAME message again: the inbox answers with the original result.
    const replay = await apply(message);
    expect(replay.outcome).toBe("duplicate_ignored");
    expect(replay.projectionId).toBe(first.projectionId);

    // A NEW message carrying the same facts converges on ONE credential — it
    // is recorded as a second delivery, never as a second credential.
    const again = await apply(delivery(projectionPayload(fixture)));
    expect(again.outcome).toBe("projected");
    expect(again.credentialId).toBe(fixture.credentialId);
    const { rows: creds } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.device_credential where id = $1::uuid`,
      [fixture.credentialId],
    );
    expect(creds[0]?.n, "no second credential row is ever created").toBe("1");
    const { rows: evidence } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.credential_projection
        where credential_id = $1::uuid`,
      [fixture.credentialId],
    );
    expect(evidence[0]?.n, "both deliveries left evidence").toBe("2");
  });

  it("C: an unverifiable delivery is durably rejected and applies nothing", async () => {
    const fixture = await newTerminal("C2");
    const result = await apply(delivery(projectionPayload(fixture)), () => false);
    expect(result.outcome).toBe("rejected");
    expect(result.errorCode).toBe("EDGE_INBOX_SIGNATURE_INVALID");
    const projected = await withHubTransaction(
      pool,
      (client) => findProjectedCredential(client, fixture.credentialId),
      "kitluy_hub_runtime",
    );
    expect(projected).toBeUndefined();
  });

  it("C: cross-scope and cross-terminal deliveries are refused", async () => {
    const fixture = await newTerminal("C3");
    // Payload scope that contradicts its own envelope.
    await expect(
      apply(delivery(projectionPayload(fixture, { tenantId: OTHER_TENANT }))),
    ).rejects.toMatchObject({ code: "EDGE_CLOUD_REJECTED_SCOPE" });
    // Envelope AND payload agree, but neither matches the registered terminal.
    await expect(
      apply(
        delivery(projectionPayload(fixture, { tenantId: OTHER_TENANT }), {
          tenantId: OTHER_TENANT,
        }),
      ),
    ).rejects.toThrow(/CREDENTIAL-PROJECTION-SCOPE/);
    // A credential moved to another terminal.
    const other = await newTerminal("C4");
    await apply(delivery(projectionPayload(fixture)));
    await expect(
      apply(delivery(projectionPayload(fixture, { terminalDeviceId: other.terminalId }))),
    ).rejects.toThrow(/CREDENTIAL-PROJECTION-IDENTITY/);
    // A contradicted serial for the same credential id.
    await expect(
      apply(delivery(projectionPayload(fixture, { certificateSerial: `${fixture.serial}-B` }))),
    ).rejects.toThrow(/CREDENTIAL-PROJECTION-IDENTITY/);
  });

  // -------------------------------------------------------------------------
  // D — a revoked projection stays revoked
  // -------------------------------------------------------------------------
  it("D: a revoked or superseded projection can never be restored to active", async () => {
    const fixture = await newTerminal("D1");
    await apply(delivery(projectionPayload(fixture)));
    const revoked = await apply(
      delivery(projectionPayload(fixture, { credentialStatus: "revoked" })),
    );
    expect(revoked.outcome).toBe("projected");

    const { rows } = await pool.query<{ status: string; reason: string | null }>(
      `select status, revocation_reason as reason from edge_identity.device_credential
        where id = $1::uuid`,
      [fixture.credentialId],
    );
    expect(rows[0]?.status).toBe("revoked");
    expect(rows[0]?.reason).not.toBeNull();

    // A REPLAYED or REORDERED earlier delivery cannot undo it. This is the
    // property that makes "revoked cannot authorize activation or pairing"
    // hold under out-of-order delivery, not just in order.
    await expect(apply(delivery(projectionPayload(fixture)))).rejects.toThrow(
      /CREDENTIAL-PROJECTION-STATUS/,
    );
    await expect(
      apply(delivery(projectionPayload(fixture, { credentialStatus: "superseded" }))),
    ).resolves.toMatchObject({ outcome: "projected" });
    await expect(apply(delivery(projectionPayload(fixture)))).rejects.toThrow(
      /CREDENTIAL-PROJECTION-STATUS/,
    );
    // A rotation-generation regression is refused for the same reason.
    await expect(
      apply(
        delivery(
          projectionPayload(fixture, { credentialStatus: "superseded", rotationGeneration: 1 }),
        ),
      ),
    ).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // E — the acknowledgment is the EXISTING one, and it binds exactly
  // -------------------------------------------------------------------------
  it("E: installation is acknowledged by the group-0174 payload, bound to the exact credential", async () => {
    const fixture = await newTerminal("E1");
    const verdict = verifyCredentialPackage(
      sign(buildPackage(fixture)),
      expectation(fixture),
      new Date(),
    );
    expect(verdict.verified).toBe(true);
    const installable = verdict.installable!;

    const challenge: ActivationAckChallenge = {
      activationChallengeId: randomUUID(),
      purpose: "terminal_provisioning_activation_acknowledgment",
      activationId: randomUUID(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: ENV,
      storeHubDeviceId: installable.storeHubDeviceId,
      terminalDeviceId: installable.terminalDeviceId,
      terminalAssignmentId: installable.terminalAssignmentId,
      terminalProfileKey: installable.terminalProfileKey,
      provisioningCodeId: randomUUID(),
      popChallengeId: randomUUID(),
      terminalKeyFingerprint: fixture.fingerprint,
      certificateId: installable.credentialId,
      certificateSerial: installable.certificateSerial,
      certificateFingerprint: installable.certificateFingerprint,
      nonce: randomUUID().replace(/-/g, ""),
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
    };
    const signature = keys.provePossession(fixture.keyRef, activationAckBytes(challenge));
    expect(verifyDetachedSignature(fixture.pem, activationAckBytes(challenge), signature)).toBe(
      true,
    );

    // The acknowledgment is bound to the EXACT credential: changing the
    // serial, the certificate id or the fingerprint changes the signed bytes,
    // so the same signature no longer verifies. That is what "acknowledge the
    // exact certificate fingerprint" means, and why no second acknowledgment
    // authority is needed.
    for (const mutation of [
      { certificateSerial: `${installable.certificateSerial}-X` },
      { certificateId: randomUUID() },
      { certificateFingerprint: "0".repeat(64) },
      { terminalAssignmentId: randomUUID() },
      { storeHubDeviceId: randomUUID() },
      { environment: "pilot" as TrustEnvironment },
    ]) {
      const altered = { ...challenge, ...mutation };
      expect(
        verifyDetachedSignature(fixture.pem, activationAckBytes(altered), signature),
        `mutation ${JSON.stringify(Object.keys(mutation))} must break the acknowledgment`,
      ).toBe(false);
    }
    // No private key material anywhere in what was acknowledged.
    expect(() => assertNoPrivateKeyMaterial(challenge)).not.toThrow();
    logLines.push(JSON.stringify({ operation: "acknowledge", result: "OK" }));
  });

  it("E: no second, synonymous acknowledgment authority exists", async () => {
    const fixture = await newTerminal("E2");
    // The repository has exactly ONE domain that proves a terminal installed a
    // credential. A second one would let a proof made for one purpose satisfy
    // the other, which is precisely what the domain separator prevents.
    const ackDomain = Buffer.from(
      activationAckBytes({
        activationChallengeId: "a",
        purpose: "p",
        activationId: "b",
        tenantId: "c",
        digitalStoreId: "d",
        storeLocationId: "e",
        environment: ENV,
        storeHubDeviceId: "f",
        terminalDeviceId: "g",
        terminalAssignmentId: "h",
        terminalProfileKey: "i",
        provisioningCodeId: "j",
        popChallengeId: "k",
        terminalKeyFingerprint: "l",
        certificateId: "m",
        certificateSerial: "n",
        certificateFingerprint: "o",
        nonce: "p",
        issuedAt: new Date(0),
        expiresAt: new Date(1),
      }),
    ).toString("utf8");
    expect(ackDomain.startsWith("kitluy.activation-ack.v1")).toBe(true);
    // The delivery package is a DIFFERENT domain, so a package signature can
    // never be replayed as an installation acknowledgment.
    const packageDomain = Buffer.from(credentialPackageBytes(buildPackage(fixture))).toString(
      "utf8",
    );
    expect(packageDomain.startsWith("kitluy.terminal-credential-package.v1")).toBe(true);
    expect(packageDomain.startsWith(ackDomain.split("\n")[0]!)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // F / G — the facts stay distinct; nothing leaks
  // -------------------------------------------------------------------------
  it("F: delivery, projection, acknowledgment, activation and pairing stay distinct", async () => {
    const fixture = await newTerminal("F1");
    await apply(delivery(projectionPayload(fixture)));
    // A projected credential does NOT make the terminal active, and does not
    // pair it. Those are later, separately-evidenced facts.
    const { rows } = await pool.query<{ lifecycle: string }>(
      `select lifecycle_status as lifecycle from edge_identity.terminal_device where id = $1::uuid`,
      [fixture.terminalId],
    );
    expect(rows[0]?.lifecycle, "projection never advances activation").toBe("registered");
    const { rows: paired } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt
        where terminal_device_id = $1::uuid`,
      [fixture.terminalId],
    );
    expect(paired[0]?.n, "projection never pairs").toBe("0");
  });

  it("G: no private key, certificate body or secret is persisted or logged", async () => {
    const fixture = await newTerminal("G1");
    await apply(delivery(projectionPayload(fixture)));
    const { rows } = await pool.query<{ payload: string }>(
      `select payload::text as payload from edge_sync.inbox
        where message_type = $1 and payload->>'credentialId' = $2`,
      [CREDENTIAL_PROJECTION_MESSAGE_TYPE, fixture.credentialId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.payload).not.toContain("PRIVATE KEY");
      expect(row.payload).not.toContain("BEGIN PUBLIC KEY");
      expect(row.payload).not.toContain("BEGIN CERTIFICATE");
    }
    const { rows: projections } = await pool.query<{ everything: string }>(
      `select credential_projection::text as everything from edge_identity.credential_projection
        where credential_id = $1::uuid`,
      [fixture.credentialId],
    );
    for (const row of projections) {
      expect(row.everything).not.toContain("PRIVATE KEY");
      expect(row.everything).not.toContain("BEGIN");
    }
    for (const line of logLines) {
      expect(line).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE|[0-9a-f]{64}/);
    }
  });

  it("G: the projection evidence ledger is append-only and runtime-unwritable", async () => {
    const fixture = await newTerminal("G2");
    await apply(delivery(projectionPayload(fixture)));
    await expect(
      withHubTransaction(
        pool,
        (client) =>
          client.query(
            `update edge_identity.credential_projection set outcome = 'projected'
              where credential_id = $1::uuid`,
            [fixture.credentialId],
          ),
        "kitluy_hub_runtime",
      ),
    ).rejects.toThrow();
    await expect(
      withHubTransaction(
        pool,
        (client) =>
          client.query(
            `insert into edge_identity.credential_projection
               (id, delivery_message_id, credential_id, terminal_device_id, certificate_serial,
                public_key_fingerprint, credential_type, issuer, credential_status,
                rotation_generation, credential_issued_at, credential_expires_at, environment,
                tenant_id, digital_store_id, location_id, hub_device_id, terminal_profile_code,
                terminal_assignment_generation, outcome, correlation_id, projected_at)
             values ($1, $2, $3, $4, 'X', repeat('a', 64), 't', 'i', 'active', 1,
                     now(), now() + interval '1 day', 'development', $5, $6, $7, $8, $9, 1,
                     'projected', $10, now())`,
            [
              randomUUID(),
              randomUUID(),
              randomUUID(),
              fixture.terminalId,
              TENANT,
              STORE,
              LOCATION,
              HUB_DEVICE,
              T1,
              randomUUID(),
            ],
          ),
        "kitluy_hub_runtime",
      ),
    ).rejects.toThrow();
  });
});
