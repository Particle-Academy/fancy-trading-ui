/**
 * `<OrdersTable>`, `<FillsTable>`, `<PositionsTable>` — three surfaces, because
 * they are three different things (§2.3), plus `<Blotter>` which arranges all
 * three in tabs for the common case.
 *
 * The aggregate destructive actions live here, and each has its own
 * confirmation, independent of routine order entry (§3.2). Confirming
 * everything trains people to click through.
 */

import { useState, type ReactNode } from "react";
import { Badge, Button, Table, Tabs } from "@particle-academy/react-fancy";
import { parseDecimal } from "@particle-academy/fancy-trading";
import { SurfaceChrome, Withheld } from "../../chrome/SurfaceChrome.tsx";
import { ConfirmAggregate, needsConfirmation, type ConfirmSettings } from "../../chrome/Confirm.tsx";
import { LIVE, oneClickVerdict, type Liveness, type TradingMode } from "../../safety/mode.ts";
import type { Limitation } from "../../safety/limited.ts";
import { TRADING_ACTIONS, emitTradingActivity, type TradingActivityEmitter } from "../../activity.ts";
import { directionOf, encodeDirection, encodeSide, type DirectionPalette } from "../../direction.ts";
import { formatSignedMoney } from "../../format.ts";
import {
  CUSHION_LABEL,
  presentOrder,
  reconcileFills,
  roundTrips,
  type BlotterFill,
  type BlotterOrder,
  type BlotterPosition,
} from "./blotter.ts";

export {
  CUSHION_LABEL,
  presentOrder,
  reconcileFills,
  roundTrips,
  type BlotterFill,
  type BlotterOrder,
  type BlotterPosition,
  type FillExecType,
  type FillRow,
  type MarginCushion,
  type OrderHeldBy,
  type OrderPresentation,
  type PresentedOrder,
  type RoundTrip,
} from "./blotter.ts";

type Common = {
  mode: TradingMode;
  liveness?: Liveness;
  limitations?: readonly Limitation[];
  palette?: DirectionPalette;
  activity?: TradingActivityEmitter | null;
  origin?: "human" | "agent";
  className?: string;
  id?: string;
};

// ─── Orders ──────────────────────────────────────────────────────────────────

export type OrdersTableProps = Common & {
  orders: readonly BlotterOrder[];
  onCancel?: (clientOrderId: string) => void;
  /** Cancel every working order. Confirmed separately from routine entry. */
  onCancelAll?: () => void;
  confirmations?: ConfirmSettings;
};

export function OrdersTable({
  mode,
  liveness = LIVE,
  limitations,
  orders,
  onCancel,
  onCancelAll,
  confirmations,
  activity,
  origin = "human",
  className,
  id,
}: OrdersTableProps) {
  const [confirming, setConfirming] = useState<null | "cancel-all">(null);
  const oneClick = oneClickVerdict(liveness, mode);
  const working = orders.filter((o) => {
    const p = presentOrder(o);
    return p.state === "working" || p.state === "accepted" || p.state === "elected" || p.state === "partiallyFilled";
  });

  const runCancelAll = (): void => {
    setConfirming(null);
    emitTradingActivity({
      action: TRADING_ACTIONS.CancelAll,
      surface: "blotter",
      actor: { source: origin },
      emitter: activity,
      meta: { count: working.length },
    });
    onCancelAll?.();
  };

  return (
    <SurfaceChrome
      surface="blotter"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title="Orders"
      actions={
        onCancelAll ? (
          <Button
            data-fancy-trading-cancel-all=""
            size="xs"
            color="red"
            disabled={!oneClick.allowed || working.length === 0}
            onClick={() =>
              needsConfirmation("cancel-all", confirmations, origin)
                ? setConfirming("cancel-all")
                : runCancelAll()
            }
          >
            Cancel all ({working.length})
          </Button>
        ) : null
      }
    >
      {orders.length === 0 ? (
        <Withheld
          limitation={{ reason: "unsupported", withheld: "Orders", detail: "there are none." }}
          className="p-2"
        />
      ) : (
        <Table data-fancy-trading-orders="">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Symbol" />
              <Table.Column label="Side" />
              <Table.Column label="Qty" />
              <Table.Column label="Filled" />
              <Table.Column label="Price" />
              <Table.Column label="State" />
              <Table.Column label="Ids" />
              <Table.Column label="" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {orders.map((o) => {
              const p = presentOrder(o);
              const side = encodeSide(o.side);
              return (
                <Table.Row
                  key={o.clientOrderId}
                  data-fancy-trading-order={o.clientOrderId}
                  data-state={p.state}
                >
                  <Table.Cell>{o.symbol}</Table.Cell>
                  <Table.Cell className={side.className}>
                    {side.glyph} {side.label}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{o.qty}</Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {o.cumQty}
                    {o.avgPx ? ` @ ${o.avgPx}` : ""}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {o.limitPrice ?? o.triggerPrice ?? "mkt"}
                    {o.pendingIntent?.limitPrice ? (
                      <span
                        data-fancy-trading-order-pending={o.clientOrderId}
                        className="ml-1 rounded border border-dashed px-1 text-xs opacity-70"
                      >
                        → {o.pendingIntent.limitPrice} (not confirmed)
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="sm" color={stateColour(p.state)} variant="soft">
                      {p.label}
                    </Badge>
                    {p.note ? (
                      <p data-fancy-trading-order-note="" className="mt-0.5 text-[0.6875rem] opacity-80">
                        {p.note}
                      </p>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-[0.6875rem] text-secondary-500">
                    <span title="Client order id — the only handle that exists between 'sent' and 'acknowledged'">
                      {o.clientOrderId}
                    </span>
                    {o.venueOrderId ? <> / {o.venueOrderId}</> : null}
                  </Table.Cell>
                  <Table.Cell>
                    {onCancel && !isTerminal(p.state) ? (
                      <Button
                        data-fancy-trading-order-cancel={o.clientOrderId}
                        size="xs"
                        disabled={!oneClick.allowed}
                        onClick={() => {
                          emitTradingActivity({
                            action: TRADING_ACTIONS.OrderCancel,
                            surface: "blotter",
                            elementId: o.clientOrderId,
                            actor: { source: origin },
                            emitter: activity,
                          });
                          onCancel(o.clientOrderId);
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {confirming === "cancel-all" ? (
        <ConfirmAggregate
          action="cancel-all"
          open
          mode={mode}
          impact={`${working.length} working order(s) across ${new Set(working.map((o) => o.symbol)).size} symbol(s) will be cancelled. Anything already filled is unaffected.`}
          onConfirm={runCancelAll}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </SurfaceChrome>
  );
}

function isTerminal(state: string): boolean {
  return ["filled", "canceled", "rejected", "expired", "replaced"].includes(state);
}

function stateColour(state: string): "green" | "red" | "amber" | "zinc" | "blue" {
  switch (state) {
    case "filled":
      return "green";
    // Deliberately different colours: "you successfully cancelled" and "the
    // exchange rejected you" are not the same news (§12.3).
    case "rejected":
      return "red";
    case "canceled":
      return "zinc";
    case "accepted":
    case "cancelRequested":
    case "replaceRequested":
    case "pending":
      return "amber";
    default:
      return "blue";
  }
}

// ─── Fills ───────────────────────────────────────────────────────────────────

export type FillsTableProps = Common & {
  fills: readonly BlotterFill[];
  /** Show completed round trips instead of raw prints. */
  view?: "raw" | "roundTrips";
  multiplier?: string;
  moneyExp?: number;
  qtyExp?: number;
};

export function FillsTable({
  mode,
  liveness = LIVE,
  limitations,
  fills,
  view = "raw",
  multiplier,
  moneyExp,
  qtyExp,
  palette,
  className,
  id,
}: FillsTableProps) {
  const rows = reconcileFills(fills);
  const trips = view === "roundTrips" ? roundTrips(fills, { multiplier, moneyExp, qtyExp }) : [];

  return (
    <SurfaceChrome
      surface="blotter"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title={view === "roundTrips" ? "Round trips" : "Fills"}
    >
      {view === "roundTrips" ? (
        <Table data-fancy-trading-roundtrips="">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Symbol" />
              <Table.Column label="Qty" />
              <Table.Column label="In" />
              <Table.Column label="Out" />
              <Table.Column label="Realised" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {trips.map((t) => {
              const enc = encodeDirection(directionOf(parseDecimal(t.realised, moneyExp ?? 2)), palette);
              return (
                <Table.Row key={`${t.symbol}-${t.closedAt}`} data-fancy-trading-roundtrip={t.symbol}>
                  <Table.Cell>{t.symbol}</Table.Cell>
                  <Table.Cell className="tabular-nums">{t.qty}</Table.Cell>
                  <Table.Cell className="tabular-nums">{t.entryPrice}</Table.Cell>
                  <Table.Cell className="tabular-nums">{t.exitPrice}</Table.Cell>
                  <Table.Cell className={`tabular-nums ${enc.className}`}>
                    {enc.glyph} {formatSignedMoney(parseDecimal(t.realised, moneyExp ?? 2))}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      ) : (
        <Table data-fancy-trading-fills="">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Time" />
              <Table.Column label="Symbol" />
              <Table.Column label="Side" />
              <Table.Column label="Qty" />
              <Table.Column label="Price" />
              <Table.Column label="Record" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((f) => {
              const side = encodeSide(f.side, palette);
              return (
                <Table.Row
                  key={f.id}
                  data-fancy-trading-fill={f.id}
                  data-exec-type={f.execType}
                  data-busted={f.busted ? "true" : "false"}
                  data-effective={f.effective ? "true" : "false"}
                  className={f.busted || f.corrected ? "line-through opacity-60" : undefined}
                >
                  <Table.Cell className="tabular-nums">
                    {new Date(f.at).toISOString().slice(11, 23)}
                  </Table.Cell>
                  <Table.Cell>{f.symbol}</Table.Cell>
                  <Table.Cell className={side.className}>
                    {side.glyph} {side.label}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{f.qty}</Table.Cell>
                  <Table.Cell className="tabular-nums">{f.price}</Table.Cell>
                  <Table.Cell>
                    {f.execType === "trade" ? "trade" : f.execType === "tradeCorrect" ? "CORRECTION" : "BUST"}
                    {f.busted ? " — busted by a later record" : ""}
                    {f.corrected ? " — superseded by a correction" : ""}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      <p className="px-2 py-1 text-[0.6875rem] text-secondary-500">
        Fills are append-only. A bust or a correction adds a record; it never removes the original,
        because a quietly deleted fill changes P&amp;L history with nothing on screen to say why.
      </p>
    </SurfaceChrome>
  );
}

// ─── Positions ───────────────────────────────────────────────────────────────

export type PositionsTableProps = Common & {
  positions: readonly BlotterPosition[];
  moneyExp?: number;
  onFlatten?: () => void;
  onReverse?: (symbol: string) => void;
  confirmations?: ConfirmSettings;
};

export function PositionsTable({
  mode,
  liveness = LIVE,
  limitations,
  positions,
  moneyExp = 2,
  onFlatten,
  onReverse,
  confirmations,
  palette,
  activity,
  origin = "human",
  className,
  id,
}: PositionsTableProps) {
  const [confirming, setConfirming] = useState<null | { action: "flatten" | "reverse"; symbol?: string }>(null);
  const oneClick = oneClickVerdict(liveness, mode);
  const open = positions.filter((p) => p.qty !== "0");
  const anyLookAhead = positions.some((p) => p.lookAhead);

  const run = (action: "flatten" | "reverse", symbol?: string): void => {
    setConfirming(null);
    emitTradingActivity({
      action: action === "flatten" ? TRADING_ACTIONS.Flatten : TRADING_ACTIONS.Reverse,
      surface: "positions",
      elementId: symbol,
      actor: { source: origin },
      emitter: activity,
      meta: { count: open.length },
    });
    if (action === "flatten") onFlatten?.();
    else if (symbol) onReverse?.(symbol);
  };

  /**
   * Ask, or do. Each aggregate action is looked up on its OWN key, so turning
   * off the Cancel All confirmation leaves Flatten and Reverse confirming.
   */
  const ask = (action: "flatten" | "reverse", symbol?: string): void => {
    if (needsConfirmation(action, confirmations, origin)) setConfirming({ action, symbol });
    else run(action, symbol);
  };

  return (
    <SurfaceChrome
      surface="positions"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title="Positions"
      actions={
        onFlatten ? (
          <Button
            data-fancy-trading-flatten=""
            size="xs"
            color="red"
            disabled={!oneClick.allowed || open.length === 0}
            onClick={() => ask("flatten")}
          >
            Flatten all ({open.length})
          </Button>
        ) : null
      }
    >
      {positions.length === 0 ? (
        <Withheld
          limitation={{ reason: "unsupported", withheld: "Positions", detail: "there are none." }}
          className="p-2"
        />
      ) : (
        <Table data-fancy-trading-positions="">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Symbol" />
              <Table.Column label="Qty" />
              <Table.Column label="Average" />
              <Table.Column label="Mark" />
              <Table.Column label="Open P&L" />
              <Table.Column label="Realised" />
              <Table.Column label="Liquidation" />
              {anyLookAhead ? <Table.Column label="Look ahead" /> : null}
              <Table.Column label="" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {positions.map((p) => {
              const unrealised = p.unrealised ? parseDecimal(p.unrealised, moneyExp) : null;
              const enc = unrealised ? encodeDirection(directionOf(unrealised), palette) : null;
              return (
                <Table.Row
                  key={p.symbol}
                  data-fancy-trading-position={p.symbol}
                  data-cushion={p.marginCushion ?? "ok"}
                >
                  <Table.Cell>{p.symbol}</Table.Cell>
                  <Table.Cell className="tabular-nums">{p.qty}</Table.Cell>
                  <Table.Cell
                    data-avg-price-source={p.avgPriceSource ?? "service"}
                    title={
                      p.avgPriceSource === "calculated"
                        ? "CALCULATED by this client from the fills. The broker's own average may differ."
                        : "Provided by the broker."
                    }
                    className="tabular-nums"
                  >
                    {p.avgPrice ?? "—"}
                    <span className="ml-1 text-[0.625rem] uppercase text-secondary-500">
                      {p.avgPriceSource === "calculated" ? "calc" : "broker"}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{p.markPrice ?? "—"}</Table.Cell>
                  <Table.Cell className={`tabular-nums ${enc?.className ?? ""}`}>
                    {unrealised ? (
                      <>
                        {enc!.glyph} {formatSignedMoney(unrealised)}
                      </>
                    ) : (
                      "—"
                    )}
                    {p.openTradeEquity !== undefined ? (
                      <span
                        data-fancy-trading-open-trade-equity=""
                        className="ml-1 text-[0.625rem] text-secondary-500"
                        title="Open trade equity. Futures are marked to market in CASH every day and the basis resets to the settlement price, so this is not the same number as unrealised P&L carried across days."
                      >
                        OTE {p.openTradeEquity}
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{p.realised ?? "—"}</Table.Cell>
                  <Table.Cell className="tabular-nums" data-margin-mode={p.marginMode ?? ""}>
                    {p.liquidationPrice ?? "—"}
                    {p.marginMode ? (
                      <span
                        data-fancy-trading-margin-mode={p.marginMode}
                        className="ml-1 text-[0.625rem] text-secondary-500"
                        title={
                          p.marginMode === "cross"
                            ? "CROSS margin: this is a property of the ACCOUNT and moves whenever any other position moves."
                            : "ISOLATED margin: a property of this position alone."
                        }
                      >
                        {p.marginMode}
                      </span>
                    ) : null}
                    {p.marginCushion && p.marginCushion !== "ok" ? (
                      <Badge
                        data-fancy-trading-cushion={p.marginCushion}
                        size="sm"
                        color={p.marginCushion === "liquidationImminent" ? "red" : "amber"}
                        className="ml-1"
                      >
                        {CUSHION_LABEL[p.marginCushion]}
                      </Badge>
                    ) : null}
                  </Table.Cell>
                  {anyLookAhead ? (
                    <Table.Cell
                      data-fancy-trading-lookahead={p.symbol}
                      className="tabular-nums text-[0.6875rem]"
                      title="Next margin period. Margin is a function of (instrument, quantity, TIME): a position that is fine at 15:00 can be a margin call at 16:01."
                    >
                      {p.lookAhead?.availableFunds ? `funds ${p.lookAhead.availableFunds}` : ""}
                      {p.lookAhead?.excessLiquidity ? ` · excess ${p.lookAhead.excessLiquidity}` : ""}
                    </Table.Cell>
                  ) : null}
                  <Table.Cell>
                    {onReverse ? (
                      <Button
                        data-fancy-trading-reverse={p.symbol}
                        size="xs"
                        color="red"
                        disabled={!oneClick.allowed || p.qty === "0"}
                        onClick={() => ask("reverse", p.symbol)}
                      >
                        Reverse
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {positions.some((p) => p.marginCushion && p.marginCushion !== "ok") ? (
        <p className="px-2 py-1 text-[0.6875rem] text-secondary-500">
          A margin cushion warning is not a guarantee of one: in a fast move positions can be
          liquidated without a warning appearing first.
        </p>
      ) : null}

      {confirming && needsConfirmation(confirming.action, confirmations, origin) ? (
        <ConfirmAggregate
          action={confirming.action}
          open
          mode={mode}
          impact={
            confirming.action === "flatten"
              ? `${open.length} open position(s) will be closed at market, and every working order cancelled.`
              : `${confirming.symbol} will be closed and an equal position opened on the other side, at market.`
          }
          onConfirm={() => run(confirming.action, confirming.symbol)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </SurfaceChrome>
  );
}

// ─── All three, in tabs ──────────────────────────────────────────────────────

export type BlotterProps = Common & {
  orders: readonly BlotterOrder[];
  fills: readonly BlotterFill[];
  positions: readonly BlotterPosition[];
  onCancel?: (clientOrderId: string) => void;
  onCancelAll?: () => void;
  onFlatten?: () => void;
  onReverse?: (symbol: string) => void;
  confirmations?: ConfirmSettings;
  moneyExp?: number;
  extra?: ReactNode;
};

/**
 * The three tables in tabs. A convenience, not a fourth concept — each table is
 * exported on its own precisely because they are three different things.
 */
export function Blotter(props: BlotterProps) {
  const { orders, fills, positions, extra, ...common } = props;
  return (
    <div data-fancy-trading-blotter="" className={props.className}>
      <Tabs defaultTab="orders">
        <Tabs.List>
          <Tabs.Tab value="orders">Orders ({orders.length})</Tabs.Tab>
          <Tabs.Tab value="fills">Fills ({fills.length})</Tabs.Tab>
          <Tabs.Tab value="positions">Positions ({positions.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panels>
          <Tabs.Panel value="orders">
            <OrdersTable {...common} orders={orders} />
          </Tabs.Panel>
          <Tabs.Panel value="fills">
            <FillsTable {...common} fills={fills} />
          </Tabs.Panel>
          <Tabs.Panel value="positions">
            <PositionsTable {...common} positions={positions} />
          </Tabs.Panel>
        </Tabs.Panels>
      </Tabs>
      {extra}
    </div>
  );
}
