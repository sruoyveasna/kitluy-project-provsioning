/**
 * THE DEPLOYED LAPSE WORKER. A process that actually claims the jobs.
 *
 * WS-11-T003 Step 4 §3.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `createEmergencyLapseWorker` was already correct and already tested. It also
 * had no caller outside tests, which independent review named as RV-GW-002
 * surviving one layer up: the route enqueues a lapse job on every emergency, and
 * in a deployed process nobody ever claimed it.
 *
 * That matters more than an ordinary missing wire-up, because lapsing is the
 * mechanism that closes an emergency revocation NO SECOND HUMAN REVIEWED. With
 * no worker running, an obligation whose deadline passes simply stays PENDING
 * for ever: the four-eyes rule degrades from "reviewed, or escalated" to
 * "reviewed, or silently forgotten".
 *
 * ===========================================================================
 * WHAT THIS ADDS AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * This is a LOOP, not a scheduler and not a new execution model. Every decision
 * that matters -- claiming under a lease, SKIP LOCKED, retry classification,
 * duplicate delivery, stale-worker refusal, immutable attempt evidence -- already
 * lives in `runDurableJobs` and the governed `lapse_governed_emergency_..._v1`
 * door. Re-implementing any of it here would create a second answer to a
 * question that already has one.
 *
 * So this file owns exactly three things the loop needs and a library cannot
 * know: WHEN to poll, WHICH worker this is, and how to stop cleanly.
 */
import { randomUUID } from "node:crypto";

import type { DurableJobGateway, JobLease, WorkerIdentity } from "@kitluy/job-contracts";

import { createEmergencyLapseWorker, type EmergencyLapseWorker } from "./lapse-worker.js";
import type { DeviceRevocationService } from "./revocation-service.js";

/** Just enough logger for this loop; the service's real logger satisfies it. */
export interface WorkerLog {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface LapseWorkerLoop {
  /** Begins polling. Idempotent: a second call while running is ignored. */
  start(): void;
  /** Stops polling and waits for an in-flight tick to finish. */
  stop(): Promise<void>;
  /** One tick, exposed so a test can drive the REAL loop without waiting. */
  tick(): Promise<number>;
  readonly identity: WorkerIdentity;
}

export interface LapseWorkerLoopOptions {
  readonly gateway: DurableJobGateway;
  readonly service: DeviceRevocationService;
  readonly environment: string;
  readonly softwareVersion: string;
  readonly log: WorkerLog;
  /** How often to look for work. */
  readonly pollMs?: number;
  /**
   * How long a claim is held. MUST exceed the worst-case time to run one lapse,
   * or a second worker will claim a job this one is still executing.
   */
  readonly leaseSeconds?: number;
  readonly maxJobsPerTick?: number;
  /** Injected so a test can drive ticks itself. */
  readonly worker?: EmergencyLapseWorker;
}

/** Deliberately conservative: lapsing is not latency-sensitive. */
export const DEFAULT_LAPSE_POLL_MS = 30_000;
export const DEFAULT_LAPSE_LEASE_SECONDS = 120;

export function createLapseWorkerLoop(options: LapseWorkerLoopOptions): LapseWorkerLoop {
  // ONE identity per PROCESS, generated at construction.
  //
  // `workerInstanceId` is what the durable-job runtime uses to tell "this worker
  // is still holding the job" from "a worker that died and whose lease expired".
  // Regenerating it per tick would make every claim look like a new worker and
  // defeat stale-worker detection; sharing one across processes would let two
  // workers answer to the same name.
  const identity: WorkerIdentity = {
    workerInstanceId: randomUUID(),
    serviceIdentity: "kitluy-device-registry-service.emergency-lapse",
    environment: options.environment,
    softwareVersion: options.softwareVersion,
  };
  const lease: JobLease = {
    leaseId: randomUUID(),
    leaseOwner: identity.workerInstanceId,
    leaseSeconds: options.leaseSeconds ?? DEFAULT_LAPSE_LEASE_SECONDS,
  };

  const worker =
    options.worker ??
    createEmergencyLapseWorker({
      gateway: options.gateway,
      service: options.service,
      identity,
      lease,
      clock: { now: () => new Date() },
      // Jitter spreads retry backoff so a fleet of workers does not synchronise
      // onto the same instant after a shared outage.
      jitter: { next: () => Math.random() },
      maxJobs: options.maxJobsPerTick ?? 25,
    });

  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<number> | null = null;
  let stopping = false;

  async function tick(): Promise<number> {
    // A tick NEVER throws. A worker that dies on one bad job stops closing every
    // OTHER obligation too, which turns one failure into a silent fleet-wide one.
    try {
      const executed = await worker.runOnce();
      if (executed.length > 0) {
        options.log.info("emergency lapse jobs executed", {
          count: executed.length,
          workerInstanceId: identity.workerInstanceId,
        });
      }
      return executed.length;
    } catch (error: unknown) {
      // REDACTED. An internal failure must not put database text, identifiers or
      // a stack into the log line.
      options.log.warn("emergency lapse tick failed", {
        error: error instanceof Error ? error.name : "unknown",
        workerInstanceId: identity.workerInstanceId,
      });
      return 0;
    }
  }

  function schedule(): void {
    if (stopping) return;
    timer = setTimeout(() => {
      inFlight = tick().finally(() => {
        inFlight = null;
        schedule();
      });
    }, options.pollMs ?? DEFAULT_LAPSE_POLL_MS);
    // Does not hold the process open by itself: the HTTP server is what keeps
    // this service alive, and a lingering timer must not delay a clean exit.
    timer.unref();
  }

  return {
    identity,
    tick,
    start(): void {
      if (timer !== null || inFlight !== null) return;
      options.log.info("emergency lapse worker started", {
        workerInstanceId: identity.workerInstanceId,
        pollMs: options.pollMs ?? DEFAULT_LAPSE_POLL_MS,
        leaseSeconds: lease.leaseSeconds,
      });
      schedule();
    },
    async stop(): Promise<void> {
      stopping = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Waits for a tick already running, so shutdown cannot abandon a claimed
      // job mid-flight and leave it to time out on its lease.
      if (inFlight !== null) await inFlight.catch(() => undefined);
      options.log.info("emergency lapse worker stopped", {
        workerInstanceId: identity.workerInstanceId,
      });
    },
  };
}
