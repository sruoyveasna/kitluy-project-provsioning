#!/usr/bin/env node
/**
 * `pnpm dev:stack:check` — the parts of `dev-stack.mjs` that decide what the
 * recreated edge runtime looks like, checked without touching Docker.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EDGE,
  FUNCTIONS_DIR,
  REPO,
  assertDurableSource,
  functionsMountOf,
  runArgs,
  specFrom,
} from "./dev-stack.mjs";

const DEAD = "/tmp/claude-1000/project/session/scratchpad/fresh-stack/supabase/functions";

const container = {
  Config: {
    Image: "public.ecr.aws/supabase/edge-runtime:v1.73.3",
    Entrypoint: ["sh", "-c", "edge-runtime start --main-service=/root"],
    Env: [
      "SUPABASE_INTERNAL_JWT_SECRET=not-a-real-secret",
      "SUPABASE_INTERNAL_HOST_PORT=54371",
      "=",
    ],
    Labels: { "com.supabase.cli.project": "kitluy-fresh" },
  },
  HostConfig: { ExtraHosts: ["host.docker.internal:host-gateway"] },
  NetworkSettings: {
    Networks: { "supabase_network_kitluy-fresh": { Aliases: ["edge_runtime", "1b7b70e0f22a"] } },
  },
  Mounts: [
    { Type: "volume", Source: "/var/lib/docker/volumes/x/_data", Destination: "/root/.cache/deno" },
    { Type: "bind", Source: DEAD, Destination: `${DEAD}/` },
  ],
};

test("a /tmp function source is refused; the repository's is accepted", () => {
  assert.throws(() => assertDurableSource(DEAD), /temporary directory/);
  assert.doesNotThrow(() => assertDurableSource(FUNCTIONS_DIR));
});

test("the function mount is found on the old container", () => {
  assert.equal(functionsMountOf(container), DEAD);
  assert.equal(functionsMountOf(null), null);
});

test("the recreated runtime mounts the repository read-only, restarts, and keeps kong's name", () => {
  const args = runArgs(specFrom(container));
  const joined = args.join(" ");
  assert.ok(joined.includes(`--name ${EDGE}`));
  assert.ok(joined.includes(`--volume ${FUNCTIONS_DIR}:${FUNCTIONS_DIR}:ro`));
  assert.ok(joined.includes(`--workdir ${REPO}`));
  assert.ok(joined.includes("--restart unless-stopped"));
  assert.ok(
    joined.includes("--network supabase_network_kitluy-fresh --network-alias edge_runtime"),
  );
  assert.ok(!joined.includes("1b7b70e0f22a"), "the old container id is not carried as an alias");
  assert.ok(!joined.includes("/tmp/"), "nothing under /tmp");
  assert.deepEqual(args.slice(-3), [
    "public.ecr.aws/supabase/edge-runtime:v1.73.3",
    "-c",
    "edge-runtime start --main-service=/root",
  ]);
});

test("a runtime this script created is recreated with its whole command", () => {
  const recreated = {
    ...container,
    Config: {
      ...container.Config,
      Entrypoint: ["sh"],
      Cmd: ["-c", "edge-runtime start --main-service=/root"],
    },
  };
  assert.deepEqual(specFrom(recreated).entrypoint, container.Config.Entrypoint);
});

test("environment values never reach the command line", () => {
  const args = runArgs(specFrom(container));
  assert.ok(!args.join(" ").includes("not-a-real-secret"));
  assert.ok(args.includes("SUPABASE_INTERNAL_JWT_SECRET"));
  assert.ok(!args.includes(""), "the empty env entry is dropped");
});
