# KitLuy Suite Security Policy

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability. Report privately to:

- `[REQUIRED: security contact email]`
- `[REQUIRED: private vulnerability-reporting URL or GitHub Security Advisories workflow]`

Include the affected product/version, reproduction steps, impact, logs/screenshots with secrets and personal data removed, and a safe contact method. Do not access data that is not yours, disrupt Stores, perform denial-of-service testing or publish details before coordinated disclosure.

## Response targets

Acknowledgement, triage, remediation and disclosure targets are `[REQUIRED: approved security SLA]`. Severity is based on exploitability and impact to tenant isolation, payments, finance, inventory, custody, privacy, device trust and Store continuity.

## Supported versions

Security fixes are provided for the currently deployed production release and approved active pilot/release channels. Exact supported application, Hub/terminal image and API versions are published in the release/evidence register. Unsupported/EOL builds must be upgraded or isolated.

## Security boundaries

- Tenant, Digital Store, Location, user, role, device and environment isolation.
- Supabase RLS and API/service authorization; frontend controls are not authority.
- Store Hub is local operational authority after provisioning.
- Connectors never receive direct production-database access.
- Sensitive financial, permission, compliance, device and production actions require authorized human confirmation; high-risk actions use four-eyes approval.
- Finalized finance, payment, inventory, custody and audit truth is append-only or corrected by compensating records.
- AI is permission-scoped, logged and cannot autonomously perform sensitive actions.

## Secret handling

Never commit credentials, tokens, service-role keys, payment secrets, signing keys, device private keys or production `.env` files. Use environment-scoped secret stores and short-lived credentials where possible. Suspected exposure requires immediate revocation/rotation and incident handling; deleting the Git commit is not sufficient.

## Dependency and artifact security

Dependencies, containers, infrastructure and release artifacts follow the supply-chain policy. Lockfiles, checksums, SBOMs and signatures are required. Store Hub and terminals install only signed compatible releases and support A/B rollback.

## Data and privacy

Use least data. Do not copy production data into lower environments without approved masking. Logs, traces, analytics and crash reports must exclude secrets and unnecessary personal/financial data. Customer garment photos/documents are accessed only through governed File Service permissions and audit.

## Development requirements

Security-sensitive changes require threat-model review, tests and CODEOWNER approval. Required tests include tenant isolation, privilege escalation, replay/idempotency, webhook signatures, upload validation, Electron IPC, device certificate revocation, offline conflict and secrets/log redaction.

## Production access

Production access is least-privilege, environment-scoped, time-bounded where possible and audited. Shared credentials are prohibited. Break-glass access records reason, approver, actions and post-use review.

## Disclosure and safe harbor

KitLuy intends to work constructively with good-faith researchers. Formal safe-harbor language, legal entity and disclosure terms remain `[REQUIRED: legal approval]`. Until approved, researchers must avoid privacy violations, persistence, social engineering, physical attacks, service disruption and data destruction.
