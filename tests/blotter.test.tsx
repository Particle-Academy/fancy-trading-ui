/**
 * The blotter — three tables, not one — plus positions, watchlist and alerts.
 *
 * The tests that carry weight here are the ones about states most retail UIs
 * collapse:
 *
 * - An **untriggered stop is `accepted`, not `working`**. A trader who believes
 *   otherwise believes they are protected when they are not (§12.3).
 * - **`canceled` and `rejected` are different terminal states.** IBKR renders
 *   both red, which is honest about the protocol and ambiguous on screen.
 * - **A bust does not delete the original fill.** Fills are append-only; a
 *   silently deleted fill changes P&L history with nothing to say why.
 */
import { describe, expect, test, vi } from "vitest";
import {
  FillsTable,
  OrdersTable,
  PositionsTable,
  presentOrder,
  reconcileFills,
  roundTrips,
  type BlotterFill,
  type BlotterOrder,
  type BlotterPosition,
} from "../src/surfaces/blotter/Blotter.tsx";
import { WatchList } from "../src/surfaces/watchlist/WatchList.tsx";
import { Alerts, evaluateAlert, type Alert } from "../src/surfaces/alerts/Alerts.tsx";
import { click, render } from "./render.tsx";

const order = (over: Partial<BlotterOrder> = {}): BlotterOrder => ({
  clientOrderId: "c-1",
  symbol: "ESU6",
  side: "buy",
  type: "limit",
  qty: "2",
  cumQty: "0",
  leavesQty: "2",
  status: "new",
  tif: "day",
  receivedAt: 1,
  updatedAt: 1,
  ...over,
});

describe("an untriggered stop is ACCEPTED, not working", () => {
  test("the state and the label both say so", () => {
    const p = presentOrder(order({ type: "stop", triggerPrice: "4990.00", elected: false }));
    expect(p.state).toBe("accepted");
    expect(p.label).toContain("NOT working");
    expect(p.note).toContain("not protecting");
  });

  test("once elected it becomes a live order", () => {
    const p = presentOrder(order({ type: "stop", triggerPrice: "4990.00", elected: true }));
    expect(p.state).toBe("elected");
  });

  test("a plain limit at the venue is simply working", () => {
    expect(presentOrder(order({ heldBy: "venue" })).state).toBe("working");
  });

  test("an order the BROKER simulates locally is accepted, and says where it lives", () => {
    // IBKR's PreSubmitted is the tell that it simulates many order types
    // locally, so an IBKR stop is often not resting at the exchange at all.
    const p = presentOrder(order({ heldBy: "broker" }));
    expect(p.state).toBe("accepted");
    expect(p.note).toContain("broker");
    expect(p.note).toContain("unreachable");
  });

  test("the distinction reaches the DOM, so CSS and agents can both see it", () => {
    const h = render(
      <OrdersTable mode="sim" orders={[order({ type: "stop", elected: false })]} />,
    );
    expect(h.find("[data-fancy-trading-order='c-1']")!.dataset.state).toBe("accepted");
    h.unmount();
  });
});

describe("cancelled and rejected never merge", () => {
  test("they are different states with different words", () => {
    const cancelled = presentOrder(order({ status: "canceled" }));
    const rejected = presentOrder(order({ status: "rejected", reason: "insufficient margin" }));
    expect(cancelled.state).not.toBe(rejected.state);
    expect(rejected.note).toContain("insufficient margin");
  });

  test("a cancel REQUEST warns that a fill can still arrive", () => {
    // TWS: "You may still receive an execution while your cancellation request
    // is pending." That sentence is the whole reason the state exists.
    const p = presentOrder(order({ status: "pendingCancel" }));
    expect(p.state).toBe("cancelRequested");
    expect(p.note).toContain("still receive an execution");
  });

  test("a replace REQUEST says the order is still at its original price", () => {
    const p = presentOrder(order({ status: "pendingReplace" }));
    expect(p.note).toContain("ORIGINAL");
    expect(p.note.toLowerCase()).toContain("fill would win");
  });

  test("doneForDay is not terminal, and the note says why", () => {
    const p = presentOrder(order({ status: "doneForDay" }));
    expect(p.note).toContain("GTC");
  });
});

describe("fills are append-only", () => {
  const fills: BlotterFill[] = [
    { id: "f1", clientOrderId: "c-1", symbol: "ESU6", side: "buy", qty: "2", price: "5000.00", at: 10, execType: "trade" },
    { id: "f2", clientOrderId: "c-1", symbol: "ESU6", side: "buy", qty: "1", price: "5001.00", at: 20, execType: "trade" },
    { id: "f3", clientOrderId: "c-1", symbol: "ESU6", side: "buy", qty: "1", price: "5001.00", at: 30, execType: "tradeCancel", correctsFillId: "f2" },
  ];

  test("a bust marks the original rather than removing it", () => {
    const rows = reconcileFills(fills);
    expect(rows.map((r) => r.id)).toEqual(["f1", "f2", "f3"]);
    expect(rows.find((r) => r.id === "f2")!.busted).toBe(true);
    expect(rows.find((r) => r.id === "f2")!.effective).toBe(false);
  });

  test("the bust record itself does not count as a trade", () => {
    expect(reconcileFills(fills).find((r) => r.id === "f3")!.effective).toBe(false);
  });

  test("both rows stay on screen, and the busted one is struck through", () => {
    const h = render(<FillsTable mode="sim" fills={fills} />);
    expect(h.all("[data-fancy-trading-fill]").length).toBe(3);
    expect(h.find("[data-fancy-trading-fill='f2']")!.className).toContain("line-through");
    expect(h.find("[data-fancy-trading-fill='f2']")!.dataset.busted).toBe("true");
    h.unmount();
  });

  test("a correction supersedes the original, which also stays", () => {
    const corrected: BlotterFill[] = [
      fills[0]!,
      { id: "f9", clientOrderId: "c-1", symbol: "ESU6", side: "buy", qty: "2", price: "5000.50", at: 40, execType: "tradeCorrect", correctsFillId: "f1" },
    ];
    const rows = reconcileFills(corrected);
    expect(rows.find((r) => r.id === "f1")!.corrected).toBe(true);
    expect(rows.find((r) => r.id === "f1")!.effective).toBe(false);
    expect(rows.find((r) => r.id === "f9")!.effective).toBe(true);
  });
});

describe("round trips are grouped flat-to-flat, with the domain's own P&L", () => {
  test("two in, one out closing everything is one round trip", () => {
    const fills: BlotterFill[] = [
      { id: "a", clientOrderId: "c1", symbol: "AAPL", side: "buy", qty: "100", price: "100.00", at: 1, execType: "trade" },
      { id: "b", clientOrderId: "c2", symbol: "AAPL", side: "buy", qty: "100", price: "110.00", at: 2, execType: "trade" },
      { id: "c", clientOrderId: "c3", symbol: "AAPL", side: "sell", qty: "200", price: "120.00", at: 3, execType: "trade" },
    ];
    const trips = roundTrips(fills, { basis: "fifo" });
    expect(trips.length).toBe(1);
    // 100 @ +20 and 100 @ +10 = 3000, whichever basis you use once flat.
    expect(trips[0]!.realised).toBe("3000.00");
    expect(trips[0]!.fillIds).toEqual(["a", "b", "c"]);
  });

  test("a busted fill does not contribute to a round trip", () => {
    const fills: BlotterFill[] = [
      { id: "a", clientOrderId: "c1", symbol: "AAPL", side: "buy", qty: "100", price: "100.00", at: 1, execType: "trade" },
      { id: "b", clientOrderId: "c2", symbol: "AAPL", side: "buy", qty: "100", price: "110.00", at: 2, execType: "trade" },
      { id: "x", clientOrderId: "c2", symbol: "AAPL", side: "buy", qty: "100", price: "110.00", at: 2, execType: "tradeCancel", correctsFillId: "b" },
      { id: "c", clientOrderId: "c3", symbol: "AAPL", side: "sell", qty: "100", price: "120.00", at: 3, execType: "trade" },
    ];
    const trips = roundTrips(fills, { basis: "fifo" });
    expect(trips.length).toBe(1);
    expect(trips[0]!.realised).toBe("2000.00");
  });

  test("an open position produces no round trip yet", () => {
    const fills: BlotterFill[] = [
      { id: "a", clientOrderId: "c1", symbol: "AAPL", side: "buy", qty: "100", price: "100.00", at: 1, execType: "trade" },
    ];
    expect(roundTrips(fills)).toEqual([]);
  });
});

describe("aggregate destructive actions get their OWN confirmation", () => {
  test("Cancel All asks before it acts", () => {
    const onCancelAll = vi.fn();
    const h = render(
      <OrdersTable mode="sim" orders={[order()]} onCancelAll={onCancelAll} />,
    );
    click(h.find("[data-fancy-trading-cancel-all]"));
    expect(onCancelAll).not.toHaveBeenCalled();

    const body = h.container.ownerDocument.body;
    expect(body.querySelector("[data-fancy-trading-confirm='cancel-all']")).not.toBeNull();
    click(body.querySelector("[data-fancy-trading-confirm-accept]"));
    expect(onCancelAll).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test("the dialog states the specific impact", () => {
    const h = render(
      <OrdersTable mode="sim" orders={[order(), order({ clientOrderId: "c-2", symbol: "NQU6" })]} onCancelAll={() => {}} />,
    );
    click(h.find("[data-fancy-trading-cancel-all]"));
    const text = h.container.ownerDocument.body.textContent ?? "";
    expect(text).toContain("2 working order");
    expect(text).toContain("2 symbol");
    h.unmount();
  });

  test("turning OFF the Cancel All confirmation leaves Flatten confirming", () => {
    const onCancelAll = vi.fn();
    const onFlatten = vi.fn();
    const settings = { "cancel-all": false };

    const orders = render(
      <OrdersTable mode="sim" orders={[order()]} onCancelAll={onCancelAll} confirmations={settings} />,
    );
    click(orders.find("[data-fancy-trading-cancel-all]"));
    expect(onCancelAll).toHaveBeenCalledTimes(1);
    orders.unmount();

    const positions = render(
      <PositionsTable
        mode="sim"
        positions={[{ symbol: "ESU6", qty: "3" }]}
        onFlatten={onFlatten}
        confirmations={settings}
      />,
    );
    click(positions.find("[data-fancy-trading-flatten]"));
    expect(onFlatten).not.toHaveBeenCalled();
    positions.unmount();
  });

  test("a stale blotter cannot cancel anything at all", () => {
    const h = render(
      <OrdersTable
        mode="sim"
        orders={[order()]}
        onCancelAll={() => {}}
        liveness={{ state: "stale", reason: "order stream closed" }}
      />,
    );
    expect((h.find("[data-fancy-trading-cancel-all]") as HTMLButtonElement).disabled).toBe(true);
    h.unmount();
  });
});

describe("positions carry the facts that make a number readable", () => {
  const position = (over: Partial<BlotterPosition> = {}): BlotterPosition => ({
    symbol: "BTC-PERP",
    qty: "3",
    avgPrice: "60000.00",
    markPrice: "61000.00",
    unrealised: "3000.00",
    ...over,
  });

  test("a CALCULATED average is labelled differently from a broker-provided one", () => {
    const h = render(
      <PositionsTable mode="sim" positions={[position({ avgPriceSource: "calculated" })]} />,
    );
    const cell = h.find("[data-avg-price-source='calculated']")!;
    expect(cell.textContent).toContain("calc");
    expect(cell.getAttribute("title")).toContain("may differ");
    h.unmount();
  });

  test("a cross-margin liquidation price says it is an ACCOUNT property", () => {
    const h = render(
      <PositionsTable
        mode="sim"
        positions={[position({ marginMode: "cross", liquidationPrice: "48000.00" })]}
      />,
    );
    expect(h.find("[data-fancy-trading-margin-mode='cross']")!.getAttribute("title")).toContain(
      "ACCOUNT",
    );
    h.unmount();
  });

  test("the margin cushion is a badge with WORDS, never colour alone", () => {
    const h = render(
      <PositionsTable mode="sim" positions={[position({ marginCushion: "liquidationImminent" })]} />,
    );
    const badge = h.find("[data-fancy-trading-cushion='liquidationImminent']")!;
    expect(badge.textContent).toContain("liquidation imminent");
    h.unmount();
  });

  test("and the honest caveat is printed — a warning is not a guarantee of one", () => {
    const h = render(
      <PositionsTable mode="sim" positions={[position({ marginCushion: "warning" })]} />,
    );
    expect(h.text()).toContain("without a warning");
    h.unmount();
  });

  test("Look Ahead sits BESIDE the present, as a column", () => {
    const h = render(
      <PositionsTable
        mode="sim"
        positions={[position({ lookAhead: { availableFunds: "31000.00", excessLiquidity: "29000.00" } })]}
      />,
    );
    const cell = h.find("[data-fancy-trading-lookahead='BTC-PERP']")!;
    expect(cell.textContent).toContain("31000.00");
    expect(cell.getAttribute("title")).toContain("16:01");
    h.unmount();
  });

  test("futures open trade equity is a separate number from realised P&L", () => {
    const h = render(
      <PositionsTable mode="sim" positions={[position({ openTradeEquity: "1250.00", realised: "800.00" })]} />,
    );
    const ote = h.find("[data-fancy-trading-open-trade-equity]")!;
    expect(ote.textContent).toContain("1250.00");
    expect(ote.getAttribute("title")).toContain("settlement price");
    h.unmount();
  });
});

describe("the watchlist is a list, not a screener", () => {
  test("rows are controlled and addressable", () => {
    const onSelect = vi.fn();
    const h = render(
      <WatchList
        mode="sim"
        rows={[{ symbol: "AAPL", last: "190.00", change: "-1.20" }]}
        onSelect={onSelect}
      />,
    );
    click(h.find("[data-fancy-trading-watch-row='AAPL']"));
    expect(onSelect).toHaveBeenCalledWith("AAPL");
    h.unmount();
  });

  test("a negative change carries a glyph as well as a colour", () => {
    const h = render(
      <WatchList mode="sim" rows={[{ symbol: "AAPL", last: "190.00", change: "-1.20" }]} />,
    );
    expect(h.find("[data-fancy-trading-watch-row='AAPL']")!.textContent).toContain("▼");
    h.unmount();
  });

  test("a per-row limitation is named on the row", () => {
    const h = render(
      <WatchList
        mode="sim"
        rows={[
          {
            symbol: "AAPL",
            limitation: {
              reason: "delayed-feed",
              withheld: "Real-time price",
              detail: "this symbol is on a delayed feed.",
            },
          },
        ]}
      />,
    );
    expect(h.find("[data-fancy-trading-watch-limited='AAPL']")!.textContent).toContain("withheld");
    h.unmount();
  });
});

describe("alerts are conditions the user wrote", () => {
  const alert = (over: Partial<Alert> = {}): Alert => ({
    id: "a1",
    symbol: "AAPL",
    field: "last",
    op: "above",
    value: "200.00",
    enabled: true,
    ...over,
  });

  test("above and below are plain comparisons", () => {
    expect(evaluateAlert(alert(), { current: "201.00" })).toBe(true);
    expect(evaluateAlert(alert(), { current: "199.00" })).toBe(false);
    expect(evaluateAlert(alert({ op: "below" }), { current: "199.00" })).toBe(true);
  });

  test("a crossing needs a previous observation, and does not invent one", () => {
    // Treating a first observation as a crossing fires every alert the moment
    // the app connects.
    expect(evaluateAlert(alert({ op: "crossesUp" }), { current: "201.00" })).toBe(false);
    expect(evaluateAlert(alert({ op: "crossesUp" }), { current: "201.00", previous: "199.00" })).toBe(true);
    expect(evaluateAlert(alert({ op: "crossesUp" }), { current: "201.00", previous: "200.50" })).toBe(false);
  });

  test("a disabled alert never fires", () => {
    expect(evaluateAlert(alert({ enabled: false }), { current: "500.00" })).toBe(false);
  });

  test("adding one goes through onChange, with the user's own value", () => {
    const onChange = vi.fn();
    const h = render(
      <Alerts mode="sim" alerts={[]} onChange={onChange} makeId={() => "fixed"} symbols={["AAPL"]} />,
    );
    const input = h.find("[data-fancy-trading-alert-value] input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "250.00");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click(h.find("[data-fancy-trading-alert-add]"));

    expect(onChange).toHaveBeenCalledWith([
      { id: "fixed", symbol: "AAPL", field: "last", op: "above", value: "250.00", enabled: true },
    ]);
    h.unmount();
  });

  test("the surface says plainly that it is not a recommendation", () => {
    const h = render(<Alerts mode="sim" alerts={[alert()]} onChange={() => {}} />);
    expect(h.text()).toContain("not a recommendation");
    h.unmount();
  });
});
