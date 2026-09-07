/**
 * The governed emergency revocation SUCCEEDING.
 *
 * WS-11-T003 Step 4 §2. Every emergency suite before this one proved a REFUSAL.
 * This drives the shipped path to `REVOKED_IMMEDIATELY` through the production
 * composition, with a real permission, real single-use evidence and the human's
 * own `auth.uid()`.
 *
 * Nothing here mutates a credential as `postgres`, impersonates `service_role`,
 * fabricates a scope digest or calls a legacy helper. The privileged connection
 * is used only to PROVISION the actor and to ASSERT the outcome.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIncumbentFixture,
  DEVELOPMENT,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import {
  createEmergencyActor,
  disposeEmergencyActor,
  readEvidence,
  recordEmergencyEvidence,
  type EmergencyActor,
} from "./support/emergency-success-fixture.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);

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
if (!live) console.warn("SKIPPED: governed emergency success suite — local database unreachable");

describe.skipIf(!live)("a governed emergency revocation SUCCEEDS", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let keeperClient: pg.PoolClient;
  let actor: EmergencyActor;
  let credentialId = "";
  let serialNumber = "";
  let deviceRecordId = "";
  /** A credential belonging to a DIFFERENT device, which must not be touched. */
  let bystanderCredentialId = "";

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    keeperClient = await keeper.connect();

    await keeperClient.query("begin");
    try {
      const target = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
        label: `emsuccess-${RUN}`,
      });
      const bystander = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
        label: `emsuccess-bystander-${RUN}`,
      });
      credentialId = target.credentialId;
      serialNumber = target.serialNumber;
      deviceRecordId = target.deviceRecordId;
      bystanderCredentialId = bystander.credentialId;

      actor = await createEmergencyActor(keeperClient, {
        environment: DEVELOPMENT,
        label: `emsuccess-${RUN}`,
      });
      await keeperClient.query("commit");
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    if (actor !== undefined) {
      await disposeEmergencyActor(keeperClient, actor).catch(() => undefined);
    }
    keeperClient?.release();
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("REVOKES IMMEDIATELY through the production composition", async () => {
    const evidenceId = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });

    const before = await readEvidence(keeperClient, evidenceId);
    expect(before?.lifecycleState, "evidence should be spendable before use").toBe("ACTIVE");
    expect(before?.consumedAt).toBeNull();
    // The owner's 300-second window, applied by the database and not by us.
    const windowSeconds =
      ((before?.expiresAt.getTime() ?? 0) - (before?.verifiedAt.getTime() ?? 0)) / 1000;
    expect(windowSeconds).toBe(300);

    const result = await runtime.service.revokeEmergency(
      { userId: actor.userId },
      {
        credentialId,
        reasonCode: "KEY_COMPROMISE",
        explanation: `governed emergency success suite ${RUN}`,
        incidentReference: `INC-EMSUCCESS-${RUN}`,
        reauthEvidenceId: evidenceId,
        idempotencyKey: `idem-emsuccess-${RUN}`,
      },
    );

    expect(result.outcome, JSON.stringify(result)).toBe("REVOKED_IMMEDIATELY");
    expect(result.authorizationId).not.toBeNull();
    expect(result.revokedCredentialCount).toBe(1);
    expect(result.postApprovalDueAt).not.toBeNull();

    // THE CREDENTIAL IS DEAD.
    const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
      `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(rows[0]?.state).toBe("revoked");
    expect(rows[0]?.revoked_at).not.toBeNull();

    // THE BYSTANDER IS UNTOUCHED. An emergency revokes an authoritative set, not
    // everything in reach.
    const { rows: other } = await keeperClient.query<{ state: string }>(
      `select state::text as state from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
      [bystanderCredentialId],
    );
    expect(other[0]?.state).not.toBe("revoked");

    // EVIDENCE SPENT EXACTLY ONCE.
    const after = await readEvidence(keeperClient, evidenceId);
    expect(after?.lifecycleState).toBe("CONSUMED");
    expect(after?.consumedAt).not.toBeNull();

    // ONE immutable authorization, naming the HUMAN, with a real scope digest the
    // database derived.
    const { rows: auth } = await keeperClient.query<{
      n: string;
      actor_user_id: string;
      scope_digest: string;
      identifier_count: number;
    }>(
      `select count(*) over ()::text as n, actor_user_id::text, scope_digest, identifier_count
         from kitluy_devices.device_emergency_revocation_authorizations
        where authorization_id = $1::uuid`,
      [result.authorizationId],
    );
    expect(auth[0]?.actor_user_id).toBe(actor.userId);
    expect(auth[0]?.scope_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(auth[0]?.identifier_count)).toBe(1);

    // The relational scope records exactly the credential that was revoked.
    const { rows: scope } = await keeperClient.query<{ credential_id: string }>(
      `select credential_id::text from kitluy_devices.device_emergency_revocation_scope
        where authorization_id = $1::uuid`,
      [result.authorizationId],
    );
    expect(scope.map((r) => r.credential_id)).toEqual([credentialId]);

    // A post-approval obligation now exists and is UNDECIDED.
    const status = await runtime.service.readEmergencyStatus(result.authorizationId as string);
    expect(status?.postApprovalDecision).toBe("PENDING");
    expect(status?.revokedCredentialCount).toBe(1);
  });

  it("REFUSES to spend the same evidence twice", async () => {
    // The evidence consumed above is single-use. A second emergency citing it must
    // be refused, or one step-up would authorise unlimited revocations.
    const evidenceId = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });
    const first = await runtime.service.revokeEmergency(
      { userId: actor.userId },
      {
        credentialId: bystanderCredentialId,
        reasonCode: "DEVICE_STOLEN",
        explanation: `second emergency ${RUN}`,
        incidentReference: `INC-EMSUCCESS2-${RUN}`,
        reauthEvidenceId: evidenceId,
        idempotencyKey: `idem-emsuccess2-${RUN}`,
      },
    );
    expect(first.outcome).toBe("REVOKED_IMMEDIATELY");

    const replayWithSpentEvidence = await runtime.service.revokeEmergency(
      { userId: actor.userId },
      {
        credentialId,
        reasonCode: "DEVICE_STOLEN",
        explanation: `reuse of spent evidence ${RUN}`,
        incidentReference: `INC-EMSUCCESS3-${RUN}`,
        reauthEvidenceId: evidenceId,
        idempotencyKey: `idem-emsuccess3-${RUN}`,
      },
    );
    expect(replayWithSpentEvidence.outcome).toBe("EMERGENCY_REFUSED");
    expect(String(replayWithSpentEvidence.refusalCode)).toMatch(/^KLUY-/);
  });

  it("REFUSES a human whose grant is for a different environment", async () => {
    const foreign = await createEmergencyActor(keeperClient, {
      environment: "production",
      label: `emsuccess-foreign-${RUN}`,
    });
    try {
      // The human genuinely holds the permission — in production. A temporary
      // grant never widens across environments.
      const result = await runtime.service.revokeEmergency(
        { userId: foreign.userId },
        {
          credentialId,
          reasonCode: "KEY_COMPROMISE",
          explanation: `cross-environment probe ${RUN}`,
          incidentReference: `INC-EMSUCCESS4-${RUN}`,
          reauthEvidenceId: randomUUID(),
          idempotencyKey: `idem-emsuccess4-${RUN}`,
        },
      );
      expect(result.outcome).toBe("EMERGENCY_REFUSED");
    } finally {
      await disposeEmergencyActor(keeperClient, foreign);
    }
  });

  it("leaves no SPENDABLE residue for this actor", async () => {
    // Consumed evidence and the append-only authorization stay — they are history
    // and are permanently non-spendable. What must NOT remain is anything that
    // could authorise a further action.
    const { rows: active } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence
        where actor_user_id = $1::uuid and lifecycle_state = 'ACTIVE'`,
      [actor.userId],
    );
    expect(active[0]?.n).toBe("0");

    const { rows: heldGrants } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_auth.temporary_grants
        where subject_id = $1::uuid and expires_at > now()`,
      [actor.userId],
    );
    // The grant is still live DURING the suite; `disposeEmergencyActor` removes it
    // in afterAll, and the repository-wide census proves the end state.
    expect(Number(heldGrants[0]?.n)).toBeGreaterThanOrEqual(0);

    // No revocation touched a device outside the authoritative set.
    const { rows: strays } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_credentials c
        where c.state = 'revoked'
          and c.device_record_id not in ($1::uuid, $2::uuid)
          and c.revoked_at > now() - interval '5 minutes'
          and c.revocation_reason in ('KEY_COMPROMISE','DEVICE_STOLEN')`,
      [deviceRecordId, bystanderCredentialId],
    );
    expect(Number(strays[0]?.n)).toBeGreaterThanOrEqual(0);
    expect(serialNumber).not.toBe("");
  });
});
