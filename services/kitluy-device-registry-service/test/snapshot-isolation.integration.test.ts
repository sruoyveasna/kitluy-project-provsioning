/**
 * SNAPSHOT ISOLATION — the owner-locked rule, proved against the real database.
 *
 * KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001: exactly one Tenant, Digital Store,
 * Location and environment per snapshot; never another scope's revocation data.
 *
 * The enforcement point is migration group 0156, not this producer, and that is
 * deliberate: the producer is the component whose bug would cause a leak, so it
 * cannot also be the component that prevents one. These tests therefore attack the
 * BRIDGES directly as the real caller (`kitluy_issuance_service`), and then check
 * the producer honours what they return.
 */
import { randomUUID } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canonicalSnapshotBytes,
  verifySnapshotSignature,
  type TrustedSnapshotKey,
} from "@kitluy/device-identity";

import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import { createEd25519SnapshotSigner } from "../src/snapshot-signer.js";
import { createSnapshotProducer, UnprovisionedHubError } from "../src/signed-snapshot-producer.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const ENVIRONMENT = "development";
const KEY_ENV_VAR = "TEST_EPHEMERAL_SNAPSHOT_KEY";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: LOCAL_DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const live = await reachable();
if (!live) console.warn("SKIPPED: snapshot isolation suite — local database unreachable");

interface Scope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
}

describe.skipIf(!live)("a snapshot never carries another scope's revocations", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  /** Distinct ACTIVE assignment scopes that actually exist, read from the database. */
  let scopes: Scope[] = [];

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    const { rows } = await keeper.query<Scope>(
      `select distinct tenant_id::text as "tenantId",
                       digital_store_id::text as "digitalStoreId",
                       store_location_id::text as "storeLocationId"
         from kitluy_devices.device_assignments
        where state in ('pending_trust','active')
        order by 1, 2, 3`,
    );
    scopes = rows;
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  const serialsFor = (scope: Scope, environment = ENVIRONMENT) =>
    withServiceRole(runtime.pool, REGISTRY_ROLES.issuance, async (client) => {
      const { rows } = await client.query<{ serial: string }>(
        `select s as serial from kitluy_devices.revoked_serials_for_scope_v1(
           $1::uuid, $2::uuid, $3::uuid, $4::text) as s`,
        [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, environment],
      );
      return rows.map((r) => r.serial);
    });

  it("has at least one real scope to reason about", () => {
    expect(scopes.length).toBeGreaterThan(0);
  });

  it("returns the revoked identifiers RELEVANT to a scope", async () => {
    // Find a scope that actually has revoked credentials, so "included" is a real
    // assertion rather than a vacuous one.
    let found = false;
    for (const scope of scopes) {
      const serials = await serialsFor(scope);
      if (serials.length > 0) {
        found = true;
        // Every serial returned must belong to a device assigned to THIS scope.
        const { rows } = await keeper.query<{ n: string }>(
          `select count(*)::text as n
             from kitluy_devices.device_credentials c
             join kitluy_devices.device_assignments a
               on a.device_id = c.device_record_id and a.state in ('pending_trust','active')
            where c.serial_number = any($1::text[])
              and (a.tenant_id <> $2::uuid or a.digital_store_id <> $3::uuid
                   or a.store_location_id <> $4::uuid)`,
          [serials, scope.tenantId, scope.digitalStoreId, scope.storeLocationId],
        );
        expect(rows[0]?.n, "a serial from outside the scope was included").toBe("0");
        break;
      }
    }
    expect(found, "no scope in this database has revoked credentials to test with").toBe(true);
  });

  it("EXCLUDES a different TENANT's revocations", async () => {
    const byTenant = new Map<string, Scope>();
    for (const s of scopes) if (!byTenant.has(s.tenantId)) byTenant.set(s.tenantId, s);
    const tenants = [...byTenant.values()];
    if (tenants.length < 2) return; // nothing to compare in this dataset
    const [a, b] = tenants as [Scope, Scope];
    const inA = new Set(await serialsFor(a));
    for (const serial of await serialsFor(b)) {
      expect(inA.has(serial), `serial ${serial} leaked across tenants`).toBe(false);
    }
  });

  it("EXCLUDES a different STORE and a different LOCATION", async () => {
    if (scopes.length < 2) return;
    const [a, b] = scopes as [Scope, Scope];

    // Same tenant/location, foreign store.
    const foreignStore = { ...a, digitalStoreId: b.digitalStoreId };
    if (foreignStore.digitalStoreId !== a.digitalStoreId) {
      const inA = new Set(await serialsFor(a));
      for (const serial of await serialsFor(foreignStore)) {
        expect(inA.has(serial), "serial leaked across stores").toBe(false);
      }
    }

    // Same tenant/store, foreign location.
    const foreignLocation = { ...a, storeLocationId: b.storeLocationId };
    if (foreignLocation.storeLocationId !== a.storeLocationId) {
      const inA = new Set(await serialsFor(a));
      for (const serial of await serialsFor(foreignLocation)) {
        expect(inA.has(serial), "serial leaked across locations").toBe(false);
      }
    }
  });

  it("EXCLUDES another ENVIRONMENT", async () => {
    const scope = scopes[0] as Scope;
    const development = await serialsFor(scope, ENVIRONMENT);
    const production = await serialsFor(scope, "production");
    for (const serial of production) {
      expect(development.includes(serial), "serial crossed environments").toBe(false);
    }
  });

  it("returns an EMPTY set for a valid scope with nothing revoked", async () => {
    // A scope that exists nowhere is the cleanest empty case, and the important
    // one: it must be empty rather than everything.
    const empty = await serialsFor({
      tenantId: "00000000-0000-4000-8000-00000000e001",
      digitalStoreId: "00000000-0000-4000-8000-00000000e002",
      storeLocationId: "00000000-0000-4000-8000-00000000e003",
    });
    expect(empty).toEqual([]);
  });

  it("REFUSES a malformed scope by returning nothing, never everything", async () => {
    const total = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_credentials
        where state = 'revoked' or revoked_at is not null`,
    );
    expect(Number(total.rows[0]?.n)).toBeGreaterThan(0);

    const nulls = await withServiceRole(runtime.pool, REGISTRY_ROLES.issuance, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.revoked_serials_for_scope_v1(
           null, null, null, $1::text)`,
        [ENVIRONMENT],
      );
      return rows[0]?.n;
    });
    // The load-bearing assertion of this whole file.
    expect(nulls).toBe("0");

    const blankEnv = await serialsFor(scopes[0] as Scope, "   ");
    expect(blankEnv).toEqual([]);
  });

  it("REFUSES to produce a snapshot for an UNPROVISIONED Hub", async () => {
    const keys = generateKeyPairSync("ed25519");
    const producer = createSnapshotProducer(
      runtime.pool,
      createEd25519SnapshotSigner({
        env: { [KEY_ENV_VAR]: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
      }),
    );
    await expect(
      producer.produceSignedSnapshot({
        hubDeviceRecordId: randomUUID(),
        environment: ENVIRONMENT,
        snapshotVersion: 1,
        sequence: 1,
        generatedAt: new Date(),
        effectiveAt: new Date(),
        keyReference: { secretEnvVar: KEY_ENV_VAR, keyId: "k", keyVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(UnprovisionedHubError);
  });

  /**
   * PREVIOUSLY SKIPPED ON A MISDIAGNOSIS, now passing. Recorded because the wrong
   * conclusion was published.
   *
   * This test was skipped with a claim that `emergency_device_tenancy_v1` and
   * `hub_revocation_scope_v1` were broken because their SECURITY DEFINER owner
   * lacked assignment access. Both halves of that were wrong:
   *
   *   * the reproduction used `emergency_device_tenancy_v1((select device_id from
   *     device_assignments limit 1))`. A function ARGUMENT is evaluated in the
   *     CALLER's context, so the `42501` came from the subselect in the diagnostic
   *     itself and never reached the definer body;
   *   * `emergency_device_tenancy_v1` does fail for `kitluy_issuance_service`, but
   *     with "permission denied for FUNCTION", and that is CORRECT. It is granted
   *     to `kitluy_credential_issuer`, which is the owner of the governed emergency
   *     RPC and therefore the effective role when the bridge is actually called.
   *     Issuance is not supposed to reach it.
   *
   * `hub_revocation_scope_v1` was working the whole time. The only real defect was
   * a missing EXECUTE for `kitluy_credential_issuer` on
   * `retired_devices_in_scope_v1` — inside a definer the caller is the OWNER, not
   * the session role — and that was fixed in the same commit that shipped it.
   */
  it("PRODUCES a signed snapshot whose scope is derived, not supplied", async () => {
    const { rows } = await keeper.query<{ device_id: string }>(
      `select device_id::text as device_id from kitluy_devices.device_assignments
        where state in ('pending_trust','active') limit 1`,
    );
    const hub = rows[0]?.device_id;
    expect(hub).toBeDefined();
    if (hub === undefined) return;

    const pair = generateKeyPairSync("ed25519");
    const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const producer = createSnapshotProducer(
      runtime.pool,
      createEd25519SnapshotSigner({ env: { [KEY_ENV_VAR]: privateKeyPem } }),
    );

    const snapshot = await producer.produceSignedSnapshot({
      hubDeviceRecordId: hub,
      environment: ENVIRONMENT,
      snapshotVersion: 3,
      sequence: 9,
      generatedAt: new Date("2026-07-31T00:00:00.000Z"),
      effectiveAt: new Date("2026-07-31T00:00:00.000Z"),
      keyReference: { secretEnvVar: KEY_ENV_VAR, keyId: "iso-key", keyVersion: 2 },
    });

    // The scope came from the Hub's ACTIVE assignment. No caller supplied it.
    const expected = await keeper.query<Scope>(
      `select tenant_id::text as "tenantId", digital_store_id::text as "digitalStoreId",
              store_location_id::text as "storeLocationId"
         from kitluy_devices.device_assignments
        where device_id = $1::uuid and state in ('pending_trust','active')
        order by assignment_generation desc limit 1`,
      [hub],
    );
    expect(snapshot.scope.tenantId).toBe(expected.rows[0]?.tenantId);
    expect(snapshot.scope.digitalStoreId).toBe(expected.rows[0]?.digitalStoreId);
    expect(snapshot.scope.storeLocationId).toBe(expected.rows[0]?.storeLocationId);
    expect(snapshot.hubDeviceRecordId).toBe(hub);

    // Every required binding is present.
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.snapshotVersion).toBe(3);
    expect(snapshot.sequence).toBe(9);
    expect(snapshot.revocationWatermark).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.signature.algorithm).toBe("ed25519");
    expect(snapshot.signature.keyId).toBe("iso-key");
    expect(snapshot.signature.keyVersion).toBe(2);

    // And it VERIFIES.
    const trusted: TrustedSnapshotKey[] = [
      { keyId: "iso-key", keyVersion: 2, publicKeyPem, state: "current" },
    ];
    expect(verifySnapshotSignature(snapshot, snapshot.signature, trusted).verified).toBe(true);

    // Relabelling it for another Store breaks the signature.
    const relabelled = {
      ...snapshot,
      scope: { ...snapshot.scope, digitalStoreId: "00000000-0000-4000-8000-0000000ff002" },
    };
    expect(verifySnapshotSignature(relabelled, snapshot.signature, trusted).verified).toBe(false);
    expect(Buffer.from(canonicalSnapshotBytes(relabelled))).not.toEqual(
      Buffer.from(canonicalSnapshotBytes(snapshot)),
    );

    // The payload contains ONLY this scope's serials.
    const mine = new Set(await serialsFor(snapshot.scope));
    for (const serial of snapshot.revokedCertificateSerials) {
      expect(mine.has(serial), `snapshot carried out-of-scope serial ${serial}`).toBe(true);
    }
  });
});
