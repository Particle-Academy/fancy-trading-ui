import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Rules of Hooks, and little else — the same narrow configuration the rest of
 * the suite's React packages carry. A hook called conditionally desyncs React's
 * hook order and throws from inside React, naming none of the responsible code;
 * `tsc` cannot see it and a test only catches it if it crosses the exact
 * transition that flips the hook count.
 *
 * `exhaustive-deps` stays off, matching the suite: it fires in the hundreds
 * across these repos and would bury real errors under warnings.
 */
export default [
  // MUST be its own object with no `files` key. An `ignores` alongside `files`
  // only filters THAT config block — it does not stop ESLint walking the tree.
  {
    ignores: ["**/dist/**", "**/build/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module", ecmaVersion: "latest" },
    },
    plugins: { "react-hooks": reactHooks, "@typescript-eslint": tseslint.plugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
