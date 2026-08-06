/**
 * HUB-TERMINAL PAIRING — the governed handshake against the REAL Hub database.
 *
 * WS-11-T004-P03B. Runs against the LOCAL Hub database (`kitluy_hub_local`)
 * with hub/migrations/** (through 0031) applied and dev fixtures seeded; the
 * suite SKIPS VISIBLY when unreachable (KLD-EVIDENCE-001). Terminals here are
 * real ephemeral Ed25519 keys playing the terminal role through the SHARED
 * protocol library — no LAN transport exists or is claimed.
 *
 *   Success  — hello -> challenge -> terminal proof -> Hub proof -> ONE
 *              Hub-signed receipt, verified terminal-side; device.paired
 *              audit fact; no nonce or signature in logs
 *   Replay   — same hello replays the live session; identical completion
 *              returns the ORIGINAL receipt; reconciliation is stable
 *   Hostile  — unknown/revoked/ineligible terminals, revoked and expired
 *              credentials, wrong scope, forbidden profile, forged and
 *              reflected proofs, wrong version, inactive Hub — zero residue
 *   Races    — A identical completions; B valid-vs-forged proofs; C assigned
 *              vs unauthorized prepare; D assignment withdrawal orderings;
 *              E credential revocation orderings
 *   Rollback — a fault between mutual proof and receipt insertion aborts
 *              everything, including the audit fact
 *   Privilege— direct AND effective: doors are runtime-only; sync worker and
 *              support hold nothing; direct table writes refused
 *
 * The suite leaves only RUN-tagged fixture rows (terminal registrations and
 * credentials); pairing rows are governed history and deliberately remain.
 *
 * WS-11-T004-P03C adds the restart/recovery section: every authoritative
 * pairing fact lives in the Hub database, so "restart" is modelled faithfully
 * as ending every connection of one service instance (pool.end()) and
 * constructing a fresh pool + composition against the same database — the
 * exact recovery surface a real Hub process death exposes. Terminal-side
 * receipt persistence has NO authoritative store yet and is deliberately NOT
 * simulated (recorded dependency, P03C handoff).
 */
import { randomUUID, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  terminalPairingProofBytes,
  hubPairingProofBytes,
  verifyHubPairingProof,
  verifyPairingReceipt,
  pairingTranscriptHash,
  PAIRING_PROTOCOL_VERSION,
  PAIRING_PURPOSE,
  type PairingTranscript,
  type PairingExpectation,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable } from "../src/hub/db.js";
import {
  TerminalPairingComposition,
  type PairingChallengeMaterial,
  type PairingSigner,
  type SafeLogger,
} from "../src/hub/pairing.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const HUB_CERT_SERIAL = "DEMO-OPS-CERT-0001";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const ATTACKER_TENANT = "e0000000-0000-4000-8000-0000000000a1";
const ATTACKER_STORE = "e0000000-0000-4000-8000-0000000000a2";
const ATTACKER_LOCATION = "e0000000-0000-4000-8000-0000000000a3";
const REVOKED_TERMINAL = "e0000000-0000-4000-8000-000000000024";
const T1 = "laundry.t1.intake_cashier";
const T3 = "laundry.t3.ready_scan_in";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: hub-terminal pairing — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };

interface TestTerminal {
  readonly id: string;
  readonly keyRef: string;
  readonly pem: string;
  readonly fingerprint: string;
  readonly certificateSerial: string;
  readonly credentialId: string;
  readonly profile: string;
}

describe.skipIf(!live)("hub-terminal pairing (hub group 0031)", () => {
  let pool: pg.Pool;
  let composition: TerminalPairingComposition;
  let signer: PairingSigner;
  let hubKeyRef: string;
  let originalHubFingerprint = "";
  let originalHubExpiry = "";
  // Memberships observed BEFORE this suite granted anything. afterAll restores
  // the observed state instead of revoking unconditionally, so a persistent
  // development grant (which the registry lifecycle suite depends on) survives
  // this suite whatever the execution order (P03B handoff §9 correction).
  let hadHubRuntime = false;
  let hadSyncWorker = false;
  let hadSupportRo = false;

  async function newTerminal(
    label: string,
    opts: {
      profile?: string;
      location?: string;
      tenant?: string;
      store?: string;
      lifecycle?: string;
      credentialStatus?: string;
      credentialExpiry?: string;
      grantProfile?: boolean;
    } = {},
  ): Promise<TestTerminal> {
    const id = randomUUID();
    const keyRef = `${label}-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const certificateSerial = `P03B-${label}-${RUN}`;
    const credentialId = randomUUID();
    const profile = opts.profile ?? T1;
    const { rows: hw } = await pool.query<{ id: string }>(
      `select id from edge_config.hardware_profile limit 1`,
    );
    await pool.query(
      `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name,
          hardware_profile_id, installation_id, certificate_serial,
          assignment_generation, lifecycle_status, last_client_sequence,
          last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, 0, now(), now(), now())`,
      [
        id,
        opts.tenant ?? TENANT,
        opts.store ?? STORE,
        opts.location ?? LOCATION,
        `p03b-${label}-${RUN}`,
        hw[0]?.id,
        randomUUID(),
        certificateSerial,
        opts.lifecycle ?? "active",
      ],
    );
    await pool.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint,
          certificate_serial, issuer, issued_at, expires_at, status,
          revoked_at, revocation_reason, rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Demo Device CA',
               now() - interval '1 day', $5::timestamptz, $6,
               case when $6 = 'revoked' then now() else null end,
               case when $6 = 'revoked' then 'p03b_fixture' else null end, 1)`,
      [
        credentialId,
        id,
        fingerprint,
        certificateSerial,
        opts.credentialExpiry ?? new Date(Date.now() + 3_600_000).toISOString(),
        opts.credentialStatus ?? "active",
      ],
    );
    if (opts.grantProfile !== false) {
      await pool.query(
        `insert into edge_config.terminal_profile_assignment
           (id, tenant_id, digital_store_id, location_id, terminal_device_id,
            profile_code, assignment_version, enabled, effective_from,
            effective_until, source_snapshot_id)
         values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour',
                 null, $7)`,
        [
          randomUUID(),
          opts.tenant ?? TENANT,
          opts.store ?? STORE,
          opts.location ?? LOCATION,
          id,
          profile,
          ACTIVE_SNAPSHOT,
        ],
      );
    }
    return { id, keyRef, pem, fingerprint, certificateSerial, credentialId, profile };
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

  /** The TERMINAL side of the handshake, played through the shared library. */
  function terminalSign(terminal: TestTerminal, c: PairingChallengeMaterial): string {
    return Buffer.from(
      keys.provePossession(terminal.keyRef, terminalPairingProofBytes(transcriptFromChallenge(c))),
    ).toString("base64");
  }

  async function prepare(
    terminal: TestTerminal,
    over: Partial<Parameters<TerminalPairingComposition["preparePairing"]>[0]> = {},
  ) {
    return composition.preparePairing({
      terminalDeviceId: terminal.id,
      requestedProfileCode: terminal.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 10 * 60_000),
      ...over,
    });
  }

  async function sessionRow(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query(
      `select id, state, refusal_code, transcript_hash,
              terminal_proof_verified_at, paired_at
         from edge_identity.pairing_session where id = $1::uuid`,
      [id],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function receiptCount(sessionId: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt
        where pairing_session_id = $1::uuid`,
      [sessionId],
    );
    return Number(rows[0]?.n);
  }

  beforeAll(async () => {
    pool = createHubPool(process.env, 10);
    // The seeded Hub operational credential gets the EPHEMERAL dev key's
    // fingerprint so real signatures verify against the stored identity; the
    // original values are restored in afterAll.
    hubKeyRef = `p03b-hub-${RUN}`;
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
    composition = new TerminalPairingComposition(pool, signer, logger);
    const { rows: held } = await pool.query<{ role: string; member: boolean }>(
      `select r.role, pg_has_role('postgres', r.role, 'member') as member
         from (values ('kitluy_hub_runtime'), ('kitluy_sync_worker'), ('kitluy_support_ro'))
              as r(role)`,
    );
    hadHubRuntime = held.some((r) => r.role === "kitluy_hub_runtime" && r.member);
    hadSyncWorker = held.some((r) => r.role === "kitluy_sync_worker" && r.member);
    hadSupportRo = held.some((r) => r.role === "kitluy_support_ro" && r.member);
    // Explicit literal grantee — KLRISK-HUB-001: `GRANT ... TO current_user`
    // segfaults the PG 15.8 dev server.
    await pool.query(`grant kitluy_hub_runtime to postgres`);
    await pool.query(`grant kitluy_sync_worker to postgres`);
    await pool.query(`grant kitluy_support_ro to postgres`);
  }, 120_000);

  afterAll(async () => {
    await pool
      ?.query(
        `update edge_identity.device_credential
            set public_key_fingerprint = $1, expires_at = $2::timestamptz
          where id = $3::uuid`,
        [originalHubFingerprint, originalHubExpiry, HUB_CREDENTIAL],
      )
      .catch(() => undefined);
    // Restore the OBSERVED membership state — never revoke a grant this suite
    // did not create (P03B handoff §9: the unconditional revoke made suite
    // ordering change registry-lifecycle results).
    if (!hadHubRuntime)
      await pool?.query(`revoke kitluy_hub_runtime from postgres`).catch(() => undefined);
    if (!hadSyncWorker)
      await pool?.query(`revoke kitluy_sync_worker from postgres`).catch(() => undefined);
    if (!hadSupportRo)
      await pool?.query(`revoke kitluy_support_ro from postgres`).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  it("success: mutual proof produces ONE Hub-signed receipt the terminal verifies", async () => {
    const terminal = await newTerminal("S1");
    const prepared = await prepare(terminal);
    expect(prepared.result).toBe("PAIRING_PREPARED");
    const challenge = prepared.data as PairingChallengeMaterial;
    expect(challenge.hubDeviceId).toBe(HUB_DEVICE);
    expect(challenge.terminalProfileKey, "the profile is cloud-assigned, never chosen here").toBe(
      T1,
    );
    expect(challenge.hubNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.hubNonce).not.toBe(challenge.terminalNonce);

    // Terminal not yet proven: no receipt exists, session is challenge_issued.
    expect(String((await sessionRow(challenge.pairingSessionId)).state)).toBe("challenge_issued");
    expect(await receiptCount(challenge.pairingSessionId)).toBe(0);

    const recorded = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    expect(recorded.result).toBe("TERMINAL_PROOF_RECORDED");

    const paired = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(paired.result).toBe("PAIRED");
    const state = paired.data;
    if (state === undefined) throw new Error("paired state missing");
    expect(await receiptCount(challenge.pairingSessionId)).toBe(1);

    // The TERMINAL verifies the Hub proof and the receipt with the shared
    // library — the §5 discipline: the Hub UUID, certificate fingerprint,
    // scope and generation must all match what the terminal already trusts.
    const transcript = transcriptFromChallenge(challenge);
    const expectation: PairingExpectation = {
      pairingSessionId: challenge.pairingSessionId,
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      purpose: PAIRING_PURPOSE,
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: "development",
      hubDeviceId: HUB_DEVICE,
      hubAssignmentGeneration: challenge.hubAssignmentGeneration,
      hubCertificateSerial: HUB_CERT_SERIAL,
      hubCertificateFingerprint: challenge.hubCertificateFingerprint,
      terminalDeviceId: terminal.id,
      terminalAssignmentGeneration: 1,
      terminalProfileKey: T1,
      terminalCertificateSerial: terminal.certificateSerial,
      terminalCertificateFingerprint: terminal.fingerprint,
      signerKeyFingerprint: challenge.hubCertificateFingerprint,
      terminalNonce: challenge.terminalNonce,
      hubNonce: challenge.hubNonce,
    };
    // The verifying clock is the DATABASE clock: the container's clock can
    // drift from the host's, and the Hub-local clock is the time authority.
    const { rows: clock } = await pool.query<{ t: string }>(`select now()::text as t`);
    const verifyAt = new Date(String(clock[0]?.t));
    const hubVerdict = verifyHubPairingProof(
      transcript,
      Buffer.from(state.hubProofSignatureBase64, "base64"),
      signer.publicKeyPem,
      expectation,
      verifyAt,
      publicKeyFingerprint,
    );
    expect(
      hubVerdict.verified,
      `the terminal accepts the Hub proof (${hubVerdict.refusalCode ?? ""}: ${hubVerdict.detail ?? ""})`,
    ).toBe(true);

    const receiptVerdict = verifyPairingReceipt(
      state.receipt,
      Buffer.from(state.receiptSignatureBase64, "base64"),
      signer.publicKeyPem,
      {
        pairingSessionId: challenge.pairingSessionId,
        transcriptHash: state.transcriptHash,
        hubDeviceId: HUB_DEVICE,
        hubCertificateFingerprint: challenge.hubCertificateFingerprint,
        terminalDeviceId: terminal.id,
        terminalCertificateFingerprint: terminal.fingerprint,
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development",
        terminalAssignmentGeneration: 1,
        terminalProfileKey: T1,
      },
      verifyAt,
      publicKeyFingerprint,
    );
    expect(receiptVerdict.verified, "the terminal accepts the receipt").toBe(true);
    expect(state.transcriptHash).toBe(pairingTranscriptHash(transcript));

    // The receipt claims the handshake and NOTHING more.
    const payload = JSON.stringify(state.receipt);
    for (const word of ["deliver", "sync", "connect", "restart", "recover"]) {
      expect(payload.toLowerCase().includes(word), `no ${word} claim`).toBe(false);
    }
    expect(payload.includes(challenge.terminalNonce), "no nonce in the receipt").toBe(false);

    // device.paired is on the local audit ledger, in the same transaction.
    const { rows: audit } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_audit.audit_event
        where event_code = 'device.paired' and resource_id = $1::uuid`,
      [challenge.pairingSessionId],
    );
    expect(Number(audit[0]?.n)).toBe(1);
  }, 60_000);

  it("replay: the same hello replays the live session; completion replays the ORIGINAL receipt", async () => {
    const terminal = await newTerminal("S2");
    const nonce = randomBytes(32).toString("hex");
    const first = await prepare(terminal, { terminalNonce: nonce });
    const second = await prepare(terminal, { terminalNonce: nonce });
    expect(first.result).toBe("PAIRING_PREPARED");
    expect(second.result).toBe("PAIRING_PREPARED");
    expect(second.data?.pairingSessionId).toBe(first.data?.pairingSessionId);
    expect(second.data?.hubNonce, "no regenerated Hub nonce").toBe(first.data?.hubNonce);

    const challenge = first.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    const paired = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    const replay = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(paired.result).toBe("PAIRED");
    expect(replay.result).toBe("ALREADY_PAIRED");
    expect(replay.data?.receiptId).toBe(paired.data?.receiptId);
    expect(replay.data?.transcriptHash).toBe(paired.data?.transcriptHash);
    expect(new Date(String(replay.data?.pairedAt)).getTime()).toBe(
      new Date(String(paired.data?.pairedAt)).getTime(),
    );
    expect(await receiptCount(challenge.pairingSessionId)).toBe(1);

    // A paired terminal may re-pair (§13): a NEW hello opens a NEW session.
    const again = await prepare(terminal);
    expect(again.result).toBe("PAIRING_PREPARED");
    expect(again.data?.pairingSessionId).not.toBe(challenge.pairingSessionId);

    const reconciled = await composition.reconcilePairingReceipt({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(reconciled.result).toBe("RECEIPT_FOUND");
    expect(reconciled.data?.receiptId).toBe(paired.data?.receiptId);
    expect(reconciled.data?.receiptSignatureBase64).toBe(paired.data?.receiptSignatureBase64);
  }, 60_000);

  it("hostile: ineligible terminals and credentials are refused with zero residue", async () => {
    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt`,
    );

    // Unknown terminal.
    const unknown = await composition.preparePairing({
      terminalDeviceId: randomUUID(),
      requestedProfileCode: T1,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect(unknown.result).toBe("PAIR_DEVICE_NOT_ELIGIBLE");

    // The seeded REVOKED terminal.
    const revoked = await composition.preparePairing({
      terminalDeviceId: REVOKED_TERMINAL,
      requestedProfileCode: T1,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect(revoked.result).toBe("PAIR_DEVICE_NOT_ELIGIBLE");

    // Revoked and expired terminal credentials.
    const revokedCred = await newTerminal("HR", { credentialStatus: "revoked" });
    expect((await prepare(revokedCred)).result).toBe("PAIR_CERT_INVALID");
    const expiredCred = await newTerminal("HE", {
      credentialExpiry: new Date(Date.now() - 60_000).toISOString(),
    });
    expect((await prepare(expiredCred)).result).toBe("PAIR_CERT_INVALID");

    // A terminal registered under ANOTHER scope cannot pair with this Hub.
    const foreign = await newTerminal("HF", {
      tenant: ATTACKER_TENANT,
      store: ATTACKER_STORE,
      location: ATTACKER_LOCATION,
    });
    expect((await prepare(foreign)).result).toBe("PAIR_ASSIGNMENT_MISMATCH");

    // No profile grant / caller-selected profile not granted.
    const noGrant = await newTerminal("HG", { grantProfile: false });
    expect((await prepare(noGrant)).result).toBe("PAIR_PROFILE_FORBIDDEN");
    const t1Terminal = await newTerminal("HP");
    expect((await prepare(t1Terminal, { requestedProfileCode: T3 })).result).toBe(
      "PAIR_PROFILE_FORBIDDEN",
    );

    // Version and malformed inputs.
    const versioned = await newTerminal("HV");
    expect((await prepare(versioned, { protocolVersion: "2.0" })).result).toBe(
      "PAIR_VERSION_INCOMPATIBLE",
    );
    expect((await prepare(versioned, { terminalNonce: "not-hex" })).result).toBe("REQUEST_INVALID");

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt`,
    );
    expect(Number(after.rows[0]?.n), "no refusal produced a receipt").toBe(
      Number(before.rows[0]?.n),
    );
  }, 90_000);

  it("hostile: forged, reflected and malformed proofs never pair, and refusals leave evidence", async () => {
    const terminal = await newTerminal("HX");
    const prepared = await prepare(terminal);
    const challenge = prepared.data as PairingChallengeMaterial;

    // Forged: ANOTHER terminal's genuine key signs this transcript.
    const other = await newTerminal("HX2");
    const forged = Buffer.from(
      keys.provePossession(
        other.keyRef,
        terminalPairingProofBytes(transcriptFromChallenge(challenge)),
      ),
    ).toString("base64");
    const forgedResult = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: forged,
      terminalPublicKeyPem: terminal.pem,
    });
    expect(forgedResult.result).toBe("PAIR_CHALLENGE_FAILED");
    expect(String((await sessionRow(challenge.pairingSessionId)).state)).toBe("challenge_issued");

    // Reflected: the HUB's genuine proof presented as the terminal's.
    const reflected = Buffer.from(
      signer.sign(hubPairingProofBytes(transcriptFromChallenge(challenge))),
    ).toString("base64");
    const reflectedResult = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: reflected,
      terminalPublicKeyPem: signer.publicKeyPem,
    });
    expect(reflectedResult.result).toBe("PAIR_CHALLENGE_FAILED");

    // Malformed.
    const malformed = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: "!!!",
      terminalPublicKeyPem: terminal.pem,
    });
    expect(malformed.result).toBe("REQUEST_INVALID");

    // Unknown session.
    const unknown = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: randomUUID(),
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    expect(unknown.result).toBe("PAIR_SESSION_UNKNOWN");

    // Completion without a verified proof is refused.
    const early = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(early.result).toBe("PAIR_PROOF_REQUIRED");
    expect(await receiptCount(challenge.pairingSessionId)).toBe(0);

    // Refusals left security evidence.
    const { rows: events } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_audit.security_event
        where event_code = 'EDGE_PAIRING_PROOF_REJECTED' and device_id = $1::uuid`,
      [terminal.id],
    );
    expect(Number(events[0]?.n)).toBeGreaterThanOrEqual(1);

    // The genuine terminal still pairs afterwards — a failed attempt does
    // not consume the challenge.
    const recorded = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    expect(recorded.result).toBe("TERMINAL_PROOF_RECORDED");
  }, 90_000);

  it("hostile: an expired session cannot prove or pair", async () => {
    const terminal = await newTerminal("HT");
    // The expiry window is derived from the DATABASE clock — the authority —
    // and the wait polls that same clock (a host-time sleep would race any
    // container clock drift).
    const { rows: db } = await pool.query<{ t: string }>(
      `select (now() + interval '1500 milliseconds')::text as t`,
    );
    const prepared = await prepare(terminal, { expiresAt: new Date(String(db[0]?.t)) });
    const challenge = prepared.data as PairingChallengeMaterial;
    for (;;) {
      const { rows } = await pool.query<{ done: boolean }>(
        `select now() >= $1::timestamptz as done`,
        [challenge.expiresAt],
      );
      if (rows[0]?.done) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const late = await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    expect(late.result).toBe("PAIR_CHALLENGE_EXPIRED");
    expect(await receiptCount(challenge.pairingSessionId)).toBe(0);
    // A fresh hello can begin again — the expired session no longer blocks.
    const again = await prepare(terminal);
    expect(again.result).toBe("PAIRING_PREPARED");
  }, 30_000);

  it("race A: identical completions — one receipt, one paired timestamp, both callers see it", async () => {
    const terminal = await newTerminal("RA");
    const prepared = await prepare(terminal);
    const challenge = prepared.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });
    const [r1, r2] = await Promise.all([
      composition.produceHubProofAndComplete({ pairingSessionId: challenge.pairingSessionId }),
      composition.produceHubProofAndComplete({ pairingSessionId: challenge.pairingSessionId }),
    ]);
    const outcomes = [r1.result, r2.result].sort();
    expect(outcomes).toEqual(["ALREADY_PAIRED", "PAIRED"]);
    expect(r1.data?.receiptId).toBe(r2.data?.receiptId);
    expect(await receiptCount(challenge.pairingSessionId)).toBe(1);
    const row = await sessionRow(challenge.pairingSessionId);
    expect(String(row.state)).toBe("paired");
  }, 60_000);

  it("race A determinism (T007 D1): 20 simultaneous completions always yield one PAIRED, one ALREADY_PAIRED with the original receipt", async () => {
    // KLD-2026-08-06-WS11-T007-001 rule 7: >=20 controlled iterations on
    // genuinely separate pool connections. Every iteration must produce the
    // SAME governed pair of outcomes — a single INTERNAL_ERROR or raw
    // SQLSTATE anywhere fails the run.
    for (let i = 0; i < 20; i += 1) {
      const terminal = await newTerminal(`RD${String(i).padStart(2, "0")}`);
      const prepared = await prepare(terminal);
      const challenge = prepared.data as PairingChallengeMaterial;
      await composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: terminalSign(terminal, challenge),
        terminalPublicKeyPem: terminal.pem,
      });
      const [r1, r2] = await Promise.all([
        composition.produceHubProofAndComplete({ pairingSessionId: challenge.pairingSessionId }),
        composition.produceHubProofAndComplete({ pairingSessionId: challenge.pairingSessionId }),
      ]);
      const outcomes = [r1.result, r2.result].sort();
      expect(outcomes, `iteration ${i}: [${r1.result}, ${r2.result}]`).toEqual([
        "ALREADY_PAIRED",
        "PAIRED",
      ]);
      expect(r1.data?.receiptId, `iteration ${i} receipt identity`).toBe(r2.data?.receiptId);
      expect(await receiptCount(challenge.pairingSessionId)).toBe(1);
    }
  }, 120_000);

  it("race B: a valid and a forged proof — the forgery can neither win nor unwind the valid state", async () => {
    const terminal = await newTerminal("RB");
    const other = await newTerminal("RB2");
    const prepared = await prepare(terminal);
    const challenge = prepared.data as PairingChallengeMaterial;
    const valid = terminalSign(terminal, challenge);
    const forged = Buffer.from(
      keys.provePossession(
        other.keyRef,
        terminalPairingProofBytes(transcriptFromChallenge(challenge)),
      ),
    ).toString("base64");
    const [v, f] = await Promise.all([
      composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: valid,
        terminalPublicKeyPem: terminal.pem,
      }),
      composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: forged,
        terminalPublicKeyPem: terminal.pem,
      }),
    ]);
    expect(v.result).toBe("TERMINAL_PROOF_RECORDED");
    expect(["PAIR_CHALLENGE_FAILED", "TERMINAL_PROOF_RECORDED"]).toContain(f.result);
    // The forgery may observe the already-verified state (idempotent lookup)
    // but the verified state stands and only the REAL terminal's proof made it.
    expect(String((await sessionRow(challenge.pairingSessionId)).state)).toBe(
      "terminal_proof_verified",
    );
    expect(await receiptCount(challenge.pairingSessionId)).toBe(0);
  }, 60_000);

  it("race C: concurrent hellos — one live handshake per terminal; an unauthorized scope never opens one", async () => {
    const terminal = await newTerminal("RC");
    const foreign = await newTerminal("RC2", {
      tenant: ATTACKER_TENANT,
      store: ATTACKER_STORE,
      location: ATTACKER_LOCATION,
    });
    const [a, b, c] = await Promise.all([prepare(terminal), prepare(terminal), prepare(foreign)]);
    const own = [a.result, b.result].sort();
    expect(own[0]).toBe("PAIRING_PREPARED");
    expect(["PAIRING_PREPARED", "PAIR_SESSION_OUTSTANDING"]).toContain(own[1]);
    if (own[1] === "PAIRING_PREPARED") {
      // Both saw a session only if it was the SAME one (hello replay).
      expect(a.data?.pairingSessionId).toBe(b.data?.pairingSessionId);
    }
    expect(c.result, "the unauthorized scope is refused").toBe("PAIR_ASSIGNMENT_MISMATCH");
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_session
        where terminal_device_id = $1::uuid
          and state in ('challenge_issued', 'terminal_proof_verified')`,
      [terminal.id],
    );
    expect(Number(rows[0]?.n), "exactly one live handshake").toBe(1);
    const { rows: foreignRows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_session
        where terminal_device_id = $1::uuid`,
      [foreign.id],
    );
    expect(Number(foreignRows[0]?.n), "no session for the unauthorized scope").toBe(0);
  }, 60_000);

  it("race D: Hub-assignment withdrawal — pairing fails closed after, and history stands before", async () => {
    // Ordering 1: withdrawal commits FIRST -> completion fails closed.
    const t1 = await newTerminal("RD1");
    const p1 = await prepare(t1);
    const c1 = p1.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c1.pairingSessionId,
      signatureBase64: terminalSign(t1, c1),
      terminalPublicKeyPem: t1.pem,
    });
    await pool.query(
      `update edge_identity.hub_assignment set status = 'suspended'
        where id = 'e0000000-0000-4000-8000-000000000012'`,
    );
    try {
      const refused = await composition.produceHubProofAndComplete({
        pairingSessionId: c1.pairingSessionId,
      });
      expect(refused.result).toBe("PAIR_HUB_NOT_ACTIVE");
      expect(await receiptCount(c1.pairingSessionId)).toBe(0);
      expect(String((await sessionRow(c1.pairingSessionId)).state)).toBe("terminal_proof_verified");
    } finally {
      await pool.query(
        `update edge_identity.hub_assignment set status = 'active'
          where id = 'e0000000-0000-4000-8000-000000000012'`,
      );
    }

    // Ordering 2: pairing commits FIRST -> the receipt is immutable history.
    const t2 = await newTerminal("RD2");
    const p2 = await prepare(t2);
    const c2 = p2.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c2.pairingSessionId,
      signatureBase64: terminalSign(t2, c2),
      terminalPublicKeyPem: t2.pem,
    });
    const paired = await composition.produceHubProofAndComplete({
      pairingSessionId: c2.pairingSessionId,
    });
    expect(paired.result).toBe("PAIRED");
    await pool.query(
      `update edge_identity.hub_assignment set status = 'suspended'
        where id = 'e0000000-0000-4000-8000-000000000012'`,
    );
    try {
      // The receipt survives; CURRENT eligibility is a separate question.
      const reconciled = await composition.reconcilePairingReceipt({
        pairingSessionId: c2.pairingSessionId,
      });
      expect(reconciled.result).toBe("RECEIPT_FOUND");
      expect(reconciled.data?.receiptId).toBe(paired.data?.receiptId);
      // But a NEW handshake fails closed while withdrawn.
      const t3 = await newTerminal("RD3");
      expect((await prepare(t3)).result).toBe("PAIR_HUB_NOT_ACTIVE");
    } finally {
      await pool.query(
        `update edge_identity.hub_assignment set status = 'active'
          where id = 'e0000000-0000-4000-8000-000000000012'`,
      );
    }
  }, 90_000);

  it("race E: credential revocation — fails closed mid-handshake; a paired receipt stays history", async () => {
    // Terminal credential revoked mid-handshake.
    const t1 = await newTerminal("RE1");
    const p1 = await prepare(t1);
    const c1 = p1.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c1.pairingSessionId,
      signatureBase64: terminalSign(t1, c1),
      terminalPublicKeyPem: t1.pem,
    });
    await pool.query(
      `update edge_identity.device_credential
          set status = 'revoked', revoked_at = now(), revocation_reason = 'p03b_race_e'
        where id = $1::uuid`,
      [t1.credentialId],
    );
    const refused = await composition.produceHubProofAndComplete({
      pairingSessionId: c1.pairingSessionId,
    });
    expect(refused.result).toBe("PAIR_CERT_INVALID");
    expect(await receiptCount(c1.pairingSessionId)).toBe(0);

    // Hub credential revoked mid-handshake.
    const t2 = await newTerminal("RE2");
    const p2 = await prepare(t2);
    const c2 = p2.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c2.pairingSessionId,
      signatureBase64: terminalSign(t2, c2),
      terminalPublicKeyPem: t2.pem,
    });
    await pool.query(
      `update edge_identity.device_credential
          set status = 'revoked', revoked_at = now(), revocation_reason = 'p03b_race_e_hub'
        where id = $1::uuid`,
      [HUB_CREDENTIAL],
    );
    try {
      const hubRefused = await composition.produceHubProofAndComplete({
        pairingSessionId: c2.pairingSessionId,
      });
      expect(hubRefused.result).toBe("PAIR_CERT_INVALID");
      expect(await receiptCount(c2.pairingSessionId)).toBe(0);
    } finally {
      await pool.query(
        `update edge_identity.device_credential
            set status = 'active', revoked_at = null, revocation_reason = null
          where id = $1::uuid`,
        [HUB_CREDENTIAL],
      );
    }

    // Revocation AFTER pairing: the receipt is immutable history.
    const t3 = await newTerminal("RE3");
    const p3 = await prepare(t3);
    const c3 = p3.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c3.pairingSessionId,
      signatureBase64: terminalSign(t3, c3),
      terminalPublicKeyPem: t3.pem,
    });
    const paired = await composition.produceHubProofAndComplete({
      pairingSessionId: c3.pairingSessionId,
    });
    expect(paired.result).toBe("PAIRED");
    await pool.query(
      `update edge_identity.device_credential
          set status = 'revoked', revoked_at = now(), revocation_reason = 'p03b_race_e_after'
        where id = $1::uuid`,
      [t3.credentialId],
    );
    const reconciled = await composition.reconcilePairingReceipt({
      pairingSessionId: c3.pairingSessionId,
    });
    expect(reconciled.result).toBe("RECEIPT_FOUND");
    expect(reconciled.data?.receiptId).toBe(paired.data?.receiptId);
  }, 90_000);

  it("rollback: a fault between mutual proof and receipt insertion aborts EVERYTHING", async () => {
    const terminal = await newTerminal("FI");
    const prepared = await prepare(terminal);
    const challenge = prepared.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: challenge.pairingSessionId,
      signatureBase64: terminalSign(terminal, challenge),
      terminalPublicKeyPem: terminal.pem,
    });

    const faultFn = `p03b_fault_${RUN}`;
    await pool.query(
      `create function public.${faultFn}() returns trigger language plpgsql as $f$
         begin raise exception 'P03B-FAULT' using errcode = 'KL940'; end $f$`,
    );
    // Runs AFTER the governance trigger (alphabetical order), i.e. after the
    // door has already consumed the session state in-flight.
    await pool.query(
      `create trigger zz_p03b_fault before insert on edge_identity.pairing_receipt
         for each row when (new.pairing_session_id = '${challenge.pairingSessionId}')
         execute function public.${faultFn}()`,
    );
    try {
      const failed = await composition.produceHubProofAndComplete({
        pairingSessionId: challenge.pairingSessionId,
      });
      expect(failed.result).toBe("INTERNAL_ERROR");
    } finally {
      await pool.query(`drop trigger if exists zz_p03b_fault on edge_identity.pairing_receipt`);
      await pool.query(`drop function if exists public.${faultFn}()`);
    }

    // NOTHING survived: no receipt, session still terminal_proof_verified,
    // no paired timestamp, no audit fact, no fault machinery.
    const row = await sessionRow(challenge.pairingSessionId);
    expect(String(row.state)).toBe("terminal_proof_verified");
    expect(row.paired_at ?? null).toBeNull();
    expect(row.transcript_hash ?? null).toBeNull();
    expect(await receiptCount(challenge.pairingSessionId)).toBe(0);
    const { rows: audit } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_audit.audit_event
        where event_code = 'device.paired' and resource_id = $1::uuid`,
      [challenge.pairingSessionId],
    );
    expect(Number(audit[0]?.n), "the audit fact rolled back with the receipt").toBe(0);
    const { rows: residue } = await pool.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger where tgname = 'zz_p03b_fault'`,
    );
    expect(Number(residue[0]?.n), "no fault mechanism survived").toBe(0);

    // The undamaged state completes cleanly afterwards.
    const clean = await composition.produceHubProofAndComplete({
      pairingSessionId: challenge.pairingSessionId,
    });
    expect(clean.result).toBe("PAIRED");
  }, 60_000);

  it("privilege: doors are runtime-only, tables are governor-write-only — direct AND effective", async () => {
    const terminal = await newTerminal("PV");
    const prepared = await prepare(terminal);
    const challenge = prepared.data as PairingChallengeMaterial;

    // Direct catalog posture.
    const { rows: caps } = await pool.query<{ role: string; can: boolean }>(
      `select r.role, has_function_privilege(r.role,
                'edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)',
                'execute') as can
         from (values ('kitluy_hub_runtime'), ('kitluy_sync_worker'),
                      ('kitluy_support_ro'), ('kitluy_backup')) as r(role)`,
    );
    for (const cap of caps) {
      expect(cap.can, `${cap.role} door privilege`).toBe(cap.role === "kitluy_hub_runtime");
    }

    // EFFECTIVE probes: each identity really is refused (not just unlisted).
    const denied = async (role: string, sql: string): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`set local role ${role}`);
        await expect(client.query(sql), `${role}: ${sql}`).rejects.toMatchObject({
          code: expect.stringMatching(/^(42501|P0001)$/),
        });
        await client.query("rollback");
      } finally {
        client.release();
      }
    };
    await denied(
      "kitluy_sync_worker",
      `select edge_identity.record_terminal_pairing_proof_v1('${challenge.pairingSessionId}'::uuid, true, gen_random_uuid())`,
    );
    await denied("kitluy_support_ro", `select id from edge_identity.pairing_session limit 1`);
    await denied(
      "kitluy_hub_runtime",
      `update edge_identity.pairing_session set state = 'paired'
        where id = '${challenge.pairingSessionId}'::uuid`,
    );
    await denied(
      "kitluy_hub_runtime",
      `insert into edge_identity.pairing_receipt
         (id, receipt_version, pairing_session_id, transcript_hash, hub_device_id,
          hub_certificate_fingerprint, terminal_device_id,
          terminal_certificate_fingerprint, tenant_id, digital_store_id,
          location_id, environment, terminal_assignment_generation,
          terminal_profile_code, paired_at, valid_until, signature_b64,
          signing_certificate_serial, correlation_id)
       values (gen_random_uuid(), '1.0', '${challenge.pairingSessionId}'::uuid,
               repeat('a', 64), '${HUB_DEVICE}'::uuid, repeat('b', 64),
               '${terminal.id}'::uuid, repeat('c', 64), '${TENANT}'::uuid,
               '${STORE}'::uuid, '${LOCATION}'::uuid, 'development', 1,
               '${T1}', now(), null, 'sig', 'serial', gen_random_uuid())`,
    );

    // Receipt tampering is refused even for the superuser-adjacent harness:
    // the append-only trigger recognises nobody.
    const pairedTerminal = await newTerminal("PV2");
    const p = await prepare(pairedTerminal);
    const c = p.data as PairingChallengeMaterial;
    await composition.verifyTerminalProofAndRecord({
      pairingSessionId: c.pairingSessionId,
      signatureBase64: terminalSign(pairedTerminal, c),
      terminalPublicKeyPem: pairedTerminal.pem,
    });
    await composition.produceHubProofAndComplete({ pairingSessionId: c.pairingSessionId });
    await expect(
      pool.query(
        `update edge_identity.pairing_receipt set transcript_hash = repeat('f', 64)
          where pairing_session_id = $1::uuid`,
        [c.pairingSessionId],
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("KLUY-EDGE-APPEND-ONLY") });
    await expect(
      pool.query(`delete from edge_identity.pairing_receipt where pairing_session_id = $1::uuid`, [
        c.pairingSessionId,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("KLUY-EDGE-APPEND-ONLY") });

    // Log census: exactly the safe fields, never a nonce or signature.
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(Object.keys(line).sort().join(",")).toBe("correlationId,operation,result");
    }
    const serialized = JSON.stringify(logLines);
    expect(serialized.includes(challenge.terminalNonce)).toBe(false);
    expect(serialized.includes(challenge.hubNonce)).toBe(false);
  }, 90_000);

  describe("P03C: restart, lost response and offline recovery", () => {
    /**
     * A "restarted" Hub service instance: every connection of the previous
     * instance is ended and a brand-new pool + composition is built against
     * the SAME database. The signer is reconstructed from the same key
     * custody, exactly as a real process restart would.
     */
    function freshInstance(): { pool: pg.Pool; composition: TerminalPairingComposition } {
      const restarted = createHubPool(process.env, 2);
      return { pool: restarted, composition: new TerminalPairingComposition(restarted, signer) };
    }

    async function auditCount(sessionId: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from edge_audit.audit_event
          where event_code = 'device.paired' and resource_id = $1::uuid`,
        [sessionId],
      );
      return Number(rows[0]?.n);
    }

    it("restart: a committed receipt survives instance death and verifies unchanged", async () => {
      const terminal = await newTerminal("RS1");
      const a = freshInstance();
      let sessionId = "";
      let pairedAt = "";
      let receiptId = "";
      let transcriptHash = "";
      try {
        const prepared = await a.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: randomBytes(32).toString("hex"),
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        const challenge = prepared.data as PairingChallengeMaterial;
        sessionId = challenge.pairingSessionId;
        await a.composition.verifyTerminalProofAndRecord({
          pairingSessionId: sessionId,
          signatureBase64: terminalSign(terminal, challenge),
          terminalPublicKeyPem: terminal.pem,
        });
        const paired = await a.composition.produceHubProofAndComplete({
          pairingSessionId: sessionId,
        });
        expect(paired.result).toBe("PAIRED");
        pairedAt = paired.data?.pairedAt ?? "";
        receiptId = paired.data?.receiptId ?? "";
        transcriptHash = paired.data?.transcriptHash ?? "";
      } finally {
        await a.pool.end();
      }

      const b = freshInstance();
      try {
        const reconciled = await b.composition.reconcilePairingReceipt({
          pairingSessionId: sessionId,
        });
        expect(reconciled.result).toBe("RECEIPT_FOUND");
        expect(reconciled.data?.receiptId).toBe(receiptId);
        expect(reconciled.data?.transcriptHash).toBe(transcriptHash);
        // Same INSTANT: the fresh-PAIRED response speaks JS ISO (ms), the
        // reconciled row speaks PostgreSQL text (µs) — one authoritative time.
        expect(new Date(reconciled.data?.pairedAt ?? 0).getTime()).toBe(
          new Date(pairedAt).getTime(),
        );

        // The persisted receipt verifies under the ORIGINAL immutable
        // transcript hash — restart changed no byte of the evidence.
        const receipt = reconciled.data;
        if (receipt === undefined) throw new Error("unreachable");
        const verdict = verifyPairingReceipt(
          receipt.receipt,
          Buffer.from(receipt.receiptSignatureBase64, "base64"),
          signer.publicKeyPem,
          {
            pairingSessionId: sessionId,
            transcriptHash,
            hubDeviceId: HUB_DEVICE,
            hubCertificateFingerprint: publicKeyFingerprint(signer.publicKeyPem),
            terminalDeviceId: terminal.id,
            terminalCertificateFingerprint: terminal.fingerprint,
            tenantId: TENANT,
            digitalStoreId: STORE,
            storeLocationId: LOCATION,
            environment: "development",
            terminalAssignmentGeneration: 1,
            terminalProfileKey: terminal.profile,
          },
          new Date(),
          publicKeyFingerprint,
        );
        expect(verdict.verified, verdict.detail ?? "").toBe(true);
      } finally {
        await b.pool.end();
      }

      // Restart minted nothing: one session, one receipt, one audit fact.
      const { rows: sessions } = await pool.query<{ n: string }>(
        `select count(*)::text as n from edge_identity.pairing_session
          where terminal_device_id = $1::uuid`,
        [terminal.id],
      );
      expect(Number(sessions[0]?.n)).toBe(1);
      expect(await receiptCount(sessionId)).toBe(1);
      expect(await auditCount(sessionId)).toBe(1);
    }, 60_000);

    it("restart: a lost completion response replays the ORIGINAL receipt, never a second", async () => {
      const terminal = await newTerminal("RS2");
      const a = freshInstance();
      let sessionId = "";
      let original: { receiptId: string; transcriptHash: string; pairedAt: string } | null = null;
      try {
        const prepared = await a.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: randomBytes(32).toString("hex"),
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        const challenge = prepared.data as PairingChallengeMaterial;
        sessionId = challenge.pairingSessionId;
        await a.composition.verifyTerminalProofAndRecord({
          pairingSessionId: sessionId,
          signatureBase64: terminalSign(terminal, challenge),
          terminalPublicKeyPem: terminal.pem,
        });
        const paired = await a.composition.produceHubProofAndComplete({
          pairingSessionId: sessionId,
        });
        // The response is DISCARDED here — the terminal never saw it.
        original = {
          receiptId: paired.data?.receiptId ?? "",
          transcriptHash: paired.data?.transcriptHash ?? "",
          pairedAt: paired.data?.pairedAt ?? "",
        };
      } finally {
        await a.pool.end();
      }

      const b = freshInstance();
      try {
        const retried = await b.composition.produceHubProofAndComplete({
          pairingSessionId: sessionId,
        });
        expect(retried.result).toBe("ALREADY_PAIRED");
        expect(retried.data?.receiptId).toBe(original?.receiptId);
        expect(retried.data?.transcriptHash).toBe(original?.transcriptHash);
        expect(new Date(retried.data?.pairedAt ?? 0).getTime()).toBe(
          new Date(original?.pairedAt ?? 1).getTime(),
        );
      } finally {
        await b.pool.end();
      }
      expect(await receiptCount(sessionId)).toBe(1);
      expect(await auditCount(sessionId), "replay appended no second business fact").toBe(1);
    }, 60_000);

    it("restart: an incomplete unexpired session resumes with its ORIGINAL bindings and nonces", async () => {
      const terminal = await newTerminal("RS3");
      const helloNonce = randomBytes(32).toString("hex");
      const a = freshInstance();
      let sessionId = "";
      let hubNonce = "";
      try {
        const prepared = await a.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: helloNonce,
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        const challenge = prepared.data as PairingChallengeMaterial;
        sessionId = challenge.pairingSessionId;
        hubNonce = challenge.hubNonce;
      } finally {
        await a.pool.end();
      }

      const b = freshInstance();
      try {
        // The SAME hello resumes the SAME session — no nonce is regenerated.
        const resumed = await b.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: helloNonce,
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        expect(resumed.result).toBe("PAIRING_PREPARED");
        const challenge = resumed.data as PairingChallengeMaterial;
        expect(challenge.pairingSessionId).toBe(sessionId);
        expect(challenge.hubNonce, "the Hub nonce survived the restart unchanged").toBe(hubNonce);
        expect(challenge.terminalNonce).toBe(helloNonce);

        await b.composition.verifyTerminalProofAndRecord({
          pairingSessionId: sessionId,
          signatureBase64: terminalSign(terminal, challenge),
          terminalPublicKeyPem: terminal.pem,
        });
        const paired = await b.composition.produceHubProofAndComplete({
          pairingSessionId: sessionId,
        });
        expect(paired.result).toBe("PAIRED");
      } finally {
        await b.pool.end();
      }
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from edge_identity.pairing_session
          where terminal_device_id = $1::uuid`,
        [terminal.id],
      );
      expect(Number(rows[0]?.n), "resumption opened no second session").toBe(1);
    }, 60_000);

    it("restart: an expired incomplete session refuses, keeps its bindings, and its nonces stay consumed", async () => {
      const terminal = await newTerminal("RS4");
      const helloNonce = randomBytes(32).toString("hex");
      const a = freshInstance();
      let sessionId = "";
      let challenge!: PairingChallengeMaterial;
      try {
        const prepared = await a.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: helloNonce,
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 2_000),
        });
        challenge = prepared.data as PairingChallengeMaterial;
        sessionId = challenge.pairingSessionId;
      } finally {
        await a.pool.end();
      }
      await new Promise((resolve) => setTimeout(resolve, 2_500));

      const b = freshInstance();
      try {
        // Authoritative Hub-local expiry: the late proof is refused BEFORE any
        // door runs (bindings-first verification), so nothing is consumed yet.
        const late = await b.composition.verifyTerminalProofAndRecord({
          pairingSessionId: sessionId,
          signatureBase64: terminalSign(terminal, challenge),
          terminalPublicKeyPem: terminal.pem,
        });
        expect(late.result).toBe("PAIR_CHALLENGE_EXPIRED");
        expect(await receiptCount(sessionId)).toBe(0);

        // A FRESH hello pairs cleanly after the expiry — and it is the
        // governed begin door that transitions the stale session to
        // `expired` on its way (lazy governed cleanup, no external sweeper).
        const fresh = await b.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: randomBytes(32).toString("hex"),
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        expect(fresh.result).toBe("PAIRING_PREPARED");
        const freshChallenge = fresh.data as PairingChallengeMaterial;
        expect(freshChallenge.pairingSessionId).not.toBe(sessionId);
        const row = await sessionRow(sessionId);
        expect(String(row.state), "the begin door expired the stale session").toBe("expired");

        // The consumed hello nonce cannot open a second handshake — single-use
        // outlives both the session and the restart.
        const reuse = await b.composition.preparePairing({
          terminalDeviceId: terminal.id,
          requestedProfileCode: terminal.profile,
          terminalNonce: helloNonce,
          protocolVersion: PAIRING_PROTOCOL_VERSION,
          environment: "development",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        expect(reuse.result).toBe("PAIR_NONCE_REJECTED");
        await b.composition.verifyTerminalProofAndRecord({
          pairingSessionId: freshChallenge.pairingSessionId,
          signatureBase64: terminalSign(terminal, freshChallenge),
          terminalPublicKeyPem: terminal.pem,
        });
        const paired = await b.composition.produceHubProofAndComplete({
          pairingSessionId: freshChallenge.pairingSessionId,
        });
        expect(paired.result).toBe("PAIRED");
      } finally {
        await b.pool.end();
      }
    }, 60_000);

    it("offline: pairing consumes ONLY the Hub-local database, and the projection it trusts is recorded", async () => {
      // Structural: the ONLY connection the composition holds is the Hub-local
      // database — there is no cloud client to be unavailable. WAN loss
      // therefore cannot enter the commit path (ownership classification A).
      const { rows: db } = await pool.query<{ db: string }>(`select current_database() as db`);
      expect(db[0]?.db).toBe("kitluy_hub_local");

      const terminal = await newTerminal("OFF");
      const prepared = await prepare(terminal);
      expect(prepared.result).toBe("PAIRING_PREPARED");
      const challenge = prepared.data as PairingChallengeMaterial;

      // The authorization the Hub enforced comes from the ACTIVE cloud-signed
      // snapshot projection — record exactly which one, and how fresh.
      const { rows: projection } = await pool.query<{
        snapshot_id: string;
        snapshot_state: string;
        assignment_version: number;
        effective_from: string;
      }>(
        `select cs.id as snapshot_id, cs.state as snapshot_state,
                tpa.assignment_version, tpa.effective_from::text as effective_from
           from edge_config.terminal_profile_assignment tpa
           join edge_config.configuration_snapshot cs on cs.id = tpa.source_snapshot_id
          where tpa.terminal_device_id = $1::uuid`,
        [terminal.id],
      );
      expect(projection[0]?.snapshot_state, "authorization came from the ACTIVE snapshot").toBe(
        "active",
      );
      expect(projection[0]?.snapshot_id).toBe(ACTIVE_SNAPSHOT);

      await composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: terminalSign(terminal, challenge),
        terminalPublicKeyPem: terminal.pem,
      });
      const paired = await composition.produceHubProofAndComplete({
        pairingSessionId: challenge.pairingSessionId,
      });
      expect(paired.result, "LAN pairing completed with no cloud round-trip").toBe("PAIRED");
    }, 60_000);

    it("stale authority: a projection withdrawn mid-handshake refuses closed with no receipt", async () => {
      const terminal = await newTerminal("STALE");
      const prepared = await prepare(terminal);
      const challenge = prepared.data as PairingChallengeMaterial;

      // The cloud-assigned grant ends (a superseding projection withdrew it).
      await pool.query(
        `update edge_config.terminal_profile_assignment
            set enabled = false
          where terminal_device_id = $1::uuid`,
        [terminal.id],
      );

      const refused = await composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: terminalSign(terminal, challenge),
        terminalPublicKeyPem: terminal.pem,
      });
      expect(refused.result).toBe("PAIR_PROFILE_FORBIDDEN");
      expect(await receiptCount(challenge.pairingSessionId)).toBe(0);
      const row = await sessionRow(challenge.pairingSessionId);
      expect(String(row.state), "the refused handshake consumed nothing").toBe("challenge_issued");
    }, 60_000);

    it("rollback then restart: an injected fault leaves a state a NEW instance completes exactly once", async () => {
      const terminal = await newTerminal("RS5");
      const prepared = await prepare(terminal);
      const challenge = prepared.data as PairingChallengeMaterial;
      await composition.verifyTerminalProofAndRecord({
        pairingSessionId: challenge.pairingSessionId,
        signatureBase64: terminalSign(terminal, challenge),
        terminalPublicKeyPem: terminal.pem,
      });

      const faultFn = `p03c_fault_${RUN}`;
      await pool.query(
        `create function public.${faultFn}() returns trigger language plpgsql as $f$
           begin raise exception 'P03C-FAULT' using errcode = 'KL940'; end $f$`,
      );
      await pool.query(
        `create trigger zz_p03c_fault before insert on edge_identity.pairing_receipt
           for each row when (new.pairing_session_id = '${challenge.pairingSessionId}')
           execute function public.${faultFn}()`,
      );
      try {
        const failed = await composition.produceHubProofAndComplete({
          pairingSessionId: challenge.pairingSessionId,
        });
        expect(failed.result).toBe("INTERNAL_ERROR");
      } finally {
        await pool.query(`drop trigger if exists zz_p03c_fault on edge_identity.pairing_receipt`);
        await pool.query(`drop function if exists public.${faultFn}()`);
      }
      expect(await receiptCount(challenge.pairingSessionId)).toBe(0);
      expect(await auditCount(challenge.pairingSessionId)).toBe(0);

      // The crashed instance is gone; its successor completes ONCE.
      const b = freshInstance();
      try {
        const paired = await b.composition.produceHubProofAndComplete({
          pairingSessionId: challenge.pairingSessionId,
        });
        expect(paired.result).toBe("PAIRED");
      } finally {
        await b.pool.end();
      }
      expect(await receiptCount(challenge.pairingSessionId)).toBe(1);
      expect(await auditCount(challenge.pairingSessionId)).toBe(1);
    }, 60_000);
  });
});
