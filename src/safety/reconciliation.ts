/**
 * Reconciliation breaks — the UI's half of §2.6.
 *
 * §2.6 calls reconnect and resynchronisation *"the defining reliability
 * problem"*, and it splits cleanly. The **venue session owns the socket**: the
 * four gap mechanisms, the buffering, the snapshot, the resubscribe order. That
 * is a connect package and it is not here.
 *
 * What IS here is the part that survives whatever the connectors do later:
 *
 * 1. **A disagreement is loud.** §2.6 step 6 — *"Recompute positions from fills
 *    and compare against the venue's. If they disagree, the venue wins and we
 *    raise a loud reconciliation break. Silent divergence is how someone
 *    discovers at 3pm they have been trading a phantom."*
 * 2. **An order nobody can account for reaches a human.** §2.6 step 5 — an
 *    order we sent that the venue does not report, and which was `pendingNew`,
 *    has a *"genuinely unknown"* fate. **It is surfaced, never guessed.**
 *
 * And the safety consequence, which is the reason this lives under `safety/`
 * rather than beside the blotter: **a position in dispute is not a position you
 * may trade off.** A break turns one-click off even when the feed is perfectly
 * live, because staleness and wrongness are different problems and only one of
 * them is about the socket. The live-and-wrong case is the more dangerous,
 * because nothing looks broken.
 *
 * React-free, like the rest of `/safety`: a risk daemon comparing positions
 * server-side needs exactly these functions.
 */

import {
  type Decimal,
  type Fill,
  type Order,
  type OrderEvent,
  type OrderIntent,
  abs,
  applyFill,
  cmp,
  emptyPosition,
  formatDecimal,
  isReconciliationBreak,
  parseDecimal,
  sub,
} from "@particle-academy/fancy-trading";
import type { BlotterFill, BlotterOrder } from "../surfaces/blotter/model.ts";
import { reconcileFills } from "../surfaces/blotter/model.ts";

/** What the venue says a position is. Authoritative, by §2.6's rule. */
export type VenuePosition = {
  symbol: string;
  /** Signed. Positive is long. */
  qty: string;
};

/** The cumulative state the venue reports for one order. */
export type VenueOrderState = {
  cumQty: string;
  leavesQty: string;
  avgPx?: string;
};

export type ReconciliationBreak =
  | {
      kind: "position";
      symbol: string;
      /** What this client computed from its own fills. */
      ours: string;
      /** What the venue says. **This one is right.** */
      venue: string;
      /** `|ours - venue|`, so the size of the problem is on screen. */
      difference: string;
      at: number;
    }
  | {
      kind: "order";
      clientOrderId: string;
      symbol: string;
      ourCumQty: string;
      venueCumQty: string;
      ourLeavesQty: string;
      venueLeavesQty: string;
      at: number;
    }
  | {
      kind: "unknown-fate";
      /**
       * The only handle that exists in the window between "sent" and
       * "acknowledged" — which is exactly the window a disconnect lands in
       * (§2.3). There is no venue id for this order because there may never
       * have been one.
       */
      clientOrderId: string;
      symbol: string;
      side: "buy" | "sell";
      qty: string;
      sentAt: number;
      at: number;
    };

export type ReconciliationScales = { qtyExp?: number; at: number };

/**
 * Compare positions computed from OUR fills with what the venue reports.
 *
 * Both directions matter, and the second is the dangerous one: a position the
 * venue holds that this client knows nothing about renders as *flat*, and a
 * trader looking at flat does not hedge.
 */
export function reconcilePositions(
  fills: readonly BlotterFill[],
  venuePositions: readonly VenuePosition[],
  scales: ReconciliationScales,
): ReconciliationBreak[] {
  const qtyExp = scales.qtyExp ?? 0;
  const ours = positionsFromFills(fills, qtyExp);
  const breaks: ReconciliationBreak[] = [];

  const symbols = new Set<string>([
    ...ours.keys(),
    ...venuePositions.map((p) => p.symbol),
  ]);

  for (const symbol of symbols) {
    const mine = ours.get(symbol) ?? parseDecimal("0", qtyExp);
    const theirs = parseDecimal(
      venuePositions.find((p) => p.symbol === symbol)?.qty ?? "0",
      qtyExp,
    );
    if (cmp(mine, theirs) === 0) continue;
    breaks.push({
      kind: "position",
      symbol,
      ours: formatDecimal(mine),
      venue: formatDecimal(theirs),
      difference: formatDecimal(abs(sub(mine, theirs))),
      at: scales.at,
    });
  }

  return breaks.sort((a, b) => (a.kind === "position" && b.kind === "position" ? a.symbol.localeCompare(b.symbol) : 0));
}

/** Net signed position per symbol, from the EFFECTIVE fills only. */
function positionsFromFills(
  fills: readonly BlotterFill[],
  qtyExp: number,
): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  // A busted fill is not a trade (§2.3). Counting one is how our side of the
  // comparison disagrees with the venue for a reason that is our own fault.
  for (const row of reconcileFills(fills)) {
    if (!row.effective) continue;
    const position = out.get(row.symbol) ?? parseDecimal("0", qtyExp);
    const fill: Fill = {
      side: row.side,
      qty: parseDecimal(row.qty, qtyExp),
      price: parseDecimal(row.price, 2),
      at: row.at,
    };
    // Only the QUANTITY is compared here, so the contract type cannot change
    // the answer — a position is a count either way. P&L is a different
    // question and `roundTrips()` is where it is asked.
    const result = applyFill(
      { ...emptyPosition("average", 2), qty: position },
      fill,
      { contractType: "linear", multiplier: parseDecimal("1", 0), moneyExp: 2 },
    );
    out.set(row.symbol, result.position.qty);
  }
  return out;
}

/**
 * Compare one order's cumulative state with the venue's.
 *
 * Delegates the actual predicate to the domain's `isReconciliationBreak()`
 * rather than re-deriving it, so a blotter and a risk daemon cannot disagree
 * about what counts as a break.
 */
export function reconcileOrder(
  order: BlotterOrder,
  venue: VenueOrderState,
  options: { qtyExp?: number; at?: number } = {},
): ReconciliationBreak | null {
  const qtyExp = options.qtyExp ?? 0;
  const q = (v: string): Decimal => parseDecimal(v, qtyExp);

  const intent: OrderIntent = {
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    qty: q(order.qty),
    type: order.type,
    tif: order.tif,
    origin: "human",
  };
  const ours: Order = {
    clientOrderId: order.clientOrderId,
    intent,
    status: order.status,
    cumQty: q(order.cumQty),
    leavesQty: q(order.leavesQty),
    avgPx: parseDecimal(order.avgPx ?? "0", 2),
    receivedAt: order.receivedAt,
    becameExecutableAt: null,
    updatedAt: order.updatedAt,
  };
  const report: OrderEvent = {
    clientOrderId: order.clientOrderId,
    execType: "orderStatus",
    status: order.status,
    cumQty: q(venue.cumQty),
    leavesQty: q(venue.leavesQty),
    avgPx: parseDecimal(venue.avgPx ?? "0", 2),
    at: options.at ?? order.updatedAt,
  };

  if (!isReconciliationBreak(ours, report)) return null;

  return {
    kind: "order",
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    ourCumQty: order.cumQty,
    venueCumQty: venue.cumQty,
    ourLeavesQty: order.leavesQty,
    venueLeavesQty: venue.leavesQty,
    at: options.at ?? order.updatedAt,
  };
}

/**
 * Orders we sent that the venue does not report — and only the `pendingNew`
 * ones.
 *
 * §2.6 scopes this deliberately. `pendingNew` is the window between "sent" and
 * "acknowledged", and an order lost in it may have been rejected OR accepted
 * with the ack lost. A working order absent from a snapshot is an ordinary
 * reconciliation problem; conflating the two buries the one that cannot be
 * resolved by any amount of retrying.
 */
export function findUnknownFate(
  ourOrders: readonly BlotterOrder[],
  venueClientOrderIds: readonly string[],
  scales: { at: number },
): ReconciliationBreak[] {
  const known = new Set(venueClientOrderIds);
  return ourOrders
    .filter((o) => o.status === "pendingNew" && !known.has(o.clientOrderId))
    .map((o) => ({
      kind: "unknown-fate" as const,
      clientOrderId: o.clientOrderId,
      symbol: o.symbol,
      side: o.side,
      qty: o.qty,
      sentAt: o.receivedAt,
      at: scales.at,
    }));
}

/**
 * One sentence per break — the SAME one a human reads and a bridge hands an
 * agent, for the same reason `livenessSummary()` is one function.
 */
export function describeBreak(candidate: ReconciliationBreak): string {
  switch (candidate.kind) {
    case "position":
      return (
        `Position in ${candidate.symbol} DISAGREES with the venue: this client computed ` +
        `${candidate.ours}, the venue reports ${candidate.venue} (out by ${candidate.difference}). ` +
        `The venue is authoritative — do not trade this symbol until it is resolved.`
      );
    case "order":
      return (
        `Order ${candidate.clientOrderId} (${candidate.symbol}) DISAGREES with the venue: this ` +
        `client has ${candidate.ourCumQty} filled with ${candidate.ourLeavesQty} working, the ` +
        `venue reports ${candidate.venueCumQty} filled with ${candidate.venueLeavesQty} working. ` +
        `The venue is authoritative.`
      );
    case "unknown-fate":
      return (
        `Order ${candidate.clientOrderId} (${candidate.side} ${candidate.qty} ${candidate.symbol}) ` +
        `was sent and the venue does not report it. Its fate is UNKNOWN — it may have been ` +
        `rejected, or accepted with the acknowledgement lost. This NEEDS A HUMAN: it has not ` +
        `been guessed either way, and it is neither cancelled nor working until you check.`
      );
  }
}

export type ReconciliationVerdict = {
  readonly allowed: boolean;
  /** `null` when allowed. Otherwise the sentence to put on the disabled control. */
  readonly reason: string | null;
};

/**
 * Whether a surface may be acted on while these breaks stand.
 *
 * Separate from `oneClickVerdict()` on purpose: that one answers "is what I am
 * looking at CURRENT", this one answers "is what I am looking at TRUE". A live
 * feed reporting a position we dispute passes the first and fails the second,
 * and it is the more dangerous of the two because nothing looks broken.
 */
export function reconciliationVerdict(
  breaks: readonly ReconciliationBreak[],
): ReconciliationVerdict {
  if (breaks.length === 0) return { allowed: true, reason: null };
  const first = breaks[0]!;
  const subject =
    first.kind === "position"
      ? first.symbol
      : `${first.symbol} (${first.clientOrderId})`;
  const more = breaks.length > 1 ? ` and ${breaks.length - 1} other break(s)` : "";
  return {
    allowed: false,
    reason:
      `Trading is off because this client and the venue disagree about ${subject}${more}. ` +
      `Resolve the reconciliation break first — the venue is authoritative.`,
  };
}
