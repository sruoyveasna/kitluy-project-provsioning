/**
 * The durable primitives.
 *
 * A unit test cannot observe an fsync, so these assert the OBSERVABLE
 * properties an fsync exists to protect: a reader never sees a partial file, a
 * replace is all-or-nothing, a symlink swap leaves no window where the link is
 * missing, and no temp file survives a completed call. The fsync ordering
 * itself is argued in `durable-write.ts` and exercised for real by acceptance
 * test C, where the power actually goes away.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fsyncDir,
  fsyncTree,
  isDirectory,
  isFile,
  renameDurable,
  swapSymlinkDurable,
  writeDurable,
} from "../src/durable-write.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-durable-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("writeDurable", () => {
  it("writes the file with the requested mode", () => {
    const path = join(root, "a.json");
    writeDurable(path, "{}\n", 0o600);
    expect(readFileSync(path, "utf8")).toBe("{}\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("creates missing parent directories", () => {
    const path = join(root, "deep", "deeper", "a.json");
    writeDurable(path, "x");
    expect(readFileSync(path, "utf8")).toBe("x");
  });

  it("replaces an existing file completely", () => {
    const path = join(root, "a.json");
    writeDurable(path, "aaaaaaaaaaaaaaaaaaaa");
    writeDurable(path, "b");
    expect(readFileSync(path, "utf8")).toBe("b");
  });

  it("leaves no temp file behind", () => {
    writeDurable(join(root, "a.json"), "x");
    expect(readdirSync(root)).toEqual(["a.json"]);
  });
});

describe("swapSymlinkDurable", () => {
  it("creates a link that did not exist", () => {
    mkdirSync(join(root, "target-1"));
    swapSymlinkDurable(join(root, "current"), "target-1");
    expect(readlinkSync(join(root, "current"))).toBe("target-1");
  });

  it("replaces an existing link in place", () => {
    mkdirSync(join(root, "target-1"));
    mkdirSync(join(root, "target-2"));
    swapSymlinkDurable(join(root, "current"), "target-1");
    swapSymlinkDurable(join(root, "current"), "target-2");
    expect(readlinkSync(join(root, "current"))).toBe("target-2");
    expect(readdirSync(root).sort()).toEqual(["current", "target-1", "target-2"]);
  });

  it("clears a stale temp link left by an interrupted earlier swap", () => {
    mkdirSync(join(root, "target-1"));
    // Exactly what a crash between symlink() and rename() leaves behind.
    symlinkSync("garbage", join(root, "current.tmp"));
    swapSymlinkDurable(join(root, "current"), "target-1");
    expect(readlinkSync(join(root, "current"))).toBe("target-1");
    expect(existsSync(join(root, "current.tmp"))).toBe(false);
  });

  it("replaces a link that dangles", () => {
    symlinkSync("gone", join(root, "current"));
    mkdirSync(join(root, "target-1"));
    swapSymlinkDurable(join(root, "current"), "target-1");
    expect(readlinkSync(join(root, "current"))).toBe("target-1");
  });
});

describe("renameDurable", () => {
  it("moves a directory within one filesystem", () => {
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "a", "f.txt"), "x");
    renameDurable(join(root, "a"), join(root, "b"));
    expect(existsSync(join(root, "a"))).toBe(false);
    expect(readFileSync(join(root, "b", "f.txt"), "utf8")).toBe("x");
  });
});

describe("fsyncTree", () => {
  it("walks a tree without throwing", () => {
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "one.txt"), "1");
    writeFileSync(join(root, "a", "b", "two.txt"), "2");
    expect(() => {
      fsyncTree(join(root, "a"));
    }).not.toThrow();
  });

  it("does not follow symlinks out of the tree", () => {
    // The extractor refuses to create symlinks, so one here could only have
    // arrived by another route — fsyncing its target would reach outside.
    mkdirSync(join(root, "outside"));
    writeFileSync(join(root, "outside", "secret"), "x");
    mkdirSync(join(root, "tree"));
    symlinkSync(join(root, "outside"), join(root, "tree", "link"));
    expect(() => {
      fsyncTree(join(root, "tree"));
    }).not.toThrow();
    expect(lstatSync(join(root, "tree", "link")).isSymbolicLink()).toBe(true);
  });
});

describe("the predicates never throw", () => {
  it("report false for an absent path", () => {
    expect(isDirectory(join(root, "nope"))).toBe(false);
    expect(isFile(join(root, "nope"))).toBe(false);
  });

  it("tell a file from a directory", () => {
    mkdirSync(join(root, "d"));
    writeFileSync(join(root, "f"), "x");
    expect(isDirectory(join(root, "d"))).toBe(true);
    expect(isFile(join(root, "d"))).toBe(false);
    expect(isFile(join(root, "f"))).toBe(true);
    expect(isDirectory(join(root, "f"))).toBe(false);
  });

  it("fsyncDir throws on a path that is not there, rather than pretending", () => {
    // Deliberate: a silent success here would report an install as durable when
    // it is not, which is the one lie this module exists to prevent.
    expect(() => {
      fsyncDir(join(root, "nope"));
    }).toThrow();
  });
});
