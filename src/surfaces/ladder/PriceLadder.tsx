/**
 * `<PriceLadder>` — the DOM / price ladder.
 *
 * The inverse of a chart: a chart puts time on x and shows history; a ladder
 * discards history and shows resting liquidity at every price, with your
 * working orders positioned at their price.
 *
 * Three things here are decisions rather than details:
 *
 * - **The click map is a prop.** Column selects side, button selects type —
 *   Sierra Chart's convention — but only because {@link SIERRA_CLICK_MAP} is
 *   the default. Another platform's users expect to click the bid column to
 *   join the bid. An unmapped gesture does nothing; nothing guesses.
 * - **Orders render at their CONFIRMED price**, with the requested price as a
 *   separate ghost. Rendering optimistically is a lie whenever the replace is
 *   rejected — and a replace can be rejected while the original FILLS.
 * - **One replace per order at a time.** Two in flight and the reports can
 *   arrive out of order, which is how an order ends up at a price nobody asked
 *   for.
 */

import { useMemo, useState } from "react";
import { Button, Callout, Table } from "@particle-academy/react-fancy";
import { checkLimits, parseLimits, type JsonRiskLimits } from "../../safety/limits.ts";
import { LIVE, oneClickVerdict, type Liveness, type TradingMode } from "../../safety/mode.ts";
import type { Limitation } from "../../safety/limited.ts";
import { TRADING_WARNINGS, WarningRegistry } from "../../safety/warnings.ts";
import { SurfaceChrome } from "../../chrome/SurfaceChrome.tsx";
import { WarningNotice } from "../../chrome/Confirm.tsx";
import { TRADING_ACTIONS, emitTradingActivity, type TradingActivityEmitter } from "../../activity.ts";
import { encodeSide, type DirectionPalette } from "../../direction.ts";
import { formatPrice } from "../../format.ts";
import { parseDecimal } from "@particle-academy/fancy-trading";
import type { TicketInstrument } from "../ticket/types.ts";
import {
  SIERRA_CLICK_MAP,
  complement,
  isMirrored,
  projectRows,
  resolveClick,
  toVenueIntent,
  topOfBook,
  type LadderClickMap,
  type LadderColumn,
  type LadderGesture,
  type LadderIntent,
  type LadderPosition,
  type LadderRow,
  type LadderWorkingOrder,
} from "./ladder.ts";

export {
  JOIN_THE_BOOK_CLICK_MAP,
  NO_CLICK_MAP,
  SIERRA_CLICK_MAP,
  type LadderClickAction,
  type LadderClickMap,
  type LadderIntent,
  type LadderPosition,
  type LadderRow,
  type LadderWorkingOrder,
} from "./ladder.ts";

export type PriceLadderProps = {
  mode: TradingMode;
  instrument: TicketInstrument;
  rows: readonly LadderRow[];
  /** The quantity a click places. Controlled by the host. */
  orderQty?: string;
  orders?: readonly LadderWorkingOrder[];
  position?: LadderPosition;
  liveness?: Liveness;
  limits?: JsonRiskLimits;
  limitations?: readonly Limitation[];
  warnings?: WarningRegistry;
  scope?: string;
  clickMap?: LadderClickMap;
  /**
   * Which outcome frame to display, for an event contract. Ignored for
   * everything else. Intents always leave in the VENUE's frame.
   */
  frame?: string;
  /** Human actions. Never called for an `agent` origin. */
  onIntent: (intent: LadderIntent) => void;
  /**
   * Agent actions. An agent's click lands here as a PROPOSAL — §3.1. With no
   * handler wired, an agent's click does nothing at all, because failing open
   * would mean an agent placing an order because a host forgot a prop.
   */
  onPropose?: (intent: LadderIntent) => void;
  origin?: "human" | "agent";
  activity?: TradingActivityEmitter | null;
  palette?: DirectionPalette;
  moneyExp?: number;
  className?: string;
  id?: string;
  now?: number;
};

const COLUMNS: readonly LadderColumn[] = ["bid", "buy", "price", "sell", "ask"];

export function PriceLadder(props: PriceLadderProps) {
  const {
    mode,
    instrument,
    rows,
    orderQty = "1",
    orders,
    position,
    liveness = LIVE,
    limitations,
    clickMap = SIERRA_CLICK_MAP,
    frame,
    onIntent,
    onPropose,
    origin = "human",
    activity,
    palette,
    className,
    id,
    now = Date.now(),
  } = props;

  const [warnings] = useState(() => props.warnings ?? new WarningRegistry());
  const [dragging, setDragging] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const scope = props.scope ?? `ladder:${instrument.symbol}`;
  const projected = useMemo(() => projectRows(rows, instrument, frame), [rows, instrument, frame]);
  const book = useMemo(() => topOfBook(rows, instrument.priceExp), [rows, instrument.priceExp]);
  const oneClick = oneClickVerdict(liveness, mode);

  const parsedLimits = useMemo(
    () => parseLimits(props.limits, { qtyExp: instrument.qtyExp, moneyExp: props.moneyExp ?? 2 }),
    [props.limits, instrument.qtyExp, props.moneyExp],
  );

  const dispatch = (intent: LadderIntent, meta: Record<string, unknown>): void => {
    if (intent.kind === "place") {
      const verdict = checkLimits(parsedLimits, {
        intent: {
          symbol: instrument.symbol,
          side: intent.side,
          qty: parseDecimal(intent.qty, instrument.qtyExp),
          type: intent.type,
          limitPrice: intent.type === "limit" ? parseDecimal(intent.price, instrument.priceExp) : undefined,
          triggerPrice:
            intent.type === "stop" || intent.type === "stopLimit"
              ? parseDecimal(intent.price, instrument.priceExp)
              : undefined,
        },
        now,
        positionQty: position ? parseDecimal(position.qty, instrument.qtyExp) : undefined,
        bestBid: book.bestBid,
        bestAsk: book.bestAsk,
        lastTradingDate: instrument.lastTradingDate,
        isContinuous: instrument.isContinuous,
      });
      if (!verdict.ok) {
        setRefusal(verdict.breaches.find((b) => b.action === "refuse")?.message ?? "Refused.");
        return;
      }
    }

    setRefusal(null);
    emitTradingActivity({
      action: TRADING_ACTIONS.LadderClick,
      surface: "ladder",
      elementId: instrument.symbol,
      actor: { source: origin, id: origin === "agent" ? "agent" : "human" },
      emitter: activity,
      meta,
    });

    if (origin === "agent") {
      // Agents propose; humans confirm. No handler means nothing happens.
      onPropose?.(intent);
      return;
    }
    onIntent(intent);
  };

  const onCellClick = (
    column: LadderColumn,
    displayPrice: string,
    venuePrice: string,
    gesture: LadderGesture,
  ): void => {
    if (!oneClick.allowed) {
      setRefusal(oneClick.reason);
      return;
    }
    const action = resolveClick(clickMap, column, gesture);
    if (!action) return;
    const intent = toVenueIntent(action, displayPrice, orderQty, instrument, frame);
    dispatch(intent, {
      price: intent.kind === "place" ? intent.price : venuePrice,
      displayPrice,
      column,
      gesture,
    });
  };

  const beginDrag = (order: LadderWorkingOrder): void => {
    if (order.pendingStatus) {
      setRefusal(
        `Order ${order.clientOrderId} already has a change in flight (${order.pendingStatus}). Wait for the venue to confirm it before moving it again — two replaces in flight can be reported out of order.`,
      );
      return;
    }
    if (!oneClick.allowed) {
      setRefusal(oneClick.reason);
      return;
    }
    setRefusal(null);
    setDragging(order.clientOrderId);
  };

  const dropOn = (displayPrice: string): void => {
    if (!dragging) return;
    const id2 = dragging;
    setDragging(null);
    // A move lands on a DISPLAYED row; the venue only knows its own frame.
    const venuePrice =
      isMirrored(instrument, frame) && instrument.outcomeFrame?.sumsTo
        ? complement(displayPrice, instrument.outcomeFrame.sumsTo, instrument.priceExp)
        : displayPrice;
    dispatch({ kind: "replace", clientOrderId: id2, price: venuePrice }, { price: venuePrice, replace: true });
  };

  const ordersByPrice = new Map<string, LadderWorkingOrder[]>();
  const pendingByPrice = new Map<string, LadderWorkingOrder[]>();
  for (const o of orders ?? []) {
    const key = o.price;
    ordersByPrice.set(key, [...(ordersByPrice.get(key) ?? []), o]);
    if (o.pendingPrice) {
      pendingByPrice.set(o.pendingPrice, [...(pendingByPrice.get(o.pendingPrice) ?? []), o]);
    }
  }

  const positionRow = position?.avgPrice;
  const buyEnc = encodeSide("buy", palette);
  const sellEnc = encodeSide("sell", palette);

  return (
    <SurfaceChrome
      surface="ladder"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title={
        <span>
          {instrument.displaySymbol ?? instrument.symbol}
          {frame ? ` · ${frame}` : ""}
        </span>
      }
    >
      <div data-fancy-trading-ladder={instrument.symbol} data-frame={frame ?? ""}>
        {dragging ? (
          <WarningNotice
            registry={warnings}
            id={TRADING_WARNINGS.DragIsCancelReplace}
            scope={scope}
            message="Moving a working order is a cancel-replace."
            detail="The order can fill at its current price before the venue processes the move, and some venues lose queue priority on any amend."
            className="m-2"
          />
        ) : null}

        {refusal ? (
          <Callout data-fancy-trading-ladder-refusal="" color="red" className="m-2">
            <p className="text-sm">{refusal}</p>
          </Callout>
        ) : null}

        <Table className="text-xs tabular-nums">
          <Table.Head>
            <Table.Row>
              {COLUMNS.map((c) => (
                <Table.Column
                  key={c}
                  scope="col"
                  className="px-1 py-0.5 text-right text-xs"
                  label={c === "buy" ? `${buyEnc.glyph} buy` : c === "sell" ? `${sellEnc.glyph} sell` : c}
                />
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {projected.map((r) => {
              const rowOrders = ordersByPrice.get(r.venuePrice) ?? [];
              const rowPending = pendingByPrice.get(r.venuePrice) ?? [];
              const isPositionRow = positionRow === r.venuePrice;
              return (
                <Table.Row
                  key={r.displayPrice}
                  data-fancy-trading-ladder-row={r.displayPrice}
                  onMouseUp={() => dropOn(r.displayPrice)}
                  className="border-b border-secondary-100 dark:border-secondary-800"
                >
                  {COLUMNS.map((column) => (
                    <Table.Cell
                      key={column}
                      data-column={column}
                      aria-label={cellLabel(column, r.displayPrice)}
                      onClick={() => onCellClick(column, r.displayPrice, r.venuePrice, "left")}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onCellClick(column, r.displayPrice, r.venuePrice, "right");
                      }}
                      className={cellClass(column, buyEnc.className, sellEnc.className)}
                    >
                      {column === "price" ? (
                        <span>
                          {formatPrice(
                            parseDecimal(r.displayPrice, instrument.priceExp),
                            instrument.priceDisplay,
                          )}
                          {isPositionRow ? (
                            <span
                              data-fancy-trading-ladder-position=""
                              title={`Position ${position!.qty} at ${position!.avgPrice} (${position!.avgPriceSource ?? "service"}-provided average)`}
                              className="ml-1 rounded bg-secondary-200 px-1 dark:bg-secondary-700"
                            >
                              {position!.qty}
                            </span>
                          ) : null}
                        </span>
                      ) : column === "bid" ? (
                        (r.bidSize ?? "")
                      ) : column === "ask" ? (
                        (r.askSize ?? "")
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          {rowOrders
                            .filter((o) => o.side === (column === "buy" ? "buy" : "sell"))
                            .map((o) => (
                              <Button
                                key={o.clientOrderId}
                                size="xs"
                                data-fancy-trading-ladder-order={o.clientOrderId}
                                data-pending={o.pendingStatus ?? ""}
                                title={`${o.side} ${o.qty} at ${o.price}${o.pendingStatus ? ` — ${o.pendingStatus}, not confirmed` : ""}`}
                                onMouseDown={() => beginDrag(o)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded px-1 py-0 text-xs leading-4"
                              >
                                {o.qty}
                              </Button>
                            ))}
                          {rowPending
                            .filter((o) => o.side === (column === "buy" ? "buy" : "sell"))
                            .map((o) => (
                              <span
                                key={`p-${o.clientOrderId}`}
                                data-fancy-trading-ladder-pending={o.clientOrderId}
                                title="Requested, not confirmed by the venue"
                                className="rounded border border-dashed border-secondary-400 px-1 opacity-70"
                              >
                                → {o.pendingPrice} (not confirmed)
                              </span>
                            ))}
                        </span>
                      )}
                    </Table.Cell>
                  ))}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>
    </SurfaceChrome>
  );
}

function cellLabel(column: LadderColumn, price: string): string {
  switch (column) {
    case "bid":
      return `bid size at ${price}`;
    case "ask":
      return `ask size at ${price}`;
    case "buy":
      return `buy at ${price}`;
    case "sell":
      return `sell at ${price}`;
    case "price":
      return `price ${price}`;
    default:
      return `${column} at ${price}`;
  }
}

function cellClass(column: LadderColumn, buyClass: string, sellClass: string): string {
  const base = "px-1 py-0.5 text-right";
  if (column === "bid" || column === "buy") return `${base} ${buyClass}`;
  if (column === "ask" || column === "sell") return `${base} ${sellClass}`;
  return `${base} font-medium`;
}
