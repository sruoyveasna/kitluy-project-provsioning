import { useContext } from "react";
import { AppStateContext } from "./context";
import type { AppState } from "./AppContext";

export const useAppState = (): AppState => {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within <AppStateProvider>");
  }
  return ctx;
};
