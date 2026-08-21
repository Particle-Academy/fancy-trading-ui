/**
 * The agent-bridge contract.
 *
 * The rule under test is the one an agent's behaviour actually turns on:
 *
 * > **Stale state disables one-click, and an agent reading through the bridge
 * > is told the same thing, because an agent that cannot distinguish a stale
 * > blotter from a live one will act on the stale one.** (§3.2)
 *
 * "The same thing" is meant literally. The sentence a human reads and the
 * sentence an agent reads come from ONE function, so they cannot drift apart.
 */
import { describe, expect, test } from "vitest";
import {
  DISCONNECTED,
  LIVE,
  livenessSummary,
  proposeAction,
  resetProposalIds,
  surfaceCapabilities,
  surfaceSnapshot,
  type TradingSurfaceAdapter,
} from "../src/index.ts";

describe("every snapshot carries mode, liveness and limitations", () => {
  test("a live snapshot is actionable and says so", () => {
    const s = surfaceSnapshot({
      surface: "ladder",
      symbol: "ESU6",
      mode: "live",
      liveness: LIVE,
      data: { rows: [] },
      at: 1,
    });
    expect(s.mode).toBe("live");
    expect(s.actionable).toEqual({ allowed: true, reason: null });
    expect(s.limitations).toEqual([]);
  });

  test("a stale snapshot is NOT actionable, and the reason is a sentence", () => {
    const s = surfaceSnapshot({
      surface: "blotter",
      mode: "live",
      liveness: { state: "stale", reason: "order stream closed at 14:02:11" },
      data: {},
      at: 1,
    });
    expect(s.actionable.allowed).toBe(false);
    expect(s.actionable.reason).toContain("order stream closed at 14:02:11");
  });

  test("the liveness sentence is IDENTICAL to the one a human reads", () => {
    // One function, two audiences. Two functions would be two behaviours that
    // agree until the day they stop.
    const liveness = { state: "resyncing" as const, reason: "sequence gap at 41097" };
    const s = surfaceSnapshot({ surface: "book", mode: "sim", liveness, data: {}, at: 1 });
    expect(s.livenessSummary).toBe(livenessSummary(liveness));
    expect(s.livenessSummary).toContain("Do not act on it");
  });

  test("mode is on EVERY snapshot, including a read-only surface", () => {
    // An agent deciding whether to propose an order needs to know whether this
    // is real money, for the same reason a human does.
    for (const surface of ["tape", "book", "watchlist"] as const) {
      const s = surfaceSnapshot({ surface, mode: "sim", liveness: LIVE, data: {}, at: 1 });
      expect(s.mode).toBe("sim");
    }
  });

  test("limitations reach the agent as the same sentence rendered on screen", () => {
    const s = surfaceSnapshot({
      surface: "book",
      mode: "live",
      liveness: LIVE,
      limitations: [
        {
          reason: "depth-unavailable",
          withheld: "Market depth beyond the top of book",
          detail: "this session is not receiving the depth product.",
        },
      ],
      data: {},
      at: 1,
    });
    expect(s.limitations).toEqual([
      {
        reason: "depth-unavailable",
        summary:
          "Market depth beyond the top of book is not shown: this session is not receiving the depth product.",
      },
    ]);
  });

  test("a surface-specific block also closes actionability, and wins the reason", () => {
    const s = surfaceSnapshot({
      surface: "ticket",
      mode: "sim",
      liveness: LIVE,
      data: {},
      blockedReason: "Order quantity exceeds the per-order limit (10).",
      at: 1,
    });
    expect(s.actionable.allowed).toBe(false);
    expect(s.actionable.reason).toContain("per-order limit");
  });
});

describe("capability discovery — the half §12.6 said was missing", () => {
  const live = surfaceSnapshot({ surface: "ladder", mode: "sim", liveness: LIVE, data: {}, at: 1 });
  const dead = surfaceSnapshot({
    surface: "ladder",
    mode: "sim",
    liveness: DISCONNECTED,
    data: {},
    at: 1,
  });

  test("an agent can ask what it could do from here", () => {
    const caps = surfaceCapabilities("ladder", live);
    expect(caps.map((c) => c.name)).toContain("ladder_propose_order");
    expect(caps.map((c) => c.name)).toContain("ladder_read");
  });

  test("EVERY mutating capability requires approval, and every read does not", () => {
    for (const surface of ["ticket", "ladder", "blotter", "positions"] as const) {
      for (const cap of surfaceCapabilities(surface, live)) {
        const mutating = cap.name.includes("propose");
        expect(cap.requiresApproval, `${cap.name}`).toBe(mutating);
      }
    }
  });

  test("there is no capability named execute, place or submit", () => {
    // A bridge can read, enumerate and propose. Turning a proposal into an
    // order is a human's click, and the vocabulary says so.
    const all = (["ticket", "ladder", "blotter", "positions", "chart"] as const).flatMap((s) =>
      surfaceCapabilities(s, live).map((c) => c.name),
    );
    for (const name of all) {
      expect(name).not.toMatch(/_(execute|place|submit|commit)$/);
    }
  });

  test("a disconnected surface reports its mutations as UNAVAILABLE, with the reason", () => {
    const caps = surfaceCapabilities("ladder", dead);
    const propose = caps.find((c) => c.name === "ladder_propose_order")!;
    expect(propose.available).toBe(false);
    expect(propose.unavailableReason).toContain("disconnected");

    // Reading is still fine — freezing state is not the same as hiding it.
    expect(caps.find((c) => c.name === "ladder_read")!.available).toBe(true);
  });
});

describe("proposals", () => {
  test("requiresApproval is a literal true, not a computed boolean", () => {
    resetProposalIds();
    const p = proposeAction("Buy 2 ESU6 at 5000.00", { side: "buy" });
    expect(p.requiresApproval).toBe(true);
    expect(p.proposalId).toBe("proposal-1");
    expect(p.summary).toContain("Buy 2 ESU6");
  });

  test("the structured action travels with it, so a human sees the whole thing", () => {
    const action = { side: "buy", qty: "2", limitPrice: "5000.00" };
    expect(proposeAction("...", action).action).toEqual(action);
  });
});

describe("an adapter can be written against this in one sitting", () => {
  test("the shape compiles and behaves", () => {
    // The point of the contract: `registerLadderBridge` in agent-integrations
    // should be mechanical. This is the whole of a read-only adapter.
    const adapter: TradingSurfaceAdapter<{ rows: number }, { price: string }> = {
      readState: () =>
        surfaceSnapshot({
          surface: "ladder",
          mode: "sim",
          liveness: LIVE,
          data: { rows: 3 },
          at: 1,
        }),
      capabilities: () => surfaceCapabilities("ladder", { actionable: { allowed: true, reason: null } }),
      propose: (action) => proposeAction(`Order at ${action.price}`, action),
      recent: () => [],
    };

    expect(adapter.readState().data.rows).toBe(3);
    expect(adapter.propose({ price: "5000.00" }).requiresApproval).toBe(true);
    expect(adapter.capabilities().length).toBeGreaterThan(0);
  });
});
