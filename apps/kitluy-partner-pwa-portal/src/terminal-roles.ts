/**
 * The terminal role vocabulary a Partner may choose from, and the checks on
 * what they typed.
 *
 * The KEYS come from the vertical package — `laundry.t1.intake_cashier` and its
 * siblings are owner-locked there — and are offered only when the API reports
 * the Store's vertical as laundry. The LABELS are this app's messages. A key the
 * app does not recognise on an existing terminal is shown verbatim, never
 * coerced: the same rule the vertical applies to retired identifiers.
 */
import {
  isLaundryTerminalProfile,
  LAUNDRY_TERMINAL_PROFILES,
  type LaundryTerminalProfile,
} from "@kitluy-verticals/phase1-laundry";

import type { MessageKey } from "./messages.js";

export interface RoleOption {
  readonly key: string;
  readonly labelKey: MessageKey;
  /** `T1` … `T4`, the short form staff say aloud. */
  readonly short: string;
}

export type RoleVocabulary =
  | { readonly kind: "offered"; readonly roles: readonly RoleOption[] }
  /** The API did not report the Store's vertical. Nothing is offered. */
  | { readonly kind: "unreported" }
  /** A vertical this portal has no terminal vocabulary for yet. */
  | { readonly kind: "unsupported"; readonly vertical: string };

const LAUNDRY_ROLE_LABEL: Readonly<Record<LaundryTerminalProfile, MessageKey>> = {
  "laundry.t1.intake_cashier": "roleLaundryT1",
  "laundry.t2.customer_display": "roleLaundryT2",
  "laundry.t3.ready_scan_in": "roleLaundryT3",
  "laundry.t4.pickup_scan_out": "roleLaundryT4",
};

export function roleShortCode(key: string): string | null {
  const match = /^[a-z0-9_]+\.(t[1-9][0-9]*)\./.exec(key);
  return match?.[1] === undefined ? null : match[1].toUpperCase();
}

export function roleVocabulary(vertical: string | null | undefined): RoleVocabulary {
  if (vertical === undefined || vertical === null || vertical.trim() === "") {
    return { kind: "unreported" };
  }
  if (vertical.trim().toLowerCase() === "laundry") {
    return {
      kind: "offered",
      roles: LAUNDRY_TERMINAL_PROFILES.map((key) => ({
        key,
        labelKey: LAUNDRY_ROLE_LABEL[key],
        short: roleShortCode(key) ?? key,
      })),
    };
  }
  return { kind: "unsupported", vertical };
}

/** The name is optional (owner clarification 2026-09-04); only its length is checked. */
export function validateTerminalLabel(label: string): "labelTooLong" | null {
  return label.trim().length > 64 ? "labelTooLong" : null;
}

export function validateTerminalRoles(
  keys: readonly string[],
  vocabulary: RoleVocabulary,
): "rolesRequired" | "roleUnknown" | null {
  if (keys.length === 0) return "rolesRequired";
  if (vocabulary.kind !== "offered") return "roleUnknown";
  for (const key of keys) {
    if (!isLaundryTerminalProfile(key) || !vocabulary.roles.some((r) => r.key === key)) {
      return "roleUnknown";
    }
  }
  return null;
}
