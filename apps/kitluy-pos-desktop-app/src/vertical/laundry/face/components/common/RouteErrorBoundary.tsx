import { Component, type ErrorInfo, type ReactNode } from "react";
import { font } from "@face/styles/tokens";
import { KIOSK } from "@face/styles/kiosk";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in a route subtree so one bad tab does not blank the
 * whole kiosk shell (sidebar + chrome can stay usable).
 */
export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[RouteErrorBoundary]", error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: KIOSK.contentPad,
            fontFamily: font,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            maxWidth: 560,
          }}
        >
          <h2
            style={{ fontSize: 18, fontWeight: 700, color: "var(--sv-danger)", margin: "0 0 8px" }}
          >
            This view crashed
          </h2>
          <p
            style={{ fontSize: 14, color: "var(--sv-ink-2)", margin: "0 0 12px", lineHeight: 1.5 }}
          >
            Try another tab, or reload. If this persists, share the message below with engineering.
          </p>
          <pre
            style={{
              fontSize: 12,
              color: "var(--sv-ink)",
              background: "var(--sv-fill)",
              border: `1px solid var(--sv-line)`,
              borderRadius: 10,
              padding: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              marginBottom: 16,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              alignSelf: "flex-start",
              padding: "12px 20px",
              borderRadius: 10,
              border: `1px solid var(--sv-line)`,
              background: "var(--sv-surface)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
              minHeight: KIOSK.minTap,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
