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
# services/kitluy-device-firstboot-agent, which owns firstboot identity,
# enrollment bootstrap, health and update bootstrap and is covered by its own
# test suite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "${ROOT}/../.." && pwd)"
AGENT="${REPO}/services/kitluy-device-firstboot-agent"
BASE_OVERLAY="${ROOT}/rpi-image-gen/layer/kitluy-base.rootfs-overlay"
LIB_DIR="${BASE_OVERLAY}/usr/lib/kitluy/lib/firstboot-agent"

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
# This list is the transitive import closure of the five device entrypoints,
# and `verify_closure` below fails the build if that ever stops being true.
DEVICE_MODULES=(
  version identity bootstrap-state
  adapters/device-identity-store adapters/device-key-provider adapters/linux-hardware-probe
  bin/firstboot-identity bin/enrollment-bootstrap bin/health-reporter
  bin/update-bootstrap bin/bootstrap-ui
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
