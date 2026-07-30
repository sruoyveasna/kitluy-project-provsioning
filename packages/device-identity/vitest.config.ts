import { defineConfig } from "vitest/config";

/**
 * Device-identity test configuration.
 *
 * ===========================================================================
 * WHY FILE PARALLELISM IS OFF
 * ===========================================================================
 * Most suites here are LIVE suites: they run against the one local PostgreSQL
 * database, not against a fixture each. Vitest's default is to run test FILES
 * in parallel, and two live suites sharing one database are not independent.
 *
 * This was not theoretical. `scope-consumption-concurrency.integration.test.ts`
 * has to BORROW membership of `kitluy_credential_issuer` — the governor is
 * NOLOGIN and `postgres` is not a member, so there is no other way to drive the
 * governor-only functions under two real connections. That borrow is a
 * CLUSTER-WIDE fact for as long as it is held. While it was held,
 * `same-key-renewal-preflight.integration.test.ts` ran concurrently and its
 * privilege assertion — a statement it expects to be REFUSED — SUCCEEDED
 * instead, and the suite reported
 *
 *     EXPECTED REFUSAL: the statement succeeded and should not have
 *
 * That is the failure mode worth being loud about. It did not make a privilege
 * test fail spuriously; it made a privilege test VACUOUS. Had the two suites
 * interleaved the other way round, the refusal would simply have stopped being
 * a refusal and nothing would have complained. A test that cannot fail is worse
 * than a missing test, because it is counted.
 *
 * `expectRefused` in `test/support/renewal-fixtures.ts` is what caught it: it
 * throws when the statement it guards SUCCEEDS, rather than passing quietly.
 * Without that, this would have been invisible.
 *
 * So live database suites run one file at a time. The cost is wall-clock; the
 * alternative is privilege evidence that depends on scheduling order.
 *
 * Tests WITHIN a file still run normally — the isolation needed here is between
 * files, because that is the boundary the shared database sits on.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
