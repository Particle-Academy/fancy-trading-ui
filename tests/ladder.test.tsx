/**
 * The price ladder / DOM.
 *
 * Three findings from §2.2 are load-bearing here, and each has a test that
 * fails against the implementation everyone writes first:
 *
 * 1. **Column selects side; button selects order type.** The ladder does *not*
 *    derive buy/sell from whether you clicked above or below the market. And
 *    because the conventions genuinely differ between platforms, the click map
 *    is a CONFIGURATION OBJECT, not a hardcoded behaviour.
 * 2. **Drag-to-move is a cancel-replace**, which makes §2.5's race the normal
 *    path. Orders render at their CONFIRMED price with a pending overlay,
 *    never optimistically at the new one, and a second drag while one is in
 *    flight is refused.
 * 3. **A ladder on a continuous symbol is a category error** (§2.8).
 */
import { describe, expect, test, vi } from "vitest";
import {
  JOIN_THE_BOOK_CLICK_MAP,
  PriceLadder,
  SIERRA_CLICK_MAP,
  type LadderRow,
  type LadderWorkingOrder,
} from "../src/surfaces/ladder/PriceLadder.tsx";
import type { TicketInstrument } from "../src/surfaces/ticket/types.ts";
import { WarningRegistry } from "../src/safety/warnings.ts";
import { click, mouseDown, mouseUp, render, rightClick } from "./render.tsx";

const ES: TicketInstrument = {
  id: "ESU6",
  symbol: "ESU6",
  priceExp: 2,
  qtyExp: 0,
  priceDisplay: { kind: "decimal", places: 2 },
  tickSize: "0.25",
  multiplier: "50",
  contractType: "linear",
};

/** Best bid 5000.00, best ask 5000.25. */
const ROWS: LadderRow[] = [
  { price: "5000.75", askSize: "40" },
  { price: "5000.50", askSize: "25" },
  { price: "5000.25", askSize: "12" },
  { price: "5000.00", bidSize: "18" },
  { price: "4999.75", bidSize: "31" },
  { price: "4999.50", bidSize: "44" },
];

const ladder = (over: Record<string, unknown> = {}) => (
  <PriceLadder
    mode="sim"
    instrument={ES}
    rows={ROWS}
    orderQty="1"
    onIntent={() => {}}
    {...over}
  />
);

const row = (h: ReturnType<typeof render>, price: string, column: string) =>
  h.find(`[data-fancy-trading-ladder-row="${price}"] [data-column="${column}"]`);

describe("column selects side, button selects type", () => {
  test("left-clicking the BUY column places a buy limit", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent }));
    click(row(h, "4999.75", "buy"));
    expect(onIntent).toHaveBeenCalledWith({
      kind: "place",
      side: "buy",
      type: "limit",
      price: "4999.75",
      qty: "1",
    });
    h.unmount();
  });

  test("RIGHT-clicking the same cell places a buy STOP — the button chose it", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent }));
    rightClick(row(h, "5000.50", "buy"));
    expect(onIntent).toHaveBeenCalledWith({
      kind: "place",
      side: "buy",
      type: "stop",
      price: "5000.50",
      qty: "1",
    });
    h.unmount();
  });

  test("clicking the BUY column ABOVE the market is still a BUY", () => {
    // The naive implementation derives the side from which side of the market
    // the click landed on, and produces a SELL here. That is the single most
    // common ladder bug, and it places the opposite of what was asked for.
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent }));
    click(row(h, "5000.75", "buy"));
    expect(onIntent.mock.calls[0]![0].side).toBe("buy");
    h.unmount();
  });

  test("clicking the SELL column BELOW the market is still a SELL", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent }));
    click(row(h, "4999.50", "sell"));
    expect(onIntent.mock.calls[0]![0].side).toBe("sell");
    h.unmount();
  });
});

describe("the click map is configuration, not behaviour", () => {
  test("a different convention produces a different result from the same gesture", () => {
    // Some platforms have you click the BID column to join the bid. Both
    // conventions are real, so neither is hardcoded.
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, clickMap: JOIN_THE_BOOK_CLICK_MAP }));
    click(row(h, "4999.75", "bid"));
    expect(onIntent).toHaveBeenCalledWith(
      expect.objectContaining({ side: "buy", type: "limit", price: "4999.75" }),
    );
    h.unmount();
  });

  test("an UNMAPPED gesture does nothing — there is no hidden fallback", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, clickMap: { "buy:left": SIERRA_CLICK_MAP["buy:left"]! } }));
    rightClick(row(h, "4999.75", "buy"));
    expect(onIntent).not.toHaveBeenCalled();
    h.unmount();
  });

  test("an empty map makes the ladder read-only rather than guessing", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, clickMap: {} }));
    click(row(h, "4999.75", "buy"));
    click(row(h, "5000.50", "sell"));
    expect(onIntent).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("working orders render at their CONFIRMED price", () => {
  const working: LadderWorkingOrder[] = [
    {
      clientOrderId: "o-1",
      side: "buy",
      price: "4999.75",
      qty: "3",
      type: "limit",
      status: "new",
      pendingPrice: "4999.50",
      pendingStatus: "pendingReplace",
    },
  ];

  test("the marker is on the confirmed row, not the requested one", () => {
    // Rendering optimistically at the new price is a lie whenever the replace
    // is rejected -- and §2.5 says a replace can be rejected while the ORIGINAL
    // fills, because fills always win.
    const h = render(ladder({ orders: working }));
    const confirmed = h.find('[data-fancy-trading-ladder-row="4999.75"] [data-fancy-trading-ladder-order="o-1"]');
    const optimistic = h.find('[data-fancy-trading-ladder-row="4999.50"] [data-fancy-trading-ladder-order="o-1"]');
    expect(confirmed).not.toBeNull();
    expect(optimistic).toBeNull();
    h.unmount();
  });

  test("the requested price shows as a PENDING overlay that names itself", () => {
    const h = render(ladder({ orders: working }));
    const pending = h.find('[data-fancy-trading-ladder-pending="o-1"]');
    expect(pending).not.toBeNull();
    expect(pending!.textContent).toContain("4999.50");
    expect(h.text().toLowerCase()).toContain("not confirmed");
    h.unmount();
  });

  test("dragging emits a REPLACE, and says so — it is a cancel-replace", () => {
    const onIntent = vi.fn();
    const settled: LadderWorkingOrder[] = [
      { clientOrderId: "o-2", side: "buy", price: "4999.75", qty: "3", type: "limit", status: "new" },
    ];
    const h = render(ladder({ onIntent, orders: settled }));
    mouseDown(h.find('[data-fancy-trading-ladder-order="o-2"]'));
    mouseUp(h.find('[data-fancy-trading-ladder-row="4999.50"]'));
    expect(onIntent).toHaveBeenCalledWith({
      kind: "replace",
      clientOrderId: "o-2",
      price: "4999.50",
    });
    h.unmount();
  });

  test("a SECOND drag while one is in flight is refused", () => {
    // Serialise replaces per order (§2.5). Two in flight and the reports can
    // arrive out of order, which is how an order ends up at a price nobody
    // asked for.
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, orders: working }));
    mouseDown(h.find('[data-fancy-trading-ladder-order="o-1"]'));
    mouseUp(h.find('[data-fancy-trading-ladder-row="5000.50"]'));
    expect(onIntent).not.toHaveBeenCalled();
    h.unmount();
  });

  test("the refusal says why, rather than silently doing nothing", () => {
    const h = render(ladder({ orders: working }));
    mouseDown(h.find('[data-fancy-trading-ladder-order="o-1"]'));
    mouseUp(h.find('[data-fancy-trading-ladder-row="5000.50"]'));
    expect(h.text().toLowerCase()).toContain("already");
    expect(h.find("[data-fancy-trading-ladder-refusal]")).not.toBeNull();
    h.unmount();
  });
});

describe("the safety floor applies to every click", () => {
  test("stale state turns one-click off entirely", () => {
    const onIntent = vi.fn();
    const h = render(
      ladder({ onIntent, liveness: { state: "stale", reason: "book stream closed" } }),
    );
    click(row(h, "4999.75", "buy"));
    expect(onIntent).not.toHaveBeenCalled();
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("off");
    h.unmount();
  });

  test("a resyncing book is visibly degraded, not silently stale", () => {
    const h = render(ladder({ liveness: { state: "resyncing", reason: "sequence gap at 41097" } }));
    expect(h.text()).toContain("41097");
    h.unmount();
  });

  test("an order that would fill immediately is refused when the limit is set", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, limits: { rejectImmediateFill: true } }));
    click(row(h, "5000.25", "buy")); // at the ask
    expect(onIntent).not.toHaveBeenCalled();
    h.unmount();
  });

  test("and is allowed when it is not set — we ship no policy", () => {
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent }));
    click(row(h, "5000.25", "buy"));
    expect(onIntent).toHaveBeenCalled();
    h.unmount();
  });

  test("a continuous symbol refuses the whole ladder, and explains", () => {
    const onIntent = vi.fn();
    const h = render(
      ladder({
        onIntent,
        instrument: { ...ES, isContinuous: true, resolvesToContract: "ESU6" },
      }),
    );
    click(row(h, "4999.75", "buy"));
    expect(onIntent).not.toHaveBeenCalled();
    expect(h.text()).toContain("ESU6");
    h.unmount();
  });

  test("an agent click proposes rather than places", () => {
    const onIntent = vi.fn();
    const onPropose = vi.fn();
    const h = render(ladder({ onIntent, onPropose, origin: "agent" }));
    click(row(h, "4999.75", "buy"));
    expect(onIntent).not.toHaveBeenCalled();
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({ side: "buy", price: "4999.75" }),
    );
    h.unmount();
  });

  test("with no onPropose wired, an agent click does nothing at all", () => {
    // Failing open here would mean an agent's click placing an order because
    // the host forgot a prop.
    const onIntent = vi.fn();
    const h = render(ladder({ onIntent, origin: "agent" }));
    click(row(h, "4999.75", "buy"));
    expect(onIntent).not.toHaveBeenCalled();
    h.unmount();
  });
});

describe("stable handles and accessible encoding", () => {
  test("every row is addressable by price", () => {
    const h = render(ladder());
    for (const r of ROWS) {
      expect(h.find(`[data-fancy-trading-ladder-row="${r.price}"]`)).not.toBeNull();
    }
    h.unmount();
  });

  test("bid and ask cells are distinguished by more than colour", () => {
    // Red/green as the sole encoding of direction fails for deuteranopia,
    // roughly 1 in 12 men (§12.7). The ladder is where a mistake costs most.
    const h = render(ladder());
    const bid = row(h, "4999.75", "bid")!;
    const ask = row(h, "5000.25", "ask")!;
    expect(bid.getAttribute("aria-label")).toMatch(/bid/i);
    expect(ask.getAttribute("aria-label")).toMatch(/ask/i);
    h.unmount();
  });

  test("the position row is marked, and carries the average price", () => {
    const h = render(ladder({ position: { qty: "3", avgPrice: "5000.00" } }));
    const marker = h.find("[data-fancy-trading-ladder-position]");
    expect(marker).not.toBeNull();
    expect(
      (marker!.closest("[data-fancy-trading-ladder-row]") as HTMLElement).dataset
        .fancyTradingLadderRow,
    ).toBe("5000.00");
    h.unmount();
  });

  test("an average price the BROKER gave us is labelled differently from one we computed", () => {
    // Sierra's honest touch: average price is "service-provided or calculated",
    // and the two can disagree (§2.3).
    const h = render(
      ladder({ position: { qty: "3", avgPrice: "5000.00", avgPriceSource: "calculated" } }),
    );
    expect(h.find("[data-fancy-trading-ladder-position]")!.getAttribute("title")).toMatch(
      /calculated/i,
    );
    h.unmount();
  });
});

describe("the outcome-book model — Kalshi and Polymarket in one component", () => {
  const KALSHI: TicketInstrument = {
    id: "PRES-26",
    symbol: "PRES-26",
    priceExp: 2,
    qtyExp: 2,
    priceDisplay: { kind: "cents" },
    tickSize: "0.01",
    multiplier: "1",
    contractType: "linear",
    outcomeFrame: { model: "netted_complementary", sumsTo: "1.00", complementOf: "NO" },
  };

  const YES_ROWS: LadderRow[] = [
    { price: "0.66", askSize: "500" },
    { price: "0.65", bidSize: "900" },
    { price: "0.64", bidSize: "1200" },
  ];

  test("the NO frame mirrors the prices, because one book has two frames", () => {
    // Binary contracts sum to $1.00, so a NO bid at X IS a YES ask at 1.00 - X.
    // One book, two mirrored frames (§2.8).
    const h = render(
      ladder({ instrument: KALSHI, rows: YES_ROWS, frame: "NO", clickMap: SIERRA_CLICK_MAP }),
    );
    expect(h.find('[data-fancy-trading-ladder-row="0.34"]')).not.toBeNull();
    expect(h.find('[data-fancy-trading-ladder-row="0.35"]')).not.toBeNull();
    h.unmount();
  });

  test("bid and ask swap sides in the mirrored frame", () => {
    const h = render(ladder({ instrument: KALSHI, rows: YES_ROWS, frame: "NO" }));
    // The YES bid of 900 at 0.65 is a NO ask of 900 at 0.35.
    const cell = h.find('[data-fancy-trading-ladder-row="0.35"] [data-column="ask"]');
    expect(cell!.textContent).toContain("900");
    h.unmount();
  });

  test("a BUY in the NO frame emits a SELL at the complement, in the venue's frame", () => {
    // "Buy-yes and sell-no produce the same directional exposure." The intent
    // that leaves this component is always in the venue's own frame, so an
    // adapter never has to guess which one it is looking at.
    const onIntent = vi.fn();
    const h = render(
      ladder({ onIntent, instrument: KALSHI, rows: YES_ROWS, frame: "NO", orderQty: "10" }),
    );
    click(row(h, "0.35", "buy"));
    expect(onIntent).toHaveBeenCalledWith({
      kind: "place",
      side: "sell",
      type: "limit",
      price: "0.65",
      qty: "10",
    });
    h.unmount();
  });

  test("a venue with separate books per outcome is NOT mirrored", () => {
    // Polymarket's YES and NO are separate ERC-1155 tokens with separate order
    // books. Mirroring one into the other would invent liquidity that is not
    // there (§2.8).
    const POLY: TicketInstrument = {
      ...KALSHI,
      outcomeFrame: { model: "separate_per_outcome", sumsTo: "1.00" },
    };
    const h = render(ladder({ instrument: POLY, rows: YES_ROWS, frame: "NO" }));
    expect(h.find('[data-fancy-trading-ladder-row="0.65"]')).not.toBeNull();
    expect(h.find('[data-fancy-trading-ladder-row="0.35"]')).toBeNull();
    h.unmount();
  });
});

describe("the ladder broadcasts what it did", () => {
  test("a click emits activity naming the price level", () => {
    const emitter = vi.fn();
    const h = render(ladder({ activity: emitter }));
    click(row(h, "4999.75", "buy"));
    const event = emitter.mock.calls.at(-1)![0];
    expect(event.action).toBe("trading_ladder_click");
    expect(event.meta.price).toBe("4999.75");
    h.unmount();
  });
});

describe("warnings", () => {
  test("a drag warns that it is a cancel-replace, once, here", () => {
    const registry = new WarningRegistry();
    const settled: LadderWorkingOrder[] = [
      { clientOrderId: "o-3", side: "buy", price: "4999.75", qty: "3", type: "limit", status: "new" },
    ];
    const h = render(ladder({ orders: settled, warnings: registry, scope: "ladder:ESU6" }));
    mouseDown(h.find('[data-fancy-trading-ladder-order="o-3"]'));
    expect(h.find("[data-fancy-trading-warning]")).not.toBeNull();
    expect(registry.shouldShow("trading.drag-is-cancel-replace", "ladder:NQU6")).toBe(true);
    h.unmount();
  });
});
