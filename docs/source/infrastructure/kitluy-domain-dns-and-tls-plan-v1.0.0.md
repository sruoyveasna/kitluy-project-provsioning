# KitLuy Domain, DNS and TLS Plan

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-domain-dns-and-tls-plan-v1.0.0.md`                                  |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Define stable public boundaries and safe DNS, TLS, certificate, mTLS, cutover and rollback operations.

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

## 1. Objectives

- Give clients stable provider-independent public boundaries.
- Make DNS and certificate changes reproducible, least-privilege, reversible and audited.
- Require TLS for public/cloud traffic and mTLS for Store Hub cloud identity.
- Prevent certificate expiry, unsafe wildcard use, origin exposure and undocumented redirects.

## 2. Logical domain inventory

Exact registered domains are owner-supplied.

| Logical hostname             | Purpose                                | Exposure                        | Environment pattern                                   |
| ---------------------------- | -------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `www.[REQUIRED: domain]`     | B2B website                            | Public                          | production; separate staging hostname                 |
| `app.[REQUIRED: domain]`     | Authentication/portal entry            | Public authenticated            | per environment                                       |
| `admin.[REQUIRED: domain]`   | HET Admin Portal                       | Restricted public authenticated | per environment                                       |
| `chain.[REQUIRED: domain]`   | Chain Portal                           | Public authenticated            | per environment                                       |
| `partner.[REQUIRED: domain]` | Partner Portal                         | Public authenticated            | per environment                                       |
| `store.[REQUIRED: domain]`   | Storefront base                        | Public                          | per environment; custom-domain support later/approved |
| `api.[REQUIRED: domain]`     | Stable governed APIs                   | Public/service authenticated    | per environment                                       |
| `assets.[REQUIRED: domain]`  | Public CDN assets                      | Public                          | per environment/class                                 |
| `status.[REQUIRED: domain]`  | Public/service-status surface          | Public read-only                | production                                            |
| `hooks.[REQUIRED: domain]`   | Provider webhook ingress, if separated | Public signed callbacks         | per environment                                       |

## 3. DNS record registry schema

Every managed record includes:

```text
record_id
zone
name
type
value_reference        # not secret value
purpose
environment
owner_team
provider_resource
certificate_dependency
ttl
change_ticket
last_verified_at
rollback_value_reference
```

## 4. DNS controls

- Production DNS write credentials are least privilege and environment scoped.
- Registrar ownership credentials are separated from routine DNS automation.
- DNS records are managed from code where supported.
- Critical records have a documented prior value and rollback plan.
- TTL reductions for migration are time-bound and restored after validation.
- DNSSEC policy is `[REQUIRED: owner/provider decision]`.
- Wildcard records require documented scope, abuse review and certificate policy.
- Orphan records and dangling provider targets are scanned.

## 5. TLS policy

| Traffic                                         | Requirement                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Browser/mobile to public endpoints              | TLS only; approved modern policy                                                  |
| Service to service over public/provider network | TLS; stronger authenticated channel where supported                               |
| Store Hub to cloud                              | Mutual TLS using operational device certificate                                   |
| Webhooks                                        | TLS plus provider/KitLuy signature and replay protection                          |
| LAN terminal to Hub                             | Approved local encrypted/authenticated transport where specified by Edge protocol |

Certificate private keys remain in approved provider/key systems. They never appear in source, documents, logs or client bundles.

## 6. Certificate lifecycle

```text
request/issue
-> validate ownership
-> deploy
-> verify chain/hostname/policy
-> monitor expiry
-> renew/rotate
-> verify clients
-> revoke/retire old certificate
-> archive evidence
```

Required certificate metadata:

- certificate ID/reference;
- hostname/SAN scope;
- issuer;
- environment;
- owner;
- key-storage reference;
- issue/expiry dates;
- renewal method;
- alert thresholds;
- revocation process;
- dependent services.

## 7. Store Hub mTLS

- Manufacturing trust and operational certificates are distinct.
- Operational certificates are bound to device, Tenant, Digital Store, Location and profile.
- Unknown, expired, revoked or mismatched devices fail closed.
- Hub private keys are non-exportable where the approved hardware design permits.
- Certificate rotation and revocation are rehearsed before pilot.
- No public inbound Hub port is required.

## 8. Edge security controls

The selected edge/provider layer must support the approved combination of:

- provider DDoS protection;
- rate limits by route and identity class;
- request-size limits;
- bot/abuse controls for public forms and authentication;
- safe CORS allowlists;
- origin protection;
- security headers;
- webhook signature verification;
- access logs with privacy controls.

A third-party WAF remains optional until an approved decision.

## 9. Change workflow

1. Open change with reason, affected records/certificates and rollback.
2. Validate ownership and dependency inventory.
3. Lower TTL only if required and record restoration time.
4. Review IaC plan.
5. Obtain environment-appropriate approval.
6. Apply with named operator identity.
7. Validate DNS from multiple resolvers and TLS from approved probes.
8. Validate application, redirects, CORS and webhook callbacks.
9. Restore normal TTL.
10. Archive evidence and close change.

High-risk production cutovers require independent approval.

## 10. Incident and rollback

| Incident                           | Immediate action                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Wrong DNS target                   | Stop change, restore prior record, validate caches/TTL                          |
| Certificate expiry/renewal failure | Route to valid certificate/endpoint; invoke emergency change                    |
| Private-key compromise             | Revoke/rotate, isolate affected origins, investigate access                     |
| Dangling record                    | Remove or claim target immediately, review exposure                             |
| Hub certificate compromise         | Revoke device certificate, quarantine device, replacement/re-enrollment runbook |
| DNS provider outage                | Use provider recovery/escalation; no unsupported ad-hoc nameserver change       |

## 11. Monitoring

- authoritative DNS resolution;
- public resolver consistency;
- TLS expiry and chain validity;
- hostname mismatch;
- renewal failure;
- DNS/record drift;
- unexpected certificate issuance where available;
- origin exposure;
- webhook ingress failure.

## 12. Required values

- `[REQUIRED: registered production domain(s)]`
- `[REQUIRED: DNS and registrar providers]`
- `[REQUIRED: DNSSEC decision]`
- `[REQUIRED: TLS issuer/certificate authority policy]`
- `[REQUIRED: key custody and certificate automation design]`
- `[REQUIRED: expiry alert thresholds]`
- `[REQUIRED: custom-domain and wildcard-certificate policy]`
- `[REQUIRED: emergency DNS approvers]`

## 13. Go-live evidence

- [ ] Zone and record inventory is approved.
- [ ] Production DNS credentials are least privilege.
- [ ] TLS chain, hostname and renewal tests pass.
- [ ] Hub mTLS issue/rotate/revoke tests pass.
- [ ] Redirect and CORS allowlists pass.
- [ ] Rollback record is tested.
- [ ] Expiry and DNS-drift alerts route correctly.
- [ ] No dangling provider targets remain.
