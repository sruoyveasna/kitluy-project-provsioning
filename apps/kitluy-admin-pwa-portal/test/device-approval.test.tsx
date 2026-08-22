/**
 * The Verify & Approve surface: routing, the client call, and what the screen
 * refuses to let an Admin do.
 *
 * ===========================================================================
 * THE LOAD-BEARING TESTS HERE
 * ===========================================================================
 * Not the happy path. The ones that matter are:
 *
 *   - a device carrying an open trust incident shows WHY instead of a form,
 *     because the governed door will refuse it and an Admin who typed a reason
 *     first would meet an unexplained error;
 *   - the screen never offers a bare "trust" action — plan §4.4 forbids the
 *     casual one-click approval, so submit stays disabled until a reason AND a
 *     verification reference exist;
 *   - every value is labelled as REPORTED, because reading this screen as a
 *     list of established facts is the dangerous mistake;
 *   - a 422 refusal is told apart from a 403 denial, since "you may not do this"
 *     and "this device is not in a state for this" send an operator to different
 *     places.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { classifyResponse, createManagementClient } from "../src/management-client.js";
import { parseRoute, routeHref } from "../src/routing.js";
import { PendingApprovalsView } from "../src/views.js";

const DEVICE_ID = "9e43a581-8281-4637-865b-ac3bd1d3b665";

function pendingDevice(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: DEVICE_ID,
    deviceReference: "KL-CLOUD-HUB-0001",
    deviceClass: "store_hub",
    hardwareProfile: "CLOUD-HUB-PI5",
    lifecycle: "manufactured",
    trustLevel: "development_software",
    reportedHostname: "pi5-zjjtir",
    claimedBoardSerial: "10000000abcdef12",
    claimedSocSerial: "1f00e4c9d1a2b3c4",
    claimedMacAddress: "d8:3a:dd:11:22:33",
    installationGeneration: 2,
    imageRelease: "0.2.0-dev",
    registrationKeyFingerprint: "a".repeat(64),
    enrollmentSequence: 2,
    firstSeenAt: "2026-08-19T04:00:00.000Z",
    lastRegistrationAt: "2026-08-19T05:00:00.000Z",
    openIncidents: [],
    suspectedCredentialReuse: false,
    approvable: true,
    blockingReasons: [],
    ...overrides,
  } as never;
}

function page(devices: unknown[], fourEyesRequired = false) {
  return {
    pending: devices,
    count: devices.length,
    limit: 200,
    truncated: false,
    fourEyesRequired,
  } as never;
}

function render(node: Parameters<typeof renderToString>[0]): string {
  return renderToString(node);
}

describe("routing", () => {
  it("parses the pending queue route", () => {
    expect(parseRoute("#/pending")).toEqual({ kind: "pending" });
  });

  it("round-trips to its href", () => {
    expect(routeHref({ kind: "pending" })).toBe("#/pending");
  });

  it("leaves the existing device routes alone", () => {
    expect(parseRoute("#/devices")).toEqual({ kind: "devices" });
    expect(parseRoute(`#/devices/${DEVICE_ID}`)).toEqual({ kind: "device", deviceId: DEVICE_ID });
  });
});

describe("response classification", () => {
  it("tells a 422 governed refusal apart from a 403 denial", () => {
    const refused = classifyResponse(422, {
      error: {
        message: "This device has an open trust incident.",
        details: { reason: "KLUY-APPROVE-OPEN-INCIDENT" },
      },
    });
    expect(refused).toEqual({
      kind: "refused",
      reason: "KLUY-APPROVE-OPEN-INCIDENT",
      message: "This device has an open trust incident.",
    });

    const denied = classifyResponse(403, {
      error: { message: "Access denied.", details: { reason: "KLUY-PERMISSION-DENIED" } },
    });
    expect((denied as { kind: string }).kind).toBe("denied");
  });

  it("still treats an unrecognised status as unavailable, never as data", () => {
    expect(classifyResponse(418, {})).toEqual({
      kind: "unavailable",
      detail: "The service answered 418.",
    });
  });
});

describe("the approval call", () => {
  function clientWith(capture: { url?: string; init?: RequestInit }) {
    return createManagementClient({
      baseUrl: "https://api.invalid",
      accessToken: () => Promise.resolve("token"),
      fetchImpl: ((url: string, init: RequestInit) => {
        capture.url = url;
        capture.init = init;
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({ deviceId: DEVICE_ID, lifecycleState: "enrolled", detail: "ok" }),
        } as Response);
      }) as unknown as typeof fetch,
    });
  }

  it("POSTs to the governed route with the reason and evidence", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    await clientWith(capture).approveEnrollment(DEVICE_ID, {
      reason: "serial matched",
      verificationEvidenceRef: "HET-CHK-1",
    });

    expect(capture.url).toBe(
      `https://api.invalid/management/v1/devices/${DEVICE_ID}/approve-enrollment`,
    );
    expect(capture.init?.method).toBe("POST");
    const body = JSON.parse(String(capture.init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ reason: "serial matched", verificationEvidenceRef: "HET-CHK-1" });
  });

  it("omits a blank second approver entirely rather than sending an empty string", async () => {
    // The door must be able to tell "no second approver" from "a blank one".
    const capture: { url?: string; init?: RequestInit } = {};
    await clientWith(capture).approveEnrollment(DEVICE_ID, {
      reason: "r",
      verificationEvidenceRef: "e",
      secondApproverRef: "   ",
    });
    const body = JSON.parse(String(capture.init?.body)) as Record<string, unknown>;
    expect(body["secondApproverRef"]).toBeUndefined();
  });

  it("sends a real second approver when one is given", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    await clientWith(capture).approveEnrollment(DEVICE_ID, {
      reason: "r",
      verificationEvidenceRef: "e",
      secondApproverRef: " admin/second ",
    });
    const body = JSON.parse(String(capture.init?.body)) as Record<string, unknown>;
    expect(body["secondApproverRef"]).toBe("admin/second");
  });

  it("does not call the network without a session", async () => {
    let called = false;
    const client = createManagementClient({
      baseUrl: "https://api.invalid",
      accessToken: () => Promise.resolve(null),
      fetchImpl: (() => {
        called = true;
        return Promise.reject(new Error("should not be reached"));
      }) as unknown as typeof fetch,
    });
    const outcome = await client.approveEnrollment(DEVICE_ID, {
      reason: "r",
      verificationEvidenceRef: "e",
    });
    expect(called).toBe(false);
    expect(outcome.kind).toBe("unauthenticated");
  });
});

describe("the screen", () => {
  const noop = (): void => undefined;

  it("labels every value as REPORTED, not as established fact", () => {
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("REPORTED BY THE DEVICE");
    expect(html).toContain("Board serial (reported)");
    expect(html).toContain("10000000abcdef12");
  });

  it("shows the installation generation and key fingerprint a verifier compares", () => {
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("Installation generation");
    expect(html).toContain("Registration key fingerprint");
    // The opaque id, which contract §9 makes the one identifier a pending device
    // receives — an admin needs it to be quotable over the phone.
    expect(html).toContain(DEVICE_ID);
  });

  it("offers a reason and an evidence field, never a bare trust button", () => {
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain('name="reason"');
    expect(html).toContain('name="verificationEvidenceRef"');
    expect(html).toContain("Verify &amp; approve");
    // Submit starts DISABLED: the fields are empty, so nothing may be approved yet.
    expect(html).toContain("disabled");
  });

  it("asks for a second approver only where the environment requires it", () => {
    const without = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()], false)}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(without).not.toContain('name="secondApproverRef"');

    const with4 = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()], true)}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(with4).toContain('name="secondApproverRef"');
  });

  it("replaces the form with the reason when a device cannot be approved", () => {
    // The governed door refuses a device carrying an open trust incident. Showing
    // a form here would let an Admin type a reason and then meet a refusal they
    // could not have predicted.
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([
          pendingDevice({
            approvable: false,
            blockingReasons: ["1 open trust incident(s) must be cleared"],
            suspectedCredentialReuse: true,
            openIncidents: [
              {
                incidentType: "credential_reuse_detected",
                severity: "CRITICAL",
                detectedAt: "2026-08-19T05:00:00.000Z",
                detail: "same key seen on another board",
              },
            ],
          }),
        ])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("Cannot be approved");
    expect(html).toContain("open trust incident");
    expect(html).toContain("Suspected credential reuse");
    expect(html).not.toContain('name="reason"');
  });

  it("shows no form at all to an Admin without the approval permission", () => {
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([pendingDevice()])}
        canApprove={false}
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("does not hold the permission");
    expect(html).not.toContain('name="reason"');
  });

  it("says the queue is empty rather than rendering nothing", () => {
    const html = render(
      <PendingApprovalsView
        locale="en-US"
        page={page([])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("No devices are waiting for approval");
  });

  it("renders in Khmer too, since Khmer is the default locale", () => {
    const html = render(
      <PendingApprovalsView
        locale="km-KH"
        page={page([pendingDevice()])}
        canApprove
        busyDeviceId={null}
        onApprove={noop}
      />,
    );
    expect(html).toContain("ផ្ទៀងផ្ទាត់");
  });
});
