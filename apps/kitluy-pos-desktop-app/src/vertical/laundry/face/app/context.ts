import { createContext } from "react";
import type { AppState } from "./AppContext";

export const AppStateContext = createContext<AppState | null>(null);
