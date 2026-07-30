/**
 * PRODUCTION COMPOSITION tests — the ones that answer "is the real gateway
 * selected, and can a fake ever be?"
 *
 * WS-11-T003 Step 4 final remediation §2. These are deliberately STRUCTURAL
 * rather than behavioural: a behavioural test proves the real implementation
 * works, which is necessary but does not prove a fake is unreachable. Reading the
 * shipped source and the shipped `dist/` is what proves that.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ConfigError } from "@kitluy/shared-config";
import {
  FORBIDDEN_IMPLEMENTATION_OVERRIDES,
  resolveDeviceRevocationService,
} from "../src/composition.js";
import {
  classifyRevocationFailure,
  INSUFFICIENT_PRIVILEGE,
  RedactedRevocationError,
  UNDEFINED_FUNCTION,
} from "../src/revocation-failures.js";
import {
  EMERGENCY_LAPSE_JOB_KIND,
  LAPSE_FAILURE_CODES,
  classifyFailureCode,
  emergencyLapseDedupeKey,
  emergencyLapseJobHandler,
  readLapseAuthorizationId,
} from "../src/lapse-worker.js";
import type { DeviceRevocationService, LapseResult } from "../src/revocation-service.js";
import type { DurableJob } from "@kitluy/job-contracts";

const SRC = join(import.meta.dirname, "..", "src");
const DIST = join(import.meta.dirname, "..", "dist");
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function productionSources(): { readonly file: string; readonly text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));
}

describe("the production composition selects the real implementation", () => {
  it("has no seam through which a double could be injected", () => {
    // One parameter, and it is an environment. There is no gateway, client,
    // factory or implementation-name argument to pass a fake through.
    expect(resolveDeviceRevocationService.length).toBeLessThanOrEqual(1);
  });

  it("builds a runtime over a real pool when the DSN is present", async () => {
    const runtime = resolveDeviceRevocationService({
      DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN,
      KITLUY_ENV: "local",
    });
    try {
      // A real `pg.Pool` — the property a fake would not have.
      expect(typeof runtime.pool.connect).toBe("function");
      expect(typeof runtime.pool.end).toBe("function");
      for (const method of [
        "revokeNormal",
        "revokeEmergency",
        "postApproveEmergency",
        "lapseEmergencyPostApproval",
        "readEmergencyStatus",
      ] as const) {
        expect(typeof runtime.service[method]).toBe("function");
      }
    } finally {
      await runtime.shutdown();
    }
  });

  it("refuses to start when an implementation override is present", () => {
    expect(FORBIDDEN_IMPLEMENTATION_OVERRIDES.length).toBeGreaterThan(0);
    for (const name of FORBIDDEN_IMPLEMENTATION_OVERRIDES) {
      expect(() =>
        resolveDeviceRevocationService({
          DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN,
          KITLUY_ENV: "local",
          [name]: "fake",
        }),
      ).toThrow(ConfigError);
    }
  });

  it("refuses to start without a database URL, rather than degrading", () => {
    expect(() => resolveDeviceRevocationService({ KITLUY_ENV: "local" })).toThrow(ConfigError);
  });

  it("names no fake, stub or in-memory implementation anywhere in shipped source", () => {
    const offenders: string[] = [];
    for (const { file, text } of productionSources()) {
      // The words are searched for as IDENTIFIER-ish usages, not in prose: this
      // file's own sibling modules discuss fakes in comments on purpose, and a
      // check that forbade the discussion would push the reasoning out of the code.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\*.*$/gm, "");
      if (
        /\b(FakeRevocation|StubRevocation|InMemoryRevocation|createFake|createStub)\w*/i.test(code)
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names no legacy revocation helper in shipped source", () => {
    // Group 0151 revoked EXECUTE on these from every runtime identity. A
    // production caller that still named one would fail `42883`/`42501` at the
    // worst possible moment instead of at review time.
    const offenders: string[] = [];
    for (const { file, text } of productionSources()) {
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/^\s*\*.*$/gm, "");
      if (/revoke_device_credential_v1|revoke_device_credential_emergency_v1\b/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("calls only the governed doors, and each under its own identity", () => {
    const service = readFileSync(join(SRC, "revocation-service.ts"), "utf8");
    // Normal revocation goes through the library adapter, which wraps the ONE
    // bound door; the emergency and post-approval doors are named directly and
    // must sit inside a human session.
    expect(service).toContain("createPgRevocationGateway");
    expect(service).toContain("revoke_device_credential_emergency_governed_v1");
    expect(service).toContain("record_governed_emergency_post_approval_v1");
    expect(service).toContain("lapse_governed_emergency_post_approval_v1");

    // The two human doors must be inside `withHumanSession`, not `withServiceRole`.
    const emergencyBlock = service.slice(
      service.indexOf("async revokeEmergency"),
      service.indexOf("async postApproveEmergency"),
    );
    expect(emergencyBlock).toContain("withHumanSession");
    expect(emergencyBlock).not.toContain("withServiceRole");

    const postApprovalBlock = service.slice(
      service.indexOf("async postApproveEmergency"),
      service.indexOf("async lapseEmergencyPostApproval"),
    );
    expect(postApprovalBlock).toContain("withHumanSession");
    expect(postApprovalBlock).not.toContain("withServiceRole");

    // The lapse must be the WORKER, never a human.
    const lapseBlock = service.slice(
      service.indexOf("async lapseEmergencyPostApproval"),
      service.indexOf("async readEmergencyStatus"),
    );
    expect(lapseBlock).toContain("REGISTRY_ROLES.worker");
    expect(lapseBlock).not.toContain("withHumanSession");
  });

  it("ships no test double in dist", () => {
    // `tsconfig.json` includes `src` only, so `test/` cannot be emitted. Asserted
    // rather than assumed, because widening `include` is a one-line change.
    //
    // A missing `dist/` FAILS rather than skips. The first version returned early,
    // which meant the one check whose whole purpose is to catch a widened `include`
    // silently passed on any checkout that had not been built.
    expect(existsSync(DIST), "dist/ is absent — build before asserting its contents").toBe(true);
    const emitted = readdirSync(DIST);
    expect(emitted.filter((f) => /fake|stub|mock|test/i.test(f))).toEqual([]);
  });
});

describe("failure classification: 42501 is permanent and never retried", () => {
  it("classifies insufficient_privilege as permanent authorization", () => {
    const failure = classifyRevocationFailure({ code: INSUFFICIENT_PRIVILEGE }, "op");
    expect(failure.failureClass).toBe("PERMANENT_AUTHORIZATION");
    expect(failure.retryable).toBe(false);
    expect(failure.requiresReconciliation).toBe(false);
  });

  it("classifies an absent door as permanently invalid", () => {
    const failure = classifyRevocationFailure({ code: UNDEFINED_FUNCTION }, "op");
    expect(failure.failureClass).toBe("PERMANENT_INVALID");
    expect(failure.retryable).toBe(false);
  });

  it("routes unconfirmed commits to reconciliation, not to a retry", () => {
    // `08007` is literally transaction_resolution_unknown.
    for (const code of ["08006", "08007", "57P01", "ECONNRESET", undefined]) {
      const failure = classifyRevocationFailure({ code }, "op");
      expect(failure.failureClass).toBe("AMBIGUOUS_NEEDS_RECONCILIATION");
      expect(failure.requiresReconciliation).toBe(true);
      expect(failure.retryable).toBe(false);
    }
  });

  it("retries only genuine contention", () => {
    for (const code of ["40001", "40P01", "55P03"]) {
      expect(classifyRevocationFailure({ code }, "op").failureClass).toBe("RETRYABLE");
    }
  });

  it("treats a governed authority refusal as permanent", () => {
    const failure = classifyRevocationFailure(
      { code: "P0001", message: "the authenticated human does not hold permission X" },
      "op",
    );
    expect(failure.failureClass).toBe("PERMANENT_AUTHORIZATION");
    expect(failure.retryable).toBe(false);
  });
});

describe("redaction: no database, SQL or security detail escapes", () => {
  const secretish = {
    code: "P0001",
    message:
      "permission denied: kitluy_devices.device_emergency_revocation_authorizations scope_digest a1b2c3",
    detail:
      "actor 11111111-1111-4111-8111-111111111111 lacks fleet.device_credential.emergency_revoke",
    hint: "grant the permission",
    where:
      "PL/pgSQL function kitluy_devices.revoke_device_credential_emergency_governed_v1 line 42",
    internalQuery: "select * from kitluy_devices.device_credentials",
  };

  it("keeps raw driver fields out of the thrown error", () => {
    const error = new RedactedRevocationError(classifyRevocationFailure(secretish, "emergency"));
    const serialized = `${error.message} ${JSON.stringify(error)} ${error.stack ?? ""}`;
    for (const leak of [
      "device_emergency_revocation_authorizations",
      "scope_digest a1b2c3",
      "11111111-1111-4111-8111-111111111111",
      "PL/pgSQL",
      "line 42",
      "select * from",
      "grant the permission",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("does not attach the driver error as a cause", () => {
    // An `Error` with a `cause` is routinely serialized whole by loggers, which
    // would re-export exactly what the class exists to withhold.
    const error = new RedactedRevocationError(classifyRevocationFailure(secretish, "emergency"));
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });

  it("still says enough to act on", () => {
    const error = new RedactedRevocationError(classifyRevocationFailure(secretish, "emergency"));
    expect(error.failure.failureClass).toBe("PERMANENT_AUTHORIZATION");
    expect(error.message).toContain("emergency");
    expect(error.message).toContain("REVOCATION_GOVERNANCE_REFUSED");
  });
});

describe("the lapse worker chooses nothing", () => {
  const job = (payload: Record<string, unknown>): DurableJob =>
    ({
      jobId: "job-1",
      jobKind: EMERGENCY_LAPSE_JOB_KIND,
      subjectId: "auth-1",
      environment: "local",
      payload,
      attemptCount: 1,
      status: "leased",
    }) as unknown as DurableJob;

  const AUTH = "22222222-2222-4222-8222-222222222222";

  function serviceReturning(result: LapseResult): DeviceRevocationService {
    return {
      revokeNormal: () => Promise.reject(new Error("not used")),
      revokeEmergency: () => Promise.reject(new Error("not used")),
      postApproveEmergency: () => Promise.reject(new Error("not used")),
      lapseEmergencyPostApproval: () => Promise.resolve(result),
      readEmergencyStatus: () => Promise.resolve(null),
    };
  }

  it("accepts only an immutable authorization id", () => {
    expect(readLapseAuthorizationId(job({ authorizationId: AUTH }))).toBe(AUTH);
    expect(readLapseAuthorizationId(job({ authorization_id: AUTH }))).toBe(AUTH);
    expect(readLapseAuthorizationId(job({}))).toBeNull();
    expect(readLapseAuthorizationId(job({ authorizationId: "not-a-uuid" }))).toBeNull();
    expect(readLapseAuthorizationId(job({ authorizationId: 42 }))).toBeNull();
  });

  it("cannot be told an actor, reason, incident, scope or deadline", () => {
    const source = readFileSync(join(SRC, "lapse-worker.ts"), "utf8");
    const readerBlock = source.slice(
      source.indexOf("export function readLapseAuthorizationId"),
      source.indexOf("export const LAPSE_FAILURE_CODES"),
    );
    for (const forbidden of [
      "actorUserId",
      "reasonCode",
      "incidentReference",
      "scopeDigest",
      "postApprovalDueAt",
      "environment",
    ]) {
      expect(readerBlock).not.toContain(forbidden);
    }
  });

  it("deduplicates on the authorization alone, so a shortened deadline reuses the job", () => {
    expect(emergencyLapseDedupeKey(AUTH)).toBe(`${EMERGENCY_LAPSE_JOB_KIND}:${AUTH}`);
  });

  it("defers rather than fails when the window has not closed", async () => {
    const handler = emergencyLapseJobHandler(
      serviceReturning({
        outcome: "NOT_DUE",
        authorizationId: AUTH,
        verdictId: null,
        refusalCode: null,
      }),
    );
    const result = await handler.handle(job({ authorizationId: AUTH }));
    // `deferred` does not consume an attempt; `failed` would dead-letter a
    // healthy obligation after five early sweeps.
    expect(result.disposition.kind).toBe("deferred");
  });

  it("treats an already-decided obligation as success, so duplicate delivery is idempotent", async () => {
    const handler = emergencyLapseJobHandler(
      serviceReturning({
        outcome: "ALREADY_DECIDED",
        authorizationId: AUTH,
        verdictId: "v1",
        refusalCode: null,
      }),
    );
    const result = await handler.handle(job({ authorizationId: AUTH }));
    expect(result.disposition).toEqual({
      kind: "completed",
      resultCode: LAPSE_FAILURE_CODES.settled,
    });
    expect(classifyFailureCode(LAPSE_FAILURE_CODES.settled)).toBe("terminal_success");
  });

  it("completes on a real lapse", async () => {
    const handler = emergencyLapseJobHandler(
      serviceReturning({
        outcome: "LAPSED",
        authorizationId: AUTH,
        verdictId: "v2",
        refusalCode: null,
      }),
    );
    const result = await handler.handle(job({ authorizationId: AUTH }));
    expect(result.disposition).toEqual({
      kind: "completed",
      resultCode: "EMERGENCY_POST_APPROVAL_LAPSED",
    });
  });

  it("classifies an authorization refusal as manual review, never retryable", async () => {
    const service = serviceReturning({
      outcome: "LAPSED",
      authorizationId: AUTH,
      verdictId: null,
      refusalCode: null,
    });
    const failing: DeviceRevocationService = {
      ...service,
      lapseEmergencyPostApproval: () =>
        Promise.reject(
          new RedactedRevocationError(
            classifyRevocationFailure({ code: INSUFFICIENT_PRIVILEGE }, "lapse"),
          ),
        ),
    };
    const result = await emergencyLapseJobHandler(failing).handle(job({ authorizationId: AUTH }));
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: LAPSE_FAILURE_CODES.authorization,
    });
    expect(classifyFailureCode(LAPSE_FAILURE_CODES.authorization)).toBe("manual_review");
  });

  it("sends an unconfirmed outcome to a human rather than retrying it", async () => {
    const failing: DeviceRevocationService = {
      revokeNormal: () => Promise.reject(new Error("not used")),
      revokeEmergency: () => Promise.reject(new Error("not used")),
      postApproveEmergency: () => Promise.reject(new Error("not used")),
      readEmergencyStatus: () => Promise.resolve(null),
      lapseEmergencyPostApproval: () =>
        Promise.reject(
          new RedactedRevocationError(classifyRevocationFailure({ code: "08007" }, "lapse")),
        ),
    };
    const result = await emergencyLapseJobHandler(failing).handle(job({ authorizationId: AUTH }));
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: LAPSE_FAILURE_CODES.unknownOutcome,
    });
    // Relies on the retry policy's documented default: an unmapped code fails
    // closed toward a human, which is what an unconfirmed commit requires.
    expect(classifyFailureCode(LAPSE_FAILURE_CODES.unknownOutcome)).toBe("manual_review");
  });

  it("never puts driver text into attempt evidence", async () => {
    const failing: DeviceRevocationService = {
      revokeNormal: () => Promise.reject(new Error("not used")),
      revokeEmergency: () => Promise.reject(new Error("not used")),
      postApproveEmergency: () => Promise.reject(new Error("not used")),
      readEmergencyStatus: () => Promise.resolve(null),
      lapseEmergencyPostApproval: () =>
        Promise.reject(new Error("permission denied for table device_credentials")),
    };
    const result = await emergencyLapseJobHandler(failing).handle(job({ authorizationId: AUTH }));
    expect(JSON.stringify(result.evidence)).not.toContain("device_credentials");
  });
});
