/**
 * TERMINAL PROOF-OF-POSSESSION FOUNDATION.
 *
 * WS-11-T004-P02B3A. Proves the 0170 challenge/attestation foundation for
 * cloud-side terminal proof of possession (pairing protocol §7) end to end
 * under OPTION B: the database issues an immutable, fully bound challenge;
 * the @kitluy/device-identity service reconstructs the canonical
 * `kitluy.provisioning-pop.v1` bytes, the terminal's REAL Ed25519 key signs
 * them, the service verifies bindings-first-signature-last, and the governed
 * attestation door re-locks and re-validates everything before recording the
 * ONE issued→verified transition.
 *
 *   Success  — real keypair, real signature, one verified single-use proof;
 *              code stays ISSUED, no credential, no code events
 *   Replay   — identical attestation answers POP_ALREADY_VERIFIED with no
 *              second transition; one proof per code, ever
 *   Refusals — no outstanding code / expired code / inactive assignment /
 *              inactive Hub / expired challenge (exact boundary) / rejected
 *              or mismatched attestation / malformed inputs — zero residue
 *   Races    — A identical attestations; B valid vs rejected attestation;
 *              C verification vs canonical code expiry at the boundary;
 *              D verification vs governed revocation (both orders);
 *              E verification vs governed Hub withdrawal (both orders)
 *              — separate backends, recorded PIDs
 *   Security — doors harness-only (42501 for anon/authenticated/service_role);
 *              challenge table unreachable; no raw code, signature or private
 *              key persisted anywhere
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  provisioningChallengeBytes,
  provisioningChallengeHash,
  verifyProvisioningPop,
  PROVISIONING_POP_PURPOSE,
  type ProvisioningPopChallenge,
  type ProvisioningPopExpectation,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
// Race E owns this sibling scope outright (the serial-file convention the
// cross-race and recovery-race suites established).
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const STAGGER_MS = 250;

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
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
if (!live) console.warn("SKIPPED: PoP foundation — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
}

interface RacerOutcome {
  pid: number;
  result: Record<string, unknown>;
  error: string | null;
  sqlstate: string | null;
}

/** The terminal-side key custody: real Ed25519 keys, private halves vaulted. */
const keys = new DevelopmentDeviceKeyProvider();

/** Every raw provisioning code the fixture ever received — census only. */
const rawCodes: string[] = [];

describe.skipIf(!live)("terminal provisioning proof of possession (0170)", () => {
  let keeper: pg.Pool;
  let hub = "";
  let hubE1 = "";
  let hubE2 = "";
  let operator = "";
  const stations: Record<string, Station> = {};

  async function enrollWithRealKey(
    label: string,
  ): Promise<{ id: string; pem: string; fingerprint: string }> {
    const keyDeviceRef = `${label}-${RUN}-${randomUUID()}`;
    await keys.generateDeviceKey(keyDeviceRef, "development");
    const pem = keys.publicKeyPem(keyDeviceRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-POP', 'OP-POP', $4::jsonb) as id`,
      [
        keyDeviceRef,
        rows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `cc:bb:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return { id: enrolled[0]?.id ?? "", pem, fingerprint };
  }

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-POP')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-POP')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-POP')`,
      [hubId, serial, "e5".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  /** A terminal with a REAL vaulted Ed25519 key, enrolled by fingerprint. */
  async function newStation(label: string, location: string = LOCATION): Promise<Station> {
    const keyRef = `${label}-key-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-POP', 'OP-POP', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `cc:bb:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    const terminalId = enrolled[0]?.id ?? "";
    await claimAndRedeem(terminalId, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-POP') as id`,
      [terminalId, location],
    );
    return { assignmentId: rows[0]?.id ?? "", terminalId, pem, fingerprint };
  }

  /** Signs the canonical bytes with the station's vaulted private key. */
  function signChallenge(
    station: Station,
    label: string,
    challenge: ProvisioningPopChallenge,
  ): Uint8Array {
    return keys.provePossession(`${label}-key-${RUN}`, provisioningChallengeBytes(challenge));
  }

  async function issueCode(
    assignmentId: string,
    key: string,
  ): Promise<{ id: string; raw: string; expiresAt: string }> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, key],
      );
      await client.query("commit");
      const result = rows[0]?.result ?? {};
      expect(result.outcome, `issuance for ${key}`).toBe("ISSUED");
      rawCodes.push(String(result.code));
      return {
        id: String(result.provisioning_code_id),
        raw: String(result.code),
        expiresAt: String(result.expires_at),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** The harness door: challenge issuance (as postgres+harness). */
  async function issueChallenge(assignmentId: string | null): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid) as result`,
      [assignmentId],
    );
    return rows[0]?.result ?? {};
  }

  /** The harness door: attestation, optionally clocked, optionally racing. */
  async function recordVerification(
    challengeId: string | null,
    attested: boolean,
    hash: string,
    fingerprint: string,
    clock?: string,
    ready: Promise<void> = Promise.resolve(),
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      if (clock !== undefined) {
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [clock]);
      }
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.record_terminal_provisioning_pop_verification_v1($1::uuid, $2, $3, $4) as result`,
        [challengeId, attested, hash, fingerprint],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  function barrier(delayMs = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function expectNoUncontrolled(...racers: RacerOutcome[]): void {
    for (const racer of racers) {
      expect(racer.error, `no uncontrolled error (sqlstate ${racer.sqlstate ?? "n/a"})`).toBeNull();
      expect(racer.sqlstate).toBeNull();
    }
  }

  /** Rebuilds the ProvisioningPopChallenge object from the door's response. */
  function challengeFromDoor(issued: Record<string, unknown>): ProvisioningPopChallenge {
    return {
      challengeId: String(issued.challenge_id),
      purpose: String(issued.purpose),
      tenantId: String(issued.tenant_id),
      digitalStoreId: String(issued.digital_store_id),
      storeLocationId: String(issued.store_location_id),
      environment: String(issued.environment) as ProvisioningPopChallenge["environment"],
      storeHubDeviceId: String(issued.store_hub_device_id),
      terminalDeviceId: String(issued.terminal_device_id),
      terminalAssignmentId: String(issued.terminal_assignment_id),
      terminalProfileKey: String(issued.terminal_profile_key),
      provisioningCodeId: String(issued.provisioning_code_id),
      terminalKeyFingerprint: String(issued.terminal_key_fingerprint),
      nonce: String(issued.nonce),
      issuedAt: new Date(String(issued.created_at)),
      expiresAt: new Date(String(issued.expires_at)),
    };
  }

  /** The AUTHORITATIVE expectation, from the stored row — never the caller. */
  async function expectationFromRow(challengeId: string): Promise<ProvisioningPopExpectation> {
    const { rows } = await keeper.query(
      `select c.*, e.state::text as enrollment_state
         from kitluy_devices.device_provisioning_pop_challenges c
         join kitluy_devices.manufacturing_enrollments e on e.id = c.terminal_enrollment_id
        where c.id = $1::uuid`,
      [challengeId],
    );
    const row = rows[0] as Record<string, unknown>;
    return {
      challengeId: String(row.id),
      purpose: String(row.purpose),
      tenantId: String(row.tenant_id),
      digitalStoreId: String(row.digital_store_id),
      storeLocationId: String(row.store_location_id),
      environment: String(row.environment) as ProvisioningPopExpectation["environment"],
      storeHubDeviceId: String(row.store_hub_device_id),
      terminalDeviceId: String(row.terminal_device_id),
      terminalAssignmentId: String(row.terminal_assignment_id),
      terminalProfileKey: String(row.terminal_profile_key),
      provisioningCodeId: String(row.provisioning_code_id),
      enrolledKeyFingerprint: String(row.terminal_key_fingerprint),
      enrollmentState: String(row.enrollment_state),
    };
  }

  async function challengeRow(challengeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, verified_at, consumed_at, attested_signature_verified,
              attested_challenge_hash, attested_key_fingerprint, nonce, expires_at,
              created_at, provisioning_code_id
         from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
      [challengeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function codeState(codeId: string): Promise<string> {
    const { rows } = await keeper.query<{ state: string }>(
      `select state::text from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return rows[0]?.state ?? "missing";
  }

  /** The full happy path up to a signed, service-verified attestation input. */
  async function verifiedAttestation(
    station: Station,
    label: string,
    issueKey: string,
  ): Promise<{
    challenge: ProvisioningPopChallenge;
    hash: string;
    code: { id: string; raw: string };
  }> {
    const code = await issueCode(station.assignmentId, issueKey);
    const issued = await issueChallenge(station.assignmentId);
    expect(issued.outcome, `challenge for ${issueKey}`).toBe("POP_CHALLENGE_ISSUED");
    const challenge = challengeFromDoor(issued);
    const signature = signChallenge(station, label, challenge);
    const expectation = await expectationFromRow(challenge.challengeId);
    const trusted: TrustedTimeEvaluation = {
      status: "trusted",
      trustedTime: new Date(challenge.issuedAt.getTime() + 1000),
    } as TrustedTimeEvaluation;
    const verdict = verifyProvisioningPop(
      challenge,
      signature,
      station.pem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    expect(
      verdict.verified,
      `service verification for ${issueKey}: ${verdict.refusalCode ?? ""}`,
    ).toBe(true);
    return { challenge, hash: String(verdict.challengeHash), code };
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'pop-foundation-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    // Race E requires this suite to OWN every projection at its scope: fail
    // loudly on pollution rather than binding a challenge to a stale Hub.
    const { rows: preExisting } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(preExisting[0]?.n), "LOCATION_E must start with zero projections").toBe(0);

    const hubStation = await enrollWithRealKey("WS11-POP-HUB");
    hub = hubStation.id;
    await claimAndRedeem(hub);
    await activateHub(hub, `SERIAL-POP-HUB-${RUN}-${randomUUID()}`);
    const hubE1Station = await enrollWithRealKey("WS11-POP-HUBE1");
    hubE1 = hubE1Station.id;
    await claimAndRedeem(hubE1, LOCATION_E);
    await activateHub(hubE1, `SERIAL-POP-HUBE1-${RUN}-${randomUUID()}`);
    const hubE2Station = await enrollWithRealKey("WS11-POP-HUBE2");
    hubE2 = hubE2Station.id;
    await claimAndRedeem(hubE2, LOCATION_E);

    for (const key of [
      "s1",
      "s2",
      "s3",
      "ra",
      "rb",
      "rc",
      "rd1",
      "rd2",
      "rd3",
      "h1",
      "h2",
      "e1",
      "e2",
    ]) {
      const location = key.startsWith("e") ? LOCATION_E : LOCATION;
      stations[key] = await newStation(`WS11-POP-${key.toUpperCase()}`, location);
    }

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `pop-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `pop fixture ${RUN}`, REVOKE_PERMISSION],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`pop fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("success: real key, real signature, one verified single-use proof; the code never moves", async () => {
    const station = stations.s1;
    const { challenge, hash, code } = await verifiedAttestation(
      station,
      "WS11-POP-S1",
      `pop-s1-issue-${RUN}`,
    );

    // The challenge is exactly bound: expiry inherits the CODE's expiry.
    const row = await challengeRow(challenge.challengeId);
    expect(String(row.state)).toBe("issued");
    expect(String(row.nonce)).toMatch(/^[0-9a-f]{64}$/);
    // Precision-safe: the stored challenge expiry must EQUAL the stored code
    // expiry (a JS Date round-trip truncates microseconds).
    const { rows: inherit } = await keeper.query<{ same: boolean }>(
      `select c.expires_at = p.expires_at as same
         from kitluy_devices.device_provisioning_pop_challenges c
         join kitluy_devices.device_provisioning_codes p on p.id = c.provisioning_code_id
        where c.id = $1::uuid`,
      [challenge.challengeId],
    );
    expect(inherit[0]?.same, "challenge expiry = code expiry, exactly").toBe(true);
    expect(hash).toBe(provisioningChallengeHash(challenge));

    const recorded = await recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
    );
    expect(recorded.error).toBeNull();
    expect(recorded.result.outcome).toBe("POP_VERIFIED");
    expect(recorded.result.consumed, "single-use ready, not consumed").toBe(false);
    expect(recorded.result.provisioning_code_id).toBe(code.id);
    expect(String(recorded.result.detail)).toContain("NON-AUTHORITATIVE");

    const after = await challengeRow(challenge.challengeId);
    expect(String(after.state)).toBe("verified");
    expect(after.attested_signature_verified).toBe(true);
    expect(String(after.attested_challenge_hash)).toBe(hash);
    expect(after.consumed_at).toBeNull();

    // NOTHING moved on the provisioning code: no transition, no new event.
    expect(await codeState(code.id), "the code remains ISSUED").toBe("issued");
    const { rows: events } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid`,
      [code.id],
    );
    expect(Number(events[0]?.n), "only the original CREATED event").toBe(1);

    // Identical replay: the stable reconciliation, no second transition.
    const replay = await recordVerification(challenge.challengeId, true, hash, station.fingerprint);
    expect(replay.result.outcome).toBe("POP_ALREADY_VERIFIED");
    expect(replay.result.replay).toBe(true);
    const afterReplay = await challengeRow(challenge.challengeId);
    expect(String(afterReplay.verified_at)).toBe(String(after.verified_at));

    // One proof per code, ever: a fresh challenge for the SAME code refuses.
    const again = await issueChallenge(station.assignmentId);
    expect(again.outcome).toBe("POP_CHALLENGE_REFUSED");
    expect(again.refusal_code).toBe("KLUY-PROVPOP-CODE-ALREADY-PROVEN");
  }, 60_000);

  it("challenge refusals: missing assignment, no outstanding code, expired code, already proven — zero residue", async () => {
    const nullAssignment = await issueChallenge(null);
    expect(nullAssignment.refusal_code).toBe("KLUY-PROVPOP-NO-ASSIGNMENT");
    const missing = await issueChallenge(randomUUID());
    expect(missing.refusal_code).toBe("KLUY-PROVPOP-ASSIGNMENT-MISSING");

    const station = stations.s2;
    const noCode = await issueChallenge(station.assignmentId);
    expect(noCode.refusal_code, "no outstanding code yet").toBe("KLUY-PROVPOP-NO-OUTSTANDING-CODE");

    // Expired code: the challenge door judges the code on the authoritative
    // clock at issue.
    const code = await issueCode(station.assignmentId, `pop-s2-issue-${RUN}`);
    const pastExpiry = new Date(new Date(code.expiresAt).getTime() + 1000).toISOString();
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [pastExpiry]);
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid) as result`,
        [station.assignmentId],
      );
      await client.query("commit");
      expect(rows[0]?.result.refusal_code).toBe("KLUY-PROVPOP-CODE-EXPIRED");
    } finally {
      client.release();
    }

    const { rows: residue } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_pop_challenges
        where terminal_assignment_id = $1::uuid`,
      [station.assignmentId],
    );
    expect(Number(residue[0]?.n), "no refusal left a challenge row").toBe(0);
    expect(await codeState(code.id), "the code is untouched (never expired by this door)").toBe(
      "issued",
    );

    // Inactive assignment (closed through the governed 0121 door): the
    // challenge door refuses before any code or enrollment is read.
    const s3 = stations.s3;
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'POP-FIXTURE-INACTIVE', 'OP-POP')`,
      [s3.terminalId],
    );
    const inactive = await issueChallenge(s3.assignmentId);
    expect(inactive.refusal_code).toBe("KLUY-PROVPOP-ASSIGNMENT-INACTIVE");
  }, 60_000);

  it("verification refusals: rejected attestation, wrong key, malformed inputs, boundary expiry — zero residue", async () => {
    const station = stations.rc;
    const { challenge, hash } = await verifiedAttestation(
      station,
      "WS11-POP-RC",
      `pop-rc-issue-${RUN}`,
    );

    const missing = await recordVerification(randomUUID(), true, hash, station.fingerprint);
    expect(missing.result.refusal_code).toBe("KLUY-PROVPOP-CHALLENGE-NOT-FOUND");
    const nullId = await recordVerification(null, true, hash, station.fingerprint);
    expect(nullId.result.refusal_code).toBe("KLUY-PROVPOP-NO-CHALLENGE");
    const badHash = await recordVerification(
      challenge.challengeId,
      true,
      "zz",
      station.fingerprint,
    );
    expect(badHash.result.refusal_code).toBe("KLUY-PROVPOP-MALFORMED-ATTESTATION");
    const badFp = await recordVerification(challenge.challengeId, true, hash, "not-hex");
    expect(badFp.result.refusal_code).toBe("KLUY-PROVPOP-MALFORMED-ATTESTATION");

    // A rejected service verification records NOTHING — no false proof.
    const rejected = await recordVerification(
      challenge.challengeId,
      false,
      hash,
      station.fingerprint,
    );
    expect(rejected.result.refusal_code).toBe("KLUY-PROVPOP-SIGNATURE-REJECTED");
    // An attestation for a key that is not the bound enrolled key refuses.
    const wrongKey = await recordVerification(challenge.challengeId, true, hash, "a".repeat(64));
    expect(wrongKey.result.refusal_code).toBe("KLUY-PROVPOP-KEY-MISMATCH");

    let row = await challengeRow(challenge.challengeId);
    expect(String(row.state), "every refusal left the challenge issued").toBe("issued");
    expect(row.attested_signature_verified, "no attestation residue").toBeNull();

    // The EXACT expiry boundary refuses (the 0166 equality rule), with the
    // microsecond-precise stored timestamp — never a JS Date round trip.
    const { rows: boundaryRows } = await keeper.query<{ e: string }>(
      `select expires_at::text as e from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
      [challenge.challengeId],
    );
    const atBoundary = await recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
      String(boundaryRows[0]?.e),
    );
    expect(atBoundary.result.refusal_code).toBe("KLUY-PROVPOP-CHALLENGE-EXPIRED");
    row = await challengeRow(challenge.challengeId);
    expect(String(row.state), "expiry refusal mutates nothing").toBe("issued");
  }, 60_000);

  it("hostile service-side verification: the wrong signatures never verify (real crypto, wrong contexts)", async () => {
    const station = stations.h1;
    const other = stations.h2;
    await issueCode(station.assignmentId, `pop-h1-issue-${RUN}`);
    const issued = await issueChallenge(station.assignmentId);
    expect(issued.outcome).toBe("POP_CHALLENGE_ISSUED");
    const challenge = challengeFromDoor(issued);
    const expectation = await expectationFromRow(challenge.challengeId);
    const trusted: TrustedTimeEvaluation = {
      status: "trusted",
      trustedTime: new Date(challenge.issuedAt.getTime() + 1000),
    } as TrustedTimeEvaluation;

    // Another terminal's genuine key signs the same canonical bytes.
    const forged = signChallenge(other, "WS11-POP-H2", challenge);
    const forgedVerdict = verifyProvisioningPop(
      challenge,
      forged,
      station.pem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    expect(forgedVerdict.refusalCode).toBe("POP_SIGNATURE_INVALID");

    // The other terminal presents its OWN pem: the fingerprint gate refuses
    // before any signature check.
    const substituted = verifyProvisioningPop(
      challenge,
      forged,
      other.pem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    expect(substituted.refusalCode).toBe("POP_FINGERPRINT_MISMATCH");

    // A valid signature over ALTERED bytes (nonce swap) never verifies.
    const genuine = signChallenge(station, "WS11-POP-H1", challenge);
    const altered = verifyProvisioningPop(
      { ...challenge, nonce: "0".repeat(64) },
      genuine,
      station.pem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    expect(altered.refusalCode).toBe("POP_SIGNATURE_INVALID");

    // No cross-purpose acceptance: the purpose is pinned by the module.
    expect(challenge.purpose).toBe(PROVISIONING_POP_PURPOSE);
  }, 60_000);

  it("race A: two identical attestations — one POP_VERIFIED, one stable replay, one transition", async () => {
    const station = stations.ra;
    const { challenge, hash } = await verifiedAttestation(
      station,
      "WS11-POP-RA",
      `pop-ra-issue-${RUN}`,
    );
    const r1p = recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
      undefined,
      barrier(0),
    );
    const r2p = recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
      undefined,
      barrier(STAGGER_MS),
    );
    const [r1, r2] = await Promise.all([r1p, r2p]);
    console.log(`race A backends: pid1=${r1.pid}, pid2=${r2.pid}`);
    expect(r1.pid).not.toBe(r2.pid);
    expectNoUncontrolled(r1, r2);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["POP_ALREADY_VERIFIED", "POP_VERIFIED"]);
    const row = await challengeRow(challenge.challengeId);
    expect(String(row.state)).toBe("verified");
    const { rows: verifiedCount } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_pop_challenges
        where provisioning_code_id = $1::uuid and state = 'verified'`,
      [String(row.provisioning_code_id)],
    );
    expect(Number(verifiedCount[0]?.n), "exactly one verification").toBe(1);
  }, 60_000);

  it("race B: valid versus rejected attestation — success stands, rejection never overwrites", async () => {
    const station = stations.rb;
    const { challenge, hash } = await verifiedAttestation(
      station,
      "WS11-POP-RB",
      `pop-rb-issue-${RUN}`,
    );
    const valid = recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
      undefined,
      barrier(0),
    );
    const invalid = recordVerification(
      challenge.challengeId,
      false,
      hash,
      station.fingerprint,
      undefined,
      barrier(STAGGER_MS),
    );
    const [rValid, rInvalid] = await Promise.all([valid, invalid]);
    console.log(`race B backends: valid pid=${rValid.pid}, invalid pid=${rInvalid.pid}`);
    expect(rValid.pid).not.toBe(rInvalid.pid);
    expectNoUncontrolled(rValid, rInvalid);
    expect(rValid.result.outcome).toBe("POP_VERIFIED");
    // The rejected attestation meets an already-verified challenge: the
    // stable reconciliation, never a reversal, never a stored failure.
    expect(rInvalid.result.outcome).toBe("POP_ALREADY_VERIFIED");
    const row = await challengeRow(challenge.challengeId);
    expect(String(row.state), "success is never reversed").toBe("verified");
    expect(row.attested_signature_verified).toBe(true);
  }, 60_000);

  it("race C: verification versus canonical code expiry at the exact boundary — no proof after expiry", async () => {
    const station = stations.rd1;
    const { challenge, hash, code } = await verifiedAttestation(
      station,
      "WS11-POP-RD1",
      `pop-rd1-issue-${RUN}`,
    );
    const { rows: boundaryRows } = await keeper.query<{ e: string }>(
      `select expires_at::text as e from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [code.id],
    );
    const boundary = String(boundaryRows[0]?.e);
    const record = recordVerification(
      challenge.challengeId,
      true,
      hash,
      station.fingerprint,
      boundary,
      barrier(0),
    );
    const expire = (async () => {
      const client = await keeper.connect();
      try {
        const { rows: pidRows } = await client.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        await client.query("begin");
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [boundary]);
        await barrier(STAGGER_MS);
        const { rows } = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.expire_terminal_provisioning_code_v1($1::uuid, gen_random_uuid(), 'TEST_HARNESS') as result`,
          [code.id],
        );
        await client.query("commit");
        return {
          pid: pidRows[0]?.pid ?? 0,
          result: rows[0]?.result ?? {},
          error: null,
          sqlstate: null,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return {
          pid: 0,
          result: {},
          error: error instanceof Error ? error.message : String(error),
          sqlstate: (error as { code?: string }).code ?? null,
        };
      } finally {
        client.release();
      }
    })();
    const [rRecord, rExpire] = await Promise.all([record, expire]);
    console.log(`race C backends: verification pid=${rRecord.pid}, expiration pid=${rExpire.pid}`);
    expect(rRecord.pid).not.toBe(rExpire.pid);
    expectNoUncontrolled(rRecord, rExpire);
    expect(rRecord.result.outcome).toBe("POP_VERIFICATION_REFUSED");
    expect(rRecord.result.refusal_code, "at the boundary the challenge is expired").toBe(
      "KLUY-PROVPOP-CHALLENGE-EXPIRED",
    );
    expect(rExpire.result.outcome).toBe("EXPIRED");
    const row = await challengeRow(challenge.challengeId);
    expect(String(row.state), "no verification exists after expiry").toBe("issued");
    expect(await codeState(code.id)).toBe("expired");
  }, 60_000);

  it("race D: verification versus governed revocation — both orders governed, proof never reverses revocation", async () => {
    // Revocation first: the verification fails with the stable classification.
    const s1 = stations.rd2;
    const first = await verifiedAttestation(s1, "WS11-POP-RD2", `pop-rd2-issue-${RUN}`);
    const revokeFirst = await (async () => {
      const client = await keeper.connect();
      try {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role: "authenticated" }),
        ]);
        await client.query("set local role authenticated");
        const { rows } = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
          [first.code.id, `pop-rd2-revoke-${RUN}`, "pop race audit revocation"],
        );
        await client.query("commit");
        return rows[0]?.result ?? {};
      } finally {
        client.release();
      }
    })();
    expect(revokeFirst.outcome).toBe("REVOKED");
    const afterRevoke = await recordVerification(
      first.challenge.challengeId,
      true,
      first.hash,
      s1.fingerprint,
    );
    expect(afterRevoke.result.refusal_code).toBe("KLUY-PROVPOP-CODE-ALREADY-REVOKED");
    expect(String((await challengeRow(first.challenge.challengeId)).state)).toBe("issued");

    // Verification first: the proof records, revocation then commits, and the
    // proof row is NEVER reversed — it is simply non-authoritative for B3B.
    const s2 = stations.rd3;
    const second = await verifiedAttestation(s2, "WS11-POP-RD3", `pop-rd3-issue-${RUN}`);
    const verified = await recordVerification(
      second.challenge.challengeId,
      true,
      second.hash,
      s2.fingerprint,
    );
    expect(verified.result.outcome).toBe("POP_VERIFIED");
    const revokeAfter = await (async () => {
      const client = await keeper.connect();
      try {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role: "authenticated" }),
        ]);
        await client.query("set local role authenticated");
        const { rows } = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
          [second.code.id, `pop-s2b-revoke-${RUN}`, "pop race audit revocation"],
        );
        await client.query("commit");
        return rows[0]?.result ?? {};
      } finally {
        client.release();
      }
    })();
    expect(revokeAfter.outcome, "revocation is never blocked by a proof").toBe("REVOKED");
    const row = await challengeRow(second.challenge.challengeId);
    expect(String(row.state), "the proof row stands (non-authoritative)").toBe("verified");
    expect(await codeState(second.code.id), "the code is REVOKED regardless").toBe("revoked");
  }, 60_000);

  it("race E: verification versus governed Hub withdrawal — stale Hub authority never verifies", async () => {
    // Verification first, withdrawal second: proof stands, future work fails.
    const s1 = stations.e1;
    const first = await verifiedAttestation(s1, "WS11-POP-E1", `pop-e1-issue-${RUN}`);
    const verify1 = recordVerification(
      first.challenge.challengeId,
      true,
      first.hash,
      s1.fingerprint,
      undefined,
      barrier(0),
    );
    const hubDown = (async () => {
      const client = await keeper.connect();
      try {
        const { rows: pidRows } = await client.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        await client.query("begin");
        await barrier(STAGGER_MS);
        await client.query(
          `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'POP-HUB-TRANSITION', 'OP-POP')`,
          [hubE1],
        );
        await client.query("commit");
        return {
          pid: pidRows[0]?.pid ?? 0,
          result: { outcome: "ASSIGNMENT_REVOKED" },
          error: null,
          sqlstate: null,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return {
          pid: 0,
          result: {},
          error: error instanceof Error ? error.message : String(error),
          sqlstate: (error as { code?: string }).code ?? null,
        };
      } finally {
        client.release();
      }
    })();
    const [rVerify, rHub] = await Promise.all([verify1, hubDown]);
    console.log(
      `race E1 backends: verification pid=${rVerify.pid}, hub-transition pid=${rHub.pid}`,
    );
    expect(rVerify.pid).not.toBe(rHub.pid);
    expectNoUncontrolled(rVerify, rHub);
    expect(rVerify.result.outcome, "verification committed while the Hub was projected").toBe(
      "POP_VERIFIED",
    );
    expect(rHub.result.outcome).toBe("ASSIGNMENT_REVOKED");
    expect(
      String((await challengeRow(first.challenge.challengeId)).state),
      "the proof stands, non-authoritative",
    ).toBe("verified");

    // Withdrawal first: verification fails closed against the BOUND Hub.
    await activateHub(hubE2, `SERIAL-POP-HUBE2-${RUN}-${randomUUID()}`);
    const s2 = stations.e2;
    const second = await verifiedAttestation(s2, "WS11-POP-E2", `pop-e2-issue-${RUN}`);
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'POP-HUB-TRANSITION', 'OP-POP')`,
      [hubE2],
    );
    const refused = await recordVerification(
      second.challenge.challengeId,
      true,
      second.hash,
      s2.fingerprint,
    );
    expect(refused.result.outcome).toBe("POP_VERIFICATION_REFUSED");
    expect(refused.result.refusal_code).toBe("KLUY-PROVPOP-HUB-INACTIVE");
    expect(String((await challengeRow(second.challenge.challengeId)).state), "zero residue").toBe(
      "issued",
    );
    expect(await codeState(second.code.id), "the code is untouched").toBe("issued");
  }, 60_000);

  it("security: doors harness-only, table unreachable, no raw material anywhere", async () => {
    const deniedAsRole = async (role: string, probe: string): Promise<void> => {
      const client = await keeper.connect();
      try {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role }),
        ]);
        await client.query(`set local role ${role}`);
        await expect(client.query(probe), `${role}: ${probe}`).rejects.toMatchObject({
          code: "42501",
        });
        await client.query("rollback");
      } finally {
        client.release();
      }
    };
    // `service_role` left this denial set at WS-11-T004-P02C: group 0172
    // grants it the NOLOGIN kitluy_provisioning_service by membership, which
    // is the INTENDED composition path (and the only one — it holds no direct
    // grant on any door, asserted by migration 0172 and WS11-N19). The
    // denials that still matter are the human-facing runtime identities.
    for (const role of ["anon", "authenticated"]) {
      await deniedAsRole(
        role,
        `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(gen_random_uuid())`,
      );
      await deniedAsRole(
        role,
        `select kitluy_devices.record_terminal_provisioning_pop_verification_v1(gen_random_uuid(), true, '${"a".repeat(64)}', '${"b".repeat(64)}')`,
      );
      await deniedAsRole(
        role,
        `select id from kitluy_devices.device_provisioning_pop_challenges limit 1`,
      );
    }
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_pop_challenges set state = 'verified' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `insert into kitluy_devices.device_provisioning_pop_challenges
         (tenant_id, digital_store_id, store_location_id, environment, store_hub_device_id,
          terminal_device_id, terminal_assignment_id, terminal_profile_key, provisioning_code_id,
          terminal_enrollment_id, terminal_key_fingerprint, nonce, created_at, expires_at, correlation_id)
       values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'development',
               gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'laundry.t1.cashier',
               gen_random_uuid(), gen_random_uuid(), '${"c".repeat(64)}', '${"d".repeat(64)}',
               now(), now() + interval '1 minute', gen_random_uuid())`,
    );

    // Raw-material census: no raw provisioning code appears in any challenge
    // row (nonce, hash or fingerprint columns), and no signature is stored.
    expect(rawCodes.length).toBeGreaterThan(0);
    for (const raw of rawCodes) {
      const { rows } = await keeper.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_provisioning_pop_challenges
          where nonce = $1 or attested_challenge_hash = $1 or terminal_key_fingerprint = $1
             or attested_key_fingerprint = $1`,
        [raw],
      );
      expect(Number(rows[0]?.n), `raw code ${raw} leaked into a challenge row`).toBe(0);
    }
    const { rows: cols } = await keeper.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_pop_challenges'
          and (column_name ~ '(^|_)(code|raw|plain|secret|private)(_|$)' and column_name <> 'provisioning_code_id')`,
    );
    expect(cols.length, "no raw-code or private-key capable column").toBe(0);

    // No login-capable governor membership.
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n)).toBe(0);
  }, 60_000);
});
