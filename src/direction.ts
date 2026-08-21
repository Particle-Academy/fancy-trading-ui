/**
 * Direction encoding — up/down, buy/sell — with colour as an *additional*
 * channel and never the only one.
 *
 * §12.7: red/green as the sole encoding of direction fails for deuteranopia,
 * roughly 1 in 12 men, a population heavily represented among traders. The
 * study found this to be a real and unclaimed differentiator in the category.
 *
 * The design consequence is small and absolute: **every value returned here
 * carries a glyph and a label, in every palette.** A consumer can restyle the
 * colours, choose a colour-blind-safe pair, or turn colour off entirely, and
 * the direction is still legible — including in greyscale, which is also what a
 * printed report and a screen-reader are.
 */

import { type Decimal, sign } from "@particle-academy/fancy-trading";

export type Direction = "up" | "down" | "flat";

export type DirectionPalette =
  /** The convention most traders expect. Fails for red-green colour blindness. */
  | "red-green"
  /** Deuteranopia-safe. Blue up, orange down — distinguishable to everyone. */
  | "blue-orange"
  /** No colour at all; the glyph and label carry it. */
  | "monochrome";

export type DirectionEncoding = {
  readonly direction: Direction;
  /** Never empty. The channel that survives colour blindness AND greyscale. */
  readonly glyph: string;
  /** Never empty. Goes on `aria-label` and `title`. */
  readonly label: string;
  readonly tone: "positive" | "negative" | "neutral";
  /** Tailwind classes for the colour channel. Empty for `monochrome`. */
  readonly className: string;
};

const GLYPH: Record<Direction, string> = { up: "▲", down: "▼", flat: "—" };
const LABEL: Record<Direction, string> = { up: "up", down: "down", flat: "unchanged" };
const TONE: Record<Direction, DirectionEncoding["tone"]> = {
  up: "positive",
  down: "negative",
  flat: "neutral",
};

const COLOURS: Record<DirectionPalette, Record<Direction, string>> = {
  "red-green": {
    up: "text-green-600 dark:text-green-400",
    down: "text-red-600 dark:text-red-400",
    flat: "text-secondary-500",
  },
  "blue-orange": {
    up: "text-sky-600 dark:text-sky-400",
    down: "text-orange-600 dark:text-orange-400",
    flat: "text-secondary-500",
  },
  monochrome: { up: "", down: "", flat: "" },
};

/** Direction of a signed value — a P&L, a change, a delta. */
export function directionOf(value: Decimal): Direction {
  const s = sign(value);
  return s > 0 ? "up" : s < 0 ? "down" : "flat";
}

/**
 * Encode a direction for rendering.
 *
 * Note what this deliberately does not do: it never returns colour alone, and
 * there is no option that drops the glyph. A caller that wants a bare coloured
 * number has to discard the glyph itself, which makes the accessibility
 * regression visible in their diff rather than in ours.
 */
export function encodeDirection(
  direction: Direction,
  palette: DirectionPalette = "red-green",
): DirectionEncoding {
  return {
    direction,
    glyph: GLYPH[direction],
    label: LABEL[direction],
    tone: TONE[direction],
    className: COLOURS[palette][direction],
  };
}

export type Side = "buy" | "sell";

export type SideEncoding = {
  readonly side: Side;
  /** `B` / `S`. Short enough for a ladder cell, and not a colour. */
  readonly glyph: string;
  readonly label: string;
  readonly className: string;
};

const SIDE_LABEL: Record<Side, string> = { buy: "buy", sell: "sell" };
const SIDE_GLYPH: Record<Side, string> = { buy: "B", sell: "S" };

/**
 * The same rule for order side. A ladder that distinguishes the bid and ask
 * columns only by colour is unusable for the same population, and the ladder is
 * the surface where a mistake costs the most.
 */
export function encodeSide(side: Side, palette: DirectionPalette = "red-green"): SideEncoding {
  const direction: Direction = side === "buy" ? "up" : "down";
  return {
    side,
    glyph: SIDE_GLYPH[side],
    label: SIDE_LABEL[side],
    className: COLOURS[palette][direction],
  };
}
