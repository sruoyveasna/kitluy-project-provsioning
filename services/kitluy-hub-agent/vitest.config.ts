import { defineConfig } from "vitest/config";

/**
 * This service's suites share ONE local Hub database (`kitluy_hub_local`), and
 * several of them run SERIALIZABLE transactions or take long lock sequences
 * against it. Run their files SERIALLY.
 *
 * Under parallel files the shared database turns timing into the test:
 * reachability probes miss their 2-second window under load and whole files
 * skip (which reads as evidence it is not), and the intake happy path exceeds
 * its 5-second budget waiting on a sibling file's locks. Serialization makes
 * the suite measure the system again — the same reason the device-registry
 * service serializes its files (see its vitest.config.ts).
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      // THE DEVELOPER DEFAULT LIVES HERE, NOT IN SHIPPED SOURCE.
      //
      // `hub-database.ts` used to carry it, which put a DSN with an inline
      // password into the Raspberry Pi image and gave a misconfigured Hub a
      // silent fallback to whatever answered on 54322. It now fails closed, so
      // the convenience of "just run pnpm test" belongs here — where it reaches
      // tests and nothing else.
      //
      // An explicitly-set value always wins, so pointing the suites at another
      // cluster stays a matter of exporting the variable.
      KITLUY_HUB_DB_URL:
        process.env.KITLUY_HUB_DB_URL ??
        "postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local",
    },
  },
});
