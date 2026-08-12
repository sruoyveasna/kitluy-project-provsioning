/**
 * Firstboot identity bootstrap — rerun safety and key-loss handling.
 *
 * Covers the OS/agent test requirements: firstboot rerun safety, and the
 * private-key containment rule.
 */
import { describe, expect, it } from "vitest";

import {
  bootstrapIdentity,
  type FirstbootDeps,
  type HardwareProbe,
  type IdentityStore,
  type KeyProvider,
  type StoredIdentity,
} from "../src/identity.js";

function memoryStore(initial: StoredIdentity | null = null): IdentityStore & {
  writes: number;
  current: StoredIdentity | null;
} {
  const state = {
    current: initial,
    writes: 0,
    async read() {
      return state.current;
    },
    async write(identity: StoredIdentity) {
      state.writes += 1;
      state.current = identity;
    },
  };
  return state;
}

function keyProvider(options: { usable?: boolean } = {}): KeyProvider & { generated: number } {
  let counter = 0;
  const provider = {
    generated: 0,
    async generateKeyPair() {
      counter += 1;
      provider.generated = counter;
      return {
        publicKeyPem: `-----BEGIN PUBLIC KEY-----\nkey-${counter}\n-----END PUBLIC KEY-----`,
        privateKeyHandle: `handle-${counter}`,
      };
    },
    async verifyKeyUsable() {
      return options.usable ?? true;
    },
  };
  return provider;
}

const hardware: HardwareProbe = {
  async collect() {
    return {
      macAddress: "b8:27:eb:00:00:01",
      boardSerial: "board-0001",
      storageSerial: "nvme-0001",
      storageModel: "TESTNVME",
    };
  },
};

function deps(store: IdentityStore, keys: KeyProvider): FirstbootDeps {
  return { store, keys, hardware, now: () => new Date("2026-08-07T00:00:00.000Z") };
}

describe("firstboot identity bootstrap", () => {
  it("creates identity on a factory-fresh device", async () => {
    const store = memoryStore();
    const keys = keyProvider();

    const outcome = await bootstrapIdentity(deps(store, keys));

    expect(outcome.kind).toBe("created");
    expect(outcome.identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(store.writes).toBe(1);
  });

  it("is rerun-safe: a second boot reuses the same identity and generates no new key", async () => {
    const store = memoryStore();
    const keys = keyProvider();

    const first = await bootstrapIdentity(deps(store, keys));
    const second = await bootstrapIdentity(deps(store, keys));

    expect(second.kind).toBe("reused");
    expect(second.identity.publicKeyPem).toBe(first.identity.publicKeyPem);
    expect(keys.generated).toBe(1);
    expect(store.writes).toBe(1);
  });

  it("is rerun-safe across many boots", async () => {
    const store = memoryStore();
    const keys = keyProvider();

    await bootstrapIdentity(deps(store, keys));
    for (let i = 0; i < 10; i += 1) {
      const outcome = await bootstrapIdentity(deps(store, keys));
      expect(outcome.kind).toBe("reused");
    }
    expect(keys.generated).toBe(1);
  });

  it("recreates identity when a previous firstboot was torn (complete=false)", async () => {
    // The exact failure a marker-file guard would misread as "already done".
    const store = memoryStore({
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\npartial\n-----END PUBLIC KEY-----",
      privateKeyHandle: "handle-partial",
      hardwareSignals: {},
      createdAt: "2026-08-06T00:00:00.000Z",
      complete: false,
    });
    const keys = keyProvider();

    const outcome = await bootstrapIdentity(deps(store, keys));

    expect(outcome.kind).toBe("recreated");
    if (outcome.kind === "recreated") {
      expect(outcome.reason).toContain("torn write");
    }
    expect(store.current?.complete).toBe(true);
  });

  it("recreates identity when the stored private key is no longer usable", async () => {
    const store = memoryStore({
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----",
      privateKeyHandle: "handle-gone",
      hardwareSignals: {},
      createdAt: "2026-08-06T00:00:00.000Z",
      complete: true,
    });
    const keys = keyProvider({ usable: false });

    const outcome = await bootstrapIdentity(deps(store, keys));

    expect(outcome.kind).toBe("recreated");
    if (outcome.kind === "recreated") {
      expect(outcome.reason).toContain("no longer usable");
    }
  });

  it("never exposes private key material in the transmittable record", async () => {
    const store = memoryStore();
    const keys = keyProvider();

    const outcome = await bootstrapIdentity(deps(store, keys));
    const serialised = JSON.stringify(outcome.identity);

    expect(serialised).not.toContain("handle-");
    expect(serialised).not.toContain("privateKeyHandle");
    expect(Object.keys(outcome.identity)).not.toContain("privateKeyHandle");
  });

  it("collects hardware signals as evidence without deriving identity from them", async () => {
    const store = memoryStore();
    const keys = keyProvider();

    const outcome = await bootstrapIdentity(deps(store, keys));

    expect(outcome.identity.hardwareSignals.macAddress).toBe("b8:27:eb:00:00:01");
    // The public key is the key provider's output, unrelated to any hardware value.
    expect(outcome.identity.publicKeyPem).not.toContain("b8:27:eb");
    expect(outcome.identity.publicKeyPem).not.toContain("board-0001");
    expect(outcome.identity.publicKeyPem).not.toContain("nvme-0001");
  });

  it("does not carry a deviceRecordId before the cloud has issued one", async () => {
    const store = memoryStore();
    const outcome = await bootstrapIdentity(deps(store, keyProvider()));
    expect(outcome.identity.deviceRecordId).toBeUndefined();
  });
});
