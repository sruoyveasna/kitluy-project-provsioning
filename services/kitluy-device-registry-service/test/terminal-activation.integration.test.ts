/**
 * TERMINAL ACTIVATION AND PROVISIONING COMPLETION.
 *
 * WS-11-T004-P03A. Drives the real TerminalActivationComposition against the
 * real database as the real machine identity (explicit `set local role
 * kitluy_provisioning_service` per transaction, the 0173 boundary), with real
 * in-memory Ed25519 terminal keys.
 *
 * The distinction under test: a terminal does NOT become active because the
 * cloud transaction succeeded. It becomes active only when it proves, under
 * its ENROLLED key, that it holds THIS credential — and even then the record
 * claims no Store Hub delivery, no pairing and no connectivity.
 *
 *   Success   — prepare creates one activation + one challenge; a valid
 *               acknowledgment activates once; timestamps authoritative
 *   Replay    — prepare replay reuses the outstanding challenge; completion
 *               replay is a pure lookup; conflicting key fails closed
 *   Refusals  — unredeemed code, wrong credential, expired/consumed
 *               challenge, forged signature, superseded enrollment, inactive
 *               Hub — each with zero residue
 *   Races     — A identical completion; B two preparations; C vs Hub
 *               withdrawal; D vs certificate revocation
 *   Rollback  — a fault after the challenge is consumed in-flight aborts
 *               everything
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  provisioningChallengeBytes,
  activationAckBytes,
  ACTIVATION_ACK_KIND,
  type ProvisioningPopChallenge,
  type ActivationAckChallenge,
} from "@kitluy/device-identity";

import {
  TerminalProvisioningComposition,
  TerminalActivationComposition,
  type SafeLogger,
} from "../src/provisioning-composition.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";

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
if (!live) console.warn("SKIPPED: terminal activation — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
  keyRef: string;
}

interface Provisioned {
  redemptionKey: string;
  certificateId: string;
}

const keys = new DevelopmentDeviceKeyProvider();
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };

describe.skipIf(!live)("terminal activation and provisioning completion (0174)", () => {
  let keeper: pg.Pool;
  let provisioning: TerminalProvisioningComposition;
  let activation: TerminalActivationComposition;
  let operator = "";
  let hubE = "";
  const stations: Record<string, Station> = {};

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-ACT')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-ACT')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-ACT')`,
      [hubId, serial, "e1".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  async function enrollDevice(label: string): Promise<Station & { id: string }> {
    const keyRef = `${label}-key-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-ACT', 'OP-ACT', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `77:66:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    const id = rows[0]?.id ?? "";
    return { id, assignmentId: "", terminalId: id, pem, fingerprint, keyRef };
  }

  async function newStation(label: string, location: string = LOCATION): Promise<Station> {
    const dev = await enrollDevice(label);
    await claimAndRedeem(dev.id, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-ACT') as id`,
      [dev.id, location],
    );
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [dev.id],
    );
    return { ...dev, assignmentId: rows[0]?.id ?? "" };
  }

  /** Full provisioning through redemption, so activation has a real input. */
  async function provision(station: Station, label: string, tag: string): Promise<Provisioned> {
    const client = await keeper.connect();
    let raw = "";
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [station.assignmentId, `act-${tag}-issue-${RUN}`],
      );
      await client.query("commit");
      expect(rows[0]?.result.outcome).toBe("ISSUED");
      raw = String(rows[0]?.result.code);
    } finally {
      client.release();
    }
    const challenge = await provisioning.presentCodeAndIssueChallenge({
      terminalAssignmentId: station.assignmentId,
      presentedCode: raw,
      terminalReference: station.terminalId,
    });
    expect(challenge.result, `challenge for ${tag}`).toBe("CHALLENGE_ISSUED");
    const challengeId = String(challenge.data?.challengeId);

    const { rows: cRows } = await keeper.query(
      `select c.*, c.created_at::text as created_text, c.expires_at::text as expires_text
         from kitluy_devices.device_provisioning_pop_challenges c where c.id = $1::uuid`,
      [challengeId],
    );
    const row = cRows[0] as Record<string, unknown>;
    const popChallenge: ProvisioningPopChallenge = {
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
      issuedAt: new Date(String(row.created_text)),
      expiresAt: new Date(String(row.expires_text)),
    };
    const sig = keys.provePossession(station.keyRef, provisioningChallengeBytes(popChallenge));
    const verified = await provisioning.verifyProofAndRecord({
      challengeId,
      signatureBase64: Buffer.from(sig).toString("base64"),
      terminalPublicKeyPem: station.pem,
    });
    expect(verified.result, `proof for ${tag}`).toBe("PROOF_VERIFIED");

    const redemptionKey = `act-${tag}-red-${RUN}`;
    const redeemed = await provisioning.redeemProvisioning({
      terminalAssignmentId: station.assignmentId,
      presentedCode: raw,
      challengeId,
      idempotencyKey: redemptionKey,
    });
    expect(redeemed.result, `redemption for ${tag}`).toBe("REDEEMED");
    return { redemptionKey, certificateId: String(redeemed.data?.certificateId) };
  }

  /** Signs the AUTHORITATIVE activation challenge, as a real terminal would. */
  async function signAck(station: Station, activationChallengeId: string): Promise<string> {
    const { rows } = await keeper.query<{ r: Record<string, unknown> }>(
      `select kitluy_devices.read_terminal_activation_challenge_context_v1($1::uuid) as r`,
      [activationChallengeId],
    );
    const ctx = rows[0]?.r ?? {};
    const challenge: ActivationAckChallenge = {
      activationChallengeId: String(ctx.activation_challenge_id),
      purpose: String(ctx.purpose),
      activationId: String(ctx.activation_id),
      tenantId: String(ctx.tenant_id),
      digitalStoreId: String(ctx.digital_store_id),
      storeLocationId: String(ctx.store_location_id),
      environment: String(ctx.environment) as ActivationAckChallenge["environment"],
      storeHubDeviceId: String(ctx.store_hub_device_id),
      terminalDeviceId: String(ctx.terminal_device_id),
      terminalAssignmentId: String(ctx.terminal_assignment_id),
      terminalProfileKey: String(ctx.terminal_profile_key),
      provisioningCodeId: String(ctx.provisioning_code_id),
      popChallengeId: String(ctx.pop_challenge_id),
      terminalKeyFingerprint: String(ctx.terminal_key_fingerprint),
      certificateId: String(ctx.certificate_id),
      certificateSerial: String(ctx.certificate_serial),
      certificateFingerprint: String(ctx.certificate_fingerprint),
      nonce: String(ctx.nonce),
      issuedAt: new Date(String(ctx.created_at)),
      expiresAt: new Date(String(ctx.expires_at)),
    };
    return Buffer.from(
      keys.provePossession(station.keyRef, activationAckBytes(challenge)),
    ).toString("base64");
  }

  async function activationRow(activationId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state, acknowledged_at, activated_at, activation_idempotency_key, certificate_id
         from kitluy_devices.device_terminal_provisioning_activations where id = $1::uuid`,
      [activationId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function ackRow(challengeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state, consumed_at from kitluy_devices.device_terminal_activation_challenges
        where id = $1::uuid`,
      [challengeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    provisioning = new TerminalProvisioningComposition(keeper, logger);
    activation = new TerminalActivationComposition(keeper, logger);
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'activation-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enrollDevice("WS11-ACT-HUB");
    await claimAndRedeem(hub.id);
    await activateHub(hub.id, `SERIAL-ACT-HUB-${RUN}-${randomUUID()}`);

    const { rows: pre } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(pre[0]?.n), "LOCATION_E must start with zero projections").toBe(0);
    const hubEDev = await enrollDevice("WS11-ACT-HUBE");
    hubE = hubEDev.id;
    await claimAndRedeem(hubE, LOCATION_E);
    await activateHub(hubE, `SERIAL-ACT-HUBE-${RUN}-${randomUUID()}`);

    for (const key of ["s1", "s2", "rf", "ra", "rb", "rd", "fi"]) {
      stations[key] = await newStation(`WS11-ACT-${key.toUpperCase()}`, LOCATION);
    }
    stations.rc = await newStation("WS11-ACT-RC", LOCATION_E);

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `act-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `act fixture ${RUN}`],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`act fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("success: redemption does NOT activate; only a signed acknowledgment does", async () => {
    const s = stations.s1;
    const p = await provision(s, "S1", "s1");

    // Redemption alone left NO activation and did not make the terminal active.
    const { rows: none } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_terminal_provisioning_activations
        where terminal_assignment_id = $1::uuid`,
      [s.assignmentId],
    );
    expect(Number(none[0]?.n), "redemption creates no activation record").toBe(0);

    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(prepared.result).toBe("ACTIVATION_PREPARED");
    const activationId = String(prepared.data?.activationId);
    const challengeId = String(prepared.data?.activationChallengeId);
    expect(prepared.data?.challengeVersion).toBe(ACTIVATION_ACK_KIND);
    expect(prepared.data?.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.data?.certificateId).toBe(p.certificateId);

    // Prepared is NOT activated.
    let row = await activationRow(activationId);
    expect(String(row.state), "prepared means ready_for_delivery, never active").toBe(
      "ready_for_delivery",
    );
    expect(row.activated_at).toBeNull();

    const signature = await signAck(s, challengeId);
    const activated = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-s1-key-${RUN}`,
    });
    expect(activated.result).toBe("ACTIVATED");
    expect(activated.data?.certificateId).toBe(p.certificateId);
    expect(activated.data?.terminalProfileKey, "the role stays assignment-derived").toBe(
      "laundry.t1.cashier",
    );
    const payload = JSON.stringify(activated);
    expect(payload.toLowerCase().includes("deliver"), "no delivery claim").toBe(false);
    expect(payload.toLowerCase().includes("pair"), "no pairing claim").toBe(false);

    row = await activationRow(activationId);
    expect(String(row.state)).toBe("activated");
    expect(row.activated_at).not.toBeNull();
    expect(row.acknowledged_at).not.toBeNull();
    expect(String((await ackRow(challengeId)).state)).toBe("consumed");

    // Replay: pure lookup, no duplicate work.
    const replay = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-s1-key-${RUN}`,
    });
    expect(replay.result).toBe("ALREADY_ACTIVATED");
    expect(new Date(String(replay.data?.activatedAt)).getTime()).toBe(
      new Date(String(activated.data?.activatedAt)).getTime(),
    );
    // Preparation replay after activation is also a stable lookup.
    const prepReplay = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(prepReplay.result).toBe("ALREADY_ACTIVATED");
  }, 90_000);

  it("preparation replay reuses the outstanding challenge; one activation lineage per redemption", async () => {
    const s = stations.s2;
    const p = await provision(s, "S2", "s2");
    const first = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const second = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(first.result).toBe("ACTIVATION_PREPARED");
    expect(second.result).toBe("ACTIVATION_PREPARED");
    expect(second.data?.activationId).toBe(first.data?.activationId);
    expect(second.data?.activationChallengeId, "the outstanding challenge is reused").toBe(
      first.data?.activationChallengeId,
    );
    const { rows } = await keeper.query<{ a: string; c: string }>(
      `select (select count(*)::text from kitluy_devices.device_terminal_provisioning_activations
                where terminal_assignment_id = $1::uuid) as a,
              (select count(*)::text from kitluy_devices.device_terminal_activation_challenges
                where activation_id = $2::uuid) as c`,
      [s.assignmentId, String(first.data?.activationId)],
    );
    expect(Number(rows[0]?.a), "one activation lineage").toBe(1);
    expect(Number(rows[0]?.c), "one challenge").toBe(1);
  }, 90_000);

  it("refusals: unredeemed provisioning, forged signature, wrong credential, superseded enrollment — zero residue", async () => {
    const s = stations.rf;
    // No redemption yet: preparation refuses.
    const noRedemption = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: `act-rf-missing-${RUN}`,
    });
    expect(noRedemption.result).toBe("REDEMPTION_REQUIRED");

    const p = await provision(s, "RF", "rf");
    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const challengeId = String(prepared.data?.activationChallengeId);
    const activationId = String(prepared.data?.activationId);

    // A forged acknowledgment (another terminal's genuine key).
    const other = stations.s1;
    const { rows } = await keeper.query<{ r: Record<string, unknown> }>(
      `select kitluy_devices.read_terminal_activation_challenge_context_v1($1::uuid) as r`,
      [challengeId],
    );
    const ctx = rows[0]?.r ?? {};
    const forged = keys.provePossession(
      other.keyRef,
      activationAckBytes({
        activationChallengeId: String(ctx.activation_challenge_id),
        purpose: String(ctx.purpose),
        activationId: String(ctx.activation_id),
        tenantId: String(ctx.tenant_id),
        digitalStoreId: String(ctx.digital_store_id),
        storeLocationId: String(ctx.store_location_id),
        environment: String(ctx.environment) as ActivationAckChallenge["environment"],
        storeHubDeviceId: String(ctx.store_hub_device_id),
        terminalDeviceId: String(ctx.terminal_device_id),
        terminalAssignmentId: String(ctx.terminal_assignment_id),
        terminalProfileKey: String(ctx.terminal_profile_key),
        provisioningCodeId: String(ctx.provisioning_code_id),
        popChallengeId: String(ctx.pop_challenge_id),
        terminalKeyFingerprint: String(ctx.terminal_key_fingerprint),
        certificateId: String(ctx.certificate_id),
        certificateSerial: String(ctx.certificate_serial),
        certificateFingerprint: String(ctx.certificate_fingerprint),
        nonce: String(ctx.nonce),
        issuedAt: new Date(String(ctx.created_at)),
        expiresAt: new Date(String(ctx.expires_at)),
      }),
    );
    const forgedResult = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: Buffer.from(forged).toString("base64"),
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-rf-forged-${RUN}`,
    });
    expect(forgedResult.result).toBe("ACTIVATION_ACK_INVALID");
    expect(String((await activationRow(activationId)).state), "forged ack activates nothing").toBe(
      "ready_for_delivery",
    );
    expect(String((await ackRow(challengeId)).state), "the challenge stays issued").toBe("issued");

    // A malformed signature is a request refusal, not an activation.
    const malformed = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: "!!!not-base64!!!",
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-rf-malformed-${RUN}`,
    });
    expect(malformed.result).toBe("REQUEST_INVALID");

    // The enrollment is superseded (owner-authority fixture, as in P02B3C):
    // the acknowledgment binding is now stale.
    const { rows: enr } = await keeper.query<{ e: string }>(
      `select current_enrollment_id::text as e from kitluy_devices.devices where id = $1::uuid`,
      [s.terminalId],
    );
    await keeper.query(
      `update kitluy_devices.manufacturing_enrollments
          set state = 'superseded', superseded_at = now() where id = $1::uuid`,
      [enr[0]?.e],
    );
    const signature = await signAck(s, challengeId);
    const stale = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-rf-stale-${RUN}`,
    });
    expect(stale.result, "a stale enrollment binding never activates").toBe(
      "ACTIVATION_ACK_INVALID",
    );
    expect(String((await activationRow(activationId)).state)).toBe("ready_for_delivery");
  }, 90_000);

  it("race A: identical completions — one activation, one consumed challenge, one timestamp", async () => {
    const s = stations.ra;
    const p = await provision(s, "RA", "ra");
    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const challengeId = String(prepared.data?.activationChallengeId);
    const signature = await signAck(s, challengeId);
    const key = `act-ra-key-${RUN}`;
    const call = () =>
      activation.verifyAcknowledgmentAndActivate({
        activationChallengeId: challengeId,
        signatureBase64: signature,
        terminalPublicKeyPem: s.pem,
        idempotencyKey: key,
      });
    const [r1, r2] = await Promise.all([call(), call()]);
    const outcomes = [r1.result, r2.result].sort();
    expect(outcomes[0] === "ACTIVATED" || outcomes[1] === "ACTIVATED", "one creator").toBe(true);
    const row = await activationRow(String(prepared.data?.activationId));
    expect(String(row.state)).toBe("activated");
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_terminal_activation_challenges
        where activation_id = $1::uuid and state = 'consumed'`,
      [String(prepared.data?.activationId)],
    );
    expect(Number(rows[0]?.n), "exactly one consumed challenge").toBe(1);
  }, 90_000);

  it("race B: two concurrent preparations — one activation lineage, one outstanding challenge", async () => {
    const s = stations.rb;
    const p = await provision(s, "RB", "rb");
    const call = () =>
      activation.prepareActivation({
        terminalAssignmentId: s.assignmentId,
        redemptionIdempotencyKey: p.redemptionKey,
      });
    const [r1, r2] = await Promise.all([call(), call()]);
    // Both may prepare; what must hold is ONE lineage and ONE outstanding
    // challenge (the partial unique index is the authority).
    expect(
      [r1.result, r2.result].every((r) => r === "ACTIVATION_PREPARED" || r === "INTERNAL_ERROR"),
    ).toBe(true);
    const { rows } = await keeper.query<{ a: string; c: string }>(
      `select (select count(*)::text from kitluy_devices.device_terminal_provisioning_activations
                where terminal_assignment_id = $1::uuid) as a,
              (select count(*)::text from kitluy_devices.device_terminal_activation_challenges c
                 join kitluy_devices.device_terminal_provisioning_activations a on a.id = c.activation_id
                where a.terminal_assignment_id = $1::uuid and c.state = 'issued') as c`,
      [s.assignmentId],
    );
    expect(Number(rows[0]?.a), "one activation lineage").toBe(1);
    expect(Number(rows[0]?.c), "one outstanding challenge").toBe(1);
  }, 90_000);

  it("race C: Hub withdrawal before acknowledgment — activation fails closed, challenge unconsumed", async () => {
    const s = stations.rc;
    const p = await provision(s, "RC", "rc");
    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const challengeId = String(prepared.data?.activationChallengeId);
    const signature = await signAck(s, challengeId);
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'ACT-HUB-TRANSITION', 'OP-ACT')`,
      [hubE],
    );
    const refused = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-rc-key-${RUN}`,
    });
    expect(refused.result).toBe("HUB_INACTIVE");
    expect(String((await activationRow(String(prepared.data?.activationId))).state)).toBe(
      "ready_for_delivery",
    );
    expect(String((await ackRow(challengeId)).state), "the challenge stays issued").toBe("issued");
  }, 90_000);

  it("race D: certificate revoked before acknowledgment — activation fails closed", async () => {
    const s = stations.rd;
    const p = await provision(s, "RD", "rd");
    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const challengeId = String(prepared.data?.activationChallengeId);
    const signature = await signAck(s, challengeId);
    await keeper.query(
      `update kitluy_devices.device_certificates
          set status = 'revoked', revoked_at = now(), revocation_reason = 'ACT-FIXTURE'
        where id = $1::uuid`,
      [p.certificateId],
    );
    const refused = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-rd-key-${RUN}`,
    });
    expect(refused.result).toBe("CREDENTIAL_INELIGIBLE");
    expect(String((await activationRow(String(prepared.data?.activationId))).state)).toBe(
      "ready_for_delivery",
    );
    expect(String((await ackRow(challengeId)).state)).toBe("issued");
  }, 90_000);

  it("rollback: a fault after the challenge is consumed in-flight aborts the whole activation", async () => {
    const s = stations.fi;
    const p = await provision(s, "FI", "fi");
    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    const challengeId = String(prepared.data?.activationChallengeId);
    const activationId = String(prepared.data?.activationId);
    const faultFn = `ws11_act_fault_${RUN}`;

    const c = await keeper.connect();
    try {
      await c.query("begin");
      await c.query("grant kitluy_activation_governor to postgres");
      await c.query(
        `create function public.${faultFn}() returns trigger language plpgsql as $f$
           begin raise exception 'WS11-ACT-FAULT' using errcode = 'KL940'; end $f$`,
      );
      await c.query(`grant execute on function public.${faultFn}() to kitluy_activation_governor`);
      await c.query("set local role kitluy_activation_governor");
      // Fault the ACTIVATION transition, which happens AFTER the challenge is
      // consumed inside the same transaction.
      await c.query(
        `create trigger zz_ws11_act_fault before update on kitluy_devices.device_terminal_provisioning_activations
           for each row when (new.state = 'activated' and new.id = '${activationId}')
           execute function public.${faultFn}()`,
      );
      await c.query("reset role");
      await c.query("set local role kitluy_provisioning_service");
      await expect(
        c.query(
          `select kitluy_devices.complete_terminal_provisioning_activation_v1($1::uuid, true, $2, $3)`,
          [challengeId, "a".repeat(64), `act-fi-key-${RUN}`],
        ),
      ).rejects.toMatchObject({ code: "KL940" });
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
    expect(String((await ackRow(challengeId)).state), "the consumed challenge rolled back").toBe(
      "issued",
    );
    const row = await activationRow(activationId);
    expect(String(row.state)).toBe("ready_for_delivery");
    expect(row.activated_at ?? null).toBeNull();
    expect(row.acknowledged_at ?? null).toBeNull();
    expect(row.activation_idempotency_key ?? null, "no idempotency residue").toBeNull();
    const { rows: residue } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger where tgname like 'zz_ws11_act%'`,
    );
    expect(Number(residue[0]?.n), "no fault mechanism survived").toBe(0);

    // The undamaged state activates cleanly afterwards.
    const signature = await signAck(s, challengeId);
    const clean = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: challengeId,
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-fi-clean-${RUN}`,
    });
    expect(clean.result).toBe("ACTIVATED");
  }, 90_000);

  it("security: activation doors are composer-only and no raw material is exposed", async () => {
    const denied = async (role: string, probe: string): Promise<void> => {
      const c = await keeper.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role }),
        ]);
        await c.query(`set local role ${role}`);
        await expect(c.query(probe), `${role}: ${probe}`).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback");
      } finally {
        c.release();
      }
    };
    for (const role of ["anon", "authenticated", "service_role"]) {
      await denied(
        role,
        `select kitluy_devices.prepare_terminal_provisioning_activation_v1(gen_random_uuid(), 'k')`,
      );
      await denied(
        role,
        `select kitluy_devices.complete_terminal_provisioning_activation_v1(gen_random_uuid(), true, repeat('a',64), 'k')`,
      );
      await denied(
        role,
        `select id from kitluy_devices.device_terminal_provisioning_activations limit 1`,
      );
    }
    // service_role's effective privilege on the NEW doors is still false —
    // the 0173 boundary covers everything added since.
    for (const fn of [
      "prepare_terminal_provisioning_activation_v1",
      "read_terminal_activation_challenge_context_v1",
      "complete_terminal_provisioning_activation_v1",
    ]) {
      const { rows } = await keeper.query<{ e: boolean }>(
        `select has_function_privilege('service_role', p.oid, 'execute') as e
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'kitluy_devices' and p.proname = $1`,
        [fn],
      );
      expect(rows[0]?.e, `${fn}: service_role must not effectively hold execute`).toBe(false);
    }
    // The composer holds no table reach on the new tables.
    const c = await keeper.connect();
    try {
      await c.query("begin");
      await c.query("set local role kitluy_provisioning_service");
      await expect(
        c.query(`select id from kitluy_devices.device_terminal_activation_challenges limit 1`),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await c.query("rollback").catch(() => undefined);
      c.release();
    }
    // Logs stay to the safe field set.
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(Object.keys(line).sort().join(",")).toBe("correlationId,operation,result");
    }
  }, 90_000);

  it("P04B: the activation challenge is terminal-signable — black-box signing, byte identity, byte-stable replay", async () => {
    const s = await newStation("ACT-P04B");
    const p = await provision(s, "P04B", "p04b");

    const prepared = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(prepared.result).toBe("ACTIVATION_PREPARED");
    const material = prepared.data;
    expect(material?.signatureAlgorithm).toBe("ed25519");
    expect(material?.signingPayloadEncoding).toBe("base64url");
    expect(String(material?.signingPayload)).toMatch(/^[A-Za-z0-9_-]+$/);
    const payload = Buffer.from(String(material?.signingPayload), "base64url");
    expect(payload.toString("utf8").startsWith("kitluy.activation-ack.v1\n")).toBe(true);

    // BYTE IDENTITY: the server crypto authority reconstructs the same bytes
    // independently from the authoritative context.
    const { rows } = await keeper.query<{ r: Record<string, unknown> }>(
      `select kitluy_devices.read_terminal_activation_challenge_context_v1($1::uuid) as r`,
      [String(material?.activationChallengeId)],
    );
    const ctx = rows[0]?.r ?? {};
    const serverBytes = Buffer.from(
      activationAckBytes({
        activationChallengeId: String(ctx.activation_challenge_id),
        purpose: String(ctx.purpose),
        activationId: String(ctx.activation_id),
        tenantId: String(ctx.tenant_id),
        digitalStoreId: String(ctx.digital_store_id),
        storeLocationId: String(ctx.store_location_id),
        environment: String(ctx.environment) as ActivationAckChallenge["environment"],
        storeHubDeviceId: String(ctx.store_hub_device_id),
        terminalDeviceId: String(ctx.terminal_device_id),
        terminalAssignmentId: String(ctx.terminal_assignment_id),
        terminalProfileKey: String(ctx.terminal_profile_key),
        provisioningCodeId: String(ctx.provisioning_code_id),
        popChallengeId: String(ctx.pop_challenge_id),
        terminalKeyFingerprint: String(ctx.terminal_key_fingerprint),
        certificateId: String(ctx.certificate_id),
        certificateSerial: String(ctx.certificate_serial),
        certificateFingerprint: String(ctx.certificate_fingerprint),
        nonce: String(ctx.nonce),
        issuedAt: new Date(String(ctx.created_at)),
        expiresAt: new Date(String(ctx.expires_at)),
      }),
    );
    expect(payload.equals(serverBytes), "byte-identical canonical acknowledgment").toBe(true);

    // BYTE-STABLE REPLAY: preparation reuses the outstanding challenge, so a
    // lost response is recovered with the IDENTICAL payload.
    const replay = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(replay.data?.activationChallengeId).toBe(material?.activationChallengeId);
    expect(
      Buffer.from(String(replay.data?.signingPayload), "base64url").equals(payload),
      "replayed payload is byte-identical",
    ).toBe(true);

    // THE BLACK-BOX TERMINAL: signs the decoded payload bytes and nothing
    // else — no database read, no canonicalizer, no timestamp handling.
    const signature = Buffer.from(
      keys.provePossession(s.keyRef, Uint8Array.from(payload)),
    ).toString("base64");
    const completed = await activation.verifyAcknowledgmentAndActivate({
      activationChallengeId: String(material?.activationChallengeId),
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
      idempotencyKey: `act-p04b-complete-${RUN}`,
    });
    expect(completed.result).toBe("ACTIVATED");

    // After activation the prepare replay answers from the authoritative row
    // and carries no further signable payload.
    const afterwards = await activation.prepareActivation({
      terminalAssignmentId: s.assignmentId,
      redemptionIdempotencyKey: p.redemptionKey,
    });
    expect(afterwards.result).toBe("ALREADY_ACTIVATED");
  }, 90_000);
});
