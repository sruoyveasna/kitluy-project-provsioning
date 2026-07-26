# KitLuy Cross-Cutting Infrastructure — Feature Enhancement Prompt
## Paste this into the **Kitluy_Infrastructure_Architecture** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** that cut across all KitLuy products. These are not product-specific — they affect POS apps, portals, hardware, networking, and platform-wide systems. All features below are **Phase 2** — the laundry POS feature set (KF-001 to KF-010) is Phase 1 MVP.

**Affects:** All 5 KitLuy products + hardware + infrastructure

---

## HARDWARE (9 features)

| ID | Feature | Priority | Source | Scope |
|---|---|---|---|---|
| KF-071 | Industrial enclosure / cooling / watchdog baseline | CRITICAL | R06, R52 | Hardware team owns design. Consumer Pi builds too fragile for hot/humid long-run environments. |
| KF-072 | Peripheral auto-discovery + capability registry | CRITICAL | R17 | POS Desktop + Admin Portal. Zero-config detection of printers, scanners, scales, drawers. |
| KF-073 | Vertical-specific hardware bundle catalog | HIGH | R52 | Admin Portal. Laundry, cafe, restaurant, retail need different hardware payloads. |
| KF-074 | Spare-parts + replacement policy registry | HIGH | R04, R52 | Admin Portal. Stock centrally (Het's team). Planned spares and swap rules. |
| KF-075 | LAN service bus + typed device channels | HIGH | R43 | POS Desktop + Hub. Hub-terminal communication intentionally typed, discoverable, resilient. |
| KF-076 | Device fingerprinting + port mapping | MEDIUM | R17 | POS Desktop + Admin Portal. Zero-config pairing and support diagnostics. |
| KF-077 | Hardware health telemetry model | MEDIUM | R06, R52 | Admin Portal + POS. Thermal, storage wear, voltage, connectivity exposed to platform ops. |
| KF-078 | Store pre-provisioning image profiles | MEDIUM | R52, R43 | Admin Portal. One universal software, picks vertical at runtime setup. |
| KF-079 | Cable / network topology checklist tooling | LOW | R43 | Admin Portal. Real-world deployments fail on wiring more than software. |

---

## OFFLINE & SYNC (8 features)

| ID | Feature | Priority | Source | Scope |
|---|---|---|---|---|
| KF-080 | Immutable local event log with HLC ordering | CRITICAL | R07, R43 | POS Desktop + Hub. Preserve causal ordering across terminals, avoid clock-skew corruption. |
| KF-081 | Entity-specific merge policies | CRITICAL | R07 | Hub → Cloud sync. Inventory, orders, payments, settings should NOT all use last-write-wins. (PARKED: exact entity rules TBD) |
| KF-082 | Sync snapshots + compaction | HIGH | R07, R41 | Hub. Event logs need bounded replay cost and recovery checkpoints. |
| KF-083 | Dead-letter queue for failed sync events | HIGH | R07 | Hub → Cloud. Failed sync items need review and retry, not silent loss. |
| KF-084 | Backup / restore drill runner | HIGH | R33 | Admin Portal (internal-only, not merchant-facing). DR only matters if restores are tested. |
| KF-085 | Local network service discovery + session health | HIGH | R43 | POS Desktop + Hub. Explicit session monitoring for hub-terminal reliability. |
| KF-086 | Device-side crash recovery / startup replay | MEDIUM | R41, R07 | POS Desktop. Recover transaction state safely after power loss. |
| KF-087 | Sync observability dashboard | MEDIUM | R33, R43 | Admin Portal + Seller Portal. Lag, failed events, replay counts, backup freshness. |

---

## SECURITY & COMPLIANCE (8 features)

| ID | Feature | Priority | Source | Scope |
|---|---|---|---|---|
| KF-088 | Payment webhook idempotency + signed-event vault | CRITICAL | R32 | Edge Functions. Duplicate/spoofed payment notifications = major risk. |
| KF-089 | Device hardening + patch compliance service | CRITICAL | R34 | POS Desktop + Admin Portal. Patch state, config baseline, non-compliance alerts. |
| KF-090 | Network segmentation checklist + policy model | HIGH | R32, R34 | Hardware bundles (enforced, pre-configured). Full segmentation per store tier. |
| KF-091 | Secrets rotation + device credential lifecycle | HIGH | R34 | POS Desktop + Admin Portal. No static credentials on edge devices. |
| KF-092 | Security event ledger + incident workflow | HIGH | R32, R34 | Admin Portal. Structured response for suspicious webhooks, tampering, patch failures. |
| KF-093 | Labor-law policy engine for shifts/overtime/breaks | HIGH | R03 | Seller Portal. Cambodia working-hour constraints. Warnings P1, hard blocks later. |
| KF-094 | Role review + privileged-action audit | MEDIUM | R32, R34 | All products. Refunds, voids, overrides, device actions need formal auditability. |
| KF-095 | Compliance knowledge surface for merchants | LOW | R03 | Seller Portal. Guide merchants on compliance without becoming legal software. |

---

## POS UX & DESIGN (7 features)

| ID | Feature | Priority | Source | Scope |
|---|---|---|---|---|
| KF-096 | Khmer-first bilingual label system | CRITICAL | R15, R02 | All POS apps. Khmer-first by default for all stores. Predictable label presentation. |
| KF-097 | Low-literacy icon mode + guided action states | HIGH | R15 | All POS apps. Store-wide toggle. Reduces training time and operational mistakes. |
| KF-098 | KHQR confirmation choreography | HIGH | R02 | All POS apps. Deliberate visual transitions: waiting → confirmed → fallback → retry. |
| KF-099 | Cash quick-key + denomination assist | HIGH | R02 | All POS apps. Fast notes/change shortcuts. Configurable per store. |
| KF-100 | Environmental dark-mode presets | MEDIUM | R53 | All POS apps. Bright front-of-house, low-light kitchen, sunlight counters = different contrast. |
| KF-101 | Error-safe flow design for critical actions | MEDIUM | R15 | All POS apps. Voids, refunds, overrides use unmistakable confirmation patterns. |
| KF-102 | Accessibility token pack for touch terminals | MEDIUM | R53, R15 | Design system. Touch spacing, font floor, contrast floors codified as tokens. |

---

## FUTURE ROADMAP (10 features)

| ID | Feature | Priority | Source | Phase |
|---|---|---|---|---|
| KF-103 | Runtime module / plugin registry for unified POS | CRITICAL | R31 | P2.0. Laundry + Cafe day one; Restaurant + Retail added incrementally. |
| KF-104 | Social commerce order-ingestion connectors | HIGH | R45 | P2+. Targets: Facebook + TikTok + Shopee + Telegram + Instagram. |
| KF-105 | Forecast + anomaly surfaces via Netra contracts | HIGH | R48, R49 | P2. Explicit UI/API contracts between KitLuy and Netra. |
| KF-106 | Pricing / packaging experiment framework | HIGH | R05 | P2. Test bundles, add-ons, pricing ladders safely. |
| KF-107 | Voice command pilot layer | MEDIUM | R38 | P3B+. Deferred until Khmer ASR matures. |
| KF-108 | Embedded finance readiness ledger | MEDIUM | R50 | P3. Orchestration only (PARKED: balance-sheet participation TBD). |
| KF-109 | Computer vision event ingestion contract | MEDIUM | R51 | P3. Plug-in later without distorting core data model. |
| KF-110 | Unified feature-flag + capability policy engine | MEDIUM | R31, R39 | P2.0. Necessary as products and modules grow. |
| KF-111 | AI-first operator assist surfaces | MEDIUM | R39 | P2+. Smart cart suggestions, next-best-action banners, predictive warnings. |
| KF-112 | Future finance / partner APIs | LOW | R50 | P3+. Merchant capital, insurance, risk signal integrations. |

---

## LOCKED DECISIONS (CROSS-CUTTING)

| Decision | Answer |
|---|---|
| POS software image | One universal software, picks vertical at runtime setup |
| LAN segmentation | Full segmentation enforced per store tier |
| Network segmentation | Enforced in hardware bundles (pre-configured) |
| Spare parts | Stock centrally (Het's team) |
| Max offline replay | 24 hours, then manual inspection required |
| Restore tooling | Internal-only (KitLuy support team) |
| Labor-rule violations | Warnings P1, hard blocks later |
| Incident SLAs + audit export | Deferred to later release |
| Public compliance claims | No public claims yet, internal discipline only |
| P2.0 unified runtime | Laundry + Cafe day one; Restaurant + Retail incremental |
| Social commerce targets | All major: Facebook + TikTok + Shopee + Telegram + Instagram |

### PARKED (needs future review)

| Topic | Status |
|---|---|
| Replace last-write-wins for inventory | Needs deeper architecture review |
| Entity sync rules (append-only vs mergeable) | Needs deeper architecture review |
| Minimum Khmer ASR accuracy | Deferred until voice pilot Phase 3B+ |
| Embedded finance model | Deferred until Phase 3+ |
| Experiment complexity for SME merchants | Revisit after merchant testing |
| Industrial-grade hardware selection | Owned by Het's hardware team |
