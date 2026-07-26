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
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
