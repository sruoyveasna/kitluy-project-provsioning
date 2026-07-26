# Security Policy — KitLuy Suite

## Reporting a vulnerability

Report security issues privately to the project owner
([REQUIRED: security contact address — owner decision pending]).
Do not open public issues for security problems.

## Repository security rules

- No secrets in source control: no API keys, provider tokens, service-role keys,
  private certificates, production credentials, or personally identifiable test
  data. `.env.example` carries names and descriptions only. CI runs a secret scan.
- Supabase service-role keys are server-side only — never in apps, POS terminals,
  or the Store Hub.
- Connectors never receive production-database credentials.
- Frontend visibility never replaces backend authorization or PostgreSQL RLS.
- Sensitive actions follow the approval classes A0–A4 defined in
  `docs/security/` (re-authentication, reason, immutable audit, four-eyes where
  specified). The requester cannot approve their own request.
- Store device private keys are generated non-exportably on-device and are never
  backed up as raw keys.
- High-risk security design (PKI/CA, HSM, certificate rotation windows) contains
  [REQUIRED] owner values — see docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md.
