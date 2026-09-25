#!/usr/bin/env node
/**
 * `pnpm dev:stack:*` — bring the workstation development stack that the Pi
 * images talk to back up after a reboot, and keep its registration endpoint
 * from depending on anything that a reboot deletes.
 *
 *   pnpm dev:stack:up                 # start everything, then run the health checks
 *   pnpm dev:stack:health             # the health checks only
 *   pnpm dev:stack:edge-runtime       # recreate the edge runtime on the durable mount
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Both device images bake `http://<workstation>:54371/functions/v1/device-registration`.
 * Port 54371 is the `kitluy-fresh` Supabase stack; kong proxies `/functions/v1/*`
 * to the container `supabase_edge_runtime_kitluy-fresh:8081`.
 *
 * That container was created by the Supabase CLI from a Claude-session scratch
 * directory under `/tmp`, and bind-mounted its function source from there. A
 * reboot clears `/tmp`; Docker recreates the bind source EMPTY, and the runtime
 * answers BOOT_ERROR for every device (handoff 56 §5.5.1). Its restart policy was
 * also `no`, so it did not even come back by itself.
 *
 * `edge-runtime` recreates that ONE container with the SAME name, image,
 * network, alias, labels, entrypoint and environment, changing only three
 * things:
 *
 *   - the function source is the repository's own `supabase/functions`,
 *     mounted read-only at the same absolute path (the CLI's convention);
 *   - the working directory is the repository root, so the unchanged
 *     `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` entrypoint
 *     (`supabase/functions/device-registration/index.ts`, relative) resolves
 *     into that mount;
 *   - the restart policy is `unless-stopped`, like the rest of the stack.
 *
 * There is no copy. The committed functions in this repository ARE what the
 * runtime serves, so an edit to them takes effect on the next
 * `docker restart supabase_edge_runtime_kitluy-fresh` — and a dirty working tree
 * is served too, which is why `health` reports the git state of that directory.
 *
 * Nothing about the database is touched: the stack's other containers, its
 * volumes and every row stay as they are. The port, and so the address baked
 * into both images, is kong's and does not change.
 *
 * ===========================================================================
 * WHERE THE RUNTIME'S ENVIRONMENT COMES FROM
 * ===========================================================================
 * The runtime carries the local stack's keys (JWT secret, JWKS, anon and
 * service-role keys, the registration DSN). They are copied from the EXISTING
 * container through the environment of the `docker run` child — never on a
 * command line, never printed. A 0600 snapshot is kept OUTSIDE the repository,
 * in `local-config/het-kitluy-project/`, so the container can still be recreated
 * if it has been removed altogether.
 *
 * The host services (`:8787`, `:8791`, `:8792`, `:8790`) are plain `node`
 * processes, not systemd units: `up` starts whichever of them is not answering,
 * detached, with the loopback stack's values (handoff 56 §5.5, §5.5.2), logging
 * to the workspace `scratch/` directory.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACE = resolve(REPO, "../..");
const LOCAL_CONFIG = resolve(WORKSPACE, "local-config/het-kitluy-project");
export const FUNCTIONS_DIR = resolve(REPO, "supabase/functions");
const EDGE_SNAPSHOT = resolve(LOCAL_CONFIG, "edge-runtime-kitluy-fresh.json");
const LOG_DIR = resolve(WORKSPACE, "scratch");

export const STACK = "kitluy-fresh";
export const EDGE = `supabase_edge_runtime_${STACK}`;
const NETWORK = `supabase_network_${STACK}`;
const DENO_CACHE_VOLUME = EDGE;
const HUB_DB = "kitluy-hub-local";
// Start order: database first, then the services that read it, then kong.
const CONTAINERS = [
  `supabase_db_${STACK}`,
  `supabase_auth_${STACK}`,
  `supabase_rest_${STACK}`,
  `supabase_pg_meta_${STACK}`,
  EDGE,
  `supabase_kong_${STACK}`,
  HUB_DB,
];

// The Supabase CLI's fixed local credentials for the `kitluy-fresh` database
// on :54372 — the value every hardware runbook uses (handoff 56 §5.5).
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54372/postgres";
const REGISTRATION = "http://127.0.0.1:54371/functions/v1/device-registration";

/** What each dev endpoint answers when it is healthy. Not all of them are 200. */
export const PROBES = [
  {
    name: ":54371 device-registration",
    url: REGISTRATION,
    init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    status: 400,
    body: "KLUY-REG-MALFORMED",
  },
  { name: ":8787 fleet/registry", url: "http://127.0.0.1:8787/health/ready", status: 200 },
  { name: ":8791 release source", url: "http://127.0.0.1:8791/health", status: 200 },
  {
    name: ":8791 release refusal",
    url: "http://127.0.0.1:8791/release/v1/assignment",
    status: 400,
  },
  { name: ":8792 hub-sync producer", url: "http://127.0.0.1:8792/health", status: 200 },
  {
    name: ":8792 unsigned refusal",
    url: "http://127.0.0.1:8792/hub-sync/v1/terminal-projections",
    init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    status: 403,
    body: "REFUSED",
  },
  { name: ":8790 management API", url: "http://127.0.0.1:8790/health/ready", status: 200 },
];

function die(message) {
  console.error(`[dev-stack] ${message}`);
  process.exit(1);
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) die(`docker could not run: ${result.error.message}`);
  return result;
}

function inspect(name) {
  const result = docker(["inspect", "--type", "container", name]);
  return result.status === 0 ? JSON.parse(result.stdout)[0] : null;
}

/**
 * A function source is durable when a reboot cannot empty it: not under `/tmp`,
 * and inside a main working tree (a worktree can be removed; a Claude scratch
 * directory always is).
 */
export function assertDurableSource(dir) {
  if (dir === "/tmp" || dir.startsWith("/tmp/") || dir.startsWith("/var/tmp/")) {
    throw new Error(`${dir} is under a temporary directory that a reboot clears`);
  }
  const git = resolve(dir, "../../.git");
  if (!existsSync(git) || !statSync(git).isDirectory()) {
    throw new Error(`${dir} is not in the repository's main working tree`);
  }
}

/** The container's function bind source, or null when it has none. */
export function functionsMountOf(container) {
  const mount = (container?.Mounts ?? []).find(
    (m) => m.Type === "bind" && m.Destination.replace(/\/$/, "").endsWith("/supabase/functions"),
  );
  return mount ? mount.Source.replace(/\/$/, "") : null;
}

/** The parts of the existing container that the recreation must carry over. */
export function specFrom(container) {
  const network = container.NetworkSettings.Networks[NETWORK];
  return {
    image: container.Config.Image,
    // `docker run --entrypoint sh image -c …` stores ["sh"] + Cmd; take both.
    entrypoint: [...container.Config.Entrypoint, ...(container.Config.Cmd ?? [])],
    env: container.Config.Env.filter((line) => line.includes("=") && !line.startsWith("=")),
    labels: container.Config.Labels ?? {},
    aliases: (network?.Aliases ?? []).filter((alias) => alias === "edge_runtime"),
    extraHosts: container.HostConfig.ExtraHosts ?? [],
  };
}

/**
 * `docker run` arguments for the durable runtime. Environment VALUES never
 * appear here: each variable is passed by name (`-e NAME`) and docker reads it
 * from the child's environment.
 */
export function runArgs(spec, { functionsDir = FUNCTIONS_DIR, repo = REPO } = {}) {
  const [shell, ...rest] = spec.entrypoint;
  const args = ["run", "--detach", "--name", EDGE, "--network", NETWORK];
  for (const alias of spec.aliases) args.push("--network-alias", alias);
  args.push("--restart", "unless-stopped");
  for (const host of spec.extraHosts) args.push("--add-host", host);
  for (const [key, value] of Object.entries(spec.labels)) args.push("--label", `${key}=${value}`);
  args.push("--label", `com.kitluy.dev-stack.functions-source=${functionsDir}`);
  args.push("--volume", `${DENO_CACHE_VOLUME}:/root/.cache/deno:rw`);
  args.push("--volume", `${functionsDir}:${functionsDir}:ro`);
  args.push("--workdir", repo, "--expose", "8081");
  for (const line of spec.env) args.push("--env", line.slice(0, line.indexOf("=")));
  args.push("--entrypoint", shell, spec.image, ...rest);
  return args;
}

async function probe({ url, init, status, body }) {
  try {
    const response = await fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(5000) });
    const text = await response.text();
    const ok = response.status === status && (!body || text.includes(body));
    return { ok, detail: `${String(response.status)} ${text.slice(0, 90)}` };
  } catch (error) {
    return { ok: false, detail: String(error.cause?.code ?? error.message) };
  }
}

async function waitFor(check, seconds) {
  for (let i = 0; i < seconds; i += 1) {
    if ((await probe(check)).ok) return true;
    await new Promise((done) => setTimeout(done, 1000));
  }
  return (await probe(check)).ok;
}

async function recreateEdgeRuntime() {
  try {
    assertDurableSource(FUNCTIONS_DIR);
  } catch (error) {
    die(`refusing: ${error.message}. Run this from the main repository checkout.`);
  }
  if (!existsSync(resolve(FUNCTIONS_DIR, "device-registration/index.ts"))) {
    die(`${FUNCTIONS_DIR}/device-registration/index.ts is missing`);
  }
  const current = inspect(EDGE);
  let spec;
  if (current) {
    spec = specFrom(current);
    mkdirSync(LOCAL_CONFIG, { recursive: true, mode: 0o700 });
    writeFileSync(EDGE_SNAPSHOT, `${JSON.stringify(spec, null, 2)}\n`, { mode: 0o600 });
    chmodSync(EDGE_SNAPSHOT, 0o600);
    console.log(`[dev-stack] configuration snapshot (0600): ${EDGE_SNAPSHOT}`);
  } else if (existsSync(EDGE_SNAPSHOT)) {
    spec = JSON.parse(readFileSync(EDGE_SNAPSHOT, "utf8"));
    console.log(`[dev-stack] ${EDGE} is absent; recreating it from ${EDGE_SNAPSHOT}`);
  } else {
    die(`${EDGE} does not exist and there is no snapshot at ${EDGE_SNAPSHOT}`);
  }

  // Keep the old container, stopped and renamed, until the new one answers.
  const previous = `${EDGE}.replaced-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  if (current) {
    console.log(`[dev-stack] old function source: ${functionsMountOf(current) ?? "(none)"}`);
    docker(["stop", EDGE], { stdio: "ignore" });
    if (docker(["rename", EDGE, previous]).status !== 0) die(`could not rename ${EDGE}`);
  }
  const env = { ...process.env };
  for (const line of spec.env)
    env[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
  const run = docker(runArgs(spec), { env });
  if (run.status !== 0 || !(await waitFor(PROBES[0], 60))) {
    console.error(`[dev-stack] the new runtime did not become healthy: ${run.stderr.trim()}`);
    if (current) {
      docker(["rm", "--force", EDGE], { stdio: "ignore" });
      docker(["rename", previous, EDGE]);
      docker(["start", EDGE]);
      die(`restored the previous ${EDGE}`);
    }
    die("no previous container to restore");
  }
  if (current) docker(["rm", previous], { stdio: "ignore" });
  console.log(`[dev-stack] ${EDGE} recreated; function source ${FUNCTIONS_DIR} (read-only)`);
}

function publishableKey() {
  const kong = docker(["exec", `supabase_kong_${STACK}`, "cat", "/home/kong/kong.yml"]);
  const key = kong.stdout.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  if (!key) die("could not read the local publishable key from kong");
  return key;
}

function hostServices() {
  const common = {
    KITLUY_DEV_FLEET_DSN: LOCAL_DSN,
    KITLUY_DEV_PKI_DIR: resolve(LOCAL_CONFIG, "dev-pki"),
  };
  return [
    {
      name: "fleet-service",
      probe: PROBES[1],
      args: ["scripts/development/fleet-service.mjs", "--port", "8787"],
      needs: "services/kitluy-device-registry-service/dist",
      env: () => common,
    },
    {
      name: "release-service",
      probe: PROBES[2],
      args: ["scripts/development/release-service.mjs", "--port", "8791"],
      env: () => common,
    },
    {
      name: "hub-sync-service",
      probe: PROBES[4],
      args: ["scripts/development/hub-sync-service.mjs", "--port", "8792"],
      env: () => common,
    },
    {
      // handoff 56 §5.5.2: KITLUY_ENV=local and the bare origin, or it refuses.
      name: "management-api",
      probe: PROBES[6],
      cwd: "services/kitluy-management-api",
      args: ["dist/main.js"],
      needs: "services/kitluy-management-api/dist/main.js",
      env: () => ({
        PORT: "8790",
        KITLUY_ENV: "local",
        MANAGEMENT_API_AUTH_URL: "http://127.0.0.1:54371",
        MANAGEMENT_API_DATABASE_URL: LOCAL_DSN,
        MANAGEMENT_API_AUTH_PUBLISHABLE_KEY: publishableKey(),
      }),
    },
  ];
}

async function up() {
  for (const name of CONTAINERS) {
    const container = inspect(name);
    if (!container) die(`container ${name} does not exist`);
    if (!container.State.Running) {
      console.log(`[dev-stack] starting ${name}`);
      if (docker(["start", name]).status !== 0) die(`could not start ${name}`);
    }
  }
  const source = functionsMountOf(inspect(EDGE));
  if (source !== FUNCTIONS_DIR) {
    die(
      `${EDGE} serves functions from ${String(source)}, not ${FUNCTIONS_DIR}. Run: pnpm dev:stack:edge-runtime`,
    );
  }
  for (let i = 0; i < 60; i += 1) {
    if (docker(["exec", `supabase_db_${STACK}`, "pg_isready", "-U", "postgres"]).status === 0)
      break;
    await new Promise((done) => setTimeout(done, 1000));
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  for (const service of hostServices()) {
    if ((await probe(service.probe)).ok) continue;
    if (service.needs && !existsSync(resolve(REPO, service.needs))) {
      die(`${service.name} needs ${service.needs}; run pnpm build first`);
    }
    const log = resolve(LOG_DIR, `${day}__dev-stack-${service.name}.log`);
    const out = openSync(log, "a");
    const child = spawn(process.execPath, service.args, {
      cwd: resolve(REPO, service.cwd ?? "."),
      env: { ...process.env, ...service.env() },
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
    console.log(`[dev-stack] started ${service.name} (pid ${String(child.pid)}), log ${log}`);
    if (!(await waitFor(service.probe, 30)))
      console.error(`[dev-stack] ${service.name} is not answering yet`);
  }
  return health();
}

async function health() {
  let failed = 0;
  for (const check of PROBES) {
    const result = await probe(check);
    if (!result.ok) failed += 1;
    console.log(`${result.ok ? "OK  " : "FAIL"} ${check.name.padEnd(26)} ${result.detail}`);
  }
  const container = inspect(EDGE);
  const source = functionsMountOf(container);
  const durable = source === FUNCTIONS_DIR;
  if (!durable) failed += 1;
  console.log(
    `${durable ? "OK  " : "FAIL"} ${"edge function source".padEnd(26)} ${String(source)}`,
  );
  const policy = container?.HostConfig.RestartPolicy.Name;
  if (policy !== "unless-stopped") failed += 1;
  console.log(
    `${policy === "unless-stopped" ? "OK  " : "FAIL"} ${"edge restart policy".padEnd(26)} ${String(policy)}`,
  );
  const git = spawnSync("git", ["status", "--porcelain", "--", "supabase/functions"], {
    cwd: REPO,
    encoding: "utf8",
  });
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout.trim();
  console.log(
    `${git.stdout.trim() ? "WARN" : "OK  "} ${"served source vs git".padEnd(26)} ${git.stdout.trim() ? "uncommitted changes are being served" : `clean at ${head}`}`,
  );
  if (failed) console.error(`[dev-stack] ${String(failed)} check(s) failed`);
  return failed === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const command = process.argv[2];
  if (command === "edge-runtime") await recreateEdgeRuntime();
  else if (command === "up") process.exitCode = (await up()) ? 0 : 1;
  else if (command === "health") process.exitCode = (await health()) ? 0 : 1;
  else die("usage: dev-stack.mjs up | health | edge-runtime");
}
