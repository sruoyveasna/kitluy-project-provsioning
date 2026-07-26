/**
 * kitluy-hub-agent — Store Hub agent.
 *
 * Source authority: kitluy-storehub-phase1-spec-v1.0.0.md. The Store Hub is
 * the local operational authority for one Store Location after provisioning
 * (OWNER-LOCKED, RB v4 §6.1). T1–T4 terminals talk to it over the Store LAN;
 * POS never writes normal Store operations directly to Supabase.
 *
 * STATUS: SCAFFOLDED boundary with BUILT + TESTED simulation harness:
 * - local database adapter interface with transactional outbox (Hub §11.2)
 * - offline/reconnect sync harness with idempotent replay (test:offline)
 * - LAN API kernel routes both Hub and POS specs agree on
 * Real PostgreSQL adapter, device certificates and peripherals are pending the
 * canonical schema/API packs ([REQUIRED] — see docs/authority registers).
 */

/** Runtime components mandated by Hub spec §5.1 (systemd-managed on device). */
export const HUB_COMPONENTS = [
  "bootstrap-service",
  "identity-agent",
  "local-api-gateway",
  "auth-session-service",
  "configuration-agent",
  "laundry-command-service",
  "event-ledger",
  "sync-engine",
  "file-queue-service",
  "print-service",
  "hardware-adapter-service",
  "discovery-service",
  "terminal-session-service",
  "release-agent",
  "health-agent",
  "support-diagnostics-agent",
] as const;

export const SERVICE_NAME = "kitluy-hub-agent" as const;
export const SERVICE_VERSION = "0.1.0" as const;

/**
 * Terminal profiles are Laundry-vertical contracts — the canonical definition
 * lives in @kitluy-verticals/phase1-laundry (single source, no duplication).
 */
export {
  LAUNDRY_TERMINAL_PROFILES as TERMINAL_PROFILES,
  type LaundryTerminalProfile as TerminalProfile,
} from "@kitluy-verticals/phase1-laundry";
