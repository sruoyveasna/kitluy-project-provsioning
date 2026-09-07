import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The shell pins its OWN Electron version (outside the catalog) because the image
 * ships that exact version as the arm64 runtime. It must be an exact pin, not a
 * range — a range would let the image and the app disagree about what runs on the
 * board, and every API difference between the two would become a defect that
 * reproduces only on hardware.
 *
 * The image half of that pin now exists (`infra/kitluy-os-image/rpi-image-gen/
 * electron.pin`, declared in `runtime-manifest.json`), so this suite no longer
 * asserts a shape and hopes — it compares the two.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  devDependencies?: Record<string, string>;
};

const imageRoot = join(here, "..", "..", "..", "infra", "kitluy-os-image");
const pinPath = join(imageRoot, "rpi-image-gen", "electron.pin");
const manifestPath = join(imageRoot, "runtime-manifest.json");

const pinned = (key: string): string | undefined =>
  new RegExp(`^${key}="([^"]*)"`, "m").exec(readFileSync(pinPath, "utf8"))?.[1];

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

  it("is the SAME version the image pins", () => {
    // The check the original stub deferred. An app built against 38.8.6 and an
    // image shipping something else is precisely what the pin exists to prevent.
    expect(pinned("KITLUY_ELECTRON_VERSION")).toBe(pkg.devDependencies?.electron);
  });

  it("is pinned by a real digest, not a placeholder", () => {
    // A version names a release; a digest names the bytes. `[REQUIRED: ...]`, an
    // empty string or a truncated paste must fail here.
    expect(pinned("KITLUY_ELECTRON_SHA256")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is declared in the image manifest with the same version and digest", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      components?: { id: string; source?: { version?: string; sha256?: string } }[];
    };
    const runtime = manifest.components?.find((c) => c.id === "electron-runtime");
    expect(runtime).toBeDefined();
    expect(runtime?.source?.version).toBe(pinned("KITLUY_ELECTRON_VERSION"));
    expect(runtime?.source?.sha256).toBe(pinned("KITLUY_ELECTRON_SHA256"));
  });

  it("is the runtime the shell's own launcher execs", () => {
    // Three places name the install path — the pin, the manifest and the shim —
    // and a shim pointing somewhere else fails only on a booted board.
    const shim = readFileSync(
      join(
        imageRoot,
        "rpi-image-gen/layer/kitluy-pi-terminal.rootfs-overlay/usr/lib/kitluy/device-shell",
      ),
      "utf8",
    );
    expect(shim).toContain(`${pinned("KITLUY_ELECTRON_INSTALL_PATH")}/electron`);
  });
});
