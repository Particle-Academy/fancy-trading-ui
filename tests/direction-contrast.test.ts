/**
 * Direction colours are readable on a light surface.
 *
 * Every up value in the red-green palette was `text-green-600`, which is
 * 3.22:1 on white and 3.08:1 on an off-white page (axe color-contrast,
 * serious, lab run 601, K35) — on the order book, depth chart, time and
 * sales, watch list, ladder, positions and orders. Colour is the *additional*
 * channel here (the glyph and label carry direction), but the text it paints
 * is still text and still owes 4.5:1.
 */
import { describe, expect, test } from "vitest";
import { encodeDirection, type Direction, type DirectionPalette } from "../src/direction.ts";

/** Tailwind v4 light shades, as rendered (sRGB hex). Add a shade here before using it. */
const HEX: Record<string, string> = {
  "green-600": "#00a63e",
  "green-700": "#008236",
  "green-800": "#016630",
  "red-600": "#e7000b",
  "red-700": "#c10007",
  "sky-600": "#0084d1",
  "sky-700": "#0069a8",
  "orange-600": "#f54900",
  "orange-700": "#ca3500",
};

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
};

/** White, the lab host's off-white page, and the zinc-100 muted surface. */
const SURFACES = ["#ffffff", "#fbfaf7", "#f4f4f5"];

describe("direction colours", () => {
  for (const palette of ["red-green", "blue-orange"] as DirectionPalette[]) {
    for (const dir of ["up", "down"] as Direction[]) {
      test(`${palette} ${dir} meets 4.5:1 on light surfaces`, () => {
        const light = encodeDirection(dir, palette)
          .className.split(/\s+/)
          .find((c) => /^text-[a-z]+-\d{3}$/.test(c));
        expect(light).toBeDefined();
        const hex = HEX[light!.slice("text-".length)];
        expect(hex, `unknown shade ${light}`).toBeDefined();
        for (const bg of SURFACES) expect(contrast(hex!, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
