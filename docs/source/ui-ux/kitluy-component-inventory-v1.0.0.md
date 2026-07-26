# KitLuy Shared Component Inventory

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-component-inventory-v1.0.0.md`                 |
| Version        | `v1.0.0`                                               |
| Date           | 2026-07-26                                             |
| Owner          | HET / KitLuy Suite Project Owner                       |
| Status         | Canonical target standard; not implementation evidence |
| Primary market | Cambodia                                               |
| Languages      | Khmer (`km-KH`) and English (`en-KH`)                  |
| Currencies     | KHR and USD                                            |
| Timezone       | `Asia/Phnom_Penh`                                      |

> **Evidence rule:** This artifact defines a build contract. It is not evidence that Figma files, components, routes, code, migrations, tests or deployments exist. Every missing owner, brand, provider or production value is marked `[REQUIRED: ...]`.

## Authority and scope

Authority order:

1. Current owner decisions and KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. Current approved KitLuy Rebuild, Business and product specifications.
4. This UI/UX build-pack artifact after approval.
5. Approved handoffs and evidence-based analyses.
6. Competitor rebuild documents as design references only.

The shared design system is neutral. Laundry terminology belongs only in Laundry-specific compositions and must not be hardcoded into Core components.

## 1. Component registry rules

- Component names are stable PascalCase identifiers.
- Variants are explicit properties, not copied components.
- Every component has a Figma component-node reference and a code-package export before it is considered synchronized.
- Vertical components may compose shared primitives but must not change shared component semantics.
- Components that show money, status, freshness, permissions, audit or approvals consume authoritative typed contracts.

## 2. Figma and code reference fields

| Field        | Example                                                    |
| ------------ | ---------------------------------------------------------- |
| Component ID | `CMP-STATE-001`                                            |
| Figma file   | `[REQUIRED: design-system file_key]`                       |
| Figma node   | `[REQUIRED: node-id]`                                      |
| Code package | `@kitluy/ui` or approved product package                   |
| Export       | `StateBoundary`                                            |
| Status       | Proposed / Designed / Published / Implemented / Deprecated |
| Version      | SemVer and change note                                     |

## 3. Shared component inventory

| ID              | Component                   | Purpose                                                    | Required variants                                        | Accessibility contract                  | Primary consumers            | Figma node   |
| --------------- | --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ---------------------------- | ------------ |
| `CMP-SHELL-001` | `ManagementShell`           | Authenticated PWA shell                                    | expanded/collapsed nav, desktop/tablet/phone             | landmarks, skip link, focus restoration | Admin, Chain, Partner Portal | `[REQUIRED]` |
| `CMP-SHELL-002` | `MobileCockpitShell`        | Owner/manager mobile shell                                 | online/cached/offline                                    | logical focus, bottom-nav labels        | Partner App                  | `[REQUIRED]` |
| `CMP-SHELL-003` | `TerminalShell`             | Store operational shell                                    | T1/T2/T3/T4/KDS/kiosk                                    | keyboard/touch/scanner focus            | POS, KDS, kiosk              | `[REQUIRED]` |
| `CMP-SHELL-004` | `CustomerShell`             | Public/customer session shell                              | web/Telegram/display/kiosk                               | semantic steps, privacy reset           | Storefront, Guest, Kiosk     | `[REQUIRED]` |
| `CMP-CTX-001`   | `ScopeBreadcrumb`           | Tenant/Digital Store/Location/resource scope               | compact/full                                             | current scope announced                 | Admin, Chain                 | `[REQUIRED]` |
| `CMP-CTX-002`   | `DigitalStoreContextHeader` | Digital Store, Location, vertical and state                | fixed/switchable/read-only                               | switch change announced                 | Partner products             | `[REQUIRED]` |
| `CMP-CTX-003`   | `StoreContextHeader`        | Mobile/terminal Store context                              | compact/offline                                          | not color-only                          | Mobile, POS                  | `[REQUIRED]` |
| `CMP-STATE-001` | `StateBoundary`             | Canonical loading/empty/error/stale/partial/offline states | all `UI-ST-*`                                            | live regions and focus placement        | All apps                     | `[REQUIRED]` |
| `CMP-STATE-002` | `TruthBadge`                | Authority/completeness state                               | authoritative/estimated/cached/stale/partial/unavailable | text + icon                             | Management/reporting         | `[REQUIRED]` |
| `CMP-STATE-003` | `FreshnessBadge`            | Source freshness and `as_of`                               | fresh/pending/stale/unknown/offline                      | tooltip and screen-reader expansion     | All operational apps         | `[REQUIRED]` |
| `CMP-STATE-004` | `OfflineBanner`             | Hub/WAN/cache distinction                                  | hub-online-wan-offline/hub-offline/cache-only            | persistent but non-obstructive          | Mobile/POS/portals           | `[REQUIRED]` |
| `CMP-DATA-001`  | `MetricCard`                | Metric with definition, scope and source                   | default/alert/unavailable                                | heading and value association           | Dashboards                   | `[REQUIRED]` |
| `CMP-DATA-002`  | `DataTable`                 | Dense governed record table                                | selectable/sortable/filterable/exportable                | keyboard model, table semantics         | Admin/Chain/Partner          | `[REQUIRED]` |
| `CMP-DATA-003`  | `RecordDrawer`              | Record detail and actions                                  | side/full-screen                                         | focus trap and return                   | Management PWAs              | `[REQUIRED]` |
| `CMP-DATA-004`  | `RecordTimeline`            | Append-only events                                         | operational/audit/custody                                | ordered list, timestamp labels          | All operational apps         | `[REQUIRED]` |
| `CMP-FORM-001`  | `WizardForm`                | Resumable multi-step workflow                              | saved/blocked/complete                                   | step semantics, error summary           | Onboarding/setup             | `[REQUIRED]` |
| `CMP-FORM-002`  | `PhoneInputKH`              | Cambodian phone entry and normalization                    | local/+855/error                                         | label, format hint, error association   | Public/customer/staff        | `[REQUIRED]` |
| `CMP-FORM-003`  | `MoneyInput`                | Currency-aware input                                       | KHR/USD/read-only                                        | no float UI arithmetic, spoken currency | Authorized forms             | `[REQUIRED]` |
| `CMP-ACT-001`   | `ApprovalPanel`             | Sensitive action review and approval                       | A0-A4/pending/approved/expired                           | explicit impact and approver            | Admin/Partner/POS            | `[REQUIRED]` |
| `CMP-ACT-002`   | `ProtectedActionSheet`      | Mobile protected action                                    | confirm/re-auth/manager approval                         | focus and consequence                   | Mobile                       | `[REQUIRED]` |
| `CMP-ACT-003`   | `AsyncJobDrawer`            | Durable job progress and retry                             | queued/running/retrying/failed/completed                 | live status updates                     | Management PWAs              | `[REQUIRED]` |
| `CMP-FILE-001`  | `EvidenceUploader`          | Governed file upload                                       | queued/scanning/uploaded/rejected                        | progress, file type and error           | All relevant apps            | `[REQUIRED]` |
| `CMP-PERM-001`  | `PermissionGate`            | Presentation gate only; server remains authoritative       | hidden/disabled/explained                                | no protected-data leakage               | Authenticated apps           | `[REQUIRED]` |
| `CMP-PERM-002`  | `EffectiveAccessViewer`     | Explain effective permission and scope                     | user/service identity                                    | accessible permission matrix            | Admin                        | `[REQUIRED]` |
| `CMP-EDGE-001`  | `HubStatusBar`              | Hub identity/reachability/sync                             | healthy/degraded/offline/revoked                         | text/icon/haptic-independent            | POS/Mobile                   | `[REQUIRED]` |
| `CMP-EDGE-002`  | `ScannerFocus`              | Scanner/camera input state                                 | ready/scanning/match/mismatch/error                      | sound + haptic + visual, user controls  | POS/Mobile/Kiosk             | `[REQUIRED]` |
| `CMP-CUST-001`  | `QueueNumberCard`           | Large customer queue reference                             | waiting/called/skipped/ended                             | large type, live announcement           | Storefront/T2                | `[REQUIRED]` |
| `CMP-CUST-002`  | `CustomerConfirmationPanel` | Version-bound confirmation                                 | review/changed/confirmed/correction-requested            | clear changed values                    | Storefront/T2                | `[REQUIRED]` |
| `CMP-PAY-001`   | `PaymentStatus`             | Tender/payment lifecycle display                           | requested/pending/confirmed/failed/unknown               | never color-only; source/time           | POS/Storefront/Guest/Kiosk   | `[REQUIRED]` |
| `CMP-REP-001`   | `ExportJobPanel`            | Report/export generation and expiry                        | queued/ready/failed/expired                              | status announcements                    | Admin/Chain/Partner          | `[REQUIRED]` |

## 4. Product-specific composition sets

| Product        | Required composition set                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin          | `SystemStatusTree`, `DeviceIdentityCard`, `CompatibilityMatrix`, `ProvisioningWizard`, `ReleasePromotionPanel`, `PermissionRegistryTable`, `ApprovalPolicyEditor`, `AccessReviewWorkspace` |
| Chain          | `ComparisonMatrix`, `AvailabilityMatrix`, `CatalogVersionTable`, `PublicationDiff`, `ComplianceChecklist`, `CrossLocationMetric`                                                           |
| Partner Portal | `SetupProgress`, `ReadinessGate`, `ExceptionQueue`, `MoneySummary`, `ConfigurationDiff`, `TechnologyHealthPanel`                                                                           |
| Partner App    | `TodaySummary`, `AttentionCard`, `BookingSummaryCard`, `FinanceReadOnlyPanel`, `StoreHealthCard`                                                                                           |
| POS Desktop    | T1 `IntakeWorkspace`; T2 `CustomerDisplayState`; T3 `ReadyScanWorkspace`; T4 `PickupReleaseWorkspace`                                                                                      |
| POS Mobile     | `CameraScannerView`, `IntakeDraftEditor`, `PickupPreparation`, `ConflictResolutionCard`, `DiagnosticBundleCard`                                                                            |
| Storefront     | `ServiceCard`, `PreIntakeLineEditor`, `SecureCustomerQr`, `DifferenceSummary`, `QueueTimeline`, `PrivacyReset`                                                                             |
| B2B website    | `PublicHeader`, `MegaMenu`, `HeroSection`, `ProductCard`, `WorkflowDiagram`, `LeadForm`, `PortalContextSelector`                                                                           |
| Future clients | Components remain phase-gated until the corresponding product specification and state machine are approved                                                                                 |

## 5. Deprecation

A component may be deprecated only with a replacement, migration guide, affected screen list, removal version, visual-regression plan and Figma/code library update. Deprecated components remain in the `90 Deprecated` Figma page until all active routes are migrated.
