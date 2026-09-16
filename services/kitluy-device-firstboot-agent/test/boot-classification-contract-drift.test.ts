/**
 * The board's copy of the boot classification contract must be the package's
 * source, byte for byte.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 — one canonical
 * classifier, never duplicated conflicting ones.
 *
 * The image ships no `node_modules`, so the board cannot import
 * `@kitluy/device-boot-classification`; `src/boot-classification-contract.ts`
 * is a copy. A copy is what drifts: one branch reordered on one side and the
 * board and the cloud would give a shop two different answers about the same
 * card. `device-registration-bytes-drift.test.ts` guards its copy by comparing
 * outputs, because that copy is hand-written; this one is not hand-written at
 * all, so it is compared as FILES — the strongest check there is.
 *
 * To update after changing the contract:
 *   cp packages/device-boot-classification/src/index.ts \
 *      services/kitluy-device-firstboot-agent/src/boot-classification-contract.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");

describe("the board's classification contract", () => {
  it("is byte-identical to packages/device-boot-classification/src/index.ts", () => {
    const canonical = readFileSync(
      join(REPO, "packages", "device-boot-classification", "src", "index.ts"),
    );
    const board = readFileSync(join(here, "..", "src", "boot-classification-contract.ts"));
    expect(board.length, "the copy has a different length; re-copy it (see header)").toBe(
      canonical.length,
    );
    expect(board.equals(canonical), "the copy differs; re-copy it (see header)").toBe(true);
  });
});
