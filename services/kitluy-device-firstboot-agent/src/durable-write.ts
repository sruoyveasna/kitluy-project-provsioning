/**
 * Durable filesystem primitives for the release path (U1 requirement 3).
 *
 * ===========================================================================
 * WHY THIS MODULE EXISTS, AND WHY IT SAYS "DURABLE" AND NOT "ATOMIC"
 * ===========================================================================
 * `rename(2)` is ATOMIC with respect to a concurrent reader: nobody ever sees a
 * half-renamed path. It is NOT DURABLE: until the containing DIRECTORY is
 * fsynced, the rename lives only in the kernel's dirty page cache, and a power
 * cut can lose it while the file it renamed is already on the platter. On an
 * appliance that is pulled from the wall rather than shut down, that window is
 * not theoretical.
 *
 * The U1 plan originally said only "atomic switch, by rename(2)". That was not
 * enough, and this module is the correction: every operation here ends with the
 * containing directory fsynced, so a completed call is a fact that survives the
 * power going away in the next instant.
 *
 * ===========================================================================
 * THE DISCIPLINE IS NOT NEW — IT IS EXTRACTED
 * ===========================================================================
 * `pairing-state.ts`, `bootstrap-state.ts`, `installation.ts` and
 * `operational-credential-state.ts` each already do
 *
 *     write temp -> fsync file -> rename -> fsync dir
 *
 * by hand, as four separate copies. This is that sequence, written once, for
 * the release path to use. The existing copies are deliberately NOT changed
 * here: they are correct, they are covered by their own suites, and rewriting
 * four working modules is not what U1 was authorised to do.
 *
 * (One module is NOT correct and is recorded rather than fixed: `edge-session.ts`
 * renames `edge-status.json` WITHOUT the directory fsync, so that file is atomic
 * but not durable. It is display state, the U1 scope fence excludes it, and it
 * is named here so the next person finds it rather than rediscovers it.)
 *
 * ===========================================================================
 * WHY SYNCHRONOUS
 * ===========================================================================
 * Every caller is a sequenced step in a crash-recovery protocol where the ORDER
 * of the syscalls is the correctness argument. Synchronous calls make that order
 * visible in the source and impossible to reorder by accident with a missing
 * `await`. The volumes are kilobytes and the caller is a background agent.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * fsync a DIRECTORY, so that renames and creations inside it are durable.
 *
 * Opening a directory `O_RDONLY` and fsyncing the descriptor is the portable
 * POSIX way to do this and works on Linux, which is the only platform a KitLuy
 * device runs. A directory that cannot be opened is a real failure and is
 * allowed to throw: silently continuing would mean reporting an installation as
 * durable when it is not, which is the exact lie this module exists to prevent.
 */
export function fsyncDir(directory: string): void {
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** fsync a single existing file by path. */
export function fsyncFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Write a file so that, after this returns, it is present with the given
 * contents or absent entirely — never partially written, and never lost to a
 * power cut that follows.
 *
 * The temp name is a sibling so the rename stays within one filesystem; a
 * rename across filesystems is not atomic and would silently become a copy.
 */
export function writeDurable(path: string, contents: string, mode = 0o644): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, contents, { mode });
  fsyncFile(temp);
  renameSync(temp, path);
  fsyncDir(directory);
}

/** Rename, then make the rename itself durable. Same filesystem only. */
export function renameDurable(from: string, to: string): void {
  renameSync(from, to);
  fsyncDir(dirname(to));
}

/**
 * Point a symlink at a new target atomically AND durably.
 *
 * `symlink(2)` cannot replace an existing link, so the only atomic route is to
 * create a temp link beside it and rename over the top. Both the creation and
 * the rename are followed by a directory fsync, because the rename is the thing
 * that must survive: a lost swap means the device keeps running the previous
 * release, which is safe, but a swap that is durable only halfway does not
 * exist as a state and must not be reachable.
 *
 * A stale temp link from an interrupted earlier attempt is removed first — it
 * can only be garbage, since a successful swap always renames it away.
 */
export function swapSymlinkDurable(linkPath: string, target: string): void {
  const directory = dirname(linkPath);
  const temp = `${linkPath}.tmp`;
  rmSync(temp, { force: true });
  symlinkSync(target, temp);
  fsyncDir(directory);
  renameSync(temp, linkPath);
  fsyncDir(directory);
}

/**
 * fsync every regular file in a tree, then the directories, bottom-up.
 *
 * Used on an unpacked release payload before it is promoted. Without it the
 * payload's DIRECTORY ENTRY can be durable while the file CONTENTS are not, so a
 * power cut leaves a release that exists, passes a name check, and is empty —
 * which then gets activated. Files first, then their directories, so a
 * directory is only made durable once everything it names already is.
 */
export function fsyncTree(root: string): void {
  const directories: string[] = [];
  const walk = (directory: string): void => {
    directories.push(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      // Symlinks are not followed: fsyncing a link's target could reach outside
      // the tree, and the extractor refuses to create them in the first place.
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) fsyncFile(full);
    }
  };
  walk(root);
  for (let i = directories.length - 1; i >= 0; i -= 1) {
    const directory = directories[i];
    if (directory !== undefined) fsyncDir(directory);
  }
}

/** True when the path exists and is a directory. Never throws. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True when the path exists and is a regular file. Never throws. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
