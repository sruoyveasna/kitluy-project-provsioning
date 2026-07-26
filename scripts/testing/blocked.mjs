#!/usr/bin/env node
/**
 * Honest reporter for test suites whose prerequisites do not exist yet.
 * Exits non-zero so a blocked suite can never be mistaken for a passing one.
 */
const suite = process.argv[2] ?? "unknown";
const reasons = {
  integration:
    "BLOCKED: integration tests require the canonical Supabase schema pack and running services. See docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md.",
  e2e: "BLOCKED: end-to-end tests require built app shells plus Playwright browsers (`pnpm exec playwright install`) and a defined user journey from an approved spec. Harness location: tests/end-to-end/.",
  rls: "BLOCKED: RLS tests require the Supabase CLI (not installed) and the canonical RLS/authorization pack (missing). Harness location: supabase/tests/.",
};
console.error(reasons[suite] ?? `BLOCKED: suite "${suite}" is not configured.`);
console.error("This is a recorded limitation, not a failure of implemented code.");
process.exit(3);
