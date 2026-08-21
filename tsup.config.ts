import { defineConfig } from "tsup";

/**
 * Three entries, and the split is load-bearing rather than cosmetic.
 *
 * `index` is the surfaces. `lightweight-charts` must not appear anywhere in its
 * graph, because a consumer who installs this package for an order ticket
 * should not pay for a charting engine — and with a single entry they would,
 * since a bundler cannot tree-shake a module it has to evaluate for its side
 * effects. `tests/packaging.test.ts` greps the BUILT bundle to prove it, which
 * is the only check that survives someone adding an innocent-looking re-export.
 *
 * `safety` is the floor with zero React, so a Node backend can run the same
 * limit checks the UI runs. §3.2: "guardrails are enforced server-side as well
 * as client-side", and a rule you cannot import server-side is decoration.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/chart.ts", "src/safety.ts", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "lightweight-charts",
    "@particle-academy/react-fancy",
    "@particle-academy/fancy-trading",
    "@particle-academy/fancy-auto-common",
  ],
  treeshake: true,
});
