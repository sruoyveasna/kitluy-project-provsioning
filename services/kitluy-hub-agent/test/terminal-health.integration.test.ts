/**
 * WS-11-T005-P02 — terminal heartbeat route, Hub-local derivation and the
 * fleet projection outbox, against the LIVE Hub database (groups 0035/0036).
 *
 * Route invocation: `EdgeRequestHandler.handle` is called directly with a
 * fabricated `EdgePeerIdentity` — a deliberate, RECORDED divergence from the
 * real-TLS harness of edge-lan.integration.test.ts: the mTLS layer itself
 * (no-cert refusal, TLS1.3 pinning, peer extraction) is already proven
 * there, and re-minting CAs per suite would re-test the transport, not this
 * package's behavior. Everything below the transport — authorizePeer,
 * sequence discipline, derivation, outbox atomicity — runs unfaked.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  hubReachable,
  pool as makePool,
  ensureRuntimeRoleMembership,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";
import { withHubTransaction, HUB_RUNTIME_ROLE } from "../src/hub/db.js";
import {
  createEdgeTerminalRouter,
  EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH,
  type EdgeTerminalRouterDeps,
} from "../src/hub/edge/routes.js";
import type { EdgeRequestHandler, EdgeResponse } from "../src/hub/edge/transport.js";
import {
  acceptTerminalHeartbeat,
  runHealthDerivationCycle,
  TERMINAL_HEALTH_EVENT_NAME,
} from "../src/hub/terminal-health.js";

const live = await hubReachable();
if (!live) console.warn("SKIPPED: terminal health reporter — local Hub database unreachable");

describe.skipIf(!live)("terminal health heartbeats and fleet reporter (WS-11-T005-P02)", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  let certSerial: string;
  let router: EdgeRequestHandler;
  const suite = `th-${randomUUID().slice(0, 8)}`;

  async function q<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
    return withHubTransaction(
      p,
      async (c) => (await c.query<R>(sql, params)).rows,
      HUB_RUNTIME_ROLE,
    );
  }

  function post(body: Record<string, unknown>, serial: string): Promise<EdgeResponse> {
    return router.handle({
      method: "POST",
      path: EDGE_TERMINAL_HEALTH_HEARTBEATS_PATH,
      headers: { "content-type": "application/json" },
      rawBody: JSON.stringify(body),
      peer: {
        certificateSerial: serial,
        certificateFingerprint: "f".repeat(64),
        subjectCommonName: "test-terminal",
      },
    });
  }

  async function reportCount(): Promise<number> {
    const rows = await q<{ n: string }>(
      `select count(*)::text as n from edge_hardware.terminal_health_report where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    return Number(rows[0]?.n ?? "0");
  }

  beforeAll(async () => {
    p = makePool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, suite, "T3", randomUUID());
    certSerial = `TEST-CERT-${terminal.terminalDeviceId.slice(-12)}`;
    // The peer gate joins device_credential on the certificate serial; mint
    // the metadata row the fixture deliberately leaves absent.
    await q(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
          issuer, issued_at, expires_at, status, rotation_generation)
       values ($1, $2, 'operational', $3, $4, 'dev-test-ca', now(), now() + interval '1 day',
               'active', 1)`,
      [randomUUID(), terminal.terminalDeviceId, "a".repeat(64), certSerial],
    );
    const stub = new Proxy({}, { get: () => () => Promise.reject(new Error("unused dep")) });
    router = createEdgeTerminalRouter({
      pool: p,
      pairing: stub,
      activationGateway: stub,
      discovery: stub,
      environment: "development",
    } as unknown as EdgeTerminalRouterDeps);
  }, 300_000);

  afterAll(async () => {
    await p.end();
  });

  it("accepts a valid authenticated heartbeat, derives healthy, and enqueues one pending outbox report", async () => {
    const res = await post(
      {
        heartbeatSequence: 1,
        uptimeSeconds: 10,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      certSerial,
    );
    expect(res.status).toBe(200);
    const outcome = (res.body as { heartbeat: { result: string; materialTransition: boolean } })
      .heartbeat;
    expect(outcome.result).toBe("ACCEPTED");
    expect(outcome.materialTransition).toBe(true); // unknown -> healthy

    const status = await q<{
      derived_state: string;
      last_heartbeat_sequence: string;
      heartbeat_count: string;
    }>(
      `select derived_state, last_heartbeat_sequence::text, heartbeat_count::text
         from edge_hardware.terminal_health_status where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(status[0]?.derived_state).toBe("healthy");
    expect(status[0]?.last_heartbeat_sequence).toBe("1");

    const reports = await q<{ id: string; material: boolean; report_sequence: string }>(
      `select id, material, report_sequence::text from edge_hardware.terminal_health_report
        where terminal_device_id = $1 order by report_sequence`,
      [terminal.terminalDeviceId],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.material).toBe(true);

    const outbox = await q<{ delivery_state: string; idempotency_key: string; event_type: string }>(
      `select o.delivery_state, e.idempotency_key, e.event_type
         from edge_sync.outbox o join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1 and e.event_type = $2`,
      [terminal.terminalDeviceId, TERMINAL_HEALTH_EVENT_NAME],
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.delivery_state).toBe("pending"); // WAN never consulted
    expect(outbox[0]?.idempotency_key).toBe(`kh1.${reports[0]?.id}.1`);
  });

  it("treats an identical retry as one business effect and refuses a lower sequence", async () => {
    const before = await reportCount();
    const dup = await post(
      {
        heartbeatSequence: 1,
        uptimeSeconds: 11,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      certSerial,
    );
    expect((dup.body as { heartbeat: { result: string } }).heartbeat.result).toBe(
      "DUPLICATE_IGNORED",
    );

    const replay = await post(
      {
        heartbeatSequence: 0,
        uptimeSeconds: 1,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      certSerial,
    );
    expect(replay.status).toBe(422); // bounded: sequence >= 1
    const lower = await post(
      {
        heartbeatSequence: 2,
        uptimeSeconds: 12,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      certSerial,
    );
    expect((lower.body as { heartbeat: { result: string } }).heartbeat.result).toBe("ACCEPTED");
    const conflict = await post(
      {
        heartbeatSequence: 1,
        uptimeSeconds: 13,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      certSerial,
    );
    expect(conflict.status).toBe(409);
    expect(await reportCount()).toBe(before); // healthy->healthy: nothing material
  });

  it("refuses an unknown certificate, a revoked credential, and scope-override fields", async () => {
    const unknown = await post(
      {
        heartbeatSequence: 9,
        uptimeSeconds: 1,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 1,
      },
      "TEST-CERT-DOES-NOT-EXIST",
    );
    expect(unknown.status).toBeGreaterThanOrEqual(400);

    await q(
      `update edge_identity.device_credential
          set status = 'revoked', revoked_at = now(), revocation_reason = 'probe'
        where certificate_serial = $1`,
      [certSerial],
    );
    const revoked = await post(
      {
        heartbeatSequence: 9,
        uptimeSeconds: 1,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 1,
      },
      certSerial,
    );
    expect(revoked.status).toBeGreaterThanOrEqual(400); // revoked never becomes healthy by talking
    await q(
      `update edge_identity.device_credential
          set status = 'active', revoked_at = null, revocation_reason = null
        where certificate_serial = $1`,
      [certSerial],
    );

    const override = await post(
      {
        heartbeatSequence: 9,
        uptimeSeconds: 1,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 1,
        tenantId: randomUUID(),
      },
      certSerial,
    );
    expect(override.status).toBe(422); // unknown fields refused, scope underivable from body
  });

  it("keeps Hub receipt time authoritative against terminal clock manipulation", async () => {
    const res = await post(
      {
        heartbeatSequence: 5,
        uptimeSeconds: 50,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
        observedAt: new Date(Date.now() + 3_600_000).toISOString(), // future claim
      },
      certSerial,
    );
    expect(res.status).toBe(200);
    const rows = await q<{ fresh: boolean }>(
      `select (last_heartbeat_at between now() - interval '10 seconds' and now() + interval '1 second') as fresh
         from edge_hardware.terminal_health_status where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(rows[0]?.fresh).toBe(true); // db now(), not the terminal's clock
  });

  it("derives degraded then offline_local from Hub time, recovers on a new heartbeat, and never double-emits", async () => {
    const before = await reportCount();
    await q(
      `update edge_hardware.terminal_health_status
          set last_heartbeat_at = now() - interval '50 seconds' where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    await runHealthDerivationCycle(p, "development");
    let state = await q<{ s: string }>(
      `select derived_state as s from edge_hardware.terminal_health_status where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(state[0]?.s).toBe("degraded");
    expect(await reportCount()).toBe(before + 1); // one material transition

    // Same state re-derived: cadence not yet due, so NO duplicate emission.
    await runHealthDerivationCycle(p, "development");
    expect(await reportCount()).toBe(before + 1);

    await q(
      `update edge_hardware.terminal_health_status
          set last_heartbeat_at = now() - interval '100 seconds' where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    await runHealthDerivationCycle(p, "development");
    state = await q<{ s: string }>(
      `select derived_state as s from edge_hardware.terminal_health_status where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(state[0]?.s).toBe("offline_local");
    expect(await reportCount()).toBe(before + 2);

    // Containment stays a SEPARATE truth: offline_local is not containment.
    const contained = await q<{ n: string }>(
      `select count(*)::text as n from edge_identity.effective_containment
        where device_uuid = $1 and directive <> 'cleared'`,
      [terminal.terminalDeviceId],
    );
    expect(contained[0]?.n).toBe("0");

    const recover = await acceptTerminalHeartbeat(
      p,
      terminal.terminalDeviceId,
      {
        heartbeatSequence: 6,
        uptimeSeconds: 60,
        applicationVersion: "1.0.0",
        configSnapshotVersion: 3,
      },
      "development",
    );
    expect(recover.result).toBe("ACCEPTED");
    expect(recover.result === "ACCEPTED" && recover.materialTransition).toBe(true);
    expect(await reportCount()).toBe(before + 3);
  });

  it("emits the 30-second cadence report exactly once per lapse, and pending outbox rows survive restart-shaped re-runs", async () => {
    const before = await reportCount();
    await q(
      `update edge_hardware.terminal_health_status
          set last_projection_sent_at = now() - interval '40 seconds' where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    await runHealthDerivationCycle(p, "development"); // cadence due
    expect(await reportCount()).toBe(before + 1);
    await runHealthDerivationCycle(p, "development"); // fresh instance = restart shape
    expect(await reportCount()).toBe(before + 1); // no duplicate effect

    const pending = await q<{ n: string }>(
      `select count(*)::text as n
         from edge_sync.outbox o join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1 and e.event_type = $2 and o.delivery_state = 'pending'`,
      [terminal.terminalDeviceId, TERMINAL_HEALTH_EVENT_NAME],
    );
    expect(Number(pending[0]?.n)).toBe(await reportCount()); // every report awaits WS-10 delivery
  });

  it("accepts exactly one of two parallel duplicate submissions", async () => {
    const body = {
      heartbeatSequence: 7,
      uptimeSeconds: 70,
      applicationVersion: "1.0.0",
      configSnapshotVersion: 3,
    };
    const results = await Promise.allSettled([
      acceptTerminalHeartbeat(p, terminal.terminalDeviceId, body, "development"),
      acceptTerminalHeartbeat(p, terminal.terminalDeviceId, body, "development"),
    ]);
    const accepted = results.filter(
      (r) => r.status === "fulfilled" && r.value.result === "ACCEPTED",
    ).length;
    expect(accepted).toBeLessThanOrEqual(1);
    const rows = await q<{ seq: string }>(
      `select last_heartbeat_sequence::text as seq
         from edge_hardware.terminal_health_status where terminal_device_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(rows[0]?.seq).toBe("7"); // one accepted fact either way
  });

  it("leaks no secret-shaped material into the outbox payload", async () => {
    const rows = await q<{ payload: Record<string, unknown> }>(
      `select payload from edge_sync.local_event
        where aggregate_id = $1 and event_type = $2 order by hub_sequence desc limit 1`,
      [terminal.terminalDeviceId, TERMINAL_HEALTH_EVENT_NAME],
    );
    const flat = JSON.stringify(rows[0]?.payload ?? {}).toLowerCase();
    for (const fragment of [
      "privatekey",
      "provisioningcode",
      "password",
      "secret",
      "connectionstring",
      "begin private key",
      "postgres://",
    ]) {
      expect(flat.includes(fragment)).toBe(false);
    }
  });
});
