/**
 * The device's release trust registry: `/etc/kitluy/trust`.
 *
 * ===========================================================================
 * WRONG-PURPOSE KEYS ARE REFUSED HERE, BEFORE THE VERIFIER SEES THEM
 * ===========================================================================
 * KLD-2026-07-28-002 §1/§7 requires the six signing purposes to stay separate:
 * "a key used for one purpose must not be reused for another". The canonical
 * release-manifest verifier matches a key by (keyId, keyVersion) and refuses a
 * revoked one — but it has no notion of PURPOSE, so a key minted for device
 * identity or transport signing would verify a release manifest perfectly well
 * if somebody registered it here.
 *
 * The owner listed exactly that case among the failures U1 must handle. This
 * module is the answer, and it is placed deliberately:
 *
 *   - in the LOADER, not in the verifier, so the canonical contract in
 *     @kitluy/device-identity is unchanged and the Store Hub needs no migration
 *     (its `release_trust_key` table has no purpose column);
 *   - BEFORE verification, so a wrong-purpose key never reaches crypto at all.
 *
 * Binding the purpose into the SIGNED BYTES is a manifest-v2 change and remains
 * a pre-Pilot item. This closes the realistic failure — a key registered by
 * mistake — at the cost of one field and one comparison.
 *
 * ===========================================================================
 * PUBLIC MATERIAL ONLY, AND IT IS CHECKED
 * ===========================================================================
 * A record carrying a PRIVATE KEY block is refused even if every other field is
 * right, mirroring `scripts/pki/trust-anchor-bootstrap.mjs`, which refuses the
 * same thing on the way in. A device never holds a signing key; the cheapest
 * place to enforce that is where the file is read.
 *
 * ===========================================================================
 * ABSENT IS SAFE
 * ===========================================================================
 * No directory, no records, or nothing valid => an EMPTY registry, and the
 * caller refuses to consider any payload. That is the posture the update agent
 * has had since it was written ("no public release trust anchor ... refusing to
 * consider any payload") and it is preserved exactly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TrustedReleaseKey } from "./release-verify.js";

export const TRUST_ANCHOR_DIR = "/etc/kitluy/trust";

/** The only purpose a release-manifest key may carry. */
export const RELEASE_SIGNING_PURPOSE = "release_signing";

const TRUST_RECORD_KIND = "kitluy.release-trust-key.v1";
const PRIVATE_KEY_MARKER = "PRIVATE KEY";

export type TrustRecordRefusal =
  | "TRUST_RECORD_UNPARSEABLE"
  | "TRUST_RECORD_WRONG_KIND"
  | "TRUST_RECORD_CARRIES_PRIVATE_KEY"
  | "TRUST_RECORD_WRONG_PURPOSE"
  | "TRUST_RECORD_WRONG_ENVIRONMENT"
  | "TRUST_RECORD_MALFORMED";

export interface RejectedTrustRecord {
  readonly file: string;
  readonly refusal: TrustRecordRefusal;
  readonly detail: string;
}

export interface TrustRegistry {
  readonly keys: readonly TrustedReleaseKey[];
  /** Every record that was refused, so a silent empty registry is impossible
   * to confuse with a directory full of rejected files. */
  readonly rejected: readonly RejectedTrustRecord[];
}

interface RawTrustRecord {
  kind?: unknown;
  keyId?: unknown;
  keyVersion?: unknown;
  algorithm?: unknown;
  purpose?: unknown;
  environment?: unknown;
  state?: unknown;
  publicKeyPem?: unknown;
}

function evaluate(
  file: string,
  contents: string,
  environment: string | undefined,
): TrustedReleaseKey | RejectedTrustRecord {
  // Checked on the RAW TEXT, before parsing: a record whose JSON is malformed
  // could still contain a key, and refusing to read further is the point.
  if (contents.includes(PRIVATE_KEY_MARKER)) {
    return {
      file,
      refusal: "TRUST_RECORD_CARRIES_PRIVATE_KEY",
      detail: "a trust record must carry public material only",
    };
  }

  let raw: RawTrustRecord;
  try {
    raw = JSON.parse(contents) as RawTrustRecord;
  } catch (error) {
    return {
      file,
      refusal: "TRUST_RECORD_UNPARSEABLE",
      detail: String((error as Error).message ?? error),
    };
  }

  if (raw.kind !== TRUST_RECORD_KIND) {
    return { file, refusal: "TRUST_RECORD_WRONG_KIND", detail: `kind=${String(raw.kind)}` };
  }
  if (raw.purpose !== RELEASE_SIGNING_PURPOSE) {
    return {
      file,
      refusal: "TRUST_RECORD_WRONG_PURPOSE",
      detail: `purpose=${String(raw.purpose)}; only ${RELEASE_SIGNING_PURPOSE} may verify a release manifest`,
    };
  }
  // A development trust anchor on a pilot or production device is a trust-chain
  // crossing, which KLD-2026-07-28-002 §1 forbids in both directions. The device
  // states its own environment in /etc/kitluy/image.env; an image that stated
  // none reads as undefined and every record is refused.
  if (environment === undefined || raw.environment !== environment) {
    return {
      file,
      refusal: "TRUST_RECORD_WRONG_ENVIRONMENT",
      detail: `record environment=${String(raw.environment)}, device environment=${String(environment)}`,
    };
  }
  if (
    typeof raw.keyId !== "string" ||
    raw.keyId === "" ||
    typeof raw.keyVersion !== "number" ||
    !Number.isInteger(raw.keyVersion) ||
    raw.keyVersion < 1 ||
    typeof raw.publicKeyPem !== "string" ||
    !raw.publicKeyPem.includes("PUBLIC KEY")
  ) {
    return { file, refusal: "TRUST_RECORD_MALFORMED", detail: "keyId, keyVersion or publicKeyPem" };
  }
  const state = raw.state === "next" || raw.state === "revoked" ? raw.state : "current";
  return {
    keyId: raw.keyId,
    keyVersion: raw.keyVersion,
    publicKeyPem: raw.publicKeyPem,
    state,
    purpose: RELEASE_SIGNING_PURPOSE,
  };
}

function isRejected(value: TrustedReleaseKey | RejectedTrustRecord): value is RejectedTrustRecord {
  return "refusal" in value;
}

/**
 * Load every valid release trust anchor. Never throws: an unreadable directory
 * is an empty registry, which the caller treats as "refuse to look for an
 * update", not as an error to retry around.
 */
export function loadReleaseTrustRegistry(options: {
  readonly trustDir?: string;
  readonly environment: string | undefined;
}): TrustRegistry {
  const directory = options.trustDir ?? TRUST_ANCHOR_DIR;
  let files: string[];
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return { keys: [], rejected: [] };
  }

  const keys: TrustedReleaseKey[] = [];
  const rejected: RejectedTrustRecord[] = [];
  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(join(directory, file), "utf8");
    } catch (error) {
      rejected.push({
        file,
        refusal: "TRUST_RECORD_UNPARSEABLE",
        detail: String((error as Error).message ?? error),
      });
      continue;
    }
    const result = evaluate(file, contents, options.environment);
    if (isRejected(result)) rejected.push(result);
    else keys.push(result);
  }
  return { keys, rejected };
}
