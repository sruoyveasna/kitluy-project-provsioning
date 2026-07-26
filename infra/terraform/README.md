# Terraform (SCAFFOLDED — no real cloud resources)

Infrastructure-as-code for Supabase + DigitalOcean per
kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md.

**Rules:**

- No plan/apply against real cloud accounts without approved credentials and
  explicit authorization. CI runs `terraform fmt -check` and `validate` only.
- State and tfvars are never committed (.gitignore enforces this).
- All provider account identities are [REQUIRED] owner values.

Layout: `modules/` (reusable), `environments/<env>/` (composition per
environment: development, staging, pilot, production, disaster-recovery).
