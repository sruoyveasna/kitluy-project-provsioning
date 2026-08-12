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
  readonly terminalAssignmentCount: number;
  readonly openIncidentCount: number;
  readonly lastSeenAt: string | null;
  readonly fleetStatus: string | null;
  readonly freshness: string;
  readonly requiresAttention: boolean;
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

export interface DeviceDetail {
  readonly device: FleetDeviceView;
  readonly provisioning: { readonly eligible: boolean; readonly reasons: readonly string[] };
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

  if (status === 200) return { kind: "ok", value: body };
  if (status === 401) return { kind: "unauthenticated", reason };
  if (status === 403) return { kind: "denied", reason, message };
  if (status === 404) return { kind: "not_found" };
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
      if (response.status === 200) {
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
  };
}
