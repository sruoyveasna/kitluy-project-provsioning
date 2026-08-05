/**
 * PAIRING-RECEIPT REPLICATION — the Hub half, WS-11-T004-P04C3.
 *
 * Runs the REAL `TerminalPairingComposition` against the REAL Hub database
 * (`kitluy_hub_local`); the suite SKIPS VISIBLY when it is unreachable
 * (KLD-EVIDENCE-001).
 *
 * The claim under test is narrow and load-bearing: **cloud availability is not
 * part of the pairing commit path.** There is no cloud client anywhere in the
 * completion transaction, so a Store with no internet pairs a terminal exactly
 * as fast as one with internet — and the event that will eventually tell the
 * cloud is written in the SAME transaction as the paired state, the immutable
 * receipt and the `device.paired` audit fact, so it cannot be lost between them.
 *
 *   Atomic     — one event, one outbox row, same transaction
 *   Rollback   — an injected event failure takes the pairing and the receipt
 *                with it
 *   Offline    — the event sits `pending` and pairing still committed
 *   Restart    — a fresh instance finds the pending event exactly as left
 *   Contents   — public receipt material only; no nonce, key or proof signature
 */
import { randomUUID, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  terminalPairingProofBytes,
  PAIRING_PROTOCOL_VERSION,
  type PairingTranscript,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable } from "../src/hub/db.js";
import {
  TerminalPairingComposition,
  type PairingChallengeMaterial,
  type PairingSigner,
} from "../src/hub/pairing.js";
import {
  PAIRING_RECEIPT_AGGREGATE_TYPE,
  PAIRING_RECEIPT_EVENT_NAME,
  PAIRING_RECEIPT_SCHEMA_VERSION,
  assertPublishableReceiptPayload,
  pairingReceiptEffectKey,
} from "../src/hub/pairing-replication.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const HUB_CERT_SERIAL = "DEMO-OPS-CERT-0001";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const T1 = "laundry.t1.intake_cashier";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: pairing replication — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();

interface TestTerminal {
  readonly id: string;
  readonly keyRef: string;
  readonly profile: string;
}

describe.skipIf(!live)("pairing-receipt replication (P04C3)", () => {
  let pool: pg.Pool;
  let composition: TerminalPairingComposition;
  let signer: PairingSigner;
  let hubKeyRef = "";
  let originalHubFingerprint = "";
  let originalHubExpiry = "";
  let hadHubRuntime = false;

  async function newTerminal(label: string): Promise<TestTerminal> {
    const id = randomUUID();
    const keyRef = `p04c3-${label}-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const certificateSerial = `P04C3-${label}-${RUN}`;
    const { rows: hw } = await pool.query<{ id: string }>(
      `select id from edge_config.hardware_profile limit 1`,
    );
    await pool.query(
      `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name,
          hardware_profile_id, installation_id, certificate_serial,
          assignment_generation, lifecycle_status, last_client_sequence,
          last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', 0, now(), now(), now())`,
      [
        id,
        TENANT,
        STORE,
        LOCATION,
        `p04c3-${label}-${RUN}`,
        hw[0]?.id,
        randomUUID(),
        certificateSerial,
      ],
    );
    await pool.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
          issuer, issued_at, expires_at, status, revoked_at, revocation_reason,
          rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Demo Device CA',
               now() - interval '1 day', now() + interval '1 hour', 'active', null, null, 1)`,
      [randomUUID(), id, publicKeyFingerprint(pem), certificateSerial],
    );
    await pool.query(
      `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id,
          profile_code, assignment_version, enabled, effective_from, effective_until,
          source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour', null, $7)`,
      [randomUUID(), TENANT, STORE, LOCATION, id, T1, ACTIVE_SNAPSHOT],
    );
    return { id, keyRef, profile: T1 };
  }

  function transcriptFromChallenge(c: PairingChallengeMaterial): PairingTranscript {
    return {
      pairingSessionId: c.pairingSessionId,
      protocolVersion: c.protocolVersion,
      purpose: c.purpose,
      tenantId: c.tenantId,
      digitalStoreId: c.digitalStoreId,
      storeLocationId: c.storeLocationId,
      environment: c.environment as TrustEnvironment,
      hubDeviceId: c.hubDeviceId,
      hubAssignmentGeneration: c.hubAssignmentGeneration,
      hubCertificateSerial: c.hubCertificateSerial,
      hubCertificateFingerprint: c.hubCertificateFingerprint,
      terminalDeviceId: c.terminalDeviceId,
      terminalAssignmentGeneration: c.terminalAssignmentGeneration,
      terminalProfileKey: c.terminalProfileKey,
      terminalCertificateSerial: c.terminalCertificateSerial,
      terminalCertificateFingerprint: c.terminalCertificateFingerprint,
      terminalNonce: c.terminalNonce,
      hubNonce: c.hubNonce,
      issuedAt: new Date(c.issuedAt),
      expiresAt: new Date(c.expiresAt),
    };
  }

  /** Full LAN-less handshake through the real composition. */
  async function pair(
    terminal: TestTerminal,
    service: TerminalPairingComposition = composition,
  ): Promise<{ sessionId: string; receiptId: string }> {
    const prepared = await service.preparePairing({
      terminalDeviceId: terminal.id,
      requestedProfileCode: terminal.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 120_000),
    });
    expect(prepared.result).toBe("PAIRING_PREPARED");
    const challenge = prepared.data as PairingChallengeMaterial;
    const proof = Buffer.from(
      keys.provePossession(
        terminal.keyRef,
        terminalPairingProofBytes(transcriptFromChallenge(challenge)),
      ),
    ).toString("base64");
    const recorded = await service.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: proof,
      terminalPublicKeyPem: keys.publicKeyPem(terminal.keyRef) ?? "",
    });
    expect(recorded.result).toBe("TERMINAL_PROOF_RECORDED");
    const completed = await service.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(completed.result).toBe("PAIRED");
    return {
      sessionId: challenge.pairingSessionId,
      receiptId: String(completed.data?.receiptId),
    };
  }

  interface OutboxRow extends Record<string, unknown> {
    event_id: string;
    event_type: string;
    schema_version: number;
    aggregate_type: string;
    aggregate_id: string;
    idempotency_key: string;
    delivery_state: string;
    payload: Record<string, unknown>;
  }

  async function eventsFor(sessionId: string): Promise<OutboxRow[]> {
    const { rows } = await pool.query<OutboxRow>(
      `select e.id as event_id, e.event_type, e.schema_version, e.aggregate_type,
              e.aggregate_id::text as aggregate_id, e.idempotency_key,
              o.delivery_state::text as delivery_state, e.payload
         from edge_sync.local_event e
         join edge_sync.outbox o on o.event_id = e.id
        where e.aggregate_id = $1::uuid and e.event_type = $2`,
      [sessionId, PAIRING_RECEIPT_EVENT_NAME],
    );
    return rows;
  }

  beforeAll(async () => {
    pool = createHubPool(process.env, 10);
    hubKeyRef = `p04c3-hub-${RUN}`;
    await keys.generateDeviceKey(hubKeyRef, "development");
    const hubPem = keys.publicKeyPem(hubKeyRef) ?? "";
    const { rows: prior } = await pool.query<{ fp: string; exp: string }>(
      `select public_key_fingerprint as fp, expires_at::text as exp
         from edge_identity.device_credential where id = $1::uuid`,
      [HUB_CREDENTIAL],
    );
    originalHubFingerprint = String(prior[0]?.fp);
    originalHubExpiry = String(prior[0]?.exp);
    await pool.query(
      `update edge_identity.device_credential
          set public_key_fingerprint = $1, expires_at = now() + interval '1 year'
        where id = $2::uuid`,
      [publicKeyFingerprint(hubPem), HUB_CREDENTIAL],
    );
    signer = {
      certificateSerial: HUB_CERT_SERIAL,
      publicKeyPem: hubPem,
      sign: (payload) => keys.provePossession(hubKeyRef, payload),
    };
    composition = new TerminalPairingComposition(pool, signer);
    const { rows } = await pool.query<{ member: boolean }>(
      `select pg_has_role('postgres', 'kitluy_hub_runtime', 'member') as member`,
    );
    hadHubRuntime = rows[0]?.member === true;
    // Explicit literal grantee — KLRISK-HUB-001.
    await pool.query(`grant kitluy_hub_runtime to postgres`);
  }, 120_000);

  afterAll(async () => {
    // Belt and braces for the injected-fault scenario: if that test's process
    // died between the revoke and its `finally`, the runtime would be left
    // unable to allocate a sequence. Restoring unconditionally here costs
    // nothing and cannot leave residue for the next suite.
    await pool
      ?.query(`grant execute on function edge_sync.allocate_hub_sequence() to kitluy_hub_runtime`)
      .catch(() => undefined);
    await pool
      ?.query(
        `update edge_identity.device_credential
            set public_key_fingerprint = $1, expires_at = $2::timestamptz
          where id = $3::uuid`,
        [originalHubFingerprint, originalHubExpiry, HUB_CREDENTIAL],
      )
      .catch(() => undefined);
    if (!hadHubRuntime)
      await pool?.query(`revoke kitluy_hub_runtime from postgres`).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  it("pairing creates EXACTLY ONE outbox event, atomically with the receipt", async () => {
    const terminal = await newTerminal("A1");
    const { sessionId, receiptId } = await pair(terminal);

    const events = await eventsFor(sessionId);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.event_type).toBe(PAIRING_RECEIPT_EVENT_NAME);
    expect(event.schema_version).toBe(PAIRING_RECEIPT_SCHEMA_VERSION);
    expect(event.aggregate_type).toBe(PAIRING_RECEIPT_AGGREGATE_TYPE);
    expect(event.aggregate_id).toBe(sessionId);
    // The effect key's namespace is the RECEIPT id (the business dedupe
    // identity), with the declared ordinal 1.
    expect(event.idempotency_key).toBe(`kh1.${receiptId}.1`);
    expect(event.idempotency_key).toBe(
      pairingReceiptEffectKey(receiptId, PAIRING_RECEIPT_EVENT_NAME),
    );
    // WS-09 writes `pending` and nothing else: no fabricated acknowledgement.
    expect(event.delivery_state).toBe("pending");

    // The receipt, the paired state and the audit fact all exist alongside it.
    const { rows: receipts } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt where id = $1::uuid`,
      [receiptId],
    );
    expect(receipts[0]?.n).toBe("1");
    const { rows: audits } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_audit.audit_event
        where resource_id = $1::uuid and event_code = 'device.paired'`,
      [sessionId],
    );
    expect(audits[0]?.n).toBe("1");
  });

  it("an injected event failure rolls back the pairing AND the receipt", async () => {
    const terminal = await newTerminal("B1");
    // A composition whose signer produces a receipt id the event layer will
    // choke on cannot be built without touching production code, so the fault
    // is injected where it is real: the sequence allocator the event uses.
    // Removing EXECUTE for one statement makes `recordPairingReceiptEvent`
    // fail AFTER the receipt insert, inside the same transaction.
    const prepared = await composition.preparePairing({
      terminalDeviceId: terminal.id,
      requestedProfileCode: terminal.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 120_000),
    });
    const challenge = prepared.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: Buffer.from(
        keys.provePossession(
          terminal.keyRef,
          terminalPairingProofBytes(transcriptFromChallenge(challenge)),
        ),
      ).toString("base64"),
      terminalPublicKeyPem: keys.publicKeyPem(terminal.keyRef) ?? "",
    });

    await pool.query(
      `revoke execute on function edge_sync.allocate_hub_sequence() from kitluy_hub_runtime`,
    );
    try {
      const completed = await composition.produceHubProofAndComplete({
        pairingSessionId: challenge.pairingSessionId,
      });
      expect(completed.result, "the completion fails rather than half-committing").not.toBe(
        "PAIRED",
      );
    } finally {
      await pool.query(
        `grant execute on function edge_sync.allocate_hub_sequence() to kitluy_hub_runtime`,
      );
    }

    // NOTHING committed: no receipt, no paired state, no event.
    const { rows: receipts } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt
        where pairing_session_id = $1::uuid`,
      [challenge.pairingSessionId],
    );
    expect(receipts[0]?.n, "the receipt rolled back with the event").toBe("0");
    const { rows: session } = await pool.query<{ state: string }>(
      `select state from edge_identity.pairing_session where id = $1::uuid`,
      [challenge.pairingSessionId],
    );
    expect(session[0]?.state, "the session did not reach paired").not.toBe("paired");
    expect(await eventsFor(challenge.pairingSessionId)).toHaveLength(0);

    // And the Hub still works afterwards — the fault was not sticky.
    const recovered = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(recovered.result).toBe("PAIRED");
    expect(await eventsFor(challenge.pairingSessionId)).toHaveLength(1);
  });

  it("a WAN outage leaves the event PENDING and never undoes local pairing", async () => {
    const terminal = await newTerminal("C1");
    // There is no cloud client in this path to disable — which IS the property.
    // The assertion is structural: pairing commits, and the event waits.
    const { sessionId } = await pair(terminal);
    const events = await eventsFor(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]?.delivery_state).toBe("pending");
    const { rows } = await pool.query<{ state: string }>(
      `select state from edge_identity.pairing_session where id = $1::uuid`,
      [sessionId],
    );
    expect(rows[0]?.state, "pairing committed without any cloud acknowledgement").toBe("paired");
    // No acknowledgement can exist yet — the CHECK in 0009 forbids a
    // fabricated one, and nothing here fabricated one.
    const { rows: ack } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1::uuid and o.acknowledged_at is not null`,
      [sessionId],
    );
    expect(ack[0]?.n).toBe("0");
  });

  it("a Hub restart finds the pending event exactly as it was left", async () => {
    const terminal = await newTerminal("D1");
    const { sessionId, receiptId } = await pair(terminal);
    const before = await eventsFor(sessionId);

    // Instance death: every connection of this instance ends, and a FRESH
    // pool + composition is built against the same database.
    await pool.end();
    pool = createHubPool(process.env, 10);
    composition = new TerminalPairingComposition(pool, signer);

    const after = await eventsFor(sessionId);
    expect(after).toHaveLength(1);
    expect(after[0]?.event_id).toBe(before[0]?.event_id);
    expect(after[0]?.idempotency_key).toBe(`kh1.${receiptId}.1`);
    expect(after[0]?.delivery_state, "publication resumes from pending").toBe("pending");

    // A completion replay after restart returns the ORIGINAL receipt and does
    // NOT emit a second event.
    const replay = await composition.produceHubProofAndComplete({ pairingSessionId: sessionId });
    expect(replay.result).toBe("ALREADY_PAIRED");
    expect(replay.data?.receiptId).toBe(receiptId);
    expect(await eventsFor(sessionId), "a replay emits nothing new").toHaveLength(1);
  });

  it("the event carries PUBLIC receipt material only", async () => {
    const terminal = await newTerminal("E1");
    const { sessionId, receiptId } = await pair(terminal);
    const event = (await eventsFor(sessionId))[0]!;
    const envelope = event.payload as { payload: Record<string, unknown> };
    const payload = envelope.payload;

    expect(payload["receipt_id"]).toBe(receiptId);
    expect(payload["pairing_session_id"]).toBe(sessionId);
    expect(payload["terminal_profile_code"]).toBe(T1);
    expect(payload["hub_device_id"]).toBe(HUB_DEVICE);
    expect(typeof payload["hub_receipt_signature"]).toBe("string");

    // The forbidden families are absent from the payload AND from the whole
    // stored envelope: no nonce, no ephemeral proof signature, no private key,
    // no provisioning code, no database credential.
    const text = JSON.stringify(event.payload);
    expect(text).not.toMatch(/nonce/i);
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
    expect(text).not.toMatch(/provisioning_code|code_digest/i);
    expect(() => assertPublishableReceiptPayload(payload)).not.toThrow();
  });

  it("the publishable-payload guard refuses every forbidden family", () => {
    for (const forbidden of [
      { terminal_nonce: "ab".repeat(32) },
      { hubNonce: "cd".repeat(32) },
      { proof_signature: "zz" },
      { provisioning_code: "ABCD-1234" },
      { private_key_pem: "x" },
      { note: "postgres://u:p@h/d" },
    ]) {
      expect(() =>
        assertPublishableReceiptPayload({ receipt_id: randomUUID(), ...forbidden }),
      ).toThrow(/never be replicated|private key material/);
    }
    // The HUB RECEIPT signature is deliberately allowed: it is the signature
    // over the PUBLIC receipt, which is the evidence being replicated.
    expect(() =>
      assertPublishableReceiptPayload({
        receipt_id: randomUUID(),
        hub_receipt_signature: "abc",
      }),
    ).not.toThrow();
  });

  it("an unregistered Hub-originated effect fails rather than emits", () => {
    expect(() => pairingReceiptEffectKey(randomUUID(), "terminal_pairing.something_else")).toThrow(
      /no registered ordinal/,
    );
    // And the registered one is stable across calls — deterministic on replay.
    const receiptId = randomUUID();
    expect(pairingReceiptEffectKey(receiptId, PAIRING_RECEIPT_EVENT_NAME)).toBe(
      pairingReceiptEffectKey(receiptId, PAIRING_RECEIPT_EVENT_NAME),
    );
  });
});
