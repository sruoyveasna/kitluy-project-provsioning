# Phase 1 — Laundry Stores and Shops (ACTIVE)

The only active vertical (RB v4 §2.1, KLV4-DEC-001). Laundry terminology lives
here — never in neutral Core.

**BUILT + TESTED:** owner-locked T1–T4 terminal profile model and capability
matrix; T2 customer-display state machine (POS spec §6.2); T3/T4 custody event
registry (Hub spec §10.3–10.4); per-piece and per-weight price-line arithmetic
with explicit rounding rules.

**NOT implemented (explicit required decisions, do not guess):** Booking
lifecycle state machine, garment/production state machine, receipt/tag
numbering, KHQR provider behavior, T4 payment default, partial ready/pickup
policy — see `REQUIRED_LAUNDRY_DECISIONS` in `src/index.ts`.
