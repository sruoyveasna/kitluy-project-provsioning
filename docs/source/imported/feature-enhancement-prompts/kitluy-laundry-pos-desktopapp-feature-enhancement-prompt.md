# KitLuy Laundry POS Desktop — Wireframe Feature Enhancement Prompt
## Paste this into the **kitluy-laundry-pos-desktopapp_uiux** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** that must be added to the existing laundry POS Desktop wireframe. These features were identified by cross-matching 55 Gemini Deep Research outputs against the KitLuy product spec, then validated and locked by Het.

**Applies to:** `kitluy-laundry-pos-desktopapp` wireframe (currently v1.1.0, 1,069 lines, T1/T2/T4)

---

## PHASE 1 MVP — ADD THESE TO WIREFRAME NOW (7 features)

These sit on top of the existing locked 20 laundry features + E1 enhancement.

### KF-001 | Garment Chain-of-Custody Scan Events | CRITICAL
**What:** Every garment must be scannable across intake → wash → finishing → QA → packing → handover. Each scan creates an immutable event record with timestamp, station, operator, and status.
**Where in Desktop:** Add scan confirmation screen at each station transition. T1 intake scan, T4 conveyor load/unload scan, handover scan.
**Database:** `kitluy.orders.garment_scan_events`
**Edge Function:** `kitluy-garment-scan-log`
**UX:** Scanner beep + green flash confirmation. Red flash + error sound on duplicate/invalid scan. Show garment journey timeline on detail view.

### KF-002 | Conveyor Slot Optimization + Shortest-Path Retrieval | HIGH
**What:** When retrieving a garment from conveyor, system calculates shortest rotation direction (clockwise vs counter-clockwise) and assigns optimal slot during storage.
**Where in Desktop:** T4 conveyor screen — add slot assignment panel during storage, retrieval queue with estimated rotation time, shortest-path indicator.
**Database:** `kitluy.orders.conveyor_slots`, `kitluy.orders.conveyor_movements`
**Edge Function:** `kitluy-conveyor-slot-optimize`
**UX:** Visual conveyor map showing occupied/empty slots. Highlight target slot with rotation direction arrow. Show estimated wait time.

### KF-003 | Conveyor Preventive Maintenance + Fault Log | HIGH
**What:** Track conveyor health: motor hours, belt wear, fault events, maintenance schedule. Alert when maintenance due or fault detected.
**Where in Desktop:** T4 conveyor screen — add maintenance tab with checklist, fault history, and next-service countdown.
**Database:** `kitluy.inventory.device_fault_logs`
**Edge Function:** `kitluy-conveyor-health-check`
**UX:** Amber warning bar when maintenance overdue. Red alert on active fault. Maintenance log scrollable list with date, type, technician notes.

### KF-004 | Tag Material Profiles + Printer Template Management | HIGH
**What:** Support multiple tag substrate types (PET, nylon, high-chemical-resistant) and print templates per service type and printer model. Staff selects tag profile at intake.
**Where in Desktop:** T1 intake screen — add tag profile selector dropdown. Settings > Printer Templates management page.
**Database:** Extends existing tag/printer config
**Edge Function:** None (local printer driver config)
**UX:** Tag profile shows icon for material type (heat-resistant, chemical-resistant). Template preview before print.

### KF-005 | Scale Tare / Stabilization / Confidence Handling | HIGH
**What:** USB scale readings need stable-weight detection, tare support, disconnect detection, and retry states. Don't accept raw readings — wait for confidence.
**Where in Desktop:** T1 intake weight-entry screen — replace instant capture with stabilization indicator (animated bar), tare button, disconnect warning, retry prompt.
**Edge Function:** `kitluy-scale-read-validate`
**UX:** Weight display shows "Stabilizing..." with animated dots → locks to green confirmed value. Tare button zeroes display. Red "Scale Disconnected" banner if USB lost. "Re-weigh" button for retry.

### KF-007 | Rewash / QA Disposition Analytics | MEDIUM
**What:** When garment exceptions (re-clean flags) are logged, track root cause categories and surface analytics.
**Where in Desktop:** Existing garment exception flow — add root cause dropdown (stain remaining, wrong fold, damage, odor, other). QA summary panel on T4.
**Database:** Extends `kitluy.orders` exception fields
**Edge Function:** `kitluy-garment-exception` (existing, enhanced)
**UX:** Root cause pie chart on daily summary. Staff leaderboard for QA pass rate.

### KF-010 | Subscription Utilization + Margin Guardrails | MEDIUM
**What:** For stores offering laundry subscription plans (paid add-on), track per-subscriber usage against plan limits. Alert when subscriber is margin-negative.
**Where in Desktop:** Customer lookup screen — show subscription badge, remaining credits, usage bar. Block order if credits exhausted (manager override with PIN).
**Database:** `kitluy.customers.subscription_wallets`, `kitluy.customers.subscription_entitlements`
**Edge Function:** `kitluy-subscription-billing-cycle`
**UX:** Green/amber/red usage meter. "Credits Remaining: 3/10 bags" display. Manager override requires PIN.

---

## P2 — DEFERRED (3 features, add to wireframe later)

| ID | Feature | Priority | Why Deferred |
|---|---|---|---|
| KF-006 | Laundry subscription plans + credit wallets | HIGH | Paid add-on, not base Commerce. Build after core stabilizes. |
| KF-008 | Packaging profile + handover checklist | MEDIUM | Polish feature, not MVP-critical. |
| KF-009 | Receipt + tag reprint audit trail | MEDIUM | Fraud prevention layer, not day-one. |

---

## LOCKED DECISIONS AFFECTING THIS WIREFRAME

| Decision | Answer |
|---|---|
| Garment tags P1 | RFID-ready schema now, UI hidden. Barcode-only visible. |
| Conveyor optimization | Fully in KitLuy (not shared with PlantOS) |
| Subscription credits | No refunds, no carry-over, use-it-or-lose-it |
| POS labels | Khmer-first by default for all stores |
| Low-literacy mode | Store-wide toggle |
| Cash denomination presets | Configurable per store |
| UI customization | Colors + logo only, no layout changes |
| POS software image | One universal software, picks vertical at runtime setup |

---

## RULES

1. **Never rebuild wireframes from scratch** — only targeted `str_replace` edits
2. **Never change version numbers without explicit approval**
3. **KitLuy consumes Netra/Rotanak** — never build AI or loyalty engines inside KitLuy
4. **KHR ៛ integer only**, no decimals
5. **Design system locked** — Primary #0EA5E9, dark sidebar #0F172A, DM Sans
6. File naming: `xxxxx-wireframe-vX.Y.Z.jsx` (each segment multi-digit)
