/**
 * The decisions a Store Hub makes before it agrees to serve a shop.
 *
 * Every test here is about a refusal, because that is where the value is: a Hub
 * that serves terminals from a schema it does not recognise, or with a
 * certificate nobody approved, is worse than a Hub that is plainly down — the
 * shop keeps trading on answers no one can stand behind.
 */
import { describe, expect, it } from "vitest";

import {
  certificateFingerprint,
  decideStartup,
  evaluateSchema,
  loadTlsMaterial,
  resolveBindHost,
  type HubStartupObservations,
} from "../src/hub-runtime.js";
import type { HubSafetyObservations } from "../src/hub/safety-mode.js";

const HEALTHY_SAFETY: HubSafetyObservations = {
  readOnlyDeclared: false,
  diskUsedPercent: 20,
  migration: { expected: [], applied: [] },
  databaseIntegritySuspect: false,
  configuration: { compatible: true, knownGoodActive: true },
  clockOffsetSeconds: 0,
};

const PRESENT_TLS = {
  kind: "present" as const,
  key: "KEY",
  cert: "CERT",
  clientCa: "CA",
};

function observations(over: Partial<HubStartupObservations> = {}): HubStartupObservations {
  return {
    databaseReachable: true,
    schema: { ok: true },
    tls: PRESENT_TLS,
    bind: { kind: "resolved", bindHost: "192.168.1.50", interfaceName: "eth0" },
    safety: HEALTHY_SAFETY,
    ...over,
  };
}

describe("where the Hub is allowed to listen", () => {
  it("takes a configured address as given", () => {
    const r = resolveBindHost("192.168.1.50", {});
    expect(r.kind === "resolved" && r.bindHost).toBe("192.168.1.50");
  });

  it("REFUSES every wildcard, because the transport does", () => {
    // The image shipped 0.0.0.0 until this was fixed. `createEdgeTlsServer`
    // throws on it, so a Hub built that way could never have started.
    for (const wildcard of ["0.0.0.0", "::", "*"]) {
      const r = resolveBindHost(wildcard, {});
      expect(r.kind).toBe("refused");
      expect(r.kind === "refused" && r.code).toBe("KLUY-HUB-BIND-WILDCARD");
    }
  });

  it("treats a blank value as UNSET rather than as a wildcard", () => {
    // `HUB_LAN_BIND_HOST=` or a stray space is an absent setting, not a request
    // to bind everything — so it falls through to resolution and reports the
    // real problem (no interface here) instead of a misleading wildcard refusal.
    const r = resolveBindHost("   ", {});
    expect(r.kind === "refused" && r.code).toBe("KLUY-HUB-BIND-NO-INTERFACE");
  });

  it("resolves the single real interface when nothing is configured", () => {
    const r = resolveBindHost(undefined, {
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }] as never,
      eth0: [{ family: "IPv4", address: "192.168.1.50", internal: false }] as never,
    });
    expect(r.kind === "resolved" && r.bindHost).toBe("192.168.1.50");
    expect(r.kind === "resolved" && r.interfaceName).toBe("eth0");
  });

  it("ignores docker and tunnel interfaces, which are not the shop's network", () => {
    const r = resolveBindHost(undefined, {
      docker0: [{ family: "IPv4", address: "172.17.0.1", internal: false }] as never,
      tailscale0: [{ family: "IPv4", address: "100.64.0.1", internal: false }] as never,
      eth0: [{ family: "IPv4", address: "192.168.1.50", internal: false }] as never,
    });
    // A Hub bound to a docker bridge looks healthy and serves nobody.
    expect(r.kind === "resolved" && r.bindHost).toBe("192.168.1.50");
  });

  it("REFUSES to guess between two candidate networks", () => {
    const r = resolveBindHost(undefined, {
      eth0: [{ family: "IPv4", address: "192.168.1.50", internal: false }] as never,
      wlan0: [{ family: "IPv4", address: "10.0.0.7", internal: false }] as never,
    });
    // Guessing wrong produces a Hub that is silently unreachable — the worst
    // outcome, because everything reports healthy.
    expect(r.kind === "refused" && r.code).toBe("KLUY-HUB-BIND-AMBIGUOUS");
  });

  it("refuses when there is no network at all", () => {
    const r = resolveBindHost(undefined, {
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }] as never,
    });
    expect(r.kind === "refused" && r.code).toBe("KLUY-HUB-BIND-NO-INTERFACE");
  });
});

describe("certificate material is loaded, never invented", () => {
  it("reports UNCONFIGURED when no paths are set, naming what is missing", () => {
    const m = loadTlsMaterial({ keyPath: undefined, certPath: undefined, clientCaPath: undefined });
    expect(m.kind).toBe("absent");
    expect(m.kind === "absent" && m.code).toBe("KLUY-HUB-TLS-UNCONFIGURED");
    // The operator must be told this is a decision nobody has made, not a bug.
    expect(m.kind === "absent" && m.detail).toContain("BLK-005");
  });

  it("distinguishes 'not configured' from 'configured but missing'", () => {
    const m = loadTlsMaterial(
      { keyPath: "/k", certPath: "/c", clientCaPath: "/ca" },
      () => "",
      () => false,
    );
    // Different operator action: one is a decision, the other is a broken file.
    expect(m.kind === "absent" && m.code).toBe("KLUY-HUB-TLS-MISSING");
  });

  it("loads all three when present", () => {
    const m = loadTlsMaterial(
      { keyPath: "/k", certPath: "/c", clientCaPath: "/ca" },
      (p) => `contents-of-${p}`,
      () => true,
    );
    expect(m.kind).toBe("present");
    expect(m.kind === "present" && m.key).toBe("contents-of-/k");
  });

  it("fingerprints a certificate the way the transport reports a peer", () => {
    // Lowercase hex SHA-256 over DER, no separators — a terminal pins the
    // handshake against this value, so a different encoding here would break
    // every pairing that otherwise verified.
    const der = Buffer.from("hello store hub");
    const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64")}\n-----END CERTIFICATE-----\n`;
    expect(certificateFingerprint(pem)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the schema must be the one this release expects", () => {
  const m = (filename: string, checksumSha256: string) => ({ filename, checksumSha256 });

  it("accepts an exact match", () => {
    expect(evaluateSchema([m("0001_a.sql", "aa")], [m("0001_a.sql", "aa")]).ok).toBe(true);
  });

  it("REFUSES when an applied migration's bytes changed", () => {
    // Schema contract §4: an applied file is never edited. The checksum is how
    // that is caught, and it outranks 'pending' because it means the database
    // is not what any release describes.
    const v = evaluateSchema([m("0001_a.sql", "aa")], [m("0001_a.sql", "bb")]);
    expect(v.code).toBe("KLUY-HUB-SCHEMA-DRIFT");
  });

  it("refuses pending migrations, naming the first", () => {
    const v = evaluateSchema(
      [m("0001_a.sql", "aa"), m("0002_b.sql", "bb")],
      [m("0001_a.sql", "aa")],
    );
    expect(v.code).toBe("KLUY-HUB-SCHEMA-PENDING");
    expect(v.detail).toContain("0002_b.sql");
  });

  it("refuses a database AHEAD of the release, which is a different problem", () => {
    // Downgrading the Hub without downgrading its database. Applying migrations
    // would not fix it, so it must not be reported as pending.
    const v = evaluateSchema(
      [m("0001_a.sql", "aa")],
      [m("0001_a.sql", "aa"), m("0002_b.sql", "bb")],
    );
    expect(v.code).toBe("KLUY-HUB-SCHEMA-AHEAD");
  });
});

describe("the startup verdict", () => {
  it("serves when everything holds", () => {
    const v = decideStartup(observations());
    expect(v.kind).toBe("serve");
    expect(v.kind === "serve" && v.bindHost).toBe("192.168.1.50");
  });

  it("refuses without a database, and says THAT rather than a consequence of it", () => {
    const v = decideStartup(observations({ databaseReachable: false }));
    expect(v.kind === "refuse" && v.code).toBe("KLUY-HUB-DB-UNREACHABLE");
  });

  it("reports the FIRST thing wrong, not a downstream symptom", () => {
    // No database AND no schema. "Schema pending" would send an operator to run
    // migrations against a database that is not there.
    const v = decideStartup(
      observations({
        databaseReachable: false,
        schema: { ok: false, code: "KLUY-HUB-SCHEMA-PENDING", detail: "x" },
      }),
    );
    expect(v.kind === "refuse" && v.code).toBe("KLUY-HUB-DB-UNREACHABLE");
  });

  it("refuses to serve terminals with no certificate material", () => {
    const v = decideStartup({
      ...observations(),
      tls: { kind: "absent", code: "KLUY-HUB-TLS-UNCONFIGURED", detail: "BLK-005" },
    });
    expect(v.kind === "refuse" && v.code).toBe("KLUY-HUB-TLS-UNCONFIGURED");
  });

  it("still produces a safety assessment when it refuses on TLS", () => {
    // The operator needs to know the rest of the Hub's condition, not only the
    // first refusal — otherwise fixing one problem reveals another one at a time.
    const v = decideStartup({
      ...observations(),
      tls: { kind: "absent", code: "KLUY-HUB-TLS-UNCONFIGURED", detail: "BLK-005" },
    });
    expect(v.kind === "refuse" && v.assessment).toBeDefined();
  });

  it("DEGRADED IS NOT REFUSED — a reduced Hub still keeps the shop trading", () => {
    // Safety mode exists so a Hub keeps working in a limited state. Turning a
    // degradation into a refusal would replace a working till with a dead one.
    const v = decideStartup(
      observations({
        safety: { ...HEALTHY_SAFETY, readOnlyDeclared: true, readOnlyReason: "operator" },
      }),
    );
    expect(v.kind).toBe("serve");
    expect(v.kind === "serve" && v.assessment.degraded).toBe(true);
  });

  it("refuses a wildcard bind before trying to build a server that would throw", () => {
    const v = decideStartup(
      observations({
        bind: { kind: "refused", code: "KLUY-HUB-BIND-WILDCARD", detail: "0.0.0.0" },
      }),
    );
    expect(v.kind === "refuse" && v.code).toBe("KLUY-HUB-BIND-WILDCARD");
  });
});
