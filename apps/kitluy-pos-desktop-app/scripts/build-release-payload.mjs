#!/usr/bin/env node
/**
 * Build the POS release payload — the directory `release-pack.mjs` packs as the
 * governed release product `kitluy-terminal` (T1-STORE-OPERATIONS-001).
 *
 *   pnpm --filter @kitluy-apps/kitluy-pos-desktop-app build:release-payload
 *
 * ===========================================================================
 * WHAT A PI TERMINAL CAN RUN, AND WHAT IT CANNOT
 * ===========================================================================
 * The Pi image ships ONE Electron (the pinned 38.8.6 at /usr/lib/kitluy/electron)
 * and no node_modules. The Device Shell gets away with copying its `tsc` output
 * because its main process imports nothing but Electron and Node built-ins. The
 * POS main process imports workspace packages (`@kitluy/edge-contracts`,
 * `@kitluy/device-identity`, the Laundry vertical…), so copying would ship a
 * main process that dies at its first import on the board.
 *
 * So the main process and the preload are BUNDLED at build time — the Hub
 * agent's precedent (`services/kitluy-hub-agent/scripts/bundle.mjs`): esbuild
 * resolves the graph here, and nothing esbuild produces carries esbuild onto the
 * device. The renderer is Vite's ordinary build.
 *
 * Layout, identical to what `electron/main.ts` expects of itself:
 *
 *   release-payload/
 *     package.json                        name, version, type:module, main
 *     dist/index.html + assets/           the renderer
 *     dist-electron/electron/main.js      the bundled main process (ESM)
 *     dist-electron/electron/preload.cjs  the bundled preload (CommonJS)
 *
 * ===========================================================================
 * REFUSALS
 * ===========================================================================
 *   - the app's Electron is not EXACTLY the image's pin (an API gap that would
 *     reproduce only on hardware);
 *   - any symlink or non-regular file in the payload (the device extractor
 *     refuses them anyway; here the message is useful);
 *   - any path longer than a ustar name (100 bytes, `release-pack.mjs`);
 *   - anything that looks like key material or a service-role credential.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(APP, "..", "..");
const OUT = join(APP, "release-payload");
const PIN = join(REPO, "infra/edge/raspberry-pi/pi-terminal-image/rpi-image-gen/electron.pin");

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
const pinned = /^KITLUY_ELECTRON_VERSION="([^"]*)"/mu.exec(readFileSync(PIN, "utf8"))?.[1];
if (pkg.devDependencies?.electron !== pinned) {
  die(
    `the POS builds against Electron ${String(pkg.devDependencies?.electron)} but the Pi image pins ${String(pinned)}`,
  );
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "dist-electron", "electron"), { recursive: true });

// ---- renderer
execFileSync("pnpm", ["exec", "vite", "build", "--outDir", join(OUT, "dist"), "--emptyOutDir"], {
  cwd: APP,
  stdio: "inherit",
});

// ---- main process: ESM, Electron and Node built-ins external, everything else inside.
// `node:sqlite` is loaded through createRequire at CALL time by the workstation
// composition only (`electron/terminal-store.ts`), so it never runs on a Pi.
const shared = {
  bundle: true,
  platform: "node",
  // Electron 38 embeds Node 22.
  target: "node22",
  external: ["electron"],
  legalComments: "none",
  logLevel: "warning",
};
await build({
  ...shared,
  entryPoints: [join(APP, "electron", "main.ts")],
  outfile: join(OUT, "dist-electron", "electron", "main.js"),
  format: "esm",
  banner: {
    js: [
      "import { createRequire as __kitluyCreateRequire } from 'node:module';",
      "const require = __kitluyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
// ---- preload: sandboxed preloads are CommonJS and may require only `electron`.
await build({
  ...shared,
  entryPoints: [join(APP, "electron", "preload.cts")],
  outfile: join(OUT, "dist-electron", "electron", "preload.cjs"),
  format: "cjs",
});

writeFileSync(
  join(OUT, "package.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: "module",
      main: "dist-electron/electron/main.js",
    },
    null,
    2,
  )}\n`,
);

// ---- the checks
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) die(`${relative(OUT, path)} is a symlink`);
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) files.push(path);
    else die(`${relative(OUT, path)} is not a regular file`);
  }
};
walk(OUT);
for (const required of [
  "package.json",
  "dist/index.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.cjs",
]) {
  if (!existsSync(join(OUT, required))) die(`${required} was not produced`);
}
let bytes = 0;
for (const file of files) {
  const name = relative(OUT, file);
  if (name.length > 100) die(`${name} is longer than a ustar name field`);
  const text = readFileSync(file);
  bytes += text.length;
  if (
    /BEGIN [A-Z ]*PRIVATE KEY|service_role|SUPABASE_SERVICE_ROLE_KEY/u.test(text.toString("latin1"))
  ) {
    die(`${name} carries key or credential material`);
  }
}
// A sourcemap would ship the sources for nothing; Vite emits none by default.
if (files.some((file) => file.endsWith(".map"))) die("a sourcemap reached the payload");

console.log(
  `[pos-payload] ${String(files.length)} files, ${String(bytes)} bytes -> ${relative(REPO, OUT)}`,
);
console.log(`[pos-payload] ${pkg.name} ${pkg.version}, Electron ${pinned} (the image pin)`);
