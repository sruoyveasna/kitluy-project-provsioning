# KitLuy Release Channel and Promotion Policy

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-release-channel-and-promotion-policy-v1.0.0.md`                     |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Govern immutable release progression through Internal, Pilot and Stable, including cohorts, approvals, compatibility, rollback and revocation.

## Source authority and evidence discipline

This document is derived from the current KitLuy Project Instructions and the following approved target sources:

- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`
- `kitluy-storehub-phase1-spec-v1.0.0.md`
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`
- current Phase 1 product specifications and owner-locked Digital Store, Store Hub, T1–T4, provisioning, release and security decisions

Authority order:

1. Current owner decisions and active Project Instructions.
2. Applied migrations, verified code/tests, infrastructure state, deployment records and production evidence.
3. This operating document after approval.
4. Current KitLuy infrastructure, Store Hub, security, API, database and product specifications.
5. Approved handoffs and registries.
6. Competitor analyses or clone documents as design references only.

Nothing in this document is evidence that infrastructure is implemented. `IMPLEMENTED`, `DEPLOYED`, `RESTORED`, `PILOT-APPROVED` or `GO-LIVE-APPROVED` may be used only when the corresponding evidence exists. Unknown provider, account, domain, owner, threshold, retention, RPO, RTO or credential values remain `[REQUIRED: ...]` and must not be guessed.

## Mandatory guardrails

- Supabase owns authoritative cloud PostgreSQL, Auth, RLS, approved Realtime, metadata and audit/event records.
- DigitalOcean owns application and worker compute, Container Registry, Spaces, release storage, AI/MCP/RAG compute and the initial App Platform deployment.
- Store Hub owns local Store operations after provisioning; T1–T4 use it over LAN and do not depend on live cloud access for normal operation.
- Cloud application compute is stateless and replaceable. Containers, pods, caches and queues do not own authoritative business truth.
- Finalized finance, payment, inventory, custody, security and audit records are append-only or corrected through compensating records.
- Production changes require authenticated, authorized and audited human action. Defined high-risk changes require four-eyes approval.
- Production migrations are never run automatically during application startup.
- Production secrets are never committed, embedded in images, copied into client bundles or recorded in this document.
- Monitoring and alert delivery remain available when the Admin Portal is unavailable.
- No multi-region, recovery, readiness or availability claim is made without tested evidence.

## 1. Channel model

```text
Internal -> Pilot -> Stable
```

Channels are auditable release states, not mutable folders. Promotion changes eligibility for a signed immutable artifact; it does not rebuild the artifact.

## 2. Channel definitions

| Channel    | Audience                                                       | Data/Store scope             | Approval                                       | Purpose                                                     |
| ---------- | -------------------------------------------------------------- | ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| `Internal` | HET engineering, QA, lab devices and non-customer environments | Non-production/lab           | Release operator                               | Functional, integration, security and hardware verification |
| `Pilot`    | Approved real Laundry Store cohort                             | Explicit device/Store cohort | Release requester + independent pilot approver | Limited production evidence and support validation          |
| `Stable`   | Approved production fleet/cohort                               | Commercial production        | Independent release approver; four-eyes        | General supported production release                        |

## 3. Release object

Every release records:

- release ID and semantic/version identifier;
- artifact digests and signatures;
- SBOM/provenance references;
- supported architecture/platform;
- minimum/maximum database schema version;
- API, Edge protocol, terminal and configuration compatibility ranges;
- feature-flag requirements;
- release notes and known risks;
- rollout/rollback constraints;
- revocation status;
- channel history and approvals.

## 4. Promotion state machine

```text
draft
-> built
-> verified
-> internal
-> pilot_requested
-> pilot
-> stable_requested
-> stable
-> paused | rolled_back | revoked | superseded
```

Invalid transitions fail closed. The requester cannot approve a transition that requires independent approval.

## 5. Internal eligibility

- build and required tests pass;
- artifact is immutable, signed and scanned;
- compatibility manifest is complete;
- migration impact is documented;
- lab install/upgrade/rollback passes;
- release notes and owner are assigned.

## 6. Pilot eligibility

- staging uses the same digest;
- security, RLS, migration, load and recovery gates applicable to the change pass;
- pilot Stores/devices are explicitly selected;
- support coverage and escalation are active;
- rollback target is verified;
- monitoring dashboards and alert routes are active;
- customer/Store operational impact is communicated;
- pilot approver records the release decision.

## 7. Stable eligibility

- pilot observation period completes;
- no unresolved severity-blocking incident;
- pilot Store workflow, offline/reconnect and finance/payment reconciliation pass where affected;
- fleet installation and rollback evidence is acceptable;
- database/application compatibility is proven;
- known issues and support guidance are current;
- independent Stable approver authorizes promotion.

Exact observation periods and blocking thresholds are `[REQUIRED]`.

## 8. Cohort rollout

Rollouts may be scoped by:

- environment;
- Tenant/Partner;
- Digital Store;
- Location;
- device group/profile;
- application/service;
- region;
- percentage/canary cohort where supported.

Rollout expansion is paused automatically or manually when health gates fail.

## 9. Store Hub and terminal distribution

1. Hub retrieves the approved manifest once.
2. Hub verifies signature, digest, channel eligibility and compatibility.
3. Hub stages release in inactive A/B slot or equivalent safe target.
4. Hub distributes terminal packages over LAN.
5. Health checks run after activation.
6. Failure reverts to last-known-good version.
7. Hub reports staged, active, failed, rolled-back and rejected states.

## 10. Cloud release behavior

- Health-based gradual rollout where supported.
- Readiness before receiving traffic.
- Graceful draining before replacement.
- Schema compatibility checked before rollout.
- Asynchronous workers are drained or lease-safe.
- Monitoring compares candidate and baseline.

## 11. Pause, rollback and revoke

| Action      | Use                                                                     |
| ----------- | ----------------------------------------------------------------------- |
| Pause       | Stop cohort expansion while retaining installed candidates              |
| Rollback    | Return installed targets to verified prior compatible release           |
| Forward-fix | Deploy new artifact when data/schema prevents safe rollback             |
| Revoke      | Mark artifact untrusted; prevent new installs and trigger policy action |
| Supersede   | Replace supported release without security revocation                   |

Revocation is mandatory for tampered or compromised artifacts.

## 12. Emergency release

Emergency promotion still requires:

- incident ID;
- scoped impact and target cohort;
- authorized requester and emergency approver;
- tested rollback or forward-fix;
- focused validation;
- continuous monitoring;
- post-release review and normal-channel backfill.

Emergency does not mean unsigned, unaudited or unscoped.

## 13. Compatibility rules

A release may not activate when:

- schema is outside supported range;
- Edge protocol is incompatible;
- terminal profile is unsupported;
- required configuration version is unavailable;
- feature flag or migration prerequisite is missing;
- rollback target cannot read the current data shape and no approved forward-fix exists.

## 14. Required values

- `[REQUIRED: channel approvers and permissions]`
- `[REQUIRED: Internal/Pilot/Stable observation periods]`
- `[REQUIRED: rollout cohort sizes and expansion cadence]`
- `[REQUIRED: blocking alert/error thresholds]`
- `[REQUIRED: minimum supported versions and deprecation window]`
- `[REQUIRED: artifact retention and revocation distribution policy]`

## 15. Evidence checklist

- [ ] Release object includes digest, signature, SBOM and compatibility.
- [ ] Promotion history is append-only and auditable.
- [ ] Requester cannot approve own Stable promotion.
- [ ] Pilot targets are explicit and reversible.
- [ ] Failed Hub health check rolls back automatically.
- [ ] Revoked artifact cannot install.
- [ ] Stable release is supported by pilot evidence.
- [ ] Emergency release is incident-linked and retrospectively reviewed.
