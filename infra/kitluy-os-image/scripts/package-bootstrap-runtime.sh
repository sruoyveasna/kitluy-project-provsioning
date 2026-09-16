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

# PRESENT IS NOT THE SAME AS CURRENT.
#
# This script COPIES `dist/*.js`; it never compiles. The check above only asks
# whether a compile ever happened, so a `dist` from a previous day satisfies it
# perfectly — and the image then ships source that does not match the tree it
# was built from.
#
# That is not hypothetical. On 2026-09-12 the `edge-session.ts` umask fix was
# written, unit-tested and committed to the working tree, the image was rebuilt,
# and the shipped `edge-session.js` contained none of it: `dist` was 16 hours
# old. The image passed every gate, because every gate read either the source
# tree or the copied artifact — and the two had silently diverged.
#
# Comparing newest-source against oldest-shipped-artifact catches exactly that,
# and says which file is stale rather than "rebuild something".
STALE_SRC=""
if [[ -d "${AGENT}/src" ]]; then
  while IFS= read -r TS; do
    JS="${AGENT}/dist/$(basename "${TS%.ts}").js"
    [[ -f "$JS" ]] || continue
    [[ "$TS" -nt "$JS" ]] && STALE_SRC="${STALE_SRC} $(basename "$TS")"
  done < <(find "${AGENT}/src" -maxdepth 1 -name '*.ts' ! -name '*.d.ts' 2>/dev/null)
fi
if [[ -n "$STALE_SRC" ]]; then
  echo "REFUSED: ${AGENT}/dist is STALE — newer source than its compiled output:" >&2
  for F in $STALE_SRC; do echo "    $F" >&2; done
  echo "  The image would ship code that does not match this tree." >&2
  echo "  Run: pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build" >&2
  exit 2
fi

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
  # Terminal pairing. The Device Shell loads this client from the installed
  # closure rather than bundling a second copy of the wire contract — the
  # agent's is the one with the drift test against the registry route. Shipping
  # it here is what makes `PAIRING_TRANSPORT_UNAVAILABLE` a real answer on an
  # image that lacks it rather than a silent failure on one that should have it.
  #
  # `pairing-state` rides along because the client imports its PairingPhase for
  # `phaseForRefusal`. The import is type-only and erases, so the closure check
  # would not demand it; it is listed so the module is present if a later caller
  # needs the values rather than the type.
  adapters/http-terminal-pairing-client pairing-state
  # The privileged half of Terminal Settings. The Device Shell runs with an
  # empty CapabilityBoundingSet and cannot join a network or set the backlight;
  # this root broker owns those verbs and the Shell is its client. Without it
  # `kitluy-device-config.service` is inert by ConditionPathExists and the
  # Settings screen reports the device unreachable rather than failing oddly.
  bin/device-config-broker device-config network
  # THE RELEASE RUNTIME (U1). The update agent grew from a precondition reporter
  # into the thing that actually fetches, verifies and installs a release, so
  # its closure grows with it.
  #
  # `release-verify` is a MIRROR of the canonical contract in
  # @kitluy/device-identity, not an import: the device closure ships node
  # built-ins only, and importing a workspace package would pull `pg` onto a
  # shop-floor appliance. `test/release-verify-drift.test.ts` is what keeps the
  # mirror honest.
  #
  # `release-archive` is the safe extractor — it can create a directory or a
  # regular file and has no code that could create a symlink, a device node or
  # anything outside the release root.
  durable-write release-store release-verify release-trust
  release-archive release-artifact release-assignment release-install release-status
  adapters/http-release-source
  # The COMPOSITION. Without this the agent reports status for ever and installs
  # nothing — the defect found before the first flash, now gated by
  # test/release-runtime.test.ts.
  release-runtime
  # The operational certificate. A Terminal that has paired is otherwise stuck
  # at "Assigned to a Store, awaiting activation" for ever: activation is
  # certificate-backed for BOTH device classes, and nothing else on the device
  # asks for one. Same closure the Store Hub image packages.
  #
  # `paired-identity` rides along because the agent reads the Terminal's seat
  # (/var/lib/kitluy/terminal/assignment.json) as well as the Hub's pairing
  # state — the Device Shell is sandboxed and cannot write the canonical file.
  operational-key operational-csr-bytes operational-credential-state
  operational-certificate-verification operational-tls-client
  adapters/http-operational-certificate-client
  paired-identity
  # The recovery identity proof (KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001).
  # Every certificate request is signed with the device identity key so a
  # re-flashed board can recover its credential; `operational-tls-client` and
  # `bin/operational-tls` import it. Its absence refused this build with
  # "unpackaged imports" on 2026-09-15. The device copy of the canonical bytes,
  # kept honest by test/operational-recovery-identity-drift.test.ts.
  operational-recovery-identity-bytes
  bin/operational-tls
  # The link to the Store Hub. A terminal that has a certificate and cannot use
  # it is not a till; this is the client that discovers the Hub over mDNS,
  # proves itself with mutual TLS, pairs Hub-locally, and reads authority time,
  # eligibility and configuration. It writes only a status file, which the
  # sandboxed Device Shell reads — the Shell runs as `kitluy-terminal` and
  # cannot hold the operational private key.
  #
  # `edge-discovery-record` is the agent-local copy of the discovery contract,
  # kept honest by `test/edge-discovery-drift.test.ts` against
  # @kitluy/device-identity — the same zero-runtime-dependency reason as
  # `hub-claim-bytes` and `device-registration-bytes`.
  edge-discovery-record edge-mdns edge-transport edge-pairing edge-session
  bin/terminal-edge
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

# ---------------------------------------------------------------------------
# THE DEVICE SHELL APPLICATION
# ---------------------------------------------------------------------------
# The graphical first-boot surface: `apps/kitluy-device-shell`, built output
# only. Committed to the overlay like the firstboot closure, and for the same
# reason — the image needs it and it is our own source, 272 KB of it.
#
# THE ELECTRON RUNTIME IS NOT HERE. That is 289 MB of somebody else's binary and
# it is fetched and checksum-verified at build time by `fetch-electron.sh`, then
# installed by the layer. Committing it would put a quarter-gigabyte artifact
# into every clone.
#
# `main` is REWRITTEN rather than copied: the source package.json carries
# devDependencies, scripts and a workspace-relative dependency graph, none of
# which mean anything on a Pi and all of which would be a second, misleading
# description of the app. The image gets a manifest that says exactly what
# Electron needs to resolve — the entry, and that it is ESM.
SHELL_SRC="${REPO}/apps/kitluy-device-shell"
SHELL_DIR="${TERMINAL_OVERLAY}/usr/lib/kitluy/lib/device-shell"

if [[ -d "${SHELL_SRC}/dist" && -d "${SHELL_SRC}/dist-electron" ]]; then
  rm -rf "$SHELL_DIR"
  mkdir -p "$SHELL_DIR"
  cp -a "${SHELL_SRC}/dist" "${SHELL_SRC}/dist-electron" "$SHELL_DIR/"
  # Source maps are a development aid; on an appliance they are dead weight and
  # they hand anyone with the card the original sources.
  find "$SHELL_DIR" -name '*.map' -delete

  SHELL_VERSION="$(node -e "console.log(require('${SHELL_SRC}/package.json').version)")"
  SHELL_MAIN="$(node -e "console.log(require('${SHELL_SRC}/package.json').main)")"
  [[ -f "${SHELL_DIR}/${SHELL_MAIN}" ]] \
    || { echo "REFUSED: the shell's declared main (${SHELL_MAIN}) was not packaged" >&2; exit 10; }
  cat > "${SHELL_DIR}/package.json" <<EOF
{
  "name": "kitluy-device-shell",
  "version": "${SHELL_VERSION}",
  "private": true,
  "type": "module",
  "main": "${SHELL_MAIN}"
}
EOF

  # The preload is CommonJS by extension (.cjs) because a sandboxed preload does
  # not load ESM. Losing it does not break the build — it breaks the bridge, at
  # runtime, on a shop counter, with a blank keypad and no error the installer
  # can read.
  [[ -f "${SHELL_DIR}/dist-electron/electron/preload.cjs" ]] \
    || { echo "REFUSED: the Device Shell preload was not packaged" >&2; exit 11; }
  [[ -f "${SHELL_DIR}/dist/index.html" ]] \
    || { echo "REFUSED: the Device Shell renderer bundle was not packaged" >&2; exit 12; }

  find "$SHELL_DIR" -type f -exec chmod 0644 {} +
  find "$SHELL_DIR" -type d -exec chmod 0755 {} +
  echo "packaged the Device Shell ($(du -sh "$SHELL_DIR" | cut -f1)) into ${SHELL_DIR#"$REPO"/}"
else
  # NOT a build failure: an image can legitimately be built without the shell
  # while it is being worked on, and the unit's ConditionPathExists keeps such a
  # device quiet rather than restart-looping. The manifest cross-check below is
  # what refuses if the manifest CLAIMS the shell is there.
  echo "NOTE: no built Device Shell at apps/kitluy-device-shell/dist — run 'pnpm --filter @kitluy-apps/kitluy-device-shell build' to include it" >&2
fi

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
  } else if (kind === "pinned-download") {
    /* Fetched and checksum-verified at build time, installed by the layer, so it is
       NOT in any overlay and cannot be checked here. What IS checkable here is that
       the manifest and the pin file agree — a version that drifted between them would
       otherwise be found only by someone reading both. The binary itself is asserted
       against the BUILT rootfs by image-contents.test.sh. */
    const pin = c.source.pin && path.join(path.dirname(manifestPath), c.source.pin);
    if (!pin || !fs.existsSync(pin)) problems.push(`${c.id}: pin file ${c.source.pin} is missing`);
    else {
      const text = fs.readFileSync(pin, "utf8");
      const pinned = (k) => (text.match(new RegExp(`^${k}="([^"]*)"`, "m")) || [])[1];
      if (c.source.version && pinned("KITLUY_ELECTRON_VERSION") !== c.source.version)
        problems.push(`${c.id}: manifest version ${c.source.version} but the pin says ${pinned("KITLUY_ELECTRON_VERSION")}`);
      if (c.source.sha256 && pinned("KITLUY_ELECTRON_SHA256") !== c.source.sha256)
        problems.push(`${c.id}: manifest sha256 and the pin file disagree`);
    }
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
