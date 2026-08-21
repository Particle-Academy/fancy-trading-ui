/**
 * Price and money display.
 *
 * The reason this is a module rather than a `toFixed` call: **`priceDisplay` is
 * not derivable from tick size** (§2.8). Treasuries quote in 32nds and 64ths,
 * grains in eighths, event contracts in cents or percent, and a decimal
 * renderer produces gibberish for all of them. `110'165` and `110.5195312` are
 * the same number and only one of them is readable at a glance on a ladder.
 *
 * Everything here is exact. Nothing goes via `Number`, because the whole point
 * of the `Decimal` in `@particle-academy/fancy-trading` is that a price never
 * touches a float.
 */

import {
  type Decimal,
  add,
  dec,
  div,
  formatDecimal,
  mul,
  parseDecimal,
  rescale,
  sub,
} from "@particle-academy/fancy-trading";

export type PriceDisplay =
  /** Plain decimal with a fixed number of places. */
  | { kind: "decimal"; places: number }
  /**
   * Fractional notation — `110'165`, `550'4`.
   *
   * `denominator` is the fraction the whole part is divided into (32 for
   * Treasuries, 8 for grains). `subTicks` splits each of those again, so the
   * trailing digit of `110'165` is five eighths of a 32nd. Omit it for plain
   * 32nds (`110'16`).
   */
  | { kind: "fraction"; denominator: number; subTicks?: number; separator?: string }
  | { kind: "percent"; places: number }
  | { kind: "cents" };

/** Format a price in its instrument's notation. */
export function formatPrice(price: Decimal, display: PriceDisplay): string {
  switch (display.kind) {
    case "decimal":
      return formatDecimal(rescale(price, display.places, "half-up"));
    case "percent":
      return `${formatDecimal(rescale(mul(price, dec(100n, 0)), display.places, "half-up"))}%`;
    case "cents":
      return `${formatDecimal(rescale(mul(price, dec(100n, 0)), 0, "half-up"))}¢`;
    case "fraction":
      return formatFraction(price, display);
  }
}

function formatFraction(
  price: Decimal,
  display: Extract<PriceDisplay, { kind: "fraction" }>,
): string {
  const negative = price.v < 0n;
  const abs: Decimal = negative ? { v: -price.v, exp: price.exp } : price;
  const sep = display.separator ?? "'";
  const den = BigInt(display.denominator);
  const subs = BigInt(display.subTicks ?? 1);

  const whole = rescale(abs, 0, "floor");
  const remainder = sub(abs, whole);

  // Count the fraction in sub-tick units so both digits come from ONE exact
  // division. Doing the 32nds and then the eighths separately re-rounds twice
  // and drifts a sub-tick at the boundaries.
  const totalSubs = div(mul(remainder, dec(den * subs, 0)), dec(1n, 0), 0, "half-up");
  const ticks = totalSubs.v / subs;
  const sub2 = totalSubs.v % subs;

  const width = String(display.denominator - 1).length;
  const ticksText = ticks.toString().padStart(width, "0");
  const subText = display.subTicks ? sub2.toString() : "";

  return `${negative ? "-" : ""}${formatDecimal(whole)}${sep}${ticksText}${subText}`;
}

/**
 * Parse what {@link formatPrice} renders, plus a plain decimal — a trader types
 * both, and an order ticket that accepts only one of them is a ticket that
 * rejects correct input.
 *
 * `exp` is the scale of the result, which the caller knows from the instrument.
 */
export function parsePrice(text: string, display: PriceDisplay, exp: number): Decimal {
  const t = text.trim();
  if (t === "") throw new TypeError("empty price");

  if (display.kind === "percent" && t.endsWith("%")) {
    return div(parseDecimal(t.slice(0, -1).trim(), exp + 2), dec(100n, 0), exp, "half-up");
  }
  if (display.kind === "cents" && t.endsWith("¢")) {
    return div(parseDecimal(t.slice(0, -1).trim(), 0), dec(100n, 0), exp, "half-up");
  }

  if (display.kind === "fraction") {
    const sep = display.separator ?? "'";
    const idx = t.indexOf(sep);
    if (idx !== -1) {
      const negative = t.startsWith("-");
      const whole = t.slice(negative ? 1 : 0, idx);
      const fracText = t.slice(idx + 1);
      if (!/^\d+$/.test(whole) || !/^\d+$/.test(fracText)) {
        throw new TypeError(`not a fractional price: ${JSON.stringify(text)}`);
      }

      const width = String(display.denominator - 1).length;
      const subs = display.subTicks ?? 1;
      const ticksText = fracText.slice(0, width);
      const subText = display.subTicks ? fracText.slice(width) : "";

      const ticks = BigInt(ticksText.padEnd(width, "0"));
      const subValue = subText === "" ? 0n : BigInt(subText);

      if (ticks >= BigInt(display.denominator)) {
        throw new RangeError(
          `${ticksText} is not a valid ${display.denominator}nd — the fraction must be less than ${display.denominator}.`,
        );
      }
      if (subValue >= BigInt(subs)) {
        throw new RangeError(`${subText} is not a valid sub-tick — it must be less than ${subs}.`);
      }

      const totalSubs = ticks * BigInt(subs) + subValue;
      const fraction = div(
        dec(totalSubs, 0),
        dec(BigInt(display.denominator) * BigInt(subs), 0),
        exp,
        "half-up",
      );
      const value = add(parseDecimal(whole, exp), fraction);
      return negative ? { v: -value.v, exp: value.exp } : value;
    }
  }

  // Fall through to a plain decimal, rescaled to the instrument's precision.
  const asDecimal = /^[+-]?\d*(\.\d*)?$/.test(t);
  if (!asDecimal) throw new TypeError(`not a price: ${JSON.stringify(text)}`);
  const places = t.includes(".") ? t.split(".")[1]!.length : 0;
  return rescale(parseDecimal(t, Math.max(places, exp)), exp, "half-up");
}

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** `1234567.89` -> `1,234,567.89`. Exact — the digits come from the Decimal. */
export function formatMoney(value: Decimal, options: { currency?: string } = {}): string {
  const text = formatDecimal(value);
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole = "0", frac] = body.split(".");
  const grouped = whole.replace(GROUP, ",") + (frac ? `.${frac}` : "");
  return `${negative ? "-" : ""}${options.currency ?? ""}${grouped}`;
}

/**
 * Money that always shows its sign when non-zero.
 *
 * A P&L column where `+120.00` and `120.00` look the same has thrown away the
 * one thing the column exists to say. Zero is rendered bare, because `+0.00` is
 * a claim and zero is not.
 */
export function formatSignedMoney(value: Decimal, options: { currency?: string } = {}): string {
  const text = formatMoney(value, options);
  if (value.v > 0n) return `+${text}`;
  return text;
}

/** Quantities: exact, grouped, and never given a currency symbol. */
export function formatQty(value: Decimal): string {
  return formatMoney(value);
}
