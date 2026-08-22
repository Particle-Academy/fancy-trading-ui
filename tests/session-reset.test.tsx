/**
 * §2.7 point 6 — **volume profile and delta reset per session**, and "session"
 * is instrument-specific.
 *
 * The primitives for this existed and were correct: `sessionKey()` knows the
 * futures day starts at 18:00 ET, and `groupBySession()` splits a series. What
 * did not exist was the WIRING — `<TradingChart>` computed one profile over the
 * whole window and `cumulativeDelta()` summed whatever it was handed. A correct
 * primitive nothing calls is the same as no primitive, and it is worse, because
 * it reads as done.
 *
 * The failure is quiet and cumulative: yesterday's volume sits under today's
 * profile and the point of control drifts toward a level nobody traded today.
 */
import { describe, expect, test } from "vitest";
import {
  CME_EQUITY_INDEX_EST,
  TradingChart,
  US_EQUITIES_EST,
  volumeProfileFromBars,
  type Bar,
} from "../src/chart.ts";
import { TimeAndSales, cumulativeDelta, type TapePrint } from "../src/index.ts";
import type { TicketInstrument } from "../src/index.ts";
import { render } from "./render.tsx";

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Two sessions of one bar each: Thursday 11:00 ET, then Friday 11:00 ET. */
const DAY_ONE = at("2026-08-20T15:00:00Z");
const DAY_TWO = at("2026-08-21T15:00:00Z");

const bar = (time: number, volume: string): Bar => ({
  time,
  open: "100.00",
  high: "100.00",
  low: "100.00",
  close: "100.00",
  volume,
});

const ES: TicketInstrument = {
  id: "ESU6",
  symbol: "ESU6",
  priceExp: 2,
  qtyExp: 0,
  priceDisplay: { kind: "decimal", places: 2 },
  tickSize: "0.25",
  multiplier: "50",
  contractType: "linear",
};

describe("the volume profile covers ONE session, not everything on screen", () => {
  const bars = [bar(DAY_ONE, "900"), bar(DAY_TWO, "100")];

  test("with a calendar, the profile is the CURRENT session only", () => {
    const h = render(
      <TradingChart
        mode="sim"
        symbol="ESU6"
        bars={bars}
        calendar={US_EQUITIES_EST}
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    // Only Friday's 100 — yesterday's 900 belongs to yesterday's profile.
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileTotal).toBe("100");
    h.unmount();
  });

  test("the chrome SAYS which session it covers, so the number is readable", () => {
    const h = render(
      <TradingChart
        mode="sim"
        symbol="ESU6"
        bars={bars}
        calendar={US_EQUITIES_EST}
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileScope).toBe("session");
    expect(h.text()).toContain("2026-08-21");
    h.unmount();
  });

  test("`window` scope is available and is honestly labelled", () => {
    // Someone genuinely wanting the whole visible range can ask for it. What
    // they cannot have is that behaviour unlabelled.
    const h = render(
      <TradingChart
        mode="sim"
        symbol="ESU6"
        bars={bars}
        calendar={US_EQUITIES_EST}
        profileScope="window"
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileTotal).toBe("1000");
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileScope).toBe("window");
    h.unmount();
  });

  test("with NO calendar there is no session to reset on, and it says window", () => {
    const h = render(
      <TradingChart
        mode="sim"
        symbol="ESU6"
        bars={bars}
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileScope).toBe("window");
    h.unmount();
  });

  test("THE FUTURES SESSION IS NOT THE CALENDAR DAY, and the profile follows it", () => {
    // 19:00 ET Monday and 10:00 ET Tuesday are ONE session on CME. A profile
    // keyed on the calendar date splits them, and does so every single evening.
    const monEvening = at("2026-08-24T23:00:00Z");
    const tueMorning = at("2026-08-25T14:00:00Z");
    const futures = [bar(monEvening, "400"), bar(tueMorning, "600")];

    const h = render(
      <TradingChart
        mode="sim"
        symbol="ESU6"
        bars={futures}
        calendar={CME_EQUITY_INDEX_EST}
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    // Both bars, because both are Tuesday's session.
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.profileTotal).toBe("1000");
    h.unmount();
  });

  test("the underlying function is unchanged — the wiring was the gap", () => {
    // `volumeProfileFromBars` was always correct over whatever it was given.
    expect(volumeProfileFromBars([bar(DAY_TWO, "100")], { priceExp: 2, qtyExp: 0, bucketSize: "1.00" }).total).toBe("100");
  });
});

describe("cumulative delta resets per session too", () => {
  const print = (time: number, aggressor: "buy" | "sell", size: string): TapePrint => ({
    id: `${time}-${aggressor}-${size}`,
    at: time * 1000,
    price: "100.00",
    size,
    aggressor,
    aggressorSource: "venue",
  });

  const prints = [
    print(DAY_TWO, "buy", "10"),
    print(DAY_ONE, "buy", "500"),
    print(DAY_ONE, "sell", "200"),
  ];

  test("without a calendar it sums everything, as before", () => {
    expect(cumulativeDelta(prints, 0).delta).toBe("310");
  });

  test("with a calendar it covers the LATEST session only", () => {
    // Yesterday's +300 has nothing to do with today's order flow, and carrying
    // it makes today's delta unreadable in exactly the way that matters — the
    // sign can be wrong all session.
    const d = cumulativeDelta(prints, 0, US_EQUITIES_EST);
    expect(d.delta).toBe("10");
    expect(d.session).toBe("2026-08-21");
  });

  test("the count of contributing prints follows the same boundary", () => {
    expect(cumulativeDelta(prints, 0, US_EQUITIES_EST).prints).toBe(1);
  });

  test("the tape says which session its delta covers", () => {
    const h = render(
      <TimeAndSales mode="sim" instrument={ES} prints={prints} calendar={US_EQUITIES_EST} />,
    );
    const badge = h.find("[data-fancy-trading-tape-delta]")!;
    expect(badge.dataset.fancyTradingTapeDelta).toBe("10");
    expect(badge.getAttribute("title")).toContain("2026-08-21");
    h.unmount();
  });

  test("without a calendar the tape does not CLAIM a session", () => {
    // Saying "session delta" over an all-time sum would be the same lie as an
    // approximated profile presented as measured.
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={prints} />);
    const badge = h.find("[data-fancy-trading-tape-delta]")!;
    expect(badge.dataset.fancyTradingTapeDelta).toBe("310");
    expect(badge.getAttribute("title")).not.toContain("session");
    h.unmount();
  });

  test("the inference provenance still travels with the session-scoped delta", () => {
    const mixed = [
      { ...print(DAY_TWO, "buy", "10"), aggressorSource: "inferred" as const },
      print(DAY_ONE, "sell", "999"),
    ];
    const d = cumulativeDelta(mixed, 0, US_EQUITIES_EST);
    expect(d.delta).toBe("10");
    expect(d.inferredPrints).toBe(1);
    expect(d.inferredVolume).toBe("10");
  });
});
