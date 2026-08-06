import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { T1_BRIDGE_KEY, type T1RuntimeBridge } from "./bootstrap/bridge-types.js";
import type { T1BootstrapReport } from "./bootstrap/states.js";

function bridge(): T1RuntimeBridge | undefined {
  return (window as unknown as Record<string, T1RuntimeBridge | undefined>)[T1_BRIDGE_KEY];
}

/**
 * Subscribes to the read-only bootstrap report. Without the preload bridge
 * (browser dev session) no report ever arrives and the App fails closed.
 */
function Root() {
  const [report, setReport] = useState<T1BootstrapReport | undefined>(undefined);
  useEffect(() => {
    const runtime = bridge();
    if (runtime === undefined) return undefined;
    let disposed = false;
    void runtime.getReport().then((initial) => {
      if (!disposed && initial !== null) setReport(initial);
    });
    const unsubscribe = runtime.onReport((next) => {
      if (!disposed) setReport(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  return <App {...(report !== undefined ? { report } : {})} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
