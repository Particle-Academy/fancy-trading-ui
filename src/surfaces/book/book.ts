/**
 * ONE reconciled book state, and the arithmetic derived from it.
 *
 * §2.3: *"Depth chart is DERIVED, never separately sourced… It must consume the
 * same reconciled book state as the ladder; two views each maintaining their
 * own book from one stream will drift after a gap, and then two surfaces on
 * screen disagree."*
 *
 * So `<OrderBook>` and `<DepthChart>` both take a {@link BookState} and neither
 * takes levels of its own. The depth curve is {@link cumulativeDepth} of that
 * state — a pure function, so the two surfaces cannot disagree by construction.
 *
 * The other thing carried here is the **sync state**. A ladder rendering a book
 * that is `resyncing` shows visibly degraded, never silently stale — and an
 * agent reading the book through a bridge must be told the same, or it will
 * trade on it (§2.6).
 */

import {
  type Decimal,
  add,
  cmp,
  div,
  formatDecimal,
  mul,
  parseDecimal,
  sub,
} from "@particle-academy/fancy-trading";

export type BookLevel = {
  price: string;
  size: string;
  /** Number of resting orders, where the venue provides it. */
  orders?: number;
};

/**
 * The `BookSync` state machine from §2.6 — `disconnected -> buffering ->
 * syncing -> live -> resyncing` — behind one interface, whichever of the four
 * venue gap mechanisms is underneath (range ids, chained ids, monotonic
 * sequence, CRC32 checksum).
 */
export type BookSyncState = "disconnected" | "buffering" | "syncing" | "live" | "resyncing";

/**
 * How much of the market this book covers. §5.2's `bookCompleteness`.
 *
 * A partial aggregate presented as the book is the §12.5 failure in a different
 * costume: the surface looks complete and is not.
 */
export type BookCompleteness = "consolidated" | "singleVenue" | "aggregatedPartial";

export type BookState = {
  /** Best first — descending price. */
  bids: readonly BookLevel[];
  /** Best first — ascending price. */
  asks: readonly BookLevel[];
  sync: BookSyncState;
  completeness?: BookCompleteness;
  /** Last applied sequence / change id, so a gap can be named rather than hinted. */
  lastSequence?: number;
  asOf?: number;
  /** Venue name, when the book is single-venue. */
  venue?: string;
};

export const EMPTY_BOOK: BookState = { bids: [], asks: [], sync: "disconnected" };

/** Best bid / best ask / spread / mid, from the one state. */
export function topOfBook(
  state: BookState,
  priceExp: number,
): {
  bestBid?: Decimal;
  bestAsk?: Decimal;
  spread?: Decimal;
  mid?: Decimal;
} {
  const bid = state.bids[0] ? parseDecimal(state.bids[0].price, priceExp) : undefined;
  const ask = state.asks[0] ? parseDecimal(state.asks[0].price, priceExp) : undefined;
  if (!bid || !ask) return { bestBid: bid, bestAsk: ask };
  const spread = sub(ask, bid);
  return { bestBid: bid, bestAsk: ask, spread, mid: div(add(bid, ask), parseDecimal("2", 0), priceExp, "half-up") };
}

export type DepthPoint = {
  price: string;
  /** Size at this level. */
  size: string;
  /** Total size from the mid out to and including this level. */
  cumulative: string;
  /** Cash required to sweep to and including this level. */
  notional: string;
};

/**
 * The depth curve — cumulative size outward from the mid.
 *
 * Its real semantic is **market impact**: "how much would I fill sweeping to
 * price p" (§2.3). It is not a second data source and there is no way to give
 * it one; it is this function of the book above.
 */
export function cumulativeDepth(
  state: BookState,
  side: "bid" | "ask",
  scales: { priceExp: number; qtyExp: number; moneyExp: number },
): DepthPoint[] {
  const levels = side === "bid" ? state.bids : state.asks;
  let cumulative = parseDecimal("0", scales.qtyExp);
  let notional = parseDecimal("0", scales.moneyExp);
  const out: DepthPoint[] = [];

  for (const level of levels) {
    const size = parseDecimal(level.size, scales.qtyExp);
    const price = parseDecimal(level.price, scales.priceExp);
    cumulative = add(cumulative, size);
    notional = add(notional, div(mul(size, price), parseDecimal("1", 0), scales.moneyExp, "half-up"));
    out.push({
      price: level.price,
      size: level.size,
      cumulative: formatDecimal(cumulative),
      notional: formatDecimal(notional),
    });
  }
  return out;
}

export type ImpactResult = {
  /** How much would fill sweeping to `limitPrice`. */
  fillableQty: string;
  /** Cash it would cost. */
  notional: string;
  /** Volume-weighted price of that fill. `null` when nothing would fill. */
  averagePrice: string | null;
  /** How many book levels it would consume. */
  levelsConsumed: number;
  /** True when the requested size exceeds what the visible book holds. */
  exceedsVisibleBook: boolean;
};

/**
 * "What would I get sweeping to this price" — the question a depth chart is
 * actually asked, computed rather than eyeballed off a curve.
 *
 * `exceedsVisibleBook` is the honest field: a book is only as deep as what the
 * feed sent, and an answer that quietly stops at the last level it has is the
 * same failure as a surface that silently renders less.
 */
export function marketImpact(
  state: BookState,
  side: "buy" | "sell",
  wantQty: string,
  scales: { priceExp: number; qtyExp: number; moneyExp: number },
): ImpactResult {
  const levels = side === "buy" ? state.asks : state.bids;
  let remaining = parseDecimal(wantQty, scales.qtyExp);
  let filled = parseDecimal("0", scales.qtyExp);
  let notional = parseDecimal("0", scales.moneyExp);
  let levelsConsumed = 0;

  for (const level of levels) {
    if (remaining.v <= 0n) break;
    const size = parseDecimal(level.size, scales.qtyExp);
    const take = cmp(size, remaining) <= 0 ? size : remaining;
    const price = parseDecimal(level.price, scales.priceExp);
    filled = add(filled, take);
    notional = add(notional, div(mul(take, price), parseDecimal("1", 0), scales.moneyExp, "half-up"));
    remaining = sub(remaining, take);
    levelsConsumed += 1;
  }

  return {
    fillableQty: formatDecimal(filled),
    notional: formatDecimal(notional),
    averagePrice:
      filled.v === 0n ? null : formatDecimal(div(notional, filled, scales.priceExp, "half-up")),
    levelsConsumed,
    exceedsVisibleBook: remaining.v > 0n,
  };
}

/** How a book's sync state reads as surface liveness. One mapping, one meaning. */
export function bookLiveness(state: BookState): {
  state: "live" | "stale" | "resyncing" | "disconnected";
  reason?: string;
} {
  switch (state.sync) {
    case "live":
      return { state: "live" };
    case "resyncing":
      return {
        state: "resyncing",
        reason: state.lastSequence
          ? `repairing after a gap at sequence ${state.lastSequence}`
          : "repairing after a gap",
      };
    case "syncing":
      return { state: "resyncing", reason: "applying the initial snapshot" };
    case "buffering":
      return { state: "resyncing", reason: "buffering events until a snapshot arrives" };
    case "disconnected":
      return { state: "disconnected" };
  }
}
