/**
 * The Store Hub runtime — the parts that decide whether this Hub may serve.
 *
 * ===========================================================================
 * WHY THIS IS SEPARATE FROM `main.ts`
 * ===========================================================================
 * `main.ts` is a process: it reads an environment, opens sockets and exits. The
 * DECISIONS — is the schema the one this release expects, is there certificate
 * material, may this Hub serve terminals at all — are the part worth testing,
 * and they cannot be tested through a process that binds a port.
 *
 * So every refusal lives here as a pure function over observations, and `main.ts`
 * does nothing but gather the observations and act on the verdict.
 *
 * ===========================================================================
 * THE HUB REFUSES TO SERVE RATHER THAN SERVE WRONGLY
 * ===========================================================================
 * A Store Hub is the local authority for a shop: it holds the till, the
 * bookings and the money. A Hub that serves terminals from a schema it does not
 * recognise, or with a certificate it cannot prove, is worse than a Hub that is
 * plainly down — the shop keeps trading on answers nobody can stand behind.
 *
 * Every refusal below therefore fails CLOSED and names its cause.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import {
  evaluateHubSafety,
  type HubMigrationEntry,
  type HubSafetyAssessment,
  type HubSafetyObservations,
} from "./hub/safety-mode.js";

/** Owner package §3. A terminal rejects a discovery record on any other port. */
export const HUB_LAN_PORT = 7443 as const;

// ---------------------------------------------------------------------------
// 1. Where the Hub may listen
// ---------------------------------------------------------------------------

/**
 * Wildcards `createEdgeTlsServer` refuses. Restated here so the runtime can
 * explain the problem BEFORE constructing a server that would throw.
 */
const WILDCARD_BINDS = new Set(["0.0.0.0", "::", "*", ""]);

export type BindResolution =
  | { readonly kind: "resolved"; readonly bindHost: string; readonly interfaceName: string }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

/**
 * Resolve the Store-LAN address to bind.
 *
 * The owner package requires an APPROVED INTERFACE, named explicitly — a
 * wildcard bind on a shop's network would expose the Hub to whatever else is on
 * that wire, including a guest wifi bridged by a router nobody audited.
 *
 * A configured value wins and is validated. With nothing configured, exactly one
 * non-loopback IPv4 interface is acceptable: if a Hub has two, choosing for it
 * would be a guess about which network the shop's terminals are on, and the
 * wrong guess is a Hub that is silently unreachable.
 */
export function resolveBindHost(
  configured: string | undefined,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): BindResolution {
  if (configured !== undefined && configured.trim() !== "") {
    const value = configured.trim();
    if (WILDCARD_BINDS.has(value)) {
      return {
        kind: "refused",
        code: "KLUY-HUB-BIND-WILDCARD",
        detail: `HUB_LAN_BIND_HOST=${value} is a wildcard; the Store LAN listener binds one named interface (owner package §3)`,
      };
    }
    return { kind: "resolved", bindHost: value, interfaceName: "configured" };
  }

  const candidates: { name: string; address: string }[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    // Virtual and container interfaces are not the shop's network. A Hub that
    // bound a docker bridge would look healthy and serve nobody.
    if (/^(lo|docker|br-|veth|virbr|tailscale|wg)/.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      kind: "refused",
      code: "KLUY-HUB-BIND-NO-INTERFACE",
      detail: "no non-loopback IPv4 interface exists; a terminal would have nothing to dial",
    };
  }
  if (candidates.length > 1) {
    return {
      kind: "refused",
      code: "KLUY-HUB-BIND-AMBIGUOUS",
      detail:
        `more than one Store-LAN candidate (${candidates.map((c) => `${c.name}=${c.address}`).join(", ")}); ` +
        "set HUB_LAN_BIND_HOST explicitly rather than have the Hub guess which network the terminals are on",
    };
  }
  const only = candidates[0]!;
  return { kind: "resolved", bindHost: only.address, interfaceName: only.name };
}

// ---------------------------------------------------------------------------
// 2. Whether there is certificate material at all
// ---------------------------------------------------------------------------

export interface TlsMaterialPaths {
  readonly keyPath: string | undefined;
  readonly certPath: string | undefined;
  readonly clientCaPath: string | undefined;
}

export type TlsMaterial =
  | {
      readonly kind: "present";
      readonly key: string;
      readonly cert: string;
      readonly clientCa: string;
    }
  | { readonly kind: "absent"; readonly code: string; readonly detail: string };

/**
 * Load the Hub's TLS material, or explain precisely why it is missing.
 *
 * ===========================================================================
 * THIS FUNCTION DOES NOT GENERATE ANYTHING, AND THAT IS THE POINT
 * ===========================================================================
 * Terminal mTLS needs a Hub server certificate and a device CA that terminal
 * certificates chain to. Both are PKI decisions — issuance authority, key
 * custody, rotation window, revocation propagation — and all of them are
 * **BLK-005**, owner-locked and unanswered.
 *
 * A self-signed certificate minted here would make the Hub *appear* to work
 * while pinning terminals to a trust root nobody approved, and it would put a
 * private key on a device whose image is required to carry none
 * (KLSRC-0162 §34). The test suites mint their own CAs precisely because that is
 * a TEST concern; those helpers are deliberately test-local and are not promoted
 * here.
 *
 * So a Hub with no certificate material does not serve. It says so.
 */
export function loadTlsMaterial(
  paths: TlsMaterialPaths,
  read: (path: string) => string = (p) => readFileSync(p, "utf8"),
  exists: (path: string) => boolean = existsSync,
): TlsMaterial {
  const missing: string[] = [];
  if (paths.keyPath === undefined || paths.keyPath === "") missing.push("HUB_TLS_KEY_PATH");
  if (paths.certPath === undefined || paths.certPath === "") missing.push("HUB_TLS_CERT_PATH");
  if (paths.clientCaPath === undefined || paths.clientCaPath === "") {
    missing.push("HUB_DEVICE_CA_PATH");
  }
  if (missing.length > 0) {
    return {
      kind: "absent",
      code: "KLUY-HUB-TLS-UNCONFIGURED",
      detail:
        `no terminal-facing certificate material is configured (${missing.join(", ")}). ` +
        "Hub and device certificate issuance is BLK-005 and unanswered; nothing is generated here.",
    };
  }

  const unreadable = [paths.keyPath!, paths.certPath!, paths.clientCaPath!].filter(
    (p) => !exists(p),
  );
  if (unreadable.length > 0) {
    return {
      kind: "absent",
      code: "KLUY-HUB-TLS-MISSING",
      detail: `configured certificate material does not exist: ${unreadable.join(", ")}`,
    };
  }

  return {
    kind: "present",
    key: read(paths.keyPath!),
    cert: read(paths.certPath!),
    clientCa: read(paths.clientCaPath!),
  };
}

/**
 * The fingerprint a discovery record must carry.
 *
 * SHA-256 over the certificate's DER bytes, lowercase hex — the same value
 * `fingerprint256` yields for a peer, with separators removed. A terminal pins
 * the handshake against this, so computing it differently here than the
 * transport reports it there would break every pairing with a valid signature.
 */
export function certificateFingerprint(certPem: string): string {
  const body = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(body, "base64")).digest("hex");
}

// ---------------------------------------------------------------------------
// 3. Whether the database is the one this release expects
// ---------------------------------------------------------------------------

export interface SchemaVerdict {
  readonly ok: boolean;
  readonly code?: string;
  readonly detail?: string;
}

/**
 * Compare the migration set this release expects against what the Hub database
 * reports, BEFORE serving anything.
 *
 * Three distinct failures, kept distinct because the operator action differs:
 * a PENDING migration needs applying, a DRIFTED one means an applied file was
 * edited (schema contract §4 forbids it, and the checksum is how that is
 * caught), and an UNKNOWN applied migration means this Hub is running an older
 * release than its database.
 */
export function evaluateSchema(
  expected: readonly HubMigrationEntry[],
  applied: readonly HubMigrationEntry[],
): SchemaVerdict {
  const appliedByName = new Map(applied.map((m) => [m.filename, m.checksumSha256]));
  const expectedByName = new Map(expected.map((m) => [m.filename, m.checksumSha256]));

  const drifted = expected.filter((m) => {
    const seen = appliedByName.get(m.filename);
    return seen !== undefined && seen !== m.checksumSha256;
  });
  if (drifted.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-DRIFT",
      detail:
        `${drifted.length} applied migration(s) no longer match the bytes this release expects ` +
        `(${drifted.map((m) => m.filename).join(", ")}). An applied migration is never edited (schema contract §4).`,
    };
  }

  const pending = expected.filter((m) => !appliedByName.has(m.filename));
  if (pending.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-PENDING",
      detail: `${pending.length} migration(s) are not applied (${pending[0]!.filename} first).`,
    };
  }

  const unknown = applied.filter((m) => !expectedByName.has(m.filename));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "KLUY-HUB-SCHEMA-AHEAD",
      detail:
        `the database has ${unknown.length} migration(s) this release does not know ` +
        `(${unknown[0]!.filename} first); this Hub is older than its own database.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 3b. Whether the volume under the database is bound to this board
// ---------------------------------------------------------------------------

/**
 * The label `hub-storage-provision` writes to `/var/lib/kitluy/storage-posture`.
 *
 * `OTP-BOUND` means the LUKS key is derived from this board's OTP fuses, so the
 * drive is ciphertext in any other machine. `DEVELOPMENT-UNBOUND` means it is
 * NOT — the key is a file, and anyone holding it can read the volume anywhere.
 *
 * Absent means the volume was not provisioned by that script at all (a developer
 * workstation, for instance). That is not the case this rule exists to catch, so
 * it does not refuse; the database and schema checks already govern it.
 */
export type StoragePosture = "OTP-BOUND" | "DEVELOPMENT-UNBOUND" | undefined;

/**
 * Refuse to serve a shop from a volume that is not bound to its Hub.
 *
 * The development storage fallback exists so that irreversible OTP programming
 * does not block software development. It is not a security posture a Store may
 * trade on: a stolen drive from such a Hub is readable, which is the exact
 * property the encryption was specified to provide.
 *
 * So the fallback is refused anywhere but `development`, in the runtime as well
 * as in the provisioner. Two independent gates, because the provisioner's gate
 * lives on the device and an image could in principle be built wrong.
 */
export function evaluateStoragePosture(
  posture: StoragePosture,
  environment: string,
): SchemaVerdict {
  if (posture === "DEVELOPMENT-UNBOUND" && environment !== "development") {
    return {
      ok: false,
      code: "KLUY-HUB-STORAGE-UNBOUND",
      detail:
        `the data volume was provisioned with a DEVELOPMENT-UNBOUND key and this Hub is running in "${environment}". ` +
        "That key is not bound to this board, so the volume is readable off it; a Store is not served from one. " +
        "Program the board's OTP key and re-provision the volume.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 4. The whole verdict
// ---------------------------------------------------------------------------

export interface HubStartupObservations {
  readonly databaseReachable: boolean;
  readonly schema: SchemaVerdict;
  readonly tls: TlsMaterial;
  readonly bind: BindResolution;
  readonly safety: HubSafetyObservations;
  /**
   * Optional so every existing caller keeps compiling. Absent is the honest
   * reading of "no posture file", which {@link evaluateStoragePosture} treats as
   * not-this-rule's-business rather than as a pass.
   */
  readonly storage?: SchemaVerdict;
}

export type HubStartupVerdict =
  | {
      readonly kind: "serve";
      readonly bindHost: string;
      readonly assessment: HubSafetyAssessment;
    }
  | {
      readonly kind: "refuse";
      readonly code: string;
      readonly detail: string;
      /** Present when the refusal was reached with a usable assessment. */
      readonly assessment?: HubSafetyAssessment;
    };

/**
 * Decide whether this Hub serves terminals.
 *
 * ORDER IS DELIBERATE and runs cheapest-and-most-fundamental first, so the
 * message an operator sees names the FIRST thing that is wrong rather than a
 * downstream consequence of it. A Hub with no database has no schema; saying
 * "schema pending" there would send someone to run migrations against nothing.
 *
 * `degraded` does NOT refuse. Safety mode exists so a Hub keeps a shop trading
 * in a reduced state — read-only, disk pressure, a clock warning — and turning
 * every degradation into a refusal would replace a working till with a dead one.
 * Only the conditions above, which make answers untrustworthy rather than
 * limited, stop the Hub serving.
 */
export function decideStartup(observations: HubStartupObservations): HubStartupVerdict {
  if (!observations.databaseReachable) {
    return {
      kind: "refuse",
      code: "KLUY-HUB-DB-UNREACHABLE",
      detail:
        "the local Hub database is not reachable; a Hub is the Store's authority and cannot serve without it",
    };
  }

  // Before the schema, because a volume nobody can stand behind makes the
  // question of which migrations it holds beside the point.
  if (observations.storage !== undefined && !observations.storage.ok) {
    return {
      kind: "refuse",
      code: observations.storage.code ?? "KLUY-HUB-STORAGE-REFUSED",
      detail:
        observations.storage.detail ?? "the Hub data volume is not acceptable for this environment",
    };
  }

  if (!observations.schema.ok) {
    return {
      kind: "refuse",
      code: observations.schema.code ?? "KLUY-HUB-SCHEMA-REFUSED",
      detail: observations.schema.detail ?? "the Hub schema is not the one this release expects",
    };
  }

  const assessment = evaluateHubSafety(observations.safety);

  if (observations.bind.kind === "refused") {
    return {
      kind: "refuse",
      code: observations.bind.code,
      detail: observations.bind.detail,
      assessment,
    };
  }

  if (observations.tls.kind === "absent") {
    return {
      kind: "refuse",
      code: observations.tls.code,
      detail: observations.tls.detail,
      assessment,
    };
  }

  return { kind: "serve", bindHost: observations.bind.bindHost, assessment };
}
