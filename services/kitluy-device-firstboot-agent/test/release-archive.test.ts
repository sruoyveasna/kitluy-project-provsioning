/**
 * Safe extraction (U1 requirement 2).
 *
 * Every refusal the owner listed gets a test that BUILDS the malicious archive
 * rather than asserting on a mock: a path-traversal test that never produces a
 * `../` entry proves nothing. The tar writer below is deliberately permissive —
 * it will happily emit a symlink, a device node, a setuid file or an absolute
 * path, because the extractor is the thing under test and it needs real input.
 *
 * After every refusal the suite asserts the destination is still EMPTY. A
 * refusal that has already written half a payload is not a refusal.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArchiveRefusedError, ARCHIVE_LIMITS, extractTarGz } from "../src/release-archive.js";

const BLOCK = 512;

interface TarEntry {
  name: string;
  content?: string;
  /** '0' file, '5' dir, '2' symlink, '1' hardlink, '3'/'4' device, '6' fifo… */
  typeflag?: string;
  mode?: number;
  uid?: number;
  gid?: number;
  linkname?: string;
  /** Override the size field, to build a truncated archive. */
  declaredSize?: number;
  /** Corrupt the header checksum on purpose. */
  breakChecksum?: boolean;
}

/** A minimal ustar writer with no safety of its own — that is the point. */
function buildTar(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "", "utf8");
    const size = entry.declaredSize ?? (entry.typeflag === "5" ? 0 : content.length);
    const header = Buffer.alloc(BLOCK);
    const write = (text: string, offset: number, length: number): void => {
      header.write(text.slice(0, length), offset, length, "ascii");
    };
    const octal = (value: number, offset: number, length: number): void => {
      write(value.toString(8).padStart(length - 1, "0"), offset, length);
    };
    write(entry.name, 0, 100);
    octal(entry.mode ?? 0o644, 100, 8);
    octal(entry.uid ?? 0, 108, 8);
    octal(entry.gid ?? 0, 116, 8);
    octal(size, 124, 12);
    octal(0, 136, 12);
    header.write("        ", 148, 8, "ascii"); // checksum placeholder
    header.write(entry.typeflag ?? "0", 156, 1, "ascii");
    write(entry.linkname ?? "", 157, 100);
    write("ustar", 257, 6);
    write("00", 263, 2);

    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    if (entry.breakChecksum === true) sum += 1;
    write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);

    blocks.push(header);
    if (size > 0 && entry.declaredSize === undefined) {
      const padded = Buffer.alloc(Math.ceil(content.length / BLOCK) * BLOCK);
      content.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(BLOCK * 2)); // end-of-archive
  return Buffer.concat(blocks);
}

function gz(entries: readonly TarEntry[]): Buffer {
  return gzipSync(buildTar(entries));
}

const SAFE: readonly TarEntry[] = [
  { name: "package.json", content: '{"main":"index.js"}' },
  { name: "index.js", content: "console.log(1);" },
  { name: "sub", typeflag: "5" },
  { name: "sub/nested.txt", content: "hello" },
];

let root: string;
let destination: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-archive-"));
  destination = join(root, "payload");
  mkdirSync(destination, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Nothing may exist in the destination after a refusal. */
function expectDestinationEmpty(): void {
  expect(readdirSync(destination)).toEqual([]);
}

function refusalOf(archive: Buffer): string {
  try {
    extractTarGz(archive, destination);
  } catch (error) {
    if (error instanceof ArchiveRefusedError) return error.refusal;
    throw error;
  }
  throw new Error("extraction was expected to be refused and was not");
}

describe("extractTarGz — the happy path", () => {
  it("extracts files and directories, and nothing else", () => {
    const result = extractTarGz(gz(SAFE), destination);
    expect(result.fileCount).toBe(3);
    expect(result.directoryCount).toBe(1);
    expect(readFileSync(join(destination, "index.js"), "utf8")).toBe("console.log(1);");
    expect(readFileSync(join(destination, "sub", "nested.txt"), "utf8")).toBe("hello");
  });

  it("forces safe modes regardless of what the archive asked for", () => {
    // 0777 is not setuid, so it is not refused — but it is not applied either.
    extractTarGz(gz([{ name: "index.js", content: "x", mode: 0o777 }]), destination);
    expect(statSync(join(destination, "index.js")).mode & 0o7777).toBe(0o644);
  });

  it("creates a parent directory the archive never declared", () => {
    extractTarGz(gz([{ name: "deep/deeper/file.txt", content: "x" }]), destination);
    expect(readFileSync(join(destination, "deep", "deeper", "file.txt"), "utf8")).toBe("x");
  });
});

describe("extractTarGz — archive escape", () => {
  it("refuses an absolute path", () => {
    expect(refusalOf(gz([{ name: "/etc/passwd", content: "x" }]))).toBe("ENTRY_NAME_ABSOLUTE");
    expectDestinationEmpty();
  });

  it("refuses .. traversal", () => {
    expect(refusalOf(gz([{ name: "../escaped.txt", content: "x" }]))).toBe("ENTRY_NAME_TRAVERSAL");
    expectDestinationEmpty();
  });

  it("refuses .. buried in the middle of a path", () => {
    expect(refusalOf(gz([{ name: "a/b/../../../out.txt", content: "x" }]))).toBe(
      "ENTRY_NAME_TRAVERSAL",
    );
    expectDestinationEmpty();
  });

  it("refuses traversal through the ustar prefix field", () => {
    // The prefix is prepended to the name, so a clean name can still escape.
    const archive = buildTar([{ name: "file.txt", content: "x" }]);
    archive.write("..", 345, 155, "ascii");
    // Recompute the checksum so the entry is otherwise valid.
    archive.write("        ", 148, 8, "ascii");
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += archive[i] ?? 0;
    archive.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    expect(refusalOf(gzipSync(archive))).toBe("ENTRY_NAME_TRAVERSAL");
    expectDestinationEmpty();
  });

  it("refuses a backslash in a name", () => {
    expect(refusalOf(gz([{ name: "a\\b.txt", content: "x" }]))).toBe("ENTRY_NAME_UNSAFE_CHARACTER");
  });

  it("refuses a control character in a name", () => {
    expect(refusalOf(gz([{ name: `a${String.fromCharCode(1)}b.txt`, content: "x" }]))).toBe(
      "ENTRY_NAME_UNSAFE_CHARACTER",
    );
  });

  it("refuses an over-long name", () => {
    // The ustar `name` field is only 100 bytes, so a path longer than that can
    // ONLY arrive as prefix + "/" + name. Building it any other way just gets
    // truncated by the writer and tests nothing — which is how this test failed
    // the first time it was run.
    const archive = buildTar([{ name: "b".repeat(60), content: "x" }]);
    archive.write("a".repeat(150), 345, 155, "ascii");
    archive.write("        ", 148, 8, "ascii");
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += archive[i] ?? 0;
    archive.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    // 150 + 1 + 60 = 211 characters, past the 200 bound.
    expect(ARCHIVE_LIMITS.maxPathLength).toBeLessThan(211);
    expect(refusalOf(gzipSync(archive))).toBe("ENTRY_NAME_TOO_LONG");
    expectDestinationEmpty();
  });
});

describe("extractTarGz — unsafe entry types", () => {
  it("refuses a symlink", () => {
    expect(refusalOf(gz([{ name: "link", typeflag: "2", linkname: "/etc/shadow" }]))).toBe(
      "ENTRY_TYPE_SYMLINK",
    );
    expectDestinationEmpty();
  });

  it("refuses a symlink even when its target looks harmless", () => {
    expect(refusalOf(gz([{ name: "link", typeflag: "2", linkname: "index.js" }]))).toBe(
      "ENTRY_TYPE_SYMLINK",
    );
  });

  it("refuses a hard link", () => {
    expect(refusalOf(gz([{ name: "hard", typeflag: "1", linkname: "/etc/shadow" }]))).toBe(
      "ENTRY_TYPE_HARDLINK",
    );
    expectDestinationEmpty();
  });

  it("refuses a character device", () => {
    expect(refusalOf(gz([{ name: "dev", typeflag: "3" }]))).toBe("ENTRY_TYPE_DEVICE");
  });

  it("refuses a block device", () => {
    expect(refusalOf(gz([{ name: "dev", typeflag: "4" }]))).toBe("ENTRY_TYPE_DEVICE");
  });

  it("refuses a fifo", () => {
    expect(refusalOf(gz([{ name: "pipe", typeflag: "6" }]))).toBe("ENTRY_TYPE_FIFO");
  });

  it("refuses a pax extended header", () => {
    expect(refusalOf(gz([{ name: "pax", typeflag: "x", content: "30 path=../escape\n" }]))).toBe(
      "ENTRY_TYPE_EXTENDED_HEADER",
    );
    expectDestinationEmpty();
  });

  it("refuses a GNU long-name header", () => {
    expect(refusalOf(gz([{ name: "././@LongLink", typeflag: "L", content: "../escape" }]))).toBe(
      "ENTRY_TYPE_EXTENDED_HEADER",
    );
  });

  it("refuses an unknown typeflag", () => {
    expect(refusalOf(gz([{ name: "odd", typeflag: "Z" }]))).toBe("ENTRY_TYPE_UNKNOWN");
  });
});

describe("extractTarGz — ownership and mode", () => {
  it("refuses setuid", () => {
    expect(refusalOf(gz([{ name: "s", content: "x", mode: 0o4755 }]))).toBe(
      "ENTRY_MODE_SETUID_SETGID",
    );
    expectDestinationEmpty();
  });

  it("refuses setgid", () => {
    expect(refusalOf(gz([{ name: "s", content: "x", mode: 0o2755 }]))).toBe(
      "ENTRY_MODE_SETUID_SETGID",
    );
  });

  it("refuses the sticky bit", () => {
    expect(refusalOf(gz([{ name: "s", content: "x", mode: 0o1755 }]))).toBe(
      "ENTRY_MODE_SETUID_SETGID",
    );
  });

  it("refuses an entry owned by somebody other than root", () => {
    expect(refusalOf(gz([{ name: "f", content: "x", uid: 1000, gid: 1000 }]))).toBe(
      "ENTRY_OWNERSHIP_NOT_ROOT",
    );
    expectDestinationEmpty();
  });
});

describe("extractTarGz — size and count bounds", () => {
  it("refuses a compressed payload over the bound before decompressing", () => {
    const oversized = Buffer.alloc(ARCHIVE_LIMITS.maxCompressedBytes + 1);
    oversized[0] = 0x1f;
    oversized[1] = 0x8b;
    expect(refusalOf(oversized)).toBe("ARCHIVE_COMPRESSED_TOO_LARGE");
  });

  it("refuses a decompression bomb rather than exhausting memory", () => {
    // ~80 MiB of zeroes compresses to a few KB and exceeds maxTotalBytes.
    const bomb = gzipSync(Buffer.alloc(ARCHIVE_LIMITS.maxTotalBytes + BLOCK));
    expect(refusalOf(bomb)).toBe("ARCHIVE_DECOMPRESSION_FAILED");
  });

  it("refuses too many entries", () => {
    const many = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 2 }, (_unused, i) => ({
      name: `f${String(i)}.txt`,
      content: "x",
    }));
    expect(refusalOf(gz(many))).toBe("ARCHIVE_TOO_MANY_ENTRIES");
  });

  it("refuses a truncated archive", () => {
    expect(refusalOf(gz([{ name: "f.txt", declaredSize: 4096 }]))).toBe("ARCHIVE_TRUNCATED");
  });

  it("refuses an empty archive", () => {
    expect(refusalOf(gzipSync(Buffer.alloc(BLOCK * 2)))).toBe("ARCHIVE_EMPTY");
  });
});

describe("extractTarGz — integrity and format", () => {
  it("refuses a corrupt header checksum", () => {
    expect(refusalOf(gz([{ name: "f.txt", content: "x", breakChecksum: true }]))).toBe(
      "ARCHIVE_HEADER_CHECKSUM_INVALID",
    );
    expectDestinationEmpty();
  });

  it("refuses a zstd archive by name, because the device cannot decompress it", () => {
    const zstd = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00]);
    expect(refusalOf(zstd)).toBe("ARCHIVE_COMPRESSION_UNSUPPORTED");
  });

  it("refuses something that is not gzip at all", () => {
    expect(refusalOf(Buffer.from("not an archive"))).toBe("ARCHIVE_NOT_GZIP");
  });

  it("ignores data appended after the end-of-archive marker", () => {
    const valid = buildTar([{ name: "package.json", content: "{}" }]);
    const appended = Buffer.concat([valid, buildTar([{ name: "../evil", content: "x" }])]);
    const result = extractTarGz(gzipSync(appended), destination);
    expect(result.fileCount).toBe(1);
    expect(readdirSync(destination)).toEqual(["package.json"]);
  });
});
