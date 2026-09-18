import { useEffect, useRef } from "react";
import { useAppState } from "@face/app/useAppState";
import { parseWfKgDigits } from "@face/features/t1-pos/laundry-savor/wfKgConstants";

/** Close WF kg numpad mode when tapping outside the input zone and numpad rail. */
export function useWfKgInputDismiss() {
  const { wfKgInputActive, setWfKgInputActive, wfKgDigits, setWfKg, setWfKgDigits } = useAppState();
  const digitsRef = useRef(wfKgDigits);

  useEffect(() => {
    digitsRef.current = wfKgDigits;
  }, [wfKgDigits]);

  useEffect(() => {
    if (!wfKgInputActive) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-wf-kg-input-zone]")) return;
      if (target.closest("[data-wf-kg-numpad-zone]")) return;

      const settled = parseWfKgDigits(digitsRef.current);
      setWfKg(settled);
      setWfKgDigits(settled > 0 ? String(settled) : "");
      setWfKgInputActive(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [wfKgInputActive, setWfKg, setWfKgDigits, setWfKgInputActive]);
}
