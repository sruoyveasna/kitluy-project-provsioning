/**
 * The device's canonicalizer must produce EXACTLY the bytes the server verifies.
 *
 * There are two implementations on purpose. The authoritative one lives in
 * `@kitluy/device-identity`; the device carries its own copy because the
 * firstboot agent ships inside the golden image with zero runtime dependencies,
 * and `package-bootstrap-runtime.sh` refuses the build if it ever gains one.
 *
 * A duplicated canonicalizer is precisely the thing that drifts silently: a
 * reordered field or a changed separator would still sign, still verify against
 * itself, and fail only in the field against a real server. This test is what
 * makes the duplication safe — it is the reason the copy is allowed to exist.
 *
 * This test imports BOTH, so it is the one place they are compared. It is a
 * test-only import: nothing here reaches the image.
 */
import { manufacturingEnrollmentChallengeBytes } from "@kitluy/device-identity";
import { describe, expect, it } from "vitest";

import {
  ENROLLMENT_POP_KIND,
  ENROLLMENT_POP_PURPOSE,
  enrollmentPopChallengeBytes,
} from "../src/enrollment-pop-bytes.js";

const FIELDS = {
  challengeId: "11111111-1111-4111-8111-111111111111",
  purpose: ENROLLMENT_POP_PURPOSE,
  environment: "development" as const,
  presentedKeyFingerprint: "a".repeat(64),
  nonce: "b".repeat(64),
  issuedAt: new Date("2026-08-12T09:00:00.000Z"),
  expiresAt: new Date("2026-08-12T09:05:00.000Z"),
};

describe("device and server canonicalizers agree", () => {
  it("produce byte-identical output for the same challenge", () => {
    const device = Buffer.from(enrollmentPopChallengeBytes(FIELDS));
    const server = Buffer.from(manufacturingEnrollmentChallengeBytes(FIELDS));
    expect(device.equals(server)).toBe(true);
  });

  it("agree on the domain separator", () => {
    const server = Buffer.from(manufacturingEnrollmentChallengeBytes(FIELDS)).toString("utf8");
    expect(server.startsWith(ENROLLMENT_POP_KIND)).toBe(true);
  });

  it("agree field by field, so a reordering is caught rather than hashed away", () => {
    // Comparing hashes alone would prove equality but not tell a future reader
    // WHICH field moved. Splitting on the separator localises the failure.
    const device = Buffer.from(enrollmentPopChallengeBytes(FIELDS)).toString("utf8").split("\n");
    const server = Buffer.from(manufacturingEnrollmentChallengeBytes(FIELDS))
      .toString("utf8")
      .split("\n");
    expect(device).toEqual(server);
  });

  it("stay identical when every field varies", () => {
    // A single fixture could pass by coincidence if two fields happened to hold
    // the same value. Varying all of them removes that.
    const varied = {
      challengeId: "22222222-2222-4222-8222-222222222222",
      purpose: ENROLLMENT_POP_PURPOSE,
      environment: "pilot" as const,
      presentedKeyFingerprint: "c".repeat(64),
      nonce: "d".repeat(64),
      issuedAt: new Date("2027-01-02T03:04:05.678Z"),
      expiresAt: new Date("2027-01-02T03:09:05.678Z"),
    };
    expect(Buffer.from(enrollmentPopChallengeBytes(varied))).toEqual(
      Buffer.from(manufacturingEnrollmentChallengeBytes(varied)),
    );
  });
});
