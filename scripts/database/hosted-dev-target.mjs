/**
 * Hosted-development deployment guard — EXACT PROJECT AND EXACT HOST.
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
 * H-1: THE HOST IS THE TARGET. THE USERNAME IS NOT.
 * ===========================================================================
 * Independent security review 2026-08-27, finding H-1.
 *
 * The previous version derived the project reference from the POSTGRES
 * USERNAME and returned on the first match, never looking at the host. So
 *
 *     postgresql://postgres.gjgbnkhuwlwhngbtrgts:PASSWORD@evil.example.net:5432/postgres
 *
 * was classified as the approved KitLuy project, announced as
 * "kitluy-project-pos (gjgbnkhuwlwhngbtrgts)", and then dialled — at an
 * attacker's machine, carrying the hosted database password. The reviewer also
 * demonstrated it with `127.1`, `2130706433`, `0x7f000001`, `[::1]`, arbitrary
 * IPv6, and another project's `db.<ref>.supabase.co`. Only the literal
 * `127.0.0.1` was caught, by a pattern that missed every other spelling of
 * loopback.
 *
 * That is a confused deputy: a caller-supplied string decided identity, and the
 * machine actually contacted was never checked. The credential is the payload.
 *
 * THE FIX, AND ITS SHAPE:
 *
 *   1. The HOST is validated FIRST, against an EXACT allowlist — not a grammar,
 *      not a suffix test, not a substring. `endsWith(".supabase.com")` is
 *      satisfied by `evil.supabase.com.attacker.net` under a careless parser and
 *      by a real attacker-registered subdomain under a careful one; an exact
 *      string comparison is satisfied by exactly one machine.
 *   2. No project reference found anywhere else in the URL — username, password,
 *      path or query — may rescue a host that is not on that list.
 *   3. For the DIRECT form the reference is derived from the HOST and from the
 *      USERNAME independently, and they must agree.
 *   4. Everything else about the URL must be canonical too: scheme, port and
 *      database name, so a target cannot be smuggled in through a non-Postgres
 *      scheme, the transaction-mode port (which cannot run DDL), or a different
 *      database on the right machine.
 *
 * The approved pooler host is a LITERAL rather than a pattern because the
 * repository already documents it: CLAUDE.md pins the IPv4 session-mode pooler
 * `aws-0-ap-southeast-1.pooler.supabase.com:5432`, and the configured hosted
 * DSN was verified to match it exactly. When the exact value is known, an exact
 * comparison is strictly safer than a grammar that also admits hosts nobody
 * has approved.
 *
 * ===========================================================================
 * IDENTITY IS TAKEN FROM THE CONNECTION, NOT FROM A LABEL
 * ===========================================================================
 * An environment variable named "development" proves nothing — it is a string
 * the caller chose. The project reference is PARSED OUT OF THE CONNECTION and
 * compared against the allowlist, so the check is against the database actually
 * being dialled. A caller who sets KITLUY_ENV=development while pointing at
 * another project is refused.
 *
 * KNOWN OPEN, deliberately NOT fixed in this H-1 pass:
 *   H-2  TLS posture is not asserted. Query parameters are parsed and reported
 *        (see `observedQueryParameters`) but never rewritten here.
 *   M-1  An UNSET environment still defaults to 'development' in the CALLERS.
 *        This module refuses anything that is not exactly 'development'; the
 *        defaulting lives in db-deploy-hosted-dev.mjs and
 *        scripts/pki/trust-anchor-bootstrap.mjs and is documented by test.
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

/**
 * The ONLY hosts this repository may dial for hosted development. EXACT
 * strings, compared with `===` after lowercasing. A trailing dot, a different
 * region, a different pooler number or any other subdomain is a different
 * machine and is refused.
 *
 * `pooler` is the IPv4 session-mode pooler documented in CLAUDE.md. `direct` is
 * IPv6-only and unreachable from the current workstation, but it is a genuine
 * Supabase form for this project and is accepted when the host and the username
 * agree on the reference.
 */
export const APPROVED_HOSTED_DEV_HOSTS = Object.freeze({
  pooler: "aws-0-ap-southeast-1.pooler.supabase.com",
  direct: `db.${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`,
});

/** Session mode. 6543 is transaction mode and cannot run DDL — refused, not coerced. */
export const CANONICAL_HOSTED_PORT = "5432";
export const CANONICAL_HOSTED_DATABASE = "postgres";
export const ALLOWED_SCHEMES = Object.freeze(["postgresql:", "postgres:"]);

/**
 * Parameters that can change WHICH SERVER IS CONTACTED, or who we contact it as.
 * (Finding D-20.) Any of these on a hosted target is a refusal, never an ignore.
 *
 * Drawn from libpq's connection keywords plus the `pg` subset, because the DSN
 * may be handed to either: `pg` in this process, or the Supabase CLI (libpq) in
 * a subprocess. A parameter `pg` happens to ignore today is still listed — the
 * guard must not depend on which client reads the string.
 */
export const CONNECTION_IDENTITY_PARAMETERS = Object.freeze(
  new Set([
    "host",
    "hostaddr",
    "port",
    "dbname",
    "database",
    "user",
    "username",
    "password",
    "passfile",
    "service",
    "servicefile",
    "socket",
    "unix_socket",
    "requirepeer",
    "target_session_attrs",
    "load_balance_hosts",
    "replication",
    "options",
    "krbsrvname",
    "gsslib",
    "gssdelegation",
    "gssencmode",
    "authtype",
    "connect_timeout",
    "client_encoding",
    "fallback_application_name",
    "application_name",
  ]),
);

/**
 * The ONLY parameters permitted on a hosted-development DSN after D-20.
 *
 * All of them are TLS parameters, and D-20 deliberately does NOT decide TLS
 * policy — that is H-2. They are allowed through here so H-2 has something to
 * govern, and so this pass cannot be mistaken for having settled transport
 * security. Everything else, including apparently harmless things like
 * `application_name`, is refused: the authorised DSN carries NO query string at
 * all, so a strict list costs nothing today and an addition has to be a decision.
 *
 * H-2 MUST revisit this set.
 */
export const ALLOWED_QUERY_PARAMETERS = Object.freeze(
  new Set([
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslcrl",
    "sslcrldir",
    "sslsni",
    "sslcompression",
    "sslpassword",
    "ssl_min_protocol_version",
    "ssl_max_protocol_version",
    "channel_binding",
  ]),
);

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

/**
 * Loopback in every spelling the reviewer demonstrated, plus the families a
 * host allowlist should never have to argue with.
 *
 * This is defence in depth, NOT the H-1 control: the exact-host allowlist
 * already refuses every one of these, because none of them is one of two
 * literal strings. It exists so `isLocalUrl` — which ROUTES local work — cannot
 * be fooled into calling a loopback address remote.
 */
function isLoopbackAddress(hostname) {
  const h = String(hostname ?? "")
    .trim()
    .toLowerCase();
  if (h === "") return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;

  // IPv6 literal, bracketed by the URL parser. Only the loopback forms count as
  // LOCAL; every other IPv6 literal is simply not an approved host and is
  // refused by the allowlist with an honest code.
  if (h.startsWith("[") && h.endsWith("]")) {
    const inner = h.slice(1, -1);
    return inner === "::1" || inner === "::" || /^::ffff:(0*127)\./.test(inner);
  }

  // IPv4 in every spelling: dotted-quad, shorthand (127.1), decimal
  // (2130706433), hex (0x7f000001), octal (0177.0.0.1). The FIRST OCTET decides
  // loopback, and it is decoded rather than string-matched, because `127.1` and
  // `2130706433` are the same address written two ways.
  const parts = h.split(".");
  if (parts.length > 4 || parts.some((p) => p === "")) return false;
  const nums = parts.map((p) => {
    if (/^0x[0-9a-f]+$/.test(p)) return Number.parseInt(p, 16);
    if (/^0[0-7]+$/.test(p)) return Number.parseInt(p, 8);
    if (/^[0-9]+$/.test(p)) return Number.parseInt(p, 10);
    return Number.NaN;
  });
  if (nums.some((n) => !Number.isFinite(n))) return false; // a real hostname
  // A single number is the whole 32-bit address; otherwise the first part is
  // the leading octet.
  const firstOctet = nums.length === 1 ? Math.floor(nums[0] / 2 ** 24) : nums[0];
  return firstOctet === 127 || (nums.length === 1 && nums[0] === 0);
}

/** Decode a URL component without ever throwing URIError (review finding L-5). */
function safeDecode(value) {
  const raw = String(value ?? "");
  try {
    return { ok: true, value: decodeURIComponent(raw) };
  } catch {
    return { ok: false, value: raw };
  }
}

/**
 * Parse a hosted-development connection string and prove it is canonical.
 *
 * Throws `HostedTargetRefusal` with a specific code. Codes exist so the
 * adversarial tests assert WHICH rule refused, not merely that something did —
 * a guard that refuses for the wrong reason passes today and regresses quietly.
 *
 * ORDER IS PART OF THE CONTRACT. The host is checked before anything derived
 * from caller-controlled text is trusted, so an attacker-chosen username can
 * never be the reason a refusal is skipped.
 *
 * This function performs NO I/O. Every refusal below happens before any caller
 * has the opportunity to open a socket.
 */
export function parseHostedTargetUrl(dbUrl) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-NO-TARGET",
      "REFUSED: no database URL was supplied for the hosted deployment.",
    );
  }

  let parsed;
  try {
    parsed = new URL(dbUrl.trim());
  } catch {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-URL-MALFORMED",
      "REFUSED: the connection string is not a parseable URL.",
    );
  }

  // 1. SCHEME.
  const scheme = String(parsed.protocol ?? "").toLowerCase();
  if (!ALLOWED_SCHEMES.includes(scheme)) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-SCHEME-NOT-ALLOWED",
      `REFUSED: scheme '${scheme}' is not a PostgreSQL connection scheme. Only ${ALLOWED_SCHEMES.join(" and ")} are accepted.`,
    );
  }

  // 2. HOST — the H-1 control, and it comes before every derived value.
  const hostname = String(parsed.hostname ?? "").toLowerCase();
  const approvedHosts = Object.values(APPROVED_HOSTED_DEV_HOSTS);
  if (!approvedHosts.includes(hostname)) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-HOST-NOT-APPROVED",
      `REFUSED: host '${hostname}' is not an approved hosted-development host. ` +
        "No project reference in the username, password, path or query authorises a different machine. " +
        `Approved: ${approvedHosts.join(", ")}.`,
    );
  }
  const hostForm = hostname === APPROVED_HOSTED_DEV_HOSTS.pooler ? "pooler" : "direct";

  // 3. PORT. Session mode only; 6543 cannot run DDL and is never coerced.
  const port = String(parsed.port ?? "");
  if (port !== CANONICAL_HOSTED_PORT) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-PORT-NOT-CANONICAL",
      `REFUSED: port '${port === "" ? "(unset)" : port}' is not the canonical session-mode port ${CANONICAL_HOSTED_PORT}. Transaction mode (6543) cannot run DDL and an unset port is ambiguous.`,
    );
  }

  // 4. DATABASE.
  const database = String(parsed.pathname ?? "").replace(/^\//, "");
  if (database !== CANONICAL_HOSTED_DATABASE) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-DATABASE-NOT-CANONICAL",
      `REFUSED: database '${database === "" ? "(unset)" : database}' is not '${CANONICAL_HOSTED_DATABASE}'.`,
    );
  }

  // 5. USERNAME. Decoded without ever throwing (L-5): malformed percent
  //    encoding fails CLOSED through this governed path, not as a raw URIError.
  const decoded = safeDecode(parsed.username);
  if (!decoded.ok) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-USERNAME-MALFORMED",
      "REFUSED: the username is not valid percent-encoding.",
    );
  }
  const username = decoded.value;

  // 6. PROJECT REFERENCE, from the host and the username INDEPENDENTLY.
  const refFromHost =
    hostForm === "direct"
      ? (/^db\.([a-z0-9]{20})\.supabase\.(?:co|in)$/i.exec(hostname)?.[1]?.toLowerCase() ?? null)
      : null;
  const refFromUser = /^postgres\.([a-z0-9]{20})$/i.exec(username)?.[1]?.toLowerCase() ?? null;

  if (hostForm === "pooler") {
    // The pooler host carries no reference, so the username is the only source —
    // which is exactly why the host had to be proven first.
    if (refFromUser === null) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-USERNAME-NOT-CANONICAL",
        `REFUSED: a session-pooler connection requires the username 'postgres.<project_ref>'; got '${username}'.`,
      );
    }
  } else {
    if (refFromHost === null) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-REF-UNRESOLVABLE",
        "REFUSED: no Supabase project reference could be derived from the host.",
      );
    }
    // A direct connection may legitimately use the bare `postgres` username.
    // When it names a reference, that reference must agree with the host.
    if (refFromUser !== null && refFromUser !== refFromHost) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-REF-HOST-USER-MISMATCH",
        `REFUSED: the username names project '${refFromUser}' but the host names '${refFromHost}'. They must agree.`,
      );
    }
    if (refFromUser === null && username !== "postgres") {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-USERNAME-NOT-CANONICAL",
        `REFUSED: a direct connection requires the username 'postgres' or 'postgres.<project_ref>'; got '${username}'.`,
      );
    }
  }

  const projectRef = hostForm === "pooler" ? refFromUser : refFromHost;

  // 7. QUERY PARAMETERS — FAIL CLOSED. (Finding D-20.)
  //
  // Validating the authority section and then handing the ORIGINAL string to a
  // libpq-compatible client is not validation, because the client re-reads the
  // query and lets it win. Measured against `pg`:
  //
  //   ?host=127.0.0.1&port=N  -> dials 127.0.0.1:N, authority IGNORED
  //   ?host=%2Ftmp            -> dials a UNIX SOCKET at /tmp
  //   ?user=attacker          -> changes the startup user
  //   ?port=6543              -> changes the port
  //
  // A confirmer captured a cleartext password this way while the guard was
  // reporting the approved pooler. So: an ALLOWLIST, and an UNKNOWN PARAMETER
  // IS A REFUSAL. A blacklist would have to enumerate every routing option that
  // libpq has now and every one it gains later, and would be wrong the first
  // time either changed.
  const allowedQueryParameters = [];
  const seenNames = new Set();
  for (const [rawName, value] of parsed.searchParams.entries()) {
    // libpq keywords are case-sensitive, but a client that lowercases would make
    // `HOST=` routing again — so compare case-insensitively and refuse either
    // spelling. The same reasoning covers a percent-encoded name: `searchParams`
    // has already decoded it, so `%68ost` arrives here as `host`.
    const name = String(rawName).trim().toLowerCase();

    if (name === "") {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-QUERY-MALFORMED",
        "REFUSED: the connection string carries an empty query-parameter name.",
      );
    }
    if (CONNECTION_IDENTITY_PARAMETERS.has(name)) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-QUERY-ROUTING-FORBIDDEN",
        `REFUSED: connection parameter '${rawName}' can change WHICH SERVER is contacted, and would override the host, port, database or user this guard just validated. Routing parameters are never accepted on a hosted target.`,
      );
    }
    if (!ALLOWED_QUERY_PARAMETERS.has(name)) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-QUERY-UNKNOWN",
        `REFUSED: connection parameter '${rawName}' is not on the allowlist. Unknown parameters are refused rather than ignored, because a parameter nobody has reasoned about is a parameter nobody has proven is safe.`,
      );
    }
    // A repeated parameter is ambiguous: which one wins is the client's choice,
    // not ours, and "it depends on the library" is not a security property.
    if (seenNames.has(name)) {
      throw new HostedTargetRefusal(
        "KLUY-DEPLOY-QUERY-DUPLICATE",
        `REFUSED: connection parameter '${rawName}' appears more than once; which value applies is client-defined.`,
      );
    }
    seenNames.add(name);
    allowedQueryParameters.push(Object.freeze({ name, value }));
  }
  const frozenAllowed = Object.freeze(allowedQueryParameters);

  return Object.freeze({
    scheme,
    hostname,
    hostForm,
    port,
    database,
    username,
    projectRef,
    refFromHost,
    refFromUser,
    allowedQueryParameters: frozenAllowed,
    // Retained under the old name so existing readers keep working; after D-20
    // the two are the same list, because anything not allowed has already thrown.
    observedQueryParameters: frozenAllowed,
  });
}

/**
 * Derive the Supabase project reference from a connection string.
 *
 * HOST-AWARE since H-1: a reference is only ever returned for a connection
 * whose host is on the approved list. Returns null otherwise, and null is never
 * treated as "probably fine" — the caller refuses on it.
 */
export function deriveProjectRef(dbUrl) {
  try {
    return parseHostedTargetUrl(dbUrl).projectRef;
  } catch {
    return null;
  }
}

/**
 * Build a SANITIZED connection from a DSN that has already passed
 * `parseHostedTargetUrl`. (Finding D-20.)
 *
 * Exists so the two consumers that gate on `deriveProjectRef` rather than on the
 * full assertion can still connect to the VALIDATED target without the original
 * string coming back into play. It deliberately asserts NO environment: those
 * consumers' environment gating is finding D-19 and is not this pass's business.
 *
 * Throws the same governed refusals as `parseHostedTargetUrl`, so a routing
 * parameter is refused here too rather than quietly surviving.
 */
export function canonicalHostedConnection(dbUrl) {
  const target = parseHostedTargetUrl(dbUrl);
  const password = safeDecode(new URL(String(dbUrl).trim()).password).value;
  const allowed = target.allowedQueryParameters;
  const query =
    allowed.length === 0
      ? ""
      : `?${allowed.map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`).join("&")}`;

  const connectionConfig = Object.freeze({
    host: target.hostname,
    port: Number(target.port),
    database: target.database,
    user: target.username,
    password,
  });
  const canonicalConnectionString =
    `${target.scheme}//${encodeURIComponent(target.username)}:${encodeURIComponent(password)}` +
    `@${target.hostname}:${target.port}/${target.database}${query}`;

  const redacted = {
    host: target.hostname,
    port: target.port,
    database: target.database,
    username: target.username,
    projectRef: target.projectRef,
    allowedQueryParameters: allowed,
    connectionConfig: "«REDACTED»",
    canonicalConnectionString: "«REDACTED-DSN»",
  };
  return Object.freeze({
    projectRef: target.projectRef,
    host: target.hostname,
    port: target.port,
    database: target.database,
    username: target.username,
    allowedQueryParameters: allowed,
    connectionConfig,
    canonicalConnectionString,
    toJSON: () => redacted,
    [Symbol.for("nodejs.util.inspect.custom")]: () => redacted,
  });
}

export function isLocalUrl(dbUrl) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") return false;
  try {
    return isLoopbackAddress(new URL(dbUrl.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * Assert that a hosted deployment may proceed against this exact target.
 *
 * Every limb must clear. Throws `HostedTargetRefusal` with a specific code.
 * Performs NO I/O: when this throws, nothing has been dialled.
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
      "REFUSED: this is a LOCAL or literal-IP database. Use `pnpm db:apply` / `pnpm db:reset`; the hosted command never touches local stacks.",
    );
  }

  if (environment !== ALLOWED_HOSTED_DEV.environment) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-ENV-NOT-ALLOWED",
      `REFUSED: environment '${String(environment)}' is not deployable by this command. Only '${ALLOWED_HOSTED_DEV.environment}' is, and only for ${ALLOWED_HOSTED_DEV.projectRef}. Pilot and production have separately approved promotion paths.`,
    );
  }

  // Canonical parse. Throws with a specific code for scheme, host, port,
  // database, username, query parameters and host/username reference disagreement.
  const target = parseHostedTargetUrl(dbUrl);
  const parsedUrl = new URL(dbUrl.trim());

  if (target.projectRef !== ALLOWED_HOSTED_DEV.projectRef) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-REF-NOT-ALLOWED",
      `REFUSED: project '${target.projectRef}' is not the authorised hosted development project. Only ${ALLOWED_HOSTED_DEV.projectRef} (${ALLOWED_HOSTED_DEV.name}) may be deployed to.`,
    );
  }

  // When the caller also names a ref, it must agree with the connection.
  // A mismatch means the operator believes they are dialling a different
  // database than they are, which is exactly when to stop.
  if (declaredProjectRef !== undefined && declaredProjectRef !== target.projectRef) {
    throw new HostedTargetRefusal(
      "KLUY-DEPLOY-REF-MISMATCH",
      `REFUSED: the declared project '${String(declaredProjectRef)}' does not match the connection's project '${target.projectRef}'.`,
    );
  }

  // ===========================================================================
  // THE CANONICAL TARGET. (Finding D-20.)
  // ===========================================================================
  // The original string does NOT get to come back after validation. Callers are
  // given rebuilt values — a sanitized `connectionConfig` for `pg`, and a
  // `canonicalConnectionString` for tooling that only accepts a DSN — both
  // assembled from the fields THIS function verified, plus the allowlisted TLS
  // parameters and nothing else.
  //
  // The password is carried through because callers need it, and is kept out of
  // logs by `toJSON` and the custom inspect hook below: `console.log(target)`,
  // `JSON.stringify(target)` and template interpolation of the nested config all
  // render a redaction rather than the secret.
  const password = safeDecode(parsedUrl.password).value;
  const allowed = target.allowedQueryParameters;

  const canonicalQuery =
    allowed.length === 0
      ? ""
      : `?${allowed.map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(q.value)}`).join("&")}`;

  const canonicalConnectionString =
    `${target.scheme}//${encodeURIComponent(target.username)}:${encodeURIComponent(password)}` +
    `@${target.hostname}:${target.port}/${target.database}${canonicalQuery}`;

  const connectionConfig = Object.freeze({
    host: target.hostname,
    port: Number(target.port),
    database: target.database,
    user: target.username,
    password,
  });

  const redacted = {
    projectRef: target.projectRef,
    environment,
    name: ALLOWED_HOSTED_DEV.name,
    host: target.hostname,
    port: target.port,
    database: target.database,
    username: target.username,
    allowedQueryParameters: allowed,
    canonicalConnectionString: "«REDACTED-DSN»",
    connectionConfig: "«REDACTED»",
  };

  return Object.freeze({
    projectRef: target.projectRef,
    environment,
    name: ALLOWED_HOSTED_DEV.name,
    hostname: target.hostname,
    hostForm: target.hostForm,
    host: target.hostname,
    port: target.port,
    database: target.database,
    username: target.username,
    /** Allowlisted TLS parameters only. H-2 governs what they must be. */
    allowedQueryParameters: allowed,
    observedQueryParameters: allowed,
    /** Pass THIS to pg.Client — never the original string. */
    connectionConfig,
    /** For tooling that only takes a DSN (the Supabase CLI). Carries the password. */
    canonicalConnectionString,
    toJSON: () => redacted,
    [Symbol.for("nodejs.util.inspect.custom")]: () => redacted,
  });
}

/**
 * The ONLY Supabase HTTPS API origin this repository may send hosted-development
 * credentials to. DERIVED from the one project literal above — not a second
 * copy of it — so the allowlist cannot drift between the SQL door and the API
 * door.
 */
export const APPROVED_HOSTED_DEV_API_ORIGIN = `https://${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`;

/**
 * Assert that a Supabase HTTPS API target may receive hosted-development
 * credentials. (Finding D-18.)
 *
 * ===========================================================================
 * WHY THIS EXISTS INSTEAD OF REUSING assertHostedDevTarget
 * ===========================================================================
 * `assertHostedDevTarget` validates a POSTGRESQL DSN: a `postgresql:` scheme,
 * a pooler or direct database host, a session-mode port, a database name and a
 * `postgres.<ref>` username. None of those limbs exist on an HTTPS API URL, and
 * fabricating a fake DSN just to reach that function would mean validating a
 * string nobody ever connects to — a check that passes while the real request
 * goes somewhere else. That is the H-1 mistake in a new costume.
 *
 * So the API door gets its OWN assertion with the limbs an origin actually has,
 * and shares the ONE thing that must never diverge: `ALLOWED_HOSTED_DEV`.
 *
 * ===========================================================================
 * WHY IT RETURNS THE ORIGIN
 * ===========================================================================
 * The caller builds request URLs by STRING CONCATENATION
 * (`${supabaseUrl}/auth/v1/admin/users`). Validating the configured string and
 * then concatenating onto that same string leaves the door open to anything the
 * parser normalised away. Callers must therefore use the `origin` this function
 * returns — a canonical `https://<ref>.supabase.co` with no trailing slash —
 * and never the raw configuration value.
 *
 * `https:` is a SPECIAL scheme, so Node lowercases the host and applies IDNA:
 * a Unicode homoglyph arrives here already punycoded to `xn--…` and cannot
 * equal the literal. A trailing dot is NOT stripped and is refused.
 *
 * Performs NO I/O. When this throws, nothing has been dialled and no credential
 * has left the process.
 */
export function assertHostedDevApiTarget({ apiUrl, environment, declaredProjectRef } = {}) {
  if (typeof apiUrl !== "string" || apiUrl.trim() === "") {
    throw new HostedTargetRefusal(
      "KLUY-API-NO-TARGET",
      "REFUSED: no Supabase API URL was supplied.",
    );
  }

  if (environment !== ALLOWED_HOSTED_DEV.environment) {
    throw new HostedTargetRefusal(
      "KLUY-API-ENV-NOT-ALLOWED",
      `REFUSED: environment '${String(environment)}' may not receive hosted-development credentials. Only '${ALLOWED_HOSTED_DEV.environment}' may, and only for ${ALLOWED_HOSTED_DEV.projectRef}.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(apiUrl.trim());
  } catch {
    throw new HostedTargetRefusal(
      "KLUY-API-URL-MALFORMED",
      "REFUSED: the Supabase API URL is not a parseable URL.",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new HostedTargetRefusal(
      "KLUY-API-SCHEME-NOT-ALLOWED",
      `REFUSED: scheme '${parsed.protocol}' is not https. A service-role key is never sent over a non-TLS scheme.`,
    );
  }

  // A URL carrying userinfo is never a legitimate Supabase API origin, and it is
  // the classic way to make a hostile host read as an approved one.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new HostedTargetRefusal(
      "KLUY-API-USERINFO-PRESENT",
      "REFUSED: the Supabase API URL carries embedded credentials; an origin never does.",
    );
  }

  // THE CONTROL. Exact, after Node's own lowercasing and IDNA mapping.
  if (parsed.hostname !== `${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`) {
    throw new HostedTargetRefusal(
      "KLUY-API-HOST-NOT-APPROVED",
      `REFUSED: host '${parsed.hostname}' is not the approved hosted-development API host. ` +
        "No project reference in the path, query, fragment or credentials authorises a different origin. " +
        `Approved: ${APPROVED_HOSTED_DEV_API_ORIGIN}.`,
    );
  }

  // 443 is normalised away by the parser; anything else is a different endpoint.
  if (parsed.port !== "") {
    throw new HostedTargetRefusal(
      "KLUY-API-PORT-NOT-CANONICAL",
      `REFUSED: port '${parsed.port}' is not the canonical https port.`,
    );
  }

  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new HostedTargetRefusal(
      "KLUY-API-PATH-NOT-ORIGIN",
      `REFUSED: the Supabase API URL must be a bare origin; got path '${parsed.pathname}'.`,
    );
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new HostedTargetRefusal(
      "KLUY-API-QUERY-NOT-ALLOWED",
      "REFUSED: the Supabase API URL must be a bare origin; it carries a query or fragment.",
    );
  }

  const refFromHost = /^([a-z0-9]{20})\.supabase\.co$/i.exec(parsed.hostname)?.[1]?.toLowerCase();
  if (refFromHost !== ALLOWED_HOSTED_DEV.projectRef) {
    throw new HostedTargetRefusal(
      "KLUY-API-REF-NOT-ALLOWED",
      `REFUSED: project '${refFromHost ?? "(unresolvable)"}' is not the authorised hosted development project.`,
    );
  }
  if (declaredProjectRef !== undefined && declaredProjectRef !== refFromHost) {
    throw new HostedTargetRefusal(
      "KLUY-API-REF-MISMATCH",
      `REFUSED: the declared project '${String(declaredProjectRef)}' does not match the API origin's project '${refFromHost}'.`,
    );
  }

  return Object.freeze({
    projectRef: refFromHost,
    environment,
    name: ALLOWED_HOSTED_DEV.name,
    // Callers MUST build requests from this, never from the configured string.
    origin: APPROVED_HOSTED_DEV_API_ORIGIN,
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
