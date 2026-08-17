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
BASE_OVERLAY="${ROOT}/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay"
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
  # image-env.js is the ONE reader of /etc/kitluy/image.env, shared by the
  # enrollment agent and the pairing console. Two copies of a config parser
  # eventually disagree about where the fleet service lives.
  image-env
  # pairing-state.js is the Hub's own state file. Deliberately NOT a phase in
  # bootstrap-state.json: writing one there makes `alreadyEnrolled()` answer
  # false and the enrollment agent re-presents a consumed ticket for ever.
  pairing-state
  # enrollment.js is TYPES ONLY at runtime — the enrollment client imports its
  # interfaces, which erase. It is listed because `verify_closure` reads the
  # emitted imports, and the emitted enrollment-bootstrap.js does reference it.
  enrollment enrollment-pop-bytes
  adapters/device-identity-store adapters/device-key-provider adapters/linux-hardware-probe
  adapters/http-enrollment-client
  bin/firstboot-identity bin/enrollment-bootstrap bin/health-reporter
  bin/update-bootstrap
  # bin/bootstrap-ui is the PI TERMINAL's status screen — it titles itself
  # "KitLuy Terminal" and hardcodes `Store assignment .. Unassigned`, which is
  # wrong on a Hub and a lie once the Hub pairs. It was shipped here with no
  # shim and no unit to run it, so it was dead weight. The Hub's screen is
  # bin/hub-pairing-ui, which renders the owner decision §2.3 layout and prompts.
  bin/hub-pairing-ui
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

# -----------------------------------------------------------------------------
# The Hub schema, copied from the ONE place it is authored.
# -----------------------------------------------------------------------------
# `hub/migrations/` is the canonical set (`scripts/hub/hub-db.mjs` owns it, with a
# checksum journal). The image must carry the same bytes, because the Hub agent
# refuses to serve when the applied checksums disagree with what its release
# expects — so a second, hand-copied set in the overlay would eventually diverge
# and produce a Hub that refuses for a reason nobody could explain.
#
# Copied at package time rather than committed into the overlay, so there is
# exactly one source and `git status` cannot show the two disagreeing.
HUB_MIGRATIONS_SRC="${REPO}/hub/migrations"
HUB_MIGRATIONS_DST="${BASE_OVERLAY}/usr/lib/kitluy/hub-migrations"

if [[ -d "$HUB_MIGRATIONS_SRC" ]]; then
  rm -rf "$HUB_MIGRATIONS_DST"
  mkdir -p "$HUB_MIGRATIONS_DST"
  cp "$HUB_MIGRATIONS_SRC"/*.sql "$HUB_MIGRATIONS_DST"/
  find "$HUB_MIGRATIONS_DST" -type f -exec chmod 0644 {} +

  # The manifest the agent reads to know what THIS release expects. Generated
  # from the same bytes that were just copied, so the expectation and the shipped
  # files cannot disagree — a Hub that discovered its own expectations by
  # scanning a directory at runtime could never detect that it is running
  # against the wrong database.
  node -e '
    const fs=require("fs"), path=require("path"), crypto=require("crypto");
    const dir=process.argv[1];
    const entries=fs.readdirSync(dir).filter(f=>f.endsWith(".sql")).sort().map(filename=>({
      filename,
      checksumSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,filename))).digest("hex"),
    }));
    fs.writeFileSync(path.join(dir,"..","hub-migration-manifest.json"), JSON.stringify(entries,null,2)+"\n");
    console.log("hub schema: "+entries.length+" migrations + manifest");
  ' "$HUB_MIGRATIONS_DST"
else
  echo "REFUSED: no Hub migration set at ${HUB_MIGRATIONS_SRC#"$REPO"/}" >&2
  exit 4
fi
