/**
 * THE canonical governed emergency-revocation SUCCESS fixture.
 *
 * WS-11-T003 Step 4 §2. Every emergency suite in this repository so far has
 * proved REFUSALS — no permission, no evidence, no such credential. None had ever
 * driven the governed door to `REVOKED_IMMEDIATELY`, which meant the success path
 * was the one thing the emergency design had never been tested on.
 *
 * ===========================================================================
 * THE AUTHORITY CHAIN, AND WHY EACH LINK IS REAL
 * ===========================================================================
 *   auth.users                    the human must exist; evidence has an FK to it
 *   admin_user_profiles ACTIVE    `record_reauthentication_evidence_v1` refuses
 *                                 KLUY-REAUTH-PROFILE-NOT-ACTIVE without it
 *   temporary_grants              environment-EXACT, time-boxed. The governed
 *                                 `has_permission` path that never widens across
 *                                 environments
 *   request.jwt.claims + claim.sub  BOTH, because `auth.uid()` prefers the legacy
 *                                 singular GUC
 *   set local role authenticated  the human's own session
 *   record_reauthentication_..._v1  REAL single-use evidence, recorded BY the
 *                                 human, bound to the action class
 *   revoke_device_credential_emergency_governed_v1  the public governed door
 *
 * Nothing here fabricates a scope digest, impersonates `service_role`, mutates a
 * credential as `postgres`, or calls a legacy helper. The revocation is performed
 * by the PRODUCTION composition (`DeviceRevocationService.revokeEmergency`), so
 * what is under test is the shipped path.
 *
 * ===========================================================================
 * ISOLATION
 * ===========================================================================
 * Every identifier is per-fixture unique, and the emergency actor is a brand-new
 * user rather than a seeded one, so two suites running in parallel cannot spend
 * each other's grant or evidence. `dispose()` removes the grant, the profile and
 * the user; consumed evidence and the append-only authorization are left in place
 * because they are permanently non-spendable, which is what the residue census
 * requires rather than deletion.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withHumanSession, type ClientSource } from "../../src/database.js";

export const EMERGENCY_REVOKE_ACTION = "fleet.device_credential.emergency_revoke" as const;
export const EMERGENCY_POST_APPROVE_ACTION =
  "fleet.device_credential.emergency_post_approve" as const;

export interface EmergencyActor {
  readonly userId: string;
  readonly label: string;
}

/**
 * Creates a human who genuinely holds the emergency permission.
 *
 * `keeper` must be a privileged connection: creating a user and granting a
 * permission is provisioning, not the operation under test. What must NOT be
 * privileged is the revocation itself, and it is not.
 */
export async function createEmergencyActor(
  keeper: pg.PoolClient,
  options: {
    readonly environment: string;
    readonly actionClasses?: readonly string[];
    readonly label?: string;
    /** Minutes the grant stays live. Short, so a leaked grant expires by itself. */
    readonly grantMinutes?: number;
  },
): Promise<EmergencyActor> {
  const userId = randomUUID();
  const label = options.label ?? `emergency-actor-${userId.slice(0, 8)}`;

  await keeper.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $2, '', now(), now(), now())`,
    [userId, `${label}@fixture.invalid`],
  );

  // Without an ACTIVE profile the evidence recorder refuses outright. This is a
  // real control, not fixture ceremony: a disabled human cannot step up.
  await keeper.query(
    `insert into kitluy_auth.admin_user_profiles (user_id, status) values ($1::uuid, 'ACTIVE')`,
    [userId],
  );

  // ENVIRONMENT-EXACT and time-boxed. `has_permission` never widens a temporary
  // grant across environments, so this authorises exactly one environment.
  for (const actionClass of options.actionClasses ?? [EMERGENCY_REVOKE_ACTION]) {
    await keeper.query(
      `insert into kitluy_auth.temporary_grants
         (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, $3, now() - interval '1 minute', now() + make_interval(mins => $4), $5)`,
      [userId, actionClass, options.environment, options.grantMinutes ?? 30, `WS-11-T003 ${label}`],
    );
  }

  return { userId, label };
}

/**
 * Records REAL single-use re-authentication evidence, as the human.
 *
 * Recorded through the governed RPC in the human's own session, so the actor is
 * derived from `auth.uid()` and the 300-second expiry comes from the governed
 * policy window. Neither is passed, and neither can be widened from here.
 */
export async function recordEmergencyEvidence(
  source: ClientSource,
  actor: EmergencyActor,
  options: { readonly environment: string; readonly actionClass?: string },
): Promise<string> {
  return withHumanSession(source, { userId: actor.userId }, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select kitluy_auth.record_reauthentication_evidence_v1($1, $2, 'PASSWORD_TOTP', $3)::text as id`,
      [
        options.environment,
        options.actionClass ?? EMERGENCY_REVOKE_ACTION,
        `${actor.label}-${randomUUID().slice(0, 8)}`,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("the governed recorder returned no evidence id");
    return id;
  });
}

/** Reads an evidence row's lifecycle without spending it. */
export async function readEvidence(
  keeper: pg.PoolClient,
  evidenceId: string,
): Promise<{
  readonly lifecycleState: string;
  readonly consumedAt: Date | null;
  readonly expiresAt: Date;
  readonly verifiedAt: Date;
} | null> {
  const { rows } = await keeper.query<{
    lifecycle_state: string;
    consumed_at: Date | null;
    expires_at: Date;
    verified_at: Date;
  }>(
    `select lifecycle_state, consumed_at, expires_at, verified_at
       from kitluy_auth.reauthentication_evidence where evidence_id = $1::uuid`,
    [evidenceId],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : {
        lifecycleState: row.lifecycle_state,
        consumedAt: row.consumed_at,
        expiresAt: row.expires_at,
        verifiedAt: row.verified_at,
      };
}

/**
 * Removes everything SPENDABLE this fixture created.
 *
 * Deliberately does NOT delete consumed evidence or the emergency authorization:
 * both are append-only evidence of something that really happened, and both are
 * permanently non-spendable. The residue census asks for zero SPENDABLE residue,
 * not zero history.
 */
export async function disposeEmergencyActor(
  keeper: pg.PoolClient,
  actor: EmergencyActor,
): Promise<void> {
  await keeper.query(`delete from kitluy_auth.temporary_grants where subject_id = $1::uuid`, [
    actor.userId,
  ]);
  // Any evidence still ACTIVE is retired so nothing spendable outlives the test.
  await keeper.query(
    `update kitluy_auth.reauthentication_evidence
        set lifecycle_state = 'REVOKED', revoked_at = now()
      where actor_user_id = $1::uuid and lifecycle_state = 'ACTIVE'`,
    [actor.userId],
  );
  await keeper.query(`delete from kitluy_auth.admin_user_profiles where user_id = $1::uuid`, [
    actor.userId,
  ]);
  await keeper.query(`delete from auth.users where id = $1::uuid`, [actor.userId]);
}
