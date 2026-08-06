/**
 * TERMINAL CONFIGURATION-SNAPSHOT CACHE — WS-12-T001.
 *
 * Same harness discipline as the pairing-receipt suite: a real SQLite
 * database through the shipped driver, an in-memory database where restart
 * is not being modelled and a real file where it is.
 */
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteDriver } from "../src/driver.js";
import {
  ConfigurationSnapshotStore,
  TerminalConfigurationStoreError,
  type StoredConfigurationSnapshot,
} from "../src/configuration-snapshot-store.js";
import { inMemorySecureKeyStore } from "../src/secure-key-store.js";
import { TerminalStoreSealError } from "../src/sealing.js";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (path: string) => Parameters<typeof createSqliteDriver>[0];
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function record(version: number): StoredConfigurationSnapshot {
  const payloadJson = JSON.stringify({ locale: "km-KH", version });
  return {
    snapshot: {
      snapshotId: randomUUID(),
      configurationVersion: version,
      schemaVersion: 1,
      environment: "development",
      tenantId: randomUUID(),
      digitalStoreId: randomUUID(),
      storeLocationId: randomUUID(),
      hubDeviceId: randomUUID(),
      deviceRecordId: randomUUID(),
      assignmentGeneration: 1,
      terminalProfileCode: "laundry.t1.intake_cashier",
      minimumApplicationVersion: "0.1.0",
      maximumApplicationVersion: null,
      issuedAt: "2026-08-06T08:00:00.000Z",
      effectiveAt: "2026-08-06T08:00:00.000Z",
      validUntil: "2026-08-07T08:00:00.000Z",
      manifestSha256: "1".repeat(64),
      payloadSha256: "0".repeat(64),
      payloadJson,
      signerKeyId: "dev-config-signer-1",
      correlationId: randomUUID(),
      deliverySignature: Buffer.from(`sig-${version}`).toString("base64url"),
    },
    verifiedAt: "2026-08-06T09:00:00.000Z",
  };
}

function makeStore(file?: string, seed = "config-store-seed") {
  const driver = createSqliteDriver(new DatabaseSync(file ?? ":memory:"));
  const store = new ConfigurationSnapshotStore(driver, inMemorySecureKeyStore(Buffer.from(seed)));
  return { driver, store };
}

describe("terminal configuration-snapshot cache (WS-12-T001)", () => {
  it("persists a validated snapshot and loads it back intact", () => {
    const { driver, store } = makeStore();
    expect(store.loadCurrent()).toBeNull();
    const evidence = record(3);
    const stored = store.persistValidated(evidence);
    expect(stored.snapshot.configurationVersion).toBe(3);
    const loaded = store.loadCurrent();
    expect(loaded).toEqual(evidence);
    driver.close();
  });

  it("versions only move forward; a repeat of the current version is idempotent", () => {
    const { driver, store } = makeStore();
    store.persistValidated(record(5));
    store.persistValidated(record(6));
    expect(store.loadCurrent()?.snapshot.configurationVersion).toBe(6);
    // Same version again: evidence unchanged, no error.
    expect(store.persistValidated(record(6)).snapshot.configurationVersion).toBe(6);
    // Older version: refused, cache unchanged.
    expect(() => store.persistValidated(record(5))).toThrowError(TerminalConfigurationStoreError);
    try {
      store.persistValidated(record(5));
    } catch (error) {
      expect((error as TerminalConfigurationStoreError).code).toBe(
        "KLUY-TERMINAL-STORE-CONFIG-ROLLBACK",
      );
    }
    expect(store.loadCurrent()?.snapshot.configurationVersion).toBe(6);
    expect(store.history()).toEqual([5, 6]);
    driver.close();
  });

  it("a process restart reloads the cached snapshot from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-config-store-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const first = makeStore(file);
    first.store.persistValidated(record(9));
    first.driver.close();
    const second = makeStore(file);
    expect(second.store.loadCurrent()?.snapshot.configurationVersion).toBe(9);
    second.driver.close();
  });

  it("a store opened with the wrong key is CORRUPT, not silently empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-config-wrongkey-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const first = makeStore(file);
    first.store.persistValidated(record(2));
    first.driver.close();
    const second = makeStore(file, "a-different-seed");
    expect(() => second.store.loadCurrent()).toThrowError(TerminalStoreSealError);
    second.driver.close();
  });

  it("stored history is immutable at the database level", () => {
    const { driver, store } = makeStore();
    store.persistValidated(record(1));
    expect(() =>
      driver.run(`update configuration_snapshots set record = 'x' where configuration_version = 1`),
    ).toThrowError(/KLUY-TERMINAL-STORE-IMMUTABLE/);
    expect(() =>
      driver.run(`delete from configuration_snapshots where configuration_version = 1`),
    ).toThrowError(/KLUY-TERMINAL-STORE-IMMUTABLE/);
    driver.close();
  });

  it("forbidden material is refused and no plaintext reaches the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-config-plaintext-"));
    temporaryDirectories.push(dir);
    const file = join(dir, "terminal.sqlite");
    const { driver, store } = makeStore(file);
    const poisoned = {
      ...record(4),
      snapshot: {
        ...record(4).snapshot,
        payloadJson: JSON.stringify({ connectionString: "postgres://user@host/db" }),
      },
    };
    expect(() => store.persistValidated(poisoned)).toThrowError(
      /KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL/,
    );
    const clean = record(4);
    store.persistValidated(clean);
    driver.close();
    const bytes = readFileSync(file);
    expect(bytes.includes(Buffer.from(clean.snapshot.payloadJson))).toBe(false);
    expect(bytes.includes(Buffer.from(clean.snapshot.tenantId))).toBe(false);
  });
});
