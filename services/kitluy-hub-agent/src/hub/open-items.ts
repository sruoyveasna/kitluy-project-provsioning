/**
 * OPEN reconciliation items and RESIDUAL RISKS carried by the Store Hub command
 * layer (WS-09-T002..T006).
 *
 * WHY THIS MODULE EXISTS. CLAUDE.md hard rule 8 requires conflicts to be
 * RECORDED rather than silently resolved, and hard rule 9 requires unknown
 * owner values to stay `[REQUIRED: ...]`. A comment in a source file can be
 * deleted by a later refactor without anyone noticing; the records below are
 * exported values, asserted by `test/hub-open-items.test.ts`, so an open item
 * cannot be quietly dropped once a workaround exists.
 *
 * Nothing here resolves anything. Each entry names the conflict, the CURRENT
 * strict behaviour (which is never weakened to make a test pass), and the exact
 * ruling the owner still owes.
 */

// ---------------------------------------------------------------------------
// Open reconciliation items — awaiting an owner ruling
// ---------------------------------------------------------------------------

export type OpenItemStatus = "OPEN — awaiting owner ruling";

export interface HubOpenReconciliationItem {
  readonly id: string;
  readonly status: OpenItemStatus;
  /** What disagrees with what. */
  readonly conflict: string;
  /** The sources on each side, so the owner does not have to rediscover them. */
  readonly sources: readonly string[];
  /** What the code does TODAY. Always the strict reading. */
  readonly currentBehaviour: string;
  /** The decision the owner still owes. Deliberately phrased as a question. */
  readonly rulingRequired: string;
  /** What must NOT be done while the item is open. */
  readonly doNot: readonly string[];
}

/**
 * KLREQ-024 — Booking status vs the garment production chain.
 *
 * `edge_laundry.booking.status` carries no CHECK constraint and the canonical
 * Hub-local schema document publishes no value list for it, so the only
 * evidence of its vocabulary is the shipped development seed. That seed's
 * second `status_event` moves `intake_confirmed -> ready` directly. Read as a
 * PRODUCTION state that edge is `RECEIVED -> READY`, which the canonical
 * production machine refuses outright (`canProductionTransition('RECEIVED',
 * 'READY') === false`, KBR-LND-003 forward-only chain; READY is additionally
 * reachable only through the guarded `markReady`, KBR-LND-004).
 *
 * Two readings are possible and the contracts do not choose between them:
 *
 *   (a) `booking.status` IS the production state projection. Then the seed's
 *       direct edge is a defect in the seed, and the Hub must walk the full
 *       chain — which it currently cannot, because no approved Edge route and
 *       no canonical permission key exist for the plant stages
 *       (`washing`/`drying`/`pressing`).
 *   (b) `booking.status` is a DERIVED CUSTOMER-FACING SUMMARY that is
 *       independent of the garment production chain. Then the seed is correct,
 *       the summary may skip plant stages, and the production chain lives (or
 *       will live) somewhere else entirely.
 *
 * The command layer implements (a) — the STRICT reading — because it is the
 * only one that keeps the canonical engine as the sole transition-decision
 * authority. It is NOT presented as the resolution.
 */
export const OPEN_ITEM_BOOKING_STATUS_VS_PRODUCTION_CHAIN: HubOpenReconciliationItem = {
  id: "KLREQ-024",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "The shipped Hub development seed moves edge_laundry.booking.status from 'intake_confirmed' to 'ready' in a single status_event. Read as a production state that is RECEIVED -> READY, an edge the canonical production machine refuses (KBR-LND-003 forward-only chain; KBR-LND-004 guards READY behind markReady). It is unresolved whether booking.status is the production-state projection or a derived customer-facing summary independent of the garment production chain.",
  sources: [
    // Evidence for reading (b) — a derived summary:
    "docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md line 220 — 'Booking-level state is a derived operational summary; garment/custody events remain the detailed evidence.'",
    "hub/seed/dev-fixtures.sql — status_event 'intake_confirmed' -> 'ready' for booking e0000000-0000-4000-8000-000000000070",
    "docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md §6.4 — edge_laundry.booking.status carries NO CHECK constraint and NO published value list",
    // Evidence for reading (a) — the production-state projection:
    "docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md §4 (KBR-LND-003/004) — forward-only RECEIVED -> WASHING -> DRYING -> PRESSING -> QA_PACKAGING -> READY, READY guarded by markReady",
    "verticals/phase1-laundry/src/production-state-machine.ts — canProductionTransition('RECEIVED','READY') === false",
  ],
  currentBehaviour:
    "The command layer takes the STRICT reading: laundry.ready.complete calls the canonical markReady(from, ...), which refuses any source state other than QA_PACKAGING. A refusal writes nothing at all — no event, no outbox row, no command result. The Hub exposes NO command for the plant stages because neither an approved Edge route nor a canonical RBAC permission key covers them (KLREQ-015 discipline), so a Booking created through Hub commands cannot presently reach READY without an out-of-band production projection.",
  rulingRequired:
    "Owner ruling required: may edge_laundry.booking.status be a DERIVED SUMMARY independent of the garment production chain (making the seed correct and the strict chain check inapplicable to it), or is it the production-state projection (making the seed edge a defect to be corrected and the plant-stage commands a gap to be filled with newly registered permission keys)?",
  doNot: [
    "Do NOT modify hub/seed/dev-fixtures.sql to make the strict check pass.",
    "Do NOT relax, bypass or special-case the canonical markReady / transitionProduction guards.",
    "Do NOT invent a permission key or an Edge route for the plant production stages.",
  ],
};

/**
 * KLREQ-025 — no Hub-local permission-grant projection.
 *
 * Carried forward from the command-layer cycle; restated here so the whole open
 * set is visible in one place.
 */
export const OPEN_ITEM_PERMISSION_GRANT_PROJECTION: HubOpenReconciliationItem = {
  id: "KLREQ-025",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "edge_identity.staff_cache carries profile_codes and permission_snapshot_version but NOT the grants of that snapshot, and the §6 catalogue defines no permission-grant relation. Registry keys whose available_scopes carry no `terminal_role:` constraint (payments.refund.request, payments.void.request) therefore cannot be derived from the Hub's own data.",
  sources: [
    "docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv — available_scopes column",
    "hub/migrations/0002_identity.sql — edge_identity.staff_cache",
  ],
  currentBehaviour:
    "Fail closed. Keys WITH a terminal_role constraint are derived from the actor's cached profiles; keys WITHOUT one are satisfied only by an explicitly presented, canonical, exactly-Location-scoped grant. An absent grant DENIES.",
  rulingRequired:
    "[REQUIRED: Hub-local permission-grant projection, or an approved Hub session grant-claim contract, for registry keys without a terminal_role constraint]",
  doNot: ["Do NOT default a missing grant to permitted."],
};

/**
 * KLREQ-026 — multi-event commands need a second idempotency-key namespace.
 */
export const OPEN_ITEM_HUB_EVENT_KEY_NAMESPACE: HubOpenReconciliationItem = {
  id: "KLREQ-026",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "edge_sync.local_event.idempotency_key is UNIQUE and CHECKed against the canonical terminal-issued kl1 shape, but one approved command legitimately emits several events (each business row carries its own UNIQUE event_id). The offline contract §2 defines TERMINAL-issued keys only.",
  sources: [
    "hub/migrations/0009_sync.sql — local_event.idempotency_key UNIQUE + kl1 CHECK",
    "docs/source/offline/kitluy-offline-idempotency-and-sequencing-v1.0.0.md §2",
  ],
  currentBehaviour:
    "The FIRST event of a command carries the terminal-issued command key (matching the shipped fixtures); later events carry kl1.{hub_device_id}.{hub_sequence}, which satisfies the canonical shape, is unique by construction and is distinguishable from a terminal key because a Hub device id is never a terminal_device id.",
  rulingRequired:
    "Amendment to the offline contract §2 owed: ratify the Hub-issued event-key namespace, or specify a different mechanism for multi-event commands.",
  doNot: ["Do NOT reuse one key across several local_event rows — the UNIQUE index forbids it."],
};

/** KLREQ-027 — provider callbacks cannot enter the terminal command ledger. */
export const OPEN_ITEM_PROVIDER_CALLBACK_LEDGER: HubOpenReconciliationItem = {
  id: "KLREQ-027",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "edge_sync.command_result.terminal_device_id is NOT NULL and references edge_identity.terminal_device, so the idempotency/command ledger is TERMINAL-COMMAND-ONLY by contract and cannot hold a service-originated payment-provider callback. No actor-facing RBAC key exists for one either.",
  sources: [
    "hub/migrations/0009_sync.sql — command_result.terminal_device_id NOT NULL REFERENCES terminal_device",
    "docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md §2 — provider and settlement truth is CLOUD-ONLY",
  ],
  currentBehaviour:
    "Provider callbacks run their own SERIALIZABLE service pipeline, deduplicated on (payment_id, request_sha256) under the payment row lock, deciding through the canonical applyKhqrCallback. An unverified signature is QUARANTINED with zero business effect.",
  rulingRequired:
    "[REQUIRED: RBAC permission key for applying an authoritative payment-provider callback on the Store Hub, and a ruling on whether the command ledger should admit service-originated commands]",
  doNot: [
    "Do NOT fabricate a KHQR confirmation. Only a signature-verified provider event confirms.",
  ],
};

/**
 * KLREQ-029 — no RBAC key for an OPERATOR clearing a sync reconciliation.
 *
 * Found while implementing amendment KLD-2026-07-28-001-A01 §5 in Cycle 9. The
 * amendment requires "an authorized actor OR governed automated
 * reconciliation"; the automated half has its authority (a signed cloud
 * reconciliation decision) and is implemented. The operator half has no
 * canonical permission key.
 */
export const OPEN_ITEM_RECONCILIATION_CLEARANCE_KEY: HubOpenReconciliationItem = {
  id: "KLREQ-029",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "Owner amendment KLD-2026-07-28-001-A01 §5 permits an AUTHORIZED ACTOR to clear a raised reconciliation, but the canonical RBAC registry contains no permission key for that act. The nearest key, fleet.sync.trigger, permits REQUESTING a safe sync/reconciliation cycle — asking the system to try again — which is a materially different act from DECLARING a divergence resolved, and reusing it would silently widen it.",
  sources: [
    "docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md — KLD-2026-07-28-001-A01 §5",
    "docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv — fleet.sync.trigger 'Request a safe sync/reconciliation cycle'",
    "services/kitluy-hub-agent/src/hub/sync/reconciliation.ts — OPERATOR_CLEARANCE_PERMISSION",
  ],
  currentBehaviour:
    "Fail closed, exactly as the KLREQ-015 routes do. clearReconciliationByOperator throws EDGE_PERMISSION_KEY_UNREGISTERED carrying its [REQUIRED: ...] marker. Every other precondition is already implemented — the governed procedure, the evidence constraints and the immutable audit row — so the path becomes callable the moment a canonical key exists. The GOVERNED AUTOMATED path is active because its authority is the signed cloud decision, not a Hub-side actor permission.",
  rulingRequired:
    "[REQUIRED: canonical RBAC permission key for an operator clearing a sync reconciliation, with its approval requirement, reauthentication requirement, reason requirement and primary audit event. Clearing a payment or custody divergence is a high-risk act and may warrant four-eyes.]",
  doNot: [
    "Do NOT reuse fleet.sync.trigger — it permits requesting a cycle, not declaring a divergence resolved.",
    "Do NOT let the delivery worker clear a reconciliation under any code path.",
  ],
};

/**
 * KLREQ-030 — no RBAC key for ABANDONING a dead-lettered sync item.
 *
 * Found while implementing audited operator repair in Cycle 9. Requeueing has a
 * key (`fleet.sync.trigger`, "Request a safe sync/reconciliation cycle").
 * Abandoning does not, and it is a materially different act.
 */
export const OPEN_ITEM_DEAD_LETTER_ABANDONMENT_KEY: HubOpenReconciliationItem = {
  id: "KLREQ-030",
  status: "OPEN — awaiting owner ruling",
  conflict:
    "Schema contract §6.8 says a dead letter is never silently discarded and requires operator action. Requeueing is covered by fleet.sync.trigger — asking the system to try again, whose whole point is that nothing is lost. ABANDONING one accepts PERMANENT LOSS of a recorded business effect, and no registry key permits that. Reusing the retry key would make 'try again' and 'give up' the same authority.",
  sources: [
    "docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md §6.8 — dead_letter_item, operator_action_required",
    "docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv — fleet.sync.trigger",
    "services/kitluy-hub-agent/src/hub/sync/operations.ts — ABANDON_PERMISSION",
  ],
  currentBehaviour:
    "Requeue is implemented and audited: it demands an authorized actor and a reason, preserves attempt_count, and leaves the conflict dimension exactly where it was — repairing transport is not declaring a divergence resolved. Abandonment has NO code path: abandonDeadLetter throws EDGE_PERMISSION_KEY_UNREGISTERED, and edge_sync.dead_letter_item.resolution_action CHECKs a value list containing only 'requeued', so the database refuses it too.",
  rulingRequired:
    "[REQUIRED: canonical RBAC permission key for abandoning a dead-lettered sync item, with its approval requirement (four-eyes is likely, given permanent loss of a recorded business effect), reauthentication requirement, reason requirement and primary audit event.]",
  doNot: [
    "Do NOT reuse fleet.sync.trigger for abandonment — it permits retrying, not accepting loss.",
    "Do NOT add an 'abandoned' resolution_action before a key exists.",
  ],
};

export const HUB_OPEN_RECONCILIATION_ITEMS: readonly HubOpenReconciliationItem[] = [
  OPEN_ITEM_BOOKING_STATUS_VS_PRODUCTION_CHAIN,
  OPEN_ITEM_PERMISSION_GRANT_PROJECTION,
  OPEN_ITEM_HUB_EVENT_KEY_NAMESPACE,
  OPEN_ITEM_PROVIDER_CALLBACK_LEDGER,
  OPEN_ITEM_RECONCILIATION_CLEARANCE_KEY,
  OPEN_ITEM_DEAD_LETTER_ABANDONMENT_KEY,
];

/**
 * Items the owner has since RULED. Kept next to the open set so a reader can
 * see what moved and under which decision, rather than having to notice an
 * absence. The item bodies above are NOT rewritten to look prescient: they
 * record what was true when the conflict was raised.
 */
export const HUB_RULED_RECONCILIATION_ITEMS = [
  {
    id: "KLREQ-020",
    ruling: "KLD-2026-07-28-001 Group 1",
    effect:
      "The canonical terminal key kl1.{terminal_device_uuid}.{client_sequence} is confirmed; @kitluy/sync-protocol was corrected in Cycle 9 (WS-10-T002) and the location:...:hub:...:seq:N form is gone with no alias.",
  },
  {
    id: "KLREQ-021",
    ruling: "KLD-2026-07-28-001 Group 2, as amended by KLD-2026-07-28-001-A01",
    effect:
      "Delivery states aligned to pending/in_flight/retry_wait/acknowledged/rejected/dead_letter by hub migration 0015; reconciliation_required stays an ORTHOGONAL conflict state; one shared external projection with conflict override first.",
  },
  {
    id: "KLREQ-022",
    ruling: "KLD-2026-07-28-001 Group 3",
    effect:
      "No authoritative edge_finance ledger. The Hub emits finance-SOURCE events only; the boundary is unchanged by WS-10.",
  },
  {
    id: "KLREQ-023",
    ruling: "KLD-2026-07-28-001 Group 4",
    effect: "The four additive local mechanics are ratified into the canonical Hub schema.",
  },
  {
    id: "KLREQ-026",
    ruling: "KLD-2026-07-28-001 Group 6",
    effect:
      "Hub-issued effects use kh1.{command_result_uuid}.{event_ordinal} with contract-defined ordinals. Implemented in Cycle 9 (WS-10-T003): hub/effect-contract.ts, migration 0018. The interim kl1.{hub_device_uuid}.{hub_sequence} derivation is retired.",
  },
  {
    id: "KLREQ-027",
    ruling: "KLD-2026-07-28-001 Group 7",
    effect:
      "Direct provider-to-Hub callbacks are NOT authorized. The canonical path is provider -> cloud -> signed WS-10 delivery -> local projection; the Hub pipeline now takes the signed delivery id as its effect-key namespace. The RBAC key for a service-originated callback remains open under KLREQ-027's own [REQUIRED: ...] marker.",
  },
] as const;

// ---------------------------------------------------------------------------
// Residual risks — hazards that survive their own workaround
// ---------------------------------------------------------------------------

export interface HubResidualRisk {
  readonly id: string;
  readonly hazard: string;
  readonly observedImpact: string;
  readonly workaround: string;
  /** Why the hazard is STILL a risk even though a workaround exists. */
  readonly residual: string;
  readonly severity: "low" | "medium" | "high";
}

/**
 * KLRISK-HUB-001 — `GRANT ... TO current_user` SEGFAULTS the development
 * PostgreSQL server.
 *
 * This is recorded as a standing environment/tooling hazard, NOT as a closed
 * defect. The explicit-grantee workaround stops this repository from triggering
 * it; it does nothing about the server bug, and any other tool, migration,
 * runbook step or operator typing `GRANT ... TO current_user` against the same
 * image will crash the whole cluster again.
 */
export const RESIDUAL_RISK_GRANT_CURRENT_USER_CRASH: HubResidualRisk = {
  id: "KLRISK-HUB-001",
  hazard:
    "Executing `GRANT <role> TO current_user` against the development PostgreSQL 15.8 server (Supabase image, container supabase_db_kitluy-local) terminates the backend with SIGSEGV.",
  observedImpact:
    "Observed once during WS-09 command-layer development: 'server process (PID …) was terminated by signal 11: Segmentation fault', followed by 'terminating any other active server processes' and a full cluster restart into automatic crash recovery. The whole database server went down, not just the calling session. Recovery completed cleanly and no committed data was lost (redo replayed to 0/71E4CF8; the 15 applied Hub migrations and all fixtures verified intact afterwards), but every in-flight transaction across every database was aborted.",
  workaround:
    "Resolve `current_user` first and grant to the quoted literal role name instead (test/hub-fixtures.ts ensureRuntimeRoleMembership). Accepted by the owner.",
  residual:
    "The server-side crash is NOT fixed — only avoided in this repository. Any other caller (a different tool, an operator at psql, a future migration or runbook step) using the `current_user` form against the same image will crash the cluster again, aborting unrelated work. Recorded gap G7 already notes that the Hub production target is PostgreSQL 16 while development runs 15.8, so this hazard is specific to the development image and must not be assumed absent on the Hub image without evidence. Mitigations owed: pin/patch the development image, or add a lint/CI guard that rejects the `TO current_user` form.",
  severity: "medium",
};

/**
 * KLRISK-HUB-002 — the §3 GRANT surface is not exercised when the connected
 * development user cannot assume the Hub runtime role.
 */
export const RESIDUAL_RISK_ROLE_ASSUMPTION_FALLBACK: HubResidualRisk = {
  id: "KLRISK-HUB-002",
  hazard:
    "A production Hub connects AS kitluy_hub_runtime, but the Supabase development `postgres` user is not a superuser and may not be a member of that role, so `set local role` is refused with insufficient_privilege.",
  observedImpact:
    "The command layer continues as the connected user. The unconditional append-only and immutability triggers still reject, but the schema contract §3 GRANT surface (notably: no role holds DELETE anywhere) is NOT exercised by that run.",
  workaround:
    "withHubTransaction degrades with a ONE-TIME recorded warning, never silently; the test fixtures grant membership best-effort so the probes do run as the runtime role, and canAssumeRole() lets a suite state which mode it ran in.",
  residual:
    "Evidence quality depends on the developer machine. A green run on a machine without the grant proves the triggers, not the grants. Any evidence record must state which of the two it is.",
  severity: "low",
};

/** KLRISK-HUB-003 — backup/restore evidence is development-grade only. */
export const RESIDUAL_RISK_BACKUP_RESTORE_GRADE: HubResidualRisk = {
  id: "KLRISK-HUB-003",
  hazard:
    "The backup/restore round trip runs `pg_dump`/`pg_restore` against a containerised development database on x86-64, not against the Hub's PostgreSQL 16 ARM64 appliance image with its encrypted volume.",
  observedImpact:
    "A passing round trip proves the runner's checksum + fingerprint logic and that command-layer data survives drop and restore. It does NOT prove disaster recovery on real Hub hardware.",
  workaround:
    "The suite is OPT-IN (KITLUY_HUB_DESTRUCTIVE_TESTS=1), skips visibly otherwise, and is labelled DEVELOPMENT-GRADE in the file header and in every evidence claim.",
  residual:
    "Production disaster-recovery certification still requires hardware and pilot evidence. No status above IMPLEMENTED-IN-DEV may be claimed from this suite.",
  severity: "medium",
};

export const HUB_RESIDUAL_RISKS: readonly HubResidualRisk[] = [
  RESIDUAL_RISK_GRANT_CURRENT_USER_CRASH,
  RESIDUAL_RISK_ROLE_ASSUMPTION_FALLBACK,
  RESIDUAL_RISK_BACKUP_RESTORE_GRADE,
];

// ---------------------------------------------------------------------------
// Confirmed boundaries — settled, and asserted so they cannot drift
// ---------------------------------------------------------------------------

/**
 * The finance and sync boundary, CONFIRMED by the owner and unchanged by
 * WS-09-T005/T006. Listed here (not as an open item) so a reader can tell at a
 * glance which lines are settled and which are still owed.
 */
export const HUB_CONFIRMED_BOUNDARIES = {
  /** KLREQ-022 / recorded gap G8. */
  finance:
    "Hub-local payment and finance-SOURCE events only. NO edge_finance schema and NO Hub-side authoritative ledger: creating one would establish a second ledger, which KLD-FIN-002 forbids. The authoritative journal stays cloud-owned.",
  /** Amendment §2 / KLREQ-021. */
  sync: "WS-10 owns transmission, cloud acknowledgement and reconciliation. WS-09 writes ONLY delivery_state 'pending' and reports ONLY sync_state 'pending_cloud_sync'; it never fabricates an acknowledgement.",
  /** The persisted delivery state WS-09 is permitted to write. */
  ws09DeliveryState: "pending",
  /** The wire sync state WS-09 is permitted to report. */
  ws09WireSyncState: "pending_cloud_sync",
  /** Schemas that must NOT exist in the Hub-local database. */
  forbiddenSchemas: ["edge_finance", "edge_commands", "edge_events", "edge_print"],
} as const;

/**
 * The `pnpm hub:db:test` assertion count and the ONLY correct way to count it.
 *
 * `hub/tests/assertions.sql` emits exactly 32 `NOTICE:  PASS` lines — 29 from
 * WS-09 plus sections 29a/29b added by WS-10 for the delivery/conflict state
 * dimensions. A naive `grep -c PASS` also matches the runner's own summary line
 * ("assertions passed — 32 PASS notice(s)") and reports one too many. A count
 * derived from the summary line must never be reported.
 */
export const HUB_DB_ASSERTION_CONTRACT = {
  expectedPassNotices: 32,
  countCommand: 'pnpm hub:db:test | grep -c "NOTICE:  PASS"',
  wrongCountCommand:
    "pnpm hub:db:test | grep -c PASS   // reports 33 — also matches the summary line",
} as const;
