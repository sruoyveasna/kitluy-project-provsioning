import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  // The renderer shows its own version in the terminal menu; the main process
  // reads it from Electron, the renderer cannot, so Vite bakes it in.
  define: { __KITLUY_POS_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      // The ported Laundry T1 face keeps its donor-internal import style
      // (`@face/...` = apps/kitluy-pos-desktop-app/src/vertical/laundry/face).
      "@face": fileURLToPath(new URL("./src/vertical/laundry/face", import.meta.url)),
    },
  },
});
