/**
 * §2.6 — the reconciliation break, and the order whose fate is unknown.
 *
 * These are the two parts of §2.6 that are genuinely UI work rather than
 * connector work. The venue session owns the socket and the resync; what this
 * package owes is that a disagreement is **loud** and that an order nobody can
 * account for reaches a human.
 *
 * > **Recompute positions from fills and compare against the venue's. If they
 * > disagree, the venue wins and we raise a loud reconciliation break.** Silent
 * > divergence is how someone discovers at 3pm they have been trading a
 * > phantom.
 *
 * > An order we sent that the venue does not report, and which was `pendingNew`,
 * > has a **genuinely unknown** fate — it may have been rejected, or accepted
 * > with the ack lost. **This case needs a human**; it is surfaced, never
 * > guessed.
 *
 * The safety consequence is the one worth pinning: a position in dispute is not
 * a position you may trade off. A break turns one-click off even when the feed
 * is perfectly live, because staleness and wrongness are different problems and
 * only one of them is about the socket.
 */
import { describe, expect, test } from "vitest";
import {
  LIVE,
  describeBreak,
  findUnknownFate,
  reconcileOrder,
  reconcilePositions,
  reconciliationVerdict,
  surfaceCapabilities,
  surfaceSnapshot,
  type BlotterFill,
  type BlotterOrder,
  type ReconciliationBreak,
} from "../src/index.ts";
import { SurfaceChrome } from "../src/chrome/SurfaceChrome.tsx";
import { render } from "./render.tsx";

const fill = (over: Partial<BlotterFill> = {}): BlotterFill => ({
  id: "f1",
  clientOrderId: "c1",
  symbol: "AAPL",
  side: "buy",
  qty: "100",
  price: "100.00",
  at: 1,
  execType: "trade",
  ...over,
});

const order = (over: Partial<BlotterOrder> = {}): BlotterOrder => ({
  clientOrderId: "c1",
  symbol: "AAPL",
  side: "buy",
  type: "limit",
  qty: "100",
  cumQty: "0",
  leavesQty: "100",
  status: "new",
  tif: "day",
  receivedAt: 1,
  updatedAt: 1,
  ...over,
});

describe("positions are recomputed from fills and compared with the venue", () => {
  test("agreement produces no break", () => {
    const breaks = reconcilePositions(
      [fill(), fill({ id: "f2", side: "sell", qty: "40" })],
      [{ symbol: "AAPL", qty: "60" }],
      { at: 5 },
    );
    expect(breaks).toEqual([]);
  });

  test("a disagreement is a break, and reports BOTH numbers and the difference", () => {
    // A blotter that shows only its own number cannot be argued with. The
    // trader needs to see what the venue says, because the venue is right.
    const breaks = reconcilePositions([fill()], [{ symbol: "AAPL", qty: "90" }], { at: 5 });
    expect(breaks).toHaveLength(1);
    const b = breaks[0]!;
    expect(b.kind).toBe("position");
    if (b.kind !== "position") throw new Error("unreachable");
    expect(b.ours).toBe("100");
    expect(b.venue).toBe("90");
    expect(b.difference).toBe("10");
  });

  test("THE VENUE WINS, and the break says so rather than leaving it open", () => {
    const [b] = reconcilePositions([fill()], [{ symbol: "AAPL", qty: "90" }], { at: 5 });
    expect(describeBreak(b!).toLowerCase()).toContain("the venue is authoritative");
  });

  test("a position the venue reports and we have no fills for is ALSO a break", () => {
    // The dangerous direction: a position exists at the venue that this client
    // knows nothing about. Showing nothing is showing the trader they are flat.
    const breaks = reconcilePositions([], [{ symbol: "TSLA", qty: "-50" }], { at: 5 });
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.kind).toBe("position");
    expect(describeBreak(breaks[0]!)).toContain("TSLA");
  });

  test("a busted fill does not count toward our side of the comparison", () => {
    const breaks = reconcilePositions(
      [
        fill(),
        fill({ id: "f2", qty: "50" }),
        fill({ id: "f3", qty: "50", execType: "tradeCancel", correctsFillId: "f2" }),
      ],
      [{ symbol: "AAPL", qty: "100" }],
      { at: 5 },
    );
    expect(breaks).toEqual([]);
  });
});

describe("an order's cumulative state is compared with the venue's", () => {
  test("agreement produces no break", () => {
    expect(
      reconcileOrder(order({ cumQty: "40", leavesQty: "60" }), { cumQty: "40", leavesQty: "60" }),
    ).toBeNull();
  });

  test("a disagreement on cumulative quantity is a break", () => {
    const b = reconcileOrder(order({ cumQty: "40", leavesQty: "60" }), {
      cumQty: "70",
      leavesQty: "30",
    });
    expect(b).not.toBeNull();
    expect(b!.kind).toBe("order");
    if (b!.kind !== "order") throw new Error("unreachable");
    expect(b!.ourCumQty).toBe("40");
    expect(b!.venueCumQty).toBe("70");
  });

  test("leaves that do not add up to the order quantity is a break even when cumQty agrees", () => {
    // qty 100, cum 40 -> leaves must be 60. A venue reporting 50 means one of
    // the three numbers is wrong and we cannot tell which.
    const b = reconcileOrder(order({ cumQty: "40", leavesQty: "60" }), {
      cumQty: "40",
      leavesQty: "50",
    });
    expect(b).not.toBeNull();
  });
});

describe("an order the venue does not report NEEDS A HUMAN", () => {
  test("a pendingNew order missing from the venue's list is surfaced, not resolved", () => {
    const breaks = findUnknownFate([order({ status: "pendingNew" })], [], { at: 9 });
    expect(breaks).toHaveLength(1);
    const b = breaks[0]!;
    expect(b.kind).toBe("unknown-fate");
    expect(describeBreak(b).toLowerCase()).toContain("needs a human");
  });

  test("it is NOT guessed either way — neither cancelled nor working", () => {
    // The whole point: it may have been rejected, or accepted with the ack
    // lost. A client that picks one is wrong half the time, silently.
    const [b] = findUnknownFate([order({ status: "pendingNew" })], [], { at: 9 });
    const text = describeBreak(b!).toLowerCase();
    expect(text).toContain("may have been rejected");
    expect(text).toContain("accepted");
  });

  test("an order the venue DOES report is not an unknown fate", () => {
    expect(findUnknownFate([order({ status: "pendingNew" })], ["c1"], { at: 9 })).toEqual([]);
  });

  test("a WORKING order missing from the venue's list is not this case", () => {
    // §2.6 scopes this to pendingNew — the window between "sent" and
    // "acknowledged". A working order absent from a snapshot is an ordinary
    // reconciliation problem, and conflating them buries the one that matters.
    expect(findUnknownFate([order({ status: "new" })], [], { at: 9 })).toEqual([]);
  });

  test("the client order id is what identifies it, because nothing else exists yet", () => {
    const [b] = findUnknownFate([order({ status: "pendingNew" })], [], { at: 9 });
    if (b!.kind !== "unknown-fate") throw new Error("unreachable");
    expect(b!.clientOrderId).toBe("c1");
  });
});

describe("a break turns one-click off even when the feed is perfectly live", () => {
  const positionBreak: ReconciliationBreak = {
    kind: "position",
    symbol: "AAPL",
    ours: "100",
    venue: "90",
    difference: "10",
    at: 5,
  };

  test("no breaks, no refusal", () => {
    expect(reconciliationVerdict([]).allowed).toBe(true);
  });

  test("a break refuses, and names what disagrees", () => {
    // Staleness and wrongness are different problems and only one of them is
    // about the socket. A live feed reporting a position we dispute is the
    // more dangerous of the two, because nothing looks broken.
    const v = reconciliationVerdict([positionBreak]);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("AAPL");
  });

  test("the chrome shows it in the BODY and switches one-click off", () => {
    const h = render(
      <SurfaceChrome surface="positions" mode="live" liveness={LIVE} breaks={[positionBreak]}>
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("off");

    const notice = h.find("[data-fancy-trading-break]")!;
    expect(notice).not.toBeNull();
    expect(h.find("[data-fancy-trading-body]")!.contains(notice)).toBe(true);
    expect(h.find("[data-fancy-trading-chrome]")!.contains(notice)).toBe(false);
    h.unmount();
  });

  test("it is louder than a staleness notice — this is not a warning", () => {
    const h = render(
      <SurfaceChrome surface="positions" mode="live" breaks={[positionBreak]}>
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.reconciliation).toBe("break");
    expect(h.text()).toContain("90");
    expect(h.text()).toContain("100");
    h.unmount();
  });

  test("no breaks means no notice, so the marker means something", () => {
    const h = render(
      <SurfaceChrome surface="positions" mode="live">
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-break]")).toBeNull();
    expect(h.find("[data-fancy-trading-surface]")!.dataset.reconciliation).toBe("ok");
    h.unmount();
  });
});

describe("an agent is told the same thing, in the same words", () => {
  const positionBreak: ReconciliationBreak = {
    kind: "position",
    symbol: "AAPL",
    ours: "100",
    venue: "90",
    difference: "10",
    at: 5,
  };

  test("the snapshot is NOT actionable while a break stands", () => {
    // An agent that cannot tell a disputed position from an agreed one will
    // trade the disputed one.
    const s = surfaceSnapshot({
      surface: "positions",
      mode: "live",
      liveness: LIVE,
      breaks: [positionBreak],
      data: {},
      at: 1,
    });
    expect(s.actionable.allowed).toBe(false);
    expect(s.actionable.reason).toContain("AAPL");
  });

  test("the breaks travel with the snapshot as the SAME sentence a human reads", () => {
    const s = surfaceSnapshot({
      surface: "positions",
      mode: "live",
      liveness: LIVE,
      breaks: [positionBreak],
      data: {},
      at: 1,
    });
    expect(s.breaks).toEqual([describeBreak(positionBreak)]);
  });

  test("STALE STILL CARRIES THE DATA — freeze, do not clear", () => {
    // The half-a-job shape: greying a button while the bridge still answers
    // "here is your position" with no caveat. §2.6 step 1 says the opposite of
    // clearing — the orders ARE still working at the venue, and a blotter that
    // empties on disconnect shows a trader no position and no stop when both
    // exist. So the data stays, AND the snapshot says loudly that it may not be
    // true. Both halves, or neither is worth anything.
    const s = surfaceSnapshot({
      surface: "positions",
      mode: "live",
      liveness: { state: "stale", reason: "order stream closed" },
      data: { positions: [{ symbol: "ESU6", qty: "3" }] },
      at: 1,
    });

    // The frozen state is still there to read.
    expect(s.data.positions).toHaveLength(1);
    // And it is unmistakably marked.
    expect(s.actionable.allowed).toBe(false);
    expect(s.livenessSummary).toContain("STALE");
    expect(s.livenessSummary).toContain("Do not act on it");
    expect(s.actionable.reason).toContain("order stream closed");
  });

  test("every MUTATING capability goes unavailable while stale, with the reason", () => {
    // An agent enumerating what it can do must not be offered a proposal it
    // should not make. Reads stay available, because freezing state is not the
    // same as hiding it.
    const s = surfaceSnapshot({
      surface: "positions",
      mode: "live",
      liveness: { state: "stale", reason: "order stream closed" },
      data: {},
      at: 1,
    });
    const caps = surfaceCapabilities("positions", s);

    for (const cap of caps.filter((c) => c.requiresApproval)) {
      expect(cap.available, cap.name).toBe(false);
      expect(cap.unavailableReason, cap.name).toContain("stale");
    }
    for (const cap of caps.filter((c) => !c.requiresApproval)) {
      expect(cap.available, cap.name).toBe(true);
    }
  });

  test("a clean snapshot carries an empty list, not an absent field", () => {
    const s = surfaceSnapshot({ surface: "positions", mode: "live", liveness: LIVE, data: {}, at: 1 });
    expect(s.breaks).toEqual([]);
  });
});
