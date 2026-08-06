/**
 * Protected terminal identity file — WS-12-T001.
 *
 * The terminal's provisioning outcome (PUBLIC identity, the Hub operational
 * public key, and the receipt/discovery expectations) persisted as ONE
 * `safeStorage`-wrapped JSON file under the Electron user-data directory.
 * The same custody rule as the terminal store key: only wrapped bytes reach
 * disk, and if OS encryption is unavailable this module refuses rather than
 * writing plaintext.
 *
 * THE INSTALLER AND USER NEVER WRITE THIS FILE. It is written by the
 * provisioning/pairing flow (WS-11-T004 outcome) and read at startup. There
 * is no UI, argument, environment variable or dialog that can override any
 * field in it — which is how the §5 "cannot select or override" rule is
 * enforced structurally.
 *
 * NO PRIVATE KEY LIVES HERE. The terminal signing key stays in the OS or
 * hardware key store; `assertNoForbiddenMaterial` refuses a write that
 * carries one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { assertNoForbiddenMaterial, type OsEncryptionFacility } from "@kitluy/terminal-local-store";

import type { ProtectedTerminalIdentity, TerminalIdentityPort } from "../src/bootstrap/ports.js";

export class TerminalIdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TerminalIdentityError";
  }
}

const IDENTITY_FILE = "terminal-identity.bin";

export function terminalIdentityPath(userDataPath: string): string {
  return path.join(userDataPath, "terminal-state", IDENTITY_FILE);
}

/**
 * Persist the provisioning outcome. Called by the provisioning flow only —
 * never from any user-facing surface.
 */
export function writeProtectedTerminalIdentity(
  facility: OsEncryptionFacility,
  userDataPath: string,
  identity: ProtectedTerminalIdentity,
): void {
  if (!facility.isEncryptionAvailable()) {
    throw new TerminalIdentityError(
      "OS encryption is unavailable; the terminal identity is not written unprotected",
      "KLUY-TERMINAL-IDENTITY-NO-CUSTODY",
    );
  }
  // The Hub operational PUBLIC key is legitimate content; everything the
  // forbidden-material rule names (private keys, nonces, codes, DSNs) is not.
  assertNoForbiddenMaterial(identity, "terminal identity");
  const target = terminalIdentityPath(userDataPath);
  const directory = path.dirname(target);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const wrapped = facility.encryptString(JSON.stringify(identity));
  writeFileSync(target, wrapped, { mode: 0o600 });
}

/**
 * The startup identity port. `load()` returns `null` when the terminal was
 * never provisioned and THROWS when the file exists but cannot be unwrapped
 * or parsed — the caller maps that to `recovery_required`, never to a silent
 * re-provisioning.
 */
export function protectedTerminalIdentityPort(
  facility: OsEncryptionFacility,
  userDataPath: string,
): TerminalIdentityPort {
  return {
    load(): ProtectedTerminalIdentity | null {
      const target = terminalIdentityPath(userDataPath);
      if (!existsSync(target)) return null;
      if (!facility.isEncryptionAvailable()) {
        throw new TerminalIdentityError(
          "OS encryption is unavailable; the stored terminal identity cannot be unwrapped",
          "KLUY-TERMINAL-IDENTITY-NO-CUSTODY",
        );
      }
      let plaintext: string;
      try {
        plaintext = facility.decryptString(readFileSync(target));
      } catch {
        throw new TerminalIdentityError(
          "the stored terminal identity does not unwrap under this OS account",
          "KLUY-TERMINAL-IDENTITY-CORRUPT",
        );
      }
      try {
        return JSON.parse(plaintext) as ProtectedTerminalIdentity;
      } catch {
        throw new TerminalIdentityError(
          "the stored terminal identity is not valid JSON",
          "KLUY-TERMINAL-IDENTITY-CORRUPT",
        );
      }
    },
  };
}
