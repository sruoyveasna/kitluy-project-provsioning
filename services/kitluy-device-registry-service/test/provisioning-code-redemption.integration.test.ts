/**
 * ATOMIC PoP-BOUND REDEMPTION AND CREDENTIAL BINDING.
 *
 * WS-11-T004-P02B3B. Proves the 0171 redemption door end to end: BOTH
 * possessions (raw code re-verified against the stored digest; one VERIFIED
 * unconsumed 0170 proof from a REAL Ed25519 key) revalidated under
 * DEVICE→ASSIGNMENT→CODE→CHALLENGE locks, then — in ONE transaction — the
 * certificate is selected-and-bound or synchronously issued through the
 * BLK-005-gated `issue_device_certificate_v1`, the proof is CONSUMED, the
 * code is REDEEMED with frozen references, and the one REDEEMED event is
 * appended. Any failure leaves everything unchanged.
 *
 *   Success   — ISSUED credential action; code REDEEMED + proof CONSUMED +
 *               one active certificate + one REDEEMED event, atomically
 *   Bind      — a second provisioning cycle on the same terminal BINDS the
 *               existing active certificate; never a second credential
 *   Replay    — identical ALREADY_REDEEMED; conflicting fails closed;
 *               different key after success gets the stable classification
 *   Refusals  — wrong/malformed code (no attempt increment), unverified or
 *               foreign proof, revoked/expired code at the exact boundary,
 *               no trusted time, credential conflict, inactive Hub — all
 *               with zero residue
 *   Rollback  — a fault at the certificate INSERT refuses with nothing
 *               mutated; a fault at the REDEEMED-event INSERT aborts the
 *               WHOLE transaction including the certificate
 *   Races     — A identical redemptions; B different keys — separate
 *               backends, recorded PIDs
 *   Security  — door harness-only; redemption columns immutable; no raw
 *               code, digest or private key anywhere
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  provisioningChallengeBytes,
  verifyProvisioningPop,
  type ProvisioningPopChallenge,
  type ProvisioningPopExpectation,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
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
if (!live) console.warn("SKIPPED: atomic redemption — local database unreachable");

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

interface ProvisionedProof {
  challengeId: string;
  codeId: string;
  raw: string;
}

const keys = new DevelopmentDeviceKeyProvider();
const rawCodes: string[] = [];

describe.skipIf(!live)("atomic PoP-bound redemption (0171)", () => {
  let keeper: pg.Pool;
  let operator = "";
  let hubE = "";
  const stations: Record<string, Station> = {};

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-RED')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-RED')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RED')`,
      [hubId, serial, "f7".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  async function newStation(
    label: string,
    location: string = LOCATION,
    establishTrust = true,
  ): Promise<Station> {
    const keyRef = `${label}-key-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RED', 'OP-RED', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `bb:aa:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    const terminalId = enrolled[0]?.id ?? "";
    await claimAndRedeem(terminalId, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RED') as id`,
      [terminalId, location],
    );
    // Trusted time: the terminal establishes it during provisioning
    // (protocol §7 — connect to internet, then prove the key). The nt
    // station deliberately never does, to prove the fail-closed gate.
    if (establishTrust) {
      await keeper.query(
        `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
        [terminalId],
      );
    }
    return { assignmentId: rows[0]?.id ?? "", terminalId, pem, fingerprint };
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

  /** Issue code -> challenge -> real signature -> service verify -> attest. */
  async function verifiedProof(
    station: Station,
    label: string,
    issueKey: string,
  ): Promise<ProvisionedProof> {
    const code = await issueCode(station.assignmentId, issueKey);
    const { rows: chalRows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid) as result`,
      [station.assignmentId],
    );
    const issued = chalRows[0]?.result ?? {};
    expect(issued.outcome, `challenge for ${issueKey}`).toBe("POP_CHALLENGE_ISSUED");
    const challenge: ProvisioningPopChallenge = {
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
    const signature = keys.provePossession(
      `${label}-key-${RUN}`,
      provisioningChallengeBytes(challenge),
    );
    const expectation: ProvisioningPopExpectation = {
      challengeId: challenge.challengeId,
      purpose: challenge.purpose,
      tenantId: challenge.tenantId,
      digitalStoreId: challenge.digitalStoreId,
      storeLocationId: challenge.storeLocationId,
      environment: challenge.environment,
      storeHubDeviceId: challenge.storeHubDeviceId,
      terminalDeviceId: challenge.terminalDeviceId,
      terminalAssignmentId: challenge.terminalAssignmentId,
      terminalProfileKey: challenge.terminalProfileKey,
      provisioningCodeId: challenge.provisioningCodeId,
      enrolledKeyFingerprint: station.fingerprint,
      enrollmentState: "sealed",
    };
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
    const { rows: attRows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.record_terminal_provisioning_pop_verification_v1($1::uuid, true, $2, $3) as result`,
      [challenge.challengeId, verdict.challengeHash, station.fingerprint],
    );
    expect(attRows[0]?.result.outcome, `attestation for ${issueKey}`).toBe("POP_VERIFIED");
    return { challengeId: challenge.challengeId, codeId: code.id, raw: code.raw };
  }

  /** The redemption door as the harness, optionally clocked, optionally racing. */
  async function redeem(
    assignmentId: string | null,
    presented: string,
    challengeId: string | null,
    idempotencyKey: string,
    serial: string,
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
        `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5) as result`,
        [assignmentId, presented, challengeId, idempotencyKey, serial],
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

  async function codeRow(codeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, redeemed_at, failed_attempt_count, redemption_idempotency_key,
              redeemed_with_challenge_id, redeemed_certificate_id
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function challengeRow(challengeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, consumed_at from kitluy_devices.device_provisioning_pop_challenges
        where id = $1::uuid`,
      [challengeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function activeCerts(terminalId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await keeper.query(
      `select id, status::text, enrollment_id, public_key_fingerprint, certificate_serial
         from kitluy_devices.device_certificates
        where device_id = $1::uuid and environment = 'development' and status = 'active'`,
      [terminalId],
    );
    return rows as Array<Record<string, unknown>>;
  }

  async function redeemedEvents(codeId: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = 'REDEEMED'`,
      [codeId],
    );
    return Number(rows[0]?.n ?? -1);
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'redemption-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const hubKey = `WS11-RED-HUB-key-${RUN}`;
    await keys.generateDeviceKey(hubKey, "development");
    const hubPem = keys.publicKeyPem(hubKey) ?? "";
    const { rows: hubRows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RED', 'OP-RED', $4::jsonb) as id`,
      [
        `WS11-RED-HUB-${RUN}`,
        profileRows[0]?.id,
        publicKeyFingerprint(hubPem),
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `bb:aa:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    const hub = hubRows[0]?.id ?? "";
    await claimAndRedeem(hub);
    await activateHub(hub, `SERIAL-RED-HUB-${RUN}-${randomUUID()}`);

    // Race-E-style Hub scope: this suite owns LOCATION_E during its run.
    const { rows: pre } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(pre[0]?.n), "LOCATION_E must start with zero projections").toBe(0);
    const hubEKey = `WS11-RED-HUBE-key-${RUN}`;
    await keys.generateDeviceKey(hubEKey, "development");
    const hubEPem = keys.publicKeyPem(hubEKey) ?? "";
    const { rows: hubERows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RED', 'OP-RED', $4::jsonb) as id`,
      [
        `WS11-RED-HUBE-${RUN}`,
        profileRows[0]?.id,
        publicKeyFingerprint(hubEPem),
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `bb:aa:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    hubE = hubERows[0]?.id ?? "";
    await claimAndRedeem(hubE, LOCATION_E);
    await activateHub(hubE, `SERIAL-RED-HUBE-${RUN}-${randomUUID()}`);

    for (const key of ["s1", "s2", "rf", "rr", "rc", "ra", "rb", "fi", "he", "nt"]) {
      const location = key === "he" ? LOCATION_E : LOCATION;
      stations[key] = await newStation(`WS11-RED-${key.toUpperCase()}`, location, key !== "nt");
    }

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `red-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `redemption fixture ${RUN}`, REVOKE_PERMISSION],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [
        `redemption fixture ${RUN}`,
      ])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("success: both possessions redeem atomically — code REDEEMED, proof CONSUMED, one certificate ISSUED, one event", async () => {
    const station = stations.s1;
    const proof = await verifiedProof(station, "WS11-RED-S1", `red-s1-issue-${RUN}`);
    const serial = `SERIAL-RED-S1-${RUN}`;
    const r = await redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-s1-key-${RUN}`,
      serial,
    );
    expect(r.error).toBeNull();
    expect(r.result.outcome).toBe("REDEEMED");
    expect(r.result.credential_action, "first provisioning issues the credential").toBe("ISSUED");
    expect(r.result.certificate_serial).toBe(serial);
    expect(r.result.certificate_fingerprint, "the credential uses the ENROLLED key").toBe(
      station.fingerprint,
    );
    expect("code" in r.result, "no raw code in the result").toBe(false);

    const code = await codeRow(proof.codeId);
    expect(String(code.state)).toBe("redeemed");
    expect(code.redeemed_at).not.toBeNull();
    expect(String(code.redemption_idempotency_key)).toBe(`red-s1-key-${RUN}`);
    expect(String(code.redeemed_with_challenge_id)).toBe(proof.challengeId);
    expect(String(code.redeemed_certificate_id)).toBe(String(r.result.certificate_id));
    expect(code.failed_attempt_count, "attempts unchanged by redemption").toBe(0);

    const chal = await challengeRow(proof.challengeId);
    expect(String(chal.state)).toBe("consumed");
    expect(chal.consumed_at).not.toBeNull();

    const certs = await activeCerts(station.terminalId);
    expect(certs.length, "exactly one active certificate").toBe(1);
    expect(String(certs[0]?.public_key_fingerprint)).toBe(station.fingerprint);

    expect(await redeemedEvents(proof.codeId), "exactly one REDEEMED event").toBe(1);
    const { rows: leak } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where detail::text like '%' || $1 || '%'`,
      [proof.raw],
    );
    expect(Number(leak[0]?.n), "the raw code appears in no event").toBe(0);

    // Identical replay: stable, nothing repeated.
    const replay = await redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-s1-key-${RUN}`,
      serial,
    );
    expect(replay.result.outcome).toBe("ALREADY_REDEEMED");
    expect(replay.result.certificate_id).toBe(String(r.result.certificate_id));
    expect(await redeemedEvents(proof.codeId), "no duplicate event").toBe(1);

    // Conflicting replay: same key, different immutable input.
    const conflict = await redeem(
      station.assignmentId,
      proof.raw,
      randomUUID(),
      `red-s1-key-${RUN}`,
      serial,
    );
    expect(conflict.result.refusal_code).toBe("KLUY-REDEEM-CONFLICTING-REPLAY");

    // A different key after success: the stable terminal classification.
    const after = await redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-s1-late-${RUN}`,
      serial,
    );
    expect(after.result.refusal_code).toBe("KLUY-REDEEM-CODE-ALREADY-REDEEMED");
    expect((await activeCerts(station.terminalId)).length, "still one credential").toBe(1);
  }, 60_000);

  it("bind: a second provisioning cycle on the same terminal BINDS the existing credential", async () => {
    const station = stations.s1;
    // A fresh code and fresh verified proof for the SAME terminal.
    const proof = await verifiedProof(station, "WS11-RED-S1", `red-s1b-issue-${RUN}`);
    const before = await activeCerts(station.terminalId);
    expect(before.length).toBe(1);
    const r = await redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-s1b-key-${RUN}`,
      `SERIAL-UNUSED-${RUN}`,
    );
    expect(r.error).toBeNull();
    expect(r.result.outcome).toBe("REDEEMED");
    expect(
      r.result.credential_action,
      "the existing eligible credential is bound, not duplicated",
    ).toBe("BOUND");
    expect(String(r.result.certificate_id)).toBe(String(before[0]?.id));
    expect((await activeCerts(station.terminalId)).length, "never a second credential").toBe(1);
    expect(String((await codeRow(proof.codeId)).state)).toBe("redeemed");
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("consumed");
  }, 60_000);

  it("dual possession: the code alone and the proof alone both fail, with zero residue and no attempt increment", async () => {
    const station = stations.s2;
    // Proof NOT verified yet: issue code + challenge only.
    const code = await issueCode(station.assignmentId, `red-s2-issue-${RUN}`);
    const { rows: chalRows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid) as result`,
      [station.assignmentId],
    );
    const challengeId = String(chalRows[0]?.result.challenge_id);

    const noProof = await redeem(
      station.assignmentId,
      code.raw,
      challengeId,
      `red-s2-k1-${RUN}`,
      `SER-${RUN}-1`,
    );
    expect(noProof.result.refusal_code, "correct code without VERIFIED PoP fails").toBe(
      "KLUY-REDEEM-PROOF-NOT-VERIFIED",
    );

    // Verify the proof, then present the WRONG code value.
    const proof = await (async () => {
      // Re-drive the service verification for the already-issued challenge.
      const { rows } = await keeper.query(
        `select c.*, c.expires_at::text as expires_text, c.created_at::text as created_text
           from kitluy_devices.device_provisioning_pop_challenges c where c.id = $1::uuid`,
        [challengeId],
      );
      const row = rows[0] as Record<string, unknown>;
      const challenge: ProvisioningPopChallenge = {
        challengeId,
        purpose: String(row.purpose),
        tenantId: String(row.tenant_id),
        digitalStoreId: String(row.digital_store_id),
        storeLocationId: String(row.store_location_id),
        environment: String(row.environment) as ProvisioningPopChallenge["environment"],
        storeHubDeviceId: String(row.store_hub_device_id),
        terminalDeviceId: String(row.terminal_device_id),
        terminalAssignmentId: String(row.terminal_assignment_id),
        terminalProfileKey: String(row.terminal_profile_key),
        provisioningCodeId: String(row.provisioning_code_id),
        terminalKeyFingerprint: String(row.terminal_key_fingerprint),
        nonce: String(row.nonce),
        issuedAt: new Date(String(row.created_at)),
        expiresAt: new Date(String(row.expires_at)),
      };
      const signature = keys.provePossession(
        `WS11-RED-S2-key-${RUN}`,
        provisioningChallengeBytes(challenge),
      );
      const trusted: TrustedTimeEvaluation = {
        status: "trusted",
        trustedTime: new Date(challenge.issuedAt.getTime() + 1000),
      } as TrustedTimeEvaluation;
      const verdict = verifyProvisioningPop(
        challenge,
        signature,
        station.pem,
        {
          challengeId,
          purpose: challenge.purpose,
          tenantId: challenge.tenantId,
          digitalStoreId: challenge.digitalStoreId,
          storeLocationId: challenge.storeLocationId,
          environment: challenge.environment,
          storeHubDeviceId: challenge.storeHubDeviceId,
          terminalDeviceId: challenge.terminalDeviceId,
          terminalAssignmentId: challenge.terminalAssignmentId,
          terminalProfileKey: challenge.terminalProfileKey,
          provisioningCodeId: challenge.provisioningCodeId,
          enrolledKeyFingerprint: station.fingerprint,
          enrollmentState: "sealed",
        },
        trusted,
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(true);
      await keeper.query(
        `select kitluy_devices.record_terminal_provisioning_pop_verification_v1($1::uuid, true, $2, $3)`,
        [challengeId, verdict.challengeHash, station.fingerprint],
      );
      return challengeId;
    })();

    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const wrongCode = await redeem(
      station.assignmentId,
      wrong,
      proof,
      `red-s2-k2-${RUN}`,
      `SER-${RUN}-2`,
    );
    expect(wrongCode.result.refusal_code, "a valid proof without the correct code fails").toBe(
      "KLUY-REDEEM-CODE-MISMATCH",
    );
    const malformed = await redeem(
      station.assignmentId,
      "not-a-code",
      proof,
      `red-s2-k3-${RUN}`,
      `SER-${RUN}-3`,
    );
    expect(malformed.result.refusal_code).toBe("KLUY-REDEEM-CODE-MALFORMED");

    const codeAfter = await codeRow(code.id);
    expect(String(codeAfter.state), "every refusal left the code ISSUED").toBe("issued");
    expect(codeAfter.failed_attempt_count, "no attempt increment through the redemption door").toBe(
      0,
    );
    expect(String((await challengeRow(proof)).state), "the proof stays verified, unconsumed").toBe(
      "verified",
    );
    expect((await activeCerts(station.terminalId)).length, "no credential").toBe(0);
    expect(await redeemedEvents(code.id)).toBe(0);
  }, 60_000);

  it("refusals: revoked code, boundary-expired code, foreign proof, no trusted time — zero residue", async () => {
    // Revoked after verification (the D-shape from the PoP suite).
    const s = stations.rf;
    const proof = await verifiedProof(s, "WS11-RED-RF", `red-rf-issue-${RUN}`);
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
        [proof.codeId, `red-rf-revoke-${RUN}`, "redemption fixture revocation"],
      );
      await client.query("commit");
      expect(rows[0]?.result.outcome).toBe("REVOKED");
    } finally {
      client.release();
    }
    const revoked = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-rf-k1-${RUN}`,
      `SER-RF-${RUN}`,
    );
    expect(revoked.result.refusal_code).toBe("KLUY-REDEEM-CODE-ALREADY-REVOKED");
    expect(
      String((await challengeRow(proof.challengeId)).state),
      "the proof survives, unconsumed",
    ).toBe("verified");

    // Boundary expiry: at the exact stored microsecond, redemption refuses.
    const s2 = stations.rr;
    const proof2 = await verifiedProof(s2, "WS11-RED-RR", `red-rr-issue-${RUN}`);
    const { rows: boundaryRows } = await keeper.query<{ e: string }>(
      `select expires_at::text as e from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [proof2.codeId],
    );
    const atBoundary = await redeem(
      s2.assignmentId,
      proof2.raw,
      proof2.challengeId,
      `red-rr-k1-${RUN}`,
      `SER-RR-${RUN}`,
      String(boundaryRows[0]?.e),
    );
    expect(["KLUY-REDEEM-CODE-EXPIRED", "KLUY-REDEEM-PROOF-EXPIRED"]).toContain(
      String(atBoundary.result.refusal_code),
    );
    expect(
      String((await codeRow(proof2.codeId)).state),
      "the boundary refusal mutates nothing",
    ).toBe("issued");

    // A proof bound to another assignment fails closed.
    const foreign = await redeem(
      s.assignmentId,
      proof2.raw,
      proof2.challengeId,
      `red-rr-k2-${RUN}`,
      `SER-RR2-${RUN}`,
    );
    expect(foreign.result.refusal_code).toBe("KLUY-REDEEM-PROOF-WRONG-ASSIGNMENT");

    // No trusted time: the nt station NEVER established it (trusted-time
    // state is immutable, so absence is the only honest fixture).
    const ntProof = await verifiedProof(stations.nt, "WS11-RED-NT", `red-nt-issue-${RUN}`);
    const noTime = await redeem(
      stations.nt.assignmentId,
      ntProof.raw,
      ntProof.challengeId,
      `red-nt-k1-${RUN}`,
      `SER-NT-${RUN}`,
    );
    expect(noTime.result.refusal_code).toBe("KLUY-REDEEM-NO-TRUSTED-TIME");
    expect(String((await codeRow(ntProof.codeId)).state)).toBe("issued");
    expect(String((await challengeRow(ntProof.challengeId)).state)).toBe("verified");
    expect((await activeCerts(stations.nt.terminalId)).length).toBe(0);
  }, 60_000);

  it("refusals: credential conflict and inactive Hub — zero residue", async () => {
    // An active certificate under ANOTHER key blocks redemption politely.
    const s = stations.rc;
    const proof = await verifiedProof(s, "WS11-RED-RC", `red-rc-issue-${RUN}`);
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RED-CONFLICT')`,
      [s.terminalId, `SERIAL-CONFLICT-${RUN}`, "9".repeat(64)],
    );
    const conflict = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-rc-k1-${RUN}`,
      `SER-RC-${RUN}`,
    );
    expect(
      conflict.result.refusal_code,
      "a foreign-key active credential is a governed conflict",
    ).toBe("KLUY-REDEEM-CREDENTIAL-CONFLICT");
    expect(String((await codeRow(proof.codeId)).state)).toBe("issued");
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("verified");

    // Governed Hub withdrawal at the owned scope: redemption fails closed.
    const sHub = stations.he;
    const proofHub = await verifiedProof(sHub, "WS11-RED-HE", `red-he-issue-${RUN}`);
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RED-HUB-TRANSITION', 'OP-RED')`,
      [hubE],
    );
    const hubDown = await redeem(
      sHub.assignmentId,
      proofHub.raw,
      proofHub.challengeId,
      `red-he-k1-${RUN}`,
      `SER-HE-${RUN}`,
    );
    expect(hubDown.result.refusal_code).toBe("KLUY-REDEEM-HUB-INACTIVE");
    expect(String((await codeRow(proofHub.codeId)).state)).toBe("issued");
    expect(String((await challengeRow(proofHub.challengeId)).state)).toBe("verified");
    expect((await activeCerts(sHub.terminalId)).length).toBe(0);
  }, 60_000);

  it("rollback: a certificate fault refuses with zero mutations; an event fault aborts EVERYTHING including the certificate", async () => {
    const station = stations.fi;
    const proof = await verifiedProof(station, "WS11-RED-FI", `red-fi-issue-${RUN}`);
    const faultFn = `ws11_red_fault_${RUN}`;

    // Stage 1: fault the device_certificates INSERT (serial-keyed). The door
    // catches the credential failure BEFORE any mutation: stable refusal.
    const c1 = await keeper.connect();
    try {
      await c1.query("begin");
      // device_certificates is owned by the migration authority (0120), so
      // the fault trigger is installed directly — still transaction-local.
      await c1.query(
        `create function public.${faultFn}() returns trigger language plpgsql as $f$
           begin raise exception 'WS11-RED-FAULT' using errcode = 'KL920'; end $f$`,
      );
      await c1.query(
        `create trigger zz_ws11_red_fault before insert on kitluy_devices.device_certificates
           for each row when (new.certificate_serial = 'SER-FAULT-${RUN}')
           execute function public.${faultFn}()`,
      );
      const { rows } = await c1.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5) as result`,
        [
          station.assignmentId,
          proof.raw,
          proof.challengeId,
          `red-fi-k1-${RUN}`,
          `SER-FAULT-${RUN}`,
        ],
      );
      expect(rows[0]?.result.refusal_code, "the caught credential fault is a stable refusal").toBe(
        "KLUY-REDEEM-CREDENTIAL-REFUSED",
      );
    } finally {
      await c1.query("rollback").catch(() => undefined);
      c1.release();
    }
    expect(String((await codeRow(proof.codeId)).state), "stage 1: code untouched").toBe("issued");
    expect(String((await challengeRow(proof.challengeId)).state), "stage 1: proof untouched").toBe(
      "verified",
    );
    expect((await activeCerts(station.terminalId)).length, "stage 1: no certificate").toBe(0);

    // Stage 2: fault the REDEEMED-event INSERT — uncaught, so the WHOLE
    // transaction aborts, taking the freshly issued certificate with it.
    const c2 = await keeper.connect();
    try {
      await c2.query("begin");
      await c2.query("grant kitluy_activation_governor to postgres");
      await c2.query(
        `create function public.${faultFn}b() returns trigger language plpgsql as $f$
           begin raise exception 'WS11-RED-FAULT-B' using errcode = 'KL921'; end $f$`,
      );
      await c2.query(
        `grant execute on function public.${faultFn}b() to kitluy_activation_governor`,
      );
      await c2.query("set local role kitluy_activation_governor");
      await c2.query(
        `create trigger zz_ws11_red_fault_b before insert on kitluy_devices.device_provisioning_code_events
           for each row when (new.event_type = 'REDEEMED' and new.provisioning_code_id = '${proof.codeId}')
           execute function public.${faultFn}b()`,
      );
      await c2.query("reset role");
      await expect(
        c2.query(
          `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5)`,
          [
            station.assignmentId,
            proof.raw,
            proof.challengeId,
            `red-fi-k2-${RUN}`,
            `SER-FI2-${RUN}`,
          ],
        ),
      ).rejects.toMatchObject({ code: "KL921" });
    } finally {
      await c2.query("rollback").catch(() => undefined);
      c2.release();
    }
    expect(String((await codeRow(proof.codeId)).state), "stage 2: full abort — code ISSUED").toBe(
      "issued",
    );
    const after = await codeRow(proof.codeId);
    expect(after.redeemed_at ?? null).toBeNull();
    expect(after.redemption_idempotency_key ?? null, "no idempotency residue").toBeNull();
    expect(
      String((await challengeRow(proof.challengeId)).state),
      "proof VERIFIED, unconsumed",
    ).toBe("verified");
    expect((await activeCerts(station.terminalId)).length, "the certificate rolled back too").toBe(
      0,
    );
    expect(await redeemedEvents(proof.codeId)).toBe(0);
    const { rows: residue } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger where tgname like 'zz_ws11_red_fault%'`,
    );
    expect(Number(residue[0]?.n), "no fault mechanism survived").toBe(0);

    // The undamaged state then redeems cleanly.
    const clean = await redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-fi-k3-${RUN}`,
      `SER-FI3-${RUN}`,
    );
    expect(clean.error).toBeNull();
    expect(clean.result.outcome).toBe("REDEEMED");
  }, 60_000);

  it("race A: identical redemptions — one creator, one stable replay, one of everything", async () => {
    const station = stations.ra;
    const proof = await verifiedProof(station, "WS11-RED-RA", `red-ra-issue-${RUN}`);
    const key = `red-ra-key-${RUN}`;
    const serial = `SER-RA-${RUN}`;
    const r1p = redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      key,
      serial,
      undefined,
      barrier(0),
    );
    const r2p = redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      key,
      serial,
      undefined,
      barrier(STAGGER_MS),
    );
    const [r1, r2] = await Promise.all([r1p, r2p]);
    console.log(`race A backends: pid1=${r1.pid}, pid2=${r2.pid}`);
    expect(r1.pid).not.toBe(r2.pid);
    expect(r1.error, `no uncontrolled SQLSTATE (${r1.sqlstate ?? "n/a"})`).toBeNull();
    expect(r2.error, `no uncontrolled SQLSTATE (${r2.sqlstate ?? "n/a"})`).toBeNull();
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_REDEEMED", "REDEEMED"]);
    expect(String((await codeRow(proof.codeId)).state)).toBe("redeemed");
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("consumed");
    expect((await activeCerts(station.terminalId)).length, "one credential").toBe(1);
    expect(await redeemedEvents(proof.codeId), "one REDEEMED event").toBe(1);
  }, 60_000);

  it("race B: different redemption keys — one winner, loser gets the stable classification, one of everything", async () => {
    const station = stations.rb;
    const proof = await verifiedProof(station, "WS11-RED-RB", `red-rb-issue-${RUN}`);
    const serial = `SER-RB-${RUN}`;
    const r1p = redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-rb-k1-${RUN}`,
      serial,
      undefined,
      barrier(0),
    );
    const r2p = redeem(
      station.assignmentId,
      proof.raw,
      proof.challengeId,
      `red-rb-k2-${RUN}`,
      serial,
      undefined,
      barrier(STAGGER_MS),
    );
    const [r1, r2] = await Promise.all([r1p, r2p]);
    console.log(`race B backends: pid1=${r1.pid}, pid2=${r2.pid}`);
    expect(r1.pid).not.toBe(r2.pid);
    expect(r1.error, `no uncontrolled SQLSTATE (${r1.sqlstate ?? "n/a"})`).toBeNull();
    expect(r2.error, `no uncontrolled SQLSTATE (${r2.sqlstate ?? "n/a"})`).toBeNull();
    const winner = r1.result.outcome === "REDEEMED" ? r1 : r2;
    const loser = r1.result.outcome === "REDEEMED" ? r2 : r1;
    expect(winner.result.outcome).toBe("REDEEMED");
    expect(loser.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(loser.result.refusal_code, "the loser meets the redeemed code, stably").toBe(
      "KLUY-REDEEM-CODE-ALREADY-REDEEMED",
    );
    expect(String((await codeRow(proof.codeId)).state)).toBe("redeemed");
    expect(
      String((await challengeRow(proof.challengeId)).state),
      "the proof consumed exactly once",
    ).toBe("consumed");
    expect((await activeCerts(station.terminalId)).length, "one credential, never two").toBe(1);
    expect(await redeemedEvents(proof.codeId), "one REDEEMED event").toBe(1);
  }, 60_000);

  it("security: door harness-only; redemption bindings immutable; no raw material anywhere", async () => {
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
    // See the P02C note in the PoP suite: service_role reaches these doors
    // only through the 0172 composition membership, never a direct grant.
    for (const role of ["anon", "authenticated"]) {
      await deniedAsRole(
        role,
        `select kitluy_devices.redeem_terminal_provisioning_code_v1(gen_random_uuid(), 'AAAAAAAA', gen_random_uuid(), 'k', 's')`,
      );
    }
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_codes set redemption_idempotency_key = 'stolen' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_pop_challenges set state = 'consumed' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_certificates set status = 'revoked' where false`,
    );

    // The governed one-way machine: a consumed proof and a redeemed code
    // never reopen, even for the table-owning authority.
    const station = stations.ra;
    const { rows: redeemedRows } = await keeper.query<{ id: string; ch: string }>(
      `select id, redeemed_with_challenge_id as ch from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid and state = 'redeemed' limit 1`,
      [station.assignmentId],
    );
    const c = await keeper.connect();
    try {
      await c.query("begin");
      await c.query("grant kitluy_activation_governor to postgres");
      await c.query("set local role kitluy_activation_governor");
      await expect(
        c.query(
          `update kitluy_devices.device_provisioning_codes set state = 'issued' where id = $1::uuid`,
          [redeemedRows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await c.query("rollback");
      await c.query("begin");
      await c.query("grant kitluy_activation_governor to postgres");
      await c.query("set local role kitluy_activation_governor");
      await expect(
        c.query(
          `update kitluy_devices.device_provisioning_codes set redeemed_certificate_id = null where id = $1::uuid`,
          [redeemedRows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await c.query("rollback");
    } finally {
      c.release();
    }

    // Raw-material census: no raw code in any event, challenge or certificate.
    expect(rawCodes.length).toBeGreaterThan(0);
    for (const raw of rawCodes) {
      const { rows } = await keeper.query<{ n: string }>(
        `select (select count(*) from kitluy_devices.device_provisioning_code_events where detail::text like '%' || $1 || '%')
              + (select count(*) from kitluy_devices.device_certificates where certificate_serial = $1)
              as n`,
        [raw],
      );
      expect(Number(rows[0]?.n), `raw code ${raw} leaked`).toBe(0);
    }
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n)).toBe(0);
  }, 60_000);
});
