/**
 * The Service catalog as the runtime can answer it.
 *
 * PROVENANCE: replaces the donor's `useLaundryCatalog` / `useWfKgOffering`
 * (react-query over Supabase, fixture fallback `FIXTURE_LAUNDRY_CATALOG` and a
 * hard-coded 4 000 KHR/kg — REJECTED). No fixture is consulted here: while the
 * Store Hub delivers no catalog, the answer is `not_delivered` and the Items
 * step shows that state. Pricing truth stays with WS-05 and its signed
 * configuration snapshots (WS-12 task register §2).
 */
import { useEffect, useState } from "react";

import { useAppState } from "@face/app/useAppState";
import type { CatalogAnswer } from "@face/ports";

export type CatalogState = { readonly status: "loading" } | CatalogAnswer;

export function useLaundryCatalog(): CatalogState {
  const { ports } = useAppState();
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  useEffect(() => {
    let disposed = false;
    void ports.readCatalog().then((answer) => {
      if (!disposed) setState(answer);
    });
    return () => {
      disposed = true;
    };
  }, [ports]);
  return state;
}
