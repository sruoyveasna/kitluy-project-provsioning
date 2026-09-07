/**
 * The credential path's negative-privilege proof, WITHOUT crashing PostgreSQL.
 *
 * Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
 * findings R2-2 and R2-4; owner remediation instruction 2026-08-27. Covers the
 * boundaries established by groups 0206 (C-4/D-07) and 0207 (C-5).
 *
 * ===========================================================================
 * WHY THIS ASKS THE CATALOG INSTEAD OF CALLING THE DOOR
 * ===========================================================================
 * The obvious way to prove `service_role` cannot reach a governed door is to
 * call it as `service_role` and assert 42501. On this platform that CRASHES THE
 * BACKEND: supautils' permission-hint path SIGSEGVs on a denied function call in
 * `kitluy_devices` made by a role listed in `supautils.hint_roles`. The reviewer
 * counted 33 restarts, and every concurrent suite then failed with "the database
 * system is in recovery mode" — failures that look like product bugs.
 *
 * `scripts/database/apply-dev-supautils-hint-workaround.mjs` removes
 * `service_role` from that list for local development, which stops the crash.
 * But a security proof must not DEPEND on a workaround being present, and it
 * must certainly not depend on a platform crash as its evidence.
 *
 * So the assertions here ask the catalog. `has_function_privilege` resolves
 * inheritance — the exact blindness that let C-4 survive months of
 * `information_schema.role_table_grants` assertions — and it answers the real
 * question, "can this identity execute?", without executing anything.
 *
 * The one place a real call is still made is the `devices` UPDATE in C-5, which
 * is a TABLE privilege and does not go through the crashing path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

let pool: pg.Pool;

// R2-4: a FORMAL SECURITY SUITE. It fails rather than skips.
await requireSecurityFixture({ dsn: DSN, needsPki: false });

/** Every door on the credential path, with its exact identity signature. */
const DOORS: ReadonlyArray<{ name: string; signature: string; owner: string }> = [
  {
    name: "record_operational_certificate_v1",
    signature: "kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)",
    owner: "kitluy_issuance_service",
  },
  {
    name: "attempt_activate_device_v1",
    signature: "kitluy_devices.attempt_activate_device_v1(uuid,text,text)",
    owner: "kitluy_activation_service",
  },
  {
    name: "issue_development_device_certificate_v1",
    signature: "kitluy_devices.issue_development_device_certificate_v1(uuid,text,text)",
    owner: "kitluy_device_certificate_issuer",
  },
  {
    name: "register_generation_key_v1",
    signature: "kitluy_devices.register_generation_key_v1(uuid,text,text,integer,text,text,text)",
    owner: "kitluy_issuance_service",
  },
  {
    name: "abandon_generation_key_v1",
    signature: "kitluy_devices.abandon_generation_key_v1(uuid,text,text,integer,text)",
    owner: "kitluy_issuance_service",
  },
  {
    name: "prepare_device_credential_issuance_v1",
    signature:
      "kitluy_devices.prepare_device_credential_issuance_v1(text,uuid,text,text,integer,text,text,text,text,text,text,bytea,boolean,text,timestamptz,text,text)",
    owner: "kitluy_issuance_service",
  },
];

const CLIENT_ROLES = ["service_role", "anon", "authenticated"] as const;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 4 });
});
afterAll(async () => {
  await pool?.end().catch(() => undefined);
});

describe("C-4/D-07: the connection identity must ENTER a role", () => {
  it("no client-facing role holds EFFECTIVE execute on any credential-path door", async () => {
    for (const door of DOORS) {
      for (const role of CLIENT_ROLES) {
        const { rows } = await pool.query<{ allowed: boolean }>(
          `select has_function_privilege($1::text, $2::text, 'execute') as allowed`,
          [role, door.signature],
        );
        // `has_function_privilege` follows role membership, so this is the
        // EFFECTIVE answer and not merely "was a grant written here".
        expect(rows[0]!.allowed, `${role} can execute ${door.name}`).toBe(false);
      }
    }
  });

  it("each governed identity still holds its OWN door, so nothing was broken to achieve that", async () => {
    for (const door of DOORS) {
      const { rows } = await pool.query<{ allowed: boolean }>(
        `select has_function_privilege($1::text, $2::text, 'execute') as allowed`,
        [door.owner, door.signature],
      );
      expect(rows[0]!.allowed, `${door.owner} lost ${door.name}`).toBe(true);
    }
  });

  it("service_role can still ENTER the governed roles, or the product stops working", async () => {
    for (const role of ["kitluy_issuance_service", "kitluy_activation_service"]) {
      const { rows } = await pool.query<{ member: boolean }>(
        `select pg_has_role('service_role', $1::text, 'member') as member`,
        [role],
      );
      // Membership stays transitive through a NOINHERIT hinge for SET ROLE even
      // though privileges do not flow. That distinction IS the fix.
      expect(rows[0]!.member, `service_role cannot enter ${role}`).toBe(true);
    }
  });

  it("the hinges keep the posture the whole boundary rests on", async () => {
    const { rows } = await pool.query<{ rolname: string; ok: boolean }>(
      `select rolname,
              (not rolcanlogin and not rolinherit and not rolsuper
               and not rolcreaterole and not rolcreatedb and not rolbypassrls) as ok
         from pg_roles
        where rolname in ('kitluy_issuance_gateway','kitluy_activation_gateway','kitluy_certificate_gateway')
        order by rolname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // NOINHERIT is the entire mechanism; asserting it is not a tautology.
      expect(row.ok, `${row.rolname} lost its NOLOGIN/NOINHERIT posture`).toBe(true);
    }
  });
});

describe("C-5: activation cannot be reached by a bare UPDATE", () => {
  it("service_role holds SELECT and nothing else on devices", async () => {
    const { rows } = await pool.query<{ privileges: string }>(
      `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)') as privileges
         from information_schema.role_table_grants
        where grantee = 'service_role' and table_schema = 'kitluy_devices' and table_name = 'devices'`,
    );
    expect(rows[0]!.privileges).toBe("SELECT");
  });

  it("the transition guard refuses a move into active from anyone but the activation authority", async () => {
    // A TABLE privilege check, so this real call does NOT go through supautils'
    // crashing function-permission path. Run as the connecting identity, which
    // holds UPDATE on devices and is not the activation governor.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: target } = await client.query<{ id: string }>(
        `select id from kitluy_devices.devices where lifecycle_state = 'awaiting_trust' limit 1`,
      );
      if (target[0] === undefined) {
        throw new Error(
          "no awaiting_trust device to probe; this assertion needs one and must not be skipped",
        );
      }
      await expect(
        client.query(`update kitluy_devices.devices set lifecycle_state='active' where id=$1::uuid`, [
          target[0].id,
        ]),
      ).rejects.toThrow(/KLUY-DEVICE-ACTIVATION-AUTHORITY/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});

describe("R2-2: the platform crash is neutralised, and nothing depends on it", () => {
  it("supautils.hint_roles is empty, so the crashing hint path is unreachable", async () => {
    // `current_setting`, not `SHOW`: SHOW returns a column literally named
    // "supautils.hint_roles", which no property access reaches.
    const { rows } = await pool.query<{ hint_roles: string }>(
      `select current_setting('supautils.hint_roles') as hint_roles`,
    );
    // The crashing path. A DEVELOPMENT platform remediation applied by
    // scripts/database/apply-dev-supautils-hint-workaround.mjs; it changes the
    // text of an error message and nothing else.
    //
    // EMPTY, not merely trimmed of `service_role`. Removing that one role still
    // left two SIGSEGVs per full registry run, following denials raised under
    // `anon` and `authenticated` — the bug is in the hint path, not in one role.
    expect(rows[0]!.hint_roles.trim()).toBe("");
  });

  it("supautils.reserved_roles STILL protects service_role", async () => {
    const { rows } = await pool.query<{ reserved_roles: string }>(
      `select current_setting('supautils.reserved_roles') as reserved_roles`,
    );
    // The setting that carries the real security property is a different one and
    // must be untouched. If this ever fails, the workaround changed something it
    // had no business changing.
    expect(rows[0]!.reserved_roles).toContain("service_role");
  });

  it("a denied call as service_role does not restart the cluster", async () => {
    const start = async (): Promise<string> => {
      const { rows } = await pool.query<{ t: Date }>(`select pg_postmaster_start_time() as t`);
      return rows[0]!.t.toISOString();
    };
    const before = await start();

    // Twenty-five denied calls. Before the workaround, ONE was enough to take
    // the cluster down; this is the regression test for the platform fix, and it
    // asserts survival rather than using the crash as evidence of anything.
    let denied = 0;
    for (let i = 0; i < 25; i += 1) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role service_role");
        try {
          await client.query(
            `select kitluy_devices.record_operational_certificate_v1(
                      gen_random_uuid(), 'x', 'y', 'rsa-2048', 'denial-probe')`,
          );
        } catch (error) {
          if ((error as { code?: string }).code === "42501") denied += 1;
        }
        await client.query("rollback");
      } finally {
        client.release();
      }
    }

    expect(denied, "the door stopped denying service_role").toBe(25);
    expect(await start(), "PostgreSQL restarted during the denial probe").toBe(before);
  });
});
