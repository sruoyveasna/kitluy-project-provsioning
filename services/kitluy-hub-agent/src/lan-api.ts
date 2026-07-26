/**
 * LAN API kernel (`/edge/v1`) — Store LAN surface for T1–T4 terminals.
 *
 * IMPORTANT: the Hub spec v1.0.0 §9.2 and POS Desktop spec v4.0.0 §14.2
 * define DIFFERENT route shapes for the same `/edge/v1` surface (recorded as
 * conflict KLREC-2026-07-26-001 in the decision-and-reconciliation register).
 * Until the owner reconciles them, this kernel implements only the routes both
 * specs agree on: health, identity and sync status. No business routes are
 * scaffolded against an unreconciled contract.
 */
import { errorEnvelope } from "@kitluy/api-errors";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";
import type { LocalDatabaseAdapter } from "./local-db.js";

export interface LanResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HubIdentitySummary {
  readonly hubId: string;
  readonly storeLocationId: string;
  /** Certificate fingerprint placeholder — production requires device PKI. */
  readonly certificateFingerprint: string;
}

export function handleLanRequest(
  method: string,
  path: string,
  identity: HubIdentitySummary,
  db: LocalDatabaseAdapter,
): LanResponse {
  if (method !== "GET") {
    return {
      status: 405,
      body: errorEnvelope(
        "VALIDATION_FAILED",
        "Mutating /edge/v1 routes are blocked pending reconciliation of the Hub and POS route contracts (KLREC-2026-07-26-001).",
      ),
    };
  }
  switch (path) {
    case "/edge/v1/health":
      return {
        status: 200,
        body: { status: "ok", service: SERVICE_NAME, version: SERVICE_VERSION },
      };
    case "/edge/v1/identity":
      return { status: 200, body: identity };
    case "/edge/v1/sync/status":
      return {
        status: 200,
        body: {
          pendingOutbox: db.pendingOutbox().length,
          syncState: db.pendingOutbox().length === 0 ? "synced" : "pending_cloud_sync",
        },
      };
    default:
      return { status: 404, body: errorEnvelope("NOT_FOUND", "Unknown /edge/v1 route.") };
  }
}
