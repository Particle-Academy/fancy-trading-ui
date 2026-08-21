/**
 * The blotter's model. **Three tables, not one.**
 *
 * §2.3: *"Conflating them is the commonest amateur mistake."*
 *
 * - **Orders** = intent. Carries both a client-assigned and a venue-assigned id.
 * - **Fills** = immutable facts, **append-only**. FIX has explicit correction
 *   and bust semantics (`ExecType=G` Trade Correct, `H` Trade Cancel); without
 *   them a busted trade silently corrupts P&L history.
 * - **Positions** = derived state.
 *
 * The other finding encoded here is §12.3's: TWS separates **accepted** from
 * **working** from **elected**, a distinction most retail UIs collapse. It
 * matters enormously for an untriggered stop — an accepted stop is not a
 * working order, and a trader who believes otherwise believes they are
 * protected when they are not.
 */

import {
  type Decimal,
  type Fill,
  type OrdStatus,
  applyFill,
  emptyPosition,
  formatDecimal,
  parseDecimal,
} from "@particle-academy/fancy-trading";
import type { OrderType, Side, TimeInForce } from "../ticket/types.ts";

/**
 * Where an order actually rests.
 *
 * IBKR's `PreSubmitted` is the tell that it **simulates many order types
 * locally**, so an IBKR stop is often not resting at the exchange at all
 * (§2.5). A blotter that shows it as working is showing protection that does
 * not exist while the broker is unreachable.
 */
export type OrderHeldBy = "venue" | "broker" | "client";

export type BlotterOrder = {
  clientOrderId: string;
  venueOrderId?: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: string;
  /** Cumulative, always — never a delta (§2.5). */
  cumQty: string;
  leavesQty: string;
  avgPx?: string;
  limitPrice?: string;
  triggerPrice?: string;
  status: OrdStatus;
  tif: TimeInForce;
  heldBy?: OrderHeldBy;
  /** For a stop: has the trigger fired and turned it into a live order? */
  elected?: boolean;
  /** A requested change the venue has not confirmed. Rendered as an overlay. */
  pendingIntent?: { limitPrice?: string; triggerPrice?: string; qty?: string };
  receivedAt: number;
  updatedAt: number;
  /** The venue's words, for a rejection. */
  reason?: string;
};

/**
 * The state a trader actually needs to read off the row, which is finer than
 * `OrdStatus` alone.
 */
export type OrderPresentation =
  | "pending"
  | "accepted"
  | "working"
  | "elected"
  | "partiallyFilled"
  | "filled"
  | "cancelRequested"
  | "canceled"
  | "rejected"
  | "expired"
  | "replaceRequested"
  | "replaced"
  | "doneForDay"
  | "suspended";

export type PresentedOrder = {
  state: OrderPresentation;
  label: string;
  /** The sentence under the label. Empty for the boring states. */
  note: string;
};

const STOP_TYPES: readonly OrderType[] = ["stop", "stopLimit", "trailingStop"];

/**
 * Turn an order into what to show.
 *
 * Two decisions here are deliberate and both come from §12.3:
 *
 * 1. An **untriggered stop is `accepted`, not `working`**, and it says so.
 * 2. **`canceled` and `rejected` stay separate.** IBKR renders both red, which
 *    is honest about the protocol and ambiguous on screen — "you successfully
 *    cancelled" and "the exchange rejected you" are not the same news.
 */
export function presentOrder(order: BlotterOrder): PresentedOrder {
  switch (order.status) {
    case "pendingNew":
      return {
        state: "pending",
        label: "Pending",
        note: "Sent, not yet acknowledged. It may already be working at the venue.",
      };
    case "pendingCancel":
      return {
        state: "cancelRequested",
        label: "Cancel requested",
        note: "Not confirmed. You may still receive an execution while a cancellation request is pending.",
      };
    case "pendingReplace":
      return {
        state: "replaceRequested",
        label: "Change requested",
        note: "Not confirmed. The order is still working at its ORIGINAL price until the venue says otherwise, and a fill would win the race.",
      };
    case "canceled":
      return { state: "canceled", label: "Cancelled", note: "" };
    case "rejected":
      return {
        state: "rejected",
        label: "Rejected",
        note: order.reason ? `The venue said: ${order.reason}` : "The venue refused this order.",
      };
    case "expired":
      return { state: "expired", label: "Expired", note: "" };
    case "replaced":
      return { state: "replaced", label: "Replaced", note: "" };
    case "filled":
      return { state: "filled", label: "Filled", note: "" };
    case "doneForDay":
      return {
        state: "doneForDay",
        label: "Done for day",
        note: "Not terminal — a GTC order comes back on the next session.",
      };
    case "suspended":
      return { state: "suspended", label: "Suspended", note: "" };
    default:
      break;
  }

  const partly = order.status === "partiallyFilled";

  if (STOP_TYPES.includes(order.type) && !order.elected) {
    return {
      state: "accepted",
      label: "Accepted — NOT working",
      note:
        order.heldBy && order.heldBy !== "venue"
          ? `The trigger has not fired, and this stop is held by the ${order.heldBy} rather than resting at the exchange. It does not protect you while the ${order.heldBy} is unreachable.`
          : "The trigger has not fired, so this is not a working order. It is not protecting the position yet.",
    };
  }

  if (order.heldBy && order.heldBy !== "venue") {
    return {
      state: "accepted",
      label: "Accepted — held locally",
      note: `Held by the ${order.heldBy} rather than resting at the exchange. It stops working while the ${order.heldBy} is unreachable.`,
    };
  }

  if (STOP_TYPES.includes(order.type) && order.elected) {
    return {
      state: "elected",
      label: partly ? "Elected — partly filled" : "Elected",
      note: "The trigger has fired; this is now a live order.",
    };
  }

  return partly
    ? { state: "partiallyFilled", label: "Working — partly filled", note: "" }
    : { state: "working", label: "Working", note: "" };
}

// ─── Fills ───────────────────────────────────────────────────────────────────

/** FIX `ExecType` for the three kinds of fill record. */
export type FillExecType = "trade" | "tradeCorrect" | "tradeCancel";

export type BlotterFill = {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: Side;
  qty: string;
  price: string;
  at: number;
  fee?: string;
  venue?: string;
  execType: FillExecType;
  /** For a correction or a bust, the fill it refers to. */
  correctsFillId?: string;
};

export type FillRow = BlotterFill & {
  /** True when a later `tradeCancel` busted this fill. */
  busted: boolean;
  /** True when a later `tradeCorrect` superseded this fill. */
  corrected: boolean;
  /** Whether this record counts toward the position and P&L. */
  effective: boolean;
};

/**
 * Fills are **append-only**. A bust does not delete the original row; it adds a
 * `tradeCancel` record that refers to it, and both stay on screen.
 *
 * Deleting the original is how a busted trade silently corrupts P&L history —
 * the numbers change and nothing on screen says why.
 */
export function reconcileFills(fills: readonly BlotterFill[]): FillRow[] {
  const busted = new Set<string>();
  const corrected = new Set<string>();
  for (const f of fills) {
    if (f.execType === "tradeCancel" && f.correctsFillId) busted.add(f.correctsFillId);
    if (f.execType === "tradeCorrect" && f.correctsFillId) corrected.add(f.correctsFillId);
  }
  return fills.map((f) => ({
    ...f,
    busted: busted.has(f.id),
    corrected: corrected.has(f.id),
    // A bust record itself is bookkeeping, not a trade. The original it refers
    // to stops counting; the correction that replaces one starts counting.
    effective:
      f.execType !== "tradeCancel" && !busted.has(f.id) && !corrected.has(f.id),
  }));
}

export type RoundTrip = {
  symbol: string;
  openedAt: number;
  closedAt: number;
  /** Signed at the open: positive was long. */
  qty: string;
  entryPrice: string;
  exitPrice: string;
  realised: string;
  fillIds: string[];
};

/**
 * Group effective fills into completed round trips — flat to flat, per symbol.
 *
 * Professionals expect both the raw fills *and* this (§2.3). The realised P&L
 * is computed by the domain package's `applyFill`, not re-derived here, so a
 * blotter and a P&L report cannot disagree.
 */
export function roundTrips(
  fills: readonly BlotterFill[],
  options: { basis?: "average" | "fifo" | "lifo"; moneyExp?: number; qtyExp?: number; multiplier?: string } = {},
): RoundTrip[] {
  const basis = options.basis ?? "fifo";
  const moneyExp = options.moneyExp ?? 2;
  const qtyExp = options.qtyExp ?? 0;
  const multiplier = parseDecimal(options.multiplier ?? "1", 0);

  const effective = reconcileFills(fills)
    .filter((f) => f.effective)
    .sort((a, b) => a.at - b.at);

  const bySymbol = new Map<string, FillRow[]>();
  for (const f of effective) bySymbol.set(f.symbol, [...(bySymbol.get(f.symbol) ?? []), f]);

  const out: RoundTrip[] = [];

  for (const [symbol, rows] of bySymbol) {
    let position = emptyPosition(basis, moneyExp);
    let openedAt = 0;
    let entryQty: Decimal | null = null;
    let entryPrice = "";
    let realised = parseDecimal("0", moneyExp);
    let ids: string[] = [];

    for (const row of rows) {
      const fill: Fill = {
        side: row.side,
        qty: parseDecimal(row.qty, qtyExp),
        price: parseDecimal(row.price, moneyExp),
        at: row.at,
        fee: row.fee ? parseDecimal(row.fee, moneyExp) : undefined,
        id: row.id,
      };
      const wasFlat = position.qty.v === 0n;
      if (wasFlat) {
        openedAt = row.at;
        entryQty = fill.qty;
        entryPrice = row.price;
        realised = parseDecimal("0", moneyExp);
        ids = [];
      }
      ids.push(row.id);

      const result = applyFill(position, fill, {
        contractType: "linear",
        multiplier,
        moneyExp,
      });
      position = result.position;
      realised = parseDecimal(
        formatDecimal({ v: realised.v + result.realisedDelta.v, exp: moneyExp }),
        moneyExp,
      );

      if (position.qty.v === 0n && entryQty) {
        out.push({
          symbol,
          openedAt,
          closedAt: row.at,
          qty: formatDecimal(entryQty),
          entryPrice,
          exitPrice: row.price,
          realised: formatDecimal(realised),
          fillIds: [...ids],
        });
        entryQty = null;
      }
    }
  }

  return out.sort((a, b) => a.closedAt - b.closedAt);
}

// ─── Positions ───────────────────────────────────────────────────────────────

/**
 * How close the account is to a margin call. IBKR renders this as background
 * colour on the row you are already looking at, which is the right place for it
 * (§12.4) — but colour alone is never the encoding here (§12.7).
 */
export type MarginCushion = "ok" | "warning" | "depleted" | "liquidationImminent";

export type BlotterPosition = {
  symbol: string;
  /** Signed. Positive is long. */
  qty: string;
  avgPrice?: string;
  /**
   * Sierra's honest touch: the average price is *"service-provided or
   * calculated"*, and the two can disagree (§2.3). A blotter that does not say
   * which it has cannot explain the disagreement when it happens.
   */
  avgPriceSource?: "service" | "calculated";
  markPrice?: string;
  unrealised?: string;
  realised?: string;
  /**
   * Futures are marked to market every day in CASH and the basis resets to the
   * settlement price, so there is no "unrealised P&L carried across days" the
   * way there is in an equity account (§2.8). Where that applies, open trade
   * equity is a different number from realised P&L and both are shown.
   */
  openTradeEquity?: string;
  marginMode?: "cross" | "isolated";
  liquidationPrice?: string;
  marginCushion?: MarginCushion;
  /** §12.4's Look Ahead, beside the present rather than behind a projection. */
  lookAhead?: {
    availableFunds?: string;
    excessLiquidity?: string;
    nextChangeAt?: number;
  };
};

export const CUSHION_LABEL: Record<MarginCushion, string> = {
  ok: "cushion ok",
  warning: "cushion 10%",
  depleted: "cushion depleted",
  liquidationImminent: "liquidation imminent",
};
