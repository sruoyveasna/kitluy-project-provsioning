/**
 * TERMINAL SYNC — a Store Hub provisions its own terminals from the cloud
 * (HUB-TERMINAL-SYNC-001, owner ruling 2026-09-19: "I am not able to ask you
 * to do it every time like this").
 *
 * ===========================================================================
 * THE LOOP
 * ===========================================================================
 *   every HUB_SYNC_INTERVAL_SECONDS (60), and once at start:
 *     1. read what the board holds: pairing state (my Store), identity key,
 *        operational certificate, board serial;
 *     2. POST a request SIGNED by the identity key to HUB_SYNC_URL;
 *     3. VERIFY the answer against the hub-sync trust record baked into the
 *        image (/etc/kitluy/hub-sync-trust.json): signature, key id, my own
 *        device id, my own scope, the nonce I sent, freshness;
 *     4. apply it (apply.ts): Hub self-projection, every terminal, and the
 *        configuration with all grants — only when the grant set changed;
 *     5. write a small public state file so an operator can see the last sync.
 *
 * ===========================================================================
 * DEVELOPMENT ONLY, FAIL CLOSED
 * ===========================================================================
 * The projections it writes are the ones `hub-provision-terminal` wrote by
 * hand, and that door refuses outside `development`; so does this. With no
 * HUB_SYNC_URL, no trust record, or a record for another environment it does
 * NOTHING and says why once at start — a Hub never provisions terminals from
 * a source it cannot verify. The production path (BLK-006: a cloud producer
 * with owner-approved signer custody, BLK-005) replaces the source, not this
 * consumer's shape.
 *
 * NO SECRET LEAVES THE BOARD. The identity private key signs locally and is
 * never sent; the request carries the PUBLIC key. Nothing in the answer is
 * secret either. The log never carries a PEM, a signature or a nonce.
 */
import { createPrivateKey, createPublicKey, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type pg from "pg";

import {
  applyEnvelope,
  parseTerminalDelivery,
  type ApplyOutcome,
  type HubScope,
  type HubSelfFacts,
  type TerminalDelivery,
} from "./apply.js";
import {
  HUB_SYNC_ENVELOPE_KIND,
  HUB_SYNC_REQUEST_KIND,
  HUB_SYNC_SIGNING_PURPOSE,
  HUB_SYNC_TRUST_RECORD_KIND,
  NONCE,
  REQUEST_MAX_SKEW_SECONDS,
  SIGNATURE,
  UUID,
  hubSyncEnvelopeBytes,
  hubSyncRequestBytes,
  publicKeyFingerprint,
  signBytes,
  verifyBytes,
} from "./contract.js";

export { applyEnvelope, parseTerminalDelivery } from "./apply.js";
export type { ApplyOutcome, TerminalDelivery, HubSelfFacts } from "./apply.js";

export const HUB_SYNC_TRUST_PATH = "/etc/kitluy/hub-sync-trust.json";
export const HUB_SYNC_STATE_PATH = "/var/lib/kitluy/hub/terminal-sync.json";
export const HUB_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
export const HUB_PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";
export const HUB_BOARD_SERIAL_PATH = "/sys/firmware/devicetree/base/serial-number";
export const DEFAULT_SYNC_INTERVAL_SECONDS = 60;
export const SYNC_ROUTE = "/hub-sync/v1/terminal-projections";

export interface TerminalSyncConfig {
  readonly url: string;
  readonly environment: string;
  readonly trustPath: string;
  readonly statePath: string;
  readonly identityKeyPath: string;
  readonly pairingStatePath: string;
  readonly operationalCertificatePath: string;
  readonly boardSerialPath: string;
  readonly intervalSeconds: number;
}

/** Read the configuration from the unit's environment; `null` = sync disabled. */
export function terminalSyncConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { readonly config: TerminalSyncConfig } | { readonly disabled: string } {
  const url = (env.HUB_SYNC_URL ?? "").trim();
  if (url === "") return { disabled: "HUB_SYNC_URL is not set" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { disabled: "HUB_SYNC_URL is not a URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { disabled: "HUB_SYNC_URL must be http or https" };
  }
  const interval = Number(env.HUB_SYNC_INTERVAL_SECONDS ?? DEFAULT_SYNC_INTERVAL_SECONDS);
  return {
    config: {
      url: parsed.origin,
      environment: env.KITLUY_ENVIRONMENT ?? "unknown",
      trustPath: env.HUB_SYNC_TRUST_PATH ?? HUB_SYNC_TRUST_PATH,
      statePath: env.HUB_SYNC_STATE_PATH ?? HUB_SYNC_STATE_PATH,
      identityKeyPath: env.HUB_IDENTITY_KEY_PATH ?? HUB_IDENTITY_KEY_PATH,
      pairingStatePath: env.HUB_PAIRING_STATE_PATH ?? HUB_PAIRING_STATE_PATH,
      operationalCertificatePath:
        env.HUB_TLS_CERT_PATH ?? "/var/lib/kitluy/operational/operational-tls.crt.pem",
      boardSerialPath: env.HUB_BOARD_SERIAL_PATH ?? HUB_BOARD_SERIAL_PATH,
      intervalSeconds:
        Number.isFinite(interval) && interval >= 10 ? interval : DEFAULT_SYNC_INTERVAL_SECONDS,
    },
  };
}

// ---------------------------------------------------------------------------
// Trust: the producer's PUBLIC key, from the image.
// ---------------------------------------------------------------------------

export interface HubSyncTrust {
  readonly keyId: string;
  readonly keyVersion: number;
  readonly publicKey: KeyObject;
}

export type TrustRefusal =
  | "TRUST_RECORD_MISSING"
  | "TRUST_RECORD_UNPARSEABLE"
  | "TRUST_RECORD_CARRIES_PRIVATE_KEY"
  | "TRUST_RECORD_WRONG_KIND"
  | "TRUST_RECORD_WRONG_PURPOSE"
  | "TRUST_RECORD_WRONG_ENVIRONMENT"
  | "TRUST_RECORD_MALFORMED";

/** Same posture as the release trust loader: public material only, or nothing. */
export function loadHubSyncTrust(
  path: string,
  environment: string,
):
  | { readonly ok: true; readonly trust: HubSyncTrust }
  | { readonly ok: false; readonly refusal: TrustRefusal; readonly detail: string } {
  if (!existsSync(path)) return { ok: false, refusal: "TRUST_RECORD_MISSING", detail: path };
  const contents = readFileSync(path, "utf8");
  if (contents.includes("PRIVATE KEY")) {
    return { ok: false, refusal: "TRUST_RECORD_CARRIES_PRIVATE_KEY", detail: path };
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(contents) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_UNPARSEABLE",
      detail: String((error as Error).message),
    };
  }
  if (raw["kind"] !== HUB_SYNC_TRUST_RECORD_KIND) {
    return { ok: false, refusal: "TRUST_RECORD_WRONG_KIND", detail: `kind=${String(raw["kind"])}` };
  }
  if (raw["purpose"] !== HUB_SYNC_SIGNING_PURPOSE) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_WRONG_PURPOSE",
      detail: `purpose=${String(raw["purpose"])}`,
    };
  }
  if (raw["environment"] !== environment) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_WRONG_ENVIRONMENT",
      detail: `record=${String(raw["environment"])}, hub=${environment}`,
    };
  }
  const keyId = raw["keyId"];
  const keyVersion = raw["keyVersion"];
  const pem = raw["publicKeyPem"];
  if (
    typeof keyId !== "string" ||
    typeof pem !== "string" ||
    typeof keyVersion !== "number" ||
    !Number.isInteger(keyVersion) ||
    keyVersion < 1 ||
    raw["algorithm"] !== "ed25519" ||
    raw["state"] !== "current"
  ) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_MALFORMED",
      detail: "keyId/keyVersion/publicKeyPem/algorithm/state",
    };
  }
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    return { ok: false, refusal: "TRUST_RECORD_MALFORMED", detail: "publicKeyPem does not parse" };
  }
  if (publicKey.asymmetricKeyType !== "ed25519" || publicKeyFingerprint(pem) !== keyId) {
    return {
      ok: false,
      refusal: "TRUST_RECORD_MALFORMED",
      detail: "keyId is not the key's fingerprint",
    };
  }
  return { ok: true, trust: { keyId, keyVersion, publicKey } };
}

// ---------------------------------------------------------------------------
// What the board holds.
// ---------------------------------------------------------------------------

export interface BoardFacts {
  readonly self: HubSelfFacts;
  readonly identityPrivateKey: KeyObject;
  readonly identityPublicKeyPem: string;
}

export function readBoardFacts(
  config: Pick<
    TerminalSyncConfig,
    "pairingStatePath" | "identityKeyPath" | "operationalCertificatePath" | "boardSerialPath"
  >,
):
  | { readonly ok: true; readonly facts: BoardFacts }
  | { readonly ok: false; readonly reason: string } {
  if (!existsSync(config.pairingStatePath))
    return { ok: false, reason: "this Hub has no pairing state; pair it with a Store first" };
  let pairing: Record<string, unknown>;
  try {
    pairing = JSON.parse(readFileSync(config.pairingStatePath, "utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "the pairing state is not valid JSON" };
  }
  if (pairing["phase"] !== "PAIRED")
    return { ok: false, reason: `this Hub is ${String(pairing["phase"])}, not PAIRED` };
  const field = (key: string): string | undefined => {
    const v = pairing[key];
    return typeof v === "string" && UUID.test(v) ? v.toLowerCase() : undefined;
  };
  const hubDeviceId = field("deviceRecordId");
  const assignmentId = field("assignmentId");
  const tenantId = field("tenantId");
  const digitalStoreId = field("digitalStoreId");
  const storeLocationId = field("storeLocationId");
  if (!hubDeviceId || !assignmentId || !tenantId || !digitalStoreId || !storeLocationId) {
    return {
      ok: false,
      reason:
        "the pairing state lacks deviceRecordId/assignmentId/tenantId/digitalStoreId/storeLocationId",
    };
  }
  const generationRaw = pairing["assignmentGeneration"];
  const assignmentGeneration =
    typeof generationRaw === "number" && Number.isInteger(generationRaw) && generationRaw >= 1
      ? generationRaw
      : 1;

  if (!existsSync(config.identityKeyPath))
    return { ok: false, reason: "no device identity key on this board" };
  let identityPrivateKey: KeyObject;
  try {
    identityPrivateKey = createPrivateKey(readFileSync(config.identityKeyPath, "utf8"));
  } catch {
    return { ok: false, reason: "the device identity key does not parse" };
  }
  if (identityPrivateKey.asymmetricKeyType !== "ed25519")
    return { ok: false, reason: "the device identity key is not Ed25519" };
  const identityPublicKeyPem = createPublicKey(identityPrivateKey)
    .export({ type: "spki", format: "pem" })
    .toString();

  if (!existsSync(config.operationalCertificatePath))
    return { ok: false, reason: "this Hub has no operational certificate; it is not activated" };
  const operationalCertificatePem = readFileSync(config.operationalCertificatePath, "utf8");

  if (!existsSync(config.boardSerialPath))
    return { ok: false, reason: `cannot read the board serial at ${config.boardSerialPath}` };
  const boardSerial = readFileSync(config.boardSerialPath)
    .toString("utf8")
    .replace(/\0/gu, "")
    .trim();
  if (boardSerial === "") return { ok: false, reason: "the board serial read back empty" };

  return {
    ok: true,
    facts: {
      self: {
        hubDeviceId,
        assignmentId,
        assignmentGeneration,
        scope: { tenantId, digitalStoreId, storeLocationId },
        boardSerial,
        operationalCertificatePem,
        identityPublicKeyPem,
      },
      identityPrivateKey,
      identityPublicKeyPem,
    },
  };
}

// ---------------------------------------------------------------------------
// The request and the answer.
// ---------------------------------------------------------------------------

export interface SignedSyncRequest {
  readonly kind: typeof HUB_SYNC_REQUEST_KIND;
  readonly hubDeviceId: string;
  readonly identityPublicKeyPem: string;
  readonly requestedAt: string;
  readonly nonce: string;
  readonly signature: string;
}

export function buildSyncRequest(
  facts: Pick<BoardFacts, "identityPrivateKey" | "identityPublicKeyPem"> & {
    readonly hubDeviceId: string;
  },
  now: Date = new Date(),
  nonce: string = randomBytes(16).toString("hex"),
): SignedSyncRequest {
  const requestedAt = now.toISOString();
  const bytes = hubSyncRequestBytes({
    identityPublicKeyFingerprint: publicKeyFingerprint(facts.identityPublicKeyPem),
    hubDeviceId: facts.hubDeviceId,
    requestedAt,
    nonce,
  });
  return {
    kind: HUB_SYNC_REQUEST_KIND,
    hubDeviceId: facts.hubDeviceId,
    identityPublicKeyPem: facts.identityPublicKeyPem,
    requestedAt,
    nonce,
    signature: signBytes(facts.identityPrivateKey, bytes),
  };
}

export interface VerifiedEnvelope {
  readonly producedAt: string;
  readonly hubAssetTag: string;
  readonly deliveries: readonly TerminalDelivery[];
  /** Deliveries that did not parse, by name where one was readable. */
  readonly malformed: readonly string[];
}

export type EnvelopeRefusal =
  | "ENVELOPE_MALFORMED"
  | "ENVELOPE_WRONG_KIND"
  | "ENVELOPE_UNKNOWN_KEY"
  | "ENVELOPE_SIGNATURE_INVALID"
  | "ENVELOPE_NONCE_MISMATCH"
  | "ENVELOPE_NOT_FOR_THIS_HUB"
  | "ENVELOPE_WRONG_SCOPE"
  | "ENVELOPE_STALE";

/**
 * Verify an answer BEFORE reading anything from it. Order: shape, key id,
 * signature over the canonical envelope, then the bindings — nonce (this
 * answer is to my request), device id (it is about me), scope (my Store),
 * freshness.
 */
export function verifySyncEnvelope(
  body: unknown,
  trust: HubSyncTrust,
  expect: { readonly nonce: string; readonly hubDeviceId: string; readonly scope: HubScope },
  now: Date = new Date(),
):
  | { readonly ok: true; readonly envelope: VerifiedEnvelope }
  | { readonly ok: false; readonly refusal: EnvelopeRefusal; readonly detail?: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const record = body as Record<string, unknown>;
  const envelope = record["envelope"];
  const signature = record["signature"];
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  if (signature === null || typeof signature !== "object" || Array.isArray(signature))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const env = envelope as Record<string, unknown>;
  const sig = signature as Record<string, unknown>;
  if (env["kind"] !== HUB_SYNC_ENVELOPE_KIND) return { ok: false, refusal: "ENVELOPE_WRONG_KIND" };
  if (
    sig["algorithm"] !== "ed25519" ||
    sig["keyId"] !== trust.keyId ||
    sig["keyVersion"] !== trust.keyVersion
  ) {
    return { ok: false, refusal: "ENVELOPE_UNKNOWN_KEY", detail: `keyId=${String(sig["keyId"])}` };
  }
  const value = sig["value"];
  if (typeof value !== "string" || !SIGNATURE.test(value))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  let bytes: Buffer;
  try {
    bytes = hubSyncEnvelopeBytes(env as { kind: string });
  } catch {
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  }
  if (!verifyBytes(trust.publicKey, bytes, value))
    return { ok: false, refusal: "ENVELOPE_SIGNATURE_INVALID" };

  // Verified. Now the bindings, read from the verified content only.
  const nonce = env["requestNonce"];
  if (typeof nonce !== "string" || !NONCE.test(nonce) || nonce !== expect.nonce) {
    return { ok: false, refusal: "ENVELOPE_NONCE_MISMATCH" };
  }
  const hub = env["hub"];
  if (hub === null || typeof hub !== "object" || Array.isArray(hub))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const h = hub as Record<string, unknown>;
  if (typeof h["deviceId"] !== "string" || h["deviceId"].toLowerCase() !== expect.hubDeviceId) {
    return { ok: false, refusal: "ENVELOPE_NOT_FOR_THIS_HUB" };
  }
  const scopeOf = (k: string): string =>
    typeof h[k] === "string" ? (h[k] as string).toLowerCase() : "";
  if (
    scopeOf("tenantId") !== expect.scope.tenantId ||
    scopeOf("digitalStoreId") !== expect.scope.digitalStoreId ||
    scopeOf("storeLocationId") !== expect.scope.storeLocationId
  ) {
    return { ok: false, refusal: "ENVELOPE_WRONG_SCOPE" };
  }
  const producedAt = env["producedAt"];
  if (typeof producedAt !== "string" || Number.isNaN(Date.parse(producedAt)))
    return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  if (Math.abs(Date.parse(producedAt) - now.getTime()) / 1000 > REQUEST_MAX_SKEW_SECONDS) {
    return { ok: false, refusal: "ENVELOPE_STALE" };
  }
  const terminals = env["terminals"];
  if (!Array.isArray(terminals)) return { ok: false, refusal: "ENVELOPE_MALFORMED" };
  const deliveries: TerminalDelivery[] = [];
  const malformed: string[] = [];
  for (const item of terminals) {
    const parsed = parseTerminalDelivery(item);
    if (parsed.ok) deliveries.push(parsed.delivery);
    else {
      const name =
        item !== null && typeof item === "object"
          ? (item as Record<string, unknown>)["terminalName"]
          : undefined;
      malformed.push(`${typeof name === "string" ? name : "?"}: ${parsed.reason}`);
    }
  }
  return {
    ok: true,
    envelope: {
      producedAt,
      hubAssetTag: typeof h["assetTag"] === "string" ? h["assetTag"] : "",
      deliveries,
      malformed,
    },
  };
}

// ---------------------------------------------------------------------------
// One pass, and the loop.
// ---------------------------------------------------------------------------

export interface SyncLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface SyncDeps {
  readonly pool: pg.Pool;
  readonly config: TerminalSyncConfig;
  readonly log: SyncLogger;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
}

export type SyncOutcome =
  | {
      readonly kind: "applied";
      readonly outcome: ApplyOutcome;
      readonly hubAssetTag: string;
      readonly malformed: readonly string[];
    }
  | { readonly kind: "refused"; readonly code: string; readonly detail?: string }
  | { readonly kind: "unreachable"; readonly detail: string };

interface SyncState {
  readonly schema: "kitluy.hub-terminal-sync-state.v1";
  readonly lastAttemptAt: string;
  readonly lastSuccessAt: string | null;
  readonly outcome: string;
  readonly detail: string | null;
  readonly terminals: readonly { readonly name: string; readonly action: string }[];
  readonly configurationVersion: string | null;
}

function writeState(
  path: string,
  previous: SyncState | null,
  next: Omit<SyncState, "schema" | "lastSuccessAt">,
  success: boolean,
): void {
  const state: SyncState = {
    schema: "kitluy.hub-terminal-sync-state.v1",
    ...next,
    lastSuccessAt: success ? next.lastAttemptAt : (previous?.lastSuccessAt ?? null),
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
  } catch {
    // The state file is a convenience for an operator; failing to write it
    // must not fail the sync.
  }
}

function readState(path: string): SyncState | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SyncState;
  } catch {
    return null;
  }
}

/** One full pass. Never throws: every failure is an outcome, logged by code. */
export async function runTerminalSyncOnce(deps: SyncDeps): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date());
  const { config, log } = deps;
  const previous = readState(config.statePath);
  const attemptAt = now().toISOString();
  const finish = (
    outcome: SyncOutcome,
    extra: Partial<Pick<SyncState, "terminals" | "configurationVersion">> = {},
  ): SyncOutcome => {
    writeState(
      config.statePath,
      previous,
      {
        lastAttemptAt: attemptAt,
        outcome:
          outcome.kind === "applied"
            ? "applied"
            : outcome.kind === "refused"
              ? outcome.code
              : "unreachable",
        detail: outcome.kind === "applied" ? null : (outcome.detail ?? null),
        terminals: extra.terminals ?? [],
        configurationVersion: extra.configurationVersion ?? previous?.configurationVersion ?? null,
      },
      outcome.kind === "applied",
    );
    return outcome;
  };

  if (config.environment !== "development") {
    return finish({
      kind: "refused",
      code: "SYNC_ENVIRONMENT",
      detail: `this Hub declares '${config.environment}'`,
    });
  }
  const trust = loadHubSyncTrust(config.trustPath, config.environment);
  if (!trust.ok) return finish({ kind: "refused", code: trust.refusal, detail: trust.detail });
  const board = readBoardFacts(config);
  if (!board.ok) return finish({ kind: "refused", code: "BOARD_NOT_READY", detail: board.reason });

  const request = buildSyncRequest(
    { ...board.facts, hubDeviceId: board.facts.self.hubDeviceId },
    now(),
  );
  const fetchImpl: FetchLike = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let status: number;
  let body: unknown;
  try {
    const response = await fetchImpl(`${config.url}${SYNC_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
    status = response.status;
    body = await response.json().catch(() => undefined);
  } catch (error) {
    return finish({
      kind: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (status !== 200) {
    const code =
      body !== null && typeof body === "object"
        ? String((body as Record<string, unknown>)["code"] ?? status)
        : String(status);
    return finish({ kind: "refused", code: `PRODUCER_${code}`, detail: `HTTP ${String(status)}` });
  }
  const verified = verifySyncEnvelope(
    body,
    trust.trust,
    {
      nonce: request.nonce,
      hubDeviceId: board.facts.self.hubDeviceId,
      scope: board.facts.self.scope,
    },
    now(),
  );
  if (!verified.ok)
    return finish({ kind: "refused", code: verified.refusal, detail: verified.detail });

  let outcome: ApplyOutcome;
  try {
    outcome = await applyEnvelope(deps.pool, {
      self: board.facts.self,
      deliveries: verified.envelope.deliveries,
      environment: config.environment,
      now: now(),
    });
  } catch (error) {
    return finish({
      kind: "refused",
      code: "APPLY_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  for (const m of verified.envelope.malformed)
    log.warn?.("terminal sync: a delivery did not parse", { delivery: m });
  const summary = {
    terminals: outcome.terminals.map((t) => ({ name: t.terminalName, action: t.action })),
    configurationVersion: outcome.configuration.published
      ? outcome.configuration.snapshotVersion
      : undefined,
  };
  return finish(
    {
      kind: "applied",
      outcome,
      hubAssetTag: verified.envelope.hubAssetTag,
      malformed: verified.envelope.malformed,
    },
    summary,
  );
}

/** Start the loop: one pass now, then every interval. Returns a stop function. */
export function startTerminalSyncLoop(deps: SyncDeps): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const { log, config } = deps;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const result = await runTerminalSyncOnce(deps);
    if (result.kind === "applied") {
      const changed = result.outcome.terminals.filter((t) => t.action !== "unchanged");
      const fields = {
        hub: result.hubAssetTag,
        terminals: result.outcome.terminals.length,
        changed: changed.map(
          (t) =>
            `${t.terminalName}:${t.action}${t.retiredPrevious ? "(previous retired)" : ""}${t.detail ? ` ${t.detail}` : ""}`,
        ),
        configuration: result.outcome.configuration.published
          ? `v${result.outcome.configuration.snapshotVersion} (${String(result.outcome.configuration.grantsWritten)} grants)`
          : result.outcome.configuration.reason,
        malformed: result.malformed.length,
      };
      // Quiet when nothing changed: a line a minute would bury the ones that matter.
      if (
        changed.length > 0 ||
        result.outcome.configuration.published ||
        result.malformed.length > 0
      ) {
        log.info("terminal sync applied", fields);
      }
    } else if (result.kind === "refused") {
      log.warn?.("terminal sync refused", {
        code: result.code,
        ...(result.detail ? { detail: result.detail } : {}),
      });
    } else {
      log.warn?.("terminal sync: producer unreachable", { detail: result.detail, url: config.url });
    }
    if (!stopped) timer = setTimeout(() => void tick(), config.intervalSeconds * 1000);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
