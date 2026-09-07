#!/usr/bin/env bash
# Package the CANONICAL bootstrap runtime into the rpi-image-gen rootfs overlay.
#
# One source, two consumers. The overlay directory produced here is consumed by
# BOTH build paths:
#   - rpi-image-gen (the real .img), via <layer>.rootfs-overlay/
#   - scripts/build-image.sh (the staged tree), which copies from the same dir
#
# That is what removes the staged-vs-layer divergence: neither path defines a
# unit or an executable of its own any more.
#
# The runtime itself is NOT re-implemented here. It is the compiled output of
# services/kitluy-device-firstboot-agent, which owns firstboot identity, cloud
# registration, health and update bootstrap and the status screen, and is
# covered by its own test suite.
#
# THE MANIFEST IS THE AUTHORITY. `runtime-manifest.json` declares every
# component the flashable image carries; this script packages what it declares
# and REFUSES when a declared executable is not in the overlay, when a retired
# path is still present, or when Store-authority material has reached a
# terminal overlay. A component that is packaged but not declared is invisible
# to the tests, which is the failure mode the manifest exists to remove.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "${ROOT}/../.." && pwd)"
AGENT="${REPO}/services/kitluy-device-firstboot-agent"
BASE_OVERLAY="${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay"
TERMINAL_OVERLAY="${ROOT}/rpi-image-gen/layer/kitluy-pi-terminal.rootfs-overlay"
LIB_DIR="${BASE_OVERLAY}/usr/lib/kitluy/lib/firstboot-agent"
MANIFEST="${ROOT}/runtime-manifest.json"

[[ -f "$MANIFEST" ]] || { echo "REFUSED: no runtime manifest at ${MANIFEST#"$REPO"/}" >&2; exit 6; }
[[ -d "${AGENT}/dist" ]] || {
  echo "REFUSED: ${AGENT}/dist is absent — run 'pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build' first." >&2
  exit 2
}

# SHIP ONLY THE DEVICE CLOSURE. `dist/` also contains factory.js and
# factory-gateway.js — the MANUFACTURING STATION path, which talks to a database
# through a DatabaseHandle and carries the governed refusal-code vocabulary
# (including the literal string `service_role`). A shop-floor appliance has no
# business carrying either, and the image zero-secret scanner correctly refuses
# them. The fix is to ship less, not to loosen the scanner.
#
# This list is the transitive import closure of the device entrypoints, and
# `verify_closure` below fails the build if that ever stops being true.
#
# NOT IN THIS LIST, DELIBERATELY: bin/enrollment-bootstrap, adapters/
# http-enrollment-client and enrollment-pop-bytes — the flash-time ticket path.
# It enrolled a device straight to `enrolled` with no Admin decision, which the
# Factory Enrollment rule (KLD-2026-09-03-FACTORY-ENROLLMENT-001) forbids, and
# `runtime-manifest.json` lists it under `retired`. Cloud registration is the
# terminal's one identity path.
DEVICE_MODULES=(
  version identity bootstrap-state
  # image-env.js is the ONE reader of /etc/kitluy/image.env.
  image-env
  adapters/device-identity-store adapters/device-key-provider adapters/linux-hardware-probe
  # Cloud registration: the device announces itself and waits for Admin approval.
  device-registration-bytes installation registration-state
  adapters/http-registration-client
  bin/firstboot-identity bin/health-reporter bin/update-bootstrap
  bin/cloud-registration
  bin/bootstrap-ui
)
rm -rf "$LIB_DIR"
mkdir -p "$LIB_DIR"
for m in "${DEVICE_MODULES[@]}"; do
  mkdir -p "${LIB_DIR}/$(dirname "$m")"
  cp "${AGENT}/dist/${m}.js" "${LIB_DIR}/${m}.js"
done

# The closure must be self-contained: a relative import reaching a module that
# was not shipped would fail at boot rather than here. Resolved properly
# (relative to the importing file), not by string prefix.
node -e '
const fs=require("fs"), path=require("path");
const root=process.argv[1]; let missing=[];
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{
  const f=path.join(d,e.name);
  return e.isDirectory()?walk(f):(f.endsWith(".js")?[f]:[]);});
for(const f of walk(root)){
  for(const m of fs.readFileSync(f,"utf8").matchAll(/from "(\.[^"]+)"/g)){
    const t=path.resolve(path.dirname(f),m[1]);
    if(!fs.existsSync(t)) missing.push(path.relative(root,f)+" -> "+m[1]);
  }}
if(missing.length){console.error("REFUSED: unpackaged imports:\n  "+missing.join("\n  "));process.exit(4);}
' "$LIB_DIR"

# THE MODULE MARKER. The agent is an ESM package ("type": "module") and its
# compiled output uses import/export, but the packaged closure is a bare tree of
# .js files with no package.json. Node resolves module type by walking up from
# the file to the nearest package.json; finding none, it defaults to CommonJS
# and every entrypoint dies at its first `import` with
#   SyntaxError: Cannot use import statement outside a module
# — which is exactly what took kitluy-firstboot.service, and through
# Requires=, the whole bootstrap runtime, down on first boot.
#
# The marker is derived from the agent's own package.json rather than
# hardcoded, so a future switch away from ESM cannot leave a stale claim here.
AGENT_TYPE="$(node -e "console.log(require('${AGENT}/package.json').type || 'commonjs')")"
printf '{ "type": "%s", "private": true }\n' "$AGENT_TYPE" > "${LIB_DIR}/package.json"

# ...and prove it, rather than trusting that writing the file was enough. Every
# packaged module is imported for real. Dynamic import under `node -e` leaves
# process.argv[1] undefined, so the entrypoints' `if (argv[1].includes(...))`
# self-execution guard stays false and nothing runs: this loads, it does not
# boot. A module-type or unresolved-import defect fails the BUILD here instead
# of bricking a flashed device in a shop.
node -e '
const fs=require("fs"), path=require("path"), url=require("url");
const root=process.argv[1];
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{
  const f=path.join(d,e.name);
  return e.isDirectory()?walk(f):(f.endsWith(".js")?[f]:[]);});
(async()=>{
  const broken=[];
  for(const f of walk(root)){
    try { await import(url.pathToFileURL(f).href); }
    catch(e){ broken.push(path.relative(root,f)+": "+e.message.split("\n")[0]); }
  }
  if(broken.length){
    console.error("REFUSED: packaged modules do not load:\n  "+broken.join("\n  "));
    process.exit(5);
  }
})();
' "$LIB_DIR"

# The agent declares zero runtime dependencies, so there is no node_modules to
# ship. That is a property worth asserting rather than assuming: a dependency
# added later would silently break the image at boot instead of here.
if [[ "$(node -e "const p=require('${AGENT}/package.json');console.log(Object.keys(p.dependencies||{}).length)")" != "0" ]]; then
  echo "REFUSED: the firstboot agent gained runtime dependencies; the image ships no node_modules." >&2
  exit 3
fi

find "$LIB_DIR" -type f -exec chmod 0644 {} +
find "$LIB_DIR" -type d -exec chmod 0755 {} +
echo "packaged $(find "$LIB_DIR" -name '*.js' | wc -l) js files into ${LIB_DIR#"$REPO"/}"

# ---------------------------------------------------------------------------
# THE MANIFEST CROSS-CHECK. What was declared is what was packaged.
# ---------------------------------------------------------------------------
# For every component of this image's profile:
#   closure          -> its shim exists in an overlay, is executable, and execs
#                       a bin/*.js that is in the closure just packaged;
#   overlay          -> its executable exists in an overlay and is executable;
#   package          -> nothing to package; the layer must declare the package
#                       (asserted by systemd-runtime.test.sh);
#   governed-release -> declares NO executable, and none is present.
# Every unit named exists in an overlay, and `enabled` matches the presence of
# its multi-user.target.wants symlink. Every `retired` path is ABSENT, and so is
# every Store-authority path. Any mismatch REFUSES the build.
node -e '
const fs=require("fs"), path=require("path");
const [manifestPath, libDir, ...overlays] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const profile = (m.profiles || [])[0];
const problems = [];
// lstat, not existsSync: a wants entry is a SYMLINK, and following it would resolve an absolute target
// against the build host instead of the image.
const present = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const inOverlay = (rel) => overlays.map((o) => path.join(o, rel)).find((p) => present(p));
const isExec = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
for (const c of m.components || []) {
  if (!(c.profiles || []).includes(profile)) continue;
  const kind = c.source && c.source.kind;
  if (kind === "governed-release") {
    if (c.executable) problems.push(`${c.id}: a governed release declares no executable in the image`);
  } else if (kind === "package") {
    /* provided by the distribution; the layer declaration is asserted by the tests */
  } else if (c.executable) {
    const shim = inOverlay(c.executable);
    if (!shim) problems.push(`${c.id}: ${c.executable} is not in any overlay`);
    else if (!isExec(shim)) problems.push(`${c.id}: ${c.executable} is not executable`);
    else if (kind === "closure") {
      const text = fs.readFileSync(shim, "utf8");
      const match = text.match(/\/usr\/lib\/kitluy\/lib\/firstboot-agent\/(bin\/[a-z0-9-]+)\.js/);
      if (!match) problems.push(`${c.id}: shim ${c.executable} does not exec a packaged bin/*.js`);
      else if (!fs.existsSync(path.join(libDir, `${match[1]}.js`))) problems.push(`${c.id}: shim execs ${match[1]}.js, which was not packaged`);
      else if (c.source.entry && c.source.entry !== match[1]) problems.push(`${c.id}: manifest entry ${c.source.entry} but the shim execs ${match[1]}`);
    }
  }
  if (c.unit) {
    if (!inOverlay(path.join("etc/systemd/system", c.unit))) problems.push(`${c.id}: unit ${c.unit} is not in any overlay`);
    const wants = inOverlay(path.join("etc/systemd/system/multi-user.target.wants", c.unit));
    if (c.enabled && !wants) problems.push(`${c.id}: declared enabled, but no multi-user.target.wants symlink for ${c.unit}`);
    if (!c.enabled && wants) problems.push(`${c.id}: declared NOT enabled, but ${c.unit} is wanted by multi-user.target`);
  }
}
for (const r of m.retired || []) {
  if (r.unit && inOverlay(path.join("etc/systemd/system", r.unit))) problems.push(`retired unit ${r.unit} is still in an overlay`);
  if (r.unit && inOverlay(path.join("etc/systemd/system/multi-user.target.wants", r.unit))) problems.push(`retired unit ${r.unit} is still enabled`);
  if (r.executable && inOverlay(r.executable)) problems.push(`retired executable ${r.executable} is still in an overlay`);
  for (const mod of r.modules || []) if (fs.existsSync(path.join(libDir, `${mod}.js`))) problems.push(`retired module ${mod}.js was packaged`);
}
for (const p of m.storeAuthorityMustBeAbsent || []) {
  if (inOverlay(p)) problems.push(`Store-authority path ${p} is present in a terminal overlay`);
}
if (problems.length) {
  console.error("REFUSED: runtime-manifest.json and the overlay disagree:\n  " + problems.join("\n  "));
  process.exit(9);
}
console.log(`manifest cross-check: ${(m.components || []).length} components, ${(m.retired || []).length} retired path(s) absent, Store authority absent`);
' "$MANIFEST" "$LIB_DIR" "$BASE_OVERLAY" "$TERMINAL_OVERLAY"
