# KitLuy Admin Portal — Wireframe Feature Enhancement Prompt
## Paste this into the **kitluy-admin-portal_UI UX** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** to add to the existing Admin Portal wireframe. All features below are **Phase 2** — the laundry POS is Phase 1 MVP. These are documented now so wireframe planning can begin.

**Applies to:** `kitluy-admin-portal` wireframe (currently v2.3.1, 665 lines, 32 routes)

---

## PHASE 2 — FEATURES TO ADD (10 features)

| ID | Feature | Priority | Source | Where in Admin Portal |
|---|---|---|---|---|
| KF-061 | Merchant acquisition CRM + funnel stages | CRITICAL | R44 | New sidebar group: CRM > Leads, Pipeline, Conversion Tracking. Structured lead-to-subscription funnel. |
| KF-062 | Zero-touch onboarding workspace | CRITICAL | R55, R54 | New sidebar group: Onboarding > Workspace. Coordinates device shipment, account setup, catalog readiness, go-live tasks in one view. |
| KF-063 | Fleet remote actions + observability console | HIGH | R54 | Fleet Ops > Console. Heartbeat, config drift, update status, remote restart/config push/printer re-pair/log pull. All remote actions allowed. |
| KF-064 | Activation + time-to-value dashboard | HIGH | R55 | Dashboard > Activation tab. First-value speed visibility, activation bottleneck identification. |
| KF-065 | Subscriber health + churn rescue playbooks | HIGH | R44, R55 | Subscribers > Health. Health scoring triggers suggested rescue workflows and outreach queues. |
| KF-066 | Ops benchmark console | MEDIUM | R29, R30 | New: Benchmarks. Shows which merchants are operationally underperforming. Partially visible to merchants as "health insights." |
| KF-067 | Device assignment + lifecycle registry | MEDIUM | R54 | Fleet Ops > Devices. Shipment, warranty, replacement, store mapping lifecycle records. |
| KF-068 | Assisted migration / upgrade workflow | MEDIUM | R55 | Subscribers > Upgrade. Commerce-to-Chain guided migration with checklist. |
| KF-069 | Guided self-onboarding templates by vertical | MEDIUM | R55 | Onboarding > Templates. Pre-bundled catalog/staff/pricing/printer defaults per vertical for faster setup. |
| KF-070 | Remote support session evidence log | LOW | R54 | Support > Evidence. Auditable notes tied to devices and interventions. |

---

## LOCKED DECISIONS AFFECTING ADMIN PORTAL

| Decision | Answer |
|---|---|
| CRM scope | KitLuy-only light CRM (not ecosystem-wide) |
| Remote device actions | All remote actions allowed (restart, config push, printer re-pair, logs) |
| Benchmark visibility | Partially visible to merchants as "health insights" |
| Trial before billing | 14-day free trial, then auto-bill |
| Spare parts stocking | Stock spares centrally (Het's team) |
| Public compliance claims | No public claims yet, internal discipline only |

---

## NEW DATABASE TABLES (Admin Portal relevant)

- `kitluy.admin.leads`
- `kitluy.admin.lead_activities`
- `kitluy.admin.onboarding_workspaces`
- `kitluy.admin.activation_checkpoints`
- `kitluy.admin.device_registry`
- `kitluy.admin.device_actions`
- `kitluy.admin.subscriber_health_scores`
- `kitluy.admin.support_interventions`
- `kitluy.admin.hardware_bundles`
- `kitluy.admin.spare_policies`
- `kitluy.admin.device_health_metrics`
- `kitluy.admin.backup_runs`
- `kitluy.admin.restore_tests`

## NEW EDGE FUNCTIONS (Admin Portal relevant)

- `kitluy-onboarding-provision`
- `kitluy-device-heartbeat-ingest`
- `kitluy-subscriber-health-v2`
- `kitluy-activation-score-calc`
- `kitluy-upgrade-workflow-start`

---

## REMINDERS

- Admin Portal is a **clone of HSA Admin Portal** (same codebase, same components). See `kitluy-admin-portal-build-prompt.md` for clone instructions.
- **KitLuy CONSUMES Netra** — Admin can consume health-risk scoring, churn propensity, anomaly patterns via Netra.
- All monetary values: **KHR ៛ integer only**
- File naming: `xxxxx-wireframe-vX.Y.Z.jsx`
- Never rebuild from scratch — targeted `str_replace` edits only
