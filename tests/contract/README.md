# tests/contract

Reserved cross-cutting harness location for contract testing. Status at bootstrap:
API contract tests currently live next to each governed API
(`services/kitluy-*-api/test/contract.test.ts`) and run via
`pnpm test:contract`. Cross-service contract suites land here when two or more
implemented services share a contract.
