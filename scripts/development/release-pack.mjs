#!/usr/bin/env node
/**
 * Pack and sign a DEVELOPMENT release artifact.
 *
 *   node scripts/development/release-pack.mjs --product device-shell --version 0.4.12
 *   node scripts/development/release-pack.mjs --product kitluy-terminal --version 0.1.0
 *
 * ===========================================================================
 * WHAT THIS PRODUCES, AND WHAT IT REFUSES
 * ===========================================================================
 * `release-publish.mjs` writes three files in `build/releases/<releaseId>/`:
 *
 *   artifact.tar.gz   the payload, root-owned, no symlinks, no setuid
 *   manifest.json     the signed release manifest body (v1)
 *   envelope.json     keyId, keyVersion, algorithm, detached Ed25519 signature
 *
 * Run on its own, this file PACKS and describes — it does not sign, because the
 * release id a manifest must carry is minted by the database at publish time
 * (see `packRelease`). It used to try, and crashed on a manifest it never built.
 *
 * It signs with the DEVELOPMENT release-signing key from the persistent dev PKI
 * (`pnpm pki:bootstrap-dev`), which lives OUTSIDE this repository. It refuses to
 * run against pilot or production material, refuses any environment but
 * `development`, and never copies a private key anywhere.
 *
 * ===========================================================================
 * TRACEABILITY IS NOT OPTIONAL (owner requirement §7)
 * ===========================================================================
 * `buildId` carries the git commit and a dirty flag. The image build manifest
 * records the UPSTREAM BUILDER's commit but has never recorded KitLuy's, so
 * until now nothing linked an artifact to the source that produced it. A dirty
 * tree is PACKED, not refused — that is the normal development case — but it is
 * recorded as dirty so a release that cannot be reproduced says so about itself.
 *
 * ===========================================================================
 * GZIP, NOT ZSTD
 * ===========================================================================
 * The device runs node 18.20.4 (Debian bookworm), which has no in-process zstd;
 * that arrived in node 22.15. The extractor refuses a zstd archive by name for
 * this reason, and this packer produces what the device can actually read.
 */
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BLOCK = 512;

/**
 * The products a release may carry — the device's own `PERMITTED_PRODUCTS`
 * (`release-store.ts`), and nothing wider: the Device Shell payload (OD-U1-2 =
 * C) and the POS application under its governed key `kitluy-terminal`
 * (KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001; T1-STORE-OPERATIONS-001).
 */
const PERMITTED_PRODUCTS = new Set(["device-shell", "kitluy-terminal"]);

/** Where each product's built payload comes from. */
const PRODUCT_SOURCES = {
  "device-shell": {
    workspace: "@kitluy-apps/kitluy-device-shell",
    /** Built output, relative to the app directory. */
    directory: "apps/kitluy-device-shell",
    include: ["package.json", "dist", "dist-electron"],
  },
  // NOT the app directory itself: the POS main process imports workspace
  // packages, and the device has no node_modules. `pnpm --filter
  // @kitluy-apps/kitluy-pos-desktop-app build:release-payload` bundles it into a
  // directory that runs under the image's pinned Electron with nothing else.
  "kitluy-terminal": {
    workspace: "@kitluy-apps/kitluy-pos-desktop-app",
    directory: "apps/kitluy-pos-desktop-app/release-payload",
    include: ["package.json", "dist", "dist-electron"],
  },
};

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    product: "device-shell",
    version: "",
    pkiDir: process.env.KITLUY_DEV_PKI_DIR ?? "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = argv[i + 1];
    if (argv[i] === "--product") {
      args.product = next ?? "";
      i += 1;
    } else if (argv[i] === "--version") {
      args.version = next ?? "";
      i += 1;
    } else if (argv[i] === "--pki-dir") {
      args.pkiDir = next ?? "";
      i += 1;
    } else if (argv[i] === "--out") {
      args.out = next ?? "";
      i += 1;
    }
  }
  if (!PERMITTED_PRODUCTS.has(args.product)) {
    die(
      `${args.product} is not a release product. Releases carry the Device Shell payload (OD-U1-2 = C) and the POS application kitluy-terminal; the bootstrap/runtime set stays image-only.`,
    );
  }
  if (args.version.trim() === "") die("--version is required and is never defaulted");
  if (args.pkiDir.trim() === "") {
    die(
      "no development PKI directory. Pass --pki-dir or set KITLUY_DEV_PKI_DIR (see `pnpm pki:bootstrap-dev`).",
    );
  }
  return args;
}

/** git provenance. A dirty tree is recorded, never silently ignored. */
export function buildId() {
  let commit = "unknown";
  let dirty = false;
  try {
    commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim() !== "";
  } catch {
    // Not a git checkout. Recorded as unknown rather than guessed.
  }
  return dirty ? `git-${commit}-dirty` : `git-${commit}`;
}

/**
 * A ustar writer that emits ONLY root-owned regular files and directories.
 *
 * Deliberately incapable of writing a symlink, a hard link, a device node or a
 * setuid bit — the same posture as the extractor on the device, from the other
 * side. A packer that cannot produce an unsafe archive is a better guarantee
 * than one that promises not to.
 */
export function writeTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    const isDirectory = entry.type === "directory";
    const header = Buffer.alloc(BLOCK);
    if (entry.name.length > 100) {
      die(`${entry.name} is longer than a ustar name field; U1 payloads keep paths short`);
    }
    header.write(entry.name, 0, 100, "ascii");
    header.write(
      `${(isDirectory ? 0o755 : 0o644).toString(8).padStart(7, "0")}\0`,
      100,
      8,
      "ascii",
    );
    header.write("0000000\0", 108, 8, "ascii"); // uid 0
    header.write("0000000\0", 116, 8, "ascii"); // gid 0
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    // A FIXED mtime, so the same input produces the same bytes and the same
    // digest. A clock read here would make every build unreproducible.
    header.write("00000000000\0", 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii");
    header.write(isDirectory ? "5" : "0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i];
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header);
    if (!isDirectory && content.length > 0) {
      const padded = Buffer.alloc(Math.ceil(content.length / BLOCK) * BLOCK);
      content.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

/** Collect a payload tree, sorted so the archive is byte-reproducible. */
export function collectPayload(root, include) {
  const entries = [];
  const walk = (absolute, relativePath) => {
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (relativePath !== "") entries.push({ name: `${relativePath}/`, type: "directory" });
      for (const child of readdirSync(absolute).sort()) {
        walk(join(absolute, child), relativePath === "" ? child : `${relativePath}/${child}`);
      }
      return;
    }
    if (!stat.isFile()) {
      // A symlink or anything else in the build output would be refused by the
      // device extractor anyway; refuse here, where the message is useful.
      die(
        `${relativePath} is not a regular file; a release payload carries files and directories only`,
      );
    }
    entries.push({ name: relativePath, type: "file", content: readFileSync(absolute) });
  };
  for (const item of include) {
    const absolute = join(root, item);
    if (!existsSync(absolute))
      die(`${relative(REPO_ROOT, absolute)} is absent — build the product first`);
    walk(absolute, item);
  }
  return entries;
}

function loadSigningKey(pkiDir) {
  const keyPath = join(pkiDir, "dev-release-signing.key.pem");
  const recordPath = join(pkiDir, "dev-release-signing.json");
  if (!existsSync(keyPath) || !existsSync(recordPath)) {
    die(
      `no release-signing key in ${pkiDir}. Run \`pnpm pki:bootstrap-dev\` against a NEW directory, or point --pki-dir at the one that has it.`,
    );
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.purpose !== "release_signing") {
    die(
      `${recordPath} declares purpose ${record.purpose}; only release_signing may sign a release manifest`,
    );
  }
  if (record.environment !== "development" || record.productionEligible !== false) {
    die(
      `${recordPath} is not development, non-production material. This tool signs development releases only.`,
    );
  }
  return { privateKey: createPrivateKey(readFileSync(keyPath, "utf8")), record };
}

const US = String.fromCharCode(0x1f);
const RS = String.fromCharCode(0x1e);

/** MUST match @kitluy/device-identity and the device mirror, byte for byte. */
export function canonicalReleaseManifestBytes(body) {
  const strings = [
    body.releaseId,
    body.productKey,
    body.version,
    body.buildId,
    body.architecture,
    body.hardwareProfile,
    body.environment,
    body.channel,
    body.artifactDigestSha256,
    body.rollbackReleaseId,
  ];
  for (const value of strings) {
    if (value.includes(US) || value.includes(RS))
      die("a manifest field carries a canonical separator");
  }
  const fields = [
    `kitluy.release-manifest.v${body.manifestVersion}`,
    body.releaseId,
    body.productKey,
    body.version,
    body.buildId,
    body.architecture,
    body.hardwareProfile,
    body.environment,
    body.channel,
    body.artifactDigestSha256,
    String(body.artifactSizeBytes),
    String(body.minSchemaVersion),
    String(body.maxSchemaVersion),
    String(body.configPrerequisiteVersion),
    body.rollbackReleaseId,
  ];
  return new TextEncoder().encode(fields.join(RS) + RS);
}

/**
 * Pack the payload and describe it — everything EXCEPT the release id.
 *
 * THE RELEASE ID IS THE DATABASE'S, NOT THE PACKER'S. An earlier version of this
 * file minted `<product>-<version>-<digest12>` here and signed it, which cannot
 * work: `create_release_draft_v1` generates `release_artifacts.id` as a uuid,
 * and `current_device_assignment_v1` hands that uuid to the device AS the
 * manifest's `releaseId`. The signature would have covered one id while the
 * device checked another, and every genuine release would have been refused
 * `ASSIGNMENT_RELEASE_ID_MISMATCH`.
 *
 * So the order is: pack -> create the draft -> take the uuid -> build the
 * manifest around it -> sign -> promote -> assign. `release-publish.mjs` walks
 * exactly that, and `buildManifest` below is the join between the two halves.
 */
export function packRelease(options) {
  const source = PRODUCT_SOURCES[options.product];
  const payloadRoot = join(REPO_ROOT, source.directory);
  const archive = gzipSync(writeTar(collectPayload(payloadRoot, source.include)), { level: 9 });
  return {
    archive,
    productKey: options.product,
    version: options.version,
    buildId: options.buildId ?? buildId(),
    architecture: "arm64",
    hardwareProfile: options.hardwareProfile ?? "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: createHash("sha256").update(archive).digest("hex"),
    artifactSizeBytes: archive.length,
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: options.rollbackReleaseId ?? "",
  };
}

/** The signed manifest body, once the database has minted the release id. */
export function buildManifest(packed, releaseId) {
  return {
    manifestVersion: 1,
    releaseId,
    productKey: packed.productKey,
    version: packed.version,
    buildId: packed.buildId,
    architecture: packed.architecture,
    hardwareProfile: packed.hardwareProfile,
    environment: packed.environment,
    channel: packed.channel,
    artifactDigestSha256: packed.artifactDigestSha256,
    artifactSizeBytes: packed.artifactSizeBytes,
    minSchemaVersion: packed.minSchemaVersion,
    maxSchemaVersion: packed.maxSchemaVersion,
    configPrerequisiteVersion: packed.configPrerequisiteVersion,
    rollbackReleaseId: packed.rollbackReleaseId,
  };
}

export function signManifest(manifest, privateKey, record) {
  return {
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    algorithm: "ed25519",
    signature: Buffer.from(
      edSign(null, canonicalReleaseManifestBytes(manifest), privateKey),
    ).toString("base64"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // The key is still LOADED, so a pack run refuses exactly where a publish would
  // (wrong purpose, wrong environment) — it is just not used: see the header.
  loadSigningKey(resolve(args.pkiDir));
  const packed = packRelease(args);
  const { archive, ...description } = packed;

  const outDir =
    args.out ??
    join(REPO_ROOT, "build", "releases", `packed-${packed.productKey}-${packed.version}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "artifact.tar.gz"), archive);
  writeFileSync(join(outDir, "packed.json"), `${JSON.stringify(description, null, 2)}\n`);

  console.log(`[release-pack]   product   ${packed.productKey} ${packed.version}`);
  console.log(`[release-pack]   build     ${packed.buildId}`);
  console.log(`[release-pack]   digest    ${packed.artifactDigestSha256}`);
  console.log(`[release-pack]   size      ${packed.artifactSizeBytes} bytes`);
  console.log(
    `[release-pack]   out       ${relative(REPO_ROOT, outDir)} (UNSIGNED — publish signs)`,
  );
  if (packed.buildId.endsWith("-dirty")) {
    console.log(
      "[release-pack] NOTE: the working tree is dirty, so this artifact is not reproducible from a commit.",
    );
  }
}

/**
 * The ASSIGNMENT canonical bytes (group 0222) — a SECOND signed statement.
 *
 * MUST match `canonicalReleaseAssignmentBytes` in the device mirror byte for
 * byte. The leading domain tag differs from the manifest's, which is what makes
 * signing both with one key safe: neither signature can be replayed as the
 * other.
 */
export function canonicalReleaseAssignmentBytes(binding) {
  const strings = [binding.assignmentId, binding.deviceId, binding.releaseId, binding.environment];
  for (const value of strings) {
    if (value.includes(US) || value.includes(RS)) {
      die("an assignment binding field carries a canonical separator");
    }
  }
  const fields = [
    "kitluy.release-assignment.v1",
    binding.assignmentId,
    binding.deviceId,
    binding.releaseId,
    String(binding.assignmentSequence),
    binding.environment,
  ];
  return new TextEncoder().encode(fields.join(RS) + RS);
}

/** Sign an assignment binding with the development release-signing key. */
export function signAssignment(binding, privateKey, record) {
  return {
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    algorithm: "ed25519",
    signature: Buffer.from(
      edSign(null, canonicalReleaseAssignmentBytes(binding), privateKey),
    ).toString("base64"),
  };
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("release-pack.mjs")) main();
