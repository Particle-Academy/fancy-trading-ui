/**
 * §2.7 — halts, and the vocabulary a US equities chart needs to render one
 * honestly.
 *
 * A `Halt` was `{ from, to, reason }`, which cannot express the distinction
 * that matters: **a LULD Limit State is not a pause.** During a Limit State the
 * market is still trading — it just cannot print outside the band — and it
 * lasts 15 seconds before it either resolves or becomes a five-minute pause.
 * Drawing the two identically tells a trader the market stopped when it did
 * not, and tells them it is coming back in five minutes when it may resolve in
 * fifteen seconds.
 *
 * **What this package does and does not do.** It renders what it is told. It
 * does NOT compute LULD bands: the reference price is a five-minute rolling
 * mean updated only on a 1%-or-greater move, the percentage depends on tier and
 * price band and DOUBLES in the last 25 minutes, and every input to that is
 * market data. Computing it here would be inventing numbers; a host that has
 * the feed passes them in.
 */
import { describe, expect, test } from "vitest";
import { TradingChart, US_EQUITIES_EST, describeHalt, type Bar, type Halt } from "../src/chart.ts";
import { render } from "./render.tsx";

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const bars: Bar[] = [
  { time: at("2026-08-20T15:00:00Z"), open: "100", high: "100", low: "100", close: "100" },
  { time: at("2026-08-20T15:05:00Z"), open: "100", high: "100", low: "100", close: "100" },
  { time: at("2026-08-20T15:10:00Z"), open: "100", high: "100", low: "100", close: "100" },
];

const chart = (halts: Halt[]) => (
  <TradingChart mode="sim" symbol="AAPL" bars={bars} calendar={US_EQUITIES_EST} halts={halts} />
);

describe("a Limit State is not a pause, and does not read like one", () => {
  const window = { from: bars[0]!.time + 60, to: bars[1]!.time - 60 };

  test("a pause says the market STOPPED", () => {
    expect(describeHalt({ ...window, kind: "luld-pause" })).toContain("HALTED");
    expect(describeHalt({ ...window, kind: "luld-pause" }).toLowerCase()).toContain("five minutes");
  });

  test("a limit state says the market is STILL TRADING", () => {
    // The distinction the old model could not carry. A trader who reads "halted"
    // during a Limit State believes they cannot get out, and they can.
    const text = describeHalt({ ...window, kind: "luld-limit-state" });
    expect(text).toContain("LIMIT STATE");
    expect(text.toLowerCase()).toContain("still trading");
    expect(text.toLowerCase()).toContain("15 seconds");
    expect(text).not.toContain("HALTED");
  });

  test("a market-wide circuit breaker names itself, because the cause is not this symbol", () => {
    const text = describeHalt({ ...window, kind: "market-wide" });
    expect(text.toLowerCase()).toContain("market-wide");
    expect(text).toContain("HALTED");
  });

  test("a maintenance break is not a halt at all", () => {
    // CME's daily break and Kalshi's weekly window are scheduled, not an event.
    // Calling them halts makes every futures chart look like it broke nightly.
    const text = describeHalt({ ...window, kind: "maintenance" });
    expect(text.toLowerCase()).toContain("scheduled");
    expect(text).not.toContain("HALTED");
  });

  test("an unspecified kind still renders, and does not invent a cause", () => {
    // Back-compatible: a `Halt` with no kind is what every caller wrote before.
    const text = describeHalt(window);
    expect(text).toContain("HALTED");
    expect(text.toLowerCase()).not.toContain("luld");
    expect(text.toLowerCase()).not.toContain("market-wide");
  });

  test("the venue's own reason is carried verbatim when there is one", () => {
    expect(describeHalt({ ...window, kind: "news", reason: "pending announcement" })).toContain(
      "pending announcement",
    );
  });
});

describe("the band a trader could not print outside is shown when it is known", () => {
  const window = { from: bars[0]!.time + 60, to: bars[1]!.time - 60 };

  test("LULD limits render on the label when the host supplies them", () => {
    const text = describeHalt({
      ...window,
      kind: "luld-limit-state",
      band: { lower: "98.50", upper: "101.50" },
    });
    expect(text).toContain("98.50");
    expect(text).toContain("101.50");
  });

  test("and are simply absent when it does not — nothing is computed here", () => {
    // The reference price is a five-minute rolling mean updated only on a
    // 1%-or-greater move, and the percentage doubles in the closing 25 minutes.
    // Guessing any of that would be inventing a number and printing it beside
    // real ones.
    const text = describeHalt({ ...window, kind: "luld-limit-state" });
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/\bNaN\b/);
  });
});

describe("the chart draws them as bands with the right words", () => {
  test("a limit state reaches the chart labelled as one", () => {
    const h = render(
      chart([{ from: bars[0]!.time + 60, to: bars[1]!.time - 60, kind: "luld-limit-state" }]),
    );
    // jsdom cannot rasterise, so the label is asserted where it is computed:
    // on the surface, as the band's own text.
    expect(h.find("[data-fancy-trading-chart]")!.dataset.bands).toContain("LIMIT STATE");
    h.unmount();
  });

  test("two halts of different kinds do not collapse into one word", () => {
    const h = render(
      chart([
        { from: bars[0]!.time + 60, to: bars[0]!.time + 120, kind: "luld-limit-state" },
        { from: bars[1]!.time + 60, to: bars[1]!.time + 120, kind: "luld-pause" },
      ]),
    );
    const labels = h.find("[data-fancy-trading-chart]")!.dataset.bands ?? "";
    expect(labels).toContain("LIMIT STATE");
    expect(labels).toContain("HALTED");
    h.unmount();
  });

  test("no halts, no bands", () => {
    const h = render(chart([]));
    expect(h.find("[data-fancy-trading-chart]")!.dataset.bands).toBe("");
    h.unmount();
  });
});
