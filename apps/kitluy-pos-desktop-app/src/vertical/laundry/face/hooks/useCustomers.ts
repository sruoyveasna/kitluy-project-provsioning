/**
 * Customer lookup and creation over the face ports (WS-12-T002 intake).
 *
 * PROVENANCE: replaces the donor's `src/hooks/useCustomers.ts` (react-query
 * over Supabase RPCs / fixtures — REJECTED). The Store Hub searches by PHONE
 * only and answers masked numbers; there is no "recent customers" list and no
 * name search on a terminal, so this hook offers neither.
 *
 * Truth rule (T002 §6): `unavailable` is never shown as "no customer found".
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppState } from "@face/app/useAppState";
import { normalizePhoneSearch } from "@face/lib/phone";
import type { IntakeResult } from "@face/ports";
import type { Customer, PreferredLanguage } from "@face/types";

export type CustomerSearchState =
  | { readonly status: "idle" }
  | { readonly status: "too_short" }
  | { readonly status: "searching" }
  | { readonly status: "found"; readonly customers: readonly Customer[] }
  | { readonly status: "none" }
  | { readonly status: "failed"; readonly kind: string; readonly detail: string };

/** Digits the Hub can match on: at least a national number's worth. */
export const PHONE_SEARCH_MIN_DIGITS = 6 as const;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Searches the Store Hub by phone once the typed digits settle. */
export function useSearchCustomers(term: string): CustomerSearchState {
  const { ports } = useAppState();
  const digits = normalizePhoneSearch(term).replace(/\D/g, "");
  const debounced = useDebouncedValue(digits, 300);
  const [state, setState] = useState<CustomerSearchState>({ status: "idle" });
  const seq = useRef(0);

  useEffect(() => {
    if (debounced.length === 0) {
      setState({ status: "idle" });
      return;
    }
    if (debounced.length < PHONE_SEARCH_MIN_DIGITS) {
      setState({ status: "too_short" });
      return;
    }
    const mine = ++seq.current;
    setState({ status: "searching" });
    void ports.searchCustomersByPhone(debounced).then((r) => {
      if (mine !== seq.current) return;
      if (!r.ok) {
        setState({ status: "failed", kind: r.kind, detail: r.detail });
        return;
      }
      setState(r.value.length === 0 ? { status: "none" } : { status: "found", customers: r.value });
    });
  }, [debounced, ports]);

  // Typing more digits before the debounce settles: show "searching", not a stale list.
  if (digits !== debounced && digits.length >= PHONE_SEARCH_MIN_DIGITS) {
    return { status: "searching" };
  }
  return state;
}

export interface CreateCustomerInput {
  readonly displayName: string;
  readonly phone: string | null;
  readonly preferredLanguage: PreferredLanguage;
}

/** One in-flight creation at a time; the verdict is the Hub's. */
export function useCreateCustomer(): {
  readonly create: (input: CreateCustomerInput) => Promise<IntakeResult<Customer>>;
  readonly pending: boolean;
} {
  const { ports } = useAppState();
  const [pending, setPending] = useState(false);
  const create = useCallback(
    async (input: CreateCustomerInput) => {
      setPending(true);
      try {
        return await ports.createCustomer(input);
      } finally {
        setPending(false);
      }
    },
    [ports],
  );
  return { create, pending };
}
