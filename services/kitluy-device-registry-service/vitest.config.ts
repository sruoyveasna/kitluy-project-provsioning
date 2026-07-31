import { defineConfig } from "vitest/config";

/**
 * This service's suites share ONE local database, and several of them borrow
 * NOLOGIN authorities or install policy rows with COMMITTED transactions —
 * visible, by design, to every other session while they are open. Run their
 * files SERIALLY.
 *
 * The hazard is not theoretical: the spendability and capability censuses
 * probe exactly those grants (a leaked NOLOGIN membership is a finding), and
 * the sanctioned test clock has one policy row for environment 'test'. Run
 * concurrently, a census can observe a sanctioned mid-test borrow and a clock
 * suite can collide on the policy row's primary key — failures that measure
 * scheduling, not the system. The residue census's own header records that
 * making the ordering real needed dedicated work; this is that work.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
