/**
 * Bundles the Store Hub agent into ONE file for the Raspberry Pi image.
 *
 * ===========================================================================
 * WHY A BUNDLER, WHEN THE FIRSTBOOT AGENT NEEDS NONE
 * ===========================================================================
 * `package-bootstrap-runtime.sh` packages the firstboot agent by copying its
 * emitted `.js` files one by one, and asserts at line 153 that the package has
 * ZERO runtime dependencies — "the image ships no node_modules". That works
 * because the firstboot agent deliberately depends on nothing.
 *
 * The Hub agent cannot meet that bar: it has 16 `workspace:*` dependencies and
 * `pg`. Copying a file closure would need every one of those packages on the
 * device, which means a `node_modules` tree, which the image contract forbids.
 *
 * Bundling resolves the whole graph at BUILD time into a single file, so the
 * device still ships no `node_modules` and the contract holds unchanged. The
 * bundler is build tooling: nothing esbuild produces carries esbuild onto the
 * image.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY LEFT OUT
 * ===========================================================================
 * `pg-native` is an OPTIONAL binding `pg` probes for at require time. It is a
 * compiled addon, it is not installed, and the pure-JS path is the one this Hub
 * uses. Marking it external means the bundle keeps `pg`'s own graceful
 * "not installed" handling instead of esbuild failing the build over a module
 * nobody wants.
 */
import { build } from "esbuild";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const OUT_FILE = join(PACKAGE_ROOT, "dist-bundle", "hub-agent.mjs");

mkdirSync(dirname(OUT_FILE), { recursive: true });

const result = await build({
  entryPoints: [join(PACKAGE_ROOT, "src", "bin", "hub-agent.ts")],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  format: "esm",
  // The image ships Debian Bookworm's nodejs. Targeting the older runtime keeps
  // the bundle valid if that package moves, and costs nothing here.
  target: "node18",
  external: ["pg-native"],
  // Several transitive dependencies are CommonJS and call `require` at runtime.
  // In an ESM bundle that identifier does not exist, so it is reintroduced from
  // node:module — the standard interop shim.
  //
  // NO SHEBANG HERE. esbuild already preserves the one on line 1 of
  // `src/bin/hub-agent.ts`, and a second `#!` line is not valid JavaScript —
  // the bundle parses on the first line and dies on the second.
  banner: {
    js: [
      "import { createRequire as __kitluyCreateRequire } from 'node:module';",
      "const require = __kitluyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  // Readable stack traces matter more than bytes on a device an engineer can
  // only reach over SSH.
  minify: false,
  sourcemap: false,
  logLevel: "info",
  metafile: true,
});

chmodSync(OUT_FILE, 0o755);

const bytes = statSync(OUT_FILE).size;
const inputs = Object.keys(result.metafile.inputs).length;
console.log(
  `bundled hub-agent: ${inputs} modules -> ${(bytes / 1024).toFixed(0)} KiB at ${OUT_FILE}`,
);

if (result.errors.length > 0) process.exit(1);
