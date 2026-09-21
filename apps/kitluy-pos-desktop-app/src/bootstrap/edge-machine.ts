/**
 * T1 startup on a Pi Terminal, through the edge bridge — T1-STORE-OPERATIONS-001.
 *
 * ===========================================================================
 * WHY A SECOND COMPOSITION OF THE SAME RULES, AND NOT A REWRITE
 * ===========================================================================
 * `bootstrapT1` (machine.ts) is the WS-12-T001 startup for a terminal that holds
 * its own identity, its own pairing receipt and the Hub's operational PUBLIC key,
 * and does mutual TLS itself. A KitLuy Pi Terminal holds none of those in the
 * POS process, deliberately:
 *
 *   - the operational private key is 0700 root and the POS runs as
 *     `kitluy-terminal` with no capabilities;
 *   - `kitluy-terminal-edge.service` (root) discovers the Hub, verifies the
 *     discovery record's bindings, pins the Hub certificate and pairs;
 *   - the Hub's signing key is not provisioned to terminals at all (BLK-006),
 *     which is why terminal-edge reports the discovery signature "unverified".
 *
 * `bootstrapT1` cannot run honestly there: its signature steps would need a key
 * that does not exist, and faking them would be worse than refusing. So this
 * file composes the SAME rules — the closed state vocabulary, the Hub
 * authority-time anchor and its 30-second freshness window, the route-refusal
 * table, the T1 profile rule, schema and application-version compatibility,
 * `evaluateStaffAuthorization` — around the facts THIS path can actually prove,
 * and says in the report which Hub signatures it did not verify.
 *
 * ===========================================================================
 * WHAT IS BOUND, EXPLICITLY, BECAUSE NO SIGNATURE BINDS IT HERE
 * ===========================================================================
 *   eligibility.terminalDeviceId      == this board's cloud-issued device id
 *   eligibility.hubDeviceId           == the Hub the edge PINNED
 *   eligibility.assignmentGeneration  == this board's seat generation
 *   eligibility credential/activation/pairing/containment/replacement == serving
 *   delivery envelope scope           == eligibility scope, T1, this terminal
 *   sha256(payloadJson)               == the envelope's payloadSha256
 *   effectiveAt <= Hub now < validUntil
 *
 * Every mismatch FAILS CLOSED into a named state. Cloud availability is
 * consulted nowhere; no validity judgement reads a wall clock.
 */
import { createHash } from "node:crypto";

import { TERMINAL_PROFILE_T1_INTAKE_CASHIER } from "@kitluy/edge-contracts";
import { REJECTED_TERMINAL_IDENTIFIERS } from "@kitluy-verticals/phase1-laundry";

import { HUB_TIME_MAX_CACHE_AGE_SECONDS, HubTimeAnchor, parseAuthorityTime } from "./hub-time.js";
import {
  ROUTE_REFUSAL_STATES,
  SUPPORTED_CONFIGURATION_SCHEMA_VERSION,
  compareApplicationVersions,
  evaluateStaffAuthorization,
} from "./machine.js";
import type {
  BootstrapLogger,
  ConfigurationDeliveryWire,
  EdgeOperationsSession,
  EdgeReadRefusal,
  RuntimeEligibilityWire,
  StaffSessionPort,
} from "./ports.js";
import type {
  ActiveConfigurationSummary,
  ConfigurationFreshness,
  HubLinkSummary,
  T1BootstrapReport,
  T1RuntimeState,
} from "./states.js";

/** What the edge bridge's status route answers (public identifiers only). */
export interface EdgeBridgeStatusWire {
  readonly edge: {
    readonly phase: string;
    readonly detail: string;
    readonly checkedAt: string;
  } | null;
  readonly hub: {
    readonly hubDeviceId: string;
    readonly host: string;
    readonly port: number;
  } | null;
  readonly terminal: {
    readonly deviceId: string | null;
    readonly assignmentGeneration: number | null;
    readonly profileCodes: readonly string[];
  };
}

/** A configuration delivery that passed every check this path can make. */
export interface EdgeVerifiedConfiguration {
  readonly wire: ConfigurationDeliveryWire;
  readonly verifiedAtHubTime: string;
}

export interface EdgeBootstrapPorts {
  /** The bridge's status. THROWS when the bridge socket cannot be reached. */
  readonly bridgeStatus: () => Promise<EdgeBridgeStatusWire>;
  /** The Hub routes, over the bridge. Transport failures THROW. */
  readonly hub: EdgeOperationsSession;
  /**
   * The last verified delivery, IN MEMORY for this application process. There
   * is no disk custody on this path yet (no OS keyring under cage), so a
   * restart starts without one — which is the fail-closed direction.
   */
  readonly configurationCache: {
    loadCurrent(): EdgeVerifiedConfiguration | null;
    persist(record: EdgeVerifiedConfiguration): void;
  };
  readonly staffSession: StaffSessionPort;
  readonly logger: BootstrapLogger;
  readonly monotonicNow: () => number;
}

export const EDGE_LINK: HubLinkSummary = {
  transport: "edge_bridge",
  hubAuthentication: "terminal_edge_mtls_pinned",
  hubSignatures: "not_verified_hub_key_not_provisioned",
};

/** Results under which a cached configuration may be used (machine.ts §6). */
const CONFIG_FALLBACK_RESULTS = new Set([
  "CONFIGURATION_MISSING",
  "DELIVERY_SIGNER_UNAVAILABLE",
  "CONFIGURATION_FETCH_FAILED",
]);

function isRefusal(value: object): value is EdgeReadRefusal {
  return "outcome" in value && (value as { outcome: unknown }).outcome === "refused";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export async function bootstrapT1ThroughEdge(
  ports: EdgeBootstrapPorts,
  options: { readonly applicationVersion?: string } = {},
): Promise<T1BootstrapReport> {
  const applicationVersion = options.applicationVersion ?? "0.1.0";
  const transitions: T1RuntimeState[] = [];
  const enter = (state: T1RuntimeState): void => {
    transitions.push(state);
    ports.logger.log("t1.bootstrap.state", { state, link: "edge_bridge" });
  };
  const finish = (
    state: T1RuntimeState,
    extras: Omit<Partial<T1BootstrapReport>, "state" | "transitions" | "link"> = {},
  ): T1BootstrapReport => {
    enter(state);
    if (extras.refusalCode !== undefined) {
      ports.logger.log("t1.bootstrap.refused", {
        state,
        refusalCode: extras.refusalCode,
        detail: extras.detail ?? "",
      });
    }
    return { state, transitions, ...extras, link: EDGE_LINK };
  };
  const routeRefused = (
    refusal: EdgeReadRefusal,
    extras: Omit<Partial<T1BootstrapReport>, "state" | "transitions" | "link"> = {},
  ): T1BootstrapReport =>
    finish(ROUTE_REFUSAL_STATES[refusal.result] ?? bridgeRefusalState(refusal.result), {
      refusalCode: refusal.result,
      detail: refusal.detail,
      ...extras,
    });

  enter("starting");

  // Step 1 — this board, as the edge knows it.
  let status: EdgeBridgeStatusWire;
  try {
    status = await ports.bridgeStatus();
  } catch (error) {
    return finish("hub_unavailable", {
      refusalCode: "EDGE_BRIDGE_UNAVAILABLE",
      detail: error instanceof Error ? error.message : "the edge bridge did not answer",
    });
  }
  const deviceId = status.terminal.deviceId;
  if (deviceId === null) {
    return finish("recovery_required", {
      refusalCode: "IDENTITY_MISSING",
      detail: "this board has no cloud-issued device identity yet; registration is required",
    });
  }
  if (status.edge?.phase === "NOT_ACTIVATED") {
    return finish("recovery_required", {
      refusalCode: "ACTIVATION_REQUIRED",
      detail: "this terminal holds no operational certificate yet",
    });
  }

  // Step 2 — a Hub the edge verified and pinned.
  enter("connecting_to_hub");
  if (status.hub === null) {
    return finish("hub_unavailable", {
      refusalCode: "HUB_DISCOVERY_UNREACHABLE",
      detail: status.edge?.detail ?? "the terminal edge has not verified a Store Hub yet",
    });
  }
  const pinnedHub = status.hub;
  const hubSummary = {
    hubDeviceId: pinnedHub.hubDeviceId,
    hostname: pinnedHub.host,
    port: pinnedHub.port,
  };
  const hub = ports.hub;

  // Step 3 — Hub authority time, the only clock.
  const anchor = new HubTimeAnchor(ports.monotonicNow);
  const acquireHubTime = async (): Promise<Date | T1BootstrapReport> => {
    const existing = anchor.current();
    if (existing !== null) return existing;
    let outcome: Awaited<ReturnType<typeof hub.fetchAuthorityTime>>;
    try {
      outcome = await hub.fetchAuthorityTime();
    } catch (error) {
      return finish("hub_unavailable", {
        refusalCode: "HUB_SESSION_LOST",
        detail: error instanceof Error ? error.message : "authority time fetch failed",
        hub: hubSummary,
      });
    }
    if (isRefusal(outcome)) return routeRefused(outcome, { hub: hubSummary });
    const parsed = parseAuthorityTime(outcome);
    if (parsed === null) {
      return finish("hub_unavailable", {
        refusalCode: "AUTHORITY_TIME_MALFORMED",
        detail: "the authority-time response did not parse; there is no wall-clock fallback",
        hub: hubSummary,
      });
    }
    anchor.set(new Date(parsed.authorityTime), parsed.maxCacheAgeSeconds);
    const anchored = anchor.current();
    if (anchored === null) {
      return finish("hub_unavailable", {
        refusalCode: "AUTHORITY_TIME_UNANCHORED",
        detail: "the authority-time anchor could not be established",
        hub: hubSummary,
      });
    }
    return anchored;
  };
  const initialTime = await acquireHubTime();
  if (initialTime instanceof Date === false) return initialTime;
  let hubNow: Date = initialTime;

  // Step 4 — eligibility, bound to THIS board and THIS pinned Hub.
  let eligibilityOutcome: Awaited<ReturnType<typeof hub.fetchEligibility>>;
  try {
    eligibilityOutcome = await hub.fetchEligibility();
  } catch (error) {
    return finish("hub_unavailable", {
      refusalCode: "HUB_SESSION_LOST",
      detail: error instanceof Error ? error.message : "the eligibility read failed",
      hub: hubSummary,
    });
  }
  if (isRefusal(eligibilityOutcome)) return routeRefused(eligibilityOutcome, { hub: hubSummary });
  const eligibility: RuntimeEligibilityWire = eligibilityOutcome.eligibility;
  {
    const freshAt = await acquireHubTime();
    if (freshAt instanceof Date === false) return freshAt;
    hubNow = freshAt;
    const eligibilityAt = new Date(eligibility.authorityTime);
    if (Number.isNaN(eligibilityAt.getTime())) {
      return finish("hub_unavailable", {
        refusalCode: "ELIGIBILITY_TIME_MALFORMED",
        detail: "the eligibility response carries no parseable authority timestamp",
        hub: hubSummary,
      });
    }
    if (
      Math.abs(hubNow.getTime() - eligibilityAt.getTime()) >
      HUB_TIME_MAX_CACHE_AGE_SECONDS * 1000
    ) {
      return finish("hub_unavailable", {
        refusalCode: "ELIGIBILITY_STALE",
        detail: "the eligibility response is outside the authority-time freshness window",
        hub: hubSummary,
      });
    }
  }
  if (eligibility.terminalDeviceId !== deviceId) {
    return finish("credential_invalid", {
      refusalCode: "ELIGIBILITY_TERMINAL_MISMATCH",
      detail: "the Hub answered for a different terminal than this board",
      hub: hubSummary,
    });
  }
  if (eligibility.hubDeviceId !== pinnedHub.hubDeviceId) {
    return finish("assignment_invalid", {
      refusalCode: "ELIGIBILITY_HUB_MISMATCH",
      detail: "eligibility names a different Store Hub than the one the edge pinned",
      hub: hubSummary,
    });
  }
  if (status.terminal.assignmentGeneration === null) {
    return finish("recovery_required", {
      refusalCode: "SEAT_UNKNOWN",
      detail: "this board holds no seat assignment to compare the Hub's generation against",
      hub: hubSummary,
    });
  }
  if (eligibility.assignmentGeneration !== status.terminal.assignmentGeneration) {
    return finish("assignment_invalid", {
      refusalCode: "ASSIGNMENT_GENERATION_MISMATCH",
      detail: `the Hub serves assignment generation ${String(eligibility.assignmentGeneration)}; this board holds ${String(status.terminal.assignmentGeneration)}`,
      hub: hubSummary,
    });
  }
  if (
    eligibility.credentialEligibility !== "eligible" ||
    eligibility.activationEligibility !== "activated" ||
    eligibility.pairingEligibility !== "paired"
  ) {
    return finish("credential_invalid", {
      refusalCode: "ELIGIBILITY_NOT_SERVING",
      detail: "the Hub reports this terminal's credential, activation or pairing as not current",
      hub: hubSummary,
    });
  }
  if (eligibility.containmentState !== "none") {
    return finish("assignment_invalid", {
      refusalCode: "CONTAINMENT_PROHIBITS",
      detail: `containment is ${eligibility.containmentState}`,
      hub: hubSummary,
    });
  }
  if (eligibility.hubReplacementState !== "normal") {
    return finish("hub_unavailable", {
      refusalCode: "HUB_REPLACEMENT_BLOCKED",
      detail: `the Store Hub is in replacement state ${eligibility.hubReplacementState}`,
      hub: hubSummary,
    });
  }

  // Step 5 — the T1 profile; retired identifiers are refused, never coerced.
  if (
    (REJECTED_TERMINAL_IDENTIFIERS as readonly string[]).includes(
      eligibility.terminalProfileCode,
    ) ||
    eligibility.terminalProfileCode !== TERMINAL_PROFILE_T1_INTAKE_CASHIER
  ) {
    return finish("profile_not_authorized", {
      refusalCode: "PROFILE_NOT_T1",
      detail: "the assigned profile is not the T1 POS Cashier / Intake profile",
      hub: hubSummary,
    });
  }

  // Step 6 — configuration, bound to the eligibility just verified.
  enter("configuration_loading");
  const configurationTime = await acquireHubTime();
  if (configurationTime instanceof Date === false) return configurationTime;
  hubNow = configurationTime;

  const judge = (
    wire: ConfigurationDeliveryWire,
    freshness: ConfigurationFreshness,
  ):
    | { readonly ok: true; readonly summary: ActiveConfigurationSummary }
    | { readonly ok: false; readonly report: T1BootstrapReport } => {
    const envelope = wire.delivery;
    if (envelope.schemaVersion !== SUPPORTED_CONFIGURATION_SCHEMA_VERSION) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_SCHEMA_UNSUPPORTED",
          detail: `configuration schema version ${String(envelope.schemaVersion)} is not supported`,
          hub: hubSummary,
        }),
      };
    }
    if (
      compareApplicationVersions(applicationVersion, envelope.minimumApplicationVersion) < 0 ||
      (envelope.maximumApplicationVersion !== null &&
        compareApplicationVersions(applicationVersion, envelope.maximumApplicationVersion) > 0)
    ) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_APP_VERSION_INCOMPATIBLE",
          detail: `application ${applicationVersion} is outside the compatible range`,
          hub: hubSummary,
        }),
      };
    }
    if (
      envelope.tenantId !== eligibility.tenantId ||
      envelope.digitalStoreId !== eligibility.digitalStoreId ||
      envelope.storeLocationId !== eligibility.storeLocationId ||
      envelope.environment !== eligibility.environment ||
      envelope.hubDeviceId !== eligibility.hubDeviceId ||
      envelope.terminalDeviceId !== deviceId ||
      envelope.assignmentGeneration !== eligibility.assignmentGeneration ||
      envelope.terminalProfileCode !== TERMINAL_PROFILE_T1_INTAKE_CASHIER ||
      // v2: the explicit vertical must be stated by the Hub and bound to the
      // delivery. Absent or disagreeing -> refused, never derived.
      typeof eligibility.primaryVertical !== "string" ||
      eligibility.primaryVertical.length === 0 ||
      envelope.primaryVertical !== eligibility.primaryVertical
    ) {
      return {
        ok: false,
        report: finish("assignment_invalid", {
          refusalCode: "CONFIG_SCOPE_MISMATCH",
          detail: "the configuration delivery is not bound to this terminal's current eligibility",
          hub: hubSummary,
        }),
      };
    }
    if (sha256Hex(wire.payloadJson) !== envelope.payloadSha256) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_PAYLOAD_DIGEST_MISMATCH",
          detail: "the configuration payload does not match its declared digest",
          hub: hubSummary,
        }),
      };
    }
    const effectiveAt = new Date(envelope.effectiveAt);
    const validUntil = new Date(envelope.validUntil);
    if (Number.isNaN(effectiveAt.getTime()) || Number.isNaN(validUntil.getTime())) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_WINDOW_MALFORMED",
          detail: "the configuration validity window does not parse",
          hub: hubSummary,
        }),
      };
    }
    if (hubNow.getTime() >= validUntil.getTime()) {
      return {
        ok: false,
        report: finish("stale_configuration", {
          refusalCode: "CONFIG_EXPIRED",
          detail: "the configuration has passed its validity window under Hub time",
          hub: hubSummary,
        }),
      };
    }
    if (hubNow.getTime() < effectiveAt.getTime()) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_NOT_YET_EFFECTIVE",
          detail: "the configuration is not yet effective under Hub time",
          hub: hubSummary,
        }),
      };
    }
    return {
      ok: true,
      summary: {
        configurationVersion: envelope.configurationVersion,
        schemaVersion: envelope.schemaVersion,
        freshness,
        issuedAt: envelope.effectiveAt,
        validUntil: envelope.validUntil,
        evaluatedAt: hubNow.toISOString(),
      },
    };
  };

  let activeConfiguration: ActiveConfigurationSummary;
  let delivery:
    { readonly outcome: "delivery"; readonly wire: ConfigurationDeliveryWire } | EdgeReadRefusal;
  try {
    delivery = await hub.fetchConfigurationDelivery();
  } catch (error) {
    delivery = {
      outcome: "refused",
      result: "CONFIGURATION_FETCH_FAILED",
      retryable: true,
      detail: error instanceof Error ? error.message : "configuration fetch failed",
    };
  }
  if (delivery.outcome === "delivery") {
    const judged = judge(delivery.wire, "current");
    if (!judged.ok) return judged.report;
    ports.configurationCache.persist({
      wire: delivery.wire,
      verifiedAtHubTime: hubNow.toISOString(),
    });
    activeConfiguration = judged.summary;
  } else {
    // Only UNAVAILABILITY may degrade into the cached configuration; a refusal
    // that names this terminal ineligible never does (machine.ts §6).
    const named = ROUTE_REFUSAL_STATES[delivery.result];
    if (named !== undefined && !CONFIG_FALLBACK_RESULTS.has(delivery.result)) {
      return routeRefused(delivery, { hub: hubSummary });
    }
    const cached = ports.configurationCache.loadCurrent();
    if (cached === null) {
      return finish("recovery_required", {
        refusalCode: "CONFIG_NEVER_OBTAINED",
        detail:
          "no configuration has been obtained since this application started; the Store Hub must deliver one",
        hub: hubSummary,
      });
    }
    // RE-JUDGED against the eligibility and Hub time of THIS run, never trusted
    // because it passed before.
    const judged = judge(cached.wire, "cached_offline");
    if (!judged.ok) return judged.report;
    activeConfiguration = judged.summary;
  }

  // Step 7 — the staff session and its permissions, under fresh Hub time.
  const staffTime = await acquireHubTime();
  if (staffTime instanceof Date === false) return staffTime;
  hubNow = staffTime;
  let staff;
  try {
    staff = await ports.staffSession.acquire(hub);
  } catch (error) {
    return finish("staff_authentication_required", {
      refusalCode: "STAFF_ACQUISITION_FAILED",
      detail: error instanceof Error ? error.message : "staff session acquisition failed",
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }
  if (staff === null) {
    return finish("staff_authentication_required", {
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }
  const authorization = evaluateStaffAuthorization(staff, hubNow);
  if (!authorization.authorized) {
    return finish("staff_authentication_required", {
      refusalCode: authorization.refusalCode ?? "STAFF_NOT_AUTHORIZED",
      detail: authorization.detail ?? "the staff session is not usable",
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }

  return finish(activeConfiguration.freshness === "current" ? "ready" : "offline_ready", {
    hub: hubSummary,
    configuration: activeConfiguration,
    staff: { actorId: staff.actorId, displayName: staff.displayName },
  });
}

/** Refusals the bridge itself answers, which the Hub's table does not name. */
function bridgeRefusalState(result: string): T1RuntimeState {
  switch (result) {
    case "EDGE_NOT_CONNECTED":
    case "EDGE_HUB_UNREACHABLE":
    case "HUB_CERT_MISMATCH":
      return "hub_unavailable";
    case "ACTIVATION_REQUIRED":
      return "recovery_required";
    default:
      return "recovery_required";
  }
}
