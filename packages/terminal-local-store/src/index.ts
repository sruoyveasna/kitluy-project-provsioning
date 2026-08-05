/**
 * `@kitluy/terminal-local-store` — the terminal's encrypted relational store.
 *
 * WS-11-T004-P04C2. Phase 1 ships ONE runtime implementation, the Electron
 * T1-T4 driver over Node's built-in `node:sqlite`. The driver port
 * ({@link TerminalSqlDriver}) is the seam a future React Native runtime
 * implements; no speculative mobile implementation exists here, because the
 * repository carries no runtime or secure-storage authority for one yet
 * (recorded, not invented).
 *
 * Terminal private keys stay in the OS-protected or hardware-backed key store
 * and never enter this database — no export here accepts, returns or persists
 * one.
 */
export * from "./driver.js";
export * from "./sealing.js";
export * from "./secure-key-store.js";
export * from "./pairing-receipt-store.js";
