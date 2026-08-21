/**
 * Volume profile and the depth heatmap — two of §1.10's **Group A** surfaces,
 * the ones that must share the chart's coordinate space.
 *
 * Group A is the whole argument for building on lightweight-charts directly.
 * These are meaningless unless they land on the *same* price and time axes as
 * the candles, and ECharts cannot render into another chart's coordinate space
 * at all — not slowly, at all. The geometry is here, engine-free; `engine.ts`
 * turns it into pane primitives that read `priceToCoordinate` from the same
 * scale the candles are drawn from.
 *
 * One honesty rule runs through the file. **A profile computed from OHLCV bars
 * is a reconstruction, not a measurement**, and the result says so
 * (`approximate: true`). A true volume profile needs trade prints. A component
 * that renders the two identically is the tape's inferred-aggressor problem in
 * a different costume.
 */

import {
  type Decimal,
  add,
  cmp,
  div,
  formatDecimal,
  mul,
  parseDecimal,
  rescale,
  sub,
} from "@particle-academy/fancy-trading";
import type { Bar } from "./bars.ts";

export type ProfileBin = {
  /** Lower edge of the bucket. */
  price: string;
  volume: string;
};

export type VolumeProfile = {
  bins: ProfileBin[];
  /**
   * The price bucket that traded the most. A statistic, not a suggestion — it
   * says where volume was, and nothing about where price is going.
   */
  pointOfControl: string | null;
  total: string;
  /**
   * `true` when the profile was reconstructed from OHLCV rather than measured
   * from prints. Render it differently: it is a guess about distribution WITHIN
   * each bar, and the guess is uniform because nothing better is available.
   */
  approximate: boolean;
  bucketSize: string;
};

export type ProfileScales = {
  priceExp: number;
  qtyExp: number;
  /** Bucket height. Usually the instrument's tick, or a multiple of it. */
  bucketSize: string;
};

type Bucket = { price: Decimal; volume: Decimal };

/** The lower edge of the bucket a price falls in. Exact, and floor-toward-minus. */
function bucketOf(price: Decimal, size: Decimal, priceExp: number): Decimal {
  const steps = div(price, size, 0, "floor");
  return rescale(mul(steps, size), priceExp, "trunc");
}

function collect(buckets: Map<string, Bucket>, price: Decimal, volume: Decimal, size: Decimal, priceExp: number): void {
  const key = formatDecimal(bucketOf(price, size, priceExp));
  const existing = buckets.get(key);
  buckets.set(key, {
    price: parseDecimal(key, priceExp),
    volume: existing ? add(existing.volume, volume) : volume,
  });
}

function finish(buckets: Map<string, Bucket>, scales: ProfileScales, approximate: boolean): VolumeProfile {
  const bins = [...buckets.values()]
    .sort((a, b) => cmp(b.price, a.price))
    .map((b) => ({ price: formatDecimal(b.price), volume: formatDecimal(b.volume) }));

  let total = parseDecimal("0", scales.qtyExp);
  let poc: Bucket | null = null;
  for (const b of buckets.values()) {
    total = add(total, b.volume);
    if (!poc || cmp(b.volume, poc.volume) > 0) poc = b;
  }

  return {
    bins,
    pointOfControl: poc ? formatDecimal(poc.price) : null,
    total: formatDecimal(total),
    approximate,
    bucketSize: scales.bucketSize,
  };
}

/**
 * The real thing: volume bucketed by the price it actually traded at.
 *
 * Use this whenever the tape is available — it is a measurement rather than a
 * reconstruction, and `approximate` is `false` to say so.
 */
export function volumeProfileFromPrints(
  prints: readonly { price: string; size: string }[],
  scales: ProfileScales,
): VolumeProfile {
  const size = parseDecimal(scales.bucketSize, scales.priceExp);
  const buckets = new Map<string, Bucket>();
  for (const p of prints) {
    collect(
      buckets,
      parseDecimal(p.price, scales.priceExp),
      parseDecimal(p.size, scales.qtyExp),
      size,
      scales.priceExp,
    );
  }
  return finish(buckets, scales, false);
}

/**
 * A reconstruction from OHLCV, for when there is no tape.
 *
 * Each bar's volume is spread **uniformly** across the buckets its high-low
 * range covers. That is a guess, and it is the only guess available from a bar:
 * OHLCV records where price went, not where the volume happened inside it. The
 * result carries `approximate: true` and callers are expected to label it.
 */
export function volumeProfileFromBars(
  bars: readonly Bar[],
  scales: ProfileScales,
): VolumeProfile {
  const size = parseDecimal(scales.bucketSize, scales.priceExp);
  const buckets = new Map<string, Bucket>();

  for (const bar of bars) {
    if (!bar.volume) continue;
    const high = parseDecimal(bar.high, scales.priceExp);
    const low = parseDecimal(bar.low, scales.priceExp);
    const volume = parseDecimal(bar.volume, scales.qtyExp);

    const first = bucketOf(low, size, scales.priceExp);
    const last = bucketOf(high, size, scales.priceExp);
    const span = div(sub(last, first), size, 0, "floor");
    const count = Number(span.v) + 1;

    const share = div(volume, parseDecimal(String(count), 0), scales.qtyExp, "floor");
    // Whatever the floor threw away goes to the last bucket, so the bins still
    // sum to the bar's volume rather than quietly losing a few contracts.
    const distributed = mul(share, parseDecimal(String(count), 0));
    const remainder = sub(volume, { v: distributed.v, exp: distributed.exp });

    for (let i = 0; i < count; i++) {
      const price = add(first, mul(size, parseDecimal(String(i), 0)));
      const amount =
        i === count - 1
          ? add(share, div(remainder, parseDecimal("1", 0), scales.qtyExp, "half-up"))
          : share;
      collect(buckets, { v: price.v, exp: scales.priceExp }, amount, size, scales.priceExp);
    }
  }

  return finish(buckets, scales, true);
}

// ─── Depth heatmap ───────────────────────────────────────────────────────────

export type DepthSnapshot = {
  /** Epoch seconds. */
  time: number;
  levels: readonly { price: string; size: string }[];
};

export type HeatmapCell = {
  time: number;
  price: string;
  size: string;
  /** `0`-`1`, relative to the largest cell in the grid. For the alpha channel. */
  intensity: number;
};

export type Heatmap = {
  cells: HeatmapCell[];
  max: string;
  bucketSize: string;
};

/**
 * A Bookmap-style liquidity cloud: resting size, bucketed by price, over time.
 *
 * Both axes are the chart's, which is why this is Group A. Intensity is
 * normalised against the largest cell so the colour ramp means something rather
 * than being tuned by eye — and `max` is returned so a legend can state what
 * full intensity actually is.
 */
export function depthHeatmap(
  snapshots: readonly DepthSnapshot[],
  scales: ProfileScales,
): Heatmap {
  const size = parseDecimal(scales.bucketSize, scales.priceExp);
  const cells: { time: number; price: Decimal; size: Decimal }[] = [];
  let max = parseDecimal("0", scales.qtyExp);

  for (const snap of snapshots) {
    const byBucket = new Map<string, Decimal>();
    for (const level of snap.levels) {
      const key = formatDecimal(
        bucketOf(parseDecimal(level.price, scales.priceExp), size, scales.priceExp),
      );
      const value = parseDecimal(level.size, scales.qtyExp);
      const existing = byBucket.get(key);
      byBucket.set(key, existing ? add(existing, value) : value);
    }
    for (const [key, value] of byBucket) {
      cells.push({ time: snap.time, price: parseDecimal(key, scales.priceExp), size: value });
      if (cmp(value, max) > 0) max = value;
    }
  }

  const denominator = max.v === 0n ? 1 : Number(max.v);
  return {
    cells: cells.map((c) => ({
      time: c.time,
      price: formatDecimal(c.price),
      size: formatDecimal(c.size),
      intensity: Number(c.size.v) / denominator,
    })),
    max: formatDecimal(max),
    bucketSize: scales.bucketSize,
  };
}
