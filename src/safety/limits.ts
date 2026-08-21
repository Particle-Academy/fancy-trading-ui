/**
 * Risk limits — the mechanism, and deliberately none of the policy.
 *
 * §3.3, verbatim in intent: *we provide the mechanism for every guard in §2.2
 * and ship no default policy values. What counts as too big is the developer's
 * decision and their user's. What we guarantee is that the check exists, runs
 * in one place, and reports which limit clamped an order.*
 *
 * So {@link NO_LIMITS} is genuinely empty, every field of {@link RiskLimits} is
 * optional, and `checkLimits(NO_LIMITS, …)` passes a one-million-lot order. A
 * kit that refuses that has decided for the developer what too big means.
 *
 * The one thing here that is NOT a policy is the continuous-contract refusal.
 * A back-adjusted continuous symbol is a display construct whose historical
 * prices change on every roll (§2.8); an order against it is a category error
 * rather than an aggressive choice, so it is refused regardless of settings.
 *
 * This module is React-free and is re-exported from the `/safety` entry point,
 * because §3.2 requires these checks to run **server-side as well as
 * client-side** — a client-side quantity cap is decoration once an agent is
 * placing orders through a bridge.
 */

import {
  type Decimal,
  ZERO,
  parseDecimal,
  abs,
  add,
  cmp,
  dec,
  div,
  mul,
  neg,
  sign,
  sub,
} from "@particle-academy/fancy-trading";

export type LimitName =
  | "continuousSymbol"
  | "liquidationOnly"
  | "orderQty"
  | "symbolPosition"
  | "accountPosition"
  | "dailyLoss"
  | "minBalance"
  | "expiry"
  | "priceDeviation"
  | "immediateFill"
  | "immediateFillStop"
  | "messageRate";

/**
 * What to do when the daily net loss limit is reached. Sierra Chart ships both
 * the hard and the soft version and so do we; `"flatten"` refuses new increases
 * here and signals the host to flatten, which is an action this package cannot
 * take on its own.
 */
export type DailyLossAction = "block-increase" | "flatten" | "warn";

/**
 * Every field optional, every field un-defaulted. A limit that is not set does
 * not run — it is not "unlimited by default", it is *not configured*, and
 * {@link LimitVerdict.unevaluated} distinguishes "did not fire" from "could not
 * be checked".
 */
export type RiskLimits = {
  /** Per-order quantity cap. Catches one fat finger, not twenty small ones. */
  maxOrderQty?: Decimal;
  /** Cap on the ABSOLUTE resulting position in this symbol. */
  maxSymbolPositionQty?: Decimal;
  /** Cap on the absolute resulting position across the account. */
  maxAccountPositionQty?: Decimal;
  /** A positive number. Breached when the day's net P&L is at or below its negation. */
  dailyNetLossLimit?: Decimal;
  /** Defaults to `"block-increase"` — a loss limit with no action does nothing. */
  onDailyLossLimit?: DailyLossAction;
  /** Below this account balance, positions may only be reduced. */
  minAccountBalance?: Decimal;
  /** Refuse a price more than this many basis points from the reference price. */
  maxPriceDeviationBps?: number;
  /** Sierra's "Reject Chart Trade Orders That Will Immediately Fill". */
  rejectImmediateFill?: boolean;
  /** Sierra's "Reject Stop Orders That Will Immediately Fill" — the inverse test. */
  rejectImmediateFillStops?: boolean;
  /** "Number of Days Before Last Trading Date to Disallow Orders". */
  daysBeforeExpiryToBlock?: number;
  /** Venue-style throttle, evaluated over a rolling window. */
  messageRateLimit?: { messages: number; perSeconds: number };
  /** Positions may only be reduced. */
  liquidationOnly?: boolean;
};

/**
 * No policy at all. Exported as a named constant so "we ship no defaults" is a
 * thing a consumer can point at rather than an absence they have to infer.
 */
export const NO_LIMITS: RiskLimits = Object.freeze({});

/**
 * The part of an order the limits need. Any `OrderIntent` from
 * `@particle-academy/fancy-trading` satisfies it structurally.
 */
export type LimitIntent = {
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly qty: Decimal;
  readonly type: "market" | "limit" | "stop" | "stopLimit" | "trailingStop";
  readonly limitPrice?: Decimal;
  readonly triggerPrice?: Decimal;
  readonly reduceOnly?: boolean;
};

export type LimitContext = {
  readonly intent: LimitIntent;
  readonly now: number;
  /** Signed. Positive is long. */
  readonly positionQty?: Decimal;
  /** Signed, summed across the account in whatever unit the caller nets in. */
  readonly accountPositionQty?: Decimal;
  /** Today's net P&L. Negative is a loss. */
  readonly dailyNetPnl?: Decimal;
  readonly accountBalance?: Decimal;
  /** Last / mark, for the deviation check. */
  readonly referencePrice?: Decimal;
  readonly bestBid?: Decimal;
  readonly bestAsk?: Decimal;
  /** Epoch ms. Absent means the instrument does not expire. */
  readonly lastTradingDate?: number;
  /** A back-adjusted continuous futures symbol, which cannot be traded. */
  readonly isContinuous?: boolean;
  /** Epoch ms of recent outbound messages, for the rate limit. */
  readonly recentMessagesAt?: readonly number[];
};

export type LimitBreach = {
  readonly limit: LimitName;
  /** Rendered to a human verbatim, and handed to an agent verbatim. */
  readonly message: string;
  /** `"refuse"` stops the order. `"warn"` records it and lets it through. */
  readonly action: "refuse" | "warn";
};

export type LimitVerdict = {
  readonly ok: boolean;
  /**
   * The limit that decided the outcome — the first refusal in evaluation order.
   * `null` when nothing fired. This is the field that makes the answer honest:
   * a bare `false` cannot be told apart from a bug.
   */
  readonly clampedBy: LimitName | null;
  /** Every limit that fired, refusals and warnings alike. Order is stable. */
  readonly breaches: readonly LimitBreach[];
  /**
   * The largest quantity the QUANTITY-shaped limits would have allowed, so a
   * surface can offer "reduce to N". `null` when none is configured. It says
   * nothing about the non-quantity refusals — reducing the size of an order
   * that would fill immediately does not stop it filling immediately.
   */
  readonly maxAllowedQty: Decimal | null;
  /**
   * Limits that are configured but could not be evaluated, because the context
   * to evaluate them was missing. A check that silently passes when it could not
   * run is the same failure as a surface that silently renders less (§3.2).
   */
  readonly unevaluated: readonly LimitName[];
};

const DAY_MS = 86_400_000;

const dirOf = (side: "buy" | "sell"): 1 | -1 => (side === "buy" ? 1 : -1);

/** Run every configured limit. Order of evaluation fixes `clampedBy`. */
export function checkLimits(limits: RiskLimits, ctx: LimitContext): LimitVerdict {
  const breaches: LimitBreach[] = [];
  const unevaluated: LimitName[] = [];
  const { intent } = ctx;
  const dir = dirOf(intent.side);
  const reduceOnly = intent.reduceOnly === true;

  const refuse = (limit: LimitName, message: string): void => {
    breaches.push({ limit, message, action: "refuse" });
  };
  const warn = (limit: LimitName, message: string): void => {
    breaches.push({ limit, message, action: "warn" });
  };

  // 1. Not a policy: a continuous symbol is not a tradable contract.
  if (ctx.isContinuous) {
    refuse(
      "continuousSymbol",
      `${intent.symbol} is a continuous (back-adjusted) symbol. It is a charting construct, not a contract — resolve it to the actual contract before ordering.`,
    );
  }

  const positionQty = ctx.positionQty ?? ZERO(intent.qty.exp);
  const posDir = sign(positionQty);
  const increases = !reduceOnly && (posDir === 0 || posDir === dir);

  // 2. Liquidation-only.
  if (limits.liquidationOnly && increases) {
    refuse("liquidationOnly", "Liquidation-only mode: positions may only be reduced.");
  }

  // 3. Per-order quantity cap.
  if (limits.maxOrderQty && cmp(intent.qty, limits.maxOrderQty) > 0) {
    refuse(
      "orderQty",
      `Order quantity exceeds the per-order limit (${fmt(limits.maxOrderQty)}).`,
    );
  }

  // 4/5. Position caps — on the RESULTING position, which is what catches the
  // repeated-click failure a per-order cap does not.
  const symbolCap = quantityHeadroom(limits.maxSymbolPositionQty, positionQty, dir, reduceOnly);
  if (symbolCap !== null && cmp(intent.qty, symbolCap) > 0) {
    refuse(
      "symbolPosition",
      `Resulting position in ${intent.symbol} would exceed the per-symbol limit (${fmt(limits.maxSymbolPositionQty!)}). At most ${fmt(symbolCap)} more.`,
    );
  }

  const accountQty = ctx.accountPositionQty ?? ZERO(intent.qty.exp);
  const accountCap = quantityHeadroom(
    limits.maxAccountPositionQty,
    accountQty,
    dir,
    reduceOnly,
  );
  if (accountCap !== null && cmp(intent.qty, accountCap) > 0) {
    refuse(
      "accountPosition",
      `Resulting account position would exceed the account limit (${fmt(limits.maxAccountPositionQty!)}). At most ${fmt(accountCap)} more.`,
    );
  }

  // 6. Daily net loss.
  if (limits.dailyNetLossLimit) {
    if (ctx.dailyNetPnl === undefined) {
      unevaluated.push("dailyLoss");
    } else if (cmp(ctx.dailyNetPnl, neg(limits.dailyNetLossLimit)) <= 0) {
      const action = limits.onDailyLossLimit ?? "block-increase";
      const message = `Daily net loss limit reached (${fmt(ctx.dailyNetPnl)} against a limit of ${fmt(limits.dailyNetLossLimit)}).`;
      if (action === "warn") warn("dailyLoss", message);
      else if (increases) refuse("dailyLoss", `${message} New or increasing positions are blocked; you can still reduce.`);
    }
  }

  // 7. Minimum account balance.
  if (limits.minAccountBalance) {
    if (ctx.accountBalance === undefined) unevaluated.push("minBalance");
    else if (cmp(ctx.accountBalance, limits.minAccountBalance) < 0 && increases) {
      refuse(
        "minBalance",
        `Account balance ${fmt(ctx.accountBalance)} is below the required minimum ${fmt(limits.minAccountBalance)}. Positions may only be reduced.`,
      );
    }
  }

  // 8. Expiry guard.
  if (limits.daysBeforeExpiryToBlock !== undefined) {
    if (ctx.lastTradingDate === undefined) {
      // Not unevaluated: an instrument with no expiry genuinely cannot breach it.
    } else if (ctx.lastTradingDate - ctx.now < limits.daysBeforeExpiryToBlock * DAY_MS) {
      refuse(
        "expiry",
        `${intent.symbol} is within ${limits.daysBeforeExpiryToBlock} day(s) of its last trading date. Orders are blocked — roll to the next contract.`,
      );
    }
  }

  // 9. Price deviation.
  if (limits.maxPriceDeviationBps !== undefined) {
    const price = intent.limitPrice ?? intent.triggerPrice;
    if (!price || !ctx.referencePrice || ctx.referencePrice.v === 0n) {
      if (intent.type !== "market") unevaluated.push("priceDeviation");
    } else {
      const bps = div(
        mul(abs(sub(price, ctx.referencePrice)), dec(10_000n, 0)),
        abs(ctx.referencePrice),
        0,
        "half-up",
      );
      if (Number(bps.v) > limits.maxPriceDeviationBps) {
        refuse(
          "priceDeviation",
          `Price ${fmt(price)} is ${bps.v} bps from the reference ${fmt(ctx.referencePrice)}, beyond the ${limits.maxPriceDeviationBps} bps limit.`,
        );
      }
    }
  }

  // 10. Immediate-fill rejection for LIMIT orders. Better than a confirmation
  // dialog because it costs nothing when you are right (§2.2).
  if (limits.rejectImmediateFill) {
    const px = intent.type === "limit" ? intent.limitPrice : undefined;
    const opposing = intent.side === "buy" ? ctx.bestAsk : ctx.bestBid;
    if (intent.type !== "limit") {
      // Nothing to check — a market order is meant to fill immediately.
    } else if (!px || !opposing) {
      unevaluated.push("immediateFill");
    } else if (intent.side === "buy" ? cmp(px, opposing) >= 0 : cmp(px, opposing) <= 0) {
      refuse(
        "immediateFill",
        `A ${intent.side} limit at ${fmt(px)} would fill immediately against ${fmt(opposing)}. If that is what you want, send a market order.`,
      );
    }
  }

  // 11. Immediate-fill rejection for STOPS — the direction is INVERTED, and a
  // guard copied from the limit case gets exactly the wrong answer.
  if (limits.rejectImmediateFillStops) {
    const trigger = intent.type === "stop" || intent.type === "stopLimit" ? intent.triggerPrice : undefined;
    const reference = intent.side === "buy" ? ctx.bestAsk : ctx.bestBid;
    if (intent.type !== "stop" && intent.type !== "stopLimit") {
      // Not a stop.
    } else if (!trigger || !reference) {
      unevaluated.push("immediateFillStop");
    } else if (intent.side === "buy" ? cmp(trigger, reference) <= 0 : cmp(trigger, reference) >= 0) {
      refuse(
        "immediateFillStop",
        `A ${intent.side} stop at ${fmt(trigger)} is already triggered against ${fmt(reference)} and would fire immediately.`,
      );
    }
  }

  // 12. Message rate.
  if (limits.messageRateLimit) {
    const { messages, perSeconds } = limits.messageRateLimit;
    if (!ctx.recentMessagesAt) {
      unevaluated.push("messageRate");
    } else {
      const windowStart = ctx.now - perSeconds * 1000;
      const inWindow = ctx.recentMessagesAt.filter((t) => t > windowStart).length;
      if (inWindow >= messages) {
        refuse(
          "messageRate",
          `Message rate limit: ${inWindow} message(s) already sent in the last ${perSeconds}s, limit ${messages}.`,
        );
      }
    }
  }

  const refusals = breaches.filter((b) => b.action === "refuse");
  const caps = [limits.maxOrderQty, symbolCap ?? undefined, accountCap ?? undefined].filter(
    (c): c is Decimal => c !== undefined,
  );

  return {
    ok: refusals.length === 0,
    clampedBy: refusals[0]?.limit ?? null,
    breaches,
    maxAllowedQty: caps.length ? caps.reduce((a, b) => (cmp(a, b) <= 0 ? a : b)) : null,
    unevaluated,
  };
}

/**
 * How much MORE can be traded in this direction before the absolute position
 * cap is breached. `null` when no cap is configured or the order reduces.
 *
 * For a buy the headroom is `cap - position`; for a sell it is `cap + position`.
 * Both fall out of `|position + dir * qty| <= cap` with a signed position, and
 * both are why the check is on the resulting position rather than the order.
 */
function quantityHeadroom(
  cap: Decimal | undefined,
  position: Decimal,
  dir: 1 | -1,
  reduceOnly: boolean,
): Decimal | null {
  if (!cap || reduceOnly) return null;
  const headroom = dir === 1 ? sub(cap, position) : add(cap, position);
  return headroom.v < 0n ? ZERO(headroom.exp) : headroom;
}

function fmt(d: Decimal): string {
  const neg2 = d.v < 0n;
  const a = (neg2 ? -d.v : d.v).toString().padStart(d.exp + 1, "0");
  const whole = a.slice(0, a.length - d.exp);
  const frac = d.exp === 0 ? "" : `.${a.slice(a.length - d.exp)}`;
  return `${neg2 ? "-" : ""}${whole}${frac}`;
}

// ─── Position sizing by risk (§2.1) ──────────────────────────────────────────

export type SizeByRiskInput = {
  readonly equity: Decimal;
  /** e.g. `0.0100` at exp 4 for 1%. */
  readonly riskFraction: Decimal;
  readonly entry: Decimal;
  readonly stop: Decimal;
  /** Currency per 1.00 of price movement per unit. `1` for shares. */
  readonly multiplier: Decimal;
  readonly moneyExp: number;
  readonly side?: "buy" | "sell";
  /** Expected slippage per unit, in price terms. The first omitted cost. */
  readonly slippagePerUnit?: Decimal;
  /** Round-turn commission + fees per unit, in price terms. The second. */
  readonly roundTurnCostPerUnit?: Decimal;
  /** Initial margin per unit. With `buyingPower`, gives the feasibility clamp. */
  readonly initialMarginPerUnit?: Decimal;
  readonly buyingPower?: Decimal;
  /** A hard cap from {@link RiskLimits.maxSymbolPositionQty} or similar. */
  readonly maxPositionQty?: Decimal;
  /** Round the answer DOWN to a whole number of these. Defaults to 1. */
  readonly lotSize?: Decimal;
  /** Optional profit target, for {@link SizeByRiskResult.rMultipleToTarget}. */
  readonly target?: Decimal;
};

export type SizeClamp = "risk" | "buyingPower" | "positionLimit" | "lotSize";

export type SizeByRiskResult = {
  readonly size: Decimal;
  /** `equity * riskFraction` — the money the trader said they would lose. */
  readonly riskAmount: Decimal;
  /** Price distance PLUS costs. The number the naive version leaves out. */
  readonly riskPerUnit: Decimal;
  /**
   * Reward-to-risk at the target, measured against the FULL risk per unit
   * including costs — because that is what is actually at risk. `null` with no
   * target, rather than a zero pretending to be an answer.
   */
  readonly rMultipleToTarget: Decimal | null;
  readonly marginRequired: Decimal | null;
  /** Which constraint produced this number. Never `null` — see the tests. */
  readonly clampedBy: SizeClamp;
};

/**
 * Size a position from a risk budget.
 *
 * ```
 * risk_capital  = equity * risk_fraction
 * risk_per_unit = |entry - stop| + slippage + round-turn cost
 * size          = floor(risk_capital / (risk_per_unit * multiplier))
 * size          = min(size, size_by_buying_power, max_position_limit)
 * ```
 *
 * The two lines real implementations omit are the **cost buffer** — without it
 * a "1% risk" trade loses more than 1%, which `tests/safety-limits.test.ts`
 * demonstrates arithmetically — and the **margin feasibility clamp**, because a
 * size you cannot fund is not a size. {@link SizeByRiskResult.clampedBy} is what
 * makes the answer honest: a bare number cannot be told apart from "we ran out
 * of buying power and quietly halved it".
 */
export function sizeByRisk(input: SizeByRiskInput): SizeByRiskResult {
  const side = input.side ?? "buy";
  const distance = sub(input.entry, input.stop);

  if (distance.v === 0n) {
    throw new RangeError("stop equals entry: the risk per unit is zero and the size is undefined.");
  }
  // |entry - stop| hides a real mistake. A long whose stop is ABOVE the entry is
  // not a smaller trade, it is a different one.
  if (side === "buy" && distance.v < 0n) {
    throw new RangeError("a buy's stop must be BELOW the entry; this stop is above it.");
  }
  if (side === "sell" && distance.v > 0n) {
    throw new RangeError("a sell's stop must be ABOVE the entry; this stop is below it.");
  }

  const priceRisk = abs(distance);
  const riskPerUnit = add(
    add(priceRisk, input.slippagePerUnit ?? ZERO(priceRisk.exp)),
    input.roundTurnCostPerUnit ?? ZERO(priceRisk.exp),
  );

  const riskAmount = div(
    mul(input.equity, input.riskFraction),
    dec(1n, 0),
    input.moneyExp,
    "half-up",
  );

  const perUnitMoney = mul(riskPerUnit, input.multiplier);
  let size = div(riskAmount, perUnitMoney, 0, "floor");
  let clampedBy: SizeClamp = "risk";

  if (input.initialMarginPerUnit && input.buyingPower && input.initialMarginPerUnit.v !== 0n) {
    const byMargin = div(input.buyingPower, input.initialMarginPerUnit, 0, "floor");
    if (cmp(byMargin, size) < 0) {
      size = byMargin;
      clampedBy = "buyingPower";
    }
  }

  if (input.maxPositionQty && cmp(input.maxPositionQty, size) < 0) {
    size = input.maxPositionQty;
    clampedBy = "positionLimit";
  }

  const lot = input.lotSize;
  if (lot && lot.v > 0n) {
    const lots = div(size, lot, 0, "floor");
    const rounded = div(mul(lots, lot), dec(1n, 0), size.exp, "trunc");
    if (cmp(rounded, size) < 0) {
      size = rounded;
      clampedBy = "lotSize";
    }
  }

  if (size.v < 0n) size = ZERO(size.exp);

  const marginRequired = input.initialMarginPerUnit
    ? div(mul(size, input.initialMarginPerUnit), dec(1n, 0), input.moneyExp, "half-up")
    : null;

  const rMultipleToTarget = input.target
    ? div(
        abs(sub(input.target, input.entry)),
        riskPerUnit,
        Math.max(2, input.entry.exp),
        "half-up",
      )
    : null;

  return { size, riskAmount, riskPerUnit, rMultipleToTarget, marginRequired, clampedBy };
}

// ─── JSON-friendly limits ────────────────────────────────────────────────────

/**
 * {@link RiskLimits} with every value a decimal STRING.
 *
 * This is the shape a limit set takes on the wire and in a database, and the
 * shape a React prop has to be: `Decimal` carries a `bigint`, and
 * `JSON.stringify` throws on a bigint, so a `Decimal`-valued limit set cannot
 * cross an MCP bridge or a `props` boundary at all.
 */
export type JsonRiskLimits = {
  maxOrderQty?: string;
  maxSymbolPositionQty?: string;
  maxAccountPositionQty?: string;
  dailyNetLossLimit?: string;
  onDailyLossLimit?: DailyLossAction;
  minAccountBalance?: string;
  maxPriceDeviationBps?: number;
  rejectImmediateFill?: boolean;
  rejectImmediateFillStops?: boolean;
  daysBeforeExpiryToBlock?: number;
  messageRateLimit?: { messages: number; perSeconds: number };
  liquidationOnly?: boolean;
};

/**
 * Parse a JSON limit set at the caller's scales.
 *
 * Quantities and money have different scales and must be parsed at their own —
 * parsing a loss limit at the quantity scale is how a $2,000 limit silently
 * becomes $20.00.
 */
export function parseLimits(
  json: JsonRiskLimits | undefined,
  scales: { qtyExp: number; moneyExp: number },
): RiskLimits {
  if (!json) return NO_LIMITS;
  const q = (s: string | undefined): Decimal | undefined =>
    s === undefined ? undefined : parseDecimal(s, scales.qtyExp);
  const m = (s: string | undefined): Decimal | undefined =>
    s === undefined ? undefined : parseDecimal(s, scales.moneyExp);

  const out: RiskLimits = {};
  const assign = <K extends keyof RiskLimits>(key: K, value: RiskLimits[K]): void => {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  };

  assign("maxOrderQty", q(json.maxOrderQty));
  assign("maxSymbolPositionQty", q(json.maxSymbolPositionQty));
  assign("maxAccountPositionQty", q(json.maxAccountPositionQty));
  assign("dailyNetLossLimit", m(json.dailyNetLossLimit));
  assign("onDailyLossLimit", json.onDailyLossLimit);
  assign("minAccountBalance", m(json.minAccountBalance));
  assign("maxPriceDeviationBps", json.maxPriceDeviationBps);
  assign("rejectImmediateFill", json.rejectImmediateFill);
  assign("rejectImmediateFillStops", json.rejectImmediateFillStops);
  assign("daysBeforeExpiryToBlock", json.daysBeforeExpiryToBlock);
  assign("messageRateLimit", json.messageRateLimit);
  assign("liquidationOnly", json.liquidationOnly);
  return out;
}
