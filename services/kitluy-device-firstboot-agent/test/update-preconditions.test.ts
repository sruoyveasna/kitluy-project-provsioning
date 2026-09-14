/**
 * The update agent's preconditions, and the release-source override.
 *
 * The override exists because a baked IP in an EROFS rootfs would make a DHCP
 * lease change cost a reflash. These tests are about the one property that
 * matters: an edit on the persistent partition wins, and everything else falls
 * through to the image's default in silence.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluatePreconditions } from "../src/bin/update-bootstrap.js";

let root: string;
let trustDir: string;
let baked: string;
let override: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kt-precond-"));
  trustDir = join(root, "trust");
  mkdirSync(trustDir, { recursive: true });
  baked = join(root, "release.env");
  override = join(root, "release-source.env");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function anchor(): void {
  writeFileSync(join(trustDir, "release-signing.json"), "{}");
}
function evaluate() {
  return evaluatePreconditions({
    trustDir,
    releaseConfigPath: baked,
    releaseSourceOverridePath: override,
    imageEnvPath: join(root, "image.env"),
  });
}

describe("trust is a precondition, not a step", () => {
  it("refuses to look for a payload with no trust anchor", () => {
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    expect(evaluate().kind).toBe("no_trust_anchor");
  });

  it("accepts a .json trust record, which is the shape the dev PKI writes", () => {
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    expect(evaluate().kind).toBe("ready");
  });
});

describe("the release source", () => {
  it("is 'no source' when neither file names one", () => {
    anchor();
    expect(evaluate().kind).toBe("no_release_source");
  });

  it("falls back to the image's baked default", () => {
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    const state = evaluate();
    expect(state).toMatchObject({
      kind: "ready",
      source: "http://10.0.0.1:8790",
      sourceFrom: "image",
    });
  });

  it("PREFERS the persistent override, so a moved workstation costs no reflash", () => {
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    writeFileSync(override, "KITLUY_RELEASE_SOURCE=http://172.16.13.9:8790\n");
    expect(evaluate()).toMatchObject({
      kind: "ready",
      source: "http://172.16.13.9:8790",
      sourceFrom: "override",
    });
  });

  it("works with an override and NO baked default at all", () => {
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=\n");
    writeFileSync(override, "KITLUY_RELEASE_SOURCE=http://172.16.13.9:8790\n");
    expect(evaluate()).toMatchObject({ kind: "ready", sourceFrom: "override" });
  });

  it("ignores an EMPTY override rather than treating it as 'no source'", () => {
    // An operator who blanks the file gets the image default back, not a dead
    // agent. Empty is not the same as absent, and neither is a configuration.
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    writeFileSync(override, "KITLUY_RELEASE_SOURCE=\n");
    expect(evaluate()).toMatchObject({ source: "http://10.0.0.1:8790", sourceFrom: "image" });
  });

  it("ignores an unparseable override rather than failing closed on it", () => {
    anchor();
    writeFileSync(baked, "KITLUY_RELEASE_SOURCE=http://10.0.0.1:8790\n");
    writeFileSync(override, "this is not an env file\n");
    expect(evaluate()).toMatchObject({ source: "http://10.0.0.1:8790", sourceFrom: "image" });
  });

  it("trims whitespace, because an editor adds it", () => {
    anchor();
    writeFileSync(override, "KITLUY_RELEASE_SOURCE=  http://172.16.13.9:8790  \n");
    expect(evaluate()).toMatchObject({ source: "http://172.16.13.9:8790" });
  });
});
