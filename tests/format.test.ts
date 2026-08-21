/**
 * Price display, and the case a decimal renderer turns into gibberish.
 *
 * §2.8: "`priceDisplayFormat` is **not derivable from tick size**: Treasuries
 * quote in 32nds and 64ths (`110'165`), grains in eighths, and a decimal
 * renderer produces gibberish."
 *
 * A trader reading `110.5195312` where they expect `110'165` does not merely
 * find it ugly — they read the wrong price, because 32nds notation has a
 * different magnitude at a glance.
 */
import { describe, expect, test } from "vitest";
import { parseDecimal, formatDecimal, type Decimal } from "@particle-academy/fancy-trading";
import {
  formatMoney,
  formatPrice,
  formatSignedMoney,
  parsePrice,
  type PriceDisplay,
} from "../src/format.ts";

const THIRTY_SECONDS: PriceDisplay = { kind: "fraction", denominator: 32, subTicks: 8 };
const EIGHTHS: PriceDisplay = { kind: "fraction", denominator: 8 };

describe("Treasury 32nds", () => {
  test("110.5195312 renders as 110'165, not as a decimal", () => {
    const p = parseDecimal("110.5195312", 7);
    expect(formatPrice(p, THIRTY_SECONDS)).toBe("110'165");
    // The failure being prevented, stated beside the fix:
    expect(formatDecimal(p)).toBe("110.5195312");
  });

  test("a whole handle has a zero-padded fraction, so the columns line up", () => {
    expect(formatPrice(parseDecimal("110.0000000", 7), THIRTY_SECONDS)).toBe("110'000");
  });

  test("half a handle is sixteen thirty-seconds", () => {
    expect(formatPrice(parseDecimal("110.5000000", 7), THIRTY_SECONDS)).toBe("110'160");
  });

  test("one thirty-second above the handle", () => {
    expect(formatPrice(parseDecimal("110.0312500", 7), THIRTY_SECONDS)).toBe("110'010");
  });

  test("without sub-ticks it is plain 32nds", () => {
    expect(
      formatPrice(parseDecimal("110.5000000", 7), { kind: "fraction", denominator: 32 }),
    ).toBe("110'16");
  });

  test("negative prices keep the sign outside the notation", () => {
    expect(formatPrice(parseDecimal("-110.5000000", 7), THIRTY_SECONDS)).toBe("-110'160");
  });
});

describe("grains in eighths", () => {
  test("550.5 is 550'4", () => {
    expect(formatPrice(parseDecimal("550.500", 3), EIGHTHS)).toBe("550'4");
  });
});

describe("parsePrice is the inverse, because a ticket must accept what it renders", () => {
  // 110'165 is exactly 110 + 133/256. Note the scale: at 7 decimal places that
  // value is not representable, so the fixture uses 8 — a fractional price
  // truncated to the "obvious" number of places is a DIFFERENT price, and this
  // is where that bites.
  const cases: Array<[string, PriceDisplay, string]> = [
    ["110'165", THIRTY_SECONDS, "110.51953125"],
    ["110'160", THIRTY_SECONDS, "110.50000000"],
    ["110'000", THIRTY_SECONDS, "110.00000000"],
    ["550'4", EIGHTHS, "550.500"],
  ];

  for (const [input, display, expected] of cases) {
    test(`${input} parses back`, () => {
      const parsed = parsePrice(input, display, expected.split(".")[1]!.length);
      expect(formatDecimal(parsed)).toBe(expected);
      // And round-trips, which is the property that actually matters.
      expect(formatPrice(parsed, display)).toBe(input);
    });
  }

  test("the notation is COARSER than the decimal, and does not pretend otherwise", () => {
    // Two different decimals inside the same sub-tick render identically. That
    // is a property of the notation, not a bug — but it means format -> parse
    // is not the identity, and code that assumes it is will quietly move a
    // price by a fraction of a tick on every edit.
    const a = parseDecimal("110.5195312", 7);
    const b = parseDecimal("110.5195313", 7);
    expect(formatPrice(a, THIRTY_SECONDS)).toBe(formatPrice(b, THIRTY_SECONDS));
    expect(a).not.toEqual(b);
  });

  test("a plain decimal is still accepted — traders type both", () => {
    expect(formatDecimal(parsePrice("110.5", THIRTY_SECONDS, 7))).toBe("110.5000000");
  });

  test("nonsense is refused rather than silently becoming zero", () => {
    expect(() => parsePrice("banana", THIRTY_SECONDS, 7)).toThrow();
    // A fraction digit outside the denominator is a typo, not a price.
    expect(() => parsePrice("110'32", { kind: "fraction", denominator: 32 }, 7)).toThrow();
  });
});

describe("event-contract notation", () => {
  test("cents, the way Kalshi quotes", () => {
    expect(formatPrice(parseDecimal("0.65", 2), { kind: "cents" })).toBe("65¢");
  });

  test("percent, the way Polymarket quotes", () => {
    expect(formatPrice(parseDecimal("0.6500", 4), { kind: "percent", places: 1 })).toBe("65.0%");
  });
});

describe("money", () => {
  test("groups thousands and keeps the scale exactly", () => {
    expect(formatMoney(parseDecimal("1234567.89", 2))).toBe("1,234,567.89");
  });

  test("P&L always carries its sign, including a positive one", () => {
    // A blotter where +120.00 and 120.00 look the same has thrown away the one
    // thing the column exists to say.
    expect(formatSignedMoney(parseDecimal("120.00", 2))).toBe("+120.00");
    expect(formatSignedMoney(parseDecimal("-120.00", 2))).toBe("-120.00");
    expect(formatSignedMoney(parseDecimal("0.00", 2))).toBe("0.00");
  });

  test("a currency prefix is applied without touching the digits", () => {
    const v: Decimal = parseDecimal("-1234.50", 2);
    expect(formatSignedMoney(v, { currency: "$" })).toBe("-$1,234.50");
  });
});
