import type { ReactNode } from "react";

/**
 * Top-level kiosk shell. By default renders children at the *real* viewport
 * size (1:1 CSS pixels) — no transform-scale — so touch targets keep their
 * actual hit area on a 1920×1080 touchscreen.
 *
 * Why no scaling:
 *   The previous implementation rendered a fixed 1920×1080 stage and then
 *   `transform: scale(min(vw/1920, vh/1080))` to fit the viewport. On any
 *   browser smaller than design size that visibly shrank fonts AND touch
 *   targets, and on screens with a different aspect ratio it produced
 *   black letterboxes inside `background: #1a1a2e`. Cashiers experienced
 *   "tiny buttons" + "black border around the app".
 *
 * Pass `designPreview` to opt back in to the scaled simulator when you
 * want a deterministic 1920×1080 preview in a normal desktop browser.
 */
export const ScreenFrame = ({
  children,
  designPreview = false,
}: {
  children: ReactNode;
  designPreview?: boolean;
}) => {
  if (designPreview) return <DesignPreviewFrame>{children}</DesignPreviewFrame>;

  return (
    <div
      style={{
        // 100dvh handles mobile/desktop browser chrome that 100vh ignores.
        // 100vw on a kiosk = the whole screen since there's no horizontal
        // browser chrome.
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        // Children own their own background; the shell only enforces
        // viewport bounds and clips overflow.
      }}
    >
      {children}
    </div>
  );
};

/**
 * Optional 1920×1080 preview / dev simulator. Off by default.
 * Useful when designing on a laptop where the browser viewport is ~1280×800.
 */
const DesignPreviewFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a1a2e",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 1920,
          height: 1080,
          // Static scale of 1 here on purpose — preview is a screenshot
          // helper, not a runtime fit. If you need true fit-to-window
          // preview, wire a useEffect that reads window size and sets
          // transform: scale(...) here.
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 0 60px rgba(0,0,0,0.5)",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
};
