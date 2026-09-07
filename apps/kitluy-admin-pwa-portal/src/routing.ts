/**
 * Hash routing for the Admin Portal.
 *
 * Hash routes rather than history routes: a history router needs the serving
 * origin to rewrite unknown paths to `index.html`, and a control plane that
 * 404s on refresh because a static host was not configured is a failure mode
 * worth designing out rather than documenting.
 */
export type Route =
  | { readonly kind: "login" }
  | { readonly kind: "devices" }
  /** The verify-and-approve queue. A separate route because it is a separate
   * job: a person works through it with hardware in front of them. */
  | { readonly kind: "pending" }
  | { readonly kind: "device"; readonly deviceId: string }
  /** Digital Stores: the list, and the create screen (owner decision v2.0.0 §2). */
  | { readonly kind: "stores" }
  | { readonly kind: "store_new" }
  | { readonly kind: "unknown"; readonly path: string };

export const DEFAULT_ROUTE: Route = { kind: "devices" };

/**
 * `decodeURIComponent` throws on a malformed escape such as `%zz`, and the hash
 * is entirely user-controlled. A router that can throw takes the whole portal
 * down with a blank page, so an undecodable segment is passed through as typed
 * and simply fails to match a device.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parse `location.hash`. Total: any input yields a route, never an exception. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").split("?")[0] ?? "";
  const segments = path.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) return DEFAULT_ROUTE;
  if (segments.length === 1 && segments[0] === "login") return { kind: "login" };
  if (segments.length === 1 && segments[0] === "pending") return { kind: "pending" };
  if (segments[0] === "stores") {
    if (segments.length === 1) return { kind: "stores" };
    if (segments.length === 2 && segments[1] === "new") return { kind: "store_new" };
  }
  if (segments[0] === "devices") {
    if (segments.length === 1) return { kind: "devices" };
    if (segments.length === 2) {
      return { kind: "device", deviceId: safeDecode(segments[1] ?? "") };
    }
  }
  return { kind: "unknown", path };
}

export function routeHref(route: Route): string {
  switch (route.kind) {
    case "login":
      return "#/login";
    case "devices":
      return "#/devices";
    case "pending":
      return "#/pending";
    case "device":
      return `#/devices/${encodeURIComponent(route.deviceId)}`;
    case "stores":
      return "#/stores";
    case "store_new":
      return "#/stores/new";
    case "unknown":
      return `#${route.path}`;
  }
}
