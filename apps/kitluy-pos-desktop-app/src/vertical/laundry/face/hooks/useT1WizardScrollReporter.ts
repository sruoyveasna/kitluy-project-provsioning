import { useCallback, useRef } from "react";
import { useAppState } from "@face/app/useAppState";

/** Throttled T1 → pos-live scroll ratio (0–1) for mirroring on T2. */
export function useT1WizardScrollReporter() {
  const { setT1WizardScrollRatio } = useAppState();
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef(0);

  return useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? el.scrollTop / max : 0;
      pendingRef.current = Math.min(1, Math.max(0, ratio));
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setT1WizardScrollRatio(pendingRef.current);
      });
    },
    [setT1WizardScrollRatio],
  );
}
