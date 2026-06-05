// ESLint v9 flat config. Targets the React + TypeScript frontend in `src/`.
//
// Intentionally light-weight: type-aware rules are disabled because they
// roughly double CI time and the project doesn't yet have the test coverage
// to make `no-floating-promises` style enforcement worth it. We can layer
// those in later by switching from `tseslint.configs.recommended` to
// `tseslint.configs.recommendedTypeChecked` and pointing at tsconfig.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "node_modules", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.es2020 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Pre-existing repo conventions we keep open-ended on purpose:
      // `any` is used pervasively in storage-layer JSON glue and would take
      // a much larger refactor to type properly; empty object types appear
      // in TS-generated Tauri command shells.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "error",
      "prefer-const": "error",
      // react-hooks rules enforced at error level. The `set-state-in-effect`
      // rule has a single inline disable on `MockServerPanel` for the
      // canonical async-fetch pattern; that disable is intentional and
      // documented in a comment next to the directive.
    },
  },
  {
    // shadcn/ui primitives intentionally co-export a component and its
    // `cva` variant helper (e.g. `Button` + `buttonVariants`). The
    // Fast-Refresh "only export components" rule is meant for app modules,
    // not these library files, so we turn it off for the ui/ directory to
    // keep `eslint --max-warnings 0` green.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Vitest tests get the test globals.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2020, ...globals.node },
    },
  },
);
