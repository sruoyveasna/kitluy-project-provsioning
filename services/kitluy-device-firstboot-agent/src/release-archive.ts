/**
 * Safe release-archive extraction (U1 requirement 2).
 *
 * ===========================================================================
 * A VALID SIGNATURE DOES NOT WAIVE SAFE EXTRACTION
 * ===========================================================================
 * By the time bytes reach this module they have been verified twice: an Ed25519
 * signature over the manifest, and a SHA-256 re-proven over the received bytes.
 * It would be easy to conclude that the archive is therefore trustworthy and
 * hand it to `tar -x`.
 *
 * That conclusion is wrong, and the owner said so explicitly. Signature
 * verification proves WHO PRODUCED the bytes; it proves nothing about what the
 * bytes DO when unpacked. A signing key can be misused, a build host can be
 * compromised, a packer can have a bug, and a release can be signed by someone
 * who did not read it. Extraction is the last place a malformed archive can be
 * stopped before it writes outside its release directory, and it is cheap to
 * stop it here.
 *
 * ===========================================================================
 * WHY A TAR READER IS IMPLEMENTED HERE AND `tar` IS NOT CALLED
 * ===========================================================================
 * The device HAS `/usr/bin/tar`, and shelling out would be less code. It is not
 * used, for one reason: system tar is a general tool that CAN create symlinks,
 * hard links, device nodes, setuid files and entries outside the destination,
 * and keeping it from doing so means getting a set of flags exactly right on a
 * version nobody pinned.
 *
 * This reader cannot do any of those things — not because it checks for them,
 * but because it contains no code that creates anything except a directory or a
 * regular file. The type checks below are a second line that names the refusal;
 * the first line is that the dangerous operation is unimplemented.
 *
 * ===========================================================================
 * GZIP, NOT ZSTD — A DEVICE CONSTRAINT, NOT A PREFERENCE
 * ===========================================================================
 * The U1 plan said `.tar.zst`. The device cannot do that in-process:
 *
 *     workstation   node 22.23.0   zlib.zstdDecompressSync  present
 *     Pi Terminal   node 18.20.4   zlib.zstdDecompressSync  ABSENT
 *
 * `nodejs` on the image is Debian bookworm's 18.20.4, and Node gained zstd in
 * 22.15. An extractor written against zstd would pass every test on the
 * workstation and fail on the board — the precise class of defect that costs a
 * bench session. Gzip is a Node built-in everywhere, and at a 280 KB payload the
 * ratio difference is not worth a second decompressor or a subprocess.
 *
 * A zstd archive is DETECTED by magic bytes and refused by name, so a future
 * packer that switches codecs gets a sentence that says what happened rather
 * than a parse error 512 bytes into a tar header.
 */
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** Every limit is a REFUSAL, never a truncation: a bounded archive or none. */
export const ARCHIVE_LIMITS = {
  /** The Device Shell payload is ~40 files; 4096 is generous and still bounded. */
  maxEntries: 4096,
  /** Total unpacked bytes. The payload is ~280 KB. */
  maxTotalBytes: 64 * 1024 * 1024,
  /** Any single file. */
  maxFileBytes: 32 * 1024 * 1024,
  /** Compressed input, checked before a single byte is inflated. */
  maxCompressedBytes: 16 * 1024 * 1024,
  /** Path length inside the archive. */
  maxPathLength: 200,
} as const;

export type ArchiveRefusal =
  | "ARCHIVE_EMPTY"
  | "ARCHIVE_COMPRESSED_TOO_LARGE"
  | "ARCHIVE_COMPRESSION_UNSUPPORTED"
  | "ARCHIVE_NOT_GZIP"
  | "ARCHIVE_DECOMPRESSION_FAILED"
  | "ARCHIVE_TRUNCATED"
  | "ARCHIVE_HEADER_CHECKSUM_INVALID"
  | "ARCHIVE_TOO_MANY_ENTRIES"
  | "ARCHIVE_TOO_LARGE"
  | "ARCHIVE_FILE_TOO_LARGE"
  | "ENTRY_NAME_EMPTY"
  | "ENTRY_NAME_TOO_LONG"
  | "ENTRY_NAME_ABSOLUTE"
  | "ENTRY_NAME_TRAVERSAL"
  | "ENTRY_NAME_UNSAFE_CHARACTER"
  | "ENTRY_ESCAPES_ROOT"
  | "ENTRY_TYPE_SYMLINK"
  | "ENTRY_TYPE_HARDLINK"
  | "ENTRY_TYPE_DEVICE"
  | "ENTRY_TYPE_FIFO"
  | "ENTRY_TYPE_EXTENDED_HEADER"
  | "ENTRY_TYPE_UNKNOWN"
  | "ENTRY_MODE_SETUID_SETGID"
  | "ENTRY_OWNERSHIP_NOT_ROOT";

export class ArchiveRefusedError extends Error {
  constructor(
    readonly refusal: ArchiveRefusal,
    detail: string,
  ) {
    super(`${refusal}: ${detail}`);
    this.name = "ArchiveRefusedError";
  }
}

const BLOCK = 512;
const GZIP_MAGIC = [0x1f, 0x8b];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function refuse(refusal: ArchiveRefusal, detail: string): never {
  throw new ArchiveRefusedError(refusal, detail);
}

/** Trailing NUL/space trimmed; tar pads fixed-width fields with both. */
function field(block: Buffer, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && block[end] !== 0) end += 1;
  return block
    .subarray(offset, end)
    .toString("ascii")
    .replace(/[\0 ]+$/u, "");
}

/** Octal numeric field. An unparseable field is zero, and callers refuse on it. */
function octal(block: Buffer, offset: number, length: number): number {
  const text = field(block, offset, length).trim();
  if (text === "") return 0;
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) && value >= 0 ? value : -1;
}

/**
 * The ustar header checksum: the sum of every byte with the checksum field
 * itself read as eight spaces. Verified because a corrupt header that still
 * parses is how a reader ends up trusting a size or a typeflag it should not.
 */
function headerChecksumValid(block: Buffer): boolean {
  const declared = octal(block, 148, 8);
  if (declared < 0) return false;
  let signed = 0;
  let unsigned = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    const byte = i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  // Some historic writers computed the sum with signed chars; both are accepted
  // for the CHECKSUM only, which is an integrity check and not a trust boundary.
  return declared === unsigned || declared === signed;
}

/**
 * Reject a path that could leave the destination, before it is ever joined.
 *
 * Checked on the archive's own spelling rather than on the resolved result,
 * because a refusal that names the offending entry is diagnosable and a silent
 * normalisation is not. The resolved-prefix check in `extractTarGz` runs
 * afterwards anyway — two independent checks, because this is the one place
 * where being wrong writes to an arbitrary path as root.
 */
export function assertSafeEntryName(name: string): void {
  if (name === "") refuse("ENTRY_NAME_EMPTY", "an archive entry has no name");
  if (name.length > ARCHIVE_LIMITS.maxPathLength) {
    refuse("ENTRY_NAME_TOO_LONG", `${name.slice(0, 60)}… is ${String(name.length)} characters`);
  }
  if (name.startsWith("/")) refuse("ENTRY_NAME_ABSOLUTE", name);
  // A Windows-style root or drive letter is not a path this reader will ever
  // produce, and accepting one on a Linux device means accepting a literal
  // backslash in a filename — never intended, always a mistake or an attack.
  if (name.includes("\\")) refuse("ENTRY_NAME_UNSAFE_CHARACTER", `${name} contains a backslash`);
  // A codepoint test rather than a regex: a character class of literal control
  // bytes is invisible in a diff, survives a copy-paste badly, and needs a lint
  // suppression. This says the same thing and can be read.
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      refuse("ENTRY_NAME_UNSAFE_CHARACTER", `${name} contains a control character`);
    }
  }
  for (const segment of name.split("/")) {
    if (segment === "..") refuse("ENTRY_NAME_TRAVERSAL", name);
  }
}

export interface ExtractedEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface ExtractionResult {
  readonly entries: readonly ExtractedEntry[];
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly directoryCount: number;
}

/**
 * Decompress and extract a gzipped tar into `root`, creating ONLY directories
 * and regular files, and refusing anything else.
 *
 * `root` must already exist and must be a directory the caller owns. Modes are
 * NOT taken from the archive: directories are created 0755 and files 0644, and
 * ownership is whatever the extracting process is (root) — the archive's uid,
 * gid and mode are read only so that an unexpected value can be REFUSED, never
 * so that it can be applied.
 */
export function extractTarGz(archive: Buffer, root: string): ExtractionResult {
  if (archive.length === 0) refuse("ARCHIVE_EMPTY", "zero bytes");
  if (archive.length > ARCHIVE_LIMITS.maxCompressedBytes) {
    refuse(
      "ARCHIVE_COMPRESSED_TOO_LARGE",
      `${String(archive.length)} bytes exceeds ${String(ARCHIVE_LIMITS.maxCompressedBytes)}`,
    );
  }
  if (ZSTD_MAGIC.every((byte, i) => archive[i] === byte)) {
    refuse(
      "ARCHIVE_COMPRESSION_UNSUPPORTED",
      "this is a zstd archive; the device runs node 18, which has no in-process zstd. Pack releases as .tar.gz",
    );
  }
  if (!GZIP_MAGIC.every((byte, i) => archive[i] === byte)) {
    refuse("ARCHIVE_NOT_GZIP", "the payload does not begin with the gzip magic bytes");
  }

  let tar: Buffer;
  try {
    // maxOutputLength makes a decompression bomb a refusal rather than an
    // out-of-memory kill, which on a device is a reboot loop.
    tar = gunzipSync(archive, { maxOutputLength: ARCHIVE_LIMITS.maxTotalBytes });
  } catch (error) {
    refuse("ARCHIVE_DECOMPRESSION_FAILED", String((error as Error).message ?? error));
  }

  const rootResolved = resolve(root);
  const entries: ExtractedEntry[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let offset = 0;
  let zeroBlocks = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;

    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      // Two consecutive zero blocks terminate a tar stream. Anything after them
      // is ignored rather than parsed: appended data is not part of the archive.
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;

    if (!headerChecksumValid(header)) {
      refuse("ARCHIVE_HEADER_CHECKSUM_INVALID", `at byte ${String(offset - BLOCK)}`);
    }

    const prefix = field(header, 345, 155);
    const rawName = field(header, 0, 100);
    const name = prefix === "" ? rawName : `${prefix}/${rawName}`;
    const mode = octal(header, 100, 8);
    const uid = octal(header, 108, 8);
    const gid = octal(header, 116, 8);
    const size = octal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0);

    if (size < 0) refuse("ARCHIVE_TRUNCATED", `${name} has an unparseable size field`);

    // --- type: everything that is not a plain file or a directory is refused,
    // --- named individually so the journal records WHICH kind arrived.
    // Written as a lookup rather than a switch because every refusal below is
    // `never`-returning, and a switch of unreachable cases reads as fallthrough
    // to both a linter and a person.
    const REFUSED_TYPES: Readonly<Record<string, ArchiveRefusal>> = {
      "1": "ENTRY_TYPE_HARDLINK",
      "2": "ENTRY_TYPE_SYMLINK",
      "3": "ENTRY_TYPE_DEVICE",
      "4": "ENTRY_TYPE_DEVICE",
      "6": "ENTRY_TYPE_FIFO",
      // pax/GNU extended headers carry a name or attributes in a DATA block that
      // overrides the NEXT header. That indirection is a classic escape vector,
      // and this packer never emits one.
      x: "ENTRY_TYPE_EXTENDED_HEADER",
      g: "ENTRY_TYPE_EXTENDED_HEADER",
      L: "ENTRY_TYPE_EXTENDED_HEADER",
      K: "ENTRY_TYPE_EXTENDED_HEADER",
    };
    // '0' and NUL are a regular file; '7' is a contiguous file, which every
    // reader treats as one; '5' is a directory. Nothing else may be created.
    const ALLOWED_TYPES = new Set(["0", "\0", "7", "5"]);

    const refusedType = REFUSED_TYPES[typeflag];
    if (refusedType !== undefined) {
      const link = field(header, 157, 100);
      refuse(refusedType, link === "" ? name : `${name} -> ${link}`);
    }
    if (!ALLOWED_TYPES.has(typeflag)) {
      refuse("ENTRY_TYPE_UNKNOWN", `${name} has typeflag '${typeflag}'`);
    }

    assertSafeEntryName(name);

    if (mode < 0 || (mode & 0o7000) !== 0) {
      refuse("ENTRY_MODE_SETUID_SETGID", `${name} declares mode ${mode.toString(8)}`);
    }
    // The packer writes root-owned entries. A non-zero owner means the archive
    // was not produced by the KitLuy packer, and ownership is never applied
    // from an archive in any case — so this refuses rather than ignores.
    if (uid !== 0 || gid !== 0) {
      refuse("ENTRY_OWNERSHIP_NOT_ROOT", `${name} declares uid=${String(uid)} gid=${String(gid)}`);
    }

    const destination = resolve(join(rootResolved, name));
    // The independent second check. `assertSafeEntryName` should make this
    // unreachable; it is here because "should" is not a guarantee and this is
    // the boundary that matters.
    if (destination !== rootResolved && !destination.startsWith(rootResolved + sep)) {
      refuse("ENTRY_ESCAPES_ROOT", `${name} resolves outside the release root`);
    }

    if (typeflag === "5") {
      mkdirSync(destination, { recursive: true, mode: 0o755 });
      directoryCount += 1;
      entries.push({ path: name, bytes: 0 });
      continue;
    }

    if (size > ARCHIVE_LIMITS.maxFileBytes) {
      refuse("ARCHIVE_FILE_TOO_LARGE", `${name} is ${String(size)} bytes`);
    }
    totalBytes += size;
    if (totalBytes > ARCHIVE_LIMITS.maxTotalBytes) {
      refuse("ARCHIVE_TOO_LARGE", `unpacked size passed ${String(ARCHIVE_LIMITS.maxTotalBytes)}`);
    }
    fileCount += 1;
    if (fileCount + directoryCount > ARCHIVE_LIMITS.maxEntries) {
      refuse("ARCHIVE_TOO_MANY_ENTRIES", `more than ${String(ARCHIVE_LIMITS.maxEntries)} entries`);
    }

    if (offset + size > tar.length) {
      refuse("ARCHIVE_TRUNCATED", `${name} declares ${String(size)} bytes past the end`);
    }
    const data = tar.subarray(offset, offset + size);
    // A file's parent may not have had its own header — tar does not require it.
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    writeFileSync(destination, data, { mode: 0o644 });
    entries.push({ path: name, bytes: size });

    // Data is padded to a 512-byte boundary.
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }

  if (entries.length === 0) refuse("ARCHIVE_EMPTY", "the archive contains no entries");
  return { entries, totalBytes, fileCount, directoryCount };
}
