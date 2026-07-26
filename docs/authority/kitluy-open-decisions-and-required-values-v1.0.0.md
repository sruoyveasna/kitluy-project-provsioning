# KitLuy Open Decisions and Required Values — v1.0.0

Created at bootstrap, 2026-07-26. Values here are **never guessed** — they
block the dependent work until an authorized decision exists. Sources: RB v4
§12.3 + Appendix E; BB v2 Appendix A; per-spec appendices; bootstrap findings.

## A. Blocking the next engineering milestones

| ID        | Required value / decision                                                                                         | Blocks                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| KLREQ-001 | Supabase schema v1.0.0 + RLS v1.0.0 + migration plan v1.0.0 + data dictionary + enum/state registry (RB v4 §13.3) | All DDL, seeds, RLS tests, real service behavior  |
| KLREQ-002 | Reconciled Edge Operations API v1 route contract (KLREC-2026-07-26-001)                                           | Hub LAN business routes, POS integration          |
| KLREQ-003 | Exact Laundry Booking + garment/production state machines                                                         | verticals/phase1-laundry beyond current contracts |
| KLREQ-004 | Hub local-schema entity naming reconciliation (KLREC-2026-07-26-002)                                              | Hub local PostgreSQL migrations                   |
| KLREQ-005 | Master feature registry .md/.json regeneration or confirmation CSV is authoritative (KLREC-2026-07-26-004)        | Traceability tooling                              |
| KLREQ-006 | kitluy-store-hub-managed-device-security-lock-and-build-spec-v1.0.0.md (cited, missing)                           | Device-security build tasks                       |

## B. Owner-depth decisions (RB v4 §12.3)

- KLMF-CUS-006 — consent/privacy/export/deletion depth
- KLMF-GOV-006 — feature-flag/entitlement commercial depth (never paywalling safety/finance/audit/backup/portability)
- KLMF-SUB-001 — subscriptions/recurring commerce scope
- KLMF-TAX-001 — tax configuration/calculation/reporting depth (Cambodia launch)

## C. Required production values (RB v4 Appendix E + infra spec Appendix A)

Legal entity name and license text · production/staging/pilot domains · DNS
provider · TLS/CA policy · Supabase project references, plans, connection
modes · DigitalOcean project name, App Platform app inventory, registry names,
Spaces bucket names/regions/lifecycle · PKI root/intermediate CA + HSM design,
secure-element/TPM model, certificate validity/rotation windows · Store Hub and
terminal BOM (certified models, suppliers) · provider contracts and credentials
for KHQR, email, SMS, push, maps · tax/privacy/retention/deletion policies ·
session/re-auth/approval expiry/quorum values · SLOs, alert thresholds,
RPO/RTO by data class · autoscaling maximums and budgets · production owners,
approvers, on-call roster.

## D. Product-level required values (per Phase 1 spec appendices)

- **B2B website (15):** domain, brand label, pricing packaging, trial duration, legal texts, email policy, MFA policy, analytics provider, CMS, logos, status page, self-service checkout, chain provisioning mode, lead SLA, phone/email providers.
- **Admin portal (14):** MFA/session/re-auth policy, A0–A4 classification + approval TTLs/quorum, scope taxonomy, dormant thresholds, break-glass roster, audit retention, SaaS prices, SLO/RPO/RTO, certified hardware, payment credentials, signing-key custody, support-consent wording.
- **Chain portal (14):** freshness thresholds per read model, metric formulas + test vectors, design tokens/fonts, auth policy, load targets, compliance templates, notification providers.
- **Partner portal (OD-001..016):** router/build baseline, business-date rollover, POS PIN policy, KHQR contracts, refund/void thresholds, retention depth, connector list, AI provider/limits.
- **Partner app (KPA2-DEC-001..012):** bundle IDs, min OS versions, library pins, cache retention/encryption, thresholds, finance read models, push provider, AI limits.
- **POS mobile (30):** bundle IDs, certified devices, encryption impl, idempotency key format, retention caps, EXIF/GPS policy, MDM approach, alert thresholds.
- **POS desktop (Part 25):** receipt/tag numbering incl. offline sequences, KHQR degraded policy, T4 payment default, partial ready/pickup, collector verification/OTP, cash blind-count variance, cert lifetimes, print templates + Khmer font strategy, backup RPO/RTO, performance thresholds.
- **Store Hub (App. C):** production domains, CA/HSM, TPM model, Pi OS release, PostgreSQL major version, Node LTS pin, LAN ports/discovery protocol, cert validity, monitoring thresholds, backup cadence, RPO/RTO, offline retention watermark, certified printer/scale models, KHQR degraded policy, offline numbering policy.
- **Storefront (App. C.2, 16):** domain/URL strategy, phone-verification provider + rate limits, Telegram bot identity/webhook secrets, privacy notice/retention, queue expiry/no-show defaults, accessibility matrix, performance budgets, pilot KPIs.

## E. Commercial unknowns (BB v2 Appendix A — 25 items)

BUS-PRC-001..014 (all pricing: single-store, chain, annual discount,
trial/pilot terms, activation fee, hardware sale/lease/managed, premium
support, SLA, included capacity, migration services, connector capacity,
tax/invoicing, referral) · BUS-SLA-001/002 · BUS-HW-001/002 ·
BUS-PILOT-001/002 · BUS-DATA-001 · BUS-MET-001 (Healthy Weekly Operational
Store definition) · BUS-FIN-001 · BUS-MKT-001 · BUS-ORG-001.

## F. Repository-level required values (bootstrap findings)

- [REQUIRED: exact legal entity name for LICENSE]
- [REQUIRED: security contact address for SECURITY.md]
- [REQUIRED: conduct contact for CODE_OF_CONDUCT.md]
- [REQUIRED: GitHub organization/handles for CODEOWNERS and remote]
- [REQUIRED: canonical ID format (UUID version etc.) for branded IDs]
- [REQUIRED: minimum API deprecation window]
- [REQUIRED: approved brand tokens and Khmer font strategy for @kitluy/web-ui]
- [REQUIRED: dependency-audit triage policy (security.yml is advisory until set)]
