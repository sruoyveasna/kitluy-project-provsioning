/**
 * LAN API kernel (`/edge/v1`) — Store LAN surface for T1–T4 terminals.
 *
 * ROUTE VOCABULARY: every `/edge/v1` literal comes from `@kitluy/edge-contracts`,
 * the canonical Edge route registry (KL-DEC-001-T002). This file declares no
 * route literal of its own.
 *
 * CONTRACT STATUS: the route-shape fork between Store Hub spec v1.0.0 §9.2 and
 * POS Desktop spec v4.0.0 §14.2 (conflict KLREC-2026-07-26-001) is RESOLVED at
 * the contract layer by owner decision KLD-2026-07-26-002 Group 1.
 *
 * IMPLEMENTATION STATUS: unchanged — this kernel still serves only the health,
 * identity and sync-status reads. Contract approval is not implementation
 * authorization: KLD-2026-07-26-002 §Implementation authorization item 9 removes
 * a fail-closed block only "after the corresponding implementation and tests
 * pass", and Hub mutation persistence is WS-09 work. Every mutating verb
 * therefore keeps failing closed with 405 and no handler, no placeholder and no
 * fabricated success response exists.
 */
import { errorEnvelope } from "@kitluy/api-errors";
import {
  EDGE_ROUTE_HEALTH,
  EDGE_ROUTE_IDENTITY,
  EDGE_ROUTE_SYNC_STATUS,
} from "@kitluy/edge-contracts";
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

/**
 * Fail-closed message for every mutating verb.
 *
 * Cites both the resolved contract conflict (KLREC-2026-07-26-001, closed by
 * KLD-2026-07-26-002) and the reason the block stays in place: the Hub mutation
 * implementation is neither authorized nor tested yet.
 */
const MUTATION_BLOCKED_MESSAGE =
  "Mutating /edge/v1 routes are not implemented on this Store Hub. The Edge route contracts are owner-approved (KLD-2026-07-26-002 Group 1, which resolves the route-shape conflict KLREC-2026-07-26-001), but contract approval is not implementation authorization: the Hub mutation implementation and its tests are not yet in place (KL-DEC-001-T002 status ceiling; Hub persistence is WS-09). The Hub fails closed rather than returning an unverified result.";

export function handleLanRequest(
  method: string,
  path: string,
  identity: HubIdentitySummary,
  db: LocalDatabaseAdapter,
): LanResponse {
  if (method !== "GET") {
    return {
      status: 405,
      body: errorEnvelope("VALIDATION_FAILED", MUTATION_BLOCKED_MESSAGE),
    };
  }
  switch (path) {
    case EDGE_ROUTE_HEALTH:
      return {
        status: 200,
        body: { status: "ok", service: SERVICE_NAME, version: SERVICE_VERSION },
      };
    case EDGE_ROUTE_IDENTITY:
      return { status: 200, body: identity };
    case EDGE_ROUTE_SYNC_STATUS:
      return {
        status: 200,
        body: {
          pendingOutbox: db.pendingOutbox().length,
          syncState: db.pendingOutbox().length === 0 ? "synced" : "pending_cloud_sync",
        },
      };
    default:
      return { status: 404, body: errorEnvelope("RESOURCE_NOT_FOUND", "Unknown /edge/v1 route.") };
  }
}
