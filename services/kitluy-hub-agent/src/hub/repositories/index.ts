/**
 * Hub repository adapters — thin, typed, no business logic.
 *
 * Namespaced re-export so a caller always names the schema it is touching
 * (`laundryRepo.appendCustodyEvent`, `paymentsRepo.insertPayment`, …). That
 * keeps the §2 schema boundaries legible at every call site and stops a
 * `edge_payments` write from hiding inside a Laundry code path.
 */
export * as auditRepo from "./audit.js";
export * as configRepo from "./config.js";
export * as documentsRepo from "./documents.js";
export * as filesRepo from "./files.js";
export * as identityRepo from "./identity.js";
export * as laundryRepo from "./laundry.js";
export * as paymentsRepo from "./payments.js";
export * as syncRepo from "./sync.js";
