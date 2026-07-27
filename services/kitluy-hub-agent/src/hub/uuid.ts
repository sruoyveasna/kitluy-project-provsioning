/**
 * Application-generated UUIDv7 identifiers.
 *
 * Schema contract §1 "Identifiers": "Application-generated UUIDv7, column type
 * `uuid`". Every Hub-local primary key is supplied by the agent — the DDL
 * declares no server-side default (hub/migrations/0000 header) — so the
 * generator lives here rather than in the database.
 *
 * RFC 9562 §5.7 layout: 48-bit big-endian Unix milliseconds, 4-bit version 7,
 * 12 bits of randomness, 2-bit variant 0b10, 62 bits of randomness. Monotonic
 * within a millisecond is NOT claimed; ordering truth is `hub_sequence`
 * (offline contract §5), not the identifier.
 */
import { randomBytes } from "node:crypto";

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 0b10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
