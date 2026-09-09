/**
 * The main-process halves of Settings: what a receipt actually contains, and how
 * this board describes itself.
 *
 * Both are pure enough to test without Electron, which is the point of keeping
 * them out of `main.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PRINTER_PORT,
  readPrinterConfig,
  testReceiptBytes,
  validateConfig,
  writePrinterConfig,
} from "../electron/printer.js";
import { parseImageEnv, readSerial } from "../electron/device-info.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kitluy-shell-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("printer configuration is validated before it is stored", () => {
  it("defaults the port to the receipt-printer standard", () => {
    const config = validateConfig({ host: "192.168.1.50" });
    expect(config).toMatchObject({ host: "192.168.1.50", port: DEFAULT_PRINTER_PORT });
  });

  it("refuses an address that is not one", () => {
    for (const host of ["", "has space", "a".repeat(300), 42, null]) {
      expect(validateConfig({ host }), String(host)).toMatchObject({ code: "PRINTER_HOST" });
    }
  });

  it("refuses a port outside the range", () => {
    for (const port of [0, 65536, -1, 1.5]) {
      expect(validateConfig({ host: "p", port }), String(port)).toMatchObject({
        code: "PRINTER_PORT",
      });
    }
  });

  it("bounds the label rather than storing whatever was typed", () => {
    const config = validateConfig({ host: "p", label: "x".repeat(500) });
    expect((config as { label: string }).label).toHaveLength(60);
  });

  it("drops a blank label instead of storing an empty string", () => {
    expect(validateConfig({ host: "p", label: "   " })).not.toHaveProperty("label");
  });
});

describe("a printer file that has been edited into nonsense reads as no printer", () => {
  it("returns null rather than a shape the rest of the shell must defend against", () => {
    const path = join(tmp(), "printer.json");
    writeFileSync(path, '{"host": 42}');
    expect(readPrinterConfig(path)).toBeNull();
    writeFileSync(path, "not json at all");
    expect(readPrinterConfig(path)).toBeNull();
  });

  it("round-trips a valid configuration", () => {
    const path = join(tmp(), "printer.json");
    writePrinterConfig({ kind: "network", host: "10.0.0.9", port: 9100, label: "Till" }, path);
    expect(readPrinterConfig(path)).toEqual({
      kind: "network",
      host: "10.0.0.9",
      port: 9100,
      label: "Till",
    });
  });

  it("returns null for a file that is not there", () => {
    expect(readPrinterConfig(join(tmp(), "absent.json"))).toBeNull();
  });
});

describe("the test receipt is real ESC/POS", () => {
  const bytes = testReceiptBytes(new Date("2026-09-08T10:00:00Z"), "Counter 1");

  it("initialises the printer first", () => {
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
  });

  it("ends with a cut, so nobody tears the paper by hand and reads it as a fault", () => {
    expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]));
  });

  it("feeds before cutting, so the blade clears the text", () => {
    const feed = Buffer.from([0x1b, 0x64]);
    expect(bytes.indexOf(feed)).toBeGreaterThan(0);
    expect(bytes.indexOf(feed)).toBeLessThan(bytes.length - 3);
  });

  it("carries the label and a timestamp a person can check", () => {
    expect(bytes.toString("ascii")).toContain("Counter 1");
    expect(bytes.toString("ascii")).toContain("2026-09-08");
  });

  it("prints without a label too", () => {
    const plain = testReceiptBytes(new Date("2026-09-08T10:00:00Z"));
    expect(plain.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(plain.toString("ascii")).toContain("KitLuy Terminal");
  });
});

describe("image.env parsing matches what the device's own scripts do", () => {
  it("reads plain key=value and strips quotes", () => {
    const env = parseImageEnv("A=1\nB=\"two\"\nC='three'\n");
    expect(env).toMatchObject({ A: "1", B: "two", C: "three" });
  });

  it("ignores comments and blank lines", () => {
    expect(parseImageEnv("# note\n\n  \nA=1\n")).toEqual({ A: "1" });
  });

  it("keeps a deliberately blank value blank", () => {
    // image.env ships KITLUY_ENVIRONMENT empty on purpose so readers see
    // `unknown` rather than an implicit default. It must not become "unknown"
    // here, or that distinction is lost.
    expect(parseImageEnv("KITLUY_ENVIRONMENT=\n")).toEqual({ KITLUY_ENVIRONMENT: "" });
  });

  it("survives a line with no equals sign", () => {
    expect(parseImageEnv("garbage\nA=1\n")).toEqual({ A: "1" });
  });
});

describe("the board serial", () => {
  it("strips the device tree's NUL terminator", () => {
    const path = join(tmp(), "serial-number");
    writeFileSync(path, "334a2a7bcc3dba2a\u0000");
    expect(readSerial(path, join(tmp(), "none"))).toBe("334a2a7bcc3dba2a");
  });

  it("falls back to /proc/cpuinfo when the device tree has none", () => {
    const cpuinfo = join(tmp(), "cpuinfo");
    writeFileSync(cpuinfo, "processor\t: 0\nSerial\t\t: 53b91c797e480ed6\n");
    expect(readSerial(join(tmp(), "absent"), cpuinfo)).toBe("53b91c797e480ed6");
  });

  it("returns null rather than guessing when neither source has one", () => {
    expect(readSerial(join(tmp(), "a"), join(tmp(), "b"))).toBeNull();
  });
});
