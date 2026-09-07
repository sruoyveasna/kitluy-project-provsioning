/**
 * The governed doors must be called ONCE, and the audit trail must say so.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS
 * ===========================================================================
 * `device-trust-advance.ts` shipped calling both governed doors through
 * `select (fn(...)).*`. PostgreSQL expands a composite in the SELECT list by
 * re-evaluating the function ONCE PER FIELD, so that form ran:
 *
 *   establish_device_trusted_time_v1   7x   (trusted_time_outcome, 7 fields)
 *   attempt_activate_device_v1         6x   (activation_outcome,   6 fields)
 *
 * every single pairing. Seven trusted-time evaluations and six activation
 * attempts, each committing its own evidence row, each `gen_random_uuid()`
 * correlation id different, and the returned fields read from DIFFERENT calls —
 * a later one that already saw the floor an earlier one advanced.
 *
 * `trusted-time-gateway.ts` had recorded exactly this hazard for the identical
 * function and used the FROM-clause form; the cloud caller was written later and
 * did not. Nothing caught it: the router suite injects `advanceTrust` and never
 * reaches the SQL, and the live runs looked correct because the LAST evaluation
 * still returns a plausible row.
 *
 * So the property is asserted on the statement text itself. It is the only place
 * the difference is visible without a database, and a database test would have
 * to count audit rows to see it at all.
 */
import { describe, expect, it } from "vitest";

import { advanceDeviceTrust } from "../src/device-trust-advance.js";

/** Every statement the advance issued, in order. */
function recordingPool(): { pool: never; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query(text: string) {
      statements.push(text);
      if (/establish_device_trusted_time_v1/.test(text)) {
        return Promise.resolve({ rows: [{ status: "trusted" }] });
      }
      if (/issue_development_device_certificate_v1/.test(text)) {
        return Promise.resolve({ rows: [{ result: { outcome: "ISSUED" } }] });
      }
      if (/attempt_activate_device_v1/.test(text)) {
        return Promise.resolve({
          rows: [
            {
              outcome: "ACTIVATED",
              lifecycle_state: "active",
              refusal_code: null,
              refusal_message: null,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
    release() {
      /* nothing to release on a stub */
    },
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as never;
  return { pool, statements };
}

const INPUT = {
  deviceRecordId: "11111111-1111-4111-8111-111111111111",
  environment: "development",
  actorRef: "device/hub-pairing",
};

describe("advanceDeviceTrust calls each governed door exactly once", () => {
  it("never uses the composite SELECT-list form, which multiplies the call", async () => {
    const { pool, statements } = recordingPool();
    await advanceDeviceTrust(pool, INPUT);

    // `(kitluy_devices.something_v1(...)).*` — the shape that re-evaluates.
    const expanded = statements.filter((s) => /\)\s*\)\s*\.\*/.test(s.replace(/\s+/g, " ")));
    expect(expanded).toEqual([]);
  });

  it("reads trusted time and activation from the FROM clause", async () => {
    const { pool, statements } = recordingPool();
    await advanceDeviceTrust(pool, INPUT);

    const trustedTime = statements.filter((s) => s.includes("establish_device_trusted_time_v1"));
    const activation = statements.filter((s) => s.includes("attempt_activate_device_v1"));

    expect(trustedTime).toHaveLength(1);
    expect(activation).toHaveLength(1);
    // `from fn(...)` evaluates once; `select (fn(...)).*` evaluates per field.
    expect(/from\s+kitluy_devices\.establish_device_trusted_time_v1/.test(trustedTime[0]!)).toBe(
      true,
    );
    expect(/from\s+kitluy_devices\.attempt_activate_device_v1/.test(activation[0]!)).toBe(true);
  });

  it("R-1: names no time, and offers no expression that could become one", async () => {
    const { pool, statements } = recordingPool();
    await advanceDeviceTrust(pool, INPUT);

    const establish = statements.filter((s) => s.includes("establish_device_trusted_time_v1"));
    expect(establish).toHaveLength(1);

    // The shipped version passed `now()` into `p_authenticated_network_time`. An
    // external review passed `now() + 3650 days` through the SAME parameter and
    // moved a device's floor ten years forward — permanently, because the floor
    // is monotonic. The parameter is gone from the boundary; assert that this
    // caller cannot reintroduce one.
    expect(establish[0]).not.toMatch(/now\s*\(/i);
    expect(establish[0]).not.toMatch(/timestamptz/i);
    expect(establish[0]).not.toMatch(/interval/i);

    // Exactly three arguments: device, environment, correlation id. Nothing that
    // carries a value the authority is supposed to decide.
    const args = establish[0]!.slice(establish[0]!.indexOf("establish_device_trusted_time_v1"));
    expect(args.match(/\$\d+/g)).toEqual(["$1", "$2"]);
  });

  it("still reports what the doors said", async () => {
    const { pool } = recordingPool();
    const outcome = await advanceDeviceTrust(pool, INPUT);
    expect(outcome).toEqual({
      kind: "advanced",
      lifecycleState: "active",
      trustedTimeStatus: "trusted",
      // `CSR_REQUIRED`, because `INPUT` carries no `operationalRequest`. This
      // read `ISSUED` while the step called `issue_development_device_certificate_v1`,
      // and that call is gone: it wrote a `device_certificates` row with no
      // `certificate_pem`, no `certificate_sha256` and no `credential_id`, which
      // group 0201 no longer accepts as a certificate and whose `status = 'active'`
      // would occupy the one-active index against the real one.
      certificate: "CSR_REQUIRED",
    });
  });

  it("FABRICATES NO CERTIFICATE for a device that has not asked for one", async () => {
    const { pool, statements } = recordingPool();
    const outcome = await advanceDeviceTrust(pool, INPUT);

    // The load-bearing one. A certificate is a statement about a KEY, and the
    // only key that may appear in it is one the device proved it holds. With no
    // request there is no key, so there must be no certificate — not a
    // placeholder, not a metadata row, nothing. Issuance is not attempted at
    // all, rather than attempted and refused.
    expect(statements.filter((s) => /certificate/i.test(s))).toEqual([]);
    expect(statements.filter((s) => /issue|credential|register_generation_key/i.test(s))).toEqual(
      [],
    );
    expect(outcome.kind === "advanced" && outcome.certificate).toBe("CSR_REQUIRED");
  });

  it("opens one transaction per identity and never mixes the two roles", async () => {
    const { pool, statements } = recordingPool();
    await advanceDeviceTrust(pool, INPUT);

    // Separation of duty is structural: `set local role` dies with the
    // transaction that set it, so a second identity costs a second transaction.
    // That is not overhead to engineer away — it IS the separation.
    expect(statements.filter((s) => s === "set local role kitluy_activation_service")).toHaveLength(
      2,
    );

    // ZERO, and that is the change rather than a regression. Trusted time and
    // activation are the only steps this path takes on its own; certificate
    // issuance now runs the governed composition, under
    // `kitluy_issuance_service` and `kitluy_credential_issuer`, and only when
    // the device presents a signed `kitluy.csr.v1`. The activation identity
    // still never issues, which is what this assertion has always been about.
    expect(
      statements.filter((s) => s === "set local role kitluy_device_certificate_issuer"),
    ).toHaveLength(0);
    expect(statements.filter((s) => s.startsWith("set local role"))).toHaveLength(2);
    expect(statements.filter((s) => s === "commit")).toHaveLength(2);
  });
});
