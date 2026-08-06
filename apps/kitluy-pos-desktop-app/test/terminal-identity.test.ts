/**
 * WS-12-T001-P02 §8 "Identity installation" — the atomic protected
 * terminal-identity writer (owner decision §6).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { OsEncryptionFacility } from "@kitluy/terminal-local-store";

import {
  TerminalIdentityError,
  installProtectedTerminalIdentity,
  installationAckLogPath,
  protectedTerminalIdentityPort,
  readInstallationAcknowledgments,
  terminalIdentityPath,
  type ProvisioningInstallationResult,
} from "../electron/terminal-identity.js";
import type { ProtectedTerminalIdentity } from "../src/bootstrap/ports.js";

const NOW = new Date("2026-08-06T10:00:00.000Z");

/** Reversible XOR facility — a structural safeStorage stand-in. */
function facility(available = true): OsEncryptionFacility {
  const key = 0x5a;
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => {
      const bytes = Buffer.from(plainText, "utf8");
      return Buffer.from(bytes.map((b) => b ^ key));
    },
    decryptString: (encrypted) => Buffer.from(encrypted.map((b) => b ^ key)).toString("utf8"),
  };
}

function fingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-identity-"));
  temporaryDirectories.push(dir);
  return dir;
}

function result(over: Partial<ProtectedTerminalIdentity> = {}): ProvisioningInstallationResult {
  const terminalDeviceId = randomUUID();
  const terminalFingerprint = fingerprint(`terminal-${terminalDeviceId}`);
  const hubFingerprint = fingerprint("hub");
  const scope = {
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
  };
  const identity: ProtectedTerminalIdentity = {
    terminalDeviceId,
    terminalCertificateSerial: "7ab1",
    terminalCertificateFingerprint: terminalFingerprint,
    environment: "development",
    hubOperationalPublicKeyPem: "public-key-material-placeholder",
    receiptExpectation: {
      pairingSessionId: randomUUID(),
      transcriptHash: fingerprint("transcript"),
      hubDeviceId: randomUUID(),
      hubCertificateFingerprint: hubFingerprint,
      terminalDeviceId,
      terminalCertificateFingerprint: terminalFingerprint,
      ...scope,
      environment: "development",
      terminalAssignmentGeneration: 1,
      terminalProfileKey: "laundry.t1.intake_cashier",
    },
    discoveryExpectation: { ...scope, environment: "development" },
    hubEndpointHint: { hostname: "hub.store.lan", port: 7443 },
    ...over,
  };
  return {
    identity,
    provenance: {
      provisioningSessionId: randomUUID(),
      pairingSessionId: identity.receiptExpectation.pairingSessionId,
      issuedAt: NOW.toISOString(),
    },
  };
}

describe("protected identity installation (§6)", () => {
  it("a successful provisioning result installs once, with an acknowledgment", () => {
    const dir = userData();
    const f = facility();
    const installation = result();
    const ack = installProtectedTerminalIdentity(f, dir, installation, NOW);
    expect(ack.outcome).toBe("installed");
    const loaded = protectedTerminalIdentityPort(f, dir).load();
    expect(loaded).toEqual(installation.identity);
    expect(readInstallationAcknowledgments(dir)).toHaveLength(1);
  });

  it("an identical retry is idempotent — one identity, two acknowledgments, no move", () => {
    const dir = userData();
    const f = facility();
    const installation = result();
    installProtectedTerminalIdentity(f, dir, installation, NOW);
    const retry = installProtectedTerminalIdentity(f, dir, installation, NOW);
    expect(retry.outcome).toBe("already_installed");
    const acks = readInstallationAcknowledgments(dir);
    expect(acks).toHaveLength(2);
    expect(acks.map((a) => a.outcome)).toEqual(["installed", "already_installed"]);
  });

  it("a conflicting identity is refused — replacement is a governed flow", () => {
    const dir = userData();
    const f = facility();
    installProtectedTerminalIdentity(f, dir, result(), NOW);
    expect(() => installProtectedTerminalIdentity(f, dir, result(), NOW)).toThrowError(
      /KLUY-TERMINAL-IDENTITY-CONFLICT/,
    );
  });

  it("a failed or refused write preserves the prior state — no partial file survives", () => {
    // (a) A write that fails mid-install leaves NO identity and no
    // temporary residue: the next install starts clean.
    const dir = userData();
    const good = facility();
    const exploding: OsEncryptionFacility = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error("simulated custody failure");
      },
      decryptString: good.decryptString.bind(good),
    };
    const first = result();
    expect(() => installProtectedTerminalIdentity(exploding, dir, first, NOW)).toThrowError(
      TerminalIdentityError,
    );
    expect(existsSync(terminalIdentityPath(dir))).toBe(false);
    installProtectedTerminalIdentity(good, dir, first, NOW);
    // (b) Once a valid identity exists, an attempted replacement (the only
    // path that could overwrite it) throws BEFORE any byte is written and
    // the prior file is untouched.
    const before = readFileSync(terminalIdentityPath(dir));
    expect(() => installProtectedTerminalIdentity(good, dir, result(), NOW)).toThrowError(
      /KLUY-TERMINAL-IDENTITY-CONFLICT/,
    );
    expect(readFileSync(terminalIdentityPath(dir))).toEqual(before);
  });

  it("renderer-supplied scope cannot reach the writer — validation refuses incoherent bindings", () => {
    const dir = userData();
    const f = facility();
    const tampered = result();
    // A "renderer" attempting to smuggle a different Store into the
    // discovery expectation: the binding check refuses it outright.
    const poisoned: ProvisioningInstallationResult = {
      ...tampered,
      identity: {
        ...tampered.identity,
        discoveryExpectation: {
          ...tampered.identity.discoveryExpectation,
          digitalStoreId: randomUUID(),
        },
      },
    };
    expect(() => installProtectedTerminalIdentity(f, dir, poisoned, NOW)).toThrowError(
      /KLUY-TERMINAL-IDENTITY-BINDING/,
    );
  });

  it("no private key can enter the identity JSON", () => {
    const dir = userData();
    const f = facility();
    const dashes = "-".repeat(5);
    const poisoned = result({
      hubOperationalPublicKeyPem: `${dashes}BEGIN PRIVATE KEY${dashes}\nqqq\n${dashes}END PRIVATE KEY${dashes}`,
    });
    expect(() => installProtectedTerminalIdentity(f, dir, poisoned, NOW)).toThrowError(
      /KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL/,
    );
  });

  it("a corrupt sealed file fails closed on startup — never silent re-provisioning", () => {
    const dir = userData();
    const f = facility();
    installProtectedTerminalIdentity(f, dir, result(), NOW);
    writeFileSync(terminalIdentityPath(dir), Buffer.from("garbage"));
    expect(() => protectedTerminalIdentityPort(f, dir).load()).toThrowError(
      /KLUY-TERMINAL-IDENTITY-CORRUPT/,
    );
  });

  it("the acknowledgment log is append-only material with public identifiers only", () => {
    const dir = userData();
    const f = facility();
    const installation = result();
    installProtectedTerminalIdentity(f, dir, installation, NOW);
    const raw = readFileSync(installationAckLogPath(dir), "utf8");
    expect(raw).not.toContain(installation.identity.hubOperationalPublicKeyPem);
    expect(raw).toContain(installation.identity.terminalDeviceId);
  });
});
