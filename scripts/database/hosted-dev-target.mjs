/**
 * Hosted-development deployment guard — EXACT PROJECT ALLOWLIST.
 *
 * ===========================================================================
 * WHY THIS IS NOT A `--allow-remote` FLAG
 * ===========================================================================
 * The owner authorised deployment to ONE hosted Supabase project. A generic
 * "allow remote" switch would have satisfied that authorisation today and
 * pointed at production the first time someone reused the command with a
 * different URL. So there is no boolean here to set, no environment variable
 * that unlocks arbitrary targets, and no override argument. The only remote
 * project this file will ever permit is written below as a literal.
 *
 * `assertLocalTarget()` in db-exec.mjs is untouched: db:apply, db:reset and
 * db:seed remain local-only, exactly as KL-INF-P1-037 requires.
 *
 * ===========================================================================
 * IDENTITY IS TAKEN FROM THE CONNECTION, NOT FROM A LABEL
 * ===========================================================================
 * An environment variable named "development" proves nothing — it is a string
 * the caller chose. The project reference is therefore PARSED OUT OF THE
 * CONNECTION STRING and compared against the allowlist, so the check is against
 * the database actually being dialled. A caller who sets
 * KITLUY_ENV=development while pointing at another project is refused.
 *
 * Authority: owner instruction 2026-08-07 (canonical target change, handoff 20)
 * + owner decision 2026-08-10 (hosted development deployment), reconciled
 * 2026-08-10: `kitluy-project-pos` is the canonical development target and
 * `het-kitluy-dev` (gkfcxxtryqmjnhujlkdr) is REDUNDANT — it is therefore a
 * REFUSED target here, not merely an unlisted one.
 * Also KL-INF-P1-037 (migrations are never auto-applied).
 */

/** The ONLY remote project this repository may deploy to. A literal, on purpose. */
export const ALLOWED_HOSTED_DEV = Object.freeze({
  projectRef: "gjgbnkhuwlwhngbtrgts",
  environment: "development",
  name: "kitluy-project-pos",
});

/** Operations that are forbidden against a hosted target even when allowlisted. */
export const FORBIDDEN_HOSTED_COMMANDS = Object.freeze([
  "reset",
  "db:reset",
  "drop",
  "wipe",
  "truncate-all",
]);

export class HostedTargetRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostedTargetRefusal";
    this.code = code;
  }
}

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i;

/**
 * Derive the Supabase project reference from a connection string.
 *
 * Two shapes exist and both are handled, because getting this wrong in either
 * direction is a security bug:
 *
 *   direct   postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres
 *   pooler   postgresql://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Returns null when no reference can be derived. Null is never treated as
 * "probably fine" — the caller refuses on it.
 */
export function deriveProjectRef(dbUrl) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") return null;

  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname ?? "";
  const user = decodeURIComponent(parsed.username ?? "");

  // Pooler: the reference rides in the username, not the host.
  const pooled = /^postgres\.([a-z0-9]{20})$/i.exec(user);
  if (pooled !== null) return pooled[1].toLowerCase();

  // Direct: db.<ref>.supabase.co
  const direct = /^db\.([a-z0-9]{20})\.supabase\.(co|in)$/i.exec(host);
  if (direct !== null) return direct[1].toLowerCase();

  return null;
}

export function isLocalUrl(dbUrl) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") return false;
  try {
    return LOCAL_HOST_PATTERN.test(new URL(dbUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Assert that a hosted deployment may proceed against this exact target.
 *
 * Every limb must clear. Throws `HostedTargetRefusal` with a specific code —
 * codes exist so the negative tests assert WHICH rule refused, not merely that
 * something did.
 */
export function assertHostedDevTarget({ dbUrl, environment, declaredProjectRef } = {}) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-NO-TARGET",
      "REFUSED: no database URL was supplied for the hosted deployment.",
    );
  }

  // A local URL handed to the hosted command is a mistake, not a target.
  // Routed rather than silently accepted: local work has its own tooling.
  if (isLocalUrl(dbUrl)) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-LOCAL-TARGET",
      "REFUSED: this is a LOCAL database. Use `pnpm db:apply` / `pnpm db:reset`; the hosted command never touches local stacks.",
    );
  }

  if (environment !== ALLOWED_HOSTED_DEV.environment) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-ENV-NOT-ALLOWED",
      `REFUSED: environment '${String(environment)}' is not deployable by this command. Only '${ALLOWED_HOSTED_DEV.environment}' is, and only for ${ALLOWED_HOSTED_DEV.projectRef}. Pilot and production have separately approved promotion paths.`,
    );
  }

  const derived = deriveProjectRef(dbUrl);
  if (derived === null) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-REF-UNRESOLVABLE",
      "REFUSED: no Supabase project reference could be derived from the connection string. An unidentifiable remote target is never deployed to.",
    );
  }

  if (derived !== ALLOWED_HOSTED_DEV.projectRef) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-REF-NOT-ALLOWED",
      `REFUSED: project '${derived}' is not the authorised hosted development project. Only ${ALLOWED_HOSTED_DEV.projectRef} (${ALLOWED_HOSTED_DEV.name}) may be deployed to.`,
    );
  }

  // When the caller also names a ref, it must agree with the connection.
  // A mismatch means the operator believes they are dialling a different
  // database than they are, which is exactly when to stop.
  if (declaredProjectRef !== undefined && declaredProjectRef !== derived) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-REF-MISMATCH",
      `REFUSED: the declared project '${String(declaredProjectRef)}' does not match the connection's project '${derived}'.`,
    );
  }

  return Object.freeze({
    projectRef: derived,
    environment,
    name: ALLOWED_HOSTED_DEV.name,
  });
}

/**
 * Destructive operations stay forbidden even on the allowlisted project.
 *
 * The owner authorised forward migrations and seeds, not a wipe. A recovery
 * that genuinely needs one is a conversation, not a command-line argument.
 */
export function assertNonDestructiveHostedCommand(command) {
  const normalised = String(command ?? "").toLowerCase();
  if (FORBIDDEN_HOSTED_COMMANDS.includes(normalised)) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-DESTRUCTIVE-FORBIDDEN",
      `REFUSED: '${normalised}' is destructive and is never run against a hosted project, including the authorised development one. Forward migrations and seeds only; propose a recovery plan instead.`,
    );
  }
  return true;
}
