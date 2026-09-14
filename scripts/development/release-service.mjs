#!/usr/bin/env node
/**
 * `pnpm release:serve` — the development release source for a Pi Terminal.
 *
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *   pnpm release:serve --port 8791
 *
 * ===========================================================================
 * TWO ROUTES, TWO DIFFERENT KINDS OF THING
 * ===========================================================================
 *   GET /release/v1/assignment?device=<asset-tag>   AUTHORITY
 *   GET /release/v1/artifact/<releaseId>            BYTES
 *
 * The split is the owner's ruling: assignment determines what a Terminal may
 * install; artifact storage transports bytes only and is not deployment
 * authority.
 *
 * It is worth being precise about what makes that true, because running both
 * routes in one process could easily be mistaken for collapsing the two.
 *
 *   - the ASSIGNMENT route answers ONLY from `current_device_assignment_v1`,
 *     a governed database function. This service decides nothing: it does not
 *     choose a release, does not rank versions, and has no path that could
 *     offer a release the database did not name.
 *   - the ARTIFACT route serves bytes for ONE release id the caller already
 *     holds a signed manifest for. It has no "what do you have?" route and no
 *     listing, so a device can never discover a release from it.
 *
 * A device that asked this service for bytes it was not assigned gets them —
 * and then refuses them, because the digest in its signed manifest will not
 * match. That is the design: the transport is powerless whether it is honest
 * or not.
 *
 * ===========================================================================
 * DEVELOPMENT ONLY, AND IT SAYS SO
 * ===========================================================================
 * Plain HTTP on the workstation LAN, no client certificate. Mutual TLS is the
 * Store Hub's job at U4, where the terminal already holds an operational
 * certificate and the Hub already terminates mTLS on :7443 — building a second
 * mTLS endpoint here would be the throwaway architecture the owner ruled out.
 *
 * What keeps this safe in the meantime is not the transport: it is that the
 * device verifies an Ed25519 signature over the manifest against its own trust
 * registry, and re-proves the SHA-256 over the bytes it received. This service
 * cannot make an unsigned release trustworthy, and neither can the Hub later.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ReleaseTargetRefusal,
  assertReleaseCapable,
  resolveDeviceByAssetTag,
  resolveReleaseTarget,
} from "./release-target.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASES_DIR = join(REPO_ROOT, "build", "releases");
/** A release id is a uuid from the database. Nothing else is ever a path. */
const RELEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

// 8791, NOT 8790. The management API is configured with PORT=8790 and the Admin
// Portal depends on it, so this service — the newcomer — moves. The first U1
// hardware acceptance run lost a reflash to exactly this: the image baked
// `http://<workstation>:8790`, the terminal reached it in 14ms, and what
// answered was the management API's scaffold 404
// ("Business contracts are not implemented in this scaffold") rather than a
// governed assignment. Reachable and correct are different questions.
const args = { port: 8791, local: false };
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--port") {
    args.port = Number(process.argv[i + 1]);
    i += 1;
  } else if (process.argv[i] === "--local") args.local = true;
}
if (!Number.isInteger(args.port) || args.port < 1024) die("--port must be an integer above 1023");

let target;
try {
  target = resolveReleaseTarget({ local: args.local });
} catch (error) {
  die(String(error.message ?? error));
}

const pool = new pg.Pool({ ...target.connectionConfig, max: 4 });
try {
  const probe = await pool.connect();
  try {
    await assertReleaseCapable(probe, target.label);
  } finally {
    probe.release();
  }
} catch (error) {
  if (error instanceof ReleaseTargetRefusal) die(error.message);
  die(String(error.message ?? error));
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** By the cloud-issued device id — what a device on hardware actually sends. */
async function resolveDeviceById(client, id) {
  const { rows } = await client.query(
    `select id, asset_tag, device_class, lifecycle_state
       from kitluy_devices.devices where id = $1::uuid`,
    [id],
  );
  if (rows.length === 0) throw new Error(`no device ${id} on this target`);
  return rows[0];
}

/**
 * The authority route. Everything it returns comes from the governed function;
 * this handler adds the device lookup and nothing else.
 */
  async function handleAssignment(url, response) {
    const deviceRef = url.searchParams.get("device");
    if (deviceRef === null || deviceRef.trim() === "") {
      return json(response, 400, { error: "a device reference is required" });
    }
    const client = await pool.connect();
    try {
      let device;
      try {
        // A DEVICE ID **OR** AN ASSET TAG.
        //
        // The device names itself by the id the cloud issued it, because a
        // locally derived tag stops matching the cloud's the moment a board is
        // re-flashed (registration contract §9: the server never renames a board
        // it already knows). Asset tags stay accepted because operators and the
        // chain check use them, and they read better in a log.
        device = UUID.test(deviceRef.trim())
          ? await resolveDeviceById(client, deviceRef.trim())
          : await resolveDeviceByAssetTag(client, deviceRef.trim());
    } catch {
      // A device this stack does not know is not an error to shout about — a
      // freshly flashed terminal polls before it is approved. 404 and move on.
      return json(response, 404, { error: "unknown device on this target" });
    }
    const { rows } = await client.query(
      `select kitluy_releases.current_device_assignment_v1($1::uuid) as a`,
      [device.id],
    );
    const assignment = rows[0]?.a ?? null;
    if (assignment === null) {
      // NOT an error: a device with nothing assigned is the normal resting
      // state, and the device treats it as "nothing to do".
      return json(response, 200, { assignment: null });
    }
    console.log(
      `[release-serve] assignment ${device.asset_tag} -> ${assignment.releaseId} seq=${String(assignment.assignmentSequence)}`,
    );
    return json(response, 200, { assignment });
  } finally {
    client.release();
  }
}

/**
 * The bytes route. Range-capable so an interrupted download resumes from the
 * device's durable offset rather than starting again.
 */
function handleArtifact(pathname, request, response) {
  const releaseId = pathname.slice("/release/v1/artifact/".length);
  // A release id is a uuid, checked before it is ever joined to a path. This is
  // a development tool on a LAN, which is exactly the kind of thing that ends
  // up serving /etc/shadow if the id is taken on trust.
  if (!RELEASE_ID.test(releaseId)) return json(response, 400, { error: "malformed release id" });

  const file = join(RELEASES_DIR, releaseId, "artifact.tar.gz");
  if (!existsSync(file))
    return json(response, 404, { error: "no artifact for that release on this workstation" });

  const size = statSync(file).size;
  const range = request.headers.range;
  if (range === undefined) {
    response.writeHead(200, { "content-type": "application/gzip", "content-length": size });
    return createReadStream(file).pipe(response);
  }
  const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
  if (match === null) return json(response, 416, { error: "unsupported range" });
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) {
    response.writeHead(416, { "content-range": `bytes */${String(size)}` });
    return response.end();
  }
  response.writeHead(206, {
    "content-type": "application/gzip",
    "content-range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
    "content-length": end - start + 1,
  });
  return createReadStream(file, { start, end }).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method !== "GET") return json(response, 405, { error: "GET only" });
  if (url.pathname === "/health")
    return json(response, 200, { status: "ok", target: target.label });
  if (url.pathname === "/release/v1/assignment") {
    return void handleAssignment(url, response).catch((error) => {
      console.error("[release-serve] assignment failed:", String(error.message ?? error));
      json(response, 503, { error: "assignment authority unavailable" });
    });
  }
  if (url.pathname.startsWith("/release/v1/artifact/")) {
    return handleArtifact(url.pathname, request, response);
  }
  return json(response, 404, { error: "no such route" });
});

// An anonymous EADDRINUSE stack is how the port collision above stayed
// invisible: the operator sees a crash, restarts something else, and the
// terminal quietly talks to whatever DID bind. Say what is wrong instead.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    die(
      `port ${String(args.port)} is already in use by another process.\n` +
        `  A device pointed at this port would reach THAT service and receive its\n` +
        `  responses, not a governed assignment. Free the port or pass --port.`,
    );
  }
  die(`the release source could not listen: ${error.message}`);
});

server.listen(args.port, "0.0.0.0", () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i !== undefined && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log("");
  console.log(`[release-serve] DEVELOPMENT release source — assignment authority + artifact bytes`);
  console.log(`[release-serve]   target   ${target.label}`);
  console.log(`[release-serve]   artifacts ${RELEASES_DIR}`);
  console.log(`[release-serve]   listening 0.0.0.0:${String(args.port)}`);
  for (const address of addresses) {
    // The value a device's /etc/kitluy/release.env must carry.
    console.log(`[release-serve]   KITLUY_RELEASE_SOURCE=http://${address}:${String(args.port)}`);
  }
  console.log("");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  });
}
