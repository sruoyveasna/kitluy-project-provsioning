# tests/offline

Reserved cross-cutting harness location for offline testing. Status at bootstrap:
The working offline/reconnect harness lives in
`services/kitluy-hub-agent/test/offline-reconnect.test.ts` and runs via
`pnpm test:offline`. Cross-product offline scenarios (POS + Hub + cloud) land
here when those products are implemented.
