# KitLuy API Scope Registry

**Filename:** `kitluy-api-scope-registry-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical shared target registry; not implementation evidence

## 1. Purpose

Define immutable action-oriented scopes for the four governed APIs. Scopes grant a type of action only; they never bypass membership, resource scope, environment, approval policy, device assignment, customer ownership, connector installation, RLS or business validation.

## 2. Naming and lifecycle rules

- Lowercase dot-separated keys.
- Verb/action is explicit; avoid ambiguous `admin` or `full_access` scopes.
- Scope meaning is immutable after Stable release.
- Deprecation creates a new replacement key; old key is not repurposed.
- Credential classes are surface-specific.
- Wildcard grants are prohibited in customer, device and connector tokens. Human Admin wildcard-like roles compile into explicit grants and are still scoped/audited.
- Read and write are separate unless an endpoint contract proves a narrower safe grouping.

## 3. Authorization dimensions

```text
identity + credential class + API surface + scope + resource scope + environment
+ assignment/installation/device state + vertical/entitlement + business state
+ re-authentication + approval policy + RLS = decision
```

## 4. Risk classes

| Class                  | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `A0_READ`              | Scoped read; normal authentication and audit policy.                             |
| `A1_STANDARD_MUTATION` | Authorized mutation with immutable audit.                                        |
| `A2_REAUTH_MUTATION`   | Fresh re-authentication/manager confirmation plus A1.                            |
| `A3_FOUR_EYES`         | Independent approver plus A2.                                                    |
| `A4_OWNER_SECURITY`    | Restricted owner/security pool, incident/ticket, alert and retrospective review. |

## 5. Canonical scope registry

| Scope                              | Surface    | Action                        | Credential classes    | Resource types                      | Default risk           | Earliest phase     |
| ---------------------------------- | ---------- | ----------------------------- | --------------------- | ----------------------------------- | ---------------------- | ------------------ |
| `digital_stores.read`              | Management | Read Digital Stores           | human_oauth/service   | tenant,digital_store                | `A0_READ`              | Phase 1 foundation |
| `digital_stores.create`            | Management | Create Digital Store          | human_oauth/service   | tenant,digital_store                | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `digital_stores.vertical_lock`     | Management | Lock primary vertical         | human_oauth/service   | tenant,digital_store                | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `digital_stores.activate`          | Management | Activate Digital Store        | human_oauth/service   | tenant,digital_store                | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `locations.read`                   | Management | Read Locations                | human_oauth/service   | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `locations.create`                 | Management | Create Location               | human_oauth/service   | digital_store,location              | `A3_FOUR_EYES`         | Phase 1 foundation |
| `locations.go_live_approve`        | Management | Approve go-live               | human_oauth/service   | digital_store,location              | `A3_FOUR_EYES`         | Phase 1 foundation |
| `locations.decommission`           | Management | Decommission Location         | human_oauth/service   | digital_store,location              | `A3_FOUR_EYES`         | Phase 1 foundation |
| `catalog.read`                     | Management | Read catalog                  | human_oauth/service   | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `catalog.write`                    | Management | Manage catalog                | human_oauth/service   | digital_store,location              | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `catalog.publish`                  | Management | Publish catalog/config        | human_oauth/service   | digital_store,location              | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `reports.run`                      | Management | Run reports                   | human_oauth/service   | tenant,digital_store,location       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `reports.read`                     | Management | Read reports                  | human_oauth/service   | tenant,digital_store,location       | `A0_READ`              | Phase 1 foundation |
| `exports.create`                   | Management | Create export                 | human_oauth/service   | tenant,digital_store,location       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `exports.read`                     | Management | Read export status            | human_oauth/service   | tenant,digital_store,location       | `A0_READ`              | Phase 1 foundation |
| `devices.read`                     | Management | Read fleet                    | human_oauth/service   | location,device                     | `A0_READ`              | Phase 1 foundation |
| `devices.provision`                | Management | Create provisioning session   | human_oauth/service   | location,device                     | `A3_FOUR_EYES`         | Phase 1 foundation |
| `devices.assign`                   | Management | Assign device                 | human_oauth/service   | location,device                     | `A3_FOUR_EYES`         | Phase 1 foundation |
| `devices.revoke`                   | Management | Revoke device                 | human_oauth/service   | location,device                     | `A3_FOUR_EYES`         | Phase 1 foundation |
| `devices.remote_action.standard`   | Management | Standard remote action        | human_oauth/service   | location,device                     | `A3_FOUR_EYES`         | Phase 1 foundation |
| `devices.remote_action.high_risk`  | Management | High-risk remote action       | human_oauth/service   | location,device                     | `A3_FOUR_EYES`         | Phase 1 foundation |
| `releases.read`                    | Management | Read releases                 | human_oauth/service   | platform,cohort,device_group        | `A0_READ`              | Phase 1 foundation |
| `releases.artifact_register`       | Management | Register signed artifact      | human_oauth/service   | platform,cohort,device_group        | `A3_FOUR_EYES`         | Phase 1 foundation |
| `releases.rollout_create`          | Management | Create rollout                | human_oauth/service   | platform,cohort,device_group        | `A3_FOUR_EYES`         | Phase 1 foundation |
| `releases.promote_stable`          | Management | Promote Stable                | human_oauth/service   | platform,cohort,device_group        | `A3_FOUR_EYES`         | Phase 1 foundation |
| `releases.rollback`                | Management | Rollback rollout              | human_oauth/service   | platform,cohort,device_group        | `A3_FOUR_EYES`         | Phase 1 foundation |
| `rbac.read`                        | Management | Read effective access         | human_oauth           | platform,team,subject               | `A0_READ`              | Phase 1 foundation |
| `rbac.assignment_manage`           | Management | Manage assignments            | human_oauth           | platform,team,subject               | `A3_FOUR_EYES`         | Phase 1 foundation |
| `rbac.approval.request`            | Management | Request approval              | human_oauth           | platform,team,subject               | `A3_FOUR_EYES`         | Phase 1 foundation |
| `rbac.approval.execute`            | Management | Execute approved action       | human_oauth           | platform,team,subject               | `A3_FOUR_EYES`         | Phase 1 foundation |
| `storefront.read`                  | Commerce   | Read Storefront               | public_store/customer | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `storefront.locations.read`        | Commerce   | Read published Locations      | public_store/customer | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `storefront.catalog.read`          | Commerce   | Read published catalog        | public_store/customer | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `storefront.availability.read`     | Commerce   | Read public availability      | public_store/customer | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `storefront.policies.read`         | Commerce   | Read policies                 | public_store/customer | digital_store,location              | `A0_READ`              | Phase 1 foundation |
| `customer_session.create`          | Commerce   | Create customer session       | public/customer       | digital_store                       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `customer_session.revoke`          | Commerce   | Revoke customer session       | public/customer       | digital_store                       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `customer_identity.verify`         | Commerce   | Verify customer identity      | customer              | digital_store                       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `cart.read`                        | Commerce   | Read own cart                 | customer              | customer,cart                       | `A0_READ`              | Phase 1 foundation |
| `cart.write`                       | Commerce   | Modify own cart               | customer              | customer,cart                       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `cart.merge`                       | Commerce   | Merge guest/customer cart     | customer              | customer,cart                       | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `checkout.write`                   | Commerce   | Prepare/validate checkout     | customer              | customer,cart,location              | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `checkout.complete`                | Commerce   | Complete checkout             | customer              | customer,cart,location              | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `pre_intake.read`                  | Commerce   | Read own pre-intake           | customer              | customer,pre_intake,location        | `A0_READ`              | Phase 1 foundation |
| `pre_intake.write`                 | Commerce   | Modify own pre-intake         | customer              | customer,pre_intake,location        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `pre_intake.submit`                | Commerce   | Submit pre-intake             | customer              | customer,pre_intake,location        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `queue.check_in`                   | Commerce   | Join queue                    | customer              | customer,queue_ticket,location      | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `queue.read_own`                   | Commerce   | Read own ticket               | customer              | customer,queue_ticket,location      | `A0_READ`              | Phase 1 foundation |
| `edge.bookings.create`             | Edge       | Create local Booking          | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.bookings.update_draft`       | Edge       | Update local draft            | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.bookings.finalize`           | Edge       | Finalize Booking              | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.payments.record`             | Edge       | Record local payment evidence | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.display.open`                | Edge       | Open T2 session               | device                | location,device,display_session     | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.display.read`                | Edge       | Read T2 stream                | device                | location,device,display_session     | `A0_READ`              | Phase 1 foundation |
| `edge.display.update`              | Edge       | Update T2 state               | device                | location,device,display_session     | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.display.close`               | Edge       | Close T2 session              | device                | location,device,display_session     | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.ready.open`                  | Edge       | Open T3 session               | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.ready.scan`                  | Edge       | Scan Ready items              | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.ready.qa`                    | Edge       | Record QA                     | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.ready.storage`               | Edge       | Assign storage                | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.ready.complete`              | Edge       | Complete Ready transition     | device+staff          | location,device,booking             | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.pickup.open`                 | Edge       | Open T4 session               | device+staff          | location,device,booking             | `A2_REAUTH_MUTATION`   | Phase 1 foundation |
| `edge.pickup.verify_collector`     | Edge       | Verify collector              | device+staff          | location,device,booking             | `A2_REAUTH_MUTATION`   | Phase 1 foundation |
| `edge.pickup.scan`                 | Edge       | Scan pickup items             | device+staff          | location,device,booking             | `A2_REAUTH_MUTATION`   | Phase 1 foundation |
| `edge.pickup.payment`              | Edge       | Collect allowed balance       | device+staff          | location,device,booking             | `A2_REAUTH_MUTATION`   | Phase 1 foundation |
| `edge.pickup.release`              | Edge       | Release custody               | device+staff          | location,device,booking             | `A2_REAUTH_MUTATION`   | Phase 1 foundation |
| `edge.sync.read`                   | Edge       | Read sync status              | device                | location,hub                        | `A0_READ`              | Phase 1 foundation |
| `edge.sync.push`                   | Edge       | Push edge events              | device                | location,hub                        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `edge.sync.pull`                   | Edge       | Pull config/inbox             | device                | location,hub                        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.installations.create`   | Connector  | Create installation           | app_oauth/human       | tenant,digital_store,installation   | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.installations.read`     | Connector  | Read installation             | app_oauth/human       | tenant,digital_store,installation   | `A0_READ`              | Phase 1 foundation |
| `connector.installations.pause`    | Connector  | Pause installation            | app_oauth/human       | tenant,digital_store,installation   | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.installations.revoke`   | Connector  | Revoke installation           | app_oauth/human       | tenant,digital_store,installation   | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.mappings.read`          | Connector  | Read mappings                 | connector             | installation,digital_store,location | `A0_READ`              | Phase 1 foundation |
| `connector.mappings.write`         | Connector  | Manage mappings               | connector             | installation,digital_store,location | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.projections.run`        | Connector  | Run projection                | connector/service     | installation,digital_store,location | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.projections.read`       | Connector  | Read projection status        | connector/service     | installation,digital_store,location | `A0_READ`              | Phase 1 foundation |
| `connector.transactions.ingest`    | Connector  | Ingest external transaction   | connector             | installation,digital_store,location | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.transactions.update`    | Connector  | Submit external update        | connector             | installation,digital_store,location | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.webhooks.manage`        | Connector  | Manage subscription           | connector/human       | installation                        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.webhooks.read`          | Connector  | Read delivery history         | connector/human       | installation                        | `A0_READ`              | Phase 1 foundation |
| `connector.webhooks.replay`        | Connector  | Replay delivery               | connector/human       | installation                        | `A1_STANDARD_MUTATION` | Phase 1 foundation |
| `connector.reconciliation.read`    | Connector  | Read reconciliation           | connector/human       | installation,digital_store,location | `A0_READ`              | Phase 1 foundation |
| `connector.reconciliation.resolve` | Connector  | Resolve reconciliation        | connector/human       | installation,digital_store,location | `A2_REAUTH_MUTATION`   | Phase 1 foundation |

## 6. Scope issuance

### Human/management

Issued from memberships, explicit assignments, environment and approval policy. Frontend page visibility is not issuance.

### Customer

Issued to least-privilege session/account tokens and restricted to owned resources. Secure guest tokens name one resource/purpose.

### Device/edge

Derived from HET device certificate, active assignment, Hub session, terminal profile and optional staff actor.

### Connector

Derived from approved installation, Partner consent, environment, Digital Store/Location eligibility and connector certification.

## 7. Revocation

Revocation must invalidate or reject future use, terminate refresh capability where relevant and create audit. High-risk device/connector revocation propagates to gateways, Hub/config projections and event delivery workers.

## 8. Contract tests

- Every OpenAPI operation names at least one registered scope or explicitly declares public access.
- Wrong-surface credentials are rejected.
- Scope cannot widen resource context.
- Removed/expired assignment, session, device or installation is denied.
- Risk class triggers required re-auth/approval.
- Deprecated scope compatibility passes through its retirement date.

## Appendix A — Open decisions

- `[REQUIRED: OAuth issuer/audience and token-claim schema]`
- `[REQUIRED: final risk classification review for every scope]`
- `[REQUIRED: owner approval for public developer credential/PAT policy]`
- `[REQUIRED: automated scope-code generation repository path]`
