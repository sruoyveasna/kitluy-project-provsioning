/**
 * Protected terminal identity — WS-12-T001, atomic writer per
 * KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §6.
 *
 * The terminal's provisioning outcome (PUBLIC identity, the Hub operational
 * public key, and the receipt/discovery expectations) persisted as ONE
 * `safeStorage`-wrapped JSON file under the Electron user-data directory.
 * Only wrapped bytes reach disk; if OS encryption is unavailable this
 * module refuses rather than writing plaintext.
 *
 * WRITER CONTRACT (owner-locked):
 * - main-process only — no IPC channel exposes any part of it, so the
 *   renderer structurally cannot supply or change scope or profile;
 * - input is a SERVER-AUTHORITATIVE provisioning result, validated field by
 *   field before a byte is written;
 * - the write is ATOMIC: wrapped bytes go to a temporary file, the file is
 *   fsynced, then renamed over the prior file — a failed write leaves the
 *   prior valid identity untouched;
 * - an identical retry is idempotent; a CONFLICTING identity (different
 *   terminal, key or scope) is refused — replacement is a governed WS-11
 *   flow, never a silent overwrite;
 * - every installation outcome is recorded in an append-only local
 *   acknowledgment log (public identifiers only);
 * - NO PRIVATE KEY ever enters the identity JSON
 *   (`assertNoForbiddenMaterial` refuses one).
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { TRUST_ENVIRONMENTS } from "@kitluy/device-identity";
import { assertNoForbiddenMaterial, type OsEncryptionFacility } from "@kitluy/terminal-local-store";

import type { ProtectedTerminalIdentity, TerminalIdentityPort } from "../src/bootstrap/ports.js";

export class TerminalIdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    // The code leads the message — the house sentinel style, so operators
    // and tests match on the stable identifier.
    super(`${code}: ${message}`);
    this.name = "TerminalIdentityError";
  }
}

const IDENTITY_FILE = "terminal-identity.bin";
const ACK_LOG_FILE = "identity-installations.log.jsonl";
const FINGERPRINT = /^[0-9a-f]{64}$/;

export function terminalIdentityPath(userDataPath: string): string {
  return path.join(userDataPath, "terminal-state", IDENTITY_FILE);
}

export function installationAckLogPath(userDataPath: string): string {
  return path.join(userDataPath, "terminal-state", ACK_LOG_FILE);
}

/**
 * The server-authoritative provisioning result the writer accepts. The
 * identity fields are exactly the runtime identity; the provenance names
 * which governed provisioning produced it. Nothing here is renderer input.
 */
export interface ProvisioningInstallationResult {
  readonly identity: ProtectedTerminalIdentity;
  readonly provenance: {
    readonly provisioningSessionId: string;
    readonly pairingSessionId: string;
    readonly issuedAt: string;
  };
}

export type InstallationOutcome = "installed" | "already_installed";

export interface InstallationAcknowledgment {
  readonly acknowledgmentId: string;
  readonly outcome: InstallationOutcome;
  readonly terminalDeviceId: string;
  readonly terminalCertificateFingerprint: string;
  readonly hubDeviceId: string;
  readonly environment: string;
  readonly provisioningSessionId: string;
  readonly recordedAt: string;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TerminalIdentityError(
      `provisioning result field ${field} is missing or empty`,
      "KLUY-TERMINAL-IDENTITY-INCOMPLETE",
    );
  }
  return value;
}

function validateResult(result: ProvisioningInstallationResult): void {
  const identity = result.identity;
  requireNonEmpty(identity.terminalDeviceId, "terminalDeviceId");
  requireNonEmpty(identity.terminalCertificateSerial, "terminalCertificateSerial");
  requireNonEmpty(identity.hubOperationalPublicKeyPem, "hubOperationalPublicKeyPem");
  requireNonEmpty(result.provenance.provisioningSessionId, "provisioningSessionId");
  requireNonEmpty(result.provenance.pairingSessionId, "pairingSessionId");
  requireNonEmpty(result.provenance.issuedAt, "issuedAt");
  requireNonEmpty(identity.hubEndpointHint.hostname, "hubEndpointHint.hostname");
  if (!FINGERPRINT.test(identity.terminalCertificateFingerprint)) {
    throw new TerminalIdentityError(
      "terminalCertificateFingerprint is not a lowercase sha-256 hex fingerprint",
      "KLUY-TERMINAL-IDENTITY-FINGERPRINT",
    );
  }
  if (!FINGERPRINT.test(identity.receiptExpectation.hubCertificateFingerprint)) {
    throw new TerminalIdentityError(
      "receiptExpectation.hubCertificateFingerprint is not a valid fingerprint",
      "KLUY-TERMINAL-IDENTITY-FINGERPRINT",
    );
  }
  if (
    identity.receiptExpectation.terminalCertificateFingerprint !==
      identity.terminalCertificateFingerprint ||
    identity.receiptExpectation.terminalDeviceId !== identity.terminalDeviceId
  ) {
    throw new TerminalIdentityError(
      "the receipt expectation does not bind this terminal's identity",
      "KLUY-TERMINAL-IDENTITY-BINDING",
    );
  }
  if (!(TRUST_ENVIRONMENTS as readonly string[]).includes(identity.environment)) {
    throw new TerminalIdentityError(
      `environment ${String(identity.environment)} is not a trust environment`,
      "KLUY-TERMINAL-IDENTITY-ENVIRONMENT",
    );
  }
  if (
    identity.discoveryExpectation.tenantId !== identity.receiptExpectation.tenantId ||
    identity.discoveryExpectation.digitalStoreId !== identity.receiptExpectation.digitalStoreId ||
    identity.discoveryExpectation.storeLocationId !== identity.receiptExpectation.storeLocationId ||
    identity.discoveryExpectation.environment !== identity.environment
  ) {
    throw new TerminalIdentityError(
      "the discovery expectation does not match the provisioned scope",
      "KLUY-TERMINAL-IDENTITY-BINDING",
    );
  }
  // No private key, nonce, provisioning code, password or DSN — ever.
  assertNoForbiddenMaterial(result, "provisioning installation result");
}

function identitiesConflict(a: ProtectedTerminalIdentity, b: ProtectedTerminalIdentity): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function appendAcknowledgment(
  userDataPath: string,
  acknowledgment: InstallationAcknowledgment,
): void {
  // Append-only by construction: the log is only ever opened for append,
  // and nothing in this module (or anywhere else) rewrites or truncates it.
  appendFileSync(installationAckLogPath(userDataPath), `${JSON.stringify(acknowledgment)}\n`, {
    mode: 0o600,
  });
}

/**
 * Install the provisioning outcome. Called by the provisioning flow in the
 * MAIN process only — never from any user-facing surface.
 */
export function installProtectedTerminalIdentity(
  facility: OsEncryptionFacility,
  userDataPath: string,
  result: ProvisioningInstallationResult,
  now: Date,
): InstallationAcknowledgment {
  if (!facility.isEncryptionAvailable()) {
    throw new TerminalIdentityError(
      "OS encryption is unavailable; the terminal identity is not written unprotected",
      "KLUY-TERMINAL-IDENTITY-NO-CUSTODY",
    );
  }
  validateResult(result);

  const target = terminalIdentityPath(userDataPath);
  const directory = path.dirname(target);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

  const port = protectedTerminalIdentityPort(facility, userDataPath);
  const existing = existsSync(target) ? port.load() : null;
  if (existing !== null) {
    if (identitiesConflict(existing, result.identity)) {
      throw new TerminalIdentityError(
        "a different terminal identity is already installed; replacement is a governed flow, not an overwrite",
        "KLUY-TERMINAL-IDENTITY-CONFLICT",
      );
    }
    const acknowledgment: InstallationAcknowledgment = {
      acknowledgmentId: randomUUID(),
      outcome: "already_installed",
      terminalDeviceId: result.identity.terminalDeviceId,
      terminalCertificateFingerprint: result.identity.terminalCertificateFingerprint,
      hubDeviceId: result.identity.receiptExpectation.hubDeviceId,
      environment: result.identity.environment,
      provisioningSessionId: result.provenance.provisioningSessionId,
      recordedAt: now.toISOString(),
    };
    appendAcknowledgment(userDataPath, acknowledgment);
    return acknowledgment;
  }

  // Atomic install: temporary file → fsync → rename. A crash at any point
  // leaves either no identity (first install) or the prior valid file.
  const temporary = `${target}.tmp-${randomUUID().slice(0, 8)}`;
  let descriptor: number | null = null;
  try {
    const wrapped = facility.encryptString(JSON.stringify(result.identity));
    descriptor = openSync(temporary, "w", 0o600);
    writeSync(descriptor, wrapped);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw new TerminalIdentityError(
      `the identity write failed and the prior state is preserved: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      "KLUY-TERMINAL-IDENTITY-WRITE-FAILED",
    );
  }

  const acknowledgment: InstallationAcknowledgment = {
    acknowledgmentId: randomUUID(),
    outcome: "installed",
    terminalDeviceId: result.identity.terminalDeviceId,
    terminalCertificateFingerprint: result.identity.terminalCertificateFingerprint,
    hubDeviceId: result.identity.receiptExpectation.hubDeviceId,
    environment: result.identity.environment,
    provisioningSessionId: result.provenance.provisioningSessionId,
    recordedAt: now.toISOString(),
  };
  appendAcknowledgment(userDataPath, acknowledgment);
  return acknowledgment;
}

/** Read the acknowledgment log (public identifiers only), oldest first. */
export function readInstallationAcknowledgments(
  userDataPath: string,
): readonly InstallationAcknowledgment[] {
  const file = installationAckLogPath(userDataPath);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as InstallationAcknowledgment);
}

/**
 * The startup identity port. `load()` returns `null` when the terminal was
 * never provisioned and THROWS when the file exists but cannot be unwrapped
 * or parsed — the caller maps that to `recovery_required`, never to a
 * silent re-provisioning.
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
