/**
 * The chart.
 *
 * What is covered here is everything that is NOT rasterisation: the session
 * model, the tick path, windowing, the Group A geometry, the drawing model, the
 * attribution default, and the seam. What is not covered is the canvas itself —
 * jsdom has no 2D context, and the honest thing is to say so rather than to
 * pull in a native canvas binding nobody approved. The component detects that
 * and renders a limitation notice instead of throwing, which is also what
 * server-side rendering needs.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CME_EQUITY_INDEX_EST,
  CRYPTO_24_7,
  DECORATION_LAYERS,
  TradingChart,
  US_EQUITIES_EST,
  applyTick,
  canRenderCanvas,
  depthHeatmap,
  extendedRanges,
  haltRange,
  phaseOf,
  resolveChartOptions,
  resolveLevels,
  sessionBoundaryIndices,
  sessionKey,
  volumeProfileFromBars,
  volumeProfileFromPrints,
  windowBars,
  type Bar,
  type Drawing,
} from "../src/chart.ts";
import { render } from "./render.tsx";

/** Epoch seconds for a UTC wall-clock time. */
const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

describe("the session model", () => {
  test("US equities: pre-market, core and after-hours are distinguished", () => {
    // 08:00 ET = 13:00 UTC (standard time).
    expect(phaseOf(at("2026-08-20T13:00:00Z"), US_EQUITIES_EST)).toBe("pre");
    expect(phaseOf(at("2026-08-20T15:00:00Z"), US_EQUITIES_EST)).toBe("core");
    expect(phaseOf(at("2026-08-20T22:00:00Z"), US_EQUITIES_EST)).toBe("after");
    expect(phaseOf(at("2026-08-20T02:00:00Z"), US_EQUITIES_EST)).toBe("closed");
  });

  test("a weekend is closed", () => {
    // 2026-08-22 is a Saturday.
    expect(phaseOf(at("2026-08-22T15:00:00Z"), US_EQUITIES_EST)).toBe("closed");
  });

  test("a holiday is closed even on a weekday", () => {
    const withHoliday = { ...US_EQUITIES_EST, holidays: ["2026-08-20"] };
    expect(phaseOf(at("2026-08-20T15:00:00Z"), withHoliday)).toBe("closed");
  });

  test("crypto has no sessions at all", () => {
    expect(phaseOf(at("2026-08-22T03:00:00Z"), CRYPTO_24_7)).toBe("core");
  });

  test("THE FUTURES DAY STARTS AT 18:00 ET, NOT MIDNIGHT", () => {
    // The test that fails against `toISOString().slice(0, 10)`, which is what
    // everyone writes. A 19:00 ET bar on Monday belongs to TUESDAY's session,
    // and a volume profile keyed on the calendar date puts it in the wrong day
    // every single evening (§2.7.6).
    const mondayEvening = at("2026-08-24T23:00:00Z"); // 19:00 ET Monday
    const tuesdayMorning = at("2026-08-25T14:00:00Z"); // 10:00 ET Tuesday

    expect(sessionKey(mondayEvening, CME_EQUITY_INDEX_EST)).toBe("2026-08-25");
    expect(sessionKey(tuesdayMorning, CME_EQUITY_INDEX_EST)).toBe("2026-08-25");
    // Both in the same session, which is the whole point.
    expect(sessionKey(mondayEvening, CME_EQUITY_INDEX_EST)).toBe(
      sessionKey(tuesdayMorning, CME_EQUITY_INDEX_EST),
    );

    // And the naive answer, asserted as a fact about the wrong version:
    expect(new Date(mondayEvening * 1000).toISOString().slice(0, 10)).toBe("2026-08-24");
  });

  test("without a session start, the session IS the calendar day", () => {
    expect(sessionKey(at("2026-08-20T15:00:00Z"), US_EQUITIES_EST)).toBe("2026-08-20");
  });

  test("a separator goes where the session changes, and never before the first bar", () => {
    const times = [
      at("2026-08-20T14:00:00Z"),
      at("2026-08-20T15:00:00Z"),
      at("2026-08-21T14:00:00Z"),
    ];
    expect(sessionBoundaryIndices(times, US_EQUITIES_EST)).toEqual([2]);
  });

  test("extended-hours runs are grouped, so they shade as blocks", () => {
    const times = [
      at("2026-08-20T13:00:00Z"), // pre
      at("2026-08-20T13:30:00Z"), // pre
      at("2026-08-20T15:00:00Z"), // core
      at("2026-08-20T21:00:00Z"), // after
    ];
    const ranges = extendedRanges(times, US_EQUITIES_EST);
    expect(ranges).toEqual([
      { fromIndex: 0, toIndex: 1, phase: "pre" },
      { fromIndex: 3, toIndex: 3, phase: "after" },
    ]);
  });
});

describe("halts are bands, never a flat line", () => {
  const times = [at("2026-08-20T15:00:00Z"), at("2026-08-20T15:30:00Z"), at("2026-08-20T16:00:00Z")];

  test("a halt with prints inside it covers those bars", () => {
    const range = haltRange(times, { from: times[1]! - 60, to: times[1]! + 60 });
    expect(range).toEqual({ fromIndex: 1, toIndex: 1, inclusive: true });
  });

  test("a halt with NO prints anchors to the surrounding bars, and says so", () => {
    // The usual case: a halted market produces no prints. Returning an empty
    // range would render as nothing, and drawing a line at the last price would
    // imply a market trading flat.
    const range = haltRange(times, { from: times[0]! + 60, to: times[1]! - 60 });
    expect(range).toEqual({ fromIndex: 0, toIndex: 1, inclusive: false });
  });

  test("a halt entirely outside the series has no range", () => {
    expect(haltRange(times, { from: 0, to: 1 })).toBeNull();
  });
});

describe("the live tick path", () => {
  // Bucket-aligned: 1_700_000_040 is exactly 28,333,334 minutes. A bar whose
  // time is not on the interval grid can never be matched by a later tick,
  // which is worth knowing before you debug it in a live feed.
  const OPEN = 1_700_000_040;

  const bar = (time: number, price: string): Bar => ({
    time,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: "10",
  });

  test("a tick inside the bucket UPDATES the forming bar", () => {
    // The operation the whole engine decision turned on. It returns the single
    // changed bar so the caller can call series.update() rather than setData().
    const bars = [bar(OPEN, "100.00")];
    const r = applyTick(bars, { time: OPEN + 30, price: "101.00", size: "5" }, 60);
    expect(r.effect).toBe("update");
    expect(r.bars.length).toBe(1);
    expect(r.bar.high).toBe("101.00");
    expect(r.bar.close).toBe("101.00");
    expect(r.bar.volume).toBe("15");
  });

  test("the low moves too, and the open never does", () => {
    const bars = [bar(OPEN, "100.00")];
    const r = applyTick(bars, { time: OPEN + 30, price: "99.00" }, 60);
    expect(r.bar.low).toBe("99.00");
    expect(r.bar.open).toBe("100.00");
  });

  test("a tick past the bucket APPENDS", () => {
    const bars = [bar(OPEN, "100.00")];
    const r = applyTick(bars, { time: OPEN + 120, price: "101.00" }, 60);
    expect(r.effect).toBe("append");
    expect(r.bars.length).toBe(2);
    expect(r.bar.time).toBe(OPEN + 120);
  });

  test("IT NEVER INTERPOLATES ACROSS A SESSION BREAK", () => {
    // A tick that belongs to a new session starts a new bar even when it falls
    // inside the previous bar's time bucket. A bar spanning a weekend is not a
    // bar (§2.7.5).
    const friday = at("2026-08-21T19:59:00Z");
    const monday = at("2026-08-24T13:31:00Z");
    const bars = [bar(Math.floor(friday / 86_400) * 86_400, "100.00")];
    const r = applyTick(bars, { time: monday, price: "101.00" }, 86_400, US_EQUITIES_EST);
    expect(r.effect).toBe("append");
  });
});

describe("windowing is mandatory, not an optimisation", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: "1",
    high: "1",
    low: "1",
    close: "1",
  }));

  test("it keeps the most RECENT bars", () => {
    const kept = windowBars(many, 10);
    expect(kept.length).toBe(10);
    expect(kept[0]!.time).toBe(many[90]!.time);
    expect(kept.at(-1)!.time).toBe(many.at(-1)!.time);
  });

  test("a short series is untouched", () => {
    expect(windowBars(many, 500).length).toBe(100);
  });

  test("the default is FINITE — 'keep everything' is not a neutral default", () => {
    const huge = Array.from({ length: 6000 }, (_, i) => ({
      time: i,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
    }));
    expect(windowBars(huge).length).toBe(5000);
  });

  test("the chart SAYS what it dropped, rather than silently showing less", () => {
    const h = render(
      <TradingChart mode="sim" symbol="ES" bars={many} maxBars={10} />,
    );
    expect(h.text()).toContain("90 older bar");
    h.unmount();
  });
});

describe("volume profile — Group A, and honest about its provenance", () => {
  const scales = { priceExp: 2, qtyExp: 0, bucketSize: "1.00" };

  test("from prints it is a MEASUREMENT", () => {
    const p = volumeProfileFromPrints(
      [
        { price: "100.20", size: "5" },
        { price: "100.80", size: "7" },
        { price: "101.10", size: "3" },
      ],
      scales,
    );
    expect(p.approximate).toBe(false);
    expect(p.bins).toEqual([
      { price: "101.00", volume: "3" },
      { price: "100.00", volume: "12" },
    ]);
    expect(p.pointOfControl).toBe("100.00");
    expect(p.total).toBe("15");
  });

  test("from bars it is a RECONSTRUCTION, and says so", () => {
    // OHLCV records where price went, not where the volume happened inside the
    // bar. Spreading it uniformly is the only guess available — and a
    // reconstruction that looks like a measurement is the tape's
    // inferred-aggressor problem in a different costume.
    const p = volumeProfileFromBars(
      [{ time: 1, open: "100.00", high: "102.00", low: "100.00", close: "101.00", volume: "90" }],
      scales,
    );
    expect(p.approximate).toBe(true);
    expect(p.bins.map((b) => b.volume)).toEqual(["30", "30", "30"]);
  });

  test("the reconstruction still sums to the bar's volume", () => {
    // 100 across 3 buckets does not divide; the remainder must not vanish.
    const p = volumeProfileFromBars(
      [{ time: 1, open: "100.00", high: "102.00", low: "100.00", close: "101.00", volume: "100" }],
      scales,
    );
    expect(p.total).toBe("100");
  });

  test("bars with no volume contribute nothing rather than zero-filling", () => {
    const p = volumeProfileFromBars(
      [{ time: 1, open: "100.00", high: "102.00", low: "100.00", close: "101.00" }],
      scales,
    );
    expect(p.bins).toEqual([]);
    expect(p.pointOfControl).toBeNull();
  });

  test("the chart labels an approximated profile in its chrome AND in the body", () => {
    const h = render(
      <TradingChart
        mode="sim"
        symbol="ES"
        bars={[{ time: 1, open: "100.00", high: "102.00", low: "100.00", close: "101.00", volume: "90" }]}
        approximateProfileFromBars
        profileBucketSize="1.00"
      />,
    );
    expect(h.find("[data-fancy-trading-chart-profile]")!.dataset.fancyTradingChartProfile).toBe(
      "approximate",
    );
    expect(h.text()).toContain("reconstructed from OHLCV");
    h.unmount();
  });
});

describe("depth heatmap — Group A on both axes", () => {
  test("cells are bucketed and intensity is normalised against the largest", () => {
    const h = depthHeatmap(
      [
        { time: 1, levels: [{ price: "100.10", size: "50" }, { price: "100.90", size: "50" }] },
        { time: 2, levels: [{ price: "100.10", size: "25" }] },
      ],
      { priceExp: 2, qtyExp: 0, bucketSize: "1.00" },
    );
    expect(h.max).toBe("100");
    const first = h.cells.find((c) => c.time === 1)!;
    expect(first.price).toBe("100.00");
    expect(first.size).toBe("100");
    expect(first.intensity).toBe(1);
    expect(h.cells.find((c) => c.time === 2)!.intensity).toBe(0.25);
  });

  test("an empty book produces no cells and does not divide by zero", () => {
    const h = depthHeatmap([], { priceExp: 2, qtyExp: 0, bucketSize: "1.00" });
    expect(h.cells).toEqual([]);
    expect(h.max).toBe("0");
  });
});

describe("drawings are data", () => {
  const drawing: Drawing = {
    id: "d1",
    kind: "levels",
    from: { time: 1, price: "100.00" },
    to: { time: 2, price: "110.00" },
    ratios: [0, 0.5, 1],
  };

  test("they survive JSON, so an agent can emit one verbatim", () => {
    expect(JSON.parse(JSON.stringify(drawing))).toEqual(drawing);
  });

  test("levels resolve to exact prices, not to a float round trip", () => {
    expect(resolveLevels(drawing, 2)).toEqual([
      { ratio: 0, price: "100.00" },
      { ratio: 0.5, price: "105.00" },
      { ratio: 1, price: "110.00" },
    ]);
  });

  test("we ship no default ratio set — 'the usual Fibonacci levels' is a convention with versions", () => {
    const ratios = (drawing as Extract<Drawing, { kind: "levels" }>).ratios;
    expect(ratios).toEqual([0, 0.5, 1]);
  });
});

describe("attribution", () => {
  test("attributionLogo DEFAULTS TO TRUE", () => {
    // Silently defaulting it to false transfers a licence obligation to a
    // consumer who never saw it. See NOTICE.
    expect(resolveChartOptions({}).attributionLogo).toBe(true);
  });

  test("a deliberate false is honoured, and NOT coerced back", () => {
    expect(resolveChartOptions({ attributionLogo: false }).attributionLogo).toBe(false);
  });

  test("the chart reports which it is, on the element", () => {
    const on = render(<TradingChart mode="sim" symbol="ES" bars={[]} />);
    expect(on.find("[data-fancy-trading-chart]")!.dataset.attributionLogo).toBe("on");
    on.unmount();

    const off = render(<TradingChart mode="sim" symbol="ES" bars={[]} attributionLogo={false} />);
    expect(off.find("[data-fancy-trading-chart]")!.dataset.attributionLogo).toBe("off");
    off.unmount();
  });

  test("turning it off surfaces what the consumer now owes, on the page", () => {
    const h = render(<TradingChart mode="sim" symbol="ES" bars={[]} attributionLogo={false} />);
    expect(h.text()).toContain("tradingview.com");
    expect(h.text()).toContain("NOTICE");
    h.unmount();
  });

  test("the NOTICE file ships the exact bytes, Cyrillic ES and all", () => {
    // The (c) in TradingView's notice is U+0441 CYRILLIC SMALL LETTER ES, not a
    // Latin c, so a retyped copy is a different string and `grep "(c)"` will
    // not find it. This asserts the codepoint rather than the glyph.
    const notice = readFileSync(join(import.meta.dirname, "..", "NOTICE"), "utf8");
    expect(notice).toContain("TradingView Lightweight Charts™");
    expect(notice).toContain("Copyright (с) 2025 TradingView, Inc.");
    expect(notice).toContain("https://www.tradingview.com/");
    expect(notice.includes("Copyright (c) 2025 TradingView")).toBe(false);
  });
});

describe("a session separator is drawn ABOVE the shading", () => {
  test("the separator layer is not the shading layer", () => {
    // Regression tripwire. Drawn in the same `bottom` layer, a dashed grey
    // separator over an extended-hours block is technically drawn and
    // practically invisible — which is exactly the failure §2.7.2 exists to
    // prevent. Caught by looking at a real render in a browser; jsdom has no
    // canvas and could never have caught it, so this pins the DECISION instead.
    expect(DECORATION_LAYERS.sessionSeparator).not.toBe(DECORATION_LAYERS.extendedHours);
    expect(DECORATION_LAYERS.sessionSeparator).toBe("normal");
  });

  test("the shading and the halt bands stay behind the candles", () => {
    // The other half: shading in front of the candles would hide the thing the
    // chart is for.
    expect(DECORATION_LAYERS.extendedHours).toBe("bottom");
    expect(DECORATION_LAYERS.haltBand).toBe("bottom");
  });
});

describe("the engine seam holds", () => {
  const SRC = join(import.meta.dirname, "..", "src");

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...sources(path));
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }

  test("exactly ONE source file imports lightweight-charts", () => {
    // §1.10: the renderer sits behind one internal module, so a consumer with a
    // licensed Advanced Charts grant replaces that module. The seam is only
    // worth anything while it holds, and nothing but this test holds it.
    const importers = sources(SRC).filter((file) =>
      /from\s+["']lightweight-charts["']/.test(readFileSync(file, "utf8")),
    );
    expect(importers.map((f) => f.split(/[\\/]/).pop())).toEqual(["engine.ts"]);
  });

  test("no source file imports fancy-canvas, which is a TRANSITIVE dependency", () => {
    const importers = sources(SRC).filter((file) =>
      /from\s+["']fancy-canvas["']/.test(readFileSync(file, "utf8")),
    );
    expect(importers).toEqual([]);
  });

  test("the ROOT entry does not reach the chart, so a ticket pulls in no engine", () => {
    // Checked on the IMPORTS, not on the prose: the entry point's doc comment
    // names the engine on purpose, to say where it is not.
    const root = readFileSync(join(SRC, "index.ts"), "utf8");
    const imports = root.match(/from\s+["'][^"']+["']/g) ?? [];
    expect(imports.filter((i) => i.includes("lightweight-charts"))).toEqual([]);
    expect(imports.filter((i) => /["']\.\/chart/.test(i))).toEqual([]);
  });
});

describe("an environment with no canvas is handled, not crashed into", () => {
  test("jsdom cannot rasterise, and the component says so instead of throwing", () => {
    // Also the SSR path: a server has no canvas either, and a chart that throws
    // during render takes the whole page with it.
    expect(canRenderCanvas()).toBe(false);
    const h = render(<TradingChart mode="sim" symbol="ES" bars={[]} />);
    expect(h.text()).toContain("no 2D canvas");
    h.unmount();
  });

  test("the chrome still renders, with the mode marker intact", () => {
    const h = render(<TradingChart mode="live" symbol="ES" bars={[]} />);
    expect(h.find("[data-fancy-trading-mode='live']")).not.toBeNull();
    h.unmount();
  });
});

describe("the chart broadcasts what it did", () => {
  test("fitting the range emits activity", () => {
    const emitter = vi.fn();
    const h = render(<TradingChart mode="sim" symbol="ES" bars={[]} activity={emitter} />);
    const button = h.find("[data-fancy-trading-chart-fit]")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(emitter.mock.calls.at(-1)![0].action).toBe("trading_chart_set_range");
    h.unmount();
  });
});
