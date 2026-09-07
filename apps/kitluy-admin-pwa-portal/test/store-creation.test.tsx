/**
 * Digital Store creation in the Admin Portal (owner decision v2.0.0 §2).
 *
 * Protected here: the routes round-trip; a 201 is a success; the POST body is
 * exactly what the API accepts, with blank optional members OMITTED; the form
 * stays disabled until every required field exists, asks for a second approver
 * only when the server says so, shows a refusal verbatim and a creation with
 * its audit id; and an Admin without the permission sees no form.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { MESSAGES } from "../src/messages.js";
import {
  classifyResponse,
  createManagementClient,
  type StoreCreationOptions,
  type StoreListPage,
} from "../src/management-client.js";
import { parseRoute, routeHref } from "../src/routing.js";
import { StoreCreateView, StoreListView } from "../src/views.js";

const TENANT = "00000000-0000-4000-8000-000000000011";
const OPTIONS: StoreCreationOptions = {
  tenants: [
    {
      tenantId: TENANT,
      tenantCode: "DEMO-KH-001",
      displayName: "Demo Partner",
      status: "ACTIVE",
      partnerVerificationStatus: "APPROVED",
      partnerStaffCount: 1,
    },
  ],
  verticals: [
    { code: "LAUNDRY", status: "ACTIVE", labels: { "km-KH": "បោកអ៊ុត", "en-US": "Laundry" } },
    { code: "GROCERY", status: "ROADMAP", labels: { "km-KH": null, "en-US": "Grocery" } },
  ],
  fourEyesRequired: false,
};
const noop = (): void => undefined;

describe("routes", () => {
  it("round-trips the Stores routes and refuses a stray segment", () => {
    expect(parseRoute(routeHref({ kind: "stores" }))).toEqual({ kind: "stores" });
    expect(parseRoute(routeHref({ kind: "store_new" }))).toEqual({ kind: "store_new" });
    expect(parseRoute("#/stores/x").kind).toBe("unknown");
  });
});

describe("the client", () => {
  it("accepts 201 as ok", () => {
    expect(classifyResponse(201, { digitalStoreId: "x" }).kind).toBe("ok");
  });

  it("posts exactly the agreed body, omitting blank optional members", async () => {
    const seen: { value: { url: string; body: unknown } | null } = { value: null };
    const client = createManagementClient({
      baseUrl: "https://api.example",
      accessToken: async () => "tok",
      fetchImpl: ((url: string, init?: RequestInit) => {
        seen.value = { url, body: JSON.parse(String(init?.body)) };
        return Promise.resolve(
          new Response(JSON.stringify({ digitalStoreId: "s", auditEventId: "a" }), { status: 201 }),
        );
      }) as unknown as typeof fetch,
    });
    await client.createStore({
      tenantId: TENANT,
      storeCode: " new-store ",
      name: " New Store ",
      primaryVerticalCode: "LAUNDRY",
      reason: " onboarding ",
      grantExistingPartnerStaff: false,
      firstLocation: {
        locationCode: "BKK1",
        name: "BKK 1",
        addressLine1: "  ",
        city: "Phnom Penh",
      },
      secondApproverRef: "  ",
    });
    expect(seen.value?.url).toBe("https://api.example/management/v1/digital-stores");
    expect(seen.value?.body).toEqual({
      tenantId: TENANT,
      storeCode: "new-store",
      name: "New Store",
      primaryVerticalCode: "LAUNDRY",
      reason: "onboarding",
      grantExistingPartnerStaff: false,
      firstLocation: { locationCode: "BKK1", name: "BKK 1", city: "Phnom Penh" },
    });
    expect(seen.value?.body).not.toHaveProperty("secondApproverRef");
  });

  it("omits the Location entirely when either half is blank", async () => {
    let body: Record<string, unknown> = {};
    const client = createManagementClient({
      baseUrl: "https://api.example",
      accessToken: async () => "tok",
      fetchImpl: ((_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(new Response("{}", { status: 201 }));
      }) as unknown as typeof fetch,
    });
    await client.createStore({
      tenantId: TENANT,
      storeCode: "A-1",
      name: "n",
      primaryVerticalCode: "LAUNDRY",
      reason: "r",
      grantExistingPartnerStaff: true,
      firstLocation: { locationCode: "X", name: "" },
    });
    expect(body).not.toHaveProperty("firstLocation");
    expect(body.grantExistingPartnerStaff).toBe(true);
  });
});

describe("the create view", () => {
  it("starts disabled, hides the second approver in development, marks a roadmap vertical", () => {
    const html = renderToString(
      <StoreCreateView
        locale="en-US"
        options={OPTIONS}
        canCreate
        busy={false}
        notice={null}
        onCreate={noop}
      />,
    );
    expect(html).toContain('aria-label="create-store"');
    expect(html).toMatch(/<button type="submit" disabled/);
    expect(html).not.toContain('name="secondApproverRef"');
    expect(html).toContain("Grocery — not available in this phase");
    expect(html).toContain('data-partner-staff="1"');
    expect(html).toContain("DEMO-KH-001 — Demo Partner (APPROVED)");
  });

  it("asks for a second approver when the server says so", () => {
    const html = renderToString(
      <StoreCreateView
        locale="en-US"
        options={{ ...OPTIONS, fourEyesRequired: true }}
        canCreate
        busy={false}
        notice={null}
        onCreate={noop}
      />,
    );
    expect(html).toContain('name="secondApproverRef"');
  });

  it("shows a refusal verbatim and a creation with its audit id", () => {
    const refused = renderToString(
      <StoreCreateView
        locale="en-US"
        options={OPTIONS}
        canCreate
        busy={false}
        notice={{
          kind: "refused",
          reason: "KLUY-STORE-CODE-TAKEN",
          message: "This Tenant already has a Store with that code.",
        }}
        onCreate={noop}
      />,
    );
    expect(refused).toContain('data-store-refused="KLUY-STORE-CODE-TAKEN"');
    expect(refused).toContain("already has a Store");
    const created = renderToString(
      <StoreCreateView
        locale="km-KH"
        options={OPTIONS}
        canCreate
        busy={false}
        notice={{
          kind: "created",
          result: {
            digitalStoreId: "s-1",
            storeCode: "A-1",
            name: "n",
            status: "DRAFT",
            storeLocationId: null,
            partnerStaffGranted: 1,
            auditEventId: "audit-9",
            detail: "Digital Store created in DRAFT.",
          },
        }}
        onCreate={noop}
      />,
    );
    expect(created).toContain('data-store-created="s-1"');
    expect(created).toContain("audit-9");
    expect(created).toContain(MESSAGES["km-KH"].storeCreatedDone);
    expect(created).toContain('href="#/stores"');
  });

  it("shows no form to an Admin without the permission", () => {
    const html = renderToString(
      <StoreCreateView
        locale="en-US"
        options={OPTIONS}
        canCreate={false}
        busy={false}
        notice={null}
        onCreate={noop}
      />,
    );
    expect(html).not.toContain('aria-label="create-store"');
    expect(html).toContain('data-notice="storeCreateNotPermitted"');
  });
});

describe("the Stores list", () => {
  const page: StoreListPage = {
    stores: [
      {
        digitalStoreId: "s",
        storeCode: "DEMO-LAUNDRY-001",
        name: "Demo Laundry",
        primaryVerticalCode: "LAUNDRY",
        status: "DRAFT",
        tenantId: TENANT,
        tenantReference: "DEMO-KH-001 — Demo Partner",
        locations: [
          {
            storeLocationId: "l",
            locationCode: "BKK1",
            name: "Boeung Keng Kang 1",
            operatingStatus: "PLANNED",
          },
        ],
        createdAt: "2026-09-04T09:00:00Z",
      },
    ],
    count: 1,
    limit: 200,
    truncated: false,
  };
  it("renders codes and statuses verbatim, and the empty state", () => {
    const html = renderToString(<StoreListView locale="en-US" page={page} />);
    expect(html).toContain("DEMO-LAUNDRY-001");
    expect(html).toContain('data-store-status="DRAFT"');
    expect(html).toContain("BKK1 — Boeung Keng Kang 1 (PLANNED)");
    const empty = renderToString(
      <StoreListView locale="en-US" page={{ ...page, stores: [], count: 0 }} />,
    );
    expect(empty).toContain('data-surface-state="empty"');
  });
});
