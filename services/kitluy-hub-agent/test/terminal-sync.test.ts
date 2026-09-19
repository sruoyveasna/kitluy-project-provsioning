/**
 * HUB-TERMINAL-SYNC-001 — the Hub side of terminal sync, without a database:
 * the wire contract does not drift from the producer's copy; the trust record
 * loader refuses everything but public development material; a request the
 * Hub signs verifies at the producer and a tampered one does not; an envelope
 * is applied only when it is signed by the trusted key, answers THIS request,
 * names THIS Hub in ITS scope, and is fresh; deliveries parse against their
 * closed shape; and one sync pass turns every failure into a coded outcome.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, expect, it } from "vitest";

import * as producer from "../../../scripts/development/hub-sync-contract.mjs";
import {
  buildSignedEnvelope,
  verifyHubSyncRequest,
  x509SerialOf,
} from "../../../scripts/development/hub-sync-service.mjs";
import {
  HUB_SYNC_ENVELOPE_KIND,
  HUB_SYNC_REQUEST_KIND,
  TERMINAL_PROJECTION_KIND,
  canonicalJson,
  hubSyncEnvelopeBytes,
  hubSyncRequestBytes,
  publicKeyFingerprint,
} from "../src/hub/terminal-sync/contract.js";
import {
  buildSyncRequest,
  loadHubSyncTrust,
  parseTerminalDelivery,
  readBoardFacts,
  runTerminalSyncOnce,
  terminalSyncConfigFromEnv,
  verifySyncEnvelope,
  type TerminalSyncConfig,
} from "../src/hub/terminal-sync/index.js";

const HUB = "549a41c6-21e9-4838-8b48-34a3878ba290";
const SCOPE = {
  tenantId: "00000000-0000-4000-8000-000000000011",
  digitalStoreId: "00000000-0000-4000-8000-000000000015",
  storeLocationId: "00000000-0000-4000-8000-000000000018",
};

function edKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** A development signer + the public trust record the Hub image would carry. */
function producerSigner() {
  const key = edKey();
  const keyId = publicKeyFingerprint(key.publicKeyPem);
  const record = {
    kind: "kitluy.hub-sync-trust-key.v1",
    keyId,
    keyVersion: 1,
    algorithm: "ed25519",
    purpose: "transport_signing",
    environment: "development",
    productionEligible: false,
    state: "current",
    publicKeyPem: key.publicKeyPem,
  };
  return { signer: { privateKey: key.privateKey, keyId, keyVersion: 1 }, record };
}

function writeTrust(record: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-hub-sync-trust-"));
  const path = join(dir, "hub-sync-trust.json");
  writeFileSync(path, typeof record === "string" ? record : JSON.stringify(record));
  return path;
}

/** A self-signed certificate standing in for the Hub's operational certificate. */
function selfSignedPem(cn: string): string {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  // forge encodes a high-bit serial as a NEGATIVE integer (no DER pad), which
  // Node then renders with a minus sign — a fixture quirk, not the CA's. The
  // pad-stripping path is covered by the column case below; keep this one low.
  cert.serialNumber = "3f" + forge.util.bytesToHex(forge.random.getBytesSync(7));
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(kp.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** A door row as group 0232 returns it, for one terminal. */
function doorRow(overrides: Partial<Record<string, unknown>> = {}) {
  const idKey = edKey();
  return {
    device_id: "74078c2e-6a25-4d25-b6bf-bd158c0e1a02",
    asset_tag: "KL-54A3320E1201",
    lifecycle_state: "active",
    assignment_id: "0d4f4a0a-4a8c-4b9c-9e35-7bd6b7f19a10",
    assignment_generation: 1,
    credential_id: "5e1b6d1c-3d2b-4a6f-9d54-6a3f4d2b1c0e",
    credential_serial_label: "DEV-1BACC7BF573FEB35",
    public_key_fingerprint: "a".repeat(64),
    certificate_generation: 1,
    environment: "development",
    not_before: "2026-09-18T08:55:17.240Z",
    not_after: "2026-10-18T08:55:17.240Z",
    certificate_x509_serial: "1bacc7bf573feb35",
    certificate_pem: null,
    issuer_reference: "4c240ab0b71bf4cc63d94e0396385c892d7f4e77f0dc76f0a9ca7b3dfff37c8a",
    identity_key_fingerprint: publicKeyFingerprint(idKey.publicKeyPem),
    seat_label: "T1T2",
    profile_keys: ["laundry.t2.customer_display", "laundry.t1.intake_cashier"],
    ...overrides,
  };
}

function doorAnswer(rows: unknown[] = [doorRow()]) {
  return {
    outcome: "OK",
    hub: {
      deviceId: HUB,
      assetTag: "KL-CFADA8C75001",
      assignmentId: "7fd8b688-fb7e-4d92-a906-89d9e25ad513",
      assignmentGeneration: 5,
      ...SCOPE,
    },
    terminals: rows,
  };
}

describe("the wire contract does not drift from the producer's copy", () => {
  it("names the same kinds", () => {
    expect(producer.HUB_SYNC_REQUEST_KIND).toBe(HUB_SYNC_REQUEST_KIND);
    expect(producer.HUB_SYNC_ENVELOPE_KIND).toBe(HUB_SYNC_ENVELOPE_KIND);
    expect(producer.TERMINAL_PROJECTION_KIND).toBe(TERMINAL_PROJECTION_KIND);
  });

  it("builds byte-identical request preimages", () => {
    const input = {
      identityPublicKeyFingerprint: "b".repeat(64),
      hubDeviceId: HUB.toUpperCase(),
      requestedAt: "2026-09-19T01:02:03.004Z",
      nonce: "0123456789abcdef0123456789abcdef",
    };
    expect(
      Buffer.from(hubSyncRequestBytes(input)).equals(
        Buffer.from(producer.hubSyncRequestBytes(input)),
      ),
    ).toBe(true);
  });

  it("builds byte-identical envelope preimages, whatever the key order", () => {
    const a = {
      kind: HUB_SYNC_ENVELOPE_KIND,
      terminals: [{ z: 1, a: [3, { y: null }] }],
      hub: { deviceId: HUB },
      producedAt: "x",
      requestNonce: "n",
    };
    const b = {
      producedAt: "x",
      hub: { deviceId: HUB },
      requestNonce: "n",
      terminals: [{ a: [3, { y: null }], z: 1 }],
      kind: HUB_SYNC_ENVELOPE_KIND,
    };
    expect(canonicalJson(a)).toBe(producer.canonicalJson(b));
    expect(
      Buffer.from(hubSyncEnvelopeBytes(a)).equals(Buffer.from(producer.hubSyncEnvelopeBytes(b))),
    ).toBe(true);
  });

  it("fingerprints a key the same way (SPKI DER, sha-256)", () => {
    const key = edKey();
    expect(publicKeyFingerprint(key.publicKeyPem)).toBe(
      producer.publicKeyFingerprint(key.publicKeyPem),
    );
  });
});

describe("the hub-sync trust record", () => {
  const { record } = producerSigner();

  it("loads public development material", () => {
    const loaded = loadHubSyncTrust(writeTrust(record), "development");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.trust.keyId).toBe(record.keyId);
  });

  it("refuses a record that carries a private key, whatever else it says", () => {
    // The marker is assembled, never written out as a PEM header in source.
    const marker = ["PRIVATE", "KEY"].join(" ");
    const loaded = loadHubSyncTrust(
      writeTrust({
        ...record,
        publicKeyPem: `${record.publicKeyPem}\n-----BEGIN ${marker}-----\nx\n-----END ${marker}-----`,
      }),
      "development",
    );
    expect(loaded).toMatchObject({ ok: false, refusal: "TRUST_RECORD_CARRIES_PRIVATE_KEY" });
  });

  it("refuses the wrong kind, the wrong purpose and a trust-chain crossing", () => {
    expect(
      loadHubSyncTrust(
        writeTrust({ ...record, kind: "kitluy.release-trust-key.v1" }),
        "development",
      ),
    ).toMatchObject({ refusal: "TRUST_RECORD_WRONG_KIND" });
    expect(
      loadHubSyncTrust(writeTrust({ ...record, purpose: "release_signing" }), "development"),
    ).toMatchObject({ refusal: "TRUST_RECORD_WRONG_PURPOSE" });
    expect(loadHubSyncTrust(writeTrust(record), "pilot")).toMatchObject({
      refusal: "TRUST_RECORD_WRONG_ENVIRONMENT",
    });
    expect(loadHubSyncTrust(writeTrust(record), "unknown")).toMatchObject({
      refusal: "TRUST_RECORD_WRONG_ENVIRONMENT",
    });
  });

  it("refuses a keyId that is not the key's own fingerprint, and a missing file", () => {
    expect(
      loadHubSyncTrust(writeTrust({ ...record, keyId: "c".repeat(64) }), "development"),
    ).toMatchObject({ refusal: "TRUST_RECORD_MALFORMED" });
    expect(loadHubSyncTrust(writeTrust("{not json"), "development")).toMatchObject({
      refusal: "TRUST_RECORD_UNPARSEABLE",
    });
    expect(loadHubSyncTrust("/nonexistent/hub-sync-trust.json", "development")).toMatchObject({
      refusal: "TRUST_RECORD_MISSING",
    });
  });
});

describe("the Hub's signed request", () => {
  const identity = edKey();

  it("verifies at the producer, which learns the fingerprint and nothing secret", () => {
    const request = buildSyncRequest({
      identityPrivateKey: identity.privateKey,
      identityPublicKeyPem: identity.publicKeyPem,
      hubDeviceId: HUB,
    });
    expect(JSON.stringify(request)).not.toContain("PRIVATE KEY");
    const verdict = verifyHubSyncRequest(JSON.parse(JSON.stringify(request)));
    expect(verdict).toMatchObject({
      ok: true,
      hubDeviceId: HUB,
      identityFingerprint: publicKeyFingerprint(identity.publicKeyPem),
      nonce: request.nonce,
    });
  });

  it("is refused when tampered, signed by another key, stale, or padded with extra fields", () => {
    const request = buildSyncRequest({
      identityPrivateKey: identity.privateKey,
      identityPublicKeyPem: identity.publicKeyPem,
      hubDeviceId: HUB,
    });
    expect(
      verifyHubSyncRequest({ ...request, hubDeviceId: "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9" }),
    ).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
    const other = edKey();
    expect(
      verifyHubSyncRequest({ ...request, identityPublicKeyPem: other.publicKeyPem }),
    ).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
    const old = buildSyncRequest(
      {
        identityPrivateKey: identity.privateKey,
        identityPublicKeyPem: identity.publicKeyPem,
        hubDeviceId: HUB,
      },
      new Date(Date.now() - 3_600_000),
    );
    expect(verifyHubSyncRequest(old)).toMatchObject({ ok: false, code: "STALE" });
    expect(verifyHubSyncRequest({ ...request, extra: 1 })).toMatchObject({
      ok: false,
      code: "MALFORMED",
    });
    expect(
      verifyHubSyncRequest({ ...request, kind: "kitluy.device-runtime-report.v2" }),
    ).toMatchObject({ ok: false, code: "WRONG_KIND" });
  });
});

describe("the producer's envelope, at the Hub", () => {
  const { signer, record } = producerSigner();
  const trust = loadHubSyncTrust(writeTrust(record), "development");
  if (!trust.ok) throw new Error("fixture trust did not load");
  const nonce = randomBytes(16).toString("hex");
  const expect_ = { nonce, hubDeviceId: HUB, scope: SCOPE };

  it("is applied when signed by the trusted key, for this request, this Hub, this scope", () => {
    const { body } = buildSignedEnvelope(doorAnswer(), nonce, signer);
    const verified = verifySyncEnvelope(body, trust.trust, expect_);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.envelope.hubAssetTag).toBe("KL-CFADA8C75001");
    expect(verified.envelope.deliveries).toHaveLength(1);
    const d = verified.envelope.deliveries[0]!;
    expect(d.terminalName).toBe("KL-54A3320E1201");
    expect(d.x509CertificateSerial).toBe("1bacc7bf573feb35");
    expect(d.profileCodes).toEqual(["laundry.t2.customer_display", "laundry.t1.intake_cashier"]);
    expect(d.tenantId).toBe(SCOPE.tenantId);
  });

  it("refuses a tampered payload, an unknown key, another request's nonce, another Hub, another scope, a stale answer", () => {
    const { body } = buildSignedEnvelope(doorAnswer(), nonce, signer);
    const tampered = JSON.parse(JSON.stringify(body));
    tampered.envelope.terminals[0].profileCodes = [
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
    ];
    expect(verifySyncEnvelope(tampered, trust.trust, expect_)).toMatchObject({
      ok: false,
      refusal: "ENVELOPE_SIGNATURE_INVALID",
    });

    const stranger = producerSigner().signer;
    expect(
      verifySyncEnvelope(
        buildSignedEnvelope(doorAnswer(), nonce, stranger).body,
        trust.trust,
        expect_,
      ),
    ).toMatchObject({ ok: false, refusal: "ENVELOPE_UNKNOWN_KEY" });
    // Same keyId claimed, different key: the signature is what decides.
    const forged = buildSignedEnvelope(doorAnswer(), nonce, {
      ...stranger,
      keyId: signer.keyId,
      keyVersion: 1,
    }).body;
    expect(verifySyncEnvelope(forged, trust.trust, expect_)).toMatchObject({
      ok: false,
      refusal: "ENVELOPE_SIGNATURE_INVALID",
    });

    expect(
      verifySyncEnvelope(
        buildSignedEnvelope(doorAnswer(), randomBytes(16).toString("hex"), signer).body,
        trust.trust,
        expect_,
      ),
    ).toMatchObject({ ok: false, refusal: "ENVELOPE_NONCE_MISMATCH" });

    const otherHub = doorAnswer();
    otherHub.hub.deviceId = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
    expect(
      verifySyncEnvelope(buildSignedEnvelope(otherHub, nonce, signer).body, trust.trust, expect_),
    ).toMatchObject({ ok: false, refusal: "ENVELOPE_NOT_FOR_THIS_HUB" });

    const otherScope = doorAnswer();
    otherScope.hub.storeLocationId = "00000000-0000-4000-8000-000000000019";
    expect(
      verifySyncEnvelope(buildSignedEnvelope(otherScope, nonce, signer).body, trust.trust, expect_),
    ).toMatchObject({ ok: false, refusal: "ENVELOPE_WRONG_SCOPE" });

    const stale = buildSignedEnvelope(
      doorAnswer(),
      nonce,
      signer,
      new Date(Date.now() - 3_600_000),
    ).body;
    expect(verifySyncEnvelope(stale, trust.trust, expect_)).toMatchObject({
      ok: false,
      refusal: "ENVELOPE_STALE",
    });
  });

  it("carries the catalog and the money contract, and refuses a malformed one outright", () => {
    const answer = doorAnswer();
    const withSections = {
      ...answer,
      catalog: {
        schema: "kitluy.config.catalog.v1",
        currency_code: "KHR",
        content_hash: "a".repeat(64),
        families: [],
        categories: [],
        services: [],
        garment_types: [],
      },
      money: { schema: "kitluy.config.money.v1", currency_code: "KHR", currency_exponent: 0 },
    };
    const ok = verifySyncEnvelope(
      buildSignedEnvelope(withSections, nonce, signer).body,
      trust.trust,
      expect_,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.envelope.catalog?.content_hash).toBe("a".repeat(64));
      expect(ok.envelope.money?.currency_exponent).toBe(0);
    }
    const none = verifySyncEnvelope(
      buildSignedEnvelope(answer, nonce, signer).body,
      trust.trust,
      expect_,
    );
    expect(none.ok && none.envelope.catalog === null && none.envelope.money === null).toBe(true);
    const badCatalog = verifySyncEnvelope(
      buildSignedEnvelope(
        { ...withSections, catalog: { ...withSections.catalog, content_hash: "nope" } },
        nonce,
        signer,
      ).body,
      trust.trust,
      expect_,
    );
    expect(badCatalog).toMatchObject({
      ok: false,
      refusal: "ENVELOPE_MALFORMED",
      detail: "catalog",
    });
    const badMoney = verifySyncEnvelope(
      buildSignedEnvelope(
        { ...withSections, money: { schema: "kitluy.config.money.v1", currency_code: "KHR" } },
        nonce,
        signer,
      ).body,
      trust.trust,
      expect_,
    );
    expect(badMoney).toMatchObject({ ok: false, refusal: "ENVELOPE_MALFORMED", detail: "money" });
  });

  it("keeps the well-formed deliveries and names the malformed ones", () => {
    const rows = [doorRow(), doorRow({ device_id: "not-a-uuid", asset_tag: "KL-BROKEN" })];
    const { body } = buildSignedEnvelope(doorAnswer(rows), nonce, signer);
    const verified = verifySyncEnvelope(body, trust.trust, expect_);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.envelope.deliveries.map((d) => d.terminalName)).toEqual(["KL-54A3320E1201"]);
    expect(verified.envelope.malformed).toEqual([
      "KL-BROKEN: terminalDeviceId is missing or malformed",
    ]);
  });
});

describe("the producer's serial handling", () => {
  it("strips the DER pad from a column-only serial and prefers the certificate", () => {
    expect(
      x509SerialOf({ certificate_pem: null, certificate_x509_serial: "00fdbd5903f042a08f" }),
    ).toBe("fdbd5903f042a08f");
    expect(
      x509SerialOf({ certificate_pem: null, certificate_x509_serial: "1bacc7bf573feb35" }),
    ).toBe("1bacc7bf573feb35");
    const pem = selfSignedPem("terminal");
    const fromPem = x509SerialOf({ certificate_pem: pem, certificate_x509_serial: "00" });
    expect(fromPem).toMatch(/^3f[0-9a-f]{14}$/u);
    expect(x509SerialOf({ certificate_pem: null, certificate_x509_serial: null })).toBeNull();
  });
});

describe("a terminal delivery parses against its closed shape", () => {
  const good = buildSignedEnvelope(doorAnswer(), "0".repeat(32), producerSigner().signer).body
    .envelope.terminals[0];

  it("accepts the producer's delivery and lowercases identifiers", () => {
    const parsed = parseTerminalDelivery({
      ...good,
      terminalDeviceId: good.terminalDeviceId.toUpperCase(),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.delivery.terminalDeviceId).toBe(good.terminalDeviceId);
  });

  it("refuses a bad profile, an empty window, a DER-padded serial in the wrong alphabet, and a wrong kind", () => {
    expect(parseTerminalDelivery({ ...good, profileCodes: ["T1"] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("profileCodes"),
    });
    expect(parseTerminalDelivery({ ...good, expiresAt: good.issuedAt })).toMatchObject({
      ok: false,
      reason: "the credential window is empty",
    });
    expect(parseTerminalDelivery({ ...good, x509CertificateSerial: "0X1BAC" })).toMatchObject({
      ok: false,
    });
    expect(
      parseTerminalDelivery({ ...good, kind: "device.terminal_credential_projected" }),
    ).toMatchObject({ ok: false, reason: "wrong delivery kind" });
    expect(parseTerminalDelivery({ ...good, identityKeyFingerprint: "short" })).toMatchObject({
      ok: false,
    });
  });
});

describe("what the board holds", () => {
  it("is read from the pairing state, the identity key, the certificate and the serial", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-hub-board-"));
    const identity = edKey();
    mkdirSync(join(dir, "identity"));
    writeFileSync(join(dir, "identity", "device-identity.key.pem"), identity.privateKeyPem, {
      mode: 0o600,
    });
    writeFileSync(
      join(dir, "pairing-state.json"),
      JSON.stringify({
        phase: "PAIRED",
        deviceRecordId: HUB,
        assignmentId: "7fd8b688-fb7e-4d92-a906-89d9e25ad513",
        assignmentGeneration: 5,
        ...SCOPE,
        updatedAt: "x",
      }),
    );
    writeFileSync(join(dir, "operational-tls.crt.pem"), selfSignedPem("hub"));
    writeFileSync(join(dir, "serial-number"), "10000000abcdef01\0");
    const facts = readBoardFacts({
      pairingStatePath: join(dir, "pairing-state.json"),
      identityKeyPath: join(dir, "identity", "device-identity.key.pem"),
      operationalCertificatePath: join(dir, "operational-tls.crt.pem"),
      boardSerialPath: join(dir, "serial-number"),
    });
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    expect(facts.facts.self).toMatchObject({
      hubDeviceId: HUB,
      assignmentGeneration: 5,
      boardSerial: "10000000abcdef01",
      scope: SCOPE,
    });
    expect(facts.facts.identityPublicKeyPem).toBe(identity.publicKeyPem);
    // The private key object never leaves as text.
    expect(JSON.stringify(facts.facts.self)).not.toContain("PRIVATE KEY");
  });

  it("refuses an unpaired Hub and a board without an identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-hub-board-"));
    writeFileSync(
      join(dir, "pairing-state.json"),
      JSON.stringify({ phase: "CODE_REQUIRED", updatedAt: "x" }),
    );
    const unpaired = readBoardFacts({
      pairingStatePath: join(dir, "pairing-state.json"),
      identityKeyPath: join(dir, "k"),
      operationalCertificatePath: join(dir, "c"),
      boardSerialPath: join(dir, "s"),
    });
    expect(unpaired).toMatchObject({ ok: false, reason: expect.stringContaining("not PAIRED") });
    writeFileSync(
      join(dir, "pairing-state.json"),
      JSON.stringify({
        phase: "PAIRED",
        deviceRecordId: HUB,
        assignmentId: HUB,
        ...SCOPE,
        updatedAt: "x",
      }),
    );
    expect(
      readBoardFacts({
        pairingStatePath: join(dir, "pairing-state.json"),
        identityKeyPath: join(dir, "k"),
        operationalCertificatePath: join(dir, "c"),
        boardSerialPath: join(dir, "s"),
      }),
    ).toMatchObject({ ok: false, reason: "no device identity key on this board" });
  });
});

describe("the configuration from the unit environment", () => {
  it("is disabled without HUB_SYNC_URL and normalises the rest", () => {
    expect(terminalSyncConfigFromEnv({})).toMatchObject({ disabled: "HUB_SYNC_URL is not set" });
    expect(terminalSyncConfigFromEnv({ HUB_SYNC_URL: "ftp://x" })).toMatchObject({
      disabled: "HUB_SYNC_URL must be http or https",
    });
    const c = terminalSyncConfigFromEnv({
      HUB_SYNC_URL: "http://172.16.21.17:8792/anything",
      KITLUY_ENVIRONMENT: "development",
      HUB_SYNC_INTERVAL_SECONDS: "3",
    });
    expect("config" in c && c.config).toMatchObject({
      url: "http://172.16.21.17:8792",
      environment: "development",
      intervalSeconds: 60,
      trustPath: "/etc/kitluy/hub-sync-trust.json",
    });
  });
});

describe("one sync pass turns every failure into a coded outcome", () => {
  function boardDir() {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-hub-sync-"));
    const identity = edKey();
    writeFileSync(join(dir, "id.pem"), identity.privateKeyPem, { mode: 0o600 });
    writeFileSync(
      join(dir, "pairing-state.json"),
      JSON.stringify({
        phase: "PAIRED",
        deviceRecordId: HUB,
        assignmentId: "7fd8b688-fb7e-4d92-a906-89d9e25ad513",
        assignmentGeneration: 5,
        ...SCOPE,
        updatedAt: "x",
      }),
    );
    writeFileSync(join(dir, "cert.pem"), selfSignedPem("hub"));
    writeFileSync(join(dir, "serial"), "10000000abcdef01");
    return { dir, identity };
  }
  function config(dir: string, trustPath: string, environment = "development"): TerminalSyncConfig {
    return {
      url: "http://producer.test",
      environment,
      trustPath,
      statePath: join(dir, "state", "terminal-sync.json"),
      identityKeyPath: join(dir, "id.pem"),
      pairingStatePath: join(dir, "pairing-state.json"),
      operationalCertificatePath: join(dir, "cert.pem"),
      boardSerialPath: join(dir, "serial"),
      intervalSeconds: 60,
    };
  }
  const neverPool = {
    connect: () => {
      throw new Error("the database was reached on a pass that should have refused first");
    },
  } as never;
  const quiet = { info: () => undefined, warn: () => undefined };

  it("refuses outside development before touching anything", async () => {
    const { dir } = boardDir();
    const out = await runTerminalSyncOnce({
      pool: neverPool,
      config: config(dir, "/nonexistent", "pilot"),
      log: quiet,
    });
    expect(out).toMatchObject({ kind: "refused", code: "SYNC_ENVIRONMENT" });
  });

  it("refuses without a trust record, reports an unreachable producer, and a producer refusal by code", async () => {
    const { dir } = boardDir();
    expect(
      await runTerminalSyncOnce({
        pool: neverPool,
        config: config(dir, join(dir, "missing.json")),
        log: quiet,
      }),
    ).toMatchObject({ kind: "refused", code: "TRUST_RECORD_MISSING" });
    const { record } = producerSigner();
    const trustPath = writeTrust(record);
    const down = await runTerminalSyncOnce({
      pool: neverPool,
      config: config(dir, trustPath),
      log: quiet,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(down).toMatchObject({ kind: "unreachable", detail: "ECONNREFUSED" });
    const refused = await runTerminalSyncOnce({
      pool: neverPool,
      config: config(dir, trustPath),
      log: quiet,
      fetchImpl: async () => ({ status: 403, json: async () => ({ code: "REFUSED" }) }),
    });
    expect(refused).toMatchObject({ kind: "refused", code: "PRODUCER_REFUSED" });
  });

  it("refuses an answer signed by a key it does not trust, and posts a request the producer can verify", async () => {
    const { dir } = boardDir();
    const trusted = producerSigner();
    const stranger = producerSigner();
    let posted: unknown;
    const out = await runTerminalSyncOnce({
      pool: neverPool,
      config: config(dir, writeTrust(trusted.record)),
      log: quiet,
      fetchImpl: async (_url, init) => {
        posted = JSON.parse(init.body);
        const verdict = verifyHubSyncRequest(posted);
        if (!verdict.ok) throw new Error(`the producer refused the Hub's request: ${verdict.code}`);
        return {
          status: 200,
          json: async () => buildSignedEnvelope(doorAnswer(), verdict.nonce, stranger.signer).body,
        };
      },
    });
    expect(out).toMatchObject({ kind: "refused", code: "ENVELOPE_UNKNOWN_KEY" });
    expect(posted).toMatchObject({ kind: HUB_SYNC_REQUEST_KIND, hubDeviceId: HUB });
    expect(JSON.stringify(posted)).not.toContain("PRIVATE KEY");
  });
});
