/**
 * The ladder's pure logic — projection, click resolution and intent
 * translation. No React, so an MCP bridge can read and drive a ladder without a
 * DOM, and so the frame arithmetic is testable on its own.
 */

import {
  type Decimal,
  cmp,
  parseDecimal,
  formatDecimal,
  sub,
} from "@particle-academy/fancy-trading";
import type { OrderType, Side, TicketInstrument } from "../ticket/types.ts";

export type LadderRow = {
  /** Decimal string, in the VENUE's frame. */
  price: string;
  bidSize?: string;
  askSize?: string;
  /** Volume traded at this price in the current session. */
  volume?: string;
  /** Size of the most recent print at this price, for a recent-trade column. */
  lastTradeSize?: string;
};

export type LadderWorkingOrder = {
  clientOrderId: string;
  side: Side;
  /**
   * The **confirmed** price. Never the optimistic one: a replace can be
   * rejected while the ORIGINAL fills, because fills always win (§2.5).
   */
  price: string;
  qty: string;
  type: OrderType;
  status: string;
  /** A requested price the venue has not confirmed. Rendered as an overlay. */
  pendingPrice?: string;
  pendingStatus?: "pendingNew" | "pendingCancel" | "pendingReplace";
};

export type LadderPosition = {
  /** Signed. Positive is long. */
  qty: string;
  avgPrice?: string;
  /**
   * Where the average price came from. Sierra's honest touch: it is
   * "service-provided or calculated", and the two can disagree (§2.3).
   */
  avgPriceSource?: "service" | "calculated";
};

// ─── The click map ───────────────────────────────────────────────────────────

export type LadderColumn = "buy" | "sell" | "bid" | "ask" | "price" | "volume";
export type LadderGesture = "left" | "right" | "middle" | "shift-left" | "ctrl-left" | "alt-left";
export type LadderClickKey = `${LadderColumn}:${LadderGesture}`;

export type LadderClickAction = {
  side: Side;
  type: OrderType;
};

/**
 * What each gesture means, per column.
 *
 * **This is configuration, not behaviour.** The conventions genuinely differ
 * between platforms — Sierra Chart has the column select the side and the mouse
 * button select the order type; others have you click the bid column to join
 * the bid — so hardcoding either one makes the component wrong for half its
 * users. An unmapped gesture does nothing; there is no fallback that guesses.
 */
export type LadderClickMap = Partial<Record<LadderClickKey, LadderClickAction>>;

/**
 * Sierra Chart's convention, from its published documentation: *"To enter a Buy
 * Limit: Left click on the Buy column at the level of the limit price"*, and a
 * right click on the same column gives a Buy Stop.
 *
 * Note what this does NOT do: derive the side from whether the click landed
 * above or below the market. The column decides.
 */
export const SIERRA_CLICK_MAP: LadderClickMap = {
  "buy:left": { side: "buy", type: "limit" },
  "buy:right": { side: "buy", type: "stop" },
  "sell:left": { side: "sell", type: "limit" },
  "sell:right": { side: "sell", type: "stop" },
};

/** The other common convention: click the resting side you want to join. */
export const JOIN_THE_BOOK_CLICK_MAP: LadderClickMap = {
  "bid:left": { side: "buy", type: "limit" },
  "ask:left": { side: "sell", type: "limit" },
  "bid:right": { side: "sell", type: "stop" },
  "ask:right": { side: "buy", type: "stop" },
};

/** A read-only ladder. Explicit, so "no map" and "no trading" are the same thing. */
export const NO_CLICK_MAP: LadderClickMap = {};

export function resolveClick(
  map: LadderClickMap,
  column: LadderColumn,
  gesture: LadderGesture,
): LadderClickAction | null {
  return map[`${column}:${gesture}`] ?? null;
}

// ─── Intents ─────────────────────────────────────────────────────────────────

/** Always expressed in the VENUE's frame, so an adapter never has to guess. */
export type LadderIntent =
  | { kind: "place"; side: Side; type: OrderType; price: string; qty: string }
  | { kind: "cancel"; clientOrderId: string }
  | { kind: "replace"; clientOrderId: string; price: string };

// ─── Frames ──────────────────────────────────────────────────────────────────

/**
 * A row as it should be DISPLAYED, which is not always as the venue sends it.
 *
 * For a `netted_complementary` book viewed in its complementary frame, the
 * price is mirrored and the two sides swap: a YES bid of 900 at 0.65 is a NO
 * ask of 900 at 0.35. One book, two frames — which is what makes a Kalshi
 * ladder and a Polymarket ladder the same component (§2.8).
 */
export type ProjectedRow = {
  /** What to render. */
  displayPrice: string;
  /** What to send. Equal to `displayPrice` outside a mirrored frame. */
  venuePrice: string;
  bidSize?: string;
  askSize?: string;
  volume?: string;
  lastTradeSize?: string;
};

export function isMirrored(instrument: TicketInstrument, frame: string | undefined): boolean {
  const of = instrument.outcomeFrame;
  return Boolean(
    of && of.model === "netted_complementary" && frame && frame === of.complementOf && of.sumsTo,
  );
}

/** `sumsTo - price`, exactly. */
export function complement(price: string, sumsTo: string, exp: number): string {
  return formatDecimal(sub(parseDecimal(sumsTo, exp), parseDecimal(price, exp)));
}

export function projectRows(
  rows: readonly LadderRow[],
  instrument: TicketInstrument,
  frame?: string,
): ProjectedRow[] {
  const mirrored = isMirrored(instrument, frame);
  const sumsTo = instrument.outcomeFrame?.sumsTo;

  const projected: ProjectedRow[] = rows.map((r) =>
    mirrored && sumsTo
      ? {
          displayPrice: complement(r.price, sumsTo, instrument.priceExp),
          venuePrice: r.price,
          // The sides swap with the frame. A bid for YES is an offer of NO.
          bidSize: r.askSize,
          askSize: r.bidSize,
          volume: r.volume,
          lastTradeSize: r.lastTradeSize,
        }
      : {
          displayPrice: r.price,
          venuePrice: r.price,
          bidSize: r.bidSize,
          askSize: r.askSize,
          volume: r.volume,
          lastTradeSize: r.lastTradeSize,
        },
  );

  // Highest price at the top, which is the only orientation a ladder has.
  return projected.sort((a, b) =>
    cmp(
      parseDecimal(b.displayPrice, instrument.priceExp),
      parseDecimal(a.displayPrice, instrument.priceExp),
    ),
  );
}

/**
 * Translate a click in the DISPLAY frame into an intent in the VENUE frame.
 *
 * In a mirrored frame both the price and the side flip, because *"buy-yes and
 * sell-no produce the same directional exposure"* — one order, two ways of
 * describing it. The component always emits the venue's description.
 */
export function toVenueIntent(
  action: LadderClickAction,
  displayPrice: string,
  qty: string,
  instrument: TicketInstrument,
  frame?: string,
): LadderIntent {
  if (isMirrored(instrument, frame) && instrument.outcomeFrame?.sumsTo) {
    return {
      kind: "place",
      side: action.side === "buy" ? "sell" : "buy",
      type: action.type,
      price: complement(displayPrice, instrument.outcomeFrame.sumsTo, instrument.priceExp),
      qty,
    };
  }
  return { kind: "place", side: action.side, type: action.type, price: displayPrice, qty };
}

/** Top of book in the VENUE's frame — what the limit checks run against. */
export function topOfBook(rows: readonly LadderRow[], exp: number): {
  bestBid?: Decimal;
  bestAsk?: Decimal;
} {
  let bestBid: Decimal | undefined;
  let bestAsk: Decimal | undefined;
  for (const r of rows) {
    const p = parseDecimal(r.price, exp);
    if (r.bidSize && (!bestBid || cmp(p, bestBid) > 0)) bestBid = p;
    if (r.askSize && (!bestAsk || cmp(p, bestAsk) < 0)) bestAsk = p;
  }
  return { bestBid, bestAsk };
}
