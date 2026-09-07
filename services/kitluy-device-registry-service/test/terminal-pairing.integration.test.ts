/**
 * Pi Terminal pairing, END TO END against the canonical database (group 0213).
 *
 * The route tests prove the transport with a stubbed composition. This proves
 * what a stub cannot: that a Partner-defined seat with a role set, an open
 * session, and an approved terminal typing the code compose into exactly one
 * `pending_trust` assignment with one terminal assignment per role, the seat
 * bound, the session consumed — and that every refusal the model promises
 * actually happens.
 *
 * Skips, rather than passing vacuously, when the stack is unreachable or
 * predates group 0213.
 */
import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { TerminalPairingComposition } from "../src/terminal-pairing-composition.js";

const DSN =
  process.env.KITLUY_TERMINAL_PAIRING_DSN ??
  "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const TERMINAL_PROFILE_KEY = "WS11-PT-TERMINAL-PROBE";
const ROLES = ["laundry.t1.intake_cashier", "laundry.t2.customer_display"];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RUN = randomUUID().slice(0, 8);

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

async function ready(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const { rows } = await probe.query<{ n: number }>(
      `select count(*)::int as n from pg_roles where rolname = 'kitluy_terminal_pairing_service'`,
    );
    await probe.end();
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    await probe.end().catch(() => undefined);
    return false;
  }
}
const live = await ready();

const pool = new pg.Pool({ connectionString: DSN, max: 4 });
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

function freshCode(): string {
  return Array.from(
    randomUUID().replace(/-/g, "").slice(0, 8),
    (c) => CROCKFORD[parseInt(c, 16) % CROCKFORD.length],
  ).join("");
}

function signals(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  return JSON.stringify([
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ]);
}

async function profileId(key: string, deviceClass: "store_hub" | "terminal"): Promise<string> {
  await pool.query(
    `insert into kitluy_devices.hardware_profiles
       (profile_key, display_name, device_class, manufacturer, model_identifier,
        required_signal_types, certification_status)
     values ($1, $2, $3, 'ASSERTION-FIXTURE', 'PROBE-PT',
             array['mac_address', 'board_serial', 'storage_serial']::kitluy_devices.hardware_signal_type[],
             'CERTIFIED')
     on conflict (profile_key) do nothing`,
    [key, `${key} fixture`, deviceClass],
  );
  const { rows } = await pool.query<{ id: string }>(
    `select id from kitluy_devices.hardware_profiles where profile_key = $1`,
    [key],
  );
  return rows[0]!.id;
}

async function enroll(assetTag: string, profile: string): Promise<string> {
  const { rows: found } = await pool.query<{ id: string }>(
    `select id from kitluy_devices.devices where asset_tag = $1`,
    [assetTag],
  );
  if (found[0] !== undefined) return found[0].id;
  const { rows } = await pool.query<{ id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text, $2::uuid, now() - interval '30 days', $3::text, 'ed25519', 'software',
       'STATION-TPAIR', 'OP-TPAIR', $4::jsonb, null) as id`,
    [assetTag, profile, sha256(assetTag), signals(assetTag)],
  );
  return rows[0]!.id;
}

/** Close whatever a previous run left on a fixture device so it is enrolled and free. */
async function release(deviceId: string): Promise<void> {
  await pool.query(
    `update kitluy_devices.device_terminal_assignments
        set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state <> 'revoked'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.device_claims set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state = 'issued'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.device_assignments set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state in ('pending_trust', 'active')`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.devices set lifecycle_state = 'enrolled'
      where id = $1::uuid and lifecycle_state in ('awaiting_trust', 'active')`,
    [deviceId],
  );
}

/**
 * An ACTIVE Store Hub at the fixture scope.
 *
 * "Active" for the session door means a `device_assignment_projections` row for
 * a `store_hub` at the scope — the fact activation writes (0121). Activation
 * itself (trusted time, certificate, `attempt_activate_device_v1`) is proven by
 * its own suites and needs a trusted-time floor this fixture has no business
 * establishing; the projection is written directly, the way
 * `provisioning-code-recovery.integration.test.ts` and assertion section 58 do.
 * Reused across runs.
 */
async function activeHub(): Promise<string> {
  const id = await enroll("TPAIR-HUB-01", await profileId(HUB_PROFILE_KEY, "store_hub"));
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from kitluy_devices.device_assignment_projections
      where device_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
    [id, STORE, LOCATION],
  );
  if ((rows[0]?.n ?? 0) > 0) return id;
  await release(id);
  const token = sha256(`tok-${RUN}`);
  const payload = sha256(`pay-${RUN}`);
  await pool.query(
    `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-TPAIR')`,
    [id, TENANT, STORE, LOCATION, token, payload],
  );
  const { rows: redeemed } = await pool.query<{ assignment_id: string }>(
    `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'HUB-TPAIR') as assignment_id`,
    [token, payload, id],
  );
  await pool.query(
    `insert into kitluy_devices.device_assignment_projections
       (device_id, assignment_id, assignment_generation, tenant_id, digital_store_id, store_location_id,
        terminal_profile_keys, environment)
     select $1::uuid, $2::uuid, d.assignment_generation, $3::uuid, $4::uuid, $5::uuid, '{}', 'development'
       from kitluy_devices.devices d where d.id = $1::uuid
     on conflict (device_id) do nothing`,
    [id, redeemed[0]!.assignment_id, TENANT, STORE, LOCATION],
  );
  return id;
}

/** An Admin-approved (enrolled) terminal with approval evidence for its enrollment. */
let terminalSlot = 0;
async function approvedTerminal(): Promise<string> {
  terminalSlot += 1;
  const id = await enroll(
    `TPAIR-TERM-${String(terminalSlot).padStart(2, "0")}`,
    await profileId(TERMINAL_PROFILE_KEY, "terminal"),
  );
  await release(id);
  await pool.query(
    `insert into kitluy_devices.device_lifecycle_events
       (device_id, from_state, to_state, reason_code, actor_ref, detail)
     select $1::uuid, 'manufactured', 'enrolled', 'HET_HARDWARE_VERIFIED_AND_APPROVED', 'OP-TPAIR',
            jsonb_build_object('environment', 'development', 'reason', 'fixture')
      where not exists (
        select 1 from kitluy_devices.device_lifecycle_events
         where device_id = $1::uuid and reason_code = 'HET_HARDWARE_VERIFIED_AND_APPROVED')`,
    [id],
  );
  return id;
}

async function seat(label: string, roles: readonly string[] = ROLES): Promise<string> {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    `select kitluy_devices.define_physical_terminal_v1($1::uuid, $2::uuid, $3, $4::text[], 'partner/tpair') as r`,
    [STORE, LOCATION, label, [...roles]],
  );
  const r = rows[0]!.r;
  if (r.outcome === "DEFINED") return String(r.physical_terminal_id);
  if (r.refusal_code === "KLUY-PHYSTERM-LABEL-TAKEN") {
    const { rows: found } = await pool.query<{ id: string }>(
      `select id from kitluy_devices.physical_terminals where digital_store_id = $1::uuid and lower(label) = lower($2)`,
      [STORE, label],
    );
    const id = found[0]!.id;
    // A previous run may have bound a device; free the seat the governed way.
    const { rows: bound } = await pool.query<{ bound_device_id: string | null }>(
      `select bound_device_id from kitluy_devices.physical_terminals where id = $1::uuid`,
      [id],
    );
    if (bound[0]?.bound_device_id) await release(bound[0].bound_device_id);
    await pool
      .query(
        `select kitluy_devices.set_physical_terminal_roles_v1($1::uuid, $2::text[], 'partner/tpair')`,
        [id, [...roles]],
      )
      .catch(() => undefined);
    return id;
  }
  throw new Error(`seat not defined: ${JSON.stringify(r)}`);
}

async function open(seatId: string, code: string, ttl = 900): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    `select kitluy_devices.open_terminal_pairing_session_v1($1::uuid, $2, $3::integer, 'partner/tpair') as r`,
    [seatId, sha256(code), ttl],
  );
  return rows[0]!.r;
}

const composition = new TerminalPairingComposition({ source: pool });

describe.skipIf(!live)("a Pi Terminal takes its seat with the code alone", () => {
  it("PAIRS: one pending_trust assignment, one terminal assignment per role, seat bound, session consumed", async () => {
    await activeHub();
    const device = await approvedTerminal();
    const seatId = await seat(`Front Counter ${RUN}-A`);
    const code = freshCode();
    const opened = await open(seatId, code);
    expect(opened.outcome).toBe("OPENED");

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code.toLowerCase(),
      actorRef: "device/tpair-suite",
    });
    expect(outcome.result).toBe("PAIRED");
    expect(outcome.data?.storeAssignment).toBe("pending_trust");
    expect(outcome.data?.activated).toBe(false);
    expect(outcome.data?.context.digitalStoreId).toBe(STORE);
    expect(outcome.data?.context.terminalProfileKeys).toEqual(ROLES);
    expect(outcome.data?.context.vertical).toBeTruthy();
    expect(outcome.data?.context.terminalAssignments).toHaveLength(2);

    const { rows: dev } = await pool.query<{ lifecycle_state: string }>(
      `select lifecycle_state::text as lifecycle_state from kitluy_devices.devices where id = $1::uuid`,
      [device],
    );
    expect(dev[0]?.lifecycle_state).toBe("awaiting_trust");
    const { rows: tas } = await pool.query<{ terminal_profile_key: string; state: string }>(
      `select terminal_profile_key, state::text as state from kitluy_devices.device_terminal_assignments
        where assignment_id = $1::uuid order by terminal_profile_key`,
      [outcome.data!.assignmentId],
    );
    expect(tas.map((t) => t.terminal_profile_key)).toEqual(ROLES);
    expect(tas.every((t) => t.state === "pending_trust")).toBe(true);
    const { rows: pt } = await pool.query<{ bound_device_id: string | null }>(
      `select bound_device_id from kitluy_devices.physical_terminals where id = $1::uuid`,
      [seatId],
    );
    expect(pt[0]?.bound_device_id).toBe(device);
    const { rows: s } = await pool.query<{ state: string; paired_device_id: string | null }>(
      `select state, paired_device_id from kitluy_devices.terminal_pairing_sessions where id = $1::uuid`,
      [String(opened.session_id)],
    );
    expect(s[0]?.state).toBe("consumed");
    expect(s[0]?.paired_device_id).toBe(device);
  });

  it("a wrong code is refused and the session survives UNSPENT", async () => {
    await activeHub();
    const device = await approvedTerminal();
    const seatId = await seat(`Front Counter ${RUN}-B`);
    const opened = await open(seatId, freshCode());
    const r = await composition.pair({
      deviceRecordId: device,
      presentedCode: "ZZZZ1111",
      actorRef: "device/tpair-suite",
    });
    expect(r.result).toBe("CODE_REFUSED");
    const { rows } = await pool.query<{ failed_attempt_count: number; state: string }>(
      `select failed_attempt_count, state from kitluy_devices.terminal_pairing_sessions where id = $1::uuid`,
      [String(opened.session_id)],
    );
    expect(rows[0]?.failed_attempt_count).toBe(0);
    expect(rows[0]?.state).toBe("open");
  });

  it("the right code from a Store Hub is refused AND spends an attempt", async () => {
    const hub = await activeHub();
    const seatId = await seat(`Front Counter ${RUN}-C`);
    const code = freshCode();
    const opened = await open(seatId, code);
    const r = await composition.pair({
      deviceRecordId: hub,
      presentedCode: code,
      actorRef: "device/tpair-suite",
    });
    expect(r.result).toBe("CODE_REFUSED");
    const { rows } = await pool.query<{ failed_attempt_count: number }>(
      `select failed_attempt_count from kitluy_devices.terminal_pairing_sessions where id = $1::uuid`,
      [String(opened.session_id)],
    );
    expect(rows[0]?.failed_attempt_count).toBe(1);
  });

  it("opening a second session supersedes the first; changing roles is refused while one is open", async () => {
    await activeHub();
    const seatId = await seat(`Front Counter ${RUN}-D`);
    const first = await open(seatId, freshCode());
    const second = await open(seatId, freshCode());
    expect(second.outcome).toBe("OPENED");
    const { rows } = await pool.query<{ state: string; revoked_reason: string | null }>(
      `select state, revoked_reason from kitluy_devices.terminal_pairing_sessions where id = $1::uuid`,
      [String(first.session_id)],
    );
    expect(rows[0]?.state).toBe("revoked");
    expect(rows[0]?.revoked_reason).toBe("superseded");
    const { rows: roles } = await pool.query<{ r: Record<string, unknown> }>(
      `select kitluy_devices.set_physical_terminal_roles_v1($1::uuid, $2::text[], 'partner/tpair') as r`,
      [seatId, [ROLES[0]]],
    );
    expect(roles[0]?.r.refusal_code).toBe("KLUY-PHYSTERM-SESSION-OPEN");
  });

  it("two devices racing one code: exactly one pairs", async () => {
    await activeHub();
    const a = await approvedTerminal();
    const b = await approvedTerminal();
    const seatId = await seat(`Front Counter ${RUN}-E`);
    const code = freshCode();
    await open(seatId, code);
    const [ra, rb] = await Promise.all([
      composition.pair({ deviceRecordId: a, presentedCode: code, actorRef: "device/tpair-a" }),
      composition.pair({ deviceRecordId: b, presentedCode: code, actorRef: "device/tpair-b" }),
    ]);
    const results = [ra.result, rb.result].sort();
    expect(results.filter((x) => x === "PAIRED")).toHaveLength(1);
    expect(results.some((x) => x === "REDEMPTION_REFUSED" || x === "CODE_REFUSED")).toBe(true);
  });

  it("a session cannot open without an active Store Hub at the seat's Location", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `select sl.id from kitluy_core.store_locations sl
        where sl.digital_store_id = $1::uuid and sl.id <> $2::uuid
          and not exists (select 1 from kitluy_devices.device_assignment_projections p
                           where p.store_location_id = sl.id)
        limit 1`,
      [STORE, LOCATION],
    );
    const bare = rows[0]?.id;
    if (bare === undefined) return; // no Hub-less Location in this stack's fixtures
    const { rows: def } = await pool.query<{ r: Record<string, unknown> }>(
      `select kitluy_devices.define_physical_terminal_v1($1::uuid, $2::uuid, $3, $4::text[], 'partner/tpair') as r`,
      [STORE, bare, `Bare ${RUN}`, ROLES],
    );
    expect(def[0]?.r.outcome).toBe("DEFINED");
    const opened = await open(String(def[0]!.r.physical_terminal_id), freshCode());
    expect(opened.refusal_code).toBe("KLUY-TERMSESSION-HUB-INACTIVE");
  });

  it("neither identity holds table access, and a browser role reaches no door", async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `select not has_table_privilege('kitluy_terminal_pairing_service', 'kitluy_devices.terminal_pairing_sessions', 'SELECT')
          and not has_table_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.physical_terminals', 'SELECT')
          and not has_function_privilege('authenticated', 'kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text)', 'execute')
          and not has_function_privilege('anon', 'kitluy_devices.evaluate_terminal_pairing_session_v1(text, uuid, text)', 'execute') as ok`,
    );
    expect(rows[0]?.ok).toBe(true);
  });
});
