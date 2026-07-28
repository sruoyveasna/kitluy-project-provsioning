/**
 * WS-10-T007 / WS-10-T008 — signed grant and snapshot publication, Hub
 * verification, atomic activation and rollback.
 *
 * Authority: schema contract §6.2, §12 acceptance test 7, KLD-2026-07-28-001
 * Group 5 (KLREQ-025).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { withHubTransaction } from "../src/hub/db.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { SyncDeliveryError } from "../src/hub/sync/errors.js";
import { DevelopmentHmacBatchSigner } from "../src/hub/sync/signing.js";
import {
  activateSnapshot,
  activeSnapshot,
  recordDownloadedSnapshot,
  rollbackSnapshot,
  snapshotManifest,
  snapshotManifestSha256,
  verifySnapshot,
  verifySnapshotOrThrow,
  type PublishedSnapshot,
} from "../src/hub/sync/configuration.js";
import {
  GRANT_PROJECTION_FIELD_CONTRACT,
  isPermitted,
  projectGrant,
  resolveGrant,
  type PublishedGrant,
} from "../src/hub/sync/grants.js";
import {
  ATTACKER_STORE,
  ATTACKER_TENANT,
  STORE,
  TENANT,
  ensureRuntimeRoleMembership,
  hubReachable,
  pool,
} from "./hub-fixtures.js";

const signer = new DevelopmentHmacBatchSigner(
  "cloud-config-key-1",
  Buffer.from("development-only-configuration-signing-key-0123456789ab", "utf8"),
);

const available = await hubReachable();
if (!available) {
  console.warn("SKIPPED kitluy-hub-agent sync-configuration suite: Hub database unreachable");
}

/**
 * A PRIVATE Location for this suite.
 *
 * Activating a snapshot replaces the ACTIVE configuration for its Location, and
 * the command suites read the shipped Location's active pricing section on every
 * command. Publishing test configuration into the shared Location made those
 * suites fail with EDGE_CONFIGURATION_MISSING — a real interference, not a
 * flake. Hub-local configuration relations key on location_id without a foreign
 * key, so a synthetic Location isolates this suite completely.
 */
const CONFIG_LOCATION = "e0000000-0000-4000-8000-0000000009c1";

let snapshotVersion = BigInt(Date.now());

function publish(overrides: Partial<PublishedSnapshot> = {}): PublishedSnapshot {
  snapshotVersion += 1n;
  const base: PublishedSnapshot = {
    snapshotId: uuidv7(),
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: CONFIG_LOCATION,
    snapshotVersion,
    schemaVersion: 1,
    notBefore: new Date(Date.now() - 60_000),
    expiresAt: null,
    minimumHubVersion: "0.1.0",
    maximumHubVersion: null,
    sections: [
      {
        sectionCode: "pricing",
        sectionVersion: 1n,
        content: { currency_code: "USD", currency_exponent: 2, vat: 10 },
        required: true,
      },
      { sectionCode: "printing", sectionVersion: 1n, content: { copies: 2 }, required: false },
    ],
    signatureAlgorithm: signer.algorithm,
    signature: Buffer.alloc(0),
    signingKeyId: signer.keyId,
    ...overrides,
  };
  const signature = signer.sign(snapshotManifest(base));
  return { ...base, signature: Buffer.from(signature.signature, "base64") };
}

describe("snapshot manifest (pure)", () => {
  it("is stable across section ordering, so two publishers agree", () => {
    const a = publish();
    const reordered: PublishedSnapshot = { ...a, sections: [...a.sections].reverse() };
    expect(snapshotManifest(reordered)).toBe(snapshotManifest(a));
    expect(snapshotManifestSha256(reordered)).toBe(snapshotManifestSha256(a));
  });

  it("changes when ANY section content changes", () => {
    const a = publish();
    const tampered: PublishedSnapshot = {
      ...a,
      sections: [{ ...a.sections[0]!, content: { vat: 20 } }, a.sections[1]!],
    };
    expect(snapshotManifestSha256(tampered)).not.toBe(snapshotManifestSha256(a));
  });

  it("changes when the validity window changes", () => {
    const a = publish();
    expect(snapshotManifestSha256({ ...a, expiresAt: new Date("2030-01-01T00:00:00Z") })).not.toBe(
      snapshotManifestSha256(a),
    );
  });
});

describe("the 21-field grant contract is recorded, not guessed", () => {
  it("carries its [REQUIRED: ...] marker rather than an invented field list", () => {
    expect(GRANT_PROJECTION_FIELD_CONTRACT).toMatch(/^\[REQUIRED: /);
    expect(GRANT_PROJECTION_FIELD_CONTRACT).toContain("21-field");
    expect(GRANT_PROJECTION_FIELD_CONTRACT).toContain("KLREQ-025");
  });

  it("treats anything but an explicit allow as a refusal", () => {
    expect(isPermitted("allow")).toBe(true);
    expect(isPermitted("deny")).toBe(false);
    expect(isPermitted("unknown")).toBe(false);
  });
});

describe.skipIf(!available)("WS-10-T008 verification, activation and rollback", () => {
  let p: pg.Pool;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  it("refuses to activate a snapshot that has not been verified", async () => {
    const snapshot = publish();
    await withHubTransaction(p, (client) => recordDownloadedSnapshot(client, snapshot));
    await expect(
      withHubTransaction(p, (client) =>
        activateSnapshot(client, {
          activationId: uuidv7(),
          snapshotId: snapshot.snapshotId,
          actorType: "service",
        }),
      ),
    ).rejects.toThrow(/SNAPSHOT-NOT-VERIFIED/);
  });

  it("rejects a snapshot whose signature does not verify, and keeps it rejected", async () => {
    const snapshot = publish();
    const forged: PublishedSnapshot = {
      ...snapshot,
      signature: Buffer.from("00".repeat(32), "hex"),
    };
    await withHubTransaction(p, (client) => recordDownloadedSnapshot(client, forged));

    // The verdict is RETURNED, so the rejection commits with the caller's
    // transaction instead of being rolled back with a thrown error.
    const verdict = await withHubTransaction(p, (client) => verifySnapshot(client, forged, signer));
    expect(verdict.verified).toBe(false);
    expect(verdict.reason).toMatch(/did not verify/);

    // The throwing variant is available for callers that treat it as fatal…
    await expect(
      withHubTransaction(p, (client) => verifySnapshotOrThrow(client, forged, signer)),
    ).rejects.toThrow(SyncDeliveryError);

    const row = await p.query<{ state: string }>(
      `select state::text from edge_config.configuration_snapshot where id = $1`,
      [forged.snapshotId],
    );
    expect(row.rows[0]!.state).toBe("rejected");

    await expect(
      withHubTransaction(p, (client) =>
        activateSnapshot(client, {
          activationId: uuidv7(),
          snapshotId: forged.snapshotId,
          actorType: "service",
        }),
      ),
    ).rejects.toThrow(/SNAPSHOT-NOT-VERIFIED/);
  });

  it("refuses a manifest that does not match what was stored", async () => {
    const snapshot = publish();
    await withHubTransaction(p, (client) => recordDownloadedSnapshot(client, snapshot));
    // Same signature, but the sections shipped are not the ones declared: the
    // signature would authenticate a DIFFERENT configuration than the stored one.
    await expect(
      p.query(`select edge_config.mark_snapshot_verified($1::uuid, $2::char(64))`, [
        snapshot.snapshotId,
        "f".repeat(64),
      ]),
    ).rejects.toThrow(/MANIFEST-MISMATCH/);
  });

  it("activates atomically: one active snapshot, both ids recorded", async () => {
    const first = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, first);
      await verifySnapshotOrThrow(client, first, signer);
    });
    const firstActivation = uuidv7();
    await withHubTransaction(p, (client) =>
      activateSnapshot(client, {
        activationId: firstActivation,
        snapshotId: first.snapshotId,
        actorType: "service",
      }),
    );

    const second = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, second);
      await verifySnapshotOrThrow(client, second, signer);
    });
    const secondActivation = uuidv7();
    const result = await withHubTransaction(p, (client) =>
      activateSnapshot(client, {
        activationId: secondActivation,
        snapshotId: second.snapshotId,
        actorType: "service",
      }),
    );

    expect(result.previousSnapshotId).toBe(first.snapshotId);
    // Exactly one active snapshot for the Location (§6.2).
    const active = await p.query<{ n: string }>(
      `select count(*)::text as n from edge_config.configuration_snapshot
        where location_id = $1 and state = 'active'`,
      [CONFIG_LOCATION],
    );
    expect(Number(active.rows[0]!.n)).toBe(1);
    const view = await withHubTransaction(p, (client) => activeSnapshot(client, CONFIG_LOCATION));
    expect(view?.snapshotId).toBe(second.snapshotId);

    // Rollback reads the RECORDED previous snapshot rather than guessing.
    const restored = await withHubTransaction(p, (client) =>
      rollbackSnapshot(client, {
        activationId: uuidv7(),
        fromActivationId: secondActivation,
        reason: "health check failed after activation",
        actorType: "service",
      }),
    );
    expect(restored).toBe(first.snapshotId);
    const afterRollback = await withHubTransaction(p, (client) =>
      activeSnapshot(client, CONFIG_LOCATION),
    );
    expect(afterRollback?.snapshotId).toBe(first.snapshotId);
    const rolled = await p.query<{ state: string }>(
      `select state::text from edge_config.configuration_snapshot where id = $1`,
      [second.snapshotId],
    );
    expect(rolled.rows[0]!.state).toBe("rolled_back");
  });

  it("refuses a rollback with no reason, and one with no recorded target", async () => {
    const only = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, only);
      await verifySnapshotOrThrow(client, only, signer);
    });
    const activationId = uuidv7();
    // Stand down whatever is active so this activation has a previous id, then
    // build a case with genuinely none.
    const noPrevious = await p.query<{ id: string }>(
      `insert into edge_config.configuration_activation
         (id, tenant_id, digital_store_id, location_id, snapshot_id, previous_snapshot_id,
          started_at, completed_at, result, actor_type)
       values (gen_random_uuid(), $1, $2, $3, $4, null, now(), now(), 'activated', 'service')
       returning id`,
      [TENANT, STORE, CONFIG_LOCATION, only.snapshotId],
    );

    await expect(
      withHubTransaction(p, (client) =>
        rollbackSnapshot(client, {
          activationId,
          fromActivationId: noPrevious.rows[0]!.id,
          reason: "  ",
          actorType: "service",
        }),
      ),
    ).rejects.toThrow(/ROLLBACK-REASON-REQUIRED/);

    await expect(
      withHubTransaction(p, (client) =>
        rollbackSnapshot(client, {
          activationId,
          fromActivationId: noPrevious.rows[0]!.id,
          reason: "nothing to go back to",
          actorType: "service",
        }),
      ),
    ).rejects.toThrow(/ROLLBACK-NO-TARGET/);
  });
});

describe.skipIf(!available)("WS-10-T007 signed grant projection (KLREQ-025)", () => {
  let p: pg.Pool;
  let snapshotId = "";

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    const snapshot = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, snapshot);
      await verifySnapshotOrThrow(client, snapshot, signer);
    });
    snapshotId = snapshot.snapshotId;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  function grant(overrides: Partial<PublishedGrant> = {}): PublishedGrant {
    return {
      id: uuidv7(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: CONFIG_LOCATION,
      sourceSnapshotId: snapshotId,
      projectionVersion: 1n,
      actorId: uuidv7(),
      permissionKey: "payments.refund.request",
      effect: "allow",
      resourceType: "payment",
      scopeType: "store_location",
      scopeId: CONFIG_LOCATION,
      environment: "all",
      requiresReauthentication: false,
      requiresApproval: true,
      requiresReason: true,
      grantedAt: new Date(),
      notBefore: new Date(Date.now() - 60_000),
      expiresAt: null,
      offlineValiditySeconds: null,
      offlinePolicyReference: null,
      signature: Buffer.from("beef", "hex"),
      signatureAlgorithm: "hmac-sha256-development",
      signingKeyId: "cloud-config-key-1",
      ...overrides,
    };
  }

  const query = (g: PublishedGrant, online: boolean) => ({
    tenantId: g.tenantId,
    digitalStoreId: g.digitalStoreId,
    locationId: g.locationId,
    actorId: g.actorId,
    permissionKey: g.permissionKey,
    scopeType: g.scopeType,
    scopeId: g.scopeId,
    online,
  });

  it("permits an allow while online and fails closed for an unknown actor", async () => {
    const g = grant();
    await withHubTransaction(p, (client) => projectGrant(client, g));
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(g, true)))).toBe(
      "allow",
    );
    // Nobody granted anything to this actor.
    expect(
      await withHubTransaction(p, (client) =>
        resolveGrant(client, { ...query(g, true), actorId: uuidv7() }),
      ),
    ).toBe("unknown");
  });

  it("lets DENY override ALLOW", async () => {
    const actorId = uuidv7();
    const allow = grant({ actorId, effect: "allow", projectionVersion: 1n });
    const deny = grant({ actorId, effect: "deny", projectionVersion: 2n });
    await withHubTransaction(p, async (client) => {
      await projectGrant(client, allow);
      await projectGrant(client, deny);
    });
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(allow, true)))).toBe(
      "deny",
    );
  });

  it("fails closed on an expired grant", async () => {
    const g = grant({
      notBefore: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await withHubTransaction(p, (client) => projectGrant(client, g));
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(g, true)))).toBe(
      "unknown",
    );
  });

  it("invents NO offline grace period: without a signed policy, offline denies", async () => {
    const g = grant({ offlineValiditySeconds: null, offlinePolicyReference: null });
    await withHubTransaction(p, (client) => projectGrant(client, g));
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(g, true)))).toBe(
      "allow",
    );
    // Same grant, offline: no approved duration exists, so there is none.
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(g, false)))).toBe(
      "unknown",
    );
  });

  it("honours an offline validity that a signed policy DID grant, and its expiry", async () => {
    const live = grant({
      offlineValiditySeconds: 3600,
      offlinePolicyReference: "KLPOL-OFFLINE-DEV",
      grantedAt: new Date(),
    });
    await withHubTransaction(p, (client) => projectGrant(client, live));
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(live, false)))).toBe(
      "allow",
    );

    const stale = grant({
      offlineValiditySeconds: 60,
      offlinePolicyReference: "KLPOL-OFFLINE-DEV",
      grantedAt: new Date(Date.now() - 3600_000),
      notBefore: new Date(Date.now() - 3600_000),
    });
    await withHubTransaction(p, (client) => projectGrant(client, stale));
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(stale, false)))).toBe(
      "unknown",
    );
    // Still usable ONLINE — the offline window expiring is not a revocation.
    expect(await withHubTransaction(p, (client) => resolveGrant(client, query(stale, true)))).toBe(
      "allow",
    );
  });

  it("refuses an offline duration that names no approved policy", async () => {
    await expect(
      withHubTransaction(p, (client) =>
        projectGrant(client, grant({ offlineValiditySeconds: 900, offlinePolicyReference: null })),
      ),
    ).rejects.toThrow(/invented grace period/);
  });

  it("never lets the Hub author, broaden or edit a grant", async () => {
    const g = grant();
    await withHubTransaction(p, (client) => projectGrant(client, g));
    await expect(
      p.query(`update edge_config.permission_grant_projection set effect = 'allow' where id = $1`, [
        g.id,
      ]),
    ).rejects.toThrow(/GRANT-IMMUTABLE/);
    await expect(
      p.query(`delete from edge_config.permission_grant_projection where id = $1`, [g.id]),
    ).rejects.toThrow(/GRANT-IMMUTABLE/);
  });
});

/**
 * Regression tests for independent review finding RV-002.
 *
 * The 0022 resolver compared only the EXACT `(scope_type, scope_id)` tuple, so
 * a `deny` recorded at Digital Store scope was invisible when resolving at
 * Location scope — and the reviewer got `allow` out of a broad deny plus a
 * narrow allow. Migration 0024 walks the whole scope chain.
 */
describe.skipIf(!available)("RV-002 regression — deny wins across the scope chain", () => {
  let p: pg.Pool;
  let snapshotId = "";

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    const snapshot = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, snapshot);
      await verifySnapshotOrThrow(client, snapshot, signer);
    });
    snapshotId = snapshot.snapshotId;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  function scoped(
    actorId: string,
    effect: "allow" | "deny",
    scopeType: string,
    scopeId: string | null,
    version: bigint,
  ): PublishedGrant {
    return {
      id: uuidv7(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: CONFIG_LOCATION,
      sourceSnapshotId: snapshotId,
      projectionVersion: version,
      actorId,
      permissionKey: "payments.refund.request",
      effect,
      resourceType: "payment",
      scopeType,
      scopeId,
      environment: "all",
      requiresReauthentication: false,
      requiresApproval: true,
      requiresReason: true,
      grantedAt: new Date(),
      notBefore: new Date(Date.now() - 60_000),
      expiresAt: null,
      offlineValiditySeconds: null,
      offlinePolicyReference: null,
      signature: Buffer.from("beef", "hex"),
      signatureAlgorithm: "hmac-sha256-development",
      signingKeyId: "cloud-config-key-1",
    };
  }

  const ask = (actorId: string) => ({
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: CONFIG_LOCATION,
    actorId,
    permissionKey: "payments.refund.request",
    scopeType: "store_location",
    scopeId: CONFIG_LOCATION,
    online: true,
  });

  it("a narrow ALLOW cannot defeat a broad DENY", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, async (client) => {
      await projectGrant(client, scoped(actorId, "deny", "digital_store", STORE, 1n));
      await projectGrant(client, scoped(actorId, "allow", "store_location", CONFIG_LOCATION, 2n));
    });
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "deny",
    );
  });

  it("holds for a DENY at tenant scope and at platform scope", async () => {
    for (const [scopeType, scopeId] of [
      ["tenant", TENANT],
      ["platform", null],
    ] as ReadonlyArray<[string, string | null]>) {
      const actorId = uuidv7();
      await withHubTransaction(p, async (client) => {
        await projectGrant(client, scoped(actorId, "deny", scopeType, scopeId, 1n));
        await projectGrant(client, scoped(actorId, "allow", "store_location", CONFIG_LOCATION, 2n));
      });
      expect(
        await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId))),
        scopeType,
      ).toBe("deny");
    }
  });

  it("lets a BROADER allow cover a narrower request", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(client, scoped(actorId, "allow", "tenant", TENANT, 1n)),
    );
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "allow",
    );
  });

  it("still fails closed offline without an approved signed policy", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(client, scoped(actorId, "allow", "tenant", TENANT, 1n)),
    );
    expect(
      await withHubTransaction(p, (client) =>
        resolveGrant(client, { ...ask(actorId), online: false }),
      ),
    ).toBe("unknown");
  });

  it("does not leak a grant across Digital Stores", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(client, scoped(actorId, "allow", "digital_store", uuidv7(), 1n)),
    );
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "unknown",
    );
  });
});

/**
 * Regression tests for review findings RV-013 and RV-014 (re-verification pass).
 *
 * The reviewer classed both as non-blocking because the resolver has no
 * production caller. They are covered anyway: both were fail-open defects in an
 * AUTHORIZATION path, and "no caller yet" describes today, not the cycle that
 * adds one.
 */
describe.skipIf(!available)("RV-013 / RV-014 regression — scope isolation", () => {
  let p: pg.Pool;
  let snapshotId = "";
  let foreignSnapshotId = "";

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    const own = publish();
    await withHubTransaction(p, async (client) => {
      await recordDownloadedSnapshot(client, own);
      await verifySnapshotOrThrow(client, own, signer);
    });
    snapshotId = own.snapshotId;

    // A snapshot belonging to the ATTACKER tenant persona.
    const foreign = publish({
      tenantId: ATTACKER_TENANT,
      digitalStoreId: ATTACKER_STORE,
    });
    await withHubTransaction(p, (client) => recordDownloadedSnapshot(client, foreign));
    foreignSnapshotId = foreign.snapshotId;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  const ask = (actorId: string) => ({
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: CONFIG_LOCATION,
    actorId,
    permissionKey: "payments.refund.request",
    scopeType: "store_location",
    scopeId: CONFIG_LOCATION,
    online: true,
  });

  function grantRow(
    overrides: Partial<PublishedGrant> & Pick<PublishedGrant, "actorId" | "effect">,
  ): PublishedGrant {
    return {
      id: uuidv7(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: CONFIG_LOCATION,
      sourceSnapshotId: snapshotId,
      projectionVersion: 1n,
      permissionKey: "payments.refund.request",
      resourceType: "payment",
      scopeType: "store_location",
      scopeId: CONFIG_LOCATION,
      environment: "all",
      requiresReauthentication: false,
      requiresApproval: true,
      requiresReason: true,
      grantedAt: new Date(),
      notBefore: new Date(Date.now() - 60_000),
      expiresAt: null,
      offlineValiditySeconds: null,
      offlinePolicyReference: null,
      signature: Buffer.from("beef", "hex"),
      signatureAlgorithm: "hmac-sha256-development",
      signingKeyId: "cloud-config-key-1",
      ...overrides,
    };
  }

  it("RV-013: a platform-scoped ALLOW from ANOTHER TENANT permits nothing here", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(
        client,
        grantRow({
          actorId,
          effect: "allow",
          tenantId: ATTACKER_TENANT,
          digitalStoreId: ATTACKER_STORE,
          sourceSnapshotId: foreignSnapshotId,
          scopeType: "platform",
          scopeId: null,
        }),
      ),
    );
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "unknown",
    );
  });

  it("RV-013: a grant for another Digital Store in the same tenant permits nothing", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(
        client,
        grantRow({
          actorId,
          effect: "allow",
          digitalStoreId: ATTACKER_STORE,
          sourceSnapshotId: foreignSnapshotId,
        }),
      ),
    );
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "unknown",
    );
  });

  it("RV-014: a non-platform grant with a NULL scope_id cannot be stored at all", async () => {
    await expect(
      withHubTransaction(p, (client) =>
        projectGrant(
          client,
          grantRow({ actorId: uuidv7(), effect: "deny", scopeType: "tenant", scopeId: null }),
        ),
      ),
    ).rejects.toThrow(/permission_grant_projection_scope_id_ck/);
  });

  it("RV-014: a platform grant may still omit its scope_id", async () => {
    const actorId = uuidv7();
    await withHubTransaction(p, (client) =>
      projectGrant(
        client,
        grantRow({ actorId, effect: "allow", scopeType: "platform", scopeId: null }),
      ),
    );
    expect(await withHubTransaction(p, (client) => resolveGrant(client, ask(actorId)))).toBe(
      "allow",
    );
  });
});
