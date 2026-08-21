/**
 * Two floor rules from §3.2, both of which fail silently when got wrong:
 *
 * - **Simulation mode is visually unmistakable.** The failure being prevented —
 *   trading live believing you are in sim — is the one that ends accounts.
 * - **Stale state disables one-click**, and an agent reading through the bridge
 *   is told the same thing, because an agent that cannot distinguish a stale
 *   blotter from a live one will act on the stale one.
 */
import { describe, expect, test } from "vitest";
import {
  DISCONNECTED,
  LIVE,
  decorateSymbol,
  isDegraded,
  isSimulated,
  livenessSummary,
  modeLabel,
  oneClickVerdict,
  type Liveness,
} from "../src/safety/mode.ts";

describe("simulation mode is carried in the data, not only in the chrome", () => {
  test("a simulated symbol is prefixed, the way Sierra Chart does it", () => {
    expect(decorateSymbol("ES", "sim")).toBe("[SIM] ES");
    expect(decorateSymbol("ES", "replay")).toBe("[REPLAY] ES");
  });

  test("a live symbol is NOT decorated — the marker means something", () => {
    expect(decorateSymbol("ES", "live")).toBe("ES");
  });

  test("decorating twice does not stack prefixes", () => {
    expect(decorateSymbol(decorateSymbol("ES", "sim"), "sim")).toBe("[SIM] ES");
  });

  test("replay counts as simulated — it is not live money either", () => {
    expect(isSimulated("sim")).toBe(true);
    expect(isSimulated("replay")).toBe(true);
    expect(isSimulated("live")).toBe(false);
  });

  test("every mode has a label, including live", () => {
    // A UI that renders chrome only for sim has no way to distinguish
    // "definitely live" from "the mode prop was never wired up".
    expect(modeLabel("live")).toBe("LIVE");
    expect(modeLabel("sim")).toBe("SIM");
    expect(modeLabel("replay")).toBe("REPLAY");
  });
});

describe("one-click is off unless the state is live", () => {
  const cases: Array<[Liveness, boolean]> = [
    [LIVE, true],
    [{ state: "stale", since: 1, reason: "socket closed" }, false],
    [{ state: "resyncing", since: 1 }, false],
    [DISCONNECTED, false],
  ];

  for (const [liveness, allowed] of cases) {
    test(`${liveness.state} -> one-click ${allowed ? "allowed" : "refused"}`, () => {
      expect(oneClickVerdict(liveness).allowed).toBe(allowed);
    });
  }

  test("the refusal names the reason, because a disabled button with no cause is a bug report", () => {
    const v = oneClickVerdict({ state: "stale", since: 1, reason: "websocket closed at 14:02:11" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("stale");
    expect(v.reason).toContain("websocket closed at 14:02:11");
  });

  test("an allowed verdict carries no reason", () => {
    expect(oneClickVerdict(LIVE).reason).toBeNull();
  });

  test("simulation does NOT disable one-click — sim is for practising exactly this", () => {
    expect(oneClickVerdict(LIVE, "sim").allowed).toBe(true);
  });
});

describe("degradation is a first-class question a surface can ask", () => {
  test("anything but live is degraded", () => {
    expect(isDegraded(LIVE)).toBe(false);
    expect(isDegraded({ state: "stale" })).toBe(true);
    expect(isDegraded({ state: "resyncing" })).toBe(true);
    expect(isDegraded(DISCONNECTED)).toBe(true);
  });

  test("the summary is the SAME string a bridge hands an agent", () => {
    // This is the point of putting it here rather than in a component: the
    // sentence a human reads and the sentence an agent reads are one function,
    // so they cannot drift apart and leave the agent trading a stale book.
    const l: Liveness = { state: "resyncing", since: 1, reason: "sequence gap at 41097" };
    const s = livenessSummary(l);
    expect(s.toLowerCase()).toContain("resyncing");
    expect(s).toContain("sequence gap at 41097");
    expect(s.toLowerCase()).toContain("not");
  });

  test("a live summary says so plainly", () => {
    expect(livenessSummary(LIVE).toLowerCase()).toContain("live");
  });
});
