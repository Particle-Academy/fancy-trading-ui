/**
 * The order ticket's controlled value, and the instrument shape it renders
 * against.
 *
 * **Every number here is a decimal STRING, not a `Decimal`.** That is not
 * laziness — it is the Human+ contract. `Decimal` carries a `bigint`, and
 * `JSON.stringify` throws on a bigint, so a `Decimal`-valued prop cannot cross
 * an MCP bridge at all. Strings survive the round trip exactly (which floats
 * would not), and the component parses them at the instrument's scale.
 *
 * Note what {@link TicketValue} deliberately does NOT have: an `origin` field.
 * §3.1 requires origin to be *set by the transport, not by the caller*, so
 * there is nowhere for an agent-written value to claim it is human. It is a
 * prop on the component, stamped at the bridge boundary.
 */

import type { PriceDisplay } from "../../format.ts";

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stopLimit" | "trailingStop";
export type TimeInForce = "day" | "gtc" | "gtd" | "ioc" | "fok" | "opg" | "cls";

/**
 * Attached orders, in a shape that can express all three venue models (§2.1):
 * Alpaca's nested declarative brackets, IBKR's flat orders plus relationship
 * fields, and Sierra Chart's numbered OCO groups. An adapter expands whichever
 * of these its venue speaks; nothing here assumes one.
 */
export type AttachedOrders = {
  /** Alpaca's `take_profit`. */
  takeProfit?: { limitPrice: string };
  /** Alpaca's `stop_loss`. A `limitPrice` makes it a stop-limit leg. */
  stopLoss?: { triggerPrice: string; limitPrice?: string };
  /**
   * Who enforces the one-cancels-other linkage.
   *
   * Carried because it changes the risk profile of a disconnect: a
   * client-enforced OCO stops working the moment the platform goes dark, and a
   * trader who believes the venue is holding it believes they are protected
   * when they are not (§2.1, Sierra Chart).
   */
  ocoEnforcedBy?: "venue" | "client";
  /** IBKR's `ocaGroup`. */
  ocaGroup?: string;
  /**
   * IBKR's `ocaType`. **Types 2 and 3 PROPORTIONALLY REDUCE the siblings
   * rather than cancelling them**, which is the piece most implementations miss
   * and the correct behaviour for a scaled-out bracket.
   */
  ocaType?: 1 | 2 | 3;
  /**
   * IBKR's `transmit` two-phase commit: every leg but the last is sent with
   * `transmit=false`, "to prevent accidental executions". A crash between calls
   * leaves untransmitted orders sitting in TWS, so a client that uses this must
   * reconcile them on reconnect.
   */
  twoPhase?: boolean;
};

/** The controlled value. JSON in, JSON out — an agent can emit this verbatim. */
export type TicketValue = {
  symbol: string;
  side: Side;
  /** Decimal string. */
  qty: string;
  type: OrderType;
  /** Named prices, never IBKR's overloaded `auxPrice`. */
  limitPrice?: string;
  triggerPrice?: string;
  trailOffset?: string;
  tif: TimeInForce;
  /** For `gtd`, epoch ms. */
  goodTillDate?: number;
  reduceOnly?: boolean;
  /** Normalised to a flag; the adapter expands it into the venue's slot. */
  postOnly?: boolean;
  attached?: AttachedOrders;
  /** Free-form, carried to the venue where supported. */
  tag?: string;
};

/**
 * The instrument facts the ticket needs. A subset of the full model in
 * `.ai/plans/fancy-trading.md` §5.2 — everything JSON-friendly, so a host can
 * hand one straight from an API response.
 */
export type TicketInstrument = {
  id: string;
  /** What the venue calls it. */
  symbol: string;
  /** What the human calls it. Falls back to `symbol`. */
  displaySymbol?: string;
  /** Scale for prices, and for parsing typed input. */
  priceExp: number;
  /** Scale for quantities. `0` for whole contracts. */
  qtyExp: number;
  priceDisplay: PriceDisplay;
  /**
   * Tick size. A STRING for a constant tick, or a function of price for a
   * ranged structure — Kalshi's `price_level_structure` gives different steps
   * in different price ranges and a scalar cannot express it (§2.8).
   */
  tickSize: string | ((price: string) => string);
  /** Currency per 1.00 of price movement per contract. */
  multiplier: string;
  contractType: "linear" | "inverse" | "spot";
  /** Epoch ms. Absent for anything that does not expire. */
  lastTradingDate?: number;
  /**
   * A back-adjusted continuous symbol. **Not tradable** — the order path must
   * resolve to the real contract, and the ticket refuses it outright (§2.8).
   */
  isContinuous?: boolean;
  /** Which real contract a continuous symbol currently stands for. */
  resolvesToContract?: string;
  lotSize?: string;
  minQty?: string;
  priceBounds?: { min: string; max: string } | null;
  currency?: string;
  /**
   * How the venue models the two sides of an outcome contract. Absent for
   * everything that is not an event / prediction market.
   *
   * This is the single most important field for event markets, and getting it
   * wrong is unfixable later (§2.8):
   *
   * - **`netted_complementary`** (Kalshi) — ONE book with two mirrored frames.
   *   Binary contracts sum to $1.00, so a NO bid at X *is* a YES ask at
   *   1.00 - X, and buying NO is literally the same order as selling YES.
   * - **`separate_per_outcome`** (Polymarket) — YES and NO are separate tokens
   *   with SEPARATE order books, separate resting liquidity and separate queue
   *   position. Economically equivalent, operationally different. Mirroring one
   *   into the other would invent liquidity that is not there.
   */
  outcomeFrame?: {
    model: "netted_complementary" | "separate_per_outcome";
    /** What the two sides sum to. `"1.00"` for a binary contract. */
    sumsTo?: string;
    /** The name of the complementary frame, e.g. `"NO"`. */
    complementOf?: string;
  } | null;
};

/**
 * What a host can compute about the order as it is typed.
 *
 * **Recomputed on every keystroke**, not behind a button. IBKR's margin preview
 * is opt-in (`Check Margin Impact`); Hyperliquid recomputes liquidation price
 * continuously. For the number that decides whether a position survives,
 * continuous wins (§12.4).
 *
 * Every field is optional and every field is a fact. There is no field for an
 * opinion, and there must never be one (§3.2).
 */
export type TicketEstimate = {
  /** Notional value of the order. */
  notional?: string;
  /** Initial margin the order would consume. */
  marginRequired?: string;
  /** Buying power remaining afterwards. */
  buyingPowerAfter?: string;
  /**
   * Liquidation price of the resulting position.
   *
   * Under ISOLATED margin this is a property of the position. Under CROSS it is
   * a property of the ACCOUNT and moves whenever any other position moves —
   * which is why {@link marginMode} sits beside it. Rendering a per-position
   * liquidation price in cross mode without saying so is misleading (§2.8).
   */
  liquidationPrice?: string;
  marginMode?: "cross" | "isolated";
  /** Estimated round-turn fees. */
  fees?: string;
  /**
   * IBKR's Look Ahead columns — next-margin-period headroom and when it
   * changes, shown BESIDE the current values rather than behind a projection
   * screen (§12.4). Margin is a function of (instrument, quantity, TIME).
   */
  lookAhead?: {
    availableFunds?: string;
    excessLiquidity?: string;
    /** Epoch ms of the next change. */
    nextChangeAt?: number;
  };
};

/**
 * The tick size in force AT a given price.
 *
 * Kalshi's `price_level_structure` gives different steps in different price
 * ranges, so a scalar tick cannot express it (§2.8) — hence
 * {@link TicketInstrument.tickSize} being `string | (price) => string`. This is
 * the one place that difference is resolved, so no caller has to know which
 * shape it was handed.
 */
export function tickSizeAt(instrument: TicketInstrument, price: string): string {
  return typeof instrument.tickSize === "function"
    ? instrument.tickSize(price)
    : instrument.tickSize;
}
