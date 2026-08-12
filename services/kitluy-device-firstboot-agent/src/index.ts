/**
 * @kitluy-services/kitluy-device-firstboot-agent
 *
 * The KitLuy OS firstboot identity bootstrap and cloud enrollment agent. Runs
 * on BOTH image profiles (STORE_HUB and PI_TERMINAL) — a Hub and a terminal
 * are the same platform with different roles, and enrollment is the part they
 * share.
 *
 * STATUS: IMPLEMENTED-IN-DEV (logic and state machine, executed under vitest).
 * NOT hardware-proven: no Raspberry Pi has run this. The systemd units that
 * would invoke it are staged by infra/kitluy-os-image but the executables they
 * reference are not yet built, and that gap is recorded rather than described
 * as done.
 *
 * Composition boundary: this agent OWNS no truth. Tenant, Digital Store,
 * Location, Store Hub, terminal profile, lifecycle state and configuration
 * version are all server-derived and arrive through governed contracts.
 */

export { SERVICE_NAME, SERVICE_VERSION } from "./version.js";

export * from "./identity.js";
export * from "./enrollment.js";
export * from "./factory.js";
export * from "./factory-gateway.js";
