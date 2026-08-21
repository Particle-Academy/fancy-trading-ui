/**
 * The risk-limit mechanism (§2.2's verified Sierra Chart set, §3.3's rule about
 * whose policy it is).
 *
 * The governing constraint here is easy to state and easy to violate by
 * accident: **we provide the mechanism and ship no default policy values.**
 * What counts as too big is the developer's decision and their user's. The very
 * first test is the one that fails against the well-meaning implementation that
 * puts in "sensible defaults".
 */
import { describe, expect, test } from "vitest";
import { parseDecimal, type Decimal } from "@particle-academy/fancy-trading";
import {
  NO_LIMITS,
  checkLimits,
  sizeByRisk,
  type LimitContext,
  type RiskLimits,
} from "../src/safety/limits.ts";

const d = (s: string, exp = 2): Decimal => parseDecimal(s, exp);
const qty = (s: string): Decimal => parseDecimal(s, 0);

const base = (over: Partial<LimitContext> = {}): LimitContext => ({
  intent: { symbol: "ES", side: "buy", qty: qty("1"), type: "limit", limitPrice: d("5000.00") },
  now: Date.UTC(2026, 7, 20, 14, 0, 0),
  bestBid: d("5000.00"),
  bestAsk: d("5000.25"),
  ...over,
});

describe("no default policy — §3.3", () => {
  test("an absurd order passes when no limits are configured", () => {
    // A kit that refuses this has decided for the developer what too big means.
    const v = checkLimits(NO_LIMITS, base({ intent: { ...base().intent, qty: qty("1000000") } }));
    expect(v.ok).toBe(true);
    expect(v.clampedBy).toBeNull();
    expect(v.breaches).toEqual([]);
  });

  test("NO_LIMITS is genuinely empty — not a bag of quiet defaults", () => {
    expect(Object.keys(NO_LIMITS)).toEqual([]);
  });
});

describe("a continuous futures symbol is refused regardless of policy", () => {
  test("even with no limits at all", () => {
    // Not a limit: a category error. A back-adjusted continuous contract is a
    // display construct you cannot trade, and its price is not stable across
    // rolls. The order path must always resolve to the real contract (§2.8).
    const v = checkLimits(NO_LIMITS, base({ isContinuous: true }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("continuousSymbol");
  });
});

describe("the position limits catch what a per-order cap does not", () => {
  const limits: RiskLimits = { maxOrderQty: qty("10"), maxSymbolPositionQty: qty("25") };

  test("a single oversized order is refused by the per-order cap", () => {
    const v = checkLimits(limits, base({ intent: { ...base().intent, qty: qty("11") } }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("orderQty");
    expect(v.maxAllowedQty).toEqual(qty("10"));
  });

  test("the REPEATED-CLICK failure is caught by the position limit, not the order cap", () => {
    // Ten lots at a time, twenty times over. Every single order is inside the
    // per-order cap; the position is not. This is the failure §2.2 says a
    // per-order cap does not catch, and it is the reason both limits exist.
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, qty: qty("10") }, positionQty: qty("20") }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("symbolPosition");
    // It reports how much WOULD have been allowed, so the UI can offer it.
    expect(v.maxAllowedQty).toEqual(qty("5"));
  });

  test("the limit is on the RESULTING position, so selling out of a long is fine", () => {
    const v = checkLimits(
      limits,
      base({
        intent: { ...base().intent, side: "sell", qty: qty("10"), limitPrice: d("5000.25") },
        positionQty: qty("20"),
      }),
    );
    expect(v.ok).toBe(true);
  });

  test("a reduce-only order is never blocked by a position limit", () => {
    const v = checkLimits(
      limits,
      base({
        intent: { ...base().intent, side: "sell", qty: qty("10"), reduceOnly: true },
        positionQty: qty("20"),
      }),
    );
    expect(v.ok).toBe(true);
  });

  test("the account-wide limit fires even when the per-symbol one does not", () => {
    const v = checkLimits(
      { maxAccountPositionQty: qty("30") },
      base({ intent: { ...base().intent, qty: qty("10") }, accountPositionQty: qty("25") }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("accountPosition");
  });
});

describe("immediate-fill rejection is side-aware, and stops invert it", () => {
  const limits: RiskLimits = { rejectImmediateFill: true, rejectImmediateFillStops: true };

  test("a buy limit AT the ask would fill instantly — refused", () => {
    const v = checkLimits(limits, base({ intent: { ...base().intent, limitPrice: d("5000.25") } }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("immediateFill");
  });

  test("a buy limit BELOW the ask rests — allowed", () => {
    const v = checkLimits(limits, base({ intent: { ...base().intent, limitPrice: d("4999.75") } }));
    expect(v.ok).toBe(true);
  });

  test("a sell limit AT the bid would fill instantly — refused", () => {
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, side: "sell", limitPrice: d("5000.00") } }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("immediateFill");
  });

  test("a sell limit ABOVE the bid rests — allowed", () => {
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, side: "sell", limitPrice: d("5000.50") } }),
    );
    expect(v.ok).toBe(true);
  });

  test("a BUY STOP triggers when it is BELOW the market — the opposite direction", () => {
    // This is the check that a copy-pasted limit-order guard gets exactly
    // backwards, and getting it backwards means the guard passes every order
    // that would actually misfire.
    const v = checkLimits(
      limits,
      base({ intent: { symbol: "ES", side: "buy", qty: qty("1"), type: "stop", triggerPrice: d("4999.00") } }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("immediateFillStop");
  });

  test("a buy stop ABOVE the market is a normal breakout entry — allowed", () => {
    const v = checkLimits(
      limits,
      base({ intent: { symbol: "ES", side: "buy", qty: qty("1"), type: "stop", triggerPrice: d("5010.00") } }),
    );
    expect(v.ok).toBe(true);
  });

  test("a SELL STOP triggers when it is ABOVE the market", () => {
    const v = checkLimits(
      limits,
      base({ intent: { symbol: "ES", side: "sell", qty: qty("1"), type: "stop", triggerPrice: d("5001.00") } }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("immediateFillStop");
  });

  test("with no book, the guard cannot run and does not pretend to have run", () => {
    const v = checkLimits(limits, base({ bestBid: undefined, bestAsk: undefined }));
    expect(v.ok).toBe(true);
    expect(v.unevaluated).toContain("immediateFill");
  });
});

describe("the daily loss limit blocks increases, not exits", () => {
  const limits: RiskLimits = {
    dailyNetLossLimit: d("2000.00"),
    onDailyLossLimit: "block-increase",
  };

  test("an increase is refused once the day is down past the limit", () => {
    const v = checkLimits(limits, base({ dailyNetPnl: d("-2000.00") }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("dailyLoss");
  });

  test("a reduce-only order is still allowed — you can always get out", () => {
    const v = checkLimits(
      limits,
      base({
        intent: { ...base().intent, side: "sell", reduceOnly: true },
        dailyNetPnl: d("-2000.00"),
      }),
    );
    expect(v.ok).toBe(true);
  });

  test("a profit is not a loss, however large", () => {
    expect(checkLimits(limits, base({ dailyNetPnl: d("9999.00") })).ok).toBe(true);
  });

  test("`warn` does not refuse, but still reports the breach", () => {
    const v = checkLimits(
      { ...limits, onDailyLossLimit: "warn" },
      base({ dailyNetPnl: d("-2500.00") }),
    );
    expect(v.ok).toBe(true);
    expect(v.breaches.map((b) => b.limit)).toContain("dailyLoss");
  });
});

describe("the expiry guard — genuinely important and almost never implemented", () => {
  const DAY = 86_400_000;
  const limits: RiskLimits = { daysBeforeExpiryToBlock: 2 };

  test("inside the window, the order is refused", () => {
    const now = Date.UTC(2026, 7, 20);
    const v = checkLimits(limits, base({ now, lastTradingDate: now + DAY }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("expiry");
  });

  test("outside the window it is fine", () => {
    const now = Date.UTC(2026, 7, 20);
    expect(checkLimits(limits, base({ now, lastTradingDate: now + 5 * DAY })).ok).toBe(true);
  });

  test("an instrument with no expiry is never blocked by it", () => {
    expect(checkLimits(limits, base({ lastTradingDate: undefined })).ok).toBe(true);
  });
});

describe("price deviation — the fat-finger guard", () => {
  const limits: RiskLimits = { maxPriceDeviationBps: 500 };

  test("a price 10% away from the reference is refused", () => {
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, limitPrice: d("5500.00") }, referencePrice: d("5000.00") }),
    );
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("priceDeviation");
  });

  test("a price 1% away is fine", () => {
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, limitPrice: d("5050.00") }, referencePrice: d("5000.00") }),
    );
    expect(v.ok).toBe(true);
  });

  test("it is symmetric — too low is as wrong as too high", () => {
    const v = checkLimits(
      limits,
      base({ intent: { ...base().intent, limitPrice: d("4500.00") }, referencePrice: d("5000.00") }),
    );
    expect(v.ok).toBe(false);
  });
});

describe("message rate limit, per rolling window", () => {
  const limits: RiskLimits = { messageRateLimit: { messages: 3, perSeconds: 10 } };

  test("the fourth message inside the window is refused", () => {
    const now = 100_000;
    const v = checkLimits(limits, base({ now, recentMessagesAt: [now - 1000, now - 2000, now - 3000] }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("messageRate");
  });

  test("messages older than the window do not count", () => {
    const now = 100_000;
    const v = checkLimits(limits, base({ now, recentMessagesAt: [now - 11_000, now - 12_000, now - 13_000] }));
    expect(v.ok).toBe(true);
  });
});

describe("liquidation-only mode", () => {
  test("refuses anything that increases a position", () => {
    const v = checkLimits({ liquidationOnly: true }, base({ positionQty: qty("5") }));
    expect(v.ok).toBe(false);
    expect(v.clampedBy).toBe("liquidationOnly");
  });

  test("allows the exit", () => {
    const v = checkLimits(
      { liquidationOnly: true },
      base({ intent: { ...base().intent, side: "sell" }, positionQty: qty("5") }),
    );
    expect(v.ok).toBe(true);
  });
});

describe("every breach is reported, and clampedBy is the binding one", () => {
  test("two limits fire at once", () => {
    const v = checkLimits(
      { maxOrderQty: qty("5"), rejectImmediateFill: true },
      base({ intent: { ...base().intent, qty: qty("50"), limitPrice: d("5000.25") } }),
    );
    expect(v.ok).toBe(false);
    expect(v.breaches.map((b) => b.limit).sort()).toEqual(["immediateFill", "orderQty"]);
    // The binding one is the first refusal in evaluation order, so a UI has one
    // sentence to show and an audit log still has both.
    expect(v.clampedBy).toBe("orderQty");
  });
});

describe("position sizing by risk (§2.1)", () => {
  const inputs = {
    equity: d("100000.00"),
    riskFraction: parseDecimal("0.0100", 4),
    entry: d("100.00"),
    stop: d("95.00"),
    multiplier: parseDecimal("1", 0),
    moneyExp: 2,
  };

  test("the plain calculation is what everyone writes", () => {
    const r = sizeByRisk(inputs);
    expect(r.riskAmount).toEqual(d("1000.00"));
    expect(r.size).toEqual(qty("200"));
    expect(r.clampedBy).toBe("risk");
  });

  test("THE COST BUFFER: without it a '1% risk' trade loses more than 1%", () => {
    // The two omissions real implementations make are the cost buffer and the
    // margin feasibility clamp. This proves the first one is not cosmetic.
    const costs = { slippagePerUnit: d("0.10"), roundTurnCostPerUnit: d("0.02") };
    const buffered = sizeByRisk({ ...inputs, ...costs });
    const naive = sizeByRisk(inputs);

    // The real loss per unit if the stop is hit: 5.00 price + 0.12 costs.
    const realLossPerUnit = 5.12;
    const naiveLoss = Number(naive.size.v) * realLossPerUnit;
    const bufferedLoss = Number(buffered.size.v) * realLossPerUnit;

    expect(naiveLoss).toBeGreaterThan(1000); // busts the stated 1% budget
    expect(bufferedLoss).toBeLessThanOrEqual(1000); // stays inside it
    expect(buffered.size.v).toBeLessThan(naive.size.v);
    expect(buffered.riskPerUnit).toEqual(d("5.12"));
  });

  test("THE MARGIN CLAMP: a size you cannot fund is not a size", () => {
    const r = sizeByRisk({
      ...inputs,
      initialMarginPerUnit: d("50.00"),
      buyingPower: d("5000.00"),
    });
    expect(r.size).toEqual(qty("100"));
    expect(r.clampedBy).toBe("buyingPower");
    expect(r.marginRequired).toEqual(d("5000.00"));
  });

  test("a position limit clamps too, and says so", () => {
    const r = sizeByRisk({ ...inputs, maxPositionQty: qty("50") });
    expect(r.size).toEqual(qty("50"));
    expect(r.clampedBy).toBe("positionLimit");
  });

  test("clampedBy is what makes the answer honest — it is never omitted", () => {
    // Whichever constraint won, the caller is told. A bare number cannot be
    // distinguished from "we ran out of buying power and quietly halved it".
    for (const extra of [
      {},
      { maxPositionQty: qty("50") },
      { initialMarginPerUnit: d("50.00"), buyingPower: d("5000.00") },
    ]) {
      expect(sizeByRisk({ ...inputs, ...extra }).clampedBy).not.toBeNull();
    }
  });

  test("R multiple is measured against the FULL risk per unit, costs included", () => {
    const r = sizeByRisk({
      ...inputs,
      slippagePerUnit: d("0.10"),
      roundTurnCostPerUnit: d("0.02"),
      target: d("110.24"),
    });
    // (110.24 - 100.00) / 5.12 = 2.00
    expect(r.rMultipleToTarget).toEqual(parseDecimal("2.00", 2));
  });

  test("with no target there is no R multiple, rather than a zero pretending to be one", () => {
    expect(sizeByRisk(inputs).rMultipleToTarget).toBeNull();
  });

  test("a stop on the wrong side of the entry is refused, not silently absolute", () => {
    // |entry - stop| hides a real mistake: a long with a stop ABOVE the entry
    // is not a small position, it is a different trade.
    expect(() => sizeByRisk({ ...inputs, stop: d("105.00"), side: "buy" })).toThrow(
      /stop/i,
    );
  });

  test("a zero-distance stop does not divide by zero", () => {
    expect(() => sizeByRisk({ ...inputs, stop: d("100.00") })).toThrow(/stop/i);
  });

  test("size rounds DOWN to the lot, never up", () => {
    const r = sizeByRisk({ ...inputs, entry: d("100.00"), stop: d("97.00"), lotSize: qty("100") });
    // 1000 / 3 = 333.33 units -> 3 lots of 100 = 300.
    expect(r.size).toEqual(qty("300"));
  });
});
