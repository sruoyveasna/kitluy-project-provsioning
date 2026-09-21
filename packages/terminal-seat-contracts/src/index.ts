/**
 * @kitluy/terminal-seat-contracts — TERMINAL-APPLICATION-ASSIGNMENT-001.
 *
 * Terminal Seat -> application assignment -> allowed surfaces, as contracts.
 * Neutral Core: no vertical vocabulary. See each module's header for authority
 * and the fail-closed rules it enforces.
 *
 * STATUS: IMPLEMENTED-IN-DEV (contracts + unit tests). Integration into the
 * signed configuration delivery, the Hub, the device shell and the Partner
 * Portal is recorded separately in the handoff — this package's status does
 * not imply theirs (CLAUDE.md hard rule 5).
 */
export const PACKAGE_NAME = "@kitluy/terminal-seat-contracts" as const;

export * from "./application-identifier.js";
export * from "./allowed-surfaces.js";
export * from "./terminal-seat.js";
export * from "./desired-vs-actual.js";
