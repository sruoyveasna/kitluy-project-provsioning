/**
 * Presentation lanes of the catalog — colours, emoji and short labels.
 *
 * PROVENANCE: donor `src/lib/serviceCatalog.ts` (kitluy-laundry-pos-desk-app@
 * 8b2f107), re-keyed from the donor's product trio to the two canonical
 * pricing modes (WS-05): `wf` = per weight, `pp` = per piece. A service's NAME
 * always comes from the delivered catalog; only the lane chrome lives here.
 */
import type { ReactNode } from "react";

import { I } from "@face/components/common/icons";
import { C } from "@face/styles/tokens";
import type { ServiceType } from "@face/types";

export const SERVICE_TYPES = ["wf", "pp"] as const satisfies readonly ServiceType[];

export const serviceLabel = (svc: ServiceType): string =>
  svc === "wf" ? "Per kilogram" : "Per piece";

export const serviceLabelShort = (svc: ServiceType): string => (svc === "wf" ? "kg" : "pc");

/** The lane's icon as an SVG — a Pi Terminal has no emoji font. */
export const serviceIcon = (svc: ServiceType, size = 22): ReactNode =>
  svc === "wf" ? <I.Basket s={size} c="currentColor" /> : <I.Shirt s={size} c="currentColor" />;

export const serviceColor = (svc: ServiceType): string => (svc === "wf" ? C.primary : C.purple);

export const serviceSoftBg = (svc: ServiceType): string =>
  svc === "wf" ? C.primarySoft : C.purpleLight;
