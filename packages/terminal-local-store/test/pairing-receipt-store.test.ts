/**
 * TERMINAL PAIRING-RECEIPT PERSISTENCE — WS-11-T004-P04C2.
 *
 * Runs against a REAL SQLite database through the shipped Electron T1-T4
 * driver (`node:sqlite`) — an in-memory database where restart is not being
 * modelled, and a real FILE where it is, because "reopen the same bytes from
 * disk" is the whole claim of the restart scenarios.
 *
 * Real Ed25519 keys and the real `@kitluy/device-identity` receipt verifier
 * play the Hub; nothing about the signature path is stubbed.
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  pairingReceiptBytes,
  publicKeyFingerprint,
  PAIRING_PROTOCOL_VERSION,
  type PairingReceipt,
  type ReceiptExpectation,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { createSqliteDriver } from "../src/driver.js";
import {
  PairingReceiptStore,
  TerminalPairingStoreError,
  assertNoForbiddenMaterial,
  type OperationalEligibility,
  type ReceiptInstallationContext,
} from "../src/pairing-receipt-store.js";
import {
  inMemorySecureKeyStore,
  osProtectedSecureKeyStore,
  unavailableSecureKeyStore,
  type OsEncryptionFacility,
} from "../src/secure-key-store.js";

/**
 * `node:sqlite` is loaded through `createRequire` rather than a static import:
 * this repository's Vite predates the builtin and rewrites `node:sqlite` to a
 * bare `sqlite` it then cannot find. `createRequire` hands the specifier
 * straight to Node, which is the runtime that owns it. The PRODUCTION path is
 * unaffected — `createSqliteDriver` takes an injected database and this package
 * never imports `node:sqlite` itself.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
    close(): void;
  };
};

const ENV: TrustEnvironment = "development";
const T1 = "laundry.t1.intake_cashier";
const keys = new DevelopmentDeviceKeyProvider();
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-terminal-store-"));
  temporaryDirectories.push(dir);
  return dir;
}

interface Harness {
  readonly store: PairingReceiptStore;
  readonly hubPem: string;
  readonly signReceipt: (receipt: PairingReceipt) => string;
  readonly receipt: (over?: Partial<PairingReceipt>) => PairingReceipt;
  readonly expectation: (receipt: PairingReceipt) => ReceiptExpectation;
  readonly context: ReceiptInstallationContext;
  readonly close: () => void;
}

function harness(options: { file?: string; seed?: Uint8Array } = {}): Harness {
  const database = new DatabaseSync(options.file ?? ":memory:");
  const driver = createSqliteDriver(database);
  const keyStore = inMemorySecureKeyStore(options.seed ?? Buffer.from("fixed-test-seed"));
  const store = new PairingReceiptStore(driver, keyStore);

  const hubRef = `hub-${randomUUID().slice(0, 8)}`;
  keys.generateDeviceKey(hubRef, ENV);
  const hubPem = keys.publicKeyPem(hubRef) ?? "";
  const terminalRef = `terminal-${randomUUID().slice(0, 8)}`;
  keys.generateDeviceKey(terminalRef, ENV);
  const terminalPem = keys.publicKeyPem(terminalRef) ?? "";

  const scope = {
    hubDeviceId: randomUUID(),
    terminalDeviceId: randomUUID(),
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
  };

  const receipt = (over: Partial<PairingReceipt> = {}): PairingReceipt => ({
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
    terminalProfileKey: T1,
    pairedAt: new Date("2026-08-05T10:00:00.000Z"),
    validUntil: null,
    correlationId: randomUUID(),
    ...over,
  });

  return {
    store,
    hubPem,
    signReceipt: (r) =>
      Buffer.from(keys.provePossession(hubRef, pairingReceiptBytes(r))).toString("base64"),
    receipt,
    expectation: (r) => ({
      pairingSessionId: r.pairingSessionId,
      transcriptHash: r.transcriptHash,
      hubDeviceId: r.hubDeviceId,
      hubCertificateFingerprint: r.hubCertificateFingerprint,
      terminalDeviceId: r.terminalDeviceId,
      terminalCertificateFingerprint: r.terminalCertificateFingerprint,
      tenantId: r.tenantId,
      digitalStoreId: r.digitalStoreId,
      storeLocationId: r.storeLocationId,
      environment: r.environment,
      terminalAssignmentGeneration: r.terminalAssignmentGeneration,
      terminalProfileKey: r.terminalProfileKey,
    }),
    context: { terminalAssignmentId: randomUUID(), activationId: randomUUID() },
    close: () => driver.close(),
  };
}

function eligibilityFor(
  stored: {
    hubDeviceId: string;
    hubCertificateFingerprint: string;
    terminalCertificateFingerprint: string;
    terminalAssignmentId: string;
    terminalAssignmentGeneration: number;
    terminalProfileKey: string;
  },
  over: Partial<OperationalEligibility> = {},
): OperationalEligibility {
  return {
    hubDeviceId: stored.hubDeviceId,
    hubCertificateFingerprint: stored.hubCertificateFingerprint,
    terminalCertificateFingerprint: stored.terminalCertificateFingerprint,
    terminalAssignmentId: stored.terminalAssignmentId,
    terminalAssignmentGeneration: stored.terminalAssignmentGeneration,
    terminalProfileKey: stored.terminalProfileKey,
    terminalCredentialStatus: "active",
    hubCredentialStatus: "active",
    ...over,
  };
}

describe("terminal pairing-receipt persistence (P04C2)", () => {
  it("verifies before persisting, and stores every §19 field", () => {
    const h = harness();
    const receipt = h.receipt();
    const stored = h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date("2026-08-05T10:00:05.000Z"),
    });

    expect(stored.receiptId).toBe(receipt.receiptId);
    expect(stored.protocolVersion).toBe(PAIRING_PROTOCOL_VERSION);
    expect(stored.pairingSessionId).toBe(receipt.pairingSessionId);
    expect(stored.hubDeviceId).toBe(receipt.hubDeviceId);
    expect(stored.hubCertificateFingerprint).toBe(receipt.hubCertificateFingerprint);
    expect(stored.terminalCertificateFingerprint).toBe(receipt.terminalCertificateFingerprint);
    expect(stored.terminalAssignmentId).toBe(h.context.terminalAssignmentId);
    expect(stored.terminalAssignmentGeneration).toBe(1);
    expect(stored.terminalProfileKey).toBe(T1);
    expect(stored.activationId).toBe(h.context.activationId);
    expect(stored.transcriptHash).toBe(receipt.transcriptHash);
    expect(stored.hubReceiptSignatureBase64.length).toBeGreaterThan(0);
    expect(stored.pairedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(stored.verifiedAt).toBe("2026-08-05T10:00:05.000Z");
    expect(stored.lifecycleState).toBe("current");
    expect(stored.supersededByReceiptId).toBeNull();
    h.close();
  });

  it("refuses a wrong Hub signature, an altered transcript and a transplanted scope", () => {
    const h = harness();
    const receipt = h.receipt();
    const good = h.signReceipt(receipt);

    // Wrong signer.
    const impostor = `impostor-${randomUUID().slice(0, 8)}`;
    keys.generateDeviceKey(impostor, ENV);
    expect(() =>
      h.store.persistVerifiedReceipt({
        receipt,
        hubReceiptSignatureBase64: Buffer.from(
          keys.provePossession(impostor, pairingReceiptBytes(receipt)),
        ).toString("base64"),
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(receipt),
        context: h.context,
        at: new Date(),
      }),
    ).toThrow(TerminalPairingStoreError);

    // Altered transcript: the signature was made over the original bytes.
    const altered = { ...receipt, transcriptHash: "f".repeat(64) };
    expect(() =>
      h.store.persistVerifiedReceipt({
        receipt: altered,
        hubReceiptSignatureBase64: good,
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(altered),
        context: h.context,
        at: new Date(),
      }),
    ).toThrow(TerminalPairingStoreError);

    // Correct signature, but the terminal expected another scope.
    expect(() =>
      h.store.persistVerifiedReceipt({
        receipt,
        hubReceiptSignatureBase64: good,
        hubPublicKeyPem: h.hubPem,
        expectation: { ...h.expectation(receipt), tenantId: randomUUID() },
        context: h.context,
        at: new Date(),
      }),
    ).toThrow(TerminalPairingStoreError);

    // Nothing reached disk.
    expect(h.store.history()).toHaveLength(0);
    expect(
      h.store.loadVerifiedCurrentReceipt({
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(receipt),
        at: new Date(),
      }),
    ).toBeNull();
    h.close();
  });

  it("a process restart reloads the receipt from disk and re-verifies it", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const seed = Buffer.from("restart-seed");

    const first = harness({ file, seed });
    const receipt = first.receipt();
    const signature = first.signReceipt(receipt);
    const expectation = first.expectation(receipt);
    first.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: signature,
      hubPublicKeyPem: first.hubPem,
      expectation,
      context: first.context,
      at: new Date("2026-08-05T10:00:05.000Z"),
    });
    // Process death: every handle to the database is closed.
    first.close();

    // A FRESH process opens the same bytes with the same OS-protected key.
    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const reopened = new PairingReceiptStore(driver, inMemorySecureKeyStore(seed));
    const loaded = reopened.loadVerifiedCurrentReceipt({
      hubPublicKeyPem: first.hubPem,
      expectation,
      at: new Date("2026-08-05T11:00:00.000Z"),
    });
    expect(loaded?.receiptId).toBe(receipt.receiptId);
    expect(loaded?.pairedAt, "a restart never moves paired_at").toBe("2026-08-05T10:00:00.000Z");
    expect(loaded?.verifiedAt, "nor the original verification instant").toBe(
      "2026-08-05T10:00:05.000Z",
    );
    driver.close();
  });

  it("a store opened with the wrong key is CORRUPT — not silently empty", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const h = harness({ file, seed: Buffer.from("right-key") });
    const receipt = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date(),
    });
    h.close();

    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const wrongKey = new PairingReceiptStore(driver, inMemorySecureKeyStore(Buffer.from("wrong")));
    // The blind index differs, so the pointer resolves to nothing rather than
    // to a row it cannot open — either way the terminal is NOT paired, and it
    // can never read a receipt sealed under another key.
    expect(() => wrongKey.history()).toThrow(TerminalPairingStoreError);
    driver.close();
  });

  it("a tampered sealed row fails closed rather than returning a partial receipt", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const seed = Buffer.from("tamper-seed");
    const h = harness({ file, seed });
    const receipt = h.receipt();
    const expectation = h.expectation(receipt);
    h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation,
      context: h.context,
      at: new Date(),
    });
    h.close();

    // An attacker with raw file access can drop SQLite's own guard, so the
    // tamper is applied AFTER dropping it — the point of this scenario is that
    // the SEAL still catches the alteration when the database's protection has
    // already been bypassed.
    const raw = new DatabaseSync(file);
    try {
      raw.exec(`drop trigger pairing_receipts_immutable`);
      const row = raw.prepare(`select receipt_key, record from pairing_receipts`).all()[0] as {
        receipt_key: string;
        record: string;
      };
      const flipped =
        row.record.slice(0, -2) + (row.record.at(-2) === "A" ? "B" : "A") + row.record.at(-1);
      raw
        .prepare(`update pairing_receipts set record = ? where receipt_key = ?`)
        .run(flipped, row.receipt_key);
    } finally {
      raw.close();
    }

    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const store = new PairingReceiptStore(driver, inMemorySecureKeyStore(seed));
    expect(() =>
      store.loadVerifiedCurrentReceipt({
        hubPublicKeyPem: h.hubPem,
        expectation,
        at: new Date(),
      }),
    ).toThrow(/NOT paired/);
    driver.close();
  });

  it("a replacement supersedes its predecessor and the history stays immutable", () => {
    const h = harness();
    const first = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt: first,
      hubReceiptSignatureBase64: h.signReceipt(first),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(first),
      context: h.context,
      at: new Date("2026-08-05T10:00:00.000Z"),
    });
    const second = h.receipt({ terminalAssignmentGeneration: 2 });
    const storedSecond = h.store.persistVerifiedReceipt({
      receipt: second,
      hubReceiptSignatureBase64: h.signReceipt(second),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(second),
      context: h.context,
      at: new Date("2026-08-05T12:00:00.000Z"),
    });

    const history = h.store.history();
    expect(history).toHaveLength(2);
    expect(history[0]?.receiptId, "the predecessor is retained, not overwritten").toBe(
      first.receiptId,
    );
    expect(history[0]?.lifecycleState).toBe("superseded");
    expect(history[0]?.supersededByReceiptId).toBe(second.receiptId);
    expect(history[0]?.pairedAt, "the predecessor's paired_at is untouched").toBe(
      "2026-08-05T10:00:00.000Z",
    );
    expect(history[1]?.lifecycleState).toBe("current");

    const current = h.store.loadVerifiedCurrentReceipt({
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(second),
      at: new Date(),
    });
    expect(current?.receiptId).toBe(storedSecond.receiptId);
    // The predecessor is still findable by its own session id.
    expect(h.store.findBySessionId(first.pairingSessionId)?.receiptId).toBe(first.receiptId);
    h.close();
  });

  it("the same receipt again returns the original evidence — no second row, no moved instants", () => {
    const h = harness();
    const receipt = h.receipt();
    const signature = h.signReceipt(receipt);
    const expectation = h.expectation(receipt);
    const first = h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: signature,
      hubPublicKeyPem: h.hubPem,
      expectation,
      context: h.context,
      at: new Date("2026-08-05T10:00:05.000Z"),
    });
    const replay = h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: signature,
      hubPublicKeyPem: h.hubPem,
      expectation,
      context: h.context,
      at: new Date("2026-08-05T13:00:00.000Z"),
    });
    expect(replay).toEqual(first);
    expect(replay.verifiedAt, "a lost response never moves verified_at").toBe(
      "2026-08-05T10:00:05.000Z",
    );
    expect(h.store.history()).toHaveLength(1);
    h.close();
  });

  it("the receipt row and the current pointer move atomically", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const seed = Buffer.from("atomic-seed");
    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const store = new PairingReceiptStore(driver, inMemorySecureKeyStore(seed));
    const h = harness({ seed });
    const receipt = h.receipt();

    // A fault injected between the row insert and the pointer update must
    // leave NEITHER: SQLite rolls the whole transaction back.
    const original = driver.run.bind(driver);
    let calls = 0;
    driver.run = (sql, params) => {
      calls += 1;
      if (calls === 2) throw new Error("injected fault after the receipt insert");
      original(sql, params);
    };
    expect(() =>
      store.persistVerifiedReceipt({
        receipt,
        hubReceiptSignatureBase64: h.signReceipt(receipt),
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(receipt),
        context: h.context,
        at: new Date(),
      }),
    ).toThrow(/injected fault/);
    driver.run = original;

    expect(store.history(), "the rolled-back receipt left no row").toHaveLength(0);
    expect(
      store.loadVerifiedCurrentReceipt({
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(receipt),
        at: new Date(),
      }),
      "and no dangling current pointer",
    ).toBeNull();
    driver.close();
    h.close();
  });

  it("SQLite itself refuses to rewrite or delete stored history", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const seed = Buffer.from("immutable-seed");
    const h = harness({ file, seed });
    const receipt = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date(),
    });
    h.close();

    const raw = new DatabaseSync(file);
    expect(() => raw.prepare(`update pairing_receipts set record = 'x'`).run()).toThrow(
      /KLUY-TERMINAL-STORE-IMMUTABLE/,
    );
    expect(() => raw.prepare(`update pairing_receipts set hub_signature = 'x'`).run()).toThrow(
      /KLUY-TERMINAL-STORE-IMMUTABLE/,
    );
    expect(() => raw.prepare(`delete from pairing_receipts`).run()).toThrow(
      /KLUY-TERMINAL-STORE-IMMUTABLE/,
    );
    raw.close();
  });

  it("startup revalidates the Hub, the assignment and both credentials", () => {
    const h = harness();
    const receipt = h.receipt();
    const stored = h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date(),
    });

    expect(h.store.authorizeOperationalUse(stored, eligibilityFor(stored)).authorized).toBe(true);
    // A verified receipt is EVIDENCE, not a standing authorization (§11).
    for (const [over, code] of [
      [{ hubDeviceId: randomUUID() }, "PAIR_HUB_CHANGED"],
      [{ hubCertificateFingerprint: "0".repeat(64) }, "PAIR_HUB_CHANGED"],
      [{ terminalCertificateFingerprint: "1".repeat(64) }, "PAIR_CREDENTIAL_CHANGED"],
      [{ terminalAssignmentGeneration: 2 }, "PAIR_ASSIGNMENT_MISMATCH"],
      [{ terminalAssignmentId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
      [{ terminalProfileKey: "laundry.t3.ready_scan_in" }, "PAIR_ASSIGNMENT_MISMATCH"],
      [{ terminalCredentialStatus: "revoked" }, "PAIR_DEVICE_NOT_ELIGIBLE"],
      [{ hubCredentialStatus: "revoked" }, "PAIR_HUB_NOT_ACTIVE"],
    ] as const) {
      const verdict = h.store.authorizeOperationalUse(stored, eligibilityFor(stored, over));
      expect(verdict.authorized, JSON.stringify(over)).toBe(false);
      expect(verdict.refusalCode).toBe(code);
    }
    // A superseded receipt never authorizes, whatever eligibility says.
    const superseded = { ...stored, lifecycleState: "superseded" as const };
    expect(h.store.authorizeOperationalUse(superseded, eligibilityFor(stored)).refusalCode).toBe(
      "PAIR_RECEIPT_SUPERSEDED",
    );
    h.close();
  });

  it("nonces, proof signatures, provisioning codes, private keys and DSNs cannot be persisted", () => {
    const h = harness();
    const receipt = h.receipt();
    const stored = h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date(),
    });
    // What WAS stored is clean.
    expect(() => assertNoForbiddenMaterial(stored)).not.toThrow();
    expect(JSON.stringify(stored)).not.toMatch(/nonce/i);

    for (const forbidden of [
      { terminalNonce: "ab".repeat(32) },
      { hub_nonce: "cd".repeat(32) },
      { proofSignature: "zzz" },
      { provisioningCode: "ABCD-1234" },
      { privateKeyPem: "x" },
      { blob: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----" },
      { note: "postgres://user:pw@host/db" },
    ]) {
      expect(
        () => assertNoForbiddenMaterial({ ...stored, ...forbidden }),
        JSON.stringify(forbidden),
      ).toThrow(/FORBIDDEN-MATERIAL/);
    }
    h.close();
  });

  it("the database file carries no plaintext receipt values", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const h = harness({ file, seed: Buffer.from("plaintext-seed") });
    const receipt = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: h.signReceipt(receipt),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(receipt),
      context: h.context,
      at: new Date(),
    });
    h.close();

    const bytes = readFileSync(file).toString("latin1");
    // Identifiers, fingerprints, the transcript hash, the profile and the
    // signature are all sealed — the file's only cleartext is the schema.
    for (const secret of [
      receipt.receiptId,
      receipt.pairingSessionId,
      receipt.transcriptHash,
      receipt.hubDeviceId,
      receipt.terminalDeviceId,
      receipt.tenantId,
      receipt.hubCertificateFingerprint,
      receipt.terminalProfileKey,
      receipt.correlationId,
    ]) {
      expect(bytes, `${secret} must not appear in the file`).not.toContain(secret);
    }
    // The schema IS visible, and this package says so rather than pretending
    // otherwise: whole-file encryption is deployment material.
    expect(bytes).toContain("pairing_receipts");
  });

  it("key custody: the default refuses, and the OS adapter wraps rather than writes", () => {
    // The shipped default fails closed — no degraded, unencrypted fallback.
    expect(() => unavailableSecureKeyStore().getOrCreateDatabaseKey()).toThrow(
      /KLUY-TERMINAL-STORE-NO-KEY-CUSTODY/,
    );
    expect(unavailableSecureKeyStore().isAvailable()).toBe(false);

    // A facility that reports encryption unavailable also refuses.
    const dir = temporaryDir();
    const path = join(dir, "key.wrapped");
    const unavailableFacility: OsEncryptionFacility = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    };
    expect(() =>
      osProtectedSecureKeyStore(unavailableFacility, {
        read: () => null,
        write: () => undefined,
      }).getOrCreateDatabaseKey(),
    ).toThrow(/NO-KEY-CUSTODY/);

    // A working facility: only the WRAPPED form touches disk, and the key is
    // stable across "restarts" so sealed rows are never orphaned.
    let stored: Buffer | null = null;
    const facility: OsEncryptionFacility = {
      isEncryptionAvailable: () => true,
      // Stands in for DPAPI/Keychain: a transformation only the OS can undo.
      encryptString: (plain) => Buffer.from(`os:${plain}`, "utf8"),
      decryptString: (blob) => blob.toString("utf8").replace(/^os:/, ""),
    };
    const file = {
      read: () => stored,
      write: (wrapped: Buffer) => {
        stored = wrapped;
        writeFileSync(path, wrapped);
      },
    };
    const key = osProtectedSecureKeyStore(facility, file).getOrCreateDatabaseKey();
    expect(key).toHaveLength(32);
    const reopened = osProtectedSecureKeyStore(facility, file).getOrCreateDatabaseKey();
    expect(Buffer.from(reopened).equals(Buffer.from(key))).toBe(true);
    // The plaintext key is never on disk.
    expect(readFileSync(path).toString("latin1")).not.toContain(
      Buffer.from(key).toString("latin1"),
    );

    // A corrupt wrapped key fails closed rather than regenerating over rows.
    expect(() =>
      osProtectedSecureKeyStore(facility, {
        read: () => Buffer.from("os:short", "utf8"),
        write: () => undefined,
      }).getOrCreateDatabaseKey(),
    ).toThrow(/KEY-CORRUPT/);
  });

  it("a sealed value cannot be moved between columns or rows", () => {
    const dir = temporaryDir();
    const file = join(dir, "terminal.sqlite");
    const seed = Buffer.from("aad-seed");
    const h = harness({ file, seed });
    const first = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt: first,
      hubReceiptSignatureBase64: h.signReceipt(first),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(first),
      context: h.context,
      at: new Date(),
    });
    const second = h.receipt();
    h.store.persistVerifiedReceipt({
      receipt: second,
      hubReceiptSignatureBase64: h.signReceipt(second),
      hubPublicKeyPem: h.hubPem,
      expectation: h.expectation(second),
      context: h.context,
      at: new Date(),
    });
    h.close();

    const raw = new DatabaseSync(file);
    try {
      // Same premise as the tamper scenario: SQLite's guard is dropped first,
      // so what is being tested is the SEAL. Row 1's sealed record is pasted
      // into row 2 — both ciphertexts are authentic under the same key, and
      // only the AAD binding to the ROW makes the paste fail.
      raw.exec(`drop trigger pairing_receipts_immutable`);
      const rows = raw
        .prepare(`select receipt_key, record from pairing_receipts order by row_no`)
        .all() as Array<{ receipt_key: string; record: string }>;
      raw
        .prepare(`update pairing_receipts set record = ? where receipt_key = ?`)
        .run(rows[0]!.record, rows[1]!.receipt_key);
    } finally {
      raw.close();
    }

    const database = new DatabaseSync(file);
    const driver = createSqliteDriver(database);
    const store = new PairingReceiptStore(driver, inMemorySecureKeyStore(seed));
    expect(() =>
      store.loadVerifiedCurrentReceipt({
        hubPublicKeyPem: h.hubPem,
        expectation: h.expectation(second),
        at: new Date(),
      }),
    ).toThrow(/NOT paired/);
    driver.close();
  });
});
