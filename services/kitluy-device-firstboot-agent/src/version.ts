/**
 * Service identity, split out from `index.ts` deliberately.
 *
 * The device bootstrap runtime that ships in the golden image needs the version
 * string and nothing else from the package root. Importing `index.ts` for it
 * would drag in `factory.ts` and `factory-gateway.ts` — the MANUFACTURING
 * STATION path, which speaks to a database through a `DatabaseHandle` and
 * carries the governed refusal-code vocabulary.
 *
 * Shipping those to a Pi would be wrong twice over: a shop-floor appliance has
 * no business carrying the factory enrollment gateway, and that vocabulary
 * names privileged database roles, which the image zero-secret scanner
 * correctly refuses. The scanner caught this, and the fix is to ship less
 * rather than to loosen the scanner.
 */
export const SERVICE_NAME = "kitluy-device-firstboot-agent" as const;
export const SERVICE_VERSION = "0.1.0" as const;
