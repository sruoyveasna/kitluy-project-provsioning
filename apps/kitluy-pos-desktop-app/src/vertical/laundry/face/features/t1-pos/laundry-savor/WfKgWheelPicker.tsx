import { useCallback, useEffect, useRef, useState } from "react";

import { WF_KG_MIN, WF_KG_WHEEL_MAX, clampWfKgForWheel, wfKgToScrollIndex } from "./wfKgConstants";

const ITEM_W = 84;
const DOUBLE_TAP_MS = 400;
const KG_COUNT = WF_KG_WHEEL_MAX - WF_KG_MIN + 1;
const MAX_SCROLL = (KG_COUNT - 1) * ITEM_W;

const TAP_SLOP_PX = 8;
const VELOCITY_STOP = 0.035;
const FRICTION = 0.94;
const SNAP_MS = 220;
const ROLL_BASE_MS = 200;
const ROLL_PER_ITEM_MS = 62;
const ROLL_MAX_MS = 920;

type Props = {
  value: number;
  onChange: (kg: number) => void;
  /** Open numpad for loads above the wheel max (99 kg). */
  onRequestTypedEntry: () => void;
  disabled?: boolean;
};

type Sample = { scroll: number; t: number };

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

/** Horizontal drum picker with iOS-style momentum + smooth tap-to-roll. */
export function WfKgWheelPicker({ value, onChange, onRequestTypedEntry, disabled = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const fromScrollRef = useRef(false);
  const lastValueRef = useRef(value);
  const lastTapRef = useRef(0);
  const maxEntryRequestedRef = useRef(false);
  const movedRef = useRef(false);
  const coastingRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastT: 0,
    startX: 0,
    startY: 0,
    pending: false,
  });
  const samplesRef = useRef<Sample[]>([]);
  const [isCoasting, setIsCoasting] = useState(false);

  const stopAnimation = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const setCoasting = useCallback((on: boolean) => {
    coastingRef.current = on;
    setIsCoasting(on);
  }, []);

  const scrollLeftForKg = useCallback((kg: number) => {
    return wfKgToScrollIndex(kg) * ITEM_W;
  }, []);

  const readKgFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return clampWfKgForWheel(value);
    const raw = Math.round(el.scrollLeft / ITEM_W) + WF_KG_MIN;
    return clampWfKgForWheel(raw);
  }, [value]);

  const clampScroll = useCallback((left: number) => {
    return Math.max(0, Math.min(MAX_SCROLL, left));
  }, []);

  const emitKg = useCallback(
    (kg?: number) => {
      const clamped = clampWfKgForWheel(kg ?? readKgFromScroll());
      if (clamped !== lastValueRef.current) {
        lastValueRef.current = clamped;
        fromScrollRef.current = true;
        onChange(clamped);
      }
    },
    [onChange, readKgFromScroll],
  );

  const animateScrollTo = useCallback(
    (targetLeft: number, durationMs: number, onComplete?: () => void, liveEmit = true) => {
      const el = scrollRef.current;
      if (!el) return;

      stopAnimation();
      setCoasting(true);
      syncingRef.current = true;

      const start = el.scrollLeft;
      const dist = targetLeft - start;
      if (Math.abs(dist) < 0.5) {
        el.scrollLeft = targetLeft;
        syncingRef.current = false;
        setCoasting(false);
        if (liveEmit) emitKg();
        onComplete?.();
        return;
      }

      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / durationMs);
        el.scrollLeft = start + dist * easeOutCubic(p);
        if (liveEmit) emitKg();

        if (p < 1) {
          animRef.current = requestAnimationFrame(step);
        } else {
          animRef.current = null;
          syncingRef.current = false;
          setCoasting(false);
          onComplete?.();
        }
      };
      animRef.current = requestAnimationFrame(step);
    },
    [emitKg, setCoasting, stopAnimation],
  );

  const scrollToKg = useCallback(
    (kg: number, smooth: boolean) => {
      const target = scrollLeftForKg(kg);
      if (!smooth) {
        const el = scrollRef.current;
        if (!el) return;
        stopAnimation();
        el.scrollLeft = target;
        syncingRef.current = false;
        setCoasting(false);
        return;
      }
      animateScrollTo(target, SNAP_MS, () => emitKg(kg));
    },
    [animateScrollTo, emitKg, scrollLeftForKg, setCoasting, stopAnimation],
  );

  /** Smooth roll when tapping a non-centered value — duration scales with distance. */
  const rollToKg = useCallback(
    (kg: number) => {
      const target = scrollLeftForKg(kg);
      const el = scrollRef.current;
      if (!el) return;
      const items = Math.abs(target - el.scrollLeft) / ITEM_W;
      const duration = Math.min(ROLL_MAX_MS, ROLL_BASE_MS + items * ROLL_PER_ITEM_MS);
      animateScrollTo(target, duration, () => emitKg(kg));
    },
    [animateScrollTo, emitKg, scrollLeftForKg],
  );

  const snapToNearest = useCallback(() => {
    const kg = readKgFromScroll();
    scrollToKg(kg, true);
    emitKg(kg);
    setCoasting(false);
  }, [emitKg, readKgFromScroll, scrollToKg, setCoasting]);

  const avgVelocity = useCallback(() => {
    const samples = samplesRef.current;
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) return 0;
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.scroll - first.scroll) / dt;
  }, []);

  const startInertia = useCallback(
    (initialVelocity: number) => {
      const el = scrollRef.current;
      if (!el) return;

      let velocity = initialVelocity;
      if (Math.abs(velocity) < VELOCITY_STOP) {
        snapToNearest();
        return;
      }

      setCoasting(true);
      let lastT = performance.now();

      const step = (now: number) => {
        const dt = Math.min(32, now - lastT);
        lastT = now;

        el.scrollLeft = clampScroll(el.scrollLeft + velocity * dt);
        emitKg();

        velocity *= Math.pow(FRICTION, dt / 16);

        const atMinEdge = el.scrollLeft <= 0.5;
        const atMaxEdge = el.scrollLeft >= MAX_SCROLL - 0.5;
        if (atMinEdge || atMaxEdge) velocity *= 0.6;

        if (atMaxEdge && velocity > VELOCITY_STOP && !maxEntryRequestedRef.current) {
          maxEntryRequestedRef.current = true;
          onRequestTypedEntry();
        }

        if (Math.abs(velocity) > VELOCITY_STOP) {
          animRef.current = requestAnimationFrame(step);
        } else {
          animRef.current = null;
          snapToNearest();
        }
      };

      animRef.current = requestAnimationFrame(step);
    },
    [clampScroll, emitKg, onRequestTypedEntry, setCoasting, snapToNearest],
  );

  const activateDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      stopAnimation();
      setCoasting(true);
      movedRef.current = false;
      const el = scrollRef.current;
      samplesRef.current = el ? [{ scroll: el.scrollLeft, t: performance.now() }] : [];
      dragRef.current = {
        active: true,
        pending: false,
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastT: performance.now(),
        startX: dragRef.current.startX,
        startY: dragRef.current.startY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [setCoasting, stopAnimation],
  );

  useEffect(() => {
    lastValueRef.current = clampWfKgForWheel(value);
  }, [value]);

  useEffect(() => {
    if (fromScrollRef.current) {
      fromScrollRef.current = false;
      return;
    }
    if (syncingRef.current || coastingRef.current || dragRef.current.active) {
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const expected = scrollLeftForKg(value);
    if (Math.abs(el.scrollLeft - expected) > 2) {
      const items = Math.abs(expected - el.scrollLeft) / ITEM_W;
      // Programmatic bumps (e.g. garment tap at 0 kg → 1 kg): snap instantly so
      // the wheel position, active styling, and wfKg state stay in sync.
      if (items <= 1) {
        scrollToKg(value, false);
      } else {
        rollToKg(value);
      }
    }
  }, [value, scrollLeftForKg, rollToKg, scrollToKg]);

  useEffect(() => {
    scrollToKg(clampWfKgForWheel(value), false);
    return () => stopAnimation();
  }, []);

  const recordSample = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = performance.now();
    samplesRef.current = [...samplesRef.current, { scroll: el.scrollLeft, t: now }].slice(-6);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    maxEntryRequestedRef.current = false;
    dragRef.current = {
      active: false,
      pending: true,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastT: performance.now(),
      startX: e.clientX,
      startY: e.clientY,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (dragRef.current.pending && !dragRef.current.active) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) >= TAP_SLOP_PX) {
        activateDrag(e);
      }
    }

    if (!dragRef.current.active) return;
    const el = scrollRef.current;
    if (!el) return;

    const dx = e.clientX - dragRef.current.lastX;
    if (Math.abs(dx) > 2) movedRef.current = true;

    el.scrollLeft = clampScroll(el.scrollLeft - dx);
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastT = performance.now();
    recordSample();
    emitKg();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.pending = false;
    if (!dragRef.current.active) return;

    dragRef.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    startInertia(avgVelocity());
  };

  return (
    <div className={"sv-wf-kg-wheel" + (disabled ? " sv-wf-kg-wheel--disabled" : "")}>
      <div className="sv-wf-kg-wheel-frame">
        <div className="sv-wf-kg-wheel-indicator" aria-hidden>
          <span className="sv-wf-kg-wheel-indicator-line" />
          <span className="sv-wf-kg-wheel-indicator-line" />
        </div>
        <div
          ref={scrollRef}
          className={
            "sv-wf-kg-wheel-scroll hide-scrollbar" +
            (isCoasting ? " sv-wf-kg-wheel-scroll--coasting" : "")
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Swipe 0–99 kg; tap 99 or press + to type larger loads"
          role="listbox"
          aria-valuenow={clampWfKgForWheel(value)}
          aria-valuemin={WF_KG_MIN}
          aria-valuemax={WF_KG_WHEEL_MAX}
        >
          <div className="sv-wf-kg-wheel-pad" aria-hidden />
          {Array.from({ length: KG_COUNT }, (_, i) => {
            const kg = i + WF_KG_MIN;
            const isActive = kg === clampWfKgForWheel(value);
            return (
              <button
                key={kg}
                type="button"
                role="option"
                aria-selected={isActive}
                className={"sv-wf-kg-wheel-item" + (isActive ? " is-active" : "")}
                style={{ width: ITEM_W }}
                onClick={() => {
                  if (disabled) return;
                  if (movedRef.current) {
                    movedRef.current = false;
                    return;
                  }
                  if (!isActive) {
                    rollToKg(kg);
                    return;
                  }
                  if (kg === WF_KG_WHEEL_MAX) {
                    onRequestTypedEntry();
                    return;
                  }
                  const now = Date.now();
                  if (now - lastTapRef.current < DOUBLE_TAP_MS) {
                    lastTapRef.current = 0;
                    onRequestTypedEntry();
                  } else {
                    lastTapRef.current = now;
                  }
                }}
              >
                <span className="sv-wf-kg-wheel-num">{kg < 1 ? "0" : kg}</span>
                <span className="sv-wf-kg-wheel-unit">kg</span>
              </button>
            );
          })}
          <div className="sv-wf-kg-wheel-pad" aria-hidden />
        </div>
      </div>
    </div>
  );
}
