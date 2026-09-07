/**
 * The fleet screen's job is to answer "is anything waiting for me?" before any
 * table is read.
 *
 * ===========================================================================
 * WHAT WAS WRONG, AND WHAT MUST NOT COME BACK
 * ===========================================================================
 * Two failures, both reported by the operator using it:
 *
 *   1. A pending device was invisible. The list printed the raw lifecycle enum,
 *      so a device waiting for a human read as `manufactured` — a word that
 *      sounds like a factory step — and the approval queue was a nav link easy
 *      to miss entirely.
 *
 *   2. "Online or not" was unanswerable. It still is: nothing reports liveness,
 *      `last_observed_at` is null for every device, and the agent answers
 *      HEARTBEAT_NOT_IMPLEMENTED. The screen must say that plainly ONCE rather
 *      than print an ambiguous "Unknown" per row that reads as "offline" — and
 *      it must never print "Online" for a device that has told us nothing.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  anyDeviceHasReported,
  KNOWN_LIFECYCLES,
  lifecycleLabel,
  summariseFleet,
} from "../src/device-presentation.js";
import type { FleetDeviceView, FleetPage } from "../src/management-client.js";
import { DeviceListView } from "../src/views.js";

function device(over: Partial<FleetDeviceView> = {}): FleetDeviceView {
  return {
    deviceId: `id-${over.deviceReference ?? "a"}`,
    deviceReference: "KL-0001",
    deviceClass: "store_hub",
    hardwareProfile: "CLOUD-HUB-PI5",
    lifecycle: "enrolled",
    trustLevel: null,
    certificateStatus: null,
    assignmentState: null,
    tenantReference: null,
    digitalStoreReference: null,
    locationReference: null,
    digitalStoreLabel: null,
    locationLabel: null,
    terminalAssignmentCount: 0,
    openIncidentCount: 0,
    lastSeenAt: null,
    fleetStatus: "enrolled",
    freshness: "NEVER_SEEN",
    requiresAttention: false,
    ...over,
  };
}

function page(devices: FleetDeviceView[]): FleetPage {
  return {
    devices,
    count: devices.length,
    limit: 200,
    truncated: false,
    freshnessPolicyRuled: true,
  };
}

describe("plain words instead of the database enum", () => {
  it("calls a pending device what it is", () => {
    // `manufactured` is the state a person is waiting on. It must not reach the
    // screen in that vocabulary.
    expect(lifecycleLabel("manufactured", "en-US")).toBe("Waiting for approval");
    expect(lifecycleLabel("manufactured", "km-KH")).not.toBe("manufactured");
  });

  it("keeps the four owner-locked stages apart", () => {
    // Factory Enrollment §7: NEW → APPROVED → ASSIGNED → ACTIVE must never
    // collapse. "Approved" alone read as "ready"; an assigned Terminal read as
    // the raw `awaiting_trust`.
    expect(lifecycleLabel("enrolled", "en-US")).toBe("Approved, not assigned to a Store");
    expect(lifecycleLabel("awaiting_trust", "en-US")).toBe(
      "Assigned to a Store, awaiting activation",
    );
    expect(lifecycleLabel("active", "en-US")).toBe("Active");
    expect(lifecycleLabel("quarantined", "en-US")).toBe("Quarantined");
  });

  it("has a label for every value of the lifecycle enum, in both locales", () => {
    // Nine values in `kitluy_devices.device_lifecycle_state`. A tenth added to
    // the enum without a label here would reach the screen raw.
    expect(KNOWN_LIFECYCLES).toHaveLength(9);
    expect(KNOWN_LIFECYCLES).toContain("awaiting_trust");
    expect(KNOWN_LIFECYCLES).toContain("restricted_investigation");
    for (const value of KNOWN_LIFECYCLES) {
      expect(lifecycleLabel(value, "en-US")).not.toBe(value);
      expect(lifecycleLabel(value, "km-KH")).not.toBe(value);
      expect(lifecycleLabel(value, "km-KH")).not.toBe(lifecycleLabel(value, "en-US"));
    }
  });

  it("shows an unknown state verbatim rather than inventing a friendly word", () => {
    // Softening a state this build does not know about is how a screen lies.
    expect(lifecycleLabel("some_future_state", "en-US")).toBe("some_future_state");
  });
});

describe("the summary counts what needs a person", () => {
  it("counts devices awaiting approval", () => {
    const s = summariseFleet([
      device({ lifecycle: "manufactured", deviceReference: "A" }),
      device({ lifecycle: "manufactured", deviceReference: "B" }),
      device({ lifecycle: "enrolled", deviceReference: "C" }),
    ]);
    expect(s.awaitingApproval).toBe(2);
    expect(s.total).toBe(3);
  });

  it("counts the PAIRED / ASSIGNED stage on its own", () => {
    const s = summariseFleet([
      device({ lifecycle: "awaiting_trust", deviceClass: "terminal", deviceReference: "A" }),
      device({ lifecycle: "enrolled", deviceClass: "terminal", deviceReference: "B" }),
      device({ lifecycle: "manufactured", deviceReference: "C" }),
    ]);
    expect(s.assignedAwaiting).toBe(1);
    expect(s.awaitingApproval).toBe(1);
  });

  it("counts incidents and containment separately", () => {
    const s = summariseFleet([
      device({ lifecycle: "quarantined", openIncidentCount: 1, deviceReference: "A" }),
      device({ lifecycle: "enrolled", openIncidentCount: 2, deviceReference: "B" }),
    ]);
    expect(s.contained).toBe(1);
    expect(s.withIncidents).toBe(2);
  });
});

describe("liveness is never invented", () => {
  it("knows when nothing has ever reported", () => {
    expect(anyDeviceHasReported([device(), device()])).toBe(false);
    expect(anyDeviceHasReported([device({ lastSeenAt: "2026-08-19T00:00:00Z" })])).toBe(true);
  });

  it("says so once at the top instead of Unknown on every row", () => {
    const html = renderToString(
      <DeviceListView locale="en-US" page={page([device()])} canApprove />,
    );
    expect(html).toContain("liveness reporting is not built");
    expect(html).toContain("Never reported");
    // The word an operator would trust must not appear for a silent device.
    expect(html).not.toContain(">Online<");
  });
});

describe("a waiting device is impossible to miss", () => {
  const pending = page([
    device({ lifecycle: "manufactured", deviceReference: "KL-PENDING" }),
    device({ lifecycle: "enrolled", deviceReference: "KL-OK" }),
  ]);

  it("shows an action banner linking to the queue", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={pending} canApprove />);
    expect(html).toContain("Needs you");
    expect(html).toContain("#/pending");
    expect(html).toContain("Waiting for approval");
  });

  it("does not show the banner when nothing is waiting", () => {
    const clean = page([device({ lifecycle: "enrolled" })]);
    const html = renderToString(<DeviceListView locale="en-US" page={clean} canApprove />);
    // A permanent "0 waiting" trains people to ignore the space where the real
    // message appears.
    expect(html).not.toContain("Needs you");
  });

  it("does not offer the queue to an Admin who cannot approve", () => {
    const html = renderToString(
      <DeviceListView locale="en-US" page={pending} canApprove={false} />,
    );
    expect(html).not.toContain("#/pending");
    // The device is still listed and still labelled honestly.
    expect(html).toContain("Waiting for approval");
  });

  it("renders the summary tiles", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={pending} canApprove />);
    expect(html).toContain("fleet-summary");
    expect(html).toContain("Store Hubs");
  });

  it("works in Khmer too, without leaking the enum into visible text", () => {
    const html = renderToString(<DeviceListView locale="km-KH" page={pending} canApprove />);
    expect(html).toContain("fleet-summary");
    // `data-lifecycle="manufactured"` stays — it is a machine-readable hook, the
    // same discipline as `data-device-condition`. What must not appear is the
    // enum as VISIBLE text, so the assertion is on the rendered label instead.
    expect(html).toContain('data-lifecycle="manufactured"');
    expect(html).toContain(">រង់ចាំការអនុម័ត<");
    expect(html).not.toContain(">manufactured<");
  });
});
