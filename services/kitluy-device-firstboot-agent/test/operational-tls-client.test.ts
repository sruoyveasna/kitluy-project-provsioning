/**
 * The firstboot operational TLS client: end to end, and through every way a
 * Store Hub can lose power or a network.
 *
 * Authority: owner instruction 2026-08-28, "REBOOT / RECOVERY MATRIX"; findings
 * C-1, C-2 and C-3.
 *
 * ===========================================================================
 * WHAT A "REBOOT" IS HERE
 * ===========================================================================
 * `ensureOperationalCertificate` holds no state between calls — everything it
 * knows it reads from disk. So a reboot is modelled by calling it again against
 * the same directory, and a crash is modelled by deleting or truncating exactly
 * the files that would not have been written yet. That is the real failure mode:
 * the process is gone and only the filesystem survives.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureOperationalCertificate,
  x509SerialForCredentialSerial,
  type EnsureCertificateDeps,
  type IssuanceCallResult,
  type OperationalCertificateClient,
} from "../src/operational-tls-client.js";
import { operationalCsrBytes } from "../src/operational-csr-bytes.js";
import { currentPhase, readManifest, readRequestState } from "../src/operational-credential-state.js";
import { buildChain, mintLeaf, type TestChain } from "./support/operational-fixtures.js";

const DEVICE = "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607";
const CREDENTIAL_SERIAL = "DEV-0ABCDEF012345678";

let dir: string;
let paths: EnsureCertificateDeps["paths"];
let chain: TestChain;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-optls-"));
  paths = {
    directory: dir,
    privateKey: join(dir, "operational-tls.key.pem"),
    requestState: join(dir, "issuance-request.json"),
    certificate: join(dir, "operational-tls.crt.pem"),
    chain: join(dir, "operational-tls.chain.pem"),
    manifest: join(dir, "operational-credential.json"),
  };
  chain = buildChain();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A registry that behaves. It also VERIFIES the proof of possession, so a client
 * that signed the wrong bytes fails here rather than silently passing.
 */
function honestClient(options: { onRequest?: (n: number) => void } = {}): {
  client: OperationalCertificateClient;
  calls: Array<{ requestId: string; nonce: string; proof: string }>;
} {
  const calls: Array<{ requestId: string; nonce: string; proof: string }> = [];
  const client: OperationalCertificateClient = {
    request({ csr, operationalPublicKeyPem, proofOfPossessionBase64 }) {
      calls.push({ requestId: csr.requestId, nonce: csr.nonce, proof: proofOfPossessionBase64 });
      options.onRequest?.(calls.length);

      // The server's own check, reproduced: the proof must verify under the
      // presented key over the canonical preimage.
      const verified = cryptoVerify(
        "sha256",
        Buffer.from(operationalCsrBytes(csr)),
        createPublicKey(operationalPublicKeyPem),
        Buffer.from(proofOfPossessionBase64, "base64"),
      );
      if (!verified) {
        return Promise.resolve<IssuanceCallResult>({
          kind: "refused",
          refusal: {
            refusalCode: "OPCERT_POSSESSION_PROOF_FAILED",
            detail: "the proof did not verify",
            retryable: false,
          },
        });
      }

      const leaf = mintLeaf({
        chain,
        subjectPublicKeyPem: operationalPublicKeyPem,
        deviceRecordId: csr.deviceRecordId,
        serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
      });
      return Promise.resolve<IssuanceCallResult>({
        kind: "issued",
        response: {
          // A replay of the SAME signed request replays the SAME credential —
          // which is exactly what the governed door does.
          outcome: calls.length === 1 ? "ISSUED" : "REPLAYED",
          credentialId: "c0000000-0000-4000-8000-000000000001",
          certificateGeneration: 1,
          serialNumber: CREDENTIAL_SERIAL,
          certificateSha256: leaf.sha256,
          certificatePem: leaf.certificatePem,
          chainPem: chain.chainPem,
          publicKeyAlgorithm: "rsa-2048",
          notBefore: new Date(Date.now() - 60_000).toISOString(),
          notAfter: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        },
      });
    },
  };
  return { client, calls };
}

function deps(client: OperationalCertificateClient): EnsureCertificateDeps {
  return {
    client,
    deviceRecordId: DEVICE,
    environment: "development",
    hardwareTrustLevel: "development_software",
    assignmentGeneration: 3,
    trustedTime: new Date(),
    expectedRootSha256: chain.rootSha256,
    paths,
  };
}

describe("firstboot operational TLS client", () => {
  it("1. clean first boot: key, request, certificate, chain, manifest", async () => {
    const { client, calls } = honestClient();
    const outcome = await ensureOperationalCertificate(deps(client));

    expect(outcome.kind, JSON.stringify(outcome)).toBe("adopted");
    expect(calls).toHaveLength(1);
    expect(currentPhase(paths)).toBe("ADOPTED");
    expect(existsSync(paths!.privateKey)).toBe(true);
    expect(existsSync(paths!.certificate)).toBe(true);
    expect(existsSync(paths!.chain)).toBe(true);
    expect(readManifest(paths)?.credentialId).toBe("c0000000-0000-4000-8000-000000000001");
  });

  it("a provisioned Hub makes NO network call on a later boot", async () => {
    const { client, calls } = honestClient();
    await ensureOperationalCertificate(deps(client));
    expect(calls).toHaveLength(1);

    // THE PROPERTY THAT MATTERS FOR A SHOP. After provisioning, the Hub must
    // start without the WAN — a till that stopped working because the internet
    // did would be worse than the one it replaced.
    for (let boot = 0; boot < 5; boot += 1) {
      const later = await ensureOperationalCertificate(deps(client));
      expect(later.kind).toBe("already_adopted");
    }
    expect(calls, "a provisioned Hub called the registry again").toHaveLength(1);
  });

  it("2 & 9. IDEMPOTENCY: a lost response replays the SAME request after a reboot", async () => {
    // The cloud issues; the response never arrives.
    const lost: OperationalCertificateClient = {
      request: () => Promise.resolve<IssuanceCallResult>({ kind: "unreachable", detail: "connection reset" }),
    };
    const first = await ensureOperationalCertificate(deps(lost));
    expect(first.kind).toBe("unreachable");

    // The request identity was persisted BEFORE the call, so it survives.
    const persisted = readRequestState(paths);
    expect(persisted, "no request state survived the lost response").not.toBeNull();

    // Reboot. Same directory, fresh call.
    const { client, calls } = honestClient();
    const second = await ensureOperationalCertificate(deps(client));
    expect(second.kind).toBe("adopted");

    // THE PROOF: the replayed request carried the SAME identifiers, so the
    // governed door recognises it as the same request and does not consume a
    // second generation.
    expect(calls[0]!.requestId).toBe(persisted!.requestId);
    expect(calls[0]!.nonce).toBe(persisted!.nonce);
    expect(readRequestState(paths)!.requestId).toBe(persisted!.requestId);
  });

  it("3. reboot BEFORE submission: the same request is used, not a new one", async () => {
    // A crash between writing the request state and sending it.
    const captured: string[] = [];
    const crashing: OperationalCertificateClient = {
      request: ({ csr }) => {
        captured.push(csr.requestId);
        return Promise.resolve<IssuanceCallResult>({ kind: "unreachable", detail: "power lost" });
      },
    };
    await ensureOperationalCertificate(deps(crashing));
    await ensureOperationalCertificate(deps(crashing));
    await ensureOperationalCertificate(deps(crashing));
    expect(new Set(captured).size, "a new request identity was minted per boot").toBe(1);
  });

  it("4. reboot while the request is pending: still one identity", async () => {
    const { client, calls } = honestClient();
    const slow: OperationalCertificateClient = {
      request: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return client.request(input);
      },
    };
    const a = ensureOperationalCertificate(deps(slow));
    const b = ensureOperationalCertificate(deps(slow));
    await Promise.all([a, b]);
    // Both boots signed the SAME request; the door replays rather than issuing
    // twice.
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(1);
  });

  it("5. reboot AFTER the response but BEFORE persistence", async () => {
    const { client } = honestClient();
    // The response arrived and the process died before `commitAdoption`.
    // Modelled by running once and deleting everything the commit wrote.
    await ensureOperationalCertificate(deps(client));
    unlinkSync(paths!.manifest);
    unlinkSync(paths!.certificate);
    unlinkSync(paths!.chain);
    expect(currentPhase(paths)).toBe("REQUEST_READY");

    const again = await ensureOperationalCertificate(deps(client));
    expect(again.kind).toBe("adopted");
    if (again.kind === "adopted") expect(again.replayed).toBe(true);
    expect(currentPhase(paths)).toBe("ADOPTED");
  });

  it("6. reboot after the LEAF write but before the CHAIN write", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    unlinkSync(paths!.manifest);
    unlinkSync(paths!.chain);

    // NOT adopted: the manifest is gone and the chain is missing. A Hub that
    // read "certificate exists" as "usable" would try to serve TLS with no path
    // to its root.
    expect(currentPhase(paths)).not.toBe("ADOPTED");
    const again = await ensureOperationalCertificate(deps(client));
    expect(again.kind).toBe("adopted");
    expect(existsSync(paths!.chain)).toBe(true);
  });

  it("7. reboot after BOTH files but before the manifest commit", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    unlinkSync(paths!.manifest);

    // The manifest is committed LAST precisely so this state reads as NOT
    // adopted. The reverse order would leave a Hub believing it holds a
    // credential it cannot present.
    expect(currentPhase(paths)).toBe("REQUEST_READY");
    const again = await ensureOperationalCertificate(deps(client));
    expect(again.kind).toBe("adopted");
    expect(readManifest(paths)).not.toBeNull();
  });

  it("a manifest without its files does NOT read as adopted", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    unlinkSync(paths!.certificate);
    // The shape a half-copied card or a partial restore produces.
    expect(currentPhase(paths)).not.toBe("ADOPTED");
  });

  it("8. a DUPLICATE response is idempotent and mints nothing new", async () => {
    const { client, calls } = honestClient();
    const first = await ensureOperationalCertificate(deps(client));
    expect(first.kind).toBe("adopted");
    const before = readFileSync(paths!.certificate, "utf8");

    unlinkSync(paths!.manifest);
    const second = await ensureOperationalCertificate(deps(client));
    expect(second.kind).toBe("adopted");
    expect(readFileSync(paths!.certificate, "utf8")).toBe(before);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.requestId).toBe(calls[1]!.requestId);
  });

  it("10. a certificate over the WRONG key is refused and nothing is written", async () => {
    const stranger = buildChain();
    const wrongKey: OperationalCertificateClient = {
      request: ({ csr }) => {
        const other = mintLeaf({
          chain,
          subjectPublicKeyPem: stranger.intermediatePem.includes("x")
            ? createPublicKey(stranger.intermediateKeyPem).export({ type: "spki", format: "pem" }).toString()
            : createPublicKey(stranger.intermediateKeyPem).export({ type: "spki", format: "pem" }).toString(),
          deviceRecordId: csr.deviceRecordId,
          serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
        });
        return Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: other.sha256,
            certificatePem: other.certificatePem,
            chainPem: chain.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        });
      },
    };
    const outcome = await ensureOperationalCertificate(deps(wrongKey));
    expect(outcome.kind).toBe("verification_failed");
    if (outcome.kind === "verification_failed") {
      expect(outcome.failures.map((f) => f.check)).toContain("LEAF_KEY_IS_THE_LOCAL_KEY");
    }
    // NOTHING adopted, and the request state survives so a fixed server can be
    // asked again with the same identity.
    expect(existsSync(paths!.certificate)).toBe(false);
    expect(existsSync(paths!.manifest)).toBe(false);
    expect(readRequestState(paths)).not.toBeNull();
  });

  it("11 & 12. a WRONG chain or a WRONG root is refused", async () => {
    const rogue = buildChain();
    const swapped: OperationalCertificateClient = {
      request: ({ csr, operationalPublicKeyPem }) => {
        const leaf = mintLeaf({
          chain: rogue,
          subjectPublicKeyPem: operationalPublicKeyPem,
          deviceRecordId: csr.deviceRecordId,
          serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
        });
        return Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: leaf.sha256,
            certificatePem: leaf.certificatePem,
            // A perfectly self-consistent chain that is simply not ours.
            chainPem: rogue.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        });
      },
    };
    const outcome = await ensureOperationalCertificate(deps(swapped));
    expect(outcome.kind).toBe("verification_failed");
    if (outcome.kind === "verification_failed") {
      expect(outcome.failures.map((f) => f.check)).toContain(
        "ROOT_IS_THE_EXPECTED_DEVELOPMENT_ROOT",
      );
    }
    expect(existsSync(paths!.manifest)).toBe(false);
  });

  it("9(cert). a CORRUPTED PEM response is refused", async () => {
    const corrupt: OperationalCertificateClient = {
      request: () =>
        Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: "00".repeat(32),
            certificatePem: "-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----\n",
            chainPem: chain.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        }),
    };
    const outcome = await ensureOperationalCertificate(deps(corrupt));
    expect(outcome.kind).toBe("verification_failed");
    expect(existsSync(paths!.certificate)).toBe(false);
  });

  it("13. a WRONG serial is refused", async () => {
    const wrongSerial: OperationalCertificateClient = {
      request: ({ csr, operationalPublicKeyPem }) => {
        const leaf = mintLeaf({
          chain,
          subjectPublicKeyPem: operationalPublicKeyPem,
          deviceRecordId: csr.deviceRecordId,
          serialHex: "0102030405060708",
        });
        return Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: leaf.sha256,
            certificatePem: leaf.certificatePem,
            chainPem: chain.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        });
      },
    };
    const outcome = await ensureOperationalCertificate(deps(wrongSerial));
    expect(outcome.kind).toBe("verification_failed");
    if (outcome.kind === "verification_failed") {
      expect(outcome.failures.map((f) => f.check)).toContain("SERIAL_MATCHES_GOVERNED");
    }
  });

  it("14 & 15. EXPIRED and NOT-YET-VALID certificates are refused", async () => {
    for (const window of [
      { notBefore: new Date(Date.now() - 40 * 86_400_000), notAfter: new Date(Date.now() - 86_400_000) },
      { notBefore: new Date(Date.now() + 86_400_000), notAfter: new Date(Date.now() + 20 * 86_400_000) },
    ]) {
      rmSync(dir, { recursive: true, force: true });
      const client: OperationalCertificateClient = {
        request: ({ csr, operationalPublicKeyPem }) => {
          const leaf = mintLeaf({
            chain,
            subjectPublicKeyPem: operationalPublicKeyPem,
            deviceRecordId: csr.deviceRecordId,
            serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
            ...window,
          });
          return Promise.resolve<IssuanceCallResult>({
            kind: "issued",
            response: {
              outcome: "ISSUED",
              credentialId: "c1",
              certificateGeneration: 1,
              serialNumber: CREDENTIAL_SERIAL,
              certificateSha256: leaf.sha256,
              certificatePem: leaf.certificatePem,
              chainPem: chain.chainPem,
              publicKeyAlgorithm: "rsa-2048",
            },
          });
        },
      };
      const outcome = await ensureOperationalCertificate(deps(client));
      expect(outcome.kind).toBe("verification_failed");
    }
  });

  it("16. a certificate for ANOTHER device is refused", async () => {
    const wrongDevice: OperationalCertificateClient = {
      request: ({ operationalPublicKeyPem }) => {
        const leaf = mintLeaf({
          chain,
          subjectPublicKeyPem: operationalPublicKeyPem,
          deviceRecordId: "00000000-0000-4000-8000-000000000000",
          serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
        });
        return Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: leaf.sha256,
            certificatePem: leaf.certificatePem,
            chainPem: chain.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        });
      },
    };
    const outcome = await ensureOperationalCertificate(deps(wrongDevice));
    expect(outcome.kind).toBe("verification_failed");
    if (outcome.kind === "verification_failed") {
      expect(outcome.failures.map((f) => f.check)).toContain("SAN_IDENTIFIES_THIS_DEVICE");
    }
  });

  it("17. a WRONG credential generation is refused", async () => {
    const wrongGeneration: OperationalCertificateClient = {
      request: ({ csr, operationalPublicKeyPem }) => {
        const leaf = mintLeaf({
          chain,
          subjectPublicKeyPem: operationalPublicKeyPem,
          deviceRecordId: csr.deviceRecordId,
          serialHex: x509SerialForCredentialSerial(CREDENTIAL_SERIAL),
          credentialGeneration: 4,
        });
        return Promise.resolve<IssuanceCallResult>({
          kind: "issued",
          response: {
            outcome: "ISSUED",
            credentialId: "c1",
            // The body CLAIMS 1 while the certificate says 4. Believing the body
            // is exactly what device-side verification exists to prevent.
            certificateGeneration: 1,
            serialNumber: CREDENTIAL_SERIAL,
            certificateSha256: leaf.sha256,
            certificatePem: leaf.certificatePem,
            chainPem: chain.chainPem,
            publicKeyAlgorithm: "rsa-2048",
          },
        });
      },
    };
    const outcome = await ensureOperationalCertificate(deps(wrongGeneration));
    expect(outcome.kind).toBe("verification_failed");
    if (outcome.kind === "verification_failed") {
      expect(outcome.failures.map((f) => f.check)).toContain("CREDENTIAL_GENERATION_MATCHES");
    }
  });

  it("18. a server refusal is reported with its typed code, and nothing is spent", async () => {
    const refusing: OperationalCertificateClient = {
      request: () =>
        Promise.resolve<IssuanceCallResult>({
          kind: "refused",
          refusal: {
            refusalCode: "OPCERT_POSSESSION_PROOF_FAILED",
            detail: "the kitluy.csr.v1 signature does not verify",
            retryable: false,
          },
        }),
    };
    const outcome = await ensureOperationalCertificate(deps(refusing));
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.refusal.refusalCode).toBe("OPCERT_POSSESSION_PROOF_FAILED");
    }
    expect(existsSync(paths!.manifest)).toBe(false);
  });

  it("19. the cloud being unavailable is a WAITING state, not a crash", async () => {
    const down: OperationalCertificateClient = {
      request: () => Promise.resolve<IssuanceCallResult>({ kind: "unreachable", detail: "no route" }),
    };
    const outcome = await ensureOperationalCertificate(deps(down));
    expect(outcome.kind).toBe("unreachable");
    // The key and the request survive, so the next boot is a replay and not a
    // second identity.
    expect(currentPhase(paths)).toBe("REQUEST_READY");
  });

  it("20. cloud unavailable AFTER adoption changes nothing", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    const down: OperationalCertificateClient = {
      request: () => {
        throw new Error("the client must not be called once adopted");
      },
    };
    const outcome = await ensureOperationalCertificate(deps(down));
    expect(outcome.kind).toBe("already_adopted");
  });

  it("REFUSES to proceed when the stored request belongs to a different key", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    // Someone replaced the key but left the request. Reusing the request would
    // sign new bytes under an old identity; discarding it would spend a second
    // generation. Neither is safe, so it refuses.
    unlinkSync(paths!.manifest);
    unlinkSync(paths!.privateKey);
    const outcome = await ensureOperationalCertificate(deps(client));
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") {
      expect(outcome.detail).toMatch(/different operational key/);
    }
  });

  it("FAILS CLOSED on a corrupt key rather than re-keying", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    unlinkSync(paths!.manifest);
    writeFileSync(paths!.privateKey, "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----\n", {
      mode: 0o600,
    });
    const outcome = await ensureOperationalCertificate(deps(client));
    expect(outcome.kind).toBe("blocked");
  });

  it("the persisted request state contains no key material", async () => {
    const { client } = honestClient();
    await ensureOperationalCertificate(deps(client));
    const raw = readFileSync(paths!.requestState, "utf8");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("BEGIN");
    // The manifest is public metadata too.
    const manifest = readFileSync(paths!.manifest, "utf8");
    expect(manifest).not.toContain("PRIVATE KEY");
  });

  it("the proof of possession is made with the LOCAL key over the canonical bytes", async () => {
    const { client, calls } = honestClient();
    await ensureOperationalCertificate(deps(client));
    const state = readRequestState(paths)!;
    const publicKeyPem = createPublicKey(readFileSync(paths!.privateKey, "utf8"))
      .export({ type: "spki", format: "pem" })
      .toString();

    // Re-derived here rather than trusted: the fingerprint the request carries
    // must describe the key the Hub actually holds.
    const fingerprint = createHash("sha256")
      .update(new Uint8Array(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })))
      .digest("hex");
    expect(state.publicKeyFingerprint).toBe(fingerprint);

    expect(
      cryptoVerify(
        "sha256",
        Buffer.from(
          operationalCsrBytes({
            requestId: state.requestId,
            deviceRecordId: state.deviceRecordId,
            environment: state.environment,
            publicKeyFingerprint: state.publicKeyFingerprint,
            hardwareTrustLevel: state.hardwareTrustLevel,
            assignmentGeneration: state.assignmentGeneration,
            requestedPurpose: state.requestedPurpose,
            requestedAt: state.requestedAt,
            nonce: state.nonce,
            correlationId: state.correlationId,
          }),
        ),
        createPublicKey(publicKeyPem),
        Buffer.from(calls[0]!.proof, "base64"),
      ),
    ).toBe(true);
  });

  it("uses TRUSTED time as the request timestamp, not the host clock", async () => {
    const { client } = honestClient();
    const trusted = new Date("2026-08-28T11:22:33.444Z");
    await ensureOperationalCertificate({ ...deps(client), trustedTime: trusted });
    expect(readRequestState(paths)!.requestedAt).toBe(trusted.toISOString());
  });
});

describe("the device-side serial mapping", () => {
  it("matches the canonical minimal positive DER rule", () => {
    expect(x509SerialForCredentialSerial("DEV-0123456789ABCDEF")).toBe("0123456789abcdef");
    // R2-1: a leading zero byte is stripped, not doubled.
    expect(x509SerialForCredentialSerial("DEV-004C34C1A664C9E5")).toBe("4c34c1a664c9e5");
    // ...and a high leading bit gets exactly one sign byte.
    expect(x509SerialForCredentialSerial("DEV-FF34C1A664C9E512")).toBe("00ff34c1a664c9e512");
  });

  it("REFUSES a serial shape this path never issues (N-1)", () => {
    expect(() => x509SerialForCredentialSerial("SERIAL-XRACE-HUB-abc")).toThrow(
      /KLUY-SERIAL-UNSUPPORTED/,
    );
  });
});
