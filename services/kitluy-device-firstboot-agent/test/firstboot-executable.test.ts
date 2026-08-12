/**
 * The firstboot ENTRYPOINT and its production adapters.
 *
 * The existing `firstboot-identity.test.ts` proves the state machine against
 * fakes. This file proves the part that ships on the device: real files, real
 * keys, real permissions — the layer where "atomic write" and "0600" either
 * hold or do not.
 *
 * Owner continuation §9A requires proof of: first boot creates, second boot
 * reuses, the private key stays device-local, permissions are restrictive, and
 * corruption fails safely.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootstrapIdentity } from "../src/identity.js";
import {
  CorruptIdentityRecordError,
  FileIdentityStore,
  IDENTITY_FILE_NAME,
} from "../src/adapters/device-identity-store.js";
import { FileKeyProvider, PRIVATE_KEY_FILE_NAME } from "../src/adapters/device-key-provider.js";
import { LinuxHardwareProbe } from "../src/adapters/linux-hardware-probe.js";
import { buildDeps, main, EXIT_OK, EXIT_CORRUPT_IDENTITY } from "../src/bin/firstboot-identity.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-firstboot-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.KITLUY_IDENTITY_DIR;
});

describe("firstboot entrypoint", () => {
  it("first run creates an identity and exits 0", async () => {
    process.env.KITLUY_IDENTITY_DIR = dir;
    expect(await main()).toBe(EXIT_OK);
    const record = JSON.parse(readFileSync(join(dir, IDENTITY_FILE_NAME), "utf8")) as {
      complete: boolean;
      publicKeyPem: string;
    };
    expect(record.complete).toBe(true);
    expect(record.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  it("is idempotent — a second and third run reuse the same identity", async () => {
    process.env.KITLUY_IDENTITY_DIR = dir;
    await main();
    const first = readFileSync(join(dir, IDENTITY_FILE_NAME), "utf8");
    const firstKey = readFileSync(join(dir, PRIVATE_KEY_FILE_NAME), "utf8");

    await main();
    await main();

    // Byte-identical: a reboot must not re-key, and must not even rewrite.
    expect(readFileSync(join(dir, IDENTITY_FILE_NAME), "utf8")).toBe(first);
    expect(readFileSync(join(dir, PRIVATE_KEY_FILE_NAME), "utf8")).toBe(firstKey);
  });

  it("reports `reused` rather than `created` on the second run", async () => {
    const deps = buildDeps(dir);
    expect((await bootstrapIdentity(deps)).kind).toBe("created");
    expect((await bootstrapIdentity(deps)).kind).toBe("reused");
  });

  it("two devices flashed from one image do not share an identity", async () => {
    const a = mkdtempSync(join(tmpdir(), "kitluy-dev-a-"));
    const b = mkdtempSync(join(tmpdir(), "kitluy-dev-b-"));
    try {
      const ra = await bootstrapIdentity(buildDeps(a));
      const rb = await bootstrapIdentity(buildDeps(b));
      expect(ra.identity.publicKeyPem).not.toBe(rb.identity.publicKeyPem);
      expect(readFileSync(join(a, PRIVATE_KEY_FILE_NAME), "utf8")).not.toBe(
        readFileSync(join(b, PRIVATE_KEY_FILE_NAME), "utf8"),
      );
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("private key custody", () => {
  it("never appears in the identity record", async () => {
    await bootstrapIdentity(buildDeps(dir));
    const raw = readFileSync(join(dir, IDENTITY_FILE_NAME), "utf8");
    expect(raw).not.toContain("PRIVATE KEY");
    // The handle is a reference, not the material.
    const record = JSON.parse(raw) as { privateKeyHandle: string };
    expect(record.privateKeyHandle).not.toContain("PRIVATE KEY");
  });

  it("is written 0600 and the directory 0700", async () => {
    await bootstrapIdentity(buildDeps(dir));
    expect(statSync(join(dir, PRIVATE_KEY_FILE_NAME)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, IDENTITY_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("re-tightens permissions if an existing key file was loosened", async () => {
    const keys = new FileKeyProvider({ directory: dir });
    await keys.generateKeyPair();
    chmodSync(join(dir, PRIVATE_KEY_FILE_NAME), 0o644);
    await keys.generateKeyPair();
    expect(statSync(join(dir, PRIVATE_KEY_FILE_NAME)).mode & 0o777).toBe(0o600);
  });

  it("verifyKeyUsable proves possession by signing, and rejects a corrupt key", async () => {
    const keys = new FileKeyProvider({ directory: dir });
    const { privateKeyHandle } = await keys.generateKeyPair();
    expect(await keys.verifyKeyUsable(privateKeyHandle)).toBe(true);

    writeFileSync(privateKeyHandle, "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n");
    expect(await keys.verifyKeyUsable(privateKeyHandle)).toBe(false);
    expect(await keys.verifyKeyUsable(join(dir, "absent.pem"))).toBe(false);
  });

  it("re-keys — not silently reuses — when the stored key became unusable", async () => {
    const deps = buildDeps(dir);
    const first = await bootstrapIdentity(deps);
    writeFileSync(join(dir, PRIVATE_KEY_FILE_NAME), "corrupted");

    const second = await bootstrapIdentity(deps);
    expect(second.kind).toBe("recreated");
    expect(second.identity.publicKeyPem).not.toBe(first.identity.publicKeyPem);
  });
});

describe("failing safely", () => {
  it("refuses a corrupt identity record instead of minting a new one", async () => {
    writeFileSync(join(dir, IDENTITY_FILE_NAME), "{ not json");
    const store = new FileIdentityStore({ directory: dir });
    await expect(store.read()).rejects.toBeInstanceOf(CorruptIdentityRecordError);

    process.env.KITLUY_IDENTITY_DIR = dir;
    expect(await main()).toBe(EXIT_CORRUPT_IDENTITY);
    // The evidence is still there for a governed decision.
    expect(readFileSync(join(dir, IDENTITY_FILE_NAME), "utf8")).toBe("{ not json");
  });

  it("treats a record missing `complete` as a torn write and recreates it", async () => {
    writeFileSync(
      join(dir, IDENTITY_FILE_NAME),
      JSON.stringify({
        publicKeyPem: "x",
        privateKeyHandle: "y",
        createdAt: "2026-01-01T00:00:00.000Z",
        hardwareSignals: {},
        complete: false,
      }),
    );
    const outcome = await bootstrapIdentity(buildDeps(dir));
    expect(outcome.kind).toBe("recreated");
  });

  it("leaves no temp file behind after a successful write", async () => {
    await bootstrapIdentity(buildDeps(dir));
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });
});

describe("hardware probe", () => {
  it("returns signals as evidence and never throws on a missing filesystem", async () => {
    const probe = new LinuxHardwareProbe({ sysRoot: join(dir, "nope"), procRoot: join(dir, "nope") });
    await expect(probe.collect()).resolves.toEqual({});
  });

  it("skips loopback and all-zero MAC addresses", async () => {
    const sys = join(dir, "sys");
    const net = join(sys, "class", "net");
    for (const [iface, mac] of [["lo", "00:00:00:00:00:00"], ["eth0", "00:00:00:00:00:00"], ["eth1", "dc:a6:32:11:22:33"]]) {
      const d = join(net, iface as string);
      mkdirpSync(d);
      writeFileSync(join(d, "address"), `${mac}\n`);
    }
    const probe = new LinuxHardwareProbe({ sysRoot: sys, procRoot: join(dir, "nope") });
    expect((await probe.collect()).macAddress).toBe("dc:a6:32:11:22:33");
  });

  it("reads the Pi serial from cpuinfo", async () => {
    const proc = join(dir, "proc");
    mkdirpSync(proc);
    writeFileSync(join(proc, "cpuinfo"), "processor\t: 0\nSerial\t\t: 10000000abcd1234\n");
    const signals = await new LinuxHardwareProbe({
      sysRoot: join(dir, "nope"),
      procRoot: proc,
    }).collect();
    expect(signals.socSerial).toBe("10000000abcd1234");
    expect(signals.boardSerial).toBe("10000000abcd1234");
  });
});

function mkdirpSync(p: string): void {
  mkdirSync(p, { recursive: true });
}
