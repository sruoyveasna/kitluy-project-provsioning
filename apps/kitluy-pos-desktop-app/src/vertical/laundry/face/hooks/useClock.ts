import { useEffect, useState } from "react";
import { nowTime } from "@face/lib/formatters";

export const useClock = (intervalMs = 30_000): string => {
  const [time, setTime] = useState<string>(nowTime());
  useEffect(() => {
    const t = setInterval(() => setTime(nowTime()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return time;
};
