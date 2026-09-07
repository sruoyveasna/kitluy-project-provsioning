/**
 * ONE target resolver for the development device tools.
 *
 * ===========================================================================
 * WHY THIS EXISTS (defect D-22, 2026-08-29)
 * ===========================================================================
 * Two fleet services were running on this workstation at once — `:8787` against
 * the hosted development project and `:8788` against a local Supabase stack —
 * and the SD card's baked `KITLUY_ENROLLMENT_BASE_URL` silently decided which
 * database a Store Hub actually talked to. A whole diagnostic session was spent
 * repairing a device record in the database that was NOT answering the device.
 *
 * The lesson was not "check harder". It was that every tool resolved its own
 * target independently, so a tool and the service could disagree without
 * anything saying so. This module makes that impossible to do by accident:
 *
 *   - It reads `KITLUY_DEV_FLEET_DSN` FIRST, exactly as `fleet-service.mjs`
 *     does and with the same precedence, so a tool and the service pointed by
 *     the same environment land on the same database by construction.
 *   - It returns a human label every caller is expected to PRINT before doing
 *     anything, so the target is on screen next to the result.
 *
 * ===========================================================================
 * TWO TARGETS, AND NOTHING ELSE
 * ===========================================================================
 * A loopback database, or the ONE allowlisted hosted DEVELOPMENT project. A
 * hosted target goes through `assertHostedDevTarget` — the FULL assertion, so
 * the ENVIRONMENT is refused too and not merely the project — and callers
 * connect to the rebuilt `connectionConfig`, never to the original string
 * (finding D-20). A local target must satisfy `isLocalUrl`; a hosted DSN handed
 * in under `--local` is refused rather than quietly dialled.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevTarget,
  isLocalUrl,
} from "../database/hosted-dev-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");

/**
 * The canonical local KitLuy database, mirrored from `fleet-service.mjs`.
 *
 * `:54392` and not `:54322` — that is a DIFFERENT Supabase project and pointing
 * KitLuy work at it is the defect recorded as D-04. A workstation running the
 * stack on another port sets `KITLUY_DEV_FLEET_DSN`, which wins over this.
 */
export const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

/** The hosted development DSN, assembled from the out-of-repository identifiers. */
export function hostedDsnFromConfig() {
  const envFile = resolve(CONFIG_DIR, "supabase.env.local");
  if (!existsSync(envFile)) return null;
  const text = readFileSync(envFile, "utf8");
  const read = (name) => new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1]?.trim() ?? "";
  const ref = read("KITLUY_SUPABASE_PROJECT_REF");
  const password = read("KITLUY_SUPABASE_DB_PASSWORD");
  if (ref === "" || password === "") return null;
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
}

/**
 * Resolve the database a development device tool should act on.
 *
 * Precedence is `fleet-service.mjs`'s, deliberately:
 *   1. `KITLUY_DEV_FLEET_DSN`  — explicit, wins over everything
 *   2. `--local`               — the loopback stack
 *   3. the hosted development project
 *
 * Returns `{ isLocal, label, connectionConfig }`. `connectionConfig` is what to
 * hand `pg.Client`; for a hosted target it is the guard's REBUILT config.
 *
 * Throws `HostedTargetRefusal` for a refused hosted target, and a plain `Error`
 * for a local request that is not local.
 */
export function resolveDevTarget({ local = false, environment } = {}) {
  // PRODUCTION-LIKE ENVIRONMENTS ARE REFUSED FOR BOTH TARGETS.
  //
  // The hosted guard already refuses anything but `development`, but a LOCAL
  // DSN used to bypass the question entirely — `KITLUY_ENV=production` with a
  // loopback database ran happily. That is not a real production risk, but it
  // is the wrong answer to give, and `db-exec.mjs`'s `assertLocalTarget` sets
  // the repository convention: local/development only (KL-INF-P1-037). Matching
  // it here means one rule to remember rather than two that differ by target.
  const env = environment ?? process.env.KITLUY_ENV ?? "development";
  if (env !== "local" && env !== "development") {
    throw new Error(
      `REFUSED: KITLUY_ENV='${env}' — the development device tools operate on ` +
        "local/development targets only (KL-INF-P1-037).",
    );
  }

  const explicit = process.env.KITLUY_DEV_FLEET_DSN;
  const dsn = explicit ?? (local ? LOCAL_DSN : (hostedDsnFromConfig() ?? LOCAL_DSN));

  if (isLocalUrl(dsn)) {
    // An explicit `--local` that resolved to a local DSN, or an explicit
    // KITLUY_DEV_FLEET_DSN that happens to be local. Either way the caller is
    // told WHICH loopback database, because two local stacks on two ports is
    // the same ambiguity D-22 was about, one scale smaller.
    const parsed = new URL(dsn);
    return {
      isLocal: true,
      label: `LOCAL stack (${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname})`,
      connectionConfig: { connectionString: dsn },
    };
  }

  if (local) {
    throw new Error(
      "REFUSED: --local was requested but the resolved database is not local. " +
        "Unset KITLUY_DEV_FLEET_DSN or point it at a loopback address.",
    );
  }

  // The hosted door demands exactly `development`; `local` is meaningless for a
  // hosted project and must not be smuggled through as an alias.
  const target = assertHostedDevTarget({ dbUrl: dsn, environment: env });
  return {
    isLocal: false,
    label: `HOSTED DEV ${ALLOWED_HOSTED_DEV.name} (${target.projectRef})`,
    connectionConfig: target.connectionConfig,
    projectRef: target.projectRef,
  };
}

export { HostedTargetRefusal };
