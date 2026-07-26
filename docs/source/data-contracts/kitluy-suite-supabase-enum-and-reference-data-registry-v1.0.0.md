# KitLuy Suite Supabase Enum and Reference Data Registry

**Filename:** `kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target registry; not implementation evidence

> **Mission:** Give every status, reason, vertical, risk, channel and operational code one stable owner, storage strategy and evolution rule.

## Authority and implementation-truth rule

This artifact is a **canonical target implementation contract**. It is not evidence that a database object, policy, function, seed, deployment, backup, or test exists.

Authority order:

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions.
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence, and production evidence.
3. `kitluy-suite-supabase-schema-v1.0.0.md`, `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`, and `kitluy-suite-supabase-migration-plan-v1.0.0.md`.
4. This artifact and the other documents in the Supabase implementation pack.
5. Current Suite, Business, product, Store Hub, infrastructure, and API specifications.
6. Approved handoffs and evidence-based comparison/classification documents.
7. Competitor clone documents and superseded planning.

**Applied SQL migrations are the final deployed schema truth.** Documentation may generate, review, explain, or validate migrations, but it must never become a parallel database definition. A documentation-to-migration mismatch must fail CI or be recorded in the reconciliation register before release.

No capability may be labeled `IMPLEMENTED` without repository, applied-migration, executable-test, deployment, and applicable pilot/production evidence.

## Storage strategy

Use PostgreSQL native enums only for small, truly stable technical sets whose value removal/renaming is practically forbidden. Use reference tables for business statuses, reason codes and values expected to evolve, localize, deactivate or vary by phase. Never place user-facing labels in enum values.

| Registry class                           | Storage                                                  | Rule                                                                           |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Stable technical booleans/limited states | Native enum or CHECK                                     | Additive values only; never reorder semantics.                                 |
| Business lifecycle/status                | `kitluy_core.reference_values` or domain reference table | Effective dates, status, translations and owner.                               |
| Reason codes                             | Reference table                                          | Mandatory code, category, severity, required-evidence flags and applicability. |
| Vertical codes                           | Reference table                                          | Owner-locked sequence and activation phase.                                    |
| Provider codes                           | Connector/payment reference table                        | Never hardcode secrets or provider behavior into Core enums.                   |

## Vertical registry

| Code               | Canonical vertical                        | Phase | Status                    |
| ------------------ | ----------------------------------------- | ----: | ------------------------- |
| `LAUNDRY`          | Laundry Stores and Shops                  |     1 | OWNER-LOCKED ACTIVE BUILD |
| `CAFE_RESTAURANT`  | Café and Restaurant Stores                |     2 | LOCKED ROADMAP            |
| `ECOMMERCE`        | Online Retailers and eCommerce Businesses |     3 | LOCKED ROADMAP            |
| `CONVENIENCE`      | Convenience Stores                        |     4 | LOCKED ROADMAP            |
| `PHARMACY`         | Drugstores and Pharmacies                 |     5 | LOCKED ROADMAP            |
| `DEPARTMENT_STORE` | Department Stores                         |     6 | LOCKED ROADMAP            |
| `GROCERY`          | Grocery Stores                            |     7 | LOCKED ROADMAP            |
| `SUPERMARKET`      | Supermarkets                              |     8 | LOCKED ROADMAP            |

A Digital Store has exactly one primary vertical code. A Partner operating different business types creates separate Digital Stores under the same Tenant/Partner account.

## Core lifecycle registries

| Registry key                  | Values                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tenant_status`               | `ONBOARDING`, `ACTIVE`, `GRACE`, `SUSPENDED`, `CANCELLED`                                                           |
| `partner_verification_status` | `NOT_STARTED`, `PENDING`, `NEEDS_INFORMATION`, `APPROVED`, `REJECTED`, `SUSPENDED`                                  |
| `digital_store_status`        | `DRAFT`, `CONFIGURING`, `READY_FOR_PROVISIONING`, `ACTIVE_ONLINE`, `ACTIVE_HYBRID`, `PAUSED`, `SUSPENDED`, `CLOSED` |
| `store_location_status`       | `PLANNED`, `PROVISIONING`, `VALIDATING`, `ACTIVE`, `DEGRADED`, `SUSPENDED`, `CLOSED`                                |
| `membership_status`           | `INVITED`, `ACTIVE`, `SUSPENDED`, `EXPIRED`, `REVOKED`                                                              |
| `catalog_record_status`       | `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED`                                                                             |
| `freshness_state`             | `LIVE`, `CURRENT`, `DELAYED`, `STALE`, `UNKNOWN`                                                                    |
| `completeness_state`          | `COMPLETE`, `PARTIAL`, `MISSING`, `UNKNOWN`                                                                         |
| `reconciliation_state`        | `NOT_REQUIRED`, `PENDING`, `MATCHED`, `DIFFERENCE`, `FAILED`, `STALE`                                               |

## Laundry registries

| Registry key             | Values                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laundry_booking_status` | `DRAFT`, `RECEIVED`, `IN_PRODUCTION`, `WASHING`, `DRYING`, `PRESSING`, `QA`, `READY`, `PICKUP_IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `ISSUE`, `REWASH`, `DAMAGED`                 |
| `garment_status`         | `RECEIVED`, `TAGGED`, `WASHING`, `DRYING`, `PRESSING`, `QA`, `PACKED`, `READY`, `RELEASED`, `EXCEPTION`                                                                            |
| `garment_scan_type`      | `INTAKE`, `WASH_START`, `WASH_COMPLETE`, `DRY_START`, `DRY_COMPLETE`, `PRESS_START`, `PRESS_COMPLETE`, `QA_PASS`, `QA_FAIL`, `READY_SCAN_IN`, `PICKUP_SCAN_OUT`, `REWASH`, `ISSUE` |
| `terminal_role`          | `T1_POS_CASHIER_INTAKE`, `T2_CUSTOMER_DISPLAY`, `T3_CLEAN_READY_SCAN_IN`, `T4_CUSTOMER_PICKUP_SCAN_OUT`                                                                            |
| `pricing_mode`           | `PER_PIECE`, `PER_WEIGHT`, `FIXED`, `MIXED_COMPONENT`                                                                                                                              |
| `garment_exception_type` | `MISSING`, `EXTRA`, `DAMAGED`, `REWASH`, `MISMATCH`, `UNREADABLE_TAG`, `QUALITY_HOLD`, `CUSTOMER_DISPUTE`                                                                          |
| `ready_position_status`  | `AVAILABLE`, `OCCUPIED`, `BLOCKED`, `MAINTENANCE`                                                                                                                                  |
| `pickup_handoff_status`  | `AWAITING_RETRIEVAL`, `AWAITING_VERIFICATION`, `PAYMENT_BLOCKED`, `READY_TO_RELEASE`, `COMPLETED`, `EXCEPTION`                                                                     |
| `booking_source`         | `WALK_IN`, `PHONE`, `STOREFRONT_WEB`, `TELEGRAM`, `PARTNER_PORTAL`, `PARTNER_APP`, `POS_MOBILE`, `CONNECTOR`, `OTHER`                                                              |

`PRESSING` is the canonical business-facing term; legacy backend value `IRONING` requires an explicit compatibility mapping, not dual uncontrolled values.

## Payment, finance and inventory registries

| Registry key                | Values                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payment_method`            | `CASH`, `KHQR`, `CARD`, `CUSTOMER_TAB`, `STORE_CREDIT`, `OTHER_APPROVED`                                                                                                       |
| `payment_status`            | `PENDING`, `AUTHORIZED`, `PENDING_VERIFICATION`, `CAPTURED`, `FAILED`, `VOIDED`, `PARTIALLY_REFUNDED`, `REFUNDED`                                                              |
| `refund_status`             | `REQUESTED`, `PENDING_APPROVAL`, `APPROVED`, `PROCESSING`, `COMPLETED`, `FAILED`, `REJECTED`                                                                                   |
| `cash_drawer_event_type`    | `OPEN_FLOAT`, `CASH_SALE`, `CASH_REFUND`, `PAID_IN`, `PAID_OUT`, `DROP`, `COUNT`, `CLOSE`, `ADJUSTMENT`                                                                        |
| `stock_movement_type`       | `OPENING`, `PURCHASE_RECEIPT`, `CONSUMPTION`, `SALE`, `RETURN_IN`, `RETURN_OUT`, `TRANSFER_OUT`, `TRANSFER_IN`, `COUNT_ADJUSTMENT`, `WASTE`, `DAMAGE`, `QUARANTINE`, `RELEASE` |
| `inventory_tracking_policy` | `NONE`, `QUANTITY`, `BATCH`, `SERIAL`, `EXPIRY_BATCH`                                                                                                                          |

## Security, device and release registries

| Registry key              | Values                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `environment_code`        | `DEVELOPMENT`, `STAGING`, `PRODUCTION`                                                                                      |
| `permission_risk_class`   | `LOW`, `MODERATE`, `HIGH`, `CRITICAL`                                                                                       |
| `approval_treatment`      | `NONE`, `REAUTH`, `SINGLE_APPROVER`, `FOUR_EYES`, `BREAK_GLASS_ONLY`                                                        |
| `device_type`             | `STORE_HUB`, `POS_TERMINAL`, `CUSTOMER_DISPLAY`, `KDS`, `MOBILE`, `PRINTER_BRIDGE`, `OTHER_CERTIFIED`                       |
| `device_lifecycle_status` | `FACTORY_RECORDED`, `IMAGED`, `AVAILABLE`, `PROVISIONING`, `ACTIVE`, `DEGRADED`, `QUARANTINED`, `REVOKED`, `RMA`, `RETIRED` |
| `certificate_status`      | `ISSUED`, `ACTIVE`, `ROTATING`, `EXPIRED`, `REVOKED`, `COMPROMISED`                                                         |
| `release_channel`         | `INTERNAL`, `PILOT`, `STABLE`                                                                                               |
| `installation_status`     | `DESIRED`, `DOWNLOADING`, `DOWNLOADED`, `INSTALLING`, `HEALTH_CHECKING`, `ACTIVE`, `FAILED`, `ROLLING_BACK`, `ROLLED_BACK`  |
| `sync_status`             | `PENDING`, `SENDING`, `ACKNOWLEDGED`, `RETRY`, `DEAD_LETTER`                                                                |
| `sync_conflict_status`    | `OPEN`, `AUTO_RESOLVED`, `OPERATOR_REVIEW`, `RESOLVED`, `REJECTED`                                                          |

## Storefront, queue and notification registries

| Registry key                    | Values                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `storefront_publication_status` | `DRAFT`, `PUBLISHED`, `PAUSED`, `UNPUBLISHED`, `DEGRADED`                                        |
| `entry_point_type`              | `WEB`, `STORE_QR`, `LOCATION_QR`, `TELEGRAM`, `SOCIAL`, `CAMPAIGN`, `DIRECT`                     |
| `pre_intake_status`             | `DRAFT`, `SUBMITTED`, `CHECKED_IN`, `VERIFYING`, `VERIFIED`, `CONVERTED`, `EXPIRED`, `CANCELLED` |
| `queue_ticket_status`           | `WAITING`, `CALLED`, `SERVING`, `COMPLETED`, `NO_SHOW`, `EXPIRED`, `CANCELLED`                   |
| `notification_delivery_status`  | `QUEUED`, `SUPPRESSED`, `SENT`, `DELIVERED`, `FAILED`, `BOUNCED`, `EXPIRED`                      |
| `consent_state`                 | `UNKNOWN`, `GRANTED`, `DENIED`, `WITHDRAWN`, `NOT_REQUIRED`                                      |

## Reason-code registry requirements

Every reason-code row contains: `registry_key`, `value_code`, category, severity, whether a note/evidence/approval is required, applicable resource/action/status transitions, effective dates, owner and translations.

Minimum reason families:

- cancellation, void, refund and price override;
- cash paid-in/paid-out and variance;
- service pause/re-enable;
- Booking status override and due-date change;
- garment issue, rewash, damage, missing/extra item;
- pickup exception and collector-verification override;
- inventory adjustment, waste, damage and quarantine;
- access request, approval denial, temporary grant and break-glass;
- device quarantine, certificate revocation, RMA and release rollback;
- sync conflict resolution and replay;
- support access/intervention;
- data correction, retention exception and legal hold.

## Status-transition contract

Each lifecycle registry has a migration-owned transition matrix table or validation function. Invalid transitions fail with stable error codes. Direct SQL writes from clients are prohibited for side-effecting transitions.

## Registry acceptance criteria

1. No duplicate semantic status exists under different codes without an approved compatibility mapping.
2. Every code has an owner, effective date, status and English/Khmer labels where user-facing.
3. Deactivated codes remain queryable for historical records.
4. Native enums are additive only; changeable values use reference tables.
5. Seeds are idempotent and use upsert guards that do not overwrite owner-edited labels without explicit version change.
