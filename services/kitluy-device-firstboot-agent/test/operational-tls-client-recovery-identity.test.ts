/**
 * The firstboot operational TLS client attaches the recovery identity proof
 * (KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; registry group 0224).
 *
 * Kept apart from `operational-tls-client.test.ts` on purpose: that file is a
 * pinned refusal fixture in `scripts/verification/secret-scan.mjs`, exempt only
 * while its bytes are unchanged, and adding cases to it would silently widen
 * nothing but would re-open the finding.
 */
import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyRecoveryIdentityProof } from "@kitluy/device-identity";

import {
  ensureOperationalCertificate,
  x509SerialForCredentialSerial,
  type EnsureCertificateDeps,
  type IssuanceCallResult,
  type OperationalCertificateClient,
} from "../src/operational-tls-client.js";
import { operationalCsrBytes } from "../src/operational-csr-bytes.js";
import {
  fileRecoveryIdentitySigner,
  type RecoveryIdentityProof,
} from "../src/operational-recovery-identity-bytes.js";
import { buildChain, mintLeaf, type TestChain } from "./support/operational-fixtures.js";

const DEVICE = "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607";
const CREDENTIAL_SERIAL = "DEV-0ABCDEF012345678";

let dir: string;
let paths: EnsureCertificateDeps["paths"];
let chain: TestChain;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-optls-identity-"));
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

/** A registry that verifies possession and issues generation 1. */
function honestClient(): { client: OperationalCertificateClient; calls: number[] } {
  const calls: number[] = [];
  const client: OperationalCertificateClient = {
    request({ csr, operationalPublicKeyPem, proofOfPossessionBase64 }) {
      calls.push(calls.length + 1);
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
          outcome: "ISSUED",
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

function identitySigner(): ReturnType<typeof fileRecoveryIdentitySigner> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const keyPath = join(dir, "device-identity.key.pem");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
    mode: 0o600,
  });
  return fileRecoveryIdentitySigner(keyPath);
}

describe("the recovery identity proof", () => {
  it("attaches a proof over the exact request bytes, identical on a replay", async () => {
    const sent: Array<{ csrBytes: Uint8Array; identity: RecoveryIdentityProof | undefined }> = [];
    let first = true;
    const client: OperationalCertificateClient = {
      async request(input) {
        sent.push({ csrBytes: operationalCsrBytes(input.csr), identity: input.identity });
        if (first) {
          // A lost response: the next boot replays the persisted request.
          first = false;
          return { kind: "unreachable", detail: "lost response" };
        }
        return honestClient().client.request(input);
      },
    };
    const signer = identitySigner();

    const lost = await ensureOperationalCertificate({ ...deps(client), identitySigner: signer });
    expect(lost.kind).toBe("unreachable");
    const adopted = await ensureOperationalCertificate({ ...deps(client), identitySigner: signer });
    expect(adopted.kind).toBe("adopted");

    expect(sent).toHaveLength(2);
    const proof = sent[0]!.identity!;
    expect(sent[1]!.identity).toEqual(proof);
    expect(Buffer.from(sent[1]!.csrBytes)).toEqual(Buffer.from(sent[0]!.csrBytes));
    expect(
      verifyRecoveryIdentityProof(
        proof.identityPublicKeyPem,
        sent[0]!.csrBytes,
        new Uint8Array(Buffer.from(proof.identityProofBase64, "base64")),
      ).verified,
    ).toBe(true);
  });

  it("sends no identity proof without a signer, so first issuance is unchanged", async () => {
    const seen: Array<RecoveryIdentityProof | undefined> = [];
    const { client } = honestClient();
    const outcome = await ensureOperationalCertificate(
      deps({
        request(input) {
          seen.push(input.identity);
          return client.request(input);
        },
      }),
    );
    expect(outcome.kind).toBe("adopted");
    expect(seen).toEqual([undefined]);
  });

  it("is BLOCKED, with no network call, when the identity key cannot sign", async () => {
    const { client, calls } = honestClient();
    const outcome = await ensureOperationalCertificate({
      ...deps(client),
      identitySigner: fileRecoveryIdentitySigner(join(dir, "missing.key.pem")),
    });
    expect(outcome.kind).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
});
