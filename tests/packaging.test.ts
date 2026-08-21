import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Imported as JSON rather than read through `node:module`, matching the sibling
// packages. `resolveJsonModule` gives tsc the literal shape, so several of these
// are checked twice: once by the compiler and once here, for the day someone
// changes the manifest and not the types.
import pkg from "../package.json";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

/**
 * The packaging contract — properties a consumer feels and a reviewer cannot
 * see, so they are asserted rather than trusted.
 *
 * The headline one: **`lightweight-charts` must not appear in the root entry's
 * bundle.** The owner's instruction was explicit — the chart lives inside this
 * package now, so a consumer who installs it for an order ticket must still be
 * able to tree-shake the engine away. Subpath exports are how, and a grep of
 * the BUILT output is the only check that survives someone adding an
 * innocent-looking re-export to `src/index.ts`.
 */
describe("packaging", () => {
  test("the runtime dependency tree is EMPTY, and stays empty", () => {
    expect(pkg.dependencies).toEqual({});
  });

  test("`dependencies` is present, not merely absent", () => {
    // An absent key resolves identically and reads completely differently.
    expect(Object.prototype.hasOwnProperty.call(pkg, "dependencies")).toBe(true);
  });

  test("lightweight-charts is an OPTIONAL peer, never a dependency", () => {
    const peers = pkg.peerDependencies as Record<string, string>;
    expect(peers["lightweight-charts"]).toBeDefined();
    expect((pkg.dependencies as Record<string, string>)["lightweight-charts"]).toBeUndefined();

    const meta = pkg.peerDependenciesMeta as Record<string, { optional?: boolean }>;
    expect(meta["lightweight-charts"]?.optional).toBe(true);
  });

  test("the domain core is a REQUIRED peer — nothing here re-declares money or orders", () => {
    const peers = pkg.peerDependencies as Record<string, string>;
    expect(peers["@particle-academy/fancy-trading"]).toBeDefined();
    const meta = pkg.peerDependenciesMeta as Record<string, { optional?: boolean }>;
    expect(meta["@particle-academy/fancy-trading"]?.optional).toBeUndefined();
  });

  test("first-party sibling ranges are open-ended, never a caret on a 0.x", () => {
    // The envelope rule: a caret on a `0.x` locks the MINOR and pins the sibling
    // at whatever it was the day the line was written, and nothing reports it.
    for (const [name, range] of Object.entries(pkg.peerDependencies as Record<string, string>)) {
      if (!name.startsWith("@particle-academy/")) continue;
      expect(range.startsWith("^"), `${name} must not use a caret, got ${range}`).toBe(false);
    }
  });

  test("first-party siblings in devDependencies KEEP their caret", () => {
    // That pin is the version the suite is actually built and tested against,
    // and it is what turns the wide runtime range into a tested claim.
    for (const [name, range] of Object.entries(pkg.devDependencies as Record<string, string>)) {
      if (!name.startsWith("@particle-academy/")) continue;
      expect(range.startsWith("^"), `${name} should keep its caret, got ${range}`).toBe(true);
    }
  });

  test("three entry points, and the chart is its own", () => {
    const exports = pkg.exports as Record<string, unknown>;
    expect(Object.keys(exports)).toContain(".");
    expect(Object.keys(exports)).toContain("./chart");
    expect(Object.keys(exports)).toContain("./safety");
  });

  test("the tarball carries dist and the NOTICE, not the tests", () => {
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("NOTICE");
    expect(pkg.files).not.toContain("tests");
  });

  test("the NOTICE file exists, because npm does not ship TradingView's", () => {
    expect(existsSync(join(ROOT, "NOTICE"))).toBe(true);
  });
});

/**
 * The bundle checks. They need `dist`, which CI builds AFTER the tests run —
 * so they skip when it is absent and say loudly why, rather than passing by
 * doing nothing. A green tick on a check that did not run is worse than a red
 * one, which is the same lesson as `npm test --if-present` on a package with no
 * test script.
 */
describe("the built bundle", () => {
  const built = existsSync(DIST);
  const files = built ? readdirSync(DIST) : [];
  const read = (name: string): string => readFileSync(join(DIST, name), "utf8");

  test("dist exists (run `npm run build` — otherwise the bundle checks below are skipped)", () => {
    if (!built) {
      console.warn(
        "[packaging] dist/ is absent, so the bundle checks did NOT run. " +
          "They run in CI's Build step and in `npm run prepublishOnly`.",
      );
    }
    expect(true).toBe(true);
  });

  test.runIf(built)("the ROOT bundle does not import lightweight-charts", () => {
    // The check that matters. `src/index.ts` not importing the chart is a
    // source-level claim; this is the built artifact, which is what a consumer's
    // bundler actually sees.
    for (const name of ["index.js", "index.cjs"]) {
      if (!files.includes(name)) continue;
      expect(read(name), `${name} pulls in lightweight-charts`).not.toContain("lightweight-charts");
    }
  });

  test.runIf(built)("the SAFETY bundle does not import React either", () => {
    // /safety is the entry a Node backend imports to run the same limit checks
    // the UI runs. A stray React import makes it unusable there.
    for (const name of ["safety.js", "safety.cjs"]) {
      if (!files.includes(name)) continue;
      const source = read(name);
      expect(source).not.toContain("lightweight-charts");
      expect(source).not.toMatch(/require\(["']react["']\)|from\s*["']react["']/);
    }
  });

  test.runIf(built)("the CHART bundle DOES reference it, externally", () => {
    // The positive control: if this one also came back clean, the check above
    // would be proving nothing.
    expect(files).toContain("chart.js");
    expect(read("chart.js")).toContain("lightweight-charts");
  });

  test.runIf(built)("every entry ships types for both module systems", () => {
    for (const entry of ["index", "chart", "safety"]) {
      for (const ext of [".js", ".cjs", ".d.ts", ".d.cts"]) {
        expect(files, `${entry}${ext} is missing from dist`).toContain(`${entry}${ext}`);
      }
    }
  });
});
