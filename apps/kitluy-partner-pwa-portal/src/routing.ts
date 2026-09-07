/**
 * Hash routing for the Partner Portal.
 *
 * Hash routes rather than history routes, for the reason the Admin Portal
 * records: a static host that 404s on refresh is a failure mode worth designing
 * out. The Store id lives IN the hash — the Partner's "one active Digital Store
 * context" made reload-safe without browser storage, which the pairing code
 * must never touch.
 *
 *   #/                           → the first Store's Hub tab, once Stores load
 *   #/stores/{storeId}/hub       → Store Hub pairing (PRT-SCR-061)
 *   #/stores/{storeId}/terminals → Provisioning → Terminals (PRT-SCR-062)
 */
export type StoreTab = "hub" | "terminals";

export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "hub"; readonly storeId: string }
  | { readonly kind: "terminals"; readonly storeId: string }
  | { readonly kind: "unknown"; readonly path: string };

export const DEFAULT_ROUTE: Route = { kind: "home" };

/** A malformed escape must not blank the portal: pass the segment through. */
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
  if (segments.length === 3 && segments[0] === "stores") {
    const storeId = safeDecode(segments[1] ?? "");
    if (storeId !== "" && segments[2] === "hub") return { kind: "hub", storeId };
    if (storeId !== "" && segments[2] === "terminals") return { kind: "terminals", storeId };
  }
  return { kind: "unknown", path };
}

export function storeRoute(tab: StoreTab, storeId: string): Route {
  return tab === "hub" ? { kind: "hub", storeId } : { kind: "terminals", storeId };
}

export function routeHref(route: Route): string {
  switch (route.kind) {
    case "home":
      return "#/";
    case "hub":
      return `#/stores/${encodeURIComponent(route.storeId)}/hub`;
    case "terminals":
      return `#/stores/${encodeURIComponent(route.storeId)}/terminals`;
    case "unknown":
      return `#${route.path}`;
  }
}
