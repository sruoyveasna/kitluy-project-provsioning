/**
 * Certificate fixtures for the firstboot verification and recovery matrices.
 *
 * node-forge is a DEV dependency here and never a runtime one — the packaging
 * gate refuses the image build if `dependencies` is non-empty, and it stays
 * empty. The agent itself uses `node:crypto` only; forge exists in this file
 * because `node:crypto` can PARSE X.509 and cannot ISSUE it, so a test needs
 * something that can mint the hostile cases.
 */
import { createHash, generateKeyPairSync } from "node:crypto";

import forge from "node-forge";

export interface TestChain {
  readonly rootPem: string;
  readonly rootSha256: string;
  readonly intermediatePem: string;
  readonly intermediateKeyPem: string;
  readonly chainPem: string;
}

export interface MintedLeaf {
  readonly certificatePem: string;
  readonly sha256: string;
  readonly serialHex: string;
}

const der = (pem: string): Buffer =>
  Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");

const sha256Hex = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

function rsa(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** A two-level development chain, shaped like the real one. */
export function buildChain(commonName = "KitLuy Development Root CA"): TestChain {
  const rootKey = rsa();
  const rootCert = forge.pki.createCertificate();
  rootCert.publicKey = forge.pki.publicKeyFromPem(rootKey.publicKeyPem);
  rootCert.serialNumber = "01";
  rootCert.validity.notBefore = new Date(Date.now() - 86_400_000);
  rootCert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  rootCert.setSubject([{ name: "commonName", value: commonName }]);
  rootCert.setIssuer([{ name: "commonName", value: commonName }]);
  rootCert.setExtensions([{ name: "basicConstraints", cA: true }]);
  rootCert.sign(forge.pki.privateKeyFromPem(rootKey.privateKeyPem), forge.md.sha256.create());
  const rootPem = forge.pki.certificateToPem(rootCert);

  const interKey = rsa();
  const interCert = forge.pki.createCertificate();
  interCert.publicKey = forge.pki.publicKeyFromPem(interKey.publicKeyPem);
  interCert.serialNumber = "02";
  interCert.validity.notBefore = new Date(Date.now() - 86_400_000);
  interCert.validity.notAfter = new Date(Date.now() + 180 * 86_400_000);
  interCert.setSubject([{ name: "commonName", value: "KitLuy Development Device Issuing CA" }]);
  interCert.setIssuer(rootCert.subject.attributes);
  interCert.setExtensions([{ name: "basicConstraints", cA: true, pathLenConstraint: 0 }]);
  interCert.sign(forge.pki.privateKeyFromPem(rootKey.privateKeyPem), forge.md.sha256.create());
  const intermediatePem = forge.pki.certificateToPem(interCert);

  return {
    rootPem,
    rootSha256: sha256Hex(der(rootPem)),
    intermediatePem,
    intermediateKeyPem: interKey.privateKeyPem,
    chainPem: `${intermediatePem.trim()}\n${rootPem.trim()}\n`,
  };
}

export interface LeafOptions {
  readonly chain: TestChain;
  readonly subjectPublicKeyPem: string;
  readonly deviceRecordId: string;
  readonly environment?: string;
  readonly credentialGeneration?: number;
  readonly serialHex?: string;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
  readonly signerKeyPem?: string;
  readonly ca?: boolean;
  readonly extendedKeyUsage?: { serverAuth?: boolean; clientAuth?: boolean };
}

/** A device leaf, shaped exactly like `signOperationalLeaf` produces. */
export function mintLeaf(options: LeafOptions): MintedLeaf {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(options.subjectPublicKeyPem);
  cert.serialNumber = options.serialHex ?? "0abcdef012345678";
  cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - 60_000);
  cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 30 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: `kitluy-device:${options.deviceRecordId}` }]);
  cert.setIssuer(forge.pki.certificateFromPem(options.chain.intermediatePem).subject.attributes);
  const environment = options.environment ?? "development";
  const generation = options.credentialGeneration ?? 1;
  const eku = options.extendedKeyUsage ?? { serverAuth: true, clientAuth: true };
  cert.setExtensions([
    { name: "basicConstraints", cA: options.ca ?? false, critical: true },
    { name: "keyUsage", critical: true, digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", ...eku },
    {
      name: "subjectAltName",
      altNames: [
        { type: 6, value: `kitluy-device://${options.deviceRecordId}` },
        { type: 6, value: `kitluy-generation://${String(generation)}` },
        { type: 6, value: `kitluy-environment://${environment}` },
      ],
    },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(
    forge.pki.privateKeyFromPem(options.signerKeyPem ?? options.chain.intermediateKeyPem),
    forge.md.sha256.create(),
  );
  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    certificatePem,
    sha256: sha256Hex(der(certificatePem)),
    serialHex: (options.serialHex ?? "0abcdef012345678").replace(/^0+(?=[0-9a-f])/, ""),
  };
}

export { rsa as testRsaKey };
