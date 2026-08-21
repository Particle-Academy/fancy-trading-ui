/**
 * The bar model, the live tick path, and windowing.
 *
 * Two things here are the reason the chart is ours rather than the engine's.
 *
 * **Windowing is mandatory, not an optimisation.** §1.6 measured it: the
 * dominant live operation is updating the FORMING bar, many times a second, and
 * the cost of that scales with what the series holds. A chart that accumulates
 * every bar it has ever seen degrades until it drops frames, and it does so
 * gradually enough that nobody notices which change caused it.
 *
 * **Prices are decimal STRINGS here and become numbers only at the rasteriser.**
 * A canvas takes floats and there is no way around that — but the conversion
 * happens in exactly one place (`engine.ts`), so nothing upstream of the pixels
 * has quietly been through a double. The order path never touches these values.
 */

import { type Decimal, cmp, parseDecimal, formatDecimal, add } from "@particle-academy/fancy-trading";
import { sessionKey, type SessionCalendar } from "./sessions.ts";

export type Bar = {
  /** Epoch **seconds**, UTC — lightweight-charts' `UTCTimestamp`. */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

export type Tick = {
  /** Epoch seconds. */
  time: number;
  price: string;
  size?: string;
};

/**
 * Keep only the most recent `maxBars`.
 *
 * The default is deliberately finite. An unbounded series is the shape the
 * measurement in §1.6 was taken against, and "keep everything" is not a neutral
 * default — it is a choice to get slower forever.
 */
export function windowBars(bars: readonly Bar[], maxBars = 5000): Bar[] {
  return bars.length <= maxBars ? bars.slice() : bars.slice(bars.length - maxBars);
}

export type ApplyTickResult = {
  bars: Bar[];
  /** `"update"` touched the forming bar; `"append"` started a new one. */
  effect: "update" | "append";
  /** The bar that changed, so a caller can hand it straight to `series.update()`. */
  bar: Bar;
};

/**
 * Fold a tick into a bar series.
 *
 * This is the operation the whole engine decision turned on — 2.36 ms against
 * lightweight-charts, and no update-in-place API at all in ECharts (§1.5) — so
 * it returns the single changed bar rather than a new series, letting the
 * caller call `series.update(bar)` instead of `setData(everything)`.
 *
 * **It never interpolates across a session break.** A tick that belongs to a
 * new session starts a new bar even if it falls inside the previous bar's time
 * bucket, because a bar spanning a weekend is not a bar (§2.7).
 */
export function applyTick(
  bars: readonly Bar[],
  tick: Tick,
  intervalSeconds: number,
  calendar?: SessionCalendar,
): ApplyTickResult {
  const bucket = Math.floor(tick.time / intervalSeconds) * intervalSeconds;
  const last = bars[bars.length - 1];

  const sameSession =
    !calendar || !last || sessionKey(last.time, calendar) === sessionKey(tick.time, calendar);

  if (last && last.time === bucket && sameSession) {
    const price = parseDecimal(tick.price, scaleOf(tick.price, last.close));
    const high = cmp(price, parseDecimal(last.high, price.exp)) > 0 ? tick.price : last.high;
    const low = cmp(price, parseDecimal(last.low, price.exp)) < 0 ? tick.price : last.low;
    const volume = addVolume(last.volume, tick.size);
    const updated: Bar = { ...last, high, low, close: tick.price, volume };
    return { bars: [...bars.slice(0, -1), updated], effect: "update", bar: updated };
  }

  const appended: Bar = {
    time: bucket,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: tick.size,
  };
  return { bars: [...bars, appended], effect: "append", bar: appended };
}

function scaleOf(...values: string[]): number {
  return values.reduce((max, v) => {
    const dot = v.indexOf(".");
    return Math.max(max, dot === -1 ? 0 : v.length - dot - 1);
  }, 0);
}

function addVolume(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const exp = scaleOf(a, b);
  return formatDecimal(add(parseDecimal(a, exp), parseDecimal(b, exp)));
}

/**
 * Group bars into sessions. Volume profile and cumulative delta reset per
 * session, and "session" is instrument-specific (§2.7).
 */
export function groupBySession(
  bars: readonly Bar[],
  calendar: SessionCalendar,
): Map<string, Bar[]> {
  const out = new Map<string, Bar[]>();
  for (const bar of bars) {
    const key = sessionKey(bar.time, calendar);
    out.set(key, [...(out.get(key) ?? []), bar]);
  }
  return out;
}

/** Highest high and lowest low across a range, exactly. */
export function priceRange(bars: readonly Bar[], priceExp: number): { high: Decimal; low: Decimal } | null {
  if (bars.length === 0) return null;
  let high = parseDecimal(bars[0]!.high, priceExp);
  let low = parseDecimal(bars[0]!.low, priceExp);
  for (const bar of bars) {
    const h = parseDecimal(bar.high, priceExp);
    const l = parseDecimal(bar.low, priceExp);
    if (cmp(h, high) > 0) high = h;
    if (cmp(l, low) < 0) low = l;
  }
  return { high, low };
}
