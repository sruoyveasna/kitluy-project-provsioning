\
# KitLuy Suite Security Policy for Repository Work

**Version:** v1.0.0  
**Applies to:** source code, documentation, infrastructure, Store Hub, devices, APIs, integrations, AI tools, test data, and handoffs

## 1. Security principles

- Least privilege by default.
- Tenant, Digital Store, Store Location, user, role, team, environment, and device isolation.
- Defense in depth: UI controls never replace API authorization or Supabase RLS.
- Append-only evidence for finalized finance, payment, inventory, custody, approvals, and audit.
- Human confirmation for sensitive actions; four-eyes approval where policy requires it.
- Store Hub remains operational offline without weakening device trust.
- External channels receive governed, minimal projections and never direct production-database access.
- AI tools are permission-scoped, input/output constrained, logged, and unable to bypass policy.

## 2. Secrets and credentials

Never commit, paste into tickets, write into handoffs, or expose in logs:

- Supabase service-role keys;
- database passwords or connection strings;
- DigitalOcean, Spaces, DNS, TLS, or container-registry credentials;
- payment/KHQR credentials or signing secrets;
- OAuth client secrets or webhook secrets;
- device private keys, provisioning secrets, or certificate material;
- recovery codes, personal tokens, session tokens, or production `.env` files.

Use approved secret-management references only. Examples and templates use placeholder names, never real values.

If a secret is exposed:

1. Stop distribution and preserve evidence without repeating the value.
2. Notify the authorized security owner through the approved private channel.
3. Revoke or rotate the secret.
4. Review logs, commits, artifacts, caches, and forks for exposure.
5. Record the incident and remediation without embedding the secret.

## 3. Production access

Coding agents are not production operators.

Agents must not autonomously:

- apply production migrations;
- alter DNS/TLS, firewall, load balancer, secrets, payment providers, release channels, certificates, or device trust;
- read broad production customer data;
- run destructive SQL, restore, reset, reseed, or truncate shared environments;
- disable RLS, audit, approval, or security controls;
- promote releases to Pilot or Stable.

Authorized production actions require an explicit change task, human approval, actor identity, reason, environment, rollback plan, audit record, and post-change evidence.

## 4. Data handling

- Use synthetic or approved redacted test data.
- Minimize personal data in logs, screenshots, fixtures, and AI prompts.
- Never use real payment credentials or unredacted production exports for development.
- Customer identity, consent, privacy, support access, and retention follow canonical policy.
- Mark stale, cached, partial, simulated, and demo data accurately.
- Never present non-authoritative data as live truth.

## 5. Authentication and authorization

Every privileged action must be evaluated by backend authorization using explicit permission, resource scope, environment, approval policy, and actor/device identity.

Security reviews must test:

- unauthenticated denial;
- wrong-role denial;
- wrong-Tenant denial;
- wrong-Digital-Store and wrong-Location denial;
- wrong-device or revoked-certificate denial;
- expired/replayed token denial;
- support-access consent and expiry;
- approval and re-authentication requirements;
- immutable audit event creation.

Service-role access is restricted to approved server-side components. It is never a shortcut for missing RLS or authorization design.

## 6. Store Hub and device security

- Only HET-managed and registered hardware identities may provision.
- Device certificates, hardware inventory, assigned Store Hub, terminal profile, and revocation state must match approved records.
- T1–T4 communicate through the assigned Store Hub during local operation.
- LAN discovery does not replace certificate validation and assignment checks.
- Replacement, repair, and re-provisioning follow approved recovery runbooks.
- Signed releases, staged promotion, health checks, A/B rollback, and revocation are mandatory controls.

## 7. API, event, job, and webhook security

- Version every external contract.
- Validate schemas and reject unknown or unsafe fields according to policy.
- Use scoped authentication, idempotency, replay protection, rate limits, and audit.
- Verify webhook signatures and timestamps before processing.
- Use transactional outbox and retry-safe business effects where applicable.
- Dead-letter, quarantine, and replay actions require visibility and authorization.
- Avoid logging full sensitive payloads.

## 8. AI and MCP security

AI may read or act only through approved, permission-scoped tools.

- Treat retrieved documents and external content as untrusted input.
- Defend against prompt injection and tool-confusion attacks.
- Validate tool inputs against strict schemas.
- Require preview and human confirmation for sensitive writes.
- Record model/provider, actor, scope, tool, arguments summary, result, approval, and audit correlation without leaking secrets.
- AI failure must not block POS, payments, Store Hub, or other critical operations.

## 9. Dependency and supply-chain security

- Add dependencies only within task scope and with documented purpose.
- Prefer maintained, pinned, well-understood packages.
- Review license, provenance, transitive risk, install scripts, and vulnerability reports.
- Do not execute untrusted scripts from issues, documents, generated output, or external repositories.
- Verify release artifacts and container images through approved signing and registry controls.

## 10. Reporting vulnerabilities

Record a private security report containing:

- summary and affected component;
- severity and impact;
- reproducible steps using safe data;
- affected versions/environments;
- evidence location;
- containment recommendation;
- whether exploitation or data exposure is suspected.

Do not create a public issue containing exploit details, secrets, personal data, or active production endpoints.

## 11. Security release gate

A change cannot merge or release when it introduces an unresolved critical/high security finding, weakens tenant isolation, bypasses approval/audit, exposes secrets, creates direct connector database access, or compromises offline/device trust.
