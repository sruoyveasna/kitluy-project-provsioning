import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shell pins its OWN Electron version (outside the catalog) because the image
 * ships that exact version as the arm64 runtime. It must be an exact pin, not a
 * range — a range would let the image and the app disagree about what runs on the
 * board. The image-manifest ↔ devDependency equality check is added with the
 * image integration (Milestone C).
 */
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  devDependencies?: Record<string, string>;
};

describe("electron pin", () => {
  it("is an exact version, not a range", () => {
    const version = pkg.devDependencies?.electron;
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is on the intended major line (38)", () => {
    const version = pkg.devDependencies?.electron ?? "";
    expect(version.startsWith("38.")).toBe(true);
  });
});
