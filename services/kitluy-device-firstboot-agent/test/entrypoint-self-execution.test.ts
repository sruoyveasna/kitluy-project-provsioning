/**
 * A packaged entrypoint must not BOOT when it is merely LOADED.
 *
 * `package-bootstrap-runtime.sh` imports every packaged module to prove it
 * loads. An entrypoint whose module body calls `main()` unconditionally starts
 * its polling loop inside the image build and hangs it — no error, no output,
 * just a build that never finishes. That happened on 2026-09-10 with
 * `bin/terminal-edge.ts`, and it cost twelve minutes before anyone looked at
 * what the node process was doing.
 *
 * The convention every entrypoint already followed is a guard on
 * `process.argv[1]`: `node -e` leaves it undefined, so loading is not booting.
 * An environment-variable guard does NOT work — the verifier sets no variables,
 * which is precisely the mistake this test now catches.
 *
 * This reads sources rather than importing them, because importing a file that
 * fails this test is exactly the hang being prevented.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BIN_DIR = join(fileURLToPath(new URL("../src/bin", import.meta.url)));

const entrypoints = readdirSync(BIN_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

describe("every entrypoint guards its own execution", () => {
  it("finds the entrypoints at all, so an empty sweep cannot pass silently", () => {
    expect(entrypoints.length).toBeGreaterThan(4);
  });

  it.each(entrypoints)("%s does not boot when imported", (name) => {
    const source = readFileSync(join(BIN_DIR, name), "utf8");

    // Strip block and line comments: prose about `main()` is not a call to it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // A top-level call is one at column 0 — inside a function it is indented.
    const topLevelCall = /^(?:void |await )?main\(\)/m.test(code);
    if (!topLevelCall) return;

    expect(
      code.includes("process.argv[1]"),
      `${name} calls main() at the top level without a process.argv[1] guard, so the ` +
        "packaging step's import would start it and hang the image build",
    ).toBe(true);
  });
});
