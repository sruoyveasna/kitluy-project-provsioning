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
REPO="$(cd "${ROOT}/../../../.." && pwd)"
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
  # Cloud registration: the device announces itself to KitLuy and waits for a
  # HET decision. `device-registration-bytes` is the device's copy of the
  # canonical signing form, kept byte-identical by
  # test/device-registration-bytes-drift.test.ts.
  device-registration-bytes installation registration-state
  adapters/http-registration-client
  bin/firstboot-identity bin/enrollment-bootstrap bin/health-reporter
  bin/update-bootstrap bin/cloud-registration
  # THE UPDATE AGENT'S CLOSURE. `bin/update-bootstrap` (the declared
  # `update-agent` component) grew into the U1 release runtime, and this list was
  # never updated, so the Hub overlay kept shipping the pre-U1 precondition
  # reporter and re-packaging refused with "unpackaged imports" (2026-09-15).
  # Same modules the Pi Terminal image packages. On a Store Hub the agent stays
  # INERT: the Hub builder bakes no release trust anchor and no release source,
  # so every pass stops at `no_trust_anchor` before an install is composed —
  # the behaviour the old reporter had. Hub release distribution is U4.
  durable-write release-store release-verify release-trust
  release-archive release-artifact release-assignment release-install release-status
  adapters/http-release-source release-runtime
  # The health reporter imports the Pi Terminal runtime report (T1-STORE-
  # OPERATIONS-001). INERT on a Hub: it returns before collecting anything when
  # the image's device class is not `terminal`.
  runtime-report runtime-report-bytes
  # bin/bootstrap-ui is the PI TERMINAL's status screen — it titles itself
  # "KitLuy Terminal" and hardcodes `Store assignment .. Unassigned`, which is
  # wrong on a Hub and a lie once the Hub pairs. It was shipped here with no
  # shim and no unit to run it, so it was dead weight. The Hub's screen is
  # bin/hub-pairing-ui, which renders the owner decision §2.3 layout and prompts.
  bin/hub-pairing-ui
  # THE WI-FI FALLBACK. `network.js` is the only module that runs an external
  # command, and it runs every one of them through execFile with an argv ARRAY:
  # an SSID is attacker-chosen text broadcast by anyone with a radio, and a
  # shell-string command would execute it. `bin/network-ui.js` is the screen the
  # pairing console shows when — and only when — there is no usable link.
  network bin/network-ui
  # THE OPERATIONAL TLS IDENTITY. The Hub generates an RSA-2048 key locally,
  # persists the request identity BEFORE asking, signs kitluy.csr.v1, verifies
  # the returned certificate against the PINNED development root with
  # node:crypto, and adopts atomically with the manifest committed last.
  #
  # node-forge is deliberately absent: it is a TEST-only dependency used to mint
  # hostile fixtures, and `node:crypto` can parse and verify X.509 even though it
  # cannot issue it. The device only ever needs the verifying half.
  operational-key operational-csr-bytes operational-credential-state
  operational-certificate-verification operational-tls-client
  adapters/http-operational-certificate-client
  # `paired-identity` reads the seat a device was given: the Hub console's
  # `pairing-state.json` first, then a Terminal's `assignment.json`. The Hub
  # image needs it for the same reason the Terminal image does — `bin/operational-tls`
  # imports it to answer "is this board paired yet?" before asking for a
  # certificate. Its absence here refused the build with an unpackaged import
  # rather than shipping a closure that would die at the first boot.
  paired-identity
  # The recovery identity proof (KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001).
  # A re-flashed Hub already holds a credential in the cloud and is issued a new
  # one only against a signature by its device identity key;
  # `operational-tls-client` and `bin/operational-tls` import this module, so the
  # closure check refuses the build without it.
  operational-recovery-identity-bytes
  bin/operational-tls
  # BOOT CLASSIFICATION (BOOT-RECOVERY-CLASSIFICATION-001). The contract is the
  # package `@kitluy/device-boot-classification`, shipped as a byte-identical
  # copy because the image carries no node_modules; the firstboot agent's drift
  # test fails if the copy differs by one byte.
  boot-classification-contract boot-classification bin/boot-classification
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

# -----------------------------------------------------------------------------
# The Store Hub agent, BUNDLED.
# -----------------------------------------------------------------------------
# Everything above ships a file CLOSURE: `dist/*.js` copied one by one, valid
# only because the firstboot agent declares zero runtime dependencies (asserted
# at line 153). The Hub agent cannot meet that bar — 16 workspace dependencies
# plus `pg` — and the image ships no node_modules. So it is bundled at build time
# into one file instead, which keeps the no-node_modules contract intact.
#
# THIS IS THE STEP WHOSE ABSENCE WAS D-05. The agent's source, its unit and its
# avahi advert all existed; only this did not, so every flashable card advertised
# `_kitluy-edge._tcp` on 7443 with nothing behind it. `runtime-manifest.json`
# declares the component and `test/image-contents.test.sh` inspects the built
# rootfs for it, so the two can no longer drift apart silently.
MANIFEST="${ROOT}/runtime-manifest.json"
[[ -f "$MANIFEST" ]] || { echo "REFUSED: no runtime manifest at ${MANIFEST#"$REPO"/}" >&2; exit 6; }

HUB_AGENT_SRC="${REPO}/services/kitluy-hub-agent/dist-bundle/hub-agent.mjs"
HUB_AGENT_DST="${BASE_OVERLAY}/usr/lib/kitluy/lib/hub-agent/main.mjs"

if [[ ! -f "$HUB_AGENT_SRC" ]]; then
  echo "REFUSED: ${HUB_AGENT_SRC#"$REPO"/} is absent — run 'pnpm --filter @kitluy-services/kitluy-hub-agent build:bundle' first." >&2
  exit 7
fi

mkdir -p "$(dirname "$HUB_AGENT_DST")"
cp "$HUB_AGENT_SRC" "$HUB_AGENT_DST"
chmod 0644 "$HUB_AGENT_DST"

# LOADS, not merely exists. The firstboot closure is import()-ed above for the
# same reason: a bundle that parses on the build host but throws on first import
# would restart-loop on a Pi in a shop, and the message would be a stack trace in
# a journal nobody is watching.
#
# The module is imported for its side-effect-free top level ONLY. `main()` is
# invoked at import, so the child is given a database URL that cannot resolve and
# is expected to reach the KLUY-HUB-DB-UNREACHABLE refusal and exit 0 — the
# agent's designed "configured not to serve" outcome.
if ! KITLUY_HUB_DB_URL="postgresql://postgres@127.0.0.1:1/kitluy_packaging_probe" \
     node "$HUB_AGENT_DST" >/dev/null 2>&1; then
  echo "REFUSED: the packaged Hub agent bundle does not load and refuse cleanly." >&2
  echo "  Re-run with output:  node ${HUB_AGENT_DST}" >&2
  exit 8
fi

# The manifest is the authority on where the shim points. Checking it here means
# a rename in the manifest that nobody applied to the overlay fails the build.
node -e '
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const hub = (manifest.components || []).find((c) => c.id === "hub-agent");
  if (!hub) { console.error("REFUSED: runtime-manifest.json declares no hub-agent component."); process.exit(9); }
  const expected = hub.source && hub.source.installTo;
  if (expected !== "/usr/lib/kitluy/lib/hub-agent/main.mjs") {
    console.error(`REFUSED: the manifest installs hub-agent to ${expected}, which is not where this script puts it.`);
    process.exit(9);
  }
  const shim = fs.readFileSync(process.argv[2], "utf8");
  if (!shim.includes(expected)) {
    console.error(`REFUSED: /usr/lib/kitluy/hub-agent does not exec ${expected}.`);
    process.exit(9);
  }
' "$MANIFEST" "${BASE_OVERLAY}/usr/lib/kitluy/hub-agent"

echo "packaged hub agent: $(( $(stat -c '%s' "$HUB_AGENT_DST") / 1024 )) KiB bundle -> ${HUB_AGENT_DST#"$REPO"/}"
