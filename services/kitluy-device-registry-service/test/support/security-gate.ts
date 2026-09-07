/**
 * R2-4: a formal security suite FAILS when its fixture is missing. It never
 * silently skips.
 *
 * Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
 * finding R2-4; owner remediation instruction 2026-08-27.
 *
 * ===========================================================================
 * THE DEFECT THIS CLOSES
 * ===========================================================================
 * The adversarial suites guarded themselves with `describe.skipIf(!live)`, and
 * `live` depended on `KITLUY_DEV_PKI_DIR` — a variable the documented handoff
 * commands never exported. So a reviewer could run the documented command, watch
 * it go green, and be looking at a run in which 42 security assertions never
 * executed.
 *
 * A green security gate with skipped security assertions is worse than a red
 * one: it is a false statement about what was checked.
 *
 * A general unit suite may still skip for architectural reasons. A FORMAL
 * SECURITY SUITE may not, and these throw at module load — before any test is
 * collected — so the failure is impossible to read as anything else.
 */
import pg from "pg";

import { resolveDevPkiPaths, DEV_PKI_DIR_ENV } from "../../src/dev-operational-pki.js";

export interface SecurityFixtureRequirement {
  readonly dsn: string;
  /** Certificate-minting suites need the development CA; pure-SQL ones do not. */
  readonly needsPki: boolean;
  /** Anchors must be pinned for the artifact door to verify anything. */
  readonly needsTrustAnchors?: boolean;
}

function fail(what: string, how: string): never {
  throw new Error(
    [
      "",
      "  ==========================================================",
      "  FORMAL SECURITY SUITE CANNOT RUN — refusing to skip",
      "  ==========================================================",
      `  Missing: ${what}`,
      "",
      `  ${how}`,
      "",
      "  This suite carries credential-path security assertions. Skipping",
      "  them would produce a green run that proves nothing, which is the",
      "  defect finding R2-4 was raised about. See handoff section 18 for",
      "  the exact commands.",
      "",
    ].join("\n"),
  );
}

/**
 * Assert every precondition, or throw. Called at module scope, so a missing
 * fixture is a collection error rather than a silent pass.
 */
export async function requireSecurityFixture(
  requirement: SecurityFixtureRequirement,
): Promise<void> {
  if (requirement.needsPki && resolveDevPkiPaths() === null) {
    fail(
      `$${DEV_PKI_DIR_ENV} is not set`,
      "Export it to the approved external development PKI location before running " +
        "the credential-path verification suites.",
    );
  }

  const probe = new pg.Pool({
    connectionString: requirement.dsn,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await probe.query("select 1 from kitluy_devices.devices limit 1");
    if (requirement.needsTrustAnchors === true) {
      const { rows } = await probe.query<{ n: string }>(
        "select count(*)::text as n from kitluy_devices.pki_pinned_trust_anchors where environment = 'development'",
      );
      if (Number(rows[0]?.n ?? 0) < 2) {
        fail(
          "the development trust anchors are not pinned",
          "Run: KITLUY_DEV_PKI_DIR=... KITLUY_DEV_DB_URL=... node scripts/pki/pin-dev-trust-anchors.mjs",
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORMAL SECURITY SUITE")) throw error;
    fail(
      `the canonical development database is unreachable (${requirement.dsn.replace(/\/\/[^@]*@/, "//***@")})`,
      `Start it, or set $KITLUY_DEV_DB_URL. Underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await probe.end().catch(() => undefined);
  }
}
