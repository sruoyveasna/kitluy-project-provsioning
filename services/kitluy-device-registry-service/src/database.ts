/**
 * Authoritative-database access for the device registry service.
 *
 * Authority: infrastructure spec v1.0.0 §9.1 (configuration through environment
 * variables, no authoritative local filesystem state); KLD-2026-07-28-002 §6;
 * KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001; migration groups 0145-0154.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ===========================================================================
 * Every governed revocation door in the database is guarded by WHO is calling,
 * and the guard is not a parameter — it is the session. Group 0150 resolves the
 * emergency actor from `auth.uid()` through the JWT GUC, group 0147 restricts
 * the normal door to `kitluy_issuance_service`, and group 0154 restricts the
 * lapse sweeper to `kitluy_worker_service`. A composition root that connected as
 * one identity and called all four would be refused by three of them.
 *
 * So session identity is modelled here as a FIRST-CLASS, NON-OPTIONAL argument
 * of each helper rather than a connection-level default. There is deliberately
 * no `query()` export on this module: a caller cannot reach the pool without
 * first saying which governed identity it is speaking as.
 *
 * ===========================================================================
 * WHAT IS NOT HERE
 * ===========================================================================
 * No JWT parsing and no signature verification. This service receives claims
 * that an authenticating edge has already verified, and it refuses a session
 * whose subject is absent or unparseable rather than inventing one. Verifying
 * tokens here would duplicate the gateway's job and give two places the power to
 * decide who a human is.
 *
 * No migration execution. KL-INF-P1-037 is OWNER-LOCKED: this process never
 * applies DDL, and nothing in this module can.
 */
import pg from "pg";
import { requireString, type Env } from "@kitluy/shared-config";

/**
 * `int8` (OID 20) -> BigInt, matching `packages/payments-persistence/src/db.ts`
 * and the Hub command layer. No integer this service reads passes through binary
 * floating point (repository rule 12).
 */
pg.types.setTypeParser(20, (value: string) => BigInt(value));

/**
 * The governed database identities this service may speak as.
 *
 * These are the EXACT role names the migrations grant EXECUTE to, verified
 * against the live catalogue at group 0154:
 *
 *   revoke_device_credential_bound_v1              -> kitluy_issuance_service
 *   revoke_device_credential_emergency_governed_v1 -> authenticated
 *   record_governed_emergency_post_approval_v1     -> authenticated
 *   lapse_governed_emergency_post_approvals_v1     -> kitluy_worker_service
 *
 * The legacy doors (`revoke_device_credential_v1`,
 * `revoke_device_credential_emergency_v1`) are absent on purpose: since group
 * 0151 they are executable only by the NOLOGIN governor `kitluy_credential_issuer`,
 * and no value of this type can name them.
 */
export const REGISTRY_ROLES = {
  /** Normal governed revocation (group 0147). */
  issuance: "kitluy_issuance_service",
  /** Durable-job identity for the lapse sweeper (group 0154). */
  worker: "kitluy_worker_service",
  /** A human acting under their own `auth.uid()` (group 0150/0152). */
  human: "authenticated",
} as const;

export type RegistryRole = (typeof REGISTRY_ROLES)[keyof typeof REGISTRY_ROLES];

/**
 * A human whose identity an upstream authenticator has ALREADY verified.
 *
 * `userId` is the subject that becomes `auth.uid()`. It is not a display name,
 * it is not trusted from a request body, and this service never derives it from
 * anything but verified claims.
 */
export interface VerifiedHumanSession {
  readonly userId: string;
  /**
   * Extra verified claims to place on the session. `sub` and `role` are set from
   * `userId` and the authenticated role and cannot be overridden from here — a
   * caller that could rewrite `sub` could act as any human.
   */
  readonly additionalClaims?: Readonly<Record<string, unknown>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidHumanSessionError extends Error {
  constructor(detail: string) {
    super(`refusing to open a human session: ${detail}`);
    this.name = "InvalidHumanSessionError";
  }
}

/**
 * The environment variable holding the authoritative connection string.
 *
 * Named for this service so a deployment cannot accidentally hand it the Hub's
 * local DSN, and read from the environment so no credential is ever in code
 * (repository rule 4).
 */
export const DEVICE_REGISTRY_DATABASE_URL = "DEVICE_REGISTRY_DATABASE_URL" as const;

export function deviceRegistryDatabaseUrl(env: Env = process.env): string {
  return requireString(env, DEVICE_REGISTRY_DATABASE_URL);
}

export function createRegistryPool(env: Env = process.env, max = 8): pg.Pool {
  return new pg.Pool({ connectionString: deviceRegistryDatabaseUrl(env), max });
}

/** Anything that can hand out a checked-out client. Lets tests pass a stub pool. */
export interface ClientSource {
  connect(): Promise<pg.PoolClient>;
}

/**
 * Runs `fn` in ONE transaction as a governed SERVICE identity.
 *
 * `set local role` rather than a connection-level role, so the identity dies
 * with the transaction and a pooled connection can never leak it to the next
 * borrower — the defect `d2b8401` fixed in the test suites, kept out of
 * production by construction here.
 */
export async function withServiceRole<T>(
  source: ClientSource,
  role: Extract<RegistryRole, "kitluy_issuance_service" | "kitluy_worker_service">,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await source.connect();
  try {
    await client.query("begin");
    // Identifier, not a parameter: `set local role` takes no bind parameters.
    // Safe because `role` is a union of two compile-time literals and cannot
    // carry caller text.
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` in ONE transaction as an AUTHENTICATED HUMAN.
 *
 * Both halves of the identity are transaction-local:
 *
 *   * `request.jwt.claims` is set with `set_config(..., true)`, which is what
 *     `kitluy_auth.current_actor_context()` reads to resolve `auth.uid()`;
 *   * `set local role authenticated` drops the connecting service identity for
 *     the duration, so the governed RPC cannot be satisfied by the service's own
 *     privileges.
 *
 * Claims are set before the role drop. NOT, as an earlier version of this comment
 * claimed, because `authenticated` could not set them afterwards — a reviewer
 * checked and it can. The order is simply the one that keeps the assertion below
 * meaningful: identity is established, then dropped to, then verified.
 */
export async function withHumanSession<T>(
  source: ClientSource,
  session: VerifiedHumanSession,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const userId = session.userId?.trim() ?? "";
  if (userId === "") {
    throw new InvalidHumanSessionError("the verified subject is empty");
  }
  if (!UUID_PATTERN.test(userId)) {
    // The governed RPCs cast the subject to uuid. A non-uuid would surface as a
    // raw `22P02 invalid input syntax` from deep inside a definer function,
    // which is both unhelpful and a detail this service must not leak.
    throw new InvalidHumanSessionError("the verified subject is not a uuid");
  }

  const claims = {
    ...(session.additionalClaims ?? {}),
    sub: userId,
    role: REGISTRY_ROLES.human,
  };

  const client = await source.connect();
  try {
    await client.query("begin");
    // BOTH GUCs, and the singular one is not optional.
    //
    // `auth.uid()` in this database is:
    //
    //     coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    //              current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    //
    // The LEGACY SINGULAR GUC WINS. The first version of this function set only
    // `request.jwt.claims`, so anything that had already pinned
    // `request.jwt.claim.sub` decided `auth.uid()` instead of this call — and an
    // independent reviewer demonstrated it live using nothing but the one
    // operator-controlled input this module reads, a DSN carrying
    // `?options=-c request.jwt.claim.sub=<other uuid>` (honoured by `pg`).
    // `ALTER ROLE/DATABASE ... SET` and a leftover session GUC on a pooled backend
    // reach the same place.
    //
    // The consequences were the two that matter most: every emergency revocation
    // silently evaluated against a DIFFERENT subject and failed as
    // PERMANENT_AUTHORIZATION — the emergency door off during an incident, with
    // redaction hiding why — or, if the pinned subject held the permission and
    // spendable evidence, an immutable authorization row naming an innocent human
    // as the actor. That is the RC-021 property this module exists to hold.
    //
    // Both are set transaction-locally so neither can outlive the call, and the
    // result is asserted below rather than assumed.
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify(claims), userId],
    );
    await client.query(`set local role ${REGISTRY_ROLES.human}`);

    // FAIL CLOSED IF THE SESSION IS NOT WHO WE ASKED FOR.
    //
    // Cheap (one round trip on a path that is already several) and it converts any
    // future GUC-precedence surprise from a silent misattribution into a refusal.
    const { rows } = await client.query<{ actual: string | null }>(
      `select auth.uid()::text as actual`,
    );
    const actual = rows[0]?.actual ?? null;
    if (actual !== userId) {
      throw new InvalidHumanSessionError(
        "the database resolved a different subject than the verified one; refusing to act",
      );
    }

    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reads back the identity a transaction is actually running under.
 *
 * Exists so composition tests can ASSERT the session rather than trust it: a
 * wiring bug that silently ran the emergency door as `service_role` would still
 * revoke the credential, and a test that only checked the outcome would pass.
 *
 * THE ACTOR READ IS PRIVILEGE-SAFE, and it has to be. `kitluy_issuance_service`
 * and `kitluy_worker_service` hold no USAGE on `kitluy_auth`, and schema USAGE is
 * checked when a qualified name is RESOLVED — not when the function is called —
 * so guarding the call with `has_schema_privilege` in a `CASE` does not help: the
 * statement fails during parse analysis either way. A savepoint is the only thing
 * that makes the failure recoverable without poisoning the caller's transaction.
 *
 * For those roles a null actor is the CORRECT answer rather than a degraded one:
 * a service identity has no JWT, `auth.uid()` is null, and the governed emergency
 * RPC refuses it before looking anything up. That is the RC-021 property.
 */
export async function observeSessionIdentity(
  client: pg.PoolClient,
): Promise<{ readonly role: string; readonly actorId: string | null }> {
  const roleResult = await client.query<{ role: string }>(`select current_user as role`);
  const role = roleResult.rows[0]?.role ?? "";

  await client.query("savepoint kitluy_observe_actor");
  try {
    const { rows } = await client.query<{ actor_id: string | null }>(
      `select nullif(kitluy_auth.current_actor_context() ->> 'user_id', '') as actor_id`,
    );
    await client.query("release savepoint kitluy_observe_actor");
    return { role, actorId: rows[0]?.actor_id ?? null };
  } catch {
    await client.query("rollback to savepoint kitluy_observe_actor");
    return { role, actorId: null };
  }
}
