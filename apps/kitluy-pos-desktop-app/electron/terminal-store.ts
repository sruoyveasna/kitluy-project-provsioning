/**
 * Electron T1-T4 terminal-local store wiring — WS-11-T004-P04C2.
 *
 * This is the ONE runtime the P04C package asks to be implemented first, and
 * it is deliberately thin: every decision lives in
 * `@kitluy/terminal-local-store`, which is runtime-agnostic. What belongs HERE
 * is only what is Electron-specific — where the files live and which OS
 * facility protects the key.
 *
 * KEY CUSTODY. `safeStorage` is DPAPI on Windows, the Keychain on macOS and
 * the platform secret service on Linux. Only the WRAPPED key is written to
 * disk (`terminal-store.key`), and `safeStorage` ties the unwrap to the OS
 * account, so copying the terminal's profile directory to another machine
 * yields a blob that will not open. If the facility reports encryption
 * unavailable, {@link openTerminalPairingStore} throws rather than falling back
 * to an unprotected key — a degraded encrypted store is a plaintext store with
 * a reassuring name.
 *
 * THE TERMINAL'S PRIVATE SIGNING KEY IS NOT HERE. It stays in the OS-protected
 * or hardware-backed key store; nothing in this file or the store package
 * accepts, returns or persists one.
 *
 * NOTE (recorded, not hidden): the SQLite driver uses Node 22's built-in
 * `node:sqlite`, which Node still marks experimental. It is loaded through
 * `require` at call time so importing this module never fails on a runtime
 * without it, and the driver port means a swap changes this file only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import {
  PairingReceiptStore,
  createSqliteDriver,
  osProtectedSecureKeyStore,
  type OsEncryptionFacility,
  type TerminalSqlDriver,
} from "@kitluy/terminal-local-store";

interface NodeSqliteModule {
  DatabaseSync: new (file: string) => Parameters<typeof createSqliteDriver>[0];
}

/**
 * Resolve Node's built-in SQLite at CALL time.
 *
 * `createRequire` rather than a bare `require` so this compiles under both the
 * CommonJS Electron target and any future ESM one, and so importing this module
 * never fails on a runtime that lacks the builtin — the failure surfaces where
 * the store is actually opened, with a message an operator can act on.
 */
function loadNodeSqlite(): NodeSqliteModule {
  return createRequire(__filename)("node:sqlite") as NodeSqliteModule;
}

export interface OpenedTerminalStore {
  readonly receipts: PairingReceiptStore;
  readonly driver: TerminalSqlDriver;
  readonly databasePath: string;
}

/**
 * Open (creating on first run) the terminal-local store under the Electron
 * user-data directory.
 *
 * `safeStorage` and `userDataPath` are injected rather than imported from
 * `electron` so this module can be exercised without a desktop session — the
 * main process passes the real ones.
 */
export function openTerminalPairingStore(
  safeStorage: OsEncryptionFacility,
  userDataPath: string,
): OpenedTerminalStore {
  const directory = path.join(userDataPath, "terminal-state");
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

  const wrappedKeyPath = path.join(directory, "terminal-store.key");
  const keyStore = osProtectedSecureKeyStore(safeStorage, {
    read: () => (existsSync(wrappedKeyPath) ? readFileSync(wrappedKeyPath) : null),
    // Written with the wrapped bytes only. The plaintext key never reaches a
    // file, a log or an IPC message.
    write: (wrapped) => writeFileSync(wrappedKeyPath, wrapped, { mode: 0o600 }),
  });

  const databasePath = path.join(directory, "terminal.sqlite");
  const { DatabaseSync } = loadNodeSqlite();
  const driver = createSqliteDriver(new DatabaseSync(databasePath));
  return { receipts: new PairingReceiptStore(driver, keyStore), driver, databasePath };
}
