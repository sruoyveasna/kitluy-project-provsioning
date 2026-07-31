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
  },
});
