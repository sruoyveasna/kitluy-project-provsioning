/**
 * THE canonical KitLuy development database target.
 *
 * Authority: independent Store Hub credential-path review 2026-08-26, finding
 * M-4; owner remediation instruction 2026-08-26 ("remove hardcoded :54322 test
 * target. Create one canonical KitLuy test DSN helper using :54392 for this
 * environment. Do not connect KitLuy tests to the HSA database.").
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Thirty-eight test files each wrote
 * `postgresql://postgres:postgres@127.0.0.1:54322/postgres` as a literal. That
 * port hosts a DIFFERENT PostgreSQL project on this workstation, with a
 * different migration history and none of the KitLuy device roles, so those
 * suites were either skipping silently or failing with errors that read like
 * product bugs — nineteen registry tests and eighty-five device-identity tests,
 * every one of them environmental, and re-diagnosed more than once.
 *
 * Worse than the noise: a suite that reaches an unintended database can WRITE to
 * it. The instruction is explicit that KitLuy tests must not connect to the HSA
 * database, and a literal repeated in thirty-eight places is not a boundary
 * anyone can enforce.
 *
 * One helper, one environment variable, one default.
 */

/** The environment variable that overrides the default, for CI or a colleague. */
export const DEV_DB_URL_ENV = "KITLUY_DEV_DB_URL" as const;

/**
 * The canonical local development database on this workstation.
 *
 * `:54392` is the KitLuy PostgreSQL 17.6 instance. `:54322` is a different
 * project and `:54402` is a stale PostgreSQL 15 stopped at migration 0188;
 * neither is a KitLuy target, and both are refused below.
 */
export const CANONICAL_LOCAL_DEV_DSN =
  "postgresql://postgres:postgres@127.0.0.1:54392/postgres" as const;

/** Ports on this workstation that are known NOT to be the KitLuy database. */
const KNOWN_WRONG_PORTS = ["54322", "54402"] as const;

export class DevDatabaseTargetError extends Error {
  constructor(reason: string) {
    super(`KLUY-DEV-DB-TARGET: ${reason}`);
    this.name = "DevDatabaseTargetError";
  }
}

/**
 * Refuse a target that is not a local development database.
 *
 * Deliberately strict. A suite that creates devices, spends generations and
 * revokes credentials must never be one typo away from doing it somewhere real,
 * and "it only ran against dev" is not something anyone can verify afterwards.
 */
export function assertDevelopmentDatabaseTarget(url: string): void {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new DevDatabaseTargetError(`"${redact(url)}" is not a postgres URL`);
  }
  if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
    throw new DevDatabaseTargetError(
      "refusing a non-local target; KitLuy suites run against a local development database only",
    );
  }
  for (const port of KNOWN_WRONG_PORTS) {
    if (url.includes(`:${port}/`)) {
      throw new DevDatabaseTargetError(
        `port ${port} on this workstation is NOT the KitLuy development database ` +
          "(it is a different project); the canonical local target is :54392",
      );
    }
  }
}

/** The DSN every KitLuy test should use. Validated before it is returned. */
export function devDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env[DEV_DB_URL_ENV]?.trim();
  const resolved = url === undefined || url === "" ? CANONICAL_LOCAL_DEV_DSN : url;
  assertDevelopmentDatabaseTarget(resolved);
  return resolved;
}

/** Never print credentials, even from a rejected URL. */
function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, "//***@");
}
