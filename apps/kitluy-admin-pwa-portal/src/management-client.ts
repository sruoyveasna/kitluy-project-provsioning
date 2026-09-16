/**
 * Browser client for the governed Management API.
 *
 * ===========================================================================
 * WHY THE PORTAL DOES NOT READ DEVICES DIRECTLY
 * ===========================================================================
 * OD-ADMIN-FLEET-001 keeps `kitluy_devices` CLOSED to browsers, and the schema
 * is not exposed to the data API at all. A device read therefore has exactly
 * one path: this client, carrying the signed-in Admin's own access token, to a
 * service that re-derives authority from the database for every request.
 *
 * The token is attached per call and never stored here. Session storage belongs
 * to the auth client; a second copy would be a second thing to invalidate on
 * sign-out, and the copy is the one that gets forgotten.
 */

/** Every outcome the UI must be able to tell apart. */
export type ManagementOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 401 — the session is absent, expired or revoked. Sign in again. */
  | { readonly kind: "unauthenticated"; readonly reason: string }
  /** 403 — authenticated, but refused. `reason` says which refusal. */
  | { readonly kind: "denied"; readonly reason: string; readonly message: string }
  | { readonly kind: "not_found" }
  /**
   * 422 — the caller HELD the permission and the request was well-formed, but the
   * governed door refused the action. Distinct from `denied` on purpose: "you may
   * not do this" and "this device is not in a state where this can be done" are
   * different sentences, and a portal that showed the first for the second would
   * send an Admin to ask for access they already have.
   */
  | { readonly kind: "refused"; readonly reason: string; readonly message: string }
  /** Network failure, 5xx, or a body that is not the agreed shape. */
  | { readonly kind: "unavailable"; readonly detail: string };

export interface FleetDeviceView {
  readonly deviceId: string;
  readonly deviceReference: string;
  readonly deviceClass: string;
  readonly hardwareProfile: string | null;
  readonly lifecycle: string;
  readonly trustLevel: string | null;
  readonly certificateStatus: string | null;
  readonly assignmentState: string | null;
  readonly tenantReference: string | null;
  readonly digitalStoreReference: string | null;
  readonly locationReference: string | null;
  /** `store_code — name`, the human label; null when unassigned or unknown. */
  readonly digitalStoreLabel: string | null;
  /** `location_code — name`; null when unassigned or unknown. */
  readonly locationLabel: string | null;
  readonly terminalAssignmentCount: number;
  readonly openIncidentCount: number;
  readonly lastSeenAt: string | null;
  readonly fleetStatus: string | null;
  readonly freshness: string;
  readonly requiresAttention: boolean;
}

/**
 * One pending board as the verifier sees it.
 *
 * Every `claimed*` field is SELF-REPORTED by the device and is named that way on
 * purpose (plan §4.4): the Admin is verifying hardware, not reading facts the
 * system already knows.
 */
export interface PendingRegistrationView {
  readonly deviceId: string;
  readonly deviceReference: string;
  readonly deviceClass: string;
  readonly hardwareProfile: string | null;
  readonly lifecycle: string;
  readonly trustLevel: string | null;
  readonly reportedHostname: string | null;
  readonly claimedBoardSerial: string | null;
  readonly claimedSocSerial: string | null;
  readonly claimedMacAddress: string | null;
  readonly installationGeneration: number | null;
  readonly imageRelease: string | null;
  readonly registrationKeyFingerprint: string | null;
  readonly enrollmentSequence: number | null;
  readonly firstSeenAt: string | null;
  readonly lastRegistrationAt: string | null;
  /** The 60s registration beat; the board is in this list because it is answering. */
  readonly lastSeenAt: string | null;
  readonly openIncidents: readonly {
    readonly incidentType: string;
    readonly severity: string;
    readonly detectedAt: string;
    readonly detail: string | null;
  }[];
  readonly suspectedCredentialReuse: boolean;
  readonly approvable: boolean;
  readonly blockingReasons: readonly string[];
}

export interface PendingPage {
  readonly pending: readonly PendingRegistrationView[];
  readonly count: number;
  readonly limit: number;
  readonly truncated: boolean;
  /** Told by the server so the form can require a second approver by environment. */
  readonly fourEyesRequired: boolean;
  readonly dataAsOf?: string;
}

export interface ApprovalRequest {
  readonly reason: string;
  readonly verificationEvidenceRef: string;
  readonly secondApproverRef?: string;
}

export interface ApprovalResult {
  readonly deviceId: string;
  readonly lifecycleState: string;
  readonly detail: string;
}

export interface CurrentAdmin {
  readonly userId: string;
  readonly permissions: readonly string[];
}

export interface FleetPage {
  readonly devices: readonly FleetDeviceView[];
  readonly count: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly freshnessPolicyRuled: boolean;
  readonly dataAsOf?: string;
}

export interface StoreLocationView {
  readonly storeLocationId: string;
  readonly locationCode: string;
  readonly name: string;
  readonly operatingStatus: string;
}

export interface DigitalStoreView {
  readonly digitalStoreId: string;
  readonly storeCode: string;
  readonly name: string;
  readonly primaryVerticalCode: string;
  readonly status: string;
  readonly tenantId: string;
  readonly tenantReference: string;
  readonly locations: readonly StoreLocationView[];
  readonly createdAt: string;
}

export interface StoreListPage {
  readonly stores: readonly DigitalStoreView[];
  readonly count: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly dataAsOf?: string;
}

export interface TenantOption {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly displayName: string;
  readonly status: string;
  readonly partnerVerificationStatus: string | null;
  readonly partnerStaffCount: number;
}

export interface VerticalOption {
  readonly code: string;
  readonly status: string;
  readonly labels: { readonly "km-KH": string | null; readonly "en-US": string | null };
}

export interface StoreCreationOptions {
  readonly tenants: readonly TenantOption[];
  readonly verticals: readonly VerticalOption[];
  /** Told by the server so the form never hardcodes an environment rule. */
  readonly fourEyesRequired: boolean;
  readonly dataAsOf?: string;
}

export interface CreateStoreRequest {
  readonly tenantId: string;
  readonly storeCode: string;
  readonly name: string;
  readonly primaryVerticalCode: string;
  readonly reason: string;
  readonly grantExistingPartnerStaff: boolean;
  readonly firstLocation?: {
    readonly locationCode: string;
    readonly name: string;
    readonly addressLine1?: string;
    readonly city?: string;
  };
  readonly secondApproverRef?: string;
}

export interface CreateStoreResult {
  readonly digitalStoreId: string;
  readonly storeCode: string;
  readonly name: string;
  readonly status: string;
  readonly storeLocationId: string | null;
  readonly partnerStaffGranted: number;
  readonly auditEventId: string;
  readonly detail: string;
}

/**
 * What the device needs in order to come back if its SD card were replaced now
 * (BOOT-RECOVERY-CLASSIFICATION-001). Decided server-side by the same contract a
 * device runs; the portal renders it and decides nothing.
 */
export interface DeviceRecovery {
  readonly classification: string;
  readonly reasonCode: string;
  readonly nextAction:
    | "NONE"
    | "WAIT"
    | "ENTER_PAIRING_CODE"
    | "RELEASE_DEVICE_THEN_PAIR"
    | "APPROVE_ENROLLMENT"
    | "REPLACE_DEVICE"
    | "INSERT_CORRECT_MEDIA"
    | "CONTACT_ADMIN"
    | "CONTACT_HET_SUPPORT";
  readonly userMessageKey: string;
  readonly message: string;
  readonly adminDetail: string;
  readonly basis: "freshly_flashed_card";
  readonly nextActionGap?: "RELEASE_ROUTE_NOT_AVAILABLE" | "REPLACE_ROUTE_NOT_AVAILABLE";
}

export interface DeviceDetail {
  readonly device: FleetDeviceView;
  readonly provisioning: { readonly eligible: boolean; readonly reasons: readonly string[] };
  /** Absent from an older API, null when the view is not configured there. */
  readonly recovery?: DeviceRecovery | null;
  readonly freshnessPolicyRuled: boolean;
  readonly dataAsOf?: string;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: { reason?: unknown } };
}

/**
 * Turn one HTTP response into an outcome.
 *
 * Separated from transport so the mapping is testable without a server, and so
 * an unexpected status can never fall through to "ok". Anything unrecognised
 * becomes `unavailable`: an operational portal must not present an unparsed
 * response as data.
 */
export function classifyResponse<T>(
  status: number,
  body: unknown,
): ManagementOutcome<T> | { kind: "ok"; value: unknown } {
  const errorBody = (body ?? {}) as ErrorBody;
  const reason =
    typeof errorBody.error?.details?.reason === "string"
      ? errorBody.error.details.reason
      : "UNSPECIFIED";
  const message =
    typeof errorBody.error?.message === "string" ? errorBody.error.message : "Access denied.";

  // Creates answer 201, as `/hub-pairing-codes` and `/digital-stores` do.
  if (status === 200 || status === 201) return { kind: "ok", value: body };
  if (status === 401) return { kind: "unauthenticated", reason };
  if (status === 403) return { kind: "denied", reason, message };
  if (status === 404) return { kind: "not_found" };
  // 422 carries an actionable refusal from a governed door. Falling through to
  // `unavailable` would replace "clear the open trust incident first" with "the
  // service answered 422", which tells an operator nothing they can act on.
  if (status === 422) return { kind: "refused", reason, message };
  return { kind: "unavailable", detail: `The service answered ${status}.` };
}

export interface ManagementClientOptions {
  readonly baseUrl: string;
  /** Resolves the CURRENT access token, or null when there is no session. */
  readonly accessToken: () => Promise<string | null>;
  readonly fetchImpl?: typeof fetch;
}

export interface ManagementClient {
  getCurrentAdmin(): Promise<ManagementOutcome<CurrentAdmin>>;
  listDevices(): Promise<ManagementOutcome<FleetPage>>;
  getDevice(deviceId: string): Promise<ManagementOutcome<DeviceDetail>>;
  listPendingRegistrations(): Promise<ManagementOutcome<PendingPage>>;
  approveEnrollment(
    deviceId: string,
    input: ApprovalRequest,
  ): Promise<ManagementOutcome<ApprovalResult>>;
  listStores(): Promise<ManagementOutcome<StoreListPage>>;
  getStoreCreationOptions(): Promise<ManagementOutcome<StoreCreationOptions>>;
  createStore(input: CreateStoreRequest): Promise<ManagementOutcome<CreateStoreResult>>;
}

export function createManagementClient(options: ManagementClientOptions): ManagementClient {
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string): Promise<ManagementOutcome<T>> {
    const token = await options.accessToken();
    if (token === null) {
      // No round trip: there is nothing to authenticate with.
      return { kind: "unauthenticated", reason: "KLUY-AUTH-MISSING-TOKEN" };
    }

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}/management/v1${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch {
      // The message is deliberately not the raw error: a fetch failure text is
      // browser-specific noise, and the operator's next action is the same.
      return { kind: "unavailable", detail: "The management service could not be reached." };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.status === 200 || response.status === 201) {
        return {
          kind: "unavailable",
          detail: "The management service returned an unusable reply.",
        };
      }
    }

    return classifyResponse<T>(response.status, body) as ManagementOutcome<T>;
  }

  /**
   * A mutation. Separate from `request` rather than a flag on it, because a
   * function that can send a body is a function that can send one by accident on
   * a read — and every other route on this surface must stay a GET.
   */
  async function post<T>(path: string, payload: unknown): Promise<ManagementOutcome<T>> {
    const token = await options.accessToken();
    if (token === null) {
      return { kind: "unauthenticated", reason: "KLUY-AUTH-MISSING-TOKEN" };
    }

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}/management/v1${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return { kind: "unavailable", detail: "The management service could not be reached." };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.status === 200 || response.status === 201) {
        return {
          kind: "unavailable",
          detail: "The management service returned an unusable reply.",
        };
      }
    }

    return classifyResponse<T>(response.status, body) as ManagementOutcome<T>;
  }

  return {
    getCurrentAdmin: () => request<CurrentAdmin>("/me"),
    listDevices: () => request<FleetPage>("/devices"),
    getDevice: (deviceId: string) =>
      request<DeviceDetail>(`/devices/${encodeURIComponent(deviceId)}`),
    listPendingRegistrations: () => request<PendingPage>("/devices-pending"),
    approveEnrollment: (deviceId: string, input: ApprovalRequest) =>
      post<ApprovalResult>(`/devices/${encodeURIComponent(deviceId)}/approve-enrollment`, {
        reason: input.reason,
        verificationEvidenceRef: input.verificationEvidenceRef,
        // Omitted entirely when absent. Sending an empty string would look like a
        // blank second approver rather than the absence of one, and the door must
        // be able to tell those apart.
        ...(input.secondApproverRef !== undefined && input.secondApproverRef.trim() !== ""
          ? { secondApproverRef: input.secondApproverRef.trim() }
          : {}),
      }),
    listStores: () => request<StoreListPage>("/digital-stores"),
    getStoreCreationOptions: () => request<StoreCreationOptions>("/digital-stores/options"),
    // Optional members are OMITTED when blank, never sent as empty strings: the
    // route refuses what it does not understand, and "" is not a Location.
    createStore: (input: CreateStoreRequest) => {
      const loc = input.firstLocation;
      const firstLocation =
        loc === undefined || loc.locationCode.trim() === "" || loc.name.trim() === ""
          ? undefined
          : {
              locationCode: loc.locationCode.trim(),
              name: loc.name.trim(),
              ...(loc.addressLine1 !== undefined && loc.addressLine1.trim() !== ""
                ? { addressLine1: loc.addressLine1.trim() }
                : {}),
              ...(loc.city !== undefined && loc.city.trim() !== ""
                ? { city: loc.city.trim() }
                : {}),
            };
      return post<CreateStoreResult>("/digital-stores", {
        tenantId: input.tenantId,
        storeCode: input.storeCode.trim(),
        name: input.name.trim(),
        primaryVerticalCode: input.primaryVerticalCode,
        reason: input.reason.trim(),
        grantExistingPartnerStaff: input.grantExistingPartnerStaff,
        ...(firstLocation === undefined ? {} : { firstLocation }),
        ...(input.secondApproverRef !== undefined && input.secondApproverRef.trim() !== ""
          ? { secondApproverRef: input.secondApproverRef.trim() }
          : {}),
      });
    },
  };
}
