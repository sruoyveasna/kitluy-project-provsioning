/**
 * The Pi Terminal's runtime report (T1-STORE-OPERATIONS-001; cloud group 0229).
 *
 * The health reporter assembles three facts this board already writes down —
 * each by the component that owns it — signs them with the device identity key
 * and sends them to the registry:
 *
 *   hubLink      terminal-edge      /var/lib/kitluy/terminal/edge-status.json
 *                                  (v2: + the Terminal PIN state the Store Hub
 *                                  answered terminal-edge — the "PIN set"
 *                                  evidence, never inferred here)
 *   application  update agent       the kitluy-terminal release journal, and the
 *                + POS launcher     launcher's running witness, + `is-active`
 *   pos          the POS itself     /var/lib/kitluy/terminal/pos-runtime.json
 *
 * NOTHING HERE DECIDES A STATE. It copies what the owners wrote, drops anything
 * outside the closed v1 vocabulary to null rather than forwarding it, and never
 * infers one fact from another (an installed release is not a running one; a
 * paired Hub is not a SERVING one). The Partner Portal renders these facts; it
 * does not reconstruct them.
 *
 * This is DEVICE-ATTESTED status. The Store Hub's own observation of the
 * terminal (cloud group 0177) is the canonical health contract and is blocked on
 * BLK-006; this report does not pretend to be it.
 */
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, createHash, sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { writeDurable } from "./durable-write.js";
import { readImageEnv } from "./image-env.js";
import { RELEASE_PRODUCTS, TERMINAL_CLIENT_UNIT } from "./release-runtime.js";
import { describeReleaseStatus } from "./release-status.js";
import { readJournal, storePaths, TERMINAL_CLIENT_PRODUCT } from "./release-store.js";
import { DEVICE_RUNTIME_REPORT_KIND, deviceRuntimeReportBytes } from "./runtime-report-bytes.js";
import { readRegistrationState } from "./registration-state.js";
import { SERVICE_VERSION } from "./version.js";

export const RUNTIME_REPORT_ROUTE = "/v1/device-runtime/report";
/**
 * Named here rather than imported: the Store Hub image ships the health reporter
 * but not the terminal-edge closure, and importing `edge-session` would drag
 * mDNS and the LAN transport onto the Hub. `test/runtime-report.test.ts`
 * asserts both equal the owners' constants.
 */
export const EDGE_STATUS_PATH = "/var/lib/kitluy/terminal/edge-status.json";
export const DEVICE_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";
export const RUNTIME_SEQUENCE_PATH = "/var/lib/kitluy/health/runtime-report-sequence";
export const POS_RUNTIME_STATUS_PATH = "/var/lib/kitluy/terminal/pos-runtime.json";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const EDGE_PHASES = new Set([
  "NOT_ACTIVATED",
  "NO_HUB_FOUND",
  "HUB_REFUSED",
  "NOT_RECOGNIZED",
  "PAIRING_REFUSED",
  "DEGRADED",
  "SERVING",
]);
const POS_STATES = new Set([
  "starting",
  "connecting_to_hub",
  "configuration_loading",
  "staff_authentication_required",
  "ready",
  "offline_ready",
  "stale_configuration",
  "hub_unavailable",
  "assignment_invalid",
  "credential_invalid",
  "profile_not_authorized",
  "configuration_incompatible",
  "recovery_required",
]);

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  let out = "";
  for (let i = 0; i < value.length && out.length < max; i += 1) {
    const code = value.charCodeAt(i);
    out += code < 0x20 || code === 0x7f ? " " : value[i];
  }
  return out;
}

function instant(value: unknown): string | null {
  const text = clean(value, 40);
  return text !== null && !Number.isNaN(new Date(text).getTime()) ? text : null;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface RuntimeReportSources {
  readonly etcRoot?: string;
  readonly edgeStatusPath?: string;
  readonly storeRoot?: string;
  readonly terminalClientWitnessPath?: string;
  readonly posRuntimePath?: string;
  /** `systemctl is-active <unit>` output. Injected for tests. */
  readonly unitState?: (unit: string) => string;
}

function systemctlIsActive(unit: string): string {
  try {
    return execFileSync("systemctl", ["is-active", unit], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
  } catch (error) {
    const out = (error as { stdout?: unknown }).stdout;
    return typeof out === "string" ? out.trim() : "unknown";
  }
}

const TERMINAL_PIN_STATES = new Set(["setup_required", "set", "reset_required"]);

/** Assemble the v2 report from what the owners wrote. Never throws. */
export function collectRuntimeReport(sources: RuntimeReportSources = {}): Record<string, unknown> {
  // ---- hubLink: terminal-edge's own words.
  const edge = readJson(sources.edgeStatusPath ?? EDGE_STATUS_PATH);
  let hubLink: Record<string, unknown> | null = null;
  const checkedAt = instant(edge?.["checkedAt"]);
  if (edge !== null && EDGE_PHASES.has(String(edge["phase"])) && checkedAt !== null) {
    const hub = edge["hub"] as Record<string, unknown> | undefined;
    const reads = edge["reads"] as Record<string, unknown> | undefined;
    const hubDeviceId =
      typeof hub?.["hubDeviceId"] === "string" && UUID.test(hub["hubDeviceId"])
        ? hub["hubDeviceId"]
        : null;
    hubLink = {
      phase: edge["phase"],
      hubDeviceId,
      checkedAt,
      reads:
        reads === undefined || reads === null
          ? null
          : {
              authorityTime: clean(reads["authorityTime"], 80) ?? "-",
              eligibility: clean(reads["eligibility"], 80) ?? "-",
              configuration: clean(reads["configuration"], 80) ?? "-",
            },
      terminalPin: terminalPinOf(edge["terminalPin"]),
    };
  }

  // ---- application: the journal says what is INSTALLED; the witness says
  // what RUNS; systemd says whether the unit is up. Three facts, not one.
  const paths = storePaths(TERMINAL_CLIENT_PRODUCT, sources.storeRoot);
  const journal = readJournal(paths);
  const status = describeReleaseStatus(paths, {
    runningSourcePath:
      sources.terminalClientWitnessPath ??
      RELEASE_PRODUCTS[TERMINAL_CLIENT_PRODUCT].runningSourcePath,
  });
  const witness = readJson(
    sources.terminalClientWitnessPath ??
      RELEASE_PRODUCTS[TERMINAL_CLIENT_PRODUCT].runningSourcePath,
  );
  const runningReleaseId =
    status.runningSource === "RELEASE" &&
    status.runningReleaseId !== null &&
    UUID.test(status.runningReleaseId)
      ? status.runningReleaseId
      : null;
  const application = {
    product: TERMINAL_CLIENT_PRODUCT,
    installedReleaseId:
      status.installedReleaseId !== null && UUID.test(status.installedReleaseId)
        ? status.installedReleaseId
        : null,
    installedVersion: clean(status.installedVersion, 64),
    journalPhase: journal.phase,
    lastOutcome: journal.lastResult?.outcome ?? null,
    lastReason: clean(journal.lastResult?.reason ?? null, 160),
    runningReleaseId,
    runningSince: runningReleaseId === null ? null : instant(witness?.["at"]),
    unitActive: (sources.unitState ?? systemctlIsActive)(TERMINAL_CLIENT_UNIT) === "active",
  };

  // ---- pos: the POS's own words, closed vocabulary only.
  const posFile = readJson(sources.posRuntimePath ?? POS_RUNTIME_STATUS_PATH);
  let pos: Record<string, unknown> | null = null;
  const posObservedAt = instant(posFile?.["observedAt"]);
  if (
    posFile !== null &&
    (posFile["schema"] === "kitluy.pos-runtime-status.v1" ||
      posFile["schema"] === "kitluy.pos-runtime-status.v2") &&
    POS_STATES.has(String(posFile["state"])) &&
    posObservedAt !== null
  ) {
    const configuration = posFile["configuration"] as Record<string, unknown> | null | undefined;
    const version = configuration?.["configurationVersion"];
    const freshness = configuration?.["freshness"];
    const refusal = posFile["refusalCode"];
    pos = {
      state: posFile["state"],
      refusalCode:
        typeof refusal === "string" && /^[A-Z0-9_]{1,64}$/u.test(refusal) ? refusal : null,
      applicationVersion: clean(posFile["applicationVersion"], 32) ?? "unknown",
      configurationVersion:
        typeof version === "number" && Number.isSafeInteger(version) && version >= 0
          ? version
          : null,
      configurationFreshness:
        freshness === "current" || freshness === "cached_offline" ? freshness : null,
      // v2 POS files say `terminalUnlocked`; a v1 POS (before the Terminal PIN)
      // said `staffSignedIn`, which on a Pi Terminal meant the same thing.
      terminalUnlocked:
        posFile["schema"] === "kitluy.pos-runtime-status.v2"
          ? posFile["terminalUnlocked"] === true
          : posFile["staffSignedIn"] === true,
      observedAt: posObservedAt,
    };
  }

  return {
    schema: DEVICE_RUNTIME_REPORT_KIND,
    deviceClass: "terminal",
    imageVersion: clean(readImageEnv("KITLUY_IMAGE_VERSION", sources.etcRoot) ?? null, 64),
    agentVersion: clean(SERVICE_VERSION, 32) ?? "unknown",
    hubLink,
    application,
    pos,
  };
}

/** The Store Hub's answer, as terminal-edge recorded it; anything else is null. */
function terminalPinOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  const pin = value as Record<string, unknown>;
  if (!TERMINAL_PIN_STATES.has(String(pin["state"]))) return null;
  return {
    state: pin["state"],
    setAt: instant(pin["setAt"]),
    lockedUntil: instant(pin["lockedUntil"]),
  };
}

/**
 * The next report sequence: max(last + 1, now in milliseconds), durably.
 *
 * Epoch milliseconds keep it advancing across a wiped per-slot /var (an A/B
 * system update) without a second store; `last + 1` keeps it advancing if the
 * clock steps back.
 */
export function nextReportSequence(
  path: string = RUNTIME_SEQUENCE_PATH,
  nowMs: number = Date.now(),
): number {
  let last = 0;
  try {
    const parsed = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) last = parsed;
  } catch {
    // First report, or a wiped /var.
  }
  const next = Math.max(last + 1, Math.floor(nowMs));
  writeDurable(path, `${String(next)}\n`, 0o600);
  return next;
}

export interface SignedRuntimeReport {
  readonly deviceId: string;
  readonly identityPublicKeyPem: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: Record<string, unknown>;
  readonly signature: string;
}

export function signRuntimeReport(input: {
  readonly deviceId: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: Record<string, unknown>;
  readonly keyPath?: string;
}): SignedRuntimeReport {
  const privateKey = createPrivateKey(
    readFileSync(input.keyPath ?? DEVICE_IDENTITY_KEY_PATH, "utf8"),
  );
  const publicKey = createPublicKey(privateKey);
  const identityPublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const fingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const bytes = deviceRuntimeReportBytes({
    identityPublicKeyFingerprint: fingerprint,
    deviceId: input.deviceId,
    reportSequence: input.reportSequence,
    observedAt: input.observedAt,
    report: input.report,
  });
  return {
    deviceId: input.deviceId,
    identityPublicKeyPem,
    reportSequence: input.reportSequence,
    observedAt: input.observedAt,
    report: input.report,
    signature: cryptoSign(null, Buffer.from(bytes), privateKey).toString("base64url"),
  };
}

export function postRuntimeReport(
  baseUrl: string,
  body: SignedRuntimeReport,
  timeoutMs = 10_000,
): Promise<{ readonly status: number; readonly outcome: string }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(RUNTIME_REPORT_ROUTE, baseUrl);
    } catch {
      reject(new Error("the enrollment base URL is malformed"));
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "POST",
        timeout: timeoutMs,
        headers: { "content-type": "application/json", "content-length": String(payload.length) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          if (chunks.reduce((n, b) => n + b.length, 0) < 64 * 1024) chunks.push(c);
        });
        res.on("end", () => {
          let outcome = "UNKNOWN";
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              outcome?: unknown;
              code?: unknown;
            };
            outcome = String(parsed.outcome ?? parsed.code ?? "UNKNOWN");
          } catch {
            // A non-JSON answer is reported by its status alone.
          }
          resolve({ status: res.statusCode ?? 0, outcome });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("the registry did not answer in time")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export type RuntimeReportOutcome =
  | { readonly sent: false; readonly reason: string }
  | { readonly sent: true; readonly status: number; readonly outcome: string };

/** One report, when this board can make one. Never throws. */
export async function reportRuntimeOnce(
  options: RuntimeReportSources & {
    readonly registrationStatePath?: string;
    readonly keyPath?: string;
    readonly sequencePath?: string;
    readonly now?: () => Date;
    readonly post?: typeof postRuntimeReport;
  } = {},
): Promise<RuntimeReportOutcome> {
  if (readImageEnv("KITLUY_DEVICE_CLASS", options.etcRoot) !== "terminal") {
    return { sent: false, reason: "not a Pi Terminal" };
  }
  const baseUrl = readImageEnv("KITLUY_ENROLLMENT_BASE_URL", options.etcRoot);
  if (baseUrl === undefined) return { sent: false, reason: "no KITLUY_ENROLLMENT_BASE_URL" };
  const deviceId = readRegistrationState(options.registrationStatePath)?.deviceId;
  if (deviceId === undefined || !UUID.test(deviceId)) {
    return { sent: false, reason: "no cloud-issued device id yet" };
  }
  try {
    const now = (options.now ?? (() => new Date()))();
    const signed = signRuntimeReport({
      deviceId,
      reportSequence: nextReportSequence(options.sequencePath, now.getTime()),
      observedAt: now.toISOString(),
      report: collectRuntimeReport(options),
      ...(options.keyPath === undefined ? {} : { keyPath: options.keyPath }),
    });
    const answer = await (options.post ?? postRuntimeReport)(baseUrl, signed);
    return { sent: true, status: answer.status, outcome: answer.outcome };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "report failed" };
  }
}
