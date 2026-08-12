/**
 * Development open enrollment (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001).
 *
 * The owner's requirement is: flash one card, copy it freely, every Pi comes
 * online by itself. A copied card carries no ticket, so these prove the
 * no-ticket path works — and, more importantly, that it stays OFF unless a
 * deployment turns it on, and that a caller cannot tell which it is talking to.
 */
import { describe, expect, it } from "vitest";

import { EnrollmentComposition } from "../src/enrollment-composition.js";
import { createEnrollmentRouter, DEVICE_ENROLLMENT_PREFIX } from "../src/enrollment-routes.js";
import { BootstrapRateLimiter } from "../src/provisioning-routes.js";
import type { ClientSource } from "../src/database.js";

const PROFILE_ID = "1c3770b6-18d3-48a4-aa91-5f4ae7ddeb2a";
const FINGERPRINT = "a".repeat(64);
const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n";

/** Records the doors called, and answers them successfully. */
function fakeSource(options: { refuseOpen?: boolean } = {}): {
  source: ClientSource;
  doors: string[];
  params: unknown[][];
} {
  const doors: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: (sql: string, p: unknown[] = []) => {
      if (/^(begin|commit|rollback|set local role)/i.test(sql.trim())) {
        return Promise.resolve({ rows: [] });
      }
      params.push(p);
      if (sql.includes("issue_manufacturing_enrollment_ticket_v1")) {
        doors.push("issue");
        return Promise.resolve({
          rows: [{ result: { outcome: "ISSUED", ticket_reference: p[0] } }],
        });
      }
      if (sql.includes("open_manufacturing_enrollment_challenge_v1")) {
        doors.push("open");
        if (options.refuseOpen === true) {
          return Promise.resolve({
            rows: [
              {
                result: {
                  outcome: "REFUSED",
                  refusal_code: "KLUY-MFGTICKET-UNKNOWN-OR-INVALID",
                },
              },
            ],
          });
        }
        return Promise.resolve({
          rows: [
            {
              result: {
                outcome: "CHALLENGE_ISSUED",
                challenge_id: "3fa463da-9536-4b44-8fbc-9672473aa13a",
                challenge_nonce: "b".repeat(64),
                expires_at: new Date(Date.now() + 300_000).toISOString(),
              },
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  return { source: { connect: () => Promise.resolve(client as never) }, doors, params };
}

function challengeRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    path: `${DEVICE_ENROLLMENT_PREFIX}/challenges`,
    headers: { "content-type": "application/json" },
    rawBody: JSON.stringify(body),
    sourceIp: "10.0.0.1",
  };
}

const NO_TICKET_BODY = {
  deviceClass: "terminal",
  publicKeyFingerprint: FINGERPRINT,
  publicKeyPem: PEM,
  publicKeyAlgorithm: "ed25519",
  keyStorageClass: "software",
};

function routerWith(
  openEnrollment?: {
    stationKey: string;
    operatorRef: string;
    profileIdByDeviceClass: Record<string, string>;
  },
  sourceOptions: { refuseOpen?: boolean } = {},
) {
  const fake = fakeSource(sourceOptions);
  const composition = new EnrollmentComposition({
    source: fake.source,
    signer: { signCanonicalSnapshot: () => Promise.reject(new Error("unused")) },
    timeKeyReference: null,
    ...(openEnrollment === undefined ? {} : { openEnrollment }),
  });
  return {
    fake,
    composition,
    router: createEnrollmentRouter({
      composition,
      rateLimiter: new BootstrapRateLimiter({ now: () => 0 }),
    }),
  };
}

const ENABLED = {
  stationKey: "STATION-WORKSHOP-1",
  operatorRef: "operator/dev-open-enrollment",
  profileIdByDeviceClass: { terminal: PROFILE_ID },
};

describe("a copied card with no ticket", () => {
  it("enrolls when the deployment has open enrollment ON", async () => {
    const { router, fake } = routerWith(ENABLED);
    const response = await router.handle(challengeRequest(NO_TICKET_BODY));

    expect(response.status).toBe(201);
    // The ticket is MINTED then redeemed through the same governed doors —
    // this is not a bypass, and the audit trail is a station's.
    expect(fake.doors).toEqual(["issue", "open"]);
  });

  it("is REFUSED when the deployment has it OFF", async () => {
    const { router, fake } = routerWith(undefined);
    const response = await router.handle(challengeRequest(NO_TICKET_BODY));

    expect(response.status).not.toBe(201);
    // Nothing was issued: a disabled deployment does not touch the database.
    expect(fake.doors).toEqual([]);
  });

  it("looks identical to a bad ticket, so probing cannot reveal the mode", async () => {
    const off = await routerWith(undefined).router.handle(challengeRequest(NO_TICKET_BODY));
    // A deployment WITH open enrollment, presented a ticket the door rejects.
    const badTicket = await routerWith(ENABLED, { refuseOpen: true }).router.handle(
      challengeRequest({
        ...NO_TICKET_BODY,
        ticketReference: "KL-TKT-NOPE",
        ticketDigest: "c".repeat(64),
      }),
    );
    // Same status and same canonical code for "no open enrollment here" and
    // "that ticket is not valid".
    expect(off.status).toBe(badTicket.status);
    expect((off.body as { error: { code: string } }).error.code).toBe(
      (badTicket.body as { error: { code: string } }).error.code,
    );
  });

  it("still requires a device class and a well-formed key", async () => {
    const { router } = routerWith(ENABLED);
    const missingClass = await router.handle(
      challengeRequest({ ...NO_TICKET_BODY, deviceClass: undefined }),
    );
    expect(missingClass.status).toBe(422);

    const badKey = await router.handle(challengeRequest({ ...NO_TICKET_BODY, publicKeyPem: "" }));
    expect(badKey.status).toBe(422);
  });

  it("refuses a device class the deployment configured no profile for", async () => {
    const { router, fake } = routerWith(ENABLED);
    const response = await router.handle(
      challengeRequest({ ...NO_TICKET_BODY, deviceClass: "store_hub" }),
    );
    expect(response.status).not.toBe(201);
    expect(fake.doors).toEqual([]);
  });

  it("issues against the CONFIGURED station and profile, never a caller-supplied one", async () => {
    const { router, fake } = routerWith(ENABLED);
    await router.handle(
      challengeRequest({
        ...NO_TICKET_BODY,
        // A caller trying to choose its own station and profile.
        enrollmentStationKey: "STATION-ATTACKER",
        hardwareProfileId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    const issueParams = fake.params[0] ?? [];
    expect(issueParams).toContain(PROFILE_ID);
    expect(issueParams).toContain("STATION-WORKSHOP-1");
    expect(JSON.stringify(issueParams)).not.toContain("STATION-ATTACKER");
  });
});

describe("a card that DOES carry a ticket", () => {
  it("still takes the ticket path, and mints nothing", async () => {
    const { router, fake } = routerWith(ENABLED);
    await router.handle(
      challengeRequest({
        ...NO_TICKET_BODY,
        ticketReference: "KL-TKT-ABCDEF012345",
        ticketDigest: "d".repeat(64),
      }),
    );
    // `open` without a preceding `issue`: the presented ticket was used.
    expect(fake.doors).toEqual(["open"]);
  });
});
