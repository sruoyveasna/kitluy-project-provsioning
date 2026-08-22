/**
 * PERMANENT BOARD IDENTITY and admin-approved registration, against the
 * canonical database.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS
 * ===========================================================================
 * Migration 0197 implements one owner rule:
 *
 *   "One physical Raspberry Pi board maps to one permanent opaque KitLuy
 *    device_record_id. Hardware evidence RESOLVES that identity; it does not
 *    DEFINE or replace it."
 *
 * That rule is invisible in ordinary use. A board registers, an admin approves
 * it, and nothing about the happy path reveals whether identity is anchored to
 * the BOARD or to the SD card the key happens to live on. The difference only
 * shows up on a reflash — and it showed up on real hardware this month, as a
 * quarantined evidence collision, because identity was following the card.
 *
 * So the interesting assertions here are all about CHANGE: the same board with
 * a new card, a new key, a new hostname; a different board with the same card;
 * a different board with a stolen key. Plan §8.4 calls Test A "the core
 * requirement", and it is the one this suite exists for.
 *
 * ===========================================================================
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * ===========================================================================
 * Operational credential issuance. `register_device_v1` issues nothing and
 * `approve_device_enrollment_v1` issues nothing; the certificate path is gated
 * on BLK-005 and cannot run. A suite that asserted a device becomes
 * "operational" after approval would be claiming a step no code performs.
 *
 * Proof of possession. The signature check lives in the Edge Function, above
 * the database. What this suite proves is that a request which HAS been
 * authenticated to its own key still earns no trust from that fact alone.
 *
 * ===========================================================================
 * HOW IT REFUSES TO PASS DISHONESTLY
 * ===========================================================================
 * It SKIPS when 0197's door is absent rather than passing with nothing
 * exercised, and every test MINTS its own board with randomised evidence — two
 * devices sharing evidence is itself a security event, so a shared fixture pool
 * would make one test quarantine another's hardware.
 *
 * The role tests grant themselves nothing. They enter
 * `kitluy_device_registration_service` through the membership 0197 gives
 * `service_role` — never by granting the role to CURRENT_USER, which is what
 * segfaults the backend in group 0189 (KLREC-2026-08-11-EDGE-006, still OPEN).
 * They also assert the privilege graph directly, so a widened grant fails the
 * suite even if no statement happens to exercise it.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/** The PG17 stack, which is the one carrying 0197. */
const DB_URL =
  process.env.KITLUY_HUB_CLAIM_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const clients: Client[] = [];
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  clients.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
});

async function doorExists(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices' and p.proname = 'register_device_v1'`,
    );
    await c.end();
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    try {
      await c.end();
    } catch {
      /* never connected */
    }
    return false;
  }
}

const ready = await doorExists();

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

/**
 * One physical board's evidence, generated once and then presented unchanged
 * across reflashes — which is precisely what a real board does.
 */
interface Board {
  readonly serial: string;
  readonly soc: string;
  readonly signals: string;
  readonly assetTag: string;
}
function newBoard(): Board {
  const h = hex(10);
  const serial = `bs-${h}`;
  const soc = `soc-${h}`;
  return {
    serial,
    soc,
    signals: JSON.stringify([
      { signal_type: "board_serial", signal_value: serial },
      { signal_type: "soc_serial", signal_value: soc },
    ]),
    assetTag: `REG-${h.slice(0, 8).toUpperCase()}`,
  };
}

interface Registration {
  readonly status: string;
  readonly device_id: string | null;
  readonly installation_id: string | null;
  readonly installation_created: boolean;
  readonly credential_reuse_detected: boolean;
  readonly conflict_reason: string | null;
}

async function profileId(db: Client): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from kitluy_devices.hardware_profiles
      where device_class = 'store_hub' and is_active limit 1`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no active store_hub hardware profile");
  return id;
}

/**
 * A registration as the device performs it: board evidence, a hostname, an
 * installation description and whatever key this installation generated.
 */
async function register(
  db: Client,
  opts: {
    board: Board;
    profile: string;
    key: string;
    hostname: string;
    installation: Record<string, string>;
    signals?: string;
    assetTag?: string;
  },
): Promise<Registration> {
  const { rows } = await db.query<{ r: Registration }>(
    `select kitluy_devices.register_device_v1(
       $1::text, $2::uuid, $3::text, $4::text, $5::jsonb, $6::jsonb, 'device/continuity-suite') as r`,
    [
      opts.assetTag ?? opts.board.assetTag,
      opts.profile,
      opts.key,
      opts.hostname,
      opts.signals ?? opts.board.signals,
      JSON.stringify(opts.installation),
    ],
  );
  const r = rows[0]?.r;
  if (r === undefined) throw new Error("register_device_v1 returned nothing");
  return r;
}

async function approve(db: Client, deviceId: string, environment = "development"): Promise<void> {
  await db.query(
    `select kitluy_devices.approve_device_enrollment_v1(
       $1::uuid, 'admin/continuity-suite', 'suite: board verified on the bench',
       $2::text, 'evidence/continuity-suite-checklist', null)`,
    [deviceId, environment],
  );
}

async function lifecycle(db: Client, deviceId: string): Promise<string> {
  const { rows } = await db.query<{ s: string }>(
    `select lifecycle_state::text as s from kitluy_devices.devices where id = $1::uuid`,
    [deviceId],
  );
  return rows[0]?.s ?? "";
}

async function scalar(db: Client, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return rows[0]?.n ?? -1;
}

describe.skipIf(!ready)("0197: permanent board identity across reflash (plan §8.4)", () => {
  /**
   * TEST A — the core requirement.
   *
   * A board is registered, HET approves it, then it is reflashed: new SD card,
   * new registration key, new hostname. Everything the device can present has
   * changed except the board itself.
   */
  it("keeps one device_record_id when the same board is reflashed with a new key", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const board = newBoard();

    const before = await scalar(db, `select count(*)::int as n from kitluy_devices.devices`);

    const first = await register(db, {
      board,
      profile,
      key: hex(32),
      hostname: "hub-first-boot",
      installation: { storageSerial: "SD-GEN-1", storageModel: "SC32G" },
    });

    // An unknown board is PENDING. Registration has no authority to enrol.
    expect(first.status).toBe("PENDING_APPROVAL");
    expect(await lifecycle(db, first.device_id ?? "")).toBe("manufactured");
    expect(first.installation_created).toBe(true);

    await approve(db, first.device_id ?? "");
    expect(await lifecycle(db, first.device_id ?? "")).toBe("enrolled");

    const reflashed = await register(db, {
      board,
      profile,
      key: hex(32),
      hostname: "hub-after-reflash",
      installation: { storageSerial: "SD-GEN-2", storageModel: "SN770" },
    });

    // The four assertions plan §8.4 names.
    expect(reflashed.device_id).toBe(first.device_id); // D1 SAME
    expect(reflashed.installation_id).not.toBe(first.installation_id); // I2 NEW
    expect(reflashed.installation_created).toBe(true);
    expect(await scalar(db, `select count(*)::int as n from kitluy_devices.devices`)).toBe(
      before + 1,
    ); // row count UNCHANGED
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.colliding_evidence_device_ids($1::uuid)`,
        [first.device_id],
      ),
    ).toBe(0); // collision NONE

    // A legitimate reflash must not cost the board its approval.
    expect(await lifecycle(db, first.device_id ?? "")).toBe("enrolled");

    // Both generations survive. History is superseded, never overwritten —
    // otherwise there would be no record of what the board presented before,
    // which is the evidence an investigation needs.
    const { rows: installs } = await db.query<{ generation: number; state: string }>(
      `select generation, state from kitluy_devices.device_installations
        where device_record_id = $1::uuid order by generation`,
      [first.device_id],
    );
    expect(installs.map((r) => `${r.generation}:${r.state}`)).toEqual([
      "1:superseded",
      "2:current",
    ]);

    const { rows: enrollments } = await db.query<{ enrollment_sequence: number; state: string }>(
      `select enrollment_sequence, state from kitluy_devices.manufacturing_enrollments
        where device_id = $1::uuid order by enrollment_sequence`,
      [first.device_id],
    );
    expect(enrollments.length).toBe(2);
    expect(enrollments[0]?.state).toBe("superseded");
  });

  /** TEST B — a hostname change is not an installation and not an identity. */
  it("updates the reported hostname without opening a new installation", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const board = newBoard();
    const key = hex(32);
    const installation = { storageSerial: "SD-STABLE", storageModel: "SC32G" };

    const first = await register(db, {
      board,
      profile,
      key,
      hostname: "hub-original",
      installation,
    });
    const renamed = await register(db, {
      board,
      profile,
      key,
      hostname: "hub-renamed",
      installation,
    });

    expect(renamed.device_id).toBe(first.device_id);
    expect(renamed.installation_id).toBe(first.installation_id);
    expect(renamed.installation_created).toBe(false);
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.devices
          where id = $1::uuid and reported_hostname = 'hub-renamed'`,
        [first.device_id],
      ),
    ).toBe(1);
  });

  /**
   * TEST C — the SD card is moved into a different board.
   *
   * Identical installation evidence, different board. Storage is installation
   * history, never identity, so the second board must be its own device.
   */
  it("does not let storage evidence carry identity to another board", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const first = newBoard();
    const second = newBoard();
    const installation = { storageSerial: "SD-TRAVELLING", storageModel: "SN770" };

    const a = await register(db, {
      board: first,
      profile,
      key: hex(32),
      hostname: "hub-a",
      installation,
    });
    const b = await register(db, {
      board: second,
      profile,
      key: hex(32),
      hostname: "hub-a", // the copied filesystem even carries the same hostname
      installation,
    });

    expect(b.device_id).not.toBe(a.device_id);
    expect(b.status).toBe("PENDING_APPROVAL");
  });

  /**
   * TEST E — only a MAC address matches.
   *
   * MAC is supporting evidence. Auto-resolving on it would silently merge two
   * physical devices, so the resolver must hand this to a human instead.
   */
  it("refuses to reclaim a device from a MAC address alone", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const mac = `02:${hex(1)}:00:00:00:01`;
    const macOnly = JSON.stringify([{ signal_type: "mac_address", signal_value: mac }]);

    const seeded = await register(db, {
      board: newBoard(),
      profile,
      key: hex(32),
      hostname: "hub-mac-first",
      installation: { storageSerial: "SD-MAC-1" },
      signals: macOnly,
      assetTag: `MAC1-${hex(4).toUpperCase()}`,
    });
    expect(seeded.status).toBe("PENDING_APPROVAL");

    const second = await register(db, {
      board: newBoard(),
      profile,
      key: hex(32),
      hostname: "hub-mac-second",
      installation: { storageSerial: "SD-MAC-2" },
      signals: macOnly,
      assetTag: `MAC2-${hex(4).toUpperCase()}`,
    });

    expect(second.status).toBe("TRUST_REVIEW_REQUIRED");
    expect(second.device_id).toBeNull();
  });
});

/**
 * TEST D — a copied credential on a different board (plan §1.5 Path D, §7.3).
 *
 * Grouped separately because it asserts five distinct things about one event,
 * and because the fifth is the one an implementation gets wrong: the clone must
 * not be able to lock the LEGITIMATE board out.
 */
describe.skipIf(!ready)("0197: credential reuse on a second board", () => {
  it("gives the clone its own untrusted identity, an incident, and no path to trust", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const legitimate = newBoard();
    const clone = newBoard();
    const sharedKey = hex(32);

    const original = await register(db, {
      board: legitimate,
      profile,
      key: sharedKey,
      hostname: "hub-legitimate",
      installation: { storageSerial: "SD-ORIGINAL" },
    });
    await approve(db, original.device_id ?? "");

    const copied = await register(db, {
      board: clone,
      profile,
      key: sharedKey, // the key the SD card was cloned with
      hostname: "hub-clone",
      installation: { storageSerial: "SD-CLONE" },
    });

    // 1. The clone does NOT inherit the original's identity...
    expect(copied.device_id).not.toBe(original.device_id);
    // 2. ...but it IS visible, as itself. Refusing outright would leave HET with
    //    no record of a cloned appliance somebody is physically holding.
    expect(copied.device_id).not.toBeNull();
    expect(copied.status).toBe("TRUST_REVIEW_REQUIRED");
    expect(copied.credential_reuse_detected).toBe(true);
    expect(copied.conflict_reason).toBe("KLUY-CREDENTIAL-REUSE-DETECTED");

    // 3. The security event names the earlier holder, so triage has both ends.
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.device_trust_incidents
          where device_id = $1::uuid
            and incident_type = 'credential_reuse_detected'
            and severity = 'CRITICAL'
            and cleared_at is null
            and detail->>'earlier_holder_device_id' = $2::text`,
        [copied.device_id, original.device_id],
      ),
    ).toBe(1);

    // 4. It cannot be approved past its own finding, and eligibility is withheld
    //    independently of approval.
    await expect(approve(db, copied.device_id ?? "")).rejects.toThrow(/KLUY-APPROVE-OPEN-INCIDENT/);
    expect(await lifecycle(db, copied.device_id ?? "")).toBe("manufactured");
    const { rows: eligibility } = await db.query<{ eligible: boolean }>(
      `select eligible from kitluy_devices.evaluate_provisioning_eligibility_v1($1::uuid)`,
      [copied.device_id],
    );
    expect(eligibility[0]?.eligible).toBe(false);

    // 5. THE POISONING CASE. The clone sealed the shared key into its own
    //    enrollment, so a naive "is this key held elsewhere?" test would now see
    //    the clone and report the legitimate board as a clone too — letting one
    //    copied card lock the real device out of registration for ever.
    const stillWorks = await register(db, {
      board: legitimate,
      profile,
      key: sharedKey,
      hostname: "hub-legitimate",
      installation: { storageSerial: "SD-ORIGINAL" },
    });
    expect(stillWorks.device_id).toBe(original.device_id);
    expect(stillWorks.credential_reuse_detected).toBe(false);
    expect(stillWorks.status).toBe("KNOWN_DEVICE_INSTALLATION_REGISTERED");
    expect(await lifecycle(db, original.device_id ?? "")).toBe("enrolled");
  });
});

/**
 * Replay, and the one thing it must never buy (plan §2.4).
 *
 * A registration request is deliberately retry-safe, which means a captured one
 * can be resent. That is acceptable for everything EXCEPT credential state: a
 * replay resent after a rotation must not walk the board back onto the key that
 * was taken out of service.
 */
describe.skipIf(!ready)("0197: a replay cannot roll a credential back", () => {
  it("returns the superseded installation without resurrecting it", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const board = newBoard();
    const firstKey = hex(32);
    const firstInstall = { storageSerial: "SD-REPLAY-1" };

    const original = await register(db, {
      board,
      profile,
      key: firstKey,
      hostname: "hub-replay",
      installation: firstInstall,
    });
    await register(db, {
      board,
      profile,
      key: hex(32),
      hostname: "hub-replay-2",
      installation: { storageSerial: "SD-REPLAY-2" },
    });

    // Replay the FIRST request verbatim.
    const replayed = await register(db, {
      board,
      profile,
      key: firstKey,
      hostname: "hub-replay",
      installation: firstInstall,
    });

    expect(replayed.device_id).toBe(original.device_id);
    // The old installation is recognised, not recreated...
    expect(replayed.installation_id).toBe(original.installation_id);
    expect(replayed.installation_created).toBe(false);
    // ...and it stays superseded. Generation 2 is still the current one.
    const { rows } = await db.query<{ generation: number; state: string }>(
      `select generation, state from kitluy_devices.device_installations
        where device_record_id = $1::uuid order by generation`,
      [original.device_id],
    );
    expect(rows.map((r) => `${r.generation}:${r.state}`)).toEqual(["1:superseded", "2:current"]);
  });

  /**
   * A device whose CURRENT registration credential has been revoked.
   *
   * `enforce_enrollment_append_only` would refuse the supersede on its own, but
   * as a raw trigger error escaping a function whose contract is to return a
   * status. This asserts the governed refusal instead — and asserts that the
   * revoked key was not quietly rotated around.
   */
  it("refuses to rotate around a REVOKED current credential", async () => {
    const db = await connect();
    const profile = await profileId(db);
    const board = newBoard();
    const firstKey = hex(32);

    const original = await register(db, {
      board,
      profile,
      key: firstKey,
      hostname: "hub-revoked",
      installation: { storageSerial: "SD-REV-1" },
    });

    // Revoke the current enrollment, as a credential incident response would.
    // `manufacturing_enrollments_revoked_consistency_chk` ties the state and the
    // timestamp together, so both move or neither does — and only a `sealed` row
    // may close, which is why this is done while generation 1 is still current.
    await db.query(
      `update kitluy_devices.manufacturing_enrollments
          set state = 'revoked', revoked_at = now(), revocation_reason = 'suite: key disclosed'
        where id = (select current_enrollment_id from kitluy_devices.devices where id = $1::uuid)`,
      [original.device_id],
    );

    const afterRevocation = await register(db, {
      board,
      profile,
      key: hex(32), // a new key, as a reflashed card would present
      hostname: "hub-revoked",
      installation: { storageSerial: "SD-REV-2" },
    });

    expect(afterRevocation.status).toBe("TRUST_REVIEW_REQUIRED");
    expect(afterRevocation.conflict_reason).toBe("KLUY-CREDENTIAL-REVOKED");
    expect(afterRevocation.installation_created).toBe(false);

    // Nothing moved: still one installation, still one enrollment, still revoked.
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.device_installations
          where device_record_id = $1::uuid`,
        [original.device_id],
      ),
    ).toBe(1);
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.manufacturing_enrollments
          where device_id = $1::uuid`,
        [original.device_id],
      ),
    ).toBe(1);
    expect(
      await scalar(
        db,
        `select count(*)::int as n from kitluy_devices.devices d
           join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
          where d.id = $1::uuid and e.state = 'revoked'`,
        [original.device_id],
      ),
    ).toBe(1);
  });
});

describe.skipIf(!ready)("0197: the approval door refuses (plan §1.6, §8.1)", () => {
  async function pendingDevice(db: Client): Promise<string> {
    const r = await register(db, {
      board: newBoard(),
      profile: await profileId(db),
      key: hex(32),
      hostname: "hub-pending",
      installation: { storageSerial: `SD-${hex(6)}` },
    });
    return r.device_id ?? "";
  }

  it("refuses an empty reason", async () => {
    const db = await connect();
    const id = await pendingDevice(db);
    await expect(
      db.query(
        `select kitluy_devices.approve_device_enrollment_v1(
           $1::uuid, 'admin/suite', '   ', 'development', 'evidence/x', null)`,
        [id],
      ),
    ).rejects.toThrow(/KLUY-APPROVE-NO-REASON/);
  });

  it("refuses an approval that records no verification evidence", async () => {
    const db = await connect();
    const id = await pendingDevice(db);
    await expect(
      db.query(
        `select kitluy_devices.approve_device_enrollment_v1(
           $1::uuid, 'admin/suite', 'looks fine to me', 'development', '', null)`,
        [id],
      ),
    ).rejects.toThrow(/KLUY-APPROVE-NO-VERIFICATION/);
  });

  it("requires a second, distinct approver in production", async () => {
    const db = await connect();
    const id = await pendingDevice(db);
    await expect(
      db.query(
        `select kitluy_devices.approve_device_enrollment_v1(
           $1::uuid, 'admin/one', 'production intake', 'production', 'evidence/x', null)`,
        [id],
      ),
    ).rejects.toThrow(/KLUY-APPROVE-FOUR-EYES-REQUIRED/);

    await expect(
      db.query(
        `select kitluy_devices.approve_device_enrollment_v1(
           $1::uuid, 'admin/one', 'production intake', 'production', 'evidence/x', 'admin/one')`,
        [id],
      ),
    ).rejects.toThrow(/KLUY-APPROVE-FOUR-EYES-SAME-ACTOR/);
  });

  it("refuses to approve a device that is not pending", async () => {
    const db = await connect();
    const id = await pendingDevice(db);
    await approve(db, id);
    await expect(approve(db, id)).rejects.toThrow(/KLUY-APPROVE-WRONG-STATE/);
  });

  it("refuses a device that does not exist", async () => {
    const db = await connect();
    await expect(approve(db, randomUUID())).rejects.toThrow(/KLUY-APPROVE-NO-DEVICE/);
  });
});

/**
 * Separation of duty, proven against the privilege graph the database actually
 * consults (plan §8.2).
 *
 * ===========================================================================
 * WHY THIS DOES NOT `SET LOCAL ROLE`
 * ===========================================================================
 * The obvious way to write these tests is to become the role and watch the
 * refusals. It does not work here, and the way it fails is a trap worth naming
 * because the first version of this file fell into it.
 *
 * Every `kitluy_*` service role is granted to `postgres` WITH SET FALSE
 * (`pg_auth_members.set_option = false`), so `set local role
 * kitluy_device_registration_service` is itself refused — with SQLSTATE 42501
 * and the message "permission denied to set role". A suite asserting
 * `rejects.toThrow(/permission denied/)` therefore PASSES WITHOUT EVER
 * ASSUMING THE ROLE, and would keep passing if the role were granted every
 * privilege in the schema. Matching on the SQLSTATE does not help: the refusal
 * to set the role and the refusal to call a function share code 42501.
 *
 * Nor can the suite connect as the role — it is `nologin` by design — and it
 * must not grant itself membership: `GRANT <role> TO CURRENT_USER` is what
 * segfaults the backend in group 0189 (KLREC-2026-08-11-EDGE-006, still OPEN).
 *
 * `has_*_privilege` asks the privilege system the same question it would answer
 * during execution — "may this role do this?" — for a role the caller cannot
 * become. It cannot be satisfied by an unrelated refusal, and it fails the
 * moment somebody widens a grant.
 */
describe.skipIf(!ready)(
  "0197: the registration role cannot exceed registration (plan §8.2)",
  () => {
    const ROLE = "kitluy_device_registration_service";

    const REGISTER =
      "kitluy_devices.register_device_v1(text, uuid, text, text, jsonb, jsonb, text)";

    /** Doors that would let registration hand itself trust. */
    const FORBIDDEN_DOORS = [
      "kitluy_devices.approve_device_enrollment_v1(uuid, text, text, text, text, text)",
      "kitluy_devices.enroll_device_v1(text, uuid, timestamptz, text, text, text, text, text, jsonb, text, text)",
      "kitluy_devices.reenroll_device_v1(uuid, text, text, text, text, text, jsonb, text, uuid)",
      "kitluy_devices.activate_device_v1(uuid, text, text)",
    ];

    /** Tables it must not reach around its one door to read or write. */
    const FORBIDDEN_TABLES = [
      "kitluy_devices.devices",
      "kitluy_devices.device_credentials",
      "kitluy_devices.device_credential_heads",
      "kitluy_devices.device_trust_incidents",
      "kitluy_devices.device_installations",
      "kitluy_devices.manufacturing_enrollments",
      "kitluy_devices.hardware_manifest_signals",
    ];

    async function may(db: Client, sql: string, params: unknown[]): Promise<boolean> {
      const { rows } = await db.query<{ ok: boolean }>(sql, params);
      return rows[0]?.ok ?? false;
    }

    it("exists, and cannot log in", async () => {
      const db = await connect();
      const { rows } = await db.query<{ rolcanlogin: boolean }>(
        `select rolcanlogin from pg_roles where rolname = $1`,
        [ROLE],
      );
      expect(rows.length).toBe(1);
      // A service identity the Edge Function assumes, never a login account.
      expect(rows[0]?.rolcanlogin).toBe(false);
    });

    it("may execute registration, and needs schema usage to do it", async () => {
      const db = await connect();
      expect(
        await may(db, `select has_function_privilege($1, $2, 'execute') as ok`, [ROLE, REGISTER]),
      ).toBe(true);
      // The EXECUTE grant is inert without USAGE, so the pair is asserted together.
      expect(
        await may(db, `select has_schema_privilege($1, 'kitluy_devices', 'usage') as ok`, [ROLE]),
      ).toBe(true);
    });

    it("may not approve, enrol, re-enrol or activate", async () => {
      const db = await connect();
      for (const door of FORBIDDEN_DOORS) {
        expect(
          await may(db, `select has_function_privilege($1, $2, 'execute') as ok`, [ROLE, door]),
          `${ROLE} must not execute ${door}`,
        ).toBe(false);
      }
    });

    it("may not read or write the fleet, credential, installation or incident tables", async () => {
      const db = await connect();
      for (const table of FORBIDDEN_TABLES) {
        for (const privilege of ["select", "insert", "update", "delete"]) {
          expect(
            await may(db, `select has_table_privilege($1, $2, $3) as ok`, [ROLE, table, privilege]),
            `${ROLE} must not ${privilege} ${table}`,
          ).toBe(false);
        }
      }
    });

    /**
     * The same conclusions, watched as live refusals rather than read off the
     * privilege graph.
     *
     * `enterRole` asserts `current_user` AFTER setting it. That assertion is the
     * whole reason this block can be trusted: without it, a `SET ROLE` that was
     * itself refused would leave the connection as the superuser, and the
     * "cannot approve" test below would then be asserting that `postgres` cannot
     * approve — which is false, and would fail loudly only by luck.
     */
    async function enterRole(db: Client): Promise<void> {
      await db.query("begin");
      await db.query(`set local role ${ROLE}`);
      const { rows } = await db.query<{ me: string }>(`select current_user as me`);
      expect(rows[0]?.me, "the suite must actually BE the role before asserting refusals").toBe(
        ROLE,
      );
    }

    it("can register a device while holding no table privilege at all", async () => {
      const db = await connect();
      const profile = await profileId(db);
      const board = newBoard();
      await enterRole(db);
      try {
        const { rows } = await db.query<{ r: Registration }>(
          `select kitluy_devices.register_device_v1(
           $1::text, $2::uuid, $3::text, 'hub-role-live', $4::jsonb,
           '{"storageSerial":"SD-ROLE-LIVE"}'::jsonb, 'device/role-suite') as r`,
          [board.assetTag, profile, hex(32), board.signals],
        );
        // SECURITY DEFINER is what makes this possible: the door writes the tables
        // the caller cannot touch.
        expect(rows[0]?.r.status).toBe("PENDING_APPROVAL");
      } finally {
        await db.query("rollback").catch(() => undefined);
      }
    });

    it("is refused when it tries to approve", async () => {
      const db = await connect();
      const registered = await register(db, {
        board: newBoard(),
        profile: await profileId(db),
        key: hex(32),
        hostname: "hub-role-approve",
        installation: { storageSerial: `SD-${hex(6)}` },
      });

      const probe = await connect();
      await enterRole(probe);
      try {
        await expect(
          probe.query(
            `select kitluy_devices.approve_device_enrollment_v1(
             $1::uuid, 'attacker', 'self-approval', 'development', 'evidence/none', null)`,
            [registered.device_id],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await probe.query("rollback").catch(() => undefined);
      }

      // And the device it registered is untouched.
      expect(await lifecycle(db, registered.device_id ?? "")).toBe("manufactured");
    });

    it("is refused when it reads around its door", async () => {
      for (const table of FORBIDDEN_TABLES) {
        const db = await connect();
        await enterRole(db);
        try {
          await expect(
            db.query(`select count(*) from ${table}`),
            `${ROLE} must not read ${table}`,
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await db.query("rollback").catch(() => undefined);
        }
      }
    });

    it("holds the approval permission nowhere in the RBAC registry", async () => {
      const db = await connect();
      // The database role is one half of separation of duty; the other half is
      // that `fleet.device_enrollment.approve` is CRITICAL and belongs to an
      // operator role template, never to a device-facing service.
      const { rows } = await db.query<{ risk_class: string }>(
        `select risk_class from kitluy_auth.permissions
        where permission_key = 'fleet.device_enrollment.approve' and version = 1`,
      );
      expect(rows[0]?.risk_class).toBe("CRITICAL");
    });
  },
);
