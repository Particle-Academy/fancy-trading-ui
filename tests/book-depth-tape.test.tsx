/**
 * The book, the depth curve and the tape.
 *
 * Two findings drive these tests:
 *
 * - **The depth chart is DERIVED, never separately sourced** (§2.3). Two views
 *   each maintaining their own book from one stream drift after a gap, and then
 *   two surfaces on screen disagree. So both take one `BookState`, and the
 *   depth curve is a pure function of it.
 * - **A tape that presents inferred aggressor sides as fact is lying to the
 *   trader.** The US equities SIP does not report the aggressor; futures and
 *   crypto venues do. The tape has to be able to say which it has.
 */
import { describe, expect, test } from "vitest";
import {
  DepthChart,
  OrderBook,
  cumulativeDepth,
  marketImpact,
  type BookState,
} from "../src/surfaces/book/OrderBook.tsx";
import {
  TimeAndSales,
  cumulativeDelta,
  type TapePrint,
} from "../src/surfaces/tape/TimeAndSales.tsx";
import type { TicketInstrument } from "../src/surfaces/ticket/types.ts";
import { render } from "./render.tsx";

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

const BOOK: BookState = {
  bids: [
    { price: "5000.00", size: "10" },
    { price: "4999.75", size: "20" },
    { price: "4999.50", size: "30" },
  ],
  asks: [
    { price: "5000.25", size: "15" },
    { price: "5000.50", size: "25" },
    { price: "5000.75", size: "35" },
  ],
  sync: "live",
  completeness: "consolidated",
};

const scales = { priceExp: 2, qtyExp: 0, moneyExp: 2 };

describe("the depth curve is a function of the book, not a second source", () => {
  test("cumulative size accumulates outward from the mid", () => {
    const bids = cumulativeDepth(BOOK, "bid", scales);
    expect(bids.map((p) => p.cumulative)).toEqual(["10", "30", "60"]);
  });

  test("and carries the cash it would cost, which is the actual question", () => {
    const asks = cumulativeDepth(BOOK, "ask", scales);
    // 15 * 5000.25 = 75003.75
    expect(asks[0]!.notional).toBe("75003.75");
    // + 25 * 5000.50 = 125012.50 -> 200016.25
    expect(asks[1]!.notional).toBe("200016.25");
  });

  test("both surfaces render the SAME numbers, because they share the state", () => {
    const book = render(<OrderBook mode="sim" instrument={ES} state={BOOK} />);
    const depth = render(<DepthChart mode="sim" instrument={ES} state={BOOK} />);

    const fromBook = book
      .all("[data-fancy-trading-book-side='ask'] [data-cumulative]")
      .map((el) => el.dataset.cumulative);
    const fromDepth = depth
      .all("[data-fancy-trading-depth-side='ask'] [data-cumulative]")
      .map((el) => el.dataset.cumulative);

    expect(fromBook).toEqual(["15", "40", "75"]);
    expect(fromDepth).toEqual(fromBook);

    book.unmount();
    depth.unmount();
  });
});

describe("market impact answers the question a depth chart is actually asked", () => {
  test("sweeping the asks fills across levels at a weighted price", () => {
    const r = marketImpact(BOOK, "buy", "30", scales);
    expect(r.fillableQty).toBe("30");
    expect(r.levelsConsumed).toBe(2);
    // 15 @ 5000.25 + 15 @ 5000.50 = 150011.25 -> 5000.375 -> 5000.38 at 2dp
    expect(r.averagePrice).toBe("5000.38");
    expect(r.exceedsVisibleBook).toBe(false);
  });

  test("asking for more than the book holds SAYS so rather than stopping quietly", () => {
    // A book is only as deep as what the feed sent. An answer that silently
    // stops at the last level it has is the same failure as a surface that
    // silently renders less.
    const r = marketImpact(BOOK, "buy", "1000", scales);
    expect(r.exceedsVisibleBook).toBe(true);
    expect(r.fillableQty).toBe("75");
  });

  test("an empty book fills nothing and returns no average price", () => {
    const r = marketImpact({ bids: [], asks: [], sync: "live" }, "buy", "10", scales);
    expect(r.fillableQty).toBe("0");
    expect(r.averagePrice).toBeNull();
    expect(r.exceedsVisibleBook).toBe(true);
  });
});

describe("the sync state is visible on both surfaces", () => {
  test("a resyncing book renders degraded and names the gap", () => {
    const state: BookState = { ...BOOK, sync: "resyncing", lastSequence: 41_097 };
    const h = render(<OrderBook mode="sim" instrument={ES} state={state} />);
    expect(h.find("[data-fancy-trading-surface]")!.dataset.liveness).toBe("resyncing");
    expect(h.text()).toContain("41097");
    h.unmount();
  });

  test("a buffering book is degraded too — it is not a book yet", () => {
    const h = render(<DepthChart mode="sim" instrument={ES} state={{ ...BOOK, sync: "buffering" }} />);
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("off");
    h.unmount();
  });
});

describe("a partial book says what it is missing, where it would have been", () => {
  test("an aggregated partial book is labelled as one", () => {
    const h = render(
      <OrderBook mode="sim" instrument={ES} state={{ ...BOOK, completeness: "aggregatedPartial" }} />,
    );
    const notice = h.find("[data-fancy-trading-withheld]")!;
    expect(notice.textContent).toContain("PARTIAL");
    expect(h.find("[data-fancy-trading-body]")!.contains(notice)).toBe(true);
    h.unmount();
  });

  test("a single-venue book names the venue", () => {
    const h = render(
      <OrderBook
        mode="sim"
        instrument={ES}
        state={{ ...BOOK, completeness: "singleVenue", venue: "CME" }}
      />,
    );
    expect(h.text()).toContain("CME");
    h.unmount();
  });

  test("a consolidated book adds no notice", () => {
    const h = render(<OrderBook mode="sim" instrument={ES} state={BOOK} />);
    expect(h.find("[data-fancy-trading-withheld]")).toBeNull();
    h.unmount();
  });

  test("an empty side says so IN PLACE of the levels", () => {
    const h = render(
      <OrderBook mode="sim" instrument={ES} state={{ ...BOOK, asks: [] }} />,
    );
    expect(h.text()).toContain("Asks is not shown");
    h.unmount();
  });
});

// ─── The tape ────────────────────────────────────────────────────────────────

const PRINTS: TapePrint[] = [
  { id: "t1", at: 1_700_000_000_000, price: "5000.25", size: "3", aggressor: "buy", aggressorSource: "venue", venue: "CME" },
  { id: "t2", at: 1_700_000_000_100, price: "5000.00", size: "5", aggressor: "sell", aggressorSource: "inferred", venue: "XNAS" },
  { id: "t3", at: 1_700_000_000_200, price: "5000.00", size: "2", aggressor: "unknown", aggressorSource: "inferred" },
];

describe("the tape never presents an inferred side as a fact", () => {
  test("an inferred print is marked in the DOM and in its tooltip", () => {
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    const inferred = h.find("[data-fancy-trading-tape-print='t2']")!;
    expect(inferred.dataset.aggressorSource).toBe("inferred");
    expect(inferred.textContent).toContain("(inferred)");
    h.unmount();
  });

  test("a venue-reported print is NOT marked, so the difference means something", () => {
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    const reported = h.find("[data-fancy-trading-tape-print='t1']")!;
    expect(reported.dataset.aggressorSource).toBe("venue");
    expect(reported.textContent).not.toContain("inferred");
    h.unmount();
  });

  test("unknown renders as unknown — it is not guessed into a side", () => {
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    const unknown = h.find("[data-fancy-trading-tape-print='t3']")!;
    expect(unknown.dataset.aggressor).toBe("unknown");
    expect(unknown.textContent).toContain("unknown");
    h.unmount();
  });

  test("the two are visually distinguished by more than colour", () => {
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    expect(h.find("[data-fancy-trading-tape-print='t2']")!.className).toContain("italic");
    h.unmount();
  });
});

describe("cumulative delta carries its own provenance", () => {
  test("unknown-aggressor prints do not contribute at all", () => {
    const d = cumulativeDelta(PRINTS, 0);
    expect(d.delta).toBe("-2"); // +3 buy, -5 sell, t3 ignored
    expect(d.prints).toBe(2);
  });

  test("it says how much of itself rests on inference", () => {
    // A delta of -2 from venue-reported sides and a delta of -2 from the tick
    // test are not the same number, and rendering them identically throws the
    // difference away.
    const d = cumulativeDelta(PRINTS, 0);
    expect(d.inferredPrints).toBe(1);
    expect(d.inferredVolume).toBe("5");
  });

  test("a fully reported tape says so, with no asterisk", () => {
    const clean = PRINTS.filter((p) => p.aggressorSource === "venue");
    const d = cumulativeDelta(clean, 0);
    expect(d.inferredPrints).toBe(0);
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={clean} />);
    expect(h.find("[data-fancy-trading-tape-inference-note]")).toBeNull();
    h.unmount();
  });

  test("a partly inferred tape prints the caveat under the table", () => {
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    const note = h.find("[data-fancy-trading-tape-inference-note]")!;
    expect(note.textContent).toContain("inferred");
    expect(note.textContent).toContain("SIP");
    h.unmount();
  });
});

describe("timestamps are fine enough for the asset class", () => {
  test("microseconds render when a venue provides them", () => {
    const micro: TapePrint[] = [
      { ...PRINTS[0]!, microseconds: 417 },
    ];
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={micro} />);
    expect(h.text()).toContain("417");
    h.unmount();
  });

  test("and are not invented when they are absent", () => {
    // The alternative -- padding every equities print with `000` -- claims a
    // precision the SIP does not provide.
    const h = render(<TimeAndSales mode="sim" instrument={ES} prints={PRINTS} />);
    expect(h.all("[data-fancy-trading-tape-micros]")).toEqual([]);
    h.unmount();
  });
});
