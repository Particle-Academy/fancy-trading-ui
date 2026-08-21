/**
 * The order ticket's logic, headless.
 *
 * Separated from the rendering for two reasons. It is the piece an MCP bridge
 * reads and writes, so it must not require a DOM; and it is where §3.1's
 * asymmetry is enforced, which means it must be testable without clicking
 * anything.
 *
 * **The gate is `submittable()` from `@particle-academy/fancy-trading`, not a
 * branch in here.** That function takes an `Approval` as a required argument
 * and an `Approval` can only come from `approve()`, so an unapproved
 * agent-origin order is not "rejected at runtime" — it is unrepresentable. This
 * hook's job is to route every submit through it and turn the resulting throw
 * into a human-facing confirmation, rather than to re-implement the rule.
 */

import { useMemo, useState } from "react";
import {
  ApprovalRequired,
  type Approval,
  type Decimal,
  type OrderIntent,
  approve,
  cmp,
  parseDecimal,
  submittable,
} from "@particle-academy/fancy-trading";
import {
  checkLimits,
  parseLimits,
  type JsonRiskLimits,
  type LimitVerdict,
} from "../../safety/limits.ts";
import { TRADING_WARNINGS, WarningRegistry, type WarningId } from "../../safety/warnings.ts";
import { LIVE, oneClickVerdict, type Liveness, type TradingMode } from "../../safety/mode.ts";
import { parsePrice } from "../../format.ts";
import type { AttachedOrders, TicketEstimate, TicketInstrument, TicketValue } from "./types.ts";

/** Top of book and a reference price, as strings. Optional — checks that cannot run say so. */
export type TicketMarketContext = {
  bestBid?: string;
  bestAsk?: string;
  /** Last or mark, for the price-deviation guard. */
  referencePrice?: string;
  /** Signed current position in this symbol. */
  positionQty?: string;
  accountPositionQty?: string;
  /** Today's net P&L. Negative is a loss. */
  dailyNetPnl?: string;
  accountBalance?: string;
  /** Epoch ms of recent outbound messages, for the rate limit. */
  recentMessagesAt?: readonly number[];
};

export type UseOrderTicketArgs = {
  instrument: TicketInstrument;
  value: TicketValue;
  mode: TradingMode;
  liveness?: Liveness;
  origin?: "human" | "agent";
  clientOrderId: string;
  limits?: JsonRiskLimits;
  market?: TicketMarketContext;
  warnings?: WarningRegistry;
  scope?: string;
  estimate?: (intent: OrderIntent) => TicketEstimate | null;
  /** Money scale for limits and estimates. Defaults to 2. */
  moneyExp?: number;
  now?: number;
};

export type TicketWarning = { id: WarningId; message: string; detail?: string };

export type UseOrderTicketResult = {
  /** `null` when the typed values do not parse — the error is in `parseError`. */
  intent: OrderIntent | null;
  parseError: string | null;
  verdict: LimitVerdict | null;
  estimate: TicketEstimate | null;
  warnings: TicketWarning[];
  scope: string;
  /** Why submit is unavailable, or `null`. */
  blockedReason: string | null;
  canSubmit: boolean;
  attached: AttachedOrders | undefined;
};

const num = (v: string | undefined, exp: number): Decimal | undefined =>
  v === undefined || v === "" ? undefined : parseDecimal(v, exp);

/** Turn the controlled value into a domain `OrderIntent`, or explain why not. */
export function buildIntent(
  args: Pick<UseOrderTicketArgs, "instrument" | "value" | "origin" | "clientOrderId">,
): { intent: OrderIntent | null; parseError: string | null } {
  const { instrument, value, clientOrderId } = args;
  try {
    const price = (raw: string | undefined): Decimal | undefined =>
      raw === undefined || raw === ""
        ? undefined
        : parsePrice(raw, instrument.priceDisplay, instrument.priceExp);

    const intent: OrderIntent = {
      clientOrderId,
      symbol: instrument.symbol,
      side: value.side,
      qty: parseDecimal(value.qty === "" ? "0" : value.qty, instrument.qtyExp),
      type: value.type,
      limitPrice: price(value.limitPrice),
      triggerPrice: price(value.triggerPrice),
      trailOffset: price(value.trailOffset),
      tif: value.tif,
      reduceOnly: value.reduceOnly,
      postOnly: value.postOnly,
      // §3.1: set by the TRANSPORT, never by the caller. `TicketValue` has no
      // origin field, so a value written by an agent has nowhere to claim it is
      // human — and a value that carries one anyway never reaches this line.
      origin: args.origin ?? "human",
      tag: value.tag,
    };
    return { intent, parseError: null };
  } catch (error) {
    return { intent: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

export function useOrderTicket(args: UseOrderTicketArgs): UseOrderTicketResult {
  const {
    instrument,
    value,
    liveness = LIVE,
    origin = "human",
    clientOrderId,
    limits,
    market,
    moneyExp = 2,
    now = Date.now(),
  } = args;

  const scope = args.scope ?? `ticket:${instrument.symbol}`;

  const { intent, parseError } = useMemo(
    () => buildIntent({ instrument, value, origin, clientOrderId }),
    [instrument, value, origin, clientOrderId],
  );

  const verdict = useMemo<LimitVerdict | null>(() => {
    if (!intent) return null;
    return checkLimits(parseLimits(limits, { qtyExp: instrument.qtyExp, moneyExp }), {
      intent,
      now,
      positionQty: num(market?.positionQty, instrument.qtyExp),
      accountPositionQty: num(market?.accountPositionQty, instrument.qtyExp),
      dailyNetPnl: num(market?.dailyNetPnl, moneyExp),
      accountBalance: num(market?.accountBalance, moneyExp),
      referencePrice: num(market?.referencePrice, instrument.priceExp),
      bestBid: num(market?.bestBid, instrument.priceExp),
      bestAsk: num(market?.bestAsk, instrument.priceExp),
      lastTradingDate: instrument.lastTradingDate,
      isContinuous: instrument.isContinuous,
      recentMessagesAt: market?.recentMessagesAt,
    });
  }, [intent, limits, instrument, market, moneyExp, now]);

  const estimate = intent && args.estimate ? args.estimate(intent) : null;

  const warnings = useMemo<TicketWarning[]>(() => {
    if (!intent) return [];
    const out: TicketWarning[] = [];
    const bid = num(market?.bestBid, instrument.priceExp);
    const ask = num(market?.bestAsk, instrument.priceExp);

    // Warnings are independent of the limits. A limit REFUSES; a warning is the
    // same fact when the developer has not chosen to refuse it, and the trader
    // still deserves to be told before they send.
    if (intent.type === "limit" && intent.limitPrice) {
      const opposing = intent.side === "buy" ? ask : bid;
      if (opposing) {
        // Both sides are parsed at the instrument's scale, so `cmp` is exact.
        const crosses =
          intent.side === "buy"
            ? cmp(intent.limitPrice, opposing) >= 0
            : cmp(intent.limitPrice, opposing) <= 0;
        if (crosses) {
          out.push({
            id: TRADING_WARNINGS.ImmediateFill,
            message: "This order will fill immediately.",
            detail: `A ${intent.side} limit here crosses the ${intent.side === "buy" ? "ask" : "bid"}. If that is what you want, a market order says so plainly.`,
          });
        }
      }
    }

    if (intent.type === "market") {
      out.push({
        id: TRADING_WARNINGS.MarketOrderUnprotected,
        message: "A market order has no price protection.",
        detail: "It fills at whatever is available, which in a fast market can be far from the last price.",
      });
    }

    if (instrument.lastTradingDate !== undefined) {
      const days = (instrument.lastTradingDate - now) / 86_400_000;
      if (days >= 0 && days <= 3) {
        out.push({
          id: TRADING_WARNINGS.NearExpiry,
          message: `${instrument.displaySymbol ?? instrument.symbol} stops trading in under ${Math.ceil(days)} day(s).`,
        });
      }
    }

    if (liveness.state !== "live") {
      out.push({
        id: TRADING_WARNINGS.StaleState,
        message: "Your position and working orders may not be what is shown.",
        detail: liveness.reason,
      });
    }

    return out;
  }, [intent, market, instrument, liveness, now]);

  const oneClick = oneClickVerdict(liveness, args.mode);

  const blockedReason = parseError
    ? parseError
    : !oneClick.allowed
      ? oneClick.reason
      : verdict && !verdict.ok
        ? (verdict.breaches.find((b) => b.action === "refuse")?.message ?? "Blocked by a risk limit.")
        : intent && intent.qty.v <= 0n
          ? "Quantity must be greater than zero."
          : null;

  return {
    intent,
    parseError,
    verdict,
    estimate,
    warnings,
    scope,
    blockedReason,
    canSubmit: blockedReason === null && intent !== null,
    attached: value.attached,
  };
}

export type SubmitOutcome =
  | { kind: "submitted"; intent: OrderIntent; approval?: Approval }
  | { kind: "needs-approval"; intent: OrderIntent };

/**
 * Route a submit through the domain gate.
 *
 * Note the shape: there is no `if (origin === "agent")` here. We simply call
 * `submittable()` and let it decide. An implementation that grew a permissive
 * branch would have to delete this call to do it, which is exactly the change
 * a reviewer notices.
 */
export function attemptSubmit(intent: OrderIntent, approval?: Approval): SubmitOutcome {
  try {
    return { kind: "submitted", intent: submittable(intent, approval), approval };
  } catch (error) {
    if (error instanceof ApprovalRequired) return { kind: "needs-approval", intent };
    throw error;
  }
}

/** Called by the human-facing confirmation affordance, never by an agent path. */
export function approveIntent(intent: OrderIntent, approvedBy: string): Approval {
  return approve(intent, approvedBy);
}

export function useApprovalGate(): {
  pending: OrderIntent | null;
  propose: (intent: OrderIntent) => void;
  clear: () => void;
} {
  const [pending, setPending] = useState<OrderIntent | null>(null);
  return { pending, propose: setPending, clear: () => setPending(null) };
}
