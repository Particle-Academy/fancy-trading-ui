/**
 * `<OrderBook>` and `<DepthChart>` — two views of ONE reconciled book.
 *
 * Neither takes levels of its own. Both take a {@link BookState}, and the depth
 * curve is `cumulativeDepth()` of it, because two views each maintaining their
 * own book from one stream drift after a gap and then two surfaces on screen
 * disagree (§2.3).
 *
 * The depth chart is drawn with plain CSS bars rather than a charting engine.
 * That is deliberate: it keeps `lightweight-charts` out of the root entry's
 * graph entirely, so a consumer who installs this package for an order ticket
 * pays nothing for it.
 */

import { useMemo } from "react";
import { Badge } from "@particle-academy/react-fancy";
import { formatDecimal, parseDecimal } from "@particle-academy/fancy-trading";
import { SurfaceChrome, Withheld } from "../../chrome/SurfaceChrome.tsx";
import type { Limitation } from "../../safety/limited.ts";
import type { TradingMode } from "../../safety/mode.ts";
import { encodeSide, type DirectionPalette } from "../../direction.ts";
import { formatPrice } from "../../format.ts";
import type { TicketInstrument } from "../ticket/types.ts";
import {
  bookLiveness,
  cumulativeDepth,
  topOfBook,
  type BookState,
} from "./book.ts";

export {
  EMPTY_BOOK,
  bookLiveness,
  cumulativeDepth,
  marketImpact,
  topOfBook,
  type BookCompleteness,
  type BookLevel,
  type BookState,
  type BookSyncState,
  type DepthPoint,
  type ImpactResult,
} from "./book.ts";

/**
 * A book that covers less than the whole market says so, in the place the rest
 * of the book would have been.
 */
export function completenessLimitation(state: BookState): Limitation | null {
  switch (state.completeness) {
    case "aggregatedPartial":
      return {
        reason: "depth-unavailable",
        withheld: "The rest of the market",
        detail:
          "this is a PARTIAL aggregate of some venues, not the consolidated book. Size and price levels here are not the whole market.",
      };
    case "singleVenue":
      return {
        reason: "depth-unavailable",
        withheld: "Other venues",
        detail: `this book is ${state.venue ?? "one venue"} only, not the consolidated book.`,
      };
    default:
      return null;
  }
}

export type OrderBookProps = {
  mode: TradingMode;
  instrument: TicketInstrument;
  state: BookState;
  /** How many levels per side to render. */
  depth?: number;
  limitations?: readonly Limitation[];
  palette?: DirectionPalette;
  moneyExp?: number;
  className?: string;
  id?: string;
};

export function OrderBook({
  mode,
  instrument,
  state,
  depth = 10,
  limitations,
  palette,
  moneyExp = 2,
  className,
  id,
}: OrderBookProps) {
  const scales = { priceExp: instrument.priceExp, qtyExp: instrument.qtyExp, moneyExp };
  const top = useMemo(() => topOfBook(state, instrument.priceExp), [state, instrument.priceExp]);
  const bids = useMemo(() => cumulativeDepth(state, "bid", scales).slice(0, depth), [state, depth, scales.priceExp, scales.qtyExp, scales.moneyExp]);
  const asks = useMemo(() => cumulativeDepth(state, "ask", scales).slice(0, depth), [state, depth, scales.priceExp, scales.qtyExp, scales.moneyExp]);

  const completeness = completenessLimitation(state);
  const all = completeness ? [...(limitations ?? []), completeness] : limitations;
  const buy = encodeSide("buy", palette);
  const sell = encodeSide("sell", palette);

  return (
    <SurfaceChrome
      surface="book"
      mode={mode}
      liveness={bookLiveness(state)}
      limitations={all}
      id={id}
      className={className}
      title={
        <span className="flex items-center gap-2">
          <span>{instrument.displaySymbol ?? instrument.symbol}</span>
          {top.spread ? (
            <Badge size="sm" color="zinc" variant="outline" data-fancy-trading-book-spread="">
              spread {formatPrice(top.spread, instrument.priceDisplay)}
            </Badge>
          ) : null}
        </span>
      }
    >
      <div data-fancy-trading-book={instrument.symbol} className="grid grid-cols-2 gap-px text-xs tabular-nums">
        <BookSide
          side="bid"
          label={`${buy.glyph} bids`}
          points={bids}
          instrument={instrument}
          className={buy.className}
        />
        <BookSide
          side="ask"
          label={`${sell.glyph} asks`}
          points={asks}
          instrument={instrument}
          className={sell.className}
        />
      </div>
    </SurfaceChrome>
  );
}

function BookSide({
  side,
  label,
  points,
  instrument,
  className,
}: {
  side: "bid" | "ask";
  label: string;
  points: ReturnType<typeof cumulativeDepth>;
  instrument: TicketInstrument;
  className: string;
}) {
  if (points.length === 0) {
    return (
      <Withheld
        limitation={{
          reason: "depth-unavailable",
          withheld: side === "bid" ? "Bids" : "Asks",
          detail: "no levels have arrived on this side yet.",
        }}
        className="p-2"
      />
    );
  }
  return (
    <table data-fancy-trading-book-side={side} className="w-full border-collapse">
      <thead>
        <tr>
          <th scope="col" className={`px-1 text-right font-medium ${className}`}>
            {label}
          </th>
          <th scope="col" className="px-1 text-right font-medium text-secondary-500">
            size
          </th>
          <th scope="col" className="px-1 text-right font-medium text-secondary-500">
            cumulative
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.price} data-fancy-trading-book-level={p.price} data-side={side}>
            <td className={`px-1 text-right ${className}`}>
              {formatPrice(parseDecimal(p.price, instrument.priceExp), instrument.priceDisplay)}
            </td>
            <td className="px-1 text-right">{p.size}</td>
            <td data-cumulative={p.cumulative} className="px-1 text-right text-secondary-500">
              {p.cumulative}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type DepthChartProps = {
  mode: TradingMode;
  instrument: TicketInstrument;
  /** The SAME state the book renders. There is no separate levels prop. */
  state: BookState;
  depth?: number;
  limitations?: readonly Limitation[];
  palette?: DirectionPalette;
  moneyExp?: number;
  className?: string;
  id?: string;
};

/**
 * The depth chart, drawn from `cumulativeDepth()` of the same state.
 *
 * Labelled market impact rather than "depth", because that is what it answers:
 * how much would fill sweeping to a price. Depth is the shape; impact is the
 * question.
 */
export function DepthChart({
  mode,
  instrument,
  state,
  depth = 20,
  limitations,
  palette,
  moneyExp = 2,
  className,
  id,
}: DepthChartProps) {
  const scales = { priceExp: instrument.priceExp, qtyExp: instrument.qtyExp, moneyExp };
  const bids = cumulativeDepth(state, "bid", scales).slice(0, depth);
  const asks = cumulativeDepth(state, "ask", scales).slice(0, depth);

  const max = [...bids, ...asks].reduce((m, p) => {
    const v = parseDecimal(p.cumulative, instrument.qtyExp);
    return v.v > m.v ? v : m;
  }, parseDecimal("0", instrument.qtyExp));

  const completeness = completenessLimitation(state);
  const all = completeness ? [...(limitations ?? []), completeness] : limitations;

  const pct = (cumulative: string): number => {
    if (max.v === 0n) return 0;
    return Number((parseDecimal(cumulative, instrument.qtyExp).v * 100n) / max.v);
  };

  const buy = encodeSide("buy", palette);
  const sell = encodeSide("sell", palette);

  return (
    <SurfaceChrome
      surface="depth"
      mode={mode}
      liveness={bookLiveness(state)}
      limitations={all}
      id={id}
      className={className}
      title={<span>Market impact · {instrument.displaySymbol ?? instrument.symbol}</span>}
    >
      <div data-fancy-trading-depth={instrument.symbol} className="grid grid-cols-2 gap-2 p-2 text-xs">
        <div data-fancy-trading-depth-side="bid">
          <p className={`mb-1 text-right font-medium ${buy.className}`}>
            {buy.glyph} sweeping the bids
          </p>
          {bids.map((p) => (
            <div
              key={p.price}
              data-fancy-trading-depth-point={p.price}
              data-cumulative={p.cumulative}
              data-notional={p.notional}
              title={`Sell down to ${p.price}: ${p.cumulative} filled for ${p.notional}`}
              className="flex items-center justify-end gap-1"
            >
              <span className="tabular-nums">{p.cumulative}</span>
              <span
                aria-hidden="true"
                style={{ width: `${pct(p.cumulative)}%` }}
                className="inline-block h-2 bg-secondary-400/50"
              />
              <span className="w-16 text-right tabular-nums">
                {formatPrice(parseDecimal(p.price, instrument.priceExp), instrument.priceDisplay)}
              </span>
            </div>
          ))}
        </div>

        <div data-fancy-trading-depth-side="ask">
          <p className={`mb-1 font-medium ${sell.className}`}>{sell.glyph} sweeping the asks</p>
          {asks.map((p) => (
            <div
              key={p.price}
              data-fancy-trading-depth-point={p.price}
              data-cumulative={p.cumulative}
              data-notional={p.notional}
              title={`Buy up to ${p.price}: ${p.cumulative} filled for ${p.notional}`}
              className="flex items-center gap-1"
            >
              <span className="w-16 tabular-nums">
                {formatPrice(parseDecimal(p.price, instrument.priceExp), instrument.priceDisplay)}
              </span>
              <span
                aria-hidden="true"
                style={{ width: `${pct(p.cumulative)}%` }}
                className="inline-block h-2 bg-secondary-400/50"
              />
              <span className="tabular-nums">{p.cumulative}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="px-2 pb-2 text-[0.6875rem] text-secondary-500">
        Cumulative size outward from the mid. Read it as market impact — what would fill sweeping
        to a price — not as a measure of how deep the market is.
        {max.v === 0n ? "" : ` Deepest visible level: ${formatDecimal(max)}.`}
      </p>
    </SurfaceChrome>
  );
}
