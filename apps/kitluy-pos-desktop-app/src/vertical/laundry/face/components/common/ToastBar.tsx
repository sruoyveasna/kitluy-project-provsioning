import { useThemeColors } from "@face/app/ThemeProvider";
import { I } from "./icons";

export const ToastBar = ({ message }: { message: string | null }) => {
  const C = useThemeColors();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "absolute",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: C.slate900,
        color: "#fff",
        padding: "14px 28px",
        borderRadius: 14,
        fontSize: 15,
        fontWeight: 600,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        display: message ? "flex" : "none",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      {message && (
        <>
          <I.Check s={18} /> {message}
        </>
      )}
    </div>
  );
};
