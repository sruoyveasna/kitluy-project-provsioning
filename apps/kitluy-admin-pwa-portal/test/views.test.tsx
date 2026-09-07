/**
 * View rendering. Server rendering is enough here because every view is a pure
 * function of its props — the states worth asserting are exactly the ones an
 * operator sees, and none of them depend on an effect having run.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { MESSAGES } from "../src/messages.js";
import type { DeviceDetail, FleetDeviceView, FleetPage } from "../src/management-client.js";
import { DeviceDetailView, DeviceListView, LoginView, NoticePanel } from "../src/views.js";

const DEVICE: FleetDeviceView = {
  deviceId: "11111111-2222-3333-4444-555555555555",
  deviceReference: "KL-CLOUD-HUB-0001",
  deviceClass: "store_hub",
  hardwareProfile: "CLOUD-HUB-PI5",
  lifecycle: "enrolled",
  trustLevel: "development_software",
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
};

const PAGE: FleetPage = {
  devices: [DEVICE],
  count: 1,
  limit: 200,
  truncated: false,
  freshnessPolicyRuled: false,
};

const noop = (): void => undefined;

describe("sign-in view", () => {
  it("renders the form with both fields", () => {
    const html = renderToString(
      <LoginView locale="en-US" state={{ kind: "idle" }} onSubmit={noop} />,
    );
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain(MESSAGES["en-US"].signIn);
  });

  it("shows a loading state and disables submission while signing in", () => {
    const html = renderToString(
      <LoginView locale="en-US" state={{ kind: "submitting" }} onSubmit={noop} />,
    );
    expect(html).toContain(MESSAGES["en-US"].signingIn);
    expect(html).toContain("disabled");
  });

  it("shows each failure distinctly", () => {
    const cases = [
      ["invalid_credentials", MESSAGES["en-US"].invalidCredentials],
      ["network_error", MESSAGES["en-US"].networkError],
      ["missing_password", MESSAGES["en-US"].missingPassword],
      ["unexpected", MESSAGES["en-US"].unexpectedError],
    ] as const;
    for (const [failure, message] of cases) {
      const html = renderToString(
        <LoginView locale="en-US" state={{ kind: "failed", failure }} onSubmit={noop} />,
      );
      expect(html).toContain(`data-sign-in-failure="${failure}"`);
      expect(html).toContain(message);
    }
  });

  it("never echoes a typed password back into the markup", () => {
    const html = renderToString(
      <LoginView
        locale="en-US"
        state={{ kind: "failed", failure: "invalid_credentials" }}
        onSubmit={noop}
      />,
    );
    expect(html).toContain('value=""');
  });

  it("carries an account refusal as a notice, not as a form error", () => {
    // "Your account is disabled" is not a retry: it must not read as though
    // retyping the password would help.
    const html = renderToString(
      <LoginView
        locale="en-US"
        state={{ kind: "idle" }}
        notice="accountDisabled"
        onSubmit={noop}
      />,
    );
    expect(html).toContain(MESSAGES["en-US"].accountDisabled);
    expect(html).toContain('data-notice="accountDisabled"');
  });

  it("renders in Khmer", () => {
    const html = renderToString(
      <LoginView locale="km-KH" state={{ kind: "idle" }} onSubmit={noop} />,
    );
    expect(html).toContain(MESSAGES["km-KH"].signIn);
  });
});

describe("device list view", () => {
  it("links each device to its detail route", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={PAGE} />);
    expect(html).toContain(`href="#/devices/${DEVICE.deviceId}"`);
    expect(html).toContain("KL-CLOUD-HUB-0001");
  });

  it("marks a quarantined device abnormal in the markup", () => {
    const page: FleetPage = {
      ...PAGE,
      devices: [{ ...DEVICE, lifecycle: "quarantined", requiresAttention: true }],
    };
    const html = renderToString(<DeviceListView locale="en-US" page={page} />);
    expect(html).toContain('data-device-condition="abnormal"');
    expect(html).toContain(MESSAGES["en-US"].abnormal);
  });

  it("marks a restricted_investigation device abnormal", () => {
    const page: FleetPage = {
      ...PAGE,
      devices: [{ ...DEVICE, lifecycle: "restricted_investigation", requiresAttention: true }],
    };
    const html = renderToString(<DeviceListView locale="en-US" page={page} />);
    expect(html).toContain('data-device-condition="abnormal"');
    expect(html).toContain("restricted_investigation");
  });

  it("says the liveness threshold is unruled instead of implying live data", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={PAGE} />);
    expect(html).toContain(MESSAGES["en-US"].freshnessUnruled);
    expect(html).not.toContain(">Online<");
  });

  it("reports a ruled policy as a DEVELOPMENT default, not as settled truth", () => {
    const page: FleetPage = {
      ...PAGE,
      freshnessPolicyRuled: true,
      devices: [{ ...DEVICE, freshness: "ONLINE", lastSeenAt: "2026-08-10T12:00:00Z" }],
    };
    const html = renderToString(<DeviceListView locale="en-US" page={page} />);
    // Online may now be shown — but never without saying the threshold behind
    // it is provisional and owed a Pilot review.
    expect(html).toContain("Online");
    expect(html).toContain(MESSAGES["en-US"].freshnessDevelopmentDefault);
    expect(html).not.toContain(MESSAGES["en-US"].freshnessUnruled);
  });

  it("declares an incomplete page instead of implying it is the whole fleet", () => {
    const html = renderToString(
      <DeviceListView locale="en-US" page={{ ...PAGE, truncated: true }} />,
    );
    expect(html).toContain(MESSAGES["en-US"].truncated);
  });

  it("renders empty as empty — never as a zero that looks like data", () => {
    const html = renderToString(
      <DeviceListView locale="en-US" page={{ ...PAGE, devices: [], count: 0 }} />,
    );
    expect(html).toContain('data-surface-state="empty"');
  });
});

describe("device detail view", () => {
  const detail: DeviceDetail = {
    device: DEVICE,
    provisioning: { eligible: true, reasons: [] },
    freshnessPolicyRuled: false,
  };

  it("shows an eligible device and offers no issuance control", () => {
    const html = renderToString(<DeviceDetailView locale="en-US" detail={detail} />);
    expect(html).toContain(MESSAGES["en-US"].provisioningEligible);
    expect(html).toContain(MESSAGES["en-US"].provisioningNotHere);
    expect(html).not.toContain("<button");
  });

  it("shows every refusal reason for a device that may not be provisioned", () => {
    const refused: DeviceDetail = {
      device: { ...DEVICE, lifecycle: "quarantined", requiresAttention: true },
      provisioning: {
        eligible: false,
        reasons: ["device is quarantined — provisioning is forbidden"],
      },
      freshnessPolicyRuled: false,
    };
    const html = renderToString(<DeviceDetailView locale="en-US" detail={refused} />);
    expect(html).toContain(MESSAGES["en-US"].provisioningRefused);
    expect(html).toContain("quarantined");
    expect(html).toContain('data-condition="abnormal"');
  });

  it("reports NEVER_SEEN rather than inventing a heartbeat", () => {
    const html = renderToString(<DeviceDetailView locale="en-US" detail={detail} />);
    expect(html).toContain(MESSAGES["en-US"].neverSeen);
  });
});

describe("notice panel", () => {
  it("fails closed with an unavailable surface", () => {
    const html = renderToString(<NoticePanel locale="en-US" messageKey="serviceUnavailable" />);
    expect(html).toContain('data-surface-state="unavailable"');
    expect(html).toContain(MESSAGES["en-US"].serviceUnavailable);
  });
});

describe("a Pi Terminal in the fleet list", () => {
  const TERMINAL: FleetDeviceView = {
    ...DEVICE,
    deviceId: "66666666-7777-8888-9999-000000000000",
    deviceReference: "KL-6783D70CB6BF",
    deviceClass: "terminal",
    lifecycle: "awaiting_trust",
    assignmentState: "pending_trust",
    terminalAssignmentCount: 2,
    digitalStoreReference: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    digitalStoreLabel: "DEMO-LAUNDRY-001 — Demo Laundry",
    locationLabel: "BKK1 — Boeung Keng Kang 1",
  };
  const page: FleetPage = { ...PAGE, devices: [TERMINAL] };

  it("says ASSIGNED, awaiting activation — never the raw enum, never a UUID", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={page} />);
    expect(html).toContain('data-lifecycle="awaiting_trust"');
    expect(html).toContain("Assigned to a Store, awaiting activation");
    expect(html).toContain('data-terminal-assignment="assigned_awaiting"');
    expect(html).toContain("2 profiles");
    expect(html).toContain("DEMO-LAUNDRY-001 — Demo Laundry");
    expect(html).not.toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(html).not.toContain(">awaiting_trust<");
  });

  it("offers the class filter with the value the database actually holds", () => {
    const html = renderToString(<DeviceListView locale="en-US" page={page} />);
    expect(html).toContain('<option value="terminal">');
    expect(html).not.toContain("pi_terminal");
  });

  it("counts the PAIRED / ASSIGNED stage in the summary", () => {
    const html = renderToString(<DeviceListView locale="km-KH" page={page} />);
    expect(html).toContain(`data-stat="${MESSAGES["km-KH"].summaryAssignedAwaiting}"`);
  });

  it("shows the plain words and the raw enum on the detail page", () => {
    const detail: DeviceDetail = {
      device: TERMINAL,
      provisioning: { eligible: false, reasons: ["already assigned"] },
      freshnessPolicyRuled: false,
    };
    const html = renderToString(<DeviceDetailView locale="en-US" detail={detail} />);
    expect(html).toContain("Assigned to a Store, awaiting activation");
    expect(html).toContain("<code>awaiting_trust</code>");
    expect(html).toContain('data-terminal-assignment="assigned_awaiting"');
  });
});
