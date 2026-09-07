/**
 * Digital Store creation and listing — the Admin's half of owner decision
 * v2.0.0 §2: the Admin creates the Store, assigns the Tenant, sets the
 * vertical, creates the first Location; the Partner never creates one.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §2, §16; migration group
 * 0215 (the door, the permission, the audit row).
 *
 * The same pattern as `device-approval.ts`: authority is decided by
 * `authorizeRequest` against the human's permissions BEFORE this module runs;
 * the door is reached as `service_role` inside one transaction; a governed
 * refusal is mapped to operator text and never echoes a SQLSTATE.
 */
import type pg from "pg";

import type { DatabaseHandle } from "./authorization.js";

export interface DigitalStoreDeps {
  readonly pool: pg.Pool;
}

export interface CreateDigitalStoreInput {
  readonly tenantId: string;
  readonly storeCode: string;
  readonly name: string;
  readonly primaryVerticalCode: string;
  readonly firstLocation?: {
    readonly locationCode: string;
    readonly name: string;
    readonly addressLine1?: string;
    readonly city?: string;
  };
  readonly actorUserId: string;
  readonly reason: string;
  readonly environment: string;
  readonly grantExistingPartnerStaff: boolean;
  readonly secondApproverRef?: string;
}

export type CreateDigitalStoreResult =
  | {
      readonly kind: "created";
      readonly digitalStoreId: string;
      readonly storeCode: string;
      readonly name: string;
      readonly primaryVerticalCode: string;
      readonly status: string;
      readonly storeLocationId: string | null;
      readonly locationCode: string | null;
      readonly partnerStaffGranted: number;
      readonly auditEventId: string;
    }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "KLUY-STORE-NO-ACTOR": "The Admin creating the Store could not be identified.",
  "KLUY-STORE-NO-REASON": "A reason is required to create a Digital Store.",
  "KLUY-STORE-ENVIRONMENT": "The environment must be named.",
  "KLUY-STORE-FOUR-EYES-REQUIRED":
    "This environment requires a second, different approver before a Store may be created.",
  "KLUY-STORE-FOUR-EYES-SAME-ACTOR": "The second approver must be a different person.",
  "KLUY-STORE-NO-TENANT": "No such Tenant.",
  "KLUY-STORE-TENANT-NOT-OPEN": "That Tenant is not open; a Store cannot be created under it.",
  "KLUY-STORE-CODE-SHAPE": "A store code is 3 to 40 characters of A-Z, 0-9 and hyphens.",
  "KLUY-STORE-NAME-EMPTY": "A Store name is 1 to 120 characters.",
  "KLUY-STORE-VERTICAL-UNKNOWN": "That is not a registered business vertical.",
  "KLUY-STORE-VERTICAL-NOT-ACTIVE": "That business vertical is not available in this phase.",
  "KLUY-STORE-LOCATION-SHAPE":
    "The first Location needs a code (2 to 40 characters of A-Z, 0-9 and hyphens) and a name.",
  "KLUY-STORE-CODE-TAKEN": "This Tenant already has a Store with that code.",
};

function refusalCode(message: string): string | null {
  const match = /^(KLUY-[A-Z0-9-]+):/.exec(message);
  return match?.[1] ?? null;
}

export async function createDigitalStore(
  deps: DigitalStoreDeps,
  input: CreateDigitalStoreInput,
): Promise<CreateDigitalStoreResult> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const { rows } = await client.query<{ result: Record<string, unknown> }>(
      `select kitluy_core.create_digital_store_v1(
                $1::uuid, $2, $3, $4, $5::jsonb, $6::uuid, $7, $8, $9::boolean, $10) as result`,
      [
        input.tenantId,
        input.storeCode,
        input.name,
        input.primaryVerticalCode,
        input.firstLocation === undefined
          ? null
          : JSON.stringify({
              location_code: input.firstLocation.locationCode,
              name: input.firstLocation.name,
              ...(input.firstLocation.addressLine1 === undefined
                ? {}
                : { address_line1: input.firstLocation.addressLine1 }),
              ...(input.firstLocation.city === undefined ? {} : { city: input.firstLocation.city }),
            }),
        input.actorUserId,
        input.reason,
        input.environment,
        input.grantExistingPartnerStaff,
        input.secondApproverRef ?? null,
      ],
    );
    await client.query("commit");
    const r = rows[0]?.result ?? {};
    const id = r.digital_store_id;
    const audit = r.audit_event_id;
    if (r.outcome !== "CREATED" || typeof id !== "string" || typeof audit !== "string") {
      return {
        kind: "refused",
        code: "KLUY-STORE-NOT-CREATED",
        detail: "The Store was not created.",
      };
    }
    return {
      kind: "created",
      digitalStoreId: id,
      storeCode: String(r.store_code ?? ""),
      name: String(r.name ?? ""),
      primaryVerticalCode: String(r.primary_vertical_code ?? ""),
      status: String(r.status ?? "DRAFT"),
      storeLocationId: typeof r.store_location_id === "string" ? r.store_location_id : null,
      locationCode: typeof r.location_code === "string" ? r.location_code : null,
      partnerStaffGranted: Number(r.partner_staff_granted ?? 0),
      auditEventId: audit,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* the connection is already unusable; the pool will discard it */
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = refusalCode(message);
    if (code !== null) {
      return {
        kind: "refused",
        code,
        detail: REFUSAL_MESSAGES[code] ?? "This Store could not be created.",
      };
    }
    throw error;
  } finally {
    client.release();
  }
}

export interface DigitalStoreDto {
  readonly digitalStoreId: string;
  readonly storeCode: string;
  readonly name: string;
  readonly primaryVerticalCode: string;
  readonly status: string;
  readonly tenantId: string;
  readonly tenantReference: string;
  readonly locations: readonly {
    readonly storeLocationId: string;
    readonly locationCode: string;
    readonly name: string;
    readonly operatingStatus: string;
  }[];
  readonly createdAt: string;
}

/** Every Store, for an Admin, with its Tenant in words. Trusted identity after `partners.read`. */
export async function listDigitalStores(
  db: DatabaseHandle,
  options: { readonly limit?: number } = {},
): Promise<readonly DigitalStoreDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const { rows } = await db.query<{
    id: string;
    store_code: string;
    name: string;
    primary_vertical_code: string;
    status: string;
    tenant_id: string;
    tenant_reference: string;
    created_at: Date | string;
    locations:
      | { storeLocationId: string; locationCode: string; name: string; operatingStatus: string }[]
      | null;
  }>(
    `select ds.id, ds.store_code, ds.name, ds.primary_vertical_code, ds.status, ds.tenant_id,
            t.tenant_code || ' — ' || coalesce(t.display_name, t.legal_name) as tenant_reference,
            ds.created_at,
            coalesce((select jsonb_agg(jsonb_build_object(
                        'storeLocationId', sl.id, 'locationCode', sl.location_code,
                        'name', sl.name, 'operatingStatus', sl.operating_status)
                        order by sl.location_code)
                        from kitluy_core.store_locations sl where sl.digital_store_id = ds.id),
                     '[]'::jsonb) as locations
       from kitluy_core.digital_stores ds
       join kitluy_core.tenants t on t.id = ds.tenant_id
      order by t.tenant_code, ds.store_code
      limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    digitalStoreId: r.id,
    storeCode: r.store_code,
    name: r.name,
    primaryVerticalCode: r.primary_vertical_code,
    status: r.status,
    tenantId: r.tenant_id,
    tenantReference: r.tenant_reference,
    locations: r.locations ?? [],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export interface StoreCreationOptions {
  readonly tenants: readonly {
    readonly tenantId: string;
    readonly tenantCode: string;
    readonly displayName: string;
    readonly status: string;
    readonly partnerVerificationStatus: string | null;
    /** Live DIGITAL_STORE_STAFF assignments already scoped to a Store of this Tenant. */
    readonly partnerStaffCount: number;
  }[];
  readonly verticals: readonly {
    readonly code: string;
    readonly status: string;
    readonly labels: { readonly "km-KH": string | null; readonly "en-US": string | null };
  }[];
}

/** What the create form needs: Tenants and the vertical registry, verbatim. */
export async function listStoreCreationOptions(db: DatabaseHandle): Promise<StoreCreationOptions> {
  const { rows: tenants } = await db.query<{
    id: string;
    tenant_code: string;
    display_name: string;
    status: string;
    verification_status: string | null;
    partner_staff_count: string | number;
  }>(
    `select t.id, t.tenant_code, coalesce(t.display_name, t.legal_name) as display_name, t.status,
            pa.verification_status,
            (select count(distinct ra.id)
               from kitluy_auth.role_assignments ra
               join kitluy_auth.role_templates rt on rt.id = ra.role_template_id and rt.role_key = 'DIGITAL_STORE_STAFF'
               join kitluy_auth.assignment_scopes s on s.role_assignment_id = ra.id and s.scope_type = 'digital_store'
               join kitluy_core.digital_stores ds on ds.id = s.scope_id and ds.tenant_id = t.id
              where ra.status = 'ACTIVE' and ra.valid_from <= now()
                and (ra.valid_to is null or ra.valid_to > now())) as partner_staff_count
       from kitluy_core.tenants t
       left join kitluy_core.partner_accounts pa on pa.tenant_id = t.id
      order by t.tenant_code`,
  );
  const { rows: verticals } = await db.query<{
    value_code: string;
    status: string;
    label_km: string | null;
    label_en: string | null;
  }>(
    `select rv.value_code, rv.status,
            (select tr.label from kitluy_core.reference_value_translations tr
              where tr.reference_value_id = rv.id and tr.locale = 'km-KH' limit 1) as label_km,
            (select tr.label from kitluy_core.reference_value_translations tr
              where tr.reference_value_id = rv.id and tr.locale = 'en-US' limit 1) as label_en
       from kitluy_core.reference_values rv
      where rv.registry_key = 'vertical_code'
      order by rv.sort_order, rv.value_code`,
  );
  return {
    tenants: tenants.map((t) => ({
      tenantId: t.id,
      tenantCode: t.tenant_code,
      displayName: t.display_name,
      status: t.status,
      partnerVerificationStatus: t.verification_status,
      partnerStaffCount: Number(t.partner_staff_count ?? 0),
    })),
    verticals: verticals.map((v) => ({
      code: v.value_code,
      status: v.status,
      labels: { "km-KH": v.label_km, "en-US": v.label_en },
    })),
  };
}
