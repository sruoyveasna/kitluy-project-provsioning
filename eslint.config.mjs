// Root ESLint flat config for the KitLuy monorepo.
// Runs once from the repository root across all workspaces.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/build/**",
      "**/dist-electron/**",
      "**/coverage/**",
      "docs/source/imported/**",
      "docs/generated/**",
      "supabase/generated/**",
      "**/*.gen.ts",
      // GENERATED image closures, not source. `package-bootstrap-runtime.sh`
      // does `rm -rf "$LIB_DIR"` and repopulates these from the agent's
      // `dist/`, so the TypeScript they come from is already linted here. They
      // are tracked deliberately — the image build must not need a TS toolchain
      // — which is the only reason they are visible to eslint at all.
      //
      // Without this they report `no-undef` for `Buffer`, `fetch` and friends
      // and duplicate every finding across three trees (pi-terminal, store-hub
      // and each rootfs-overlay). `**/dist/**` above is ignored for exactly
      // this reason; these ARE dist, copied into an overlay.
      "**/*rootfs-overlay/**/lib/firstboot-agent/**",
      // The Device Shell's compiled app, same reason: vite/tsc output that the
      // packager deletes and repopulates on every build.
      "**/*rootfs-overlay/**/lib/device-shell/**",
      // The Store Hub agent BUNDLE, for the same reason and one more.
      //
      // `dist-bundle/hub-agent.mjs` is esbuild output: the whole dependency
      // graph inlined, including `pg` and its vendored parsers. Linting it
      // reports on code this repository did not write and cannot fix — the
      // `parseFloat` findings, for instance, are inside pg's numeric parser,
      // where they are correct. The TypeScript it is built from IS linted.
      "**/dist-bundle/**",
      "**/*rootfs-overlay/**/lib/hub-agent/**",
      "infra/*/out/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Authoritative money must never be floating-point; the money package
      // enforces integer minor units. Keep the lint gate as a backstop.
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Use @kitluy/money for monetary values." },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "writable",
        exports: "writable",
        URL: "readonly",
        // These are Node globals too, and omitting them made `no-undef` fire on
        // correct code — `scripts/development/fleet-watch.mjs` failed solely
        // because `setInterval`/`clearInterval` were undeclared here. Declaring
        // what the runtime actually provides is not a relaxed rule; the rule was
        // being fed a false picture of the environment.
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
