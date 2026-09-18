import { useCallback, useRef, useState } from "react";

export const useToast = (durationMs = 2500) => {
  const [toast, setToast] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      setToast(msg);
      timeoutRef.current = window.setTimeout(() => {
        setToast(null);
        timeoutRef.current = null;
      }, durationMs);
    },
    [durationMs],
  );

  return { toast, showToast } as const;
};
