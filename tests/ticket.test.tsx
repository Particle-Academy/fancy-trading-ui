/**
 * The order ticket, which is where the safety model is either real or is not.
 *
 * The asymmetry under test is §3.1's, and it is the sharpest decision in the
 * whole design:
 *
 * > A human's own one-click is a human decision and stays available. An
 * > agent-initiated order mutation ALWAYS requires human confirmation, and that
 * > requirement is structural rather than a setting.
 *
 * The tests that matter are the ones that **fail against a permissive
 * implementation** — an agent intent submitted with no approval must not
 * produce an order, and no combination of public options may make it.
 */
import { describe, expect, test, vi } from "vitest";
import { OrdStatus } from "@particle-academy/fancy-trading";
import { OrderTicket } from "../src/surfaces/ticket/OrderTicket.tsx";
import type { TicketInstrument, TicketValue } from "../src/surfaces/ticket/types.ts";
import { WarningRegistry } from "../src/safety/warnings.ts";
import { click, render, type } from "./render.tsx";

const ES: TicketInstrument = {
  id: "ESU6",
  symbol: "ESU6",
  displaySymbol: "ES Sep 26",
  priceExp: 2,
  qtyExp: 0,
  priceDisplay: { kind: "decimal", places: 2 },
  tickSize: "0.25",
  multiplier: "50",
  contractType: "linear",
  currency: "$",
};

const VALUE: TicketValue = {
  symbol: "ESU6",
  side: "buy",
  qty: "2",
  type: "limit",
  limitPrice: "5000.00",
  tif: "day",
};

const ticket = (over: Record<string, unknown> = {}) => (
  <OrderTicket
    mode="sim"
    instrument={ES}
    value={VALUE}
    onChange={() => {}}
    onSubmit={() => {}}
    clientOrderId="c-1"
    {...over}
  />
);

describe("the value is controlled and JSON-friendly", () => {
  test("changing a field calls onChange with the whole next value", () => {
    const onChange = vi.fn();
    const h = render(ticket({ onChange }));
    type(h.find("[data-fancy-trading-ticket-qty] input"), "5");
    expect(onChange).toHaveBeenCalledWith({ ...VALUE, qty: "5" });
    h.unmount();
  });

  test("the value survives JSON.stringify — which a Decimal would not", () => {
    // This is why prices are strings on the boundary. `Decimal` carries a
    // bigint, and JSON.stringify throws on a bigint, so a Decimal-valued prop
    // cannot cross an MCP bridge at all.
    expect(() => JSON.stringify(VALUE)).not.toThrow();
    expect(JSON.parse(JSON.stringify(VALUE))).toEqual(VALUE);
  });

  test("the ticket renders no internal copy of the value — it is fully controlled", () => {
    const h = render(ticket());
    const qty = h.find("[data-fancy-trading-ticket-qty] input") as HTMLInputElement;
    expect(qty.value).toBe("2");
    // Typing without a wired onChange must not move the displayed value: the
    // parent owns it, and an agent reading the DOM must see the parent's state.
    type(qty, "9");
    expect((h.find("[data-fancy-trading-ticket-qty] input") as HTMLInputElement).value).toBe("2");
    h.unmount();
  });
});

describe("a human's own submit goes straight through", () => {
  test("onSubmit receives an intent with origin human and no approval needed", () => {
    const onSubmit = vi.fn();
    const h = render(ticket({ onSubmit }));
    click(h.find("[data-fancy-trading-ticket-submit]"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [intent, approval] = onSubmit.mock.calls[0]!;
    expect(intent.origin).toBe("human");
    expect(intent.clientOrderId).toBe("c-1");
    expect(intent.qty).toEqual({ v: 2n, exp: 0 });
    expect(intent.limitPrice).toEqual({ v: 500000n, exp: 2 });
    expect(approval).toBeUndefined();
    h.unmount();
  });

  test("named prices, never an overloaded auxPrice", () => {
    const onSubmit = vi.fn();
    const h = render(
      ticket({
        onSubmit,
        value: { ...VALUE, type: "stopLimit", triggerPrice: "4990.00", limitPrice: "4989.00" },
      }),
    );
    click(h.find("[data-fancy-trading-ticket-submit]"));
    const [intent] = onSubmit.mock.calls[0]!;
    expect(intent.triggerPrice).toEqual({ v: 499000n, exp: 2 });
    expect(intent.limitPrice).toEqual({ v: 498900n, exp: 2 });
    expect("auxPrice" in intent).toBe(false);
    h.unmount();
  });
});

describe("an agent proposes; a human confirms — and nothing relaxes it", () => {
  test("an agent submit does NOT place an order", () => {
    const onSubmit = vi.fn();
    const h = render(ticket({ onSubmit, origin: "agent" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(onSubmit).not.toHaveBeenCalled();
    h.unmount();
  });

  test("it stages a proposal a human can see in full", () => {
    const h = render(ticket({ origin: "agent" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    const body = h.container.ownerDocument.body;
    expect(body.querySelector("[data-fancy-trading-approval]")).not.toBeNull();
    // The human must be able to see exactly what they are approving.
    expect(body.textContent).toContain("ESU6");
    expect(body.textContent).toContain("5000.00");
    h.unmount();
  });

  test("only after a human confirms does the order go, and it carries the approval", () => {
    const onSubmit = vi.fn();
    const h = render(ticket({ onSubmit, origin: "agent", approver: "glenn" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    click(
      h.container.ownerDocument.body.querySelector("[data-fancy-trading-approval-accept]"),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [intent, approval] = onSubmit.mock.calls[0]!;
    expect(intent.origin).toBe("agent");
    expect(approval.approvedBy).toBe("glenn");
    expect(approval.clientOrderId).toBe("c-1");
    h.unmount();
  });

  test("rejecting the proposal places nothing", () => {
    const onSubmit = vi.fn();
    const h = render(ticket({ onSubmit, origin: "agent" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    click(
      h.container.ownerDocument.body.querySelector("[data-fancy-trading-approval-reject]"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    h.unmount();
  });

  test("NO prop relaxes it — the permissive escape hatches simply do not exist", () => {
    // The shape a regression would take: someone adds `pendingMode={false}` or
    // `requireApproval={false}` because a demo was annoying. These are spread
    // in untyped, exactly as a careless consumer would, and must do nothing.
    const onSubmit = vi.fn();
    const escapes = {
      pendingMode: false,
      requireApproval: false,
      confirm: false,
      autoSubmit: true,
      skipApproval: true,
      trusted: true,
    } as Record<string, unknown>;
    const h = render(ticket({ onSubmit, origin: "agent", ...escapes }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(onSubmit).not.toHaveBeenCalled();
    h.unmount();
  });

  test("an agent cannot claim to be human by writing it into the VALUE", () => {
    // §3.1: origin is set by the transport, not by the caller. TicketValue has
    // no origin field, so there is nowhere to write the claim — and a value
    // that carries one anyway is ignored.
    const onSubmit = vi.fn();
    const forged = { ...VALUE, origin: "human" } as TicketValue;
    const h = render(ticket({ onSubmit, origin: "agent", value: forged }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(onSubmit).not.toHaveBeenCalled();
    h.unmount();
  });

  test("the approval dialog shows the mode, un-styleably", () => {
    const h = render(ticket({ origin: "agent", mode: "live" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    const marker = h.container.ownerDocument.body.querySelector<HTMLElement>(
      "[data-fancy-trading-approval] [data-fancy-trading-mode]",
    );
    expect(marker?.dataset.fancyTradingMode).toBe("live");
    expect(marker?.style.getPropertyPriority("background-color")).toBe("important");
    h.unmount();
  });
});

describe("risk limits gate the submit and name what stopped it", () => {
  test("a breach disables submit and shows which limit fired", () => {
    const onSubmit = vi.fn();
    const h = render(
      ticket({ onSubmit, limits: { maxOrderQty: "1" }, value: { ...VALUE, qty: "2" } }),
    );
    const button = h.find("[data-fancy-trading-ticket-submit]") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(h.text().toLowerCase()).toContain("per-order limit");
    // The handle reaches the DOM — it was on a Callout, which drops it.
    expect(h.find("[data-fancy-trading-ticket-blocked]")).not.toBeNull();
    click(button);
    expect(onSubmit).not.toHaveBeenCalled();
    h.unmount();
  });

  test("with no limits configured, nothing is refused — we ship no policy", () => {
    const onSubmit = vi.fn();
    const h = render(ticket({ onSubmit, value: { ...VALUE, qty: "1000000" } }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  test("a continuous symbol is refused with no limits at all", () => {
    const onSubmit = vi.fn();
    const h = render(
      ticket({ onSubmit, instrument: { ...ES, isContinuous: true, resolvesToContract: "ESU6" } }),
    );
    expect((h.find("[data-fancy-trading-ticket-submit]") as HTMLButtonElement).disabled).toBe(true);
    expect(h.text()).toContain("ESU6");
    h.unmount();
  });
});

describe("warnings fire in place, and can be silenced only there", () => {
  test("an order that would fill immediately warns before it is sent", () => {
    const registry = new WarningRegistry();
    const h = render(
      ticket({
        warnings: registry,
        scope: "ticket:ESU6",
        limits: { rejectImmediateFill: false },
        market: { bestBid: "4999.75", bestAsk: "5000.00" },
      }),
    );
    expect(h.find("[data-fancy-trading-warning]")).not.toBeNull();
    h.unmount();
  });

  test("silencing it in this ticket leaves it armed in another", () => {
    const registry = new WarningRegistry();
    const h = render(
      ticket({
        warnings: registry,
        scope: "ticket:ESU6",
        market: { bestBid: "4999.75", bestAsk: "5000.00" },
      }),
    );
    click(h.find("[data-fancy-trading-warning-silence]"));
    expect(registry.shouldShow("trading.order-will-fill-immediately", "ticket:NQU6")).toBe(true);
    h.unmount();
  });
});

describe("the instrument's tick grid is actually used", () => {
  test("a price off the tick grid warns, and names the nearest valid one", () => {
    // ES trades in quarters. 5000.10 is not a price, and a venue will reject
    // it. Before this, `tickSize` was declared on the instrument and read by
    // nothing — the suite's most common defect shape, and invisible because a
    // field that is never read never misbehaves.
    const h = render(ticket({ value: { ...VALUE, limitPrice: "5000.10" } }));
    const warning = h.find("[data-fancy-trading-warning='trading.price-off-tick']");
    expect(warning).not.toBeNull();
    // NEAREST, not next-up: 5000.10 is 0.10 from 5000.00 and 0.15 from 5000.25.
    expect(warning!.textContent).toContain("5000.00");
    h.unmount();
  });

  test("a price ON the grid does not warn", () => {
    const h = render(ticket({ value: { ...VALUE, limitPrice: "5000.25" } }));
    expect(h.find("[data-fancy-trading-warning='trading.price-off-tick']")).toBeNull();
    h.unmount();
  });

  test("it warns rather than snapping — the trader's number is not edited under them", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const h = render(ticket({ onChange, onSubmit, value: { ...VALUE, limitPrice: "5000.10" } }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit.mock.calls[0]![0].limitPrice).toEqual({ v: 500010n, exp: 2 });
    h.unmount();
  });

  test("a RANGED tick structure works too — Kalshi's price_ranges", () => {
    // §2.8: "tickSize must be a function of price, not a scalar." Below 20c the
    // grid is 1c; above it, 5c. A scalar cannot express that, and an event
    // market whose ladder assumes one is wrong across half its range.
    const kalshi: TicketInstrument = {
      ...ES,
      symbol: "PRES-26",
      priceDisplay: { kind: "decimal", places: 2 },
      tickSize: (price: string) => (Number(price) < 0.2 ? "0.01" : "0.05"),
    };
    const h = render(
      ticket({
        instrument: kalshi,
        value: { ...VALUE, symbol: "PRES-26", limitPrice: "0.63" },
      }),
    );
    const warning = h.find("[data-fancy-trading-warning='trading.price-off-tick']");
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("0.65");
    h.unmount();
  });

  test("and the same instrument is happy at a price the OTHER range allows", () => {
    const kalshi: TicketInstrument = {
      ...ES,
      symbol: "PRES-26",
      priceDisplay: { kind: "decimal", places: 2 },
      tickSize: (price: string) => (Number(price) < 0.2 ? "0.01" : "0.05"),
    };
    const h = render(
      ticket({
        instrument: kalshi,
        value: { ...VALUE, symbol: "PRES-26", limitPrice: "0.13" },
      }),
    );
    expect(h.find("[data-fancy-trading-warning='trading.price-off-tick']")).toBeNull();
    h.unmount();
  });
});

describe("degraded state stops the ticket, and says why", () => {
  test("submit is disabled while private state is stale", () => {
    const h = render(
      ticket({ liveness: { state: "stale", reason: "order stream closed" } }),
    );
    expect((h.find("[data-fancy-trading-ticket-submit]") as HTMLButtonElement).disabled).toBe(true);
    expect(h.text()).toContain("order stream closed");
    h.unmount();
  });
});

describe("the estimate is continuous, not behind a button", () => {
  test("it is recomputed as the quantity is typed", () => {
    // IBKR's margin preview is opt-in; Hyperliquid recomputes liquidation price
    // on every keystroke. For the number that decides whether a position
    // survives, continuous wins (§12.4).
    const estimate = vi.fn(() => ({ liquidationPrice: "4800.00", marginMode: "cross" as const }));
    let value = VALUE;
    const h = render(ticket({ estimate, value }));
    expect(estimate).toHaveBeenCalled();

    const before = estimate.mock.calls.length;
    value = { ...VALUE, qty: "7" };
    h.rerender(ticket({ estimate, value }));
    expect(estimate.mock.calls.length).toBeGreaterThan(before);
    expect(h.text()).toContain("4800.00");
    h.unmount();
  });

  test("a cross-margin liquidation price SAYS it is cross", () => {
    // Under isolated it is a property of the position; under cross it is a
    // property of the account and moves when anything else moves. Rendering it
    // without saying so is misleading (§2.8).
    const h = render(
      ticket({ estimate: () => ({ liquidationPrice: "4800.00", marginMode: "cross" as const }) }),
    );
    expect(h.text().toLowerCase()).toContain("cross");
    h.unmount();
  });

  test("Look Ahead sits BESIDE the current values, not behind a projection screen", () => {
    const h = render(
      ticket({
        estimate: () => ({
          buyingPowerAfter: "48000.00",
          lookAhead: { availableFunds: "31000.00", excessLiquidity: "29000.00" },
        }),
      }),
    );
    const row = h.find("[data-fancy-trading-ticket-lookahead]");
    expect(row).not.toBeNull();
    expect(h.text()).toContain("31000.00");
    h.unmount();
  });
});

describe("the ticket emits activity for every mutation", () => {
  test("submitting broadcasts, with the actor that did it", () => {
    const emitter = vi.fn();
    const h = render(ticket({ activity: emitter }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    expect(emitter).toHaveBeenCalled();
    const event = emitter.mock.calls.at(-1)![0];
    expect(event.action).toBe("trading_order_submit");
    expect(event.target.kind).toBe("trading");
    expect(event.meta.surface).toBe("ticket");
    h.unmount();
  });

  test("an agent proposal broadcasts as an agent, not as the human", () => {
    const emitter = vi.fn();
    const h = render(ticket({ activity: emitter, origin: "agent" }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    const event = emitter.mock.calls.at(-1)![0];
    expect(event.action).toBe("trading_order_propose");
    expect(event.source).toBe("agent");
    h.unmount();
  });
});

describe("bracket orders express all three venue models", () => {
  test("attached legs reach the intent unflattened", () => {
    const onSubmit = vi.fn();
    const attached = {
      takeProfit: { limitPrice: "5020.00" },
      stopLoss: { triggerPrice: "4980.00" },
      ocoEnforcedBy: "venue" as const,
      ocaType: 2 as const,
      twoPhase: true,
    };
    const h = render(ticket({ onSubmit, value: { ...VALUE, attached } }));
    click(h.find("[data-fancy-trading-ticket-submit]"));
    const [, , extra] = onSubmit.mock.calls[0]!;
    expect(extra.attached).toEqual(attached);
    h.unmount();
  });

  test("the ticket says WHO enforces the OCO, because a disconnect depends on it", () => {
    const h = render(
      ticket({
        value: {
          ...VALUE,
          attached: {
            takeProfit: { limitPrice: "5020.00" },
            stopLoss: { triggerPrice: "4980.00" },
            ocoEnforcedBy: "client" as const,
          },
        },
      }),
    );
    expect(h.text().toLowerCase()).toContain("this client");
    h.unmount();
  });
});

describe("the ticket never gives an opinion", () => {
  test("the order status vocabulary it renders is FIX's, not a verdict", () => {
    // A tripwire against the day someone adds a "confidence" or "signal" field:
    // the only statuses the ticket knows are the ones the venue reports.
    expect(Object.values(OrdStatus)).toContain("pendingNew");
  });
});
