# KitLuy Laundry POS Mobile — Wireframe Feature Enhancement Prompt
## Paste this into the **kitluy-laundry-pos-mobileapp_uiux** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** that must be added to the existing laundry POS Mobile wireframe. These features were identified by cross-matching 55 Gemini Deep Research outputs against the KitLuy product spec, then validated and locked by Het.

**Applies to:** `kitluy-laundry-pos-mobileapp` wireframe (currently v1.3.0, 2,354 lines, Samsung Tab A9/A11)

---

## PHASE 1 MVP — ADD THESE TO WIREFRAME NOW (7 features)

These sit on top of the existing locked 20 laundry features + E1 enhancement.

### KF-001 | Garment Chain-of-Custody Scan Events | CRITICAL
**What:** Every garment must be scannable across intake → wash → finishing → QA → packing → handover. Each scan creates an immutable event record with timestamp, station, operator, and status.
**Where in Mobile:** Floor QA scan screen, pickup confirmation scan, assisted intake scan verification.
**Database:** `kitluy.orders.garment_scan_events`
**Edge Function:** `kitluy-garment-scan-log`
**UX:** Scanner beep + green flash confirmation. Red flash + error sound on duplicate/invalid scan. Show garment journey timeline on detail view.

### KF-002 | Conveyor Slot Optimization + Shortest-Path Retrieval | HIGH
**What:** When retrieving a garment from conveyor, system calculates shortest rotation direction (clockwise vs counter-clockwise) and assigns optimal slot during storage.
**Where in Mobile:** Read-only conveyor status view for floor staff — shows occupied/empty slots and current retrieval queue.
**Database:** `kitluy.orders.conveyor_slots`, `kitluy.orders.conveyor_movements`
**Edge Function:** `kitluy-conveyor-slot-optimize`
**UX:** Simplified conveyor map (read-only). Active retrieval highlighted. No slot assignment controls on mobile (desktop T4 only).

### KF-003 | Conveyor Preventive Maintenance + Fault Log | HIGH
**What:** Track conveyor health: motor hours, belt wear, fault events, maintenance schedule.
**Where in Mobile:** Maintenance alert badge visible to floor supervisor. Tap to view fault details and maintenance due date. No edit controls (desktop only).
**Database:** `kitluy.inventory.device_fault_logs`
**Edge Function:** `kitluy-conveyor-health-check`
**UX:** Amber badge on home screen when maintenance overdue. Red badge on active fault. Tap → read-only fault detail.

### KF-004 | Tag Material Profiles + Printer Template Management | HIGH
**What:** Support multiple tag substrate types (PET, nylon, high-chemical-resistant) and print templates per service type and printer model.
**Where in Mobile:** Tag profile selection during assisted intake flow. Dropdown selector matching desktop T1 options.
**Database:** Extends existing tag/printer config
**Edge Function:** None (local printer driver config via Hub)
**UX:** Tag profile shows icon for material type. Print triggers via Hub Wi-Fi relay to nearest tag printer.

### KF-005 | Scale Tare / Stabilization / Confidence Handling | HIGH
**What:** USB scale readings need stable-weight detection, tare support, disconnect detection, and retry states.
**Where in Mobile:** Weight flow when tablet connected to scale via Hub. Same stabilization/tare/retry UX as desktop but adapted for tablet touch targets.
**Edge Function:** `kitluy-scale-read-validate`
**UX:** Weight display shows "Stabilizing..." → locks to green confirmed value. Tare button. "Scale Unavailable" message if no Hub/scale connection (graceful degradation — allow manual weight entry as fallback).

### KF-007 | Rewash / QA Disposition Analytics | MEDIUM
**What:** When garment exceptions (re-clean flags) are logged, track root cause categories.
**Where in Mobile:** QA inspection screen — add root cause dropdown (stain remaining, wrong fold, damage, odor, other). Floor QA is the primary mobile use case.
**Database:** Extends `kitluy.orders` exception fields
**Edge Function:** `kitluy-garment-exception` (existing, enhanced)
**UX:** Large touch-friendly root cause buttons. Photo capture for evidence. Submit creates exception event + scan log entry.

### KF-010 | Subscription Utilization + Margin Guardrails | MEDIUM
**What:** For stores offering laundry subscription plans (paid add-on), track per-subscriber usage against plan limits.
**Where in Mobile:** Customer lookup screen — show subscription badge, remaining credits, usage bar. Same display as desktop.
**Database:** `kitluy.customers.subscription_wallets`, `kitluy.customers.subscription_entitlements`
**Edge Function:** `kitluy-subscription-billing-cycle`
**UX:** Green/amber/red usage meter. "Credits Remaining: 3/10 bags". Manager override requires PIN.

---

## P2 — DEFERRED (3 features, add to wireframe later)

| ID | Feature | Priority | Why Deferred |
|---|---|---|---|
| KF-006 | Laundry subscription plans + credit wallets | HIGH | Paid add-on, not base Commerce. Build after core stabilizes. |
| KF-008 | Packaging profile + handover checklist | MEDIUM | Polish feature, not MVP-critical. |
| KF-009 | Receipt + tag reprint audit trail | MEDIUM | Fraud prevention layer, not day-one. |

---

## MOBILE-SPECIFIC DESIGN NOTES

- Samsung Tab A9 (8.7") and Tab A11 (11") are the target devices
- Touch targets minimum 48px
- Floor staff often hold tablet with one hand — keep primary actions within thumb reach
- Camera is a primary input device on mobile (QA photos, damage evidence, scan fallback)
- Wi-Fi → Hub → Cloud failover chain applies — mobile must handle Hub disconnect gracefully
- Scale/printer interactions happen via Hub relay, not direct USB

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
