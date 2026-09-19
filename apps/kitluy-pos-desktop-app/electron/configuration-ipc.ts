/**
 * The configuration read surface — T1-REAL-OPERATIONS-001 (slice 1).
 *
 * One channel, no input: the renderer asks for the sections of the verified
 * configuration and gets them whole, or `not_delivered` with the reason. The
 * main process is the only party that ever saw the signed envelope; the
 * renderer cannot name a section, a version or a scope.
 */
import type { IpcMain } from "electron";

import {
  T1_CONFIGURATION_READ_CHANNEL,
  type T1ConfigurationRead,
} from "../src/bootstrap/bridge-types.js";

export function registerConfigurationIpc(ipcMain: IpcMain, read: () => T1ConfigurationRead): void {
  ipcMain.handle(T1_CONFIGURATION_READ_CHANNEL, () => read());
}
