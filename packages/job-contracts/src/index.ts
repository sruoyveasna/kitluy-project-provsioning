/**
 * @kitluy/job-contracts — Durable job contracts: relational state, at-least-once delivery, idempotent consumers
 *
 * STATUS: IMPLEMENTED-IN-DEV (neutral runtime only). The relational contract is
 * migration group 0135 (`kitluy_ops.durable_jobs`, `durable_job_attempts` and
 * their governed functions); this package is its typed, scheduler-neutral
 * client. Status advances only with the evidence chain recorded in
 * docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md.
 *
 * NEUTRAL CORE. Nothing here names a device, a credential, a key or any
 * vertical concept. Subsystems supply a job kind and a handler.
 *
 * NOT a scheduler. This package makes work claimable and executable; how often
 * anything claims is a deployment decision that has not been taken. There is
 * deliberately no cron, timer or self-invoking loop.
 */
export const PACKAGE_NAME = "@kitluy/job-contracts" as const;

export * from "./durable-job.js";
export * from "./retry-policy.js";
export * from "./job-runtime.js";
export * from "./pg-durable-job-gateway.js";
