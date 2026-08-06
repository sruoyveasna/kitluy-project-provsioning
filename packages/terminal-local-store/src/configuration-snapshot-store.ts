/**
 * Terminal-local signed-configuration cache — WS-12-T001.
 *
 * WHY THIS EXISTS. Owner package §6: after successful provisioning and at
 * least one valid configuration snapshot, T1 may start while WAN is
 * unavailable, using "the last valid signed configuration … with an explicit
 * freshness label". That sentence requires a DURABLE local record of the
 * last snapshot this terminal VERIFIED — no such contract existed anywhere
 * (the pairing-receipt store deliberately persists receipts only), which is
 * the executable evidence behind adding this module. It lives HERE because
 * this package is the terminal-local persistence authority: same driver,
 * same sealing, same key custody, same fail-closed discipline.
 *
 * WHAT THIS IS NOT. Not a source of configuration truth — the Hub's
 * `edge_config.configuration_snapshot` chain is. A cached snapshot is
 * EVIDENCE of a past verification; the runtime re-verifies it on every load
 * path before use and labels it as cached, never as current.
 *
 * Versions only move forward (mirrors `CONFIG_VERSION_ROLLBACK`): replaying
 * an older configuration is how a withdrawn price or permission comes back.
 */

import type { SqlValue, TerminalSqlDriver } from "./driver.js";
import type { SecureKeyStore } from "./secure-key-store.js";
import { deriveSealingKeys, open, seal, type SealingKeys } from "./sealing.js";
import { assertNoForbiddenMaterial } from "./pairing-receipt-store.js";

const TABLE = "configuration_snapshots";

/**
 * A signed configuration DELIVERY exactly as received (ISO instants) —
 * the full P02 delivery envelope, retained byte-exact so the terminal can
 * RE-VERIFY the Hub delivery signature on every load path. Field names
 * mirror `TerminalConfigurationDelivery` in `@kitluy/device-identity`
 * (`deviceRecordId` carries `terminalDeviceId`; `issuedAt` carries the
 * snapshot's issue instant, `effectiveAt` its activation window start).
 */
export interface SignedTerminalConfigurationRecord {
  readonly snapshotId: string;
  readonly configurationVersion: number;
  readonly schemaVersion: number;
  readonly environment: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly hubDeviceId: string;
  readonly deviceRecordId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
  readonly minimumApplicationVersion: string;
  readonly maximumApplicationVersion: string | null;
  readonly issuedAt: string;
  readonly effectiveAt: string;
  readonly validUntil: string;
  readonly manifestSha256: string;
  readonly payloadSha256: string;
  readonly payloadJson: string;
  readonly signerKeyId: string;
  readonly correlationId: string;
  /** The Hub operational key's DELIVERY signature (unpadded base64url). */
  readonly deliverySignature: string;
}

/** What is persisted: the snapshot plus when THIS terminal verified it. */
export interface StoredConfigurationSnapshot {
  readonly snapshot: SignedTerminalConfigurationRecord;
  readonly verifiedAt: string;
}

export class TerminalConfigurationStoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TerminalConfigurationStoreError";
  }
}

const SCHEMA = [
  `create table if not exists ${TABLE} (
     row_no                integer primary key autoincrement,
     configuration_version integer not null unique,
     record                text    not null,
     created_at            text    not null
   )`,
  `create table if not exists current_configuration_snapshot (
     singleton             integer primary key check (singleton = 1),
     configuration_version integer not null
   )`,
  // Snapshot history is immutable and append-only, enforced by the database
  // itself — the same discipline as the pairing-receipt tables.
  `create trigger if not exists configuration_snapshots_immutable
     before update on ${TABLE}
     for each row
     begin
       select raise(abort, 'KLUY-TERMINAL-STORE-IMMUTABLE: a stored configuration snapshot is history');
     end`,
  `create trigger if not exists configuration_snapshots_no_delete
     before delete on ${TABLE}
     for each row
     begin
       select raise(abort, 'KLUY-TERMINAL-STORE-IMMUTABLE: configuration snapshots are never deleted');
     end`,
];

interface SnapshotRow extends Record<string, SqlValue> {
  readonly configuration_version: number;
  readonly record: string;
}

/**
 * The terminal-local configuration-snapshot cache. One instance per open
 * store; construct with the SAME key store as the receipt store so one OS
 * custody protects the whole terminal state.
 */
export class ConfigurationSnapshotStore {
  readonly #driver: TerminalSqlDriver;
  readonly #keys: SealingKeys;

  constructor(driver: TerminalSqlDriver, keyStore: SecureKeyStore) {
    this.#driver = driver;
    this.#keys = deriveSealingKeys(keyStore.getOrCreateDatabaseKey());
    for (const statement of SCHEMA) driver.exec(statement);
  }

  /**
   * Persist a snapshot the runtime has just VERIFIED. Refuses forbidden
   * material, refuses version regression, and treats a repeat of the current
   * version as idempotent evidence — the stored record does not move.
   */
  persistValidated(record: StoredConfigurationSnapshot): StoredConfigurationSnapshot {
    assertNoForbiddenMaterial(record, "configuration snapshot");
    const version = record.snapshot.configurationVersion;
    if (!Number.isInteger(version) || version < 0) {
      throw new TerminalConfigurationStoreError(
        `configuration version ${String(version)} is not a non-negative integer`,
        "KLUY-TERMINAL-STORE-CONFIG-VERSION",
      );
    }
    return this.#driver.transaction(() => {
      const current = this.#currentVersion();
      if (current !== null && version < current) {
        throw new TerminalConfigurationStoreError(
          `configuration version ${version} is older than the stored ${current}; versions only move forward`,
          "KLUY-TERMINAL-STORE-CONFIG-ROLLBACK",
        );
      }
      if (current !== null && version === current) {
        const existing = this.loadCurrent();
        if (existing !== null) return existing;
      }
      const sealed = seal(this.#keys, TABLE, "record", String(version), JSON.stringify(record));
      this.#driver.run(
        `insert into ${TABLE} (configuration_version, record, created_at) values (?, ?, ?)`,
        [version, sealed, record.verifiedAt],
      );
      this.#driver.run(
        `insert into current_configuration_snapshot (singleton, configuration_version)
           values (1, ?)
           on conflict (singleton) do update set configuration_version = excluded.configuration_version`,
        [version],
      );
      return record;
    });
  }

  /**
   * Load the current cached snapshot. `null` means no snapshot was ever
   * cached; a throw means the store cannot be trusted (`KLUY-TERMINAL-STORE-
   * CORRUPT` from the sealing layer). Callers must not conflate the two, and
   * must RE-VERIFY the returned snapshot before use — this is a cache, not
   * an authority.
   */
  loadCurrent(): StoredConfigurationSnapshot | null {
    const pointer = this.#currentVersion();
    if (pointer === null) return null;
    const rows = this.#driver.all<SnapshotRow>(
      `select configuration_version, record from ${TABLE} where configuration_version = ?`,
      [pointer],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new TerminalConfigurationStoreError(
        "the current-snapshot pointer names a version that has no row",
        "KLUY-TERMINAL-STORE-CORRUPT",
      );
    }
    const plaintext = open(
      this.#keys,
      TABLE,
      "record",
      String(row.configuration_version),
      row.record,
    );
    return JSON.parse(plaintext) as StoredConfigurationSnapshot;
  }

  /** Every cached version, oldest first. Evidence, not an activation path. */
  history(): readonly number[] {
    return this.#driver
      .all<SnapshotRow>(
        `select configuration_version, record from ${TABLE} order by configuration_version asc`,
      )
      .map((row) => row.configuration_version);
  }

  #currentVersion(): number | null {
    const rows = this.#driver.all<{ configuration_version: number } & Record<string, SqlValue>>(
      `select configuration_version from current_configuration_snapshot where singleton = 1`,
    );
    return rows[0]?.configuration_version ?? null;
  }
}
