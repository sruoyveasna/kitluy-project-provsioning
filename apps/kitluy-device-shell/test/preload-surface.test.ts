import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The preload is the whole attack surface between the sandboxed renderer and the
 * trusted main process, so it is asserted by SOURCE inspection (running it needs
 * a live Electron): exactly one bridge, exactly three named methods, and no
 * generic pass-through a compromised renderer could ride.
 */
const preloadPath = join(dirname(fileURLToPath(import.meta.url)), "..", "electron", "preload.cts");
const source = readFileSync(preloadPath, "utf8");

describe("preload surface", () => {
  it("exposes exactly one world, named kitluyShell", () => {
    const exposals = source.match(/exposeInMainWorld\(/g) ?? [];
    expect(exposals).toHaveLength(1);
    expect(source).toContain('exposeInMainWorld("kitluyShell"');
  });

  it("exposes exactly the three agreed methods", () => {
    expect(source).toMatch(/\bgetSnapshot:/);
    expect(source).toMatch(/\bonSnapshot:/);
    expect(source).toMatch(/\bsubmitPairingCode:/);
  });

  // The Settings verbs. Listed one by one on purpose: this test is the record of
  // what the renderer can reach, and a verb that appears in the preload without
  // appearing here has been added without anyone deciding it should be.
  it("exposes each Settings verb as its own named method", () => {
    for (const method of [
      "getNetworkStatus",
      "scanNetworks",
      "joinNetwork",
      "forgetNetwork",
      "getBrightness",
      "setBrightness",
      "getDeviceInfo",
      "getPrinter",
      "savePrinter",
      "testPrinter",
    ]) {
      expect(source, method).toMatch(new RegExp(`\\b${method}:`));
    }
  });

  it("exposes no method the bridge type does not declare", () => {
    // Everything the preload puts on the object, in source order.
    const exposed = [...source.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    const declared = new Set([
      "getSnapshot",
      "onSnapshot",
      "submitPairingCode",
      "getNetworkStatus",
      "scanNetworks",
      "joinNetwork",
      "forgetNetwork",
      "getBrightness",
      "setBrightness",
      "getDeviceInfo",
      "getPrinter",
      "savePrinter",
      "testPrinter",
    ]);
    for (const method of exposed) {
      expect(declared.has(method!), `preload exposes undeclared method: ${method}`).toBe(true);
    }
  });

  it("exposes no generic pass-through", () => {
    // No unrestricted send/invoke handed to the renderer, and no way to name an
    // arbitrary channel from the renderer side.
    expect(source).not.toMatch(/\bsend:/);
    expect(source).not.toMatch(/invoke:\s*ipcRenderer\.invoke\b/);
    expect(source).not.toMatch(/ipcRenderer\.send\b/);
  });
});
