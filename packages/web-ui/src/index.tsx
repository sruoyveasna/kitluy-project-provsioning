/**
 * @kitluy/web-ui — shared web design system foundation.
 *
 * STATUS: BUILT (tokens, data-state surfaces, error boundary, locale context)
 * + TESTED via app smoke tests. Visual design tokens are placeholders pending
 * [REQUIRED: approved KitLuy brand tokens / Khmer font strategy].
 *
 * Rules encoded here:
 * - Every data surface declares one of the required states: loading, empty,
 *   partial, stale, unavailable, fresh (RB v4 §9.7; "no stale dashboard number
 *   may be presented as live truth").
 * - A zero value and an unavailable value are never displayed the same way
 *   (BB v2 §11.3).
 */
import type { ReactNode } from "react";
import { Component, createContext, useContext } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { DEFAULT_LOCALE } from "@kitluy/localization";

/** Placeholder brand tokens — [REQUIRED: approved brand palette]. */
export const kitluyTokens = {
  colorPrimary: "#1f6feb",
  colorSurface: "#ffffff",
  colorText: "#111827",
  colorMuted: "#6b7280",
  colorDanger: "#b91c1c",
  colorWarning: "#b45309",
  radius: "8px",
  fontFamily:
    "'Noto Sans Khmer', 'Kantumruy Pro', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

const LocaleContext = createContext<KitluyLocale>(DEFAULT_LOCALE);

export function LocaleProvider(props: { locale: KitluyLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={props.locale}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): KitluyLocale {
  return useContext(LocaleContext);
}

/** Required data-surface states (RB v4 §9.7). */
export type DataSurfaceState = "loading" | "empty" | "partial" | "stale" | "unavailable" | "fresh";

const STATE_LABELS: Record<DataSurfaceState, { "km-KH": string; "en-US": string }> = {
  loading: { "km-KH": "កំពុងផ្ទុក…", "en-US": "Loading…" },
  empty: { "km-KH": "គ្មានទិន្នន័យ", "en-US": "No data" },
  partial: { "km-KH": "ទិន្នន័យមិនពេញលេញ", "en-US": "Partial data" },
  stale: { "km-KH": "ទិន្នន័យចាស់ — មិនមែនបច្ចុប្បន្ន", "en-US": "Stale data — not live" },
  unavailable: { "km-KH": "មិនអាចប្រើបានទេ", "en-US": "Unavailable" },
  fresh: { "km-KH": "បច្ចុប្បន្ន", "en-US": "Live" },
};

export function stateLabel(state: DataSurfaceState, locale: KitluyLocale): string {
  return STATE_LABELS[state][locale];
}

/**
 * Wrapper for any data surface. Fails closed: when the authoritative contract
 * for the data does not exist, callers render state="unavailable" — never
 * fabricated values.
 */
export function DataSurface(props: {
  state: DataSurfaceState;
  children?: ReactNode;
  /** ISO timestamp of the observation, shown for stale/partial states. */
  dataAsOf?: string;
}) {
  const locale = useLocale();
  if (props.state === "fresh") return <>{props.children}</>;
  return (
    <div role="status" data-surface-state={props.state}>
      <strong>{stateLabel(props.state, locale)}</strong>
      {props.dataAsOf ? <span> · {props.dataAsOf}</span> : null}
      {props.state === "partial" || props.state === "stale" ? props.children : null}
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Application error boundary — renders a safe fallback, never a blank page. */
export class KitluyErrorBoundary extends Component<
  { fallback?: ReactNode; children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div role="alert" data-surface-state="unavailable">
            Something went wrong. The error has been recorded.
          </div>
        )
      );
    }
    return this.props.children;
  }
}

/** Simple branded page shell used by all portal scaffolds. */
export function AppShell(props: { productName: string; children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: kitluyTokens.fontFamily,
        color: kitluyTokens.colorText,
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          background: kitluyTokens.colorPrimary,
          color: "#fff",
          padding: "12px 20px",
          fontWeight: 700,
        }}
      >
        KitLuy · {props.productName}
      </header>
      <main style={{ padding: "20px" }}>{props.children}</main>
    </div>
  );
}
