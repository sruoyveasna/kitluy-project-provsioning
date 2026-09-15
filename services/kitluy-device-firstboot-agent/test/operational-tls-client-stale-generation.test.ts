/**
 * A saved certificate request made at an assignment generation the device no
 * longer holds is rebuilt — same key, new request id — and never replayed again.
 *
 * Authority: owner task REFLASH-HARDENING-001; registry group 0226;
 * KLREC-2026-09-15-HUB-REQUEST-ASSIGNMENT-GENERATION-001. On hardware
 * (2026-09-15) a re-paired Store Hub replayed a request persisted at
 * generation 1 while the cloud held generation 3, and every replay was refused
 * KLUY-CRED-STALE-ASSIGNMENT.
 *
 * Kept apart from `operational-tls-client.test.ts`: that file is a pinned
 * refusal fixture in `scripts/verification/secret-scan.mjs`.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureOperationalCertificate,
  x509SerialForCredentialSerial,
  type EnsureCertificateDeps,
  type IssuanceCallResult,
  type OperationalCertificateClient,
} from "../src/operational-tls-client.js";
import { operationalCsrBytes, type OperationalCsrFields } from "../src/operational-csr-bytes.js";
import { buildChain, mintLeaf, type TestChain } from "./support/operational-fixtures.js";

const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const CREDENTIAL_SERIAL = "DEV-0ABCDEF012345678";
/** The generation the cloud holds for the re-paired device. */
const CURRENT = 3;

let dir: string;
let paths: NonNullable<EnsureCertificateDeps["paths"]>;
let chain: TestChain;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-optls-stale-generation-"));
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
 * A registry that holds the device at generation CURRENT: it refuses any other
 * generation exactly as issuance does, and issues against the current one.
 * `lose` answers unreachable for the first N calls — a lost response.
 */
function registry(options: { lose?: number } = {}) {
  const sent: OperationalCsrFields[] = [];
  let lose = options.lose ?? 0;
  const client: OperationalCertificateClient = {
    request({ csr, operationalPublicKeyPem, proofOfPossessionBase64 }) {
      sent.push(csr);
      if (lose > 0) {
        lose -= 1;
        return Promise.resolve<IssuanceCallResult>({
          kind: "unreachable",
          detail: "lost response",
        });
      }
      if (csr.assignmentGeneration !== CURRENT) {
        return Promise.resolve<IssuanceCallResult>({
          kind: "refused",
          refusal: {
            refusalCode: "OPCERT_RECOVERY_REFUSED",
            detail: `KLUY-RECOVERY-STALE-ASSIGNMENT: request carries assignment generation ${String(
              csr.assignmentGeneration,
            )}, device is at ${String(CURRENT)}; nothing was reserved`,
            retryable: false,
          },
        });
      }
      const verified = cryptoVerify(
        "sha256",
        Buffer.from(operationalCsrBytes(csr)),
        createPublicKey(operationalPublicKeyPem),
        Buffer.from(proofOfPossessionBase64, "base64"),
      );
      expect(verified).toBe(true);
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
          credentialId: "c0000000-0000-4000-8000-000000000002",
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
  return { client, sent };
}

function deps(
  client: OperationalCertificateClient,
  assignmentGeneration: number,
  replaced: Array<{ fromGeneration: number; toGeneration: number; staleRequestId: string }> = [],
): EnsureCertificateDeps {
  return {
    client,
    deviceRecordId: DEVICE,
    environment: "development",
    hardwareTrustLevel: "development_software",
    assignmentGeneration,
    trustedTime: new Date(),
    expectedRootSha256: chain.rootSha256,
    paths,
    onStaleRequestReplaced: (change) => replaced.push(change),
  };
}

function savedRequest(): {
  requestId: string;
  assignmentGeneration: number;
  publicKeyFingerprint: string;
} {
  return JSON.parse(readFileSync(paths.requestState, "utf8")) as {
    requestId: string;
    assignmentGeneration: number;
    publicKeyFingerprint: string;
  };
}

describe("a saved request for a generation the device no longer holds", () => {
  it("is rebuilt with the SAME key and a NEW request id, and the device adopts", async () => {
    const { client, sent } = registry();
    const replaced: Array<{
      fromGeneration: number;
      toGeneration: number;
      staleRequestId: string;
    }> = [];

    // The hardware run: the board asked at generation 1 after re-pairing at 3.
    const stale = await ensureOperationalCertificate(deps(client, 1, replaced));
    expect(stale.kind).toBe("refused");
    const before = savedRequest();
    expect(before.assignmentGeneration).toBe(1);

    // The paired identity now states generation 3.
    const outcome = await ensureOperationalCertificate(deps(client, CURRENT, replaced));
    expect(outcome.kind, JSON.stringify(outcome)).toBe("adopted");

    expect(replaced).toEqual([
      { fromGeneration: 1, toGeneration: CURRENT, staleRequestId: before.requestId },
    ]);
    expect(sent).toHaveLength(2);
    const rebuilt = sent[1]!;
    expect(rebuilt.assignmentGeneration).toBe(CURRENT);
    expect(rebuilt.requestId).not.toBe(before.requestId);
    expect(rebuilt.nonce).not.toBe(sent[0]!.nonce);
    // The key survives: group 0226 refuses a stale generation before it registers
    // one, so nothing about this key was spent.
    expect(rebuilt.publicKeyFingerprint).toBe(before.publicKeyFingerprint);
    if (outcome.kind === "adopted") {
      expect(outcome.manifest.publicKeyFingerprint).toBe(before.publicKeyFingerprint);
    }
  });

  it("is persisted before the call, so the stale request can never be sent again", async () => {
    // The registry is unreachable for the rebuilt request: the next boot must
    // replay the REBUILT request, not the stale one.
    const { client, sent } = registry();
    await ensureOperationalCertificate(deps(client, 1));
    const stale = savedRequest();

    const unreachable = registry({ lose: 1 });
    const lost = await ensureOperationalCertificate(deps(unreachable.client, CURRENT));
    expect(lost.kind).toBe("unreachable");
    const rebuilt = savedRequest();
    expect(rebuilt.assignmentGeneration).toBe(CURRENT);
    expect(rebuilt.requestId).not.toBe(stale.requestId);

    const replaced: Array<{
      fromGeneration: number;
      toGeneration: number;
      staleRequestId: string;
    }> = [];
    const adopted = await ensureOperationalCertificate(deps(unreachable.client, CURRENT, replaced));
    expect(adopted.kind, JSON.stringify(adopted)).toBe("adopted");
    expect(replaced).toEqual([]);
    expect(unreachable.sent.map((c) => c.requestId)).toEqual([
      rebuilt.requestId,
      rebuilt.requestId,
    ]);
    expect(sent.every((c) => c.requestId === stale.requestId)).toBe(true);
    expect(unreachable.sent.some((c) => c.requestId === stale.requestId)).toBe(false);
  });
});

describe("a lost response at the SAME generation is still a byte-identical replay", () => {
  it("replays the persisted request unchanged and does not rebuild it", async () => {
    const { client, sent } = registry({ lose: 1 });
    const replaced: Array<{
      fromGeneration: number;
      toGeneration: number;
      staleRequestId: string;
    }> = [];

    const lost = await ensureOperationalCertificate(deps(client, CURRENT, replaced));
    expect(lost.kind).toBe("unreachable");
    const adopted = await ensureOperationalCertificate(deps(client, CURRENT, replaced));
    expect(adopted.kind, JSON.stringify(adopted)).toBe("adopted");

    expect(replaced).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(Buffer.from(operationalCsrBytes(sent[1]!))).toEqual(
      Buffer.from(operationalCsrBytes(sent[0]!)),
    );
  });
});
