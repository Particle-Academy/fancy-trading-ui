/**
 * The re-enable console (§3.2, adopted from IBKR §12.2).
 *
 * The rule these tests encode is one sentence long and every "don't show this
 * again" implementation gets it wrong:
 *
 *   "This page can only be used to ENABLE messages that you have turned off,
 *    NOT to disable them. We want to ensure you have read each message at least
 *    one time before you elect to disable it."
 *
 * So each test below fails against the obvious implementation — a
 * `Record<string, boolean>` with a settings screen that writes it — because
 * that implementation lets you silence a warning you have never read, and lets
 * you silence all of them at once.
 */
import { describe, expect, test } from "vitest";
import {
  WarningRegistry,
  WarningNeverFired,
  type WarningRecord,
} from "../src/safety/warnings.ts";

const MISCLICK = "ladder.order-will-fill-immediately";

describe("a warning cannot be silenced before it has fired", () => {
  test("silencing an unfired warning throws", () => {
    const r = new WarningRegistry();
    expect(() => r.silence(MISCLICK, "ladder:ES")).toThrow(WarningNeverFired);
  });

  test("and it is still shown afterwards, because the silence did not take", () => {
    const r = new WarningRegistry();
    try {
      r.silence(MISCLICK, "ladder:ES");
    } catch {
      /* expected */
    }
    expect(r.shouldShow(MISCLICK, "ladder:ES")).toBe(true);
  });

  test("once fired, it can be silenced", () => {
    const r = new WarningRegistry();
    expect(r.fire(MISCLICK, "ladder:ES", 1)).toBe(true);
    expect(r.canSilence(MISCLICK, "ladder:ES")).toBe(true);
    r.silence(MISCLICK, "ladder:ES", 2);
    expect(r.shouldShow(MISCLICK, "ladder:ES")).toBe(false);
  });
});

describe("silencing is per-message AND per-place — 'only where it fired'", () => {
  test("silencing on one ladder does not silence the same warning on another", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 1);
    r.silence(MISCLICK, "ladder:ES", 2);

    expect(r.shouldShow(MISCLICK, "ladder:ES")).toBe(false);
    expect(r.shouldShow(MISCLICK, "ladder:NQ")).toBe(true);
  });

  test("and silencing one message does not touch a different message", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 1);
    r.fire("ladder.stop-will-fill-immediately", "ladder:ES", 1);
    r.silence(MISCLICK, "ladder:ES", 2);

    expect(r.shouldShow("ladder.stop-will-fill-immediately", "ladder:ES")).toBe(true);
  });
});

describe("there is no mute-all, and that is a structural property", () => {
  test("no method on the registry silences in bulk", () => {
    const r = new WarningRegistry();
    const names = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(r) as object),
      ...Object.keys(r),
    ];
    const bulkMute = names.filter((n) =>
      /^(silence|mute|disable|suppress|dismiss|ignore).*(all|every|bulk)$/i.test(n),
    );
    expect(bulkMute).toEqual([]);
  });

  test("silence() REQUIRES both an id and a scope", () => {
    // Function.length counts parameters before the first defaulted one, so the
    // two required arguments are `id` and `scope`. That is the tripwire: if
    // someone later makes `scope` optional to mean "all scopes", this drops to
    // 1 and the test fails.
    expect(WarningRegistry.prototype.silence.length).toBe(2);
  });

  test("re-enabling in bulk IS allowed — the console only ever adds messages back", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 1);
    r.silence(MISCLICK, "ladder:ES", 2);
    r.fire("ticket.market-order-no-limit", "ticket:ES", 1);
    r.silence("ticket.market-order-no-limit", "ticket:ES", 2);

    r.reEnableAll();

    expect(r.shouldShow(MISCLICK, "ladder:ES")).toBe(true);
    expect(r.shouldShow("ticket.market-order-no-limit", "ticket:ES")).toBe(true);
  });
});

describe("the console lists what a human can act on", () => {
  test("only fired warnings appear, and each says whether it is silenced", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 10);
    r.fire(MISCLICK, "ladder:ES", 20);
    r.silence(MISCLICK, "ladder:ES", 30);
    r.fire("ticket.reduce-only", "ticket:ES", 40);

    const rows = r.list();
    expect(rows.map((x: WarningRecord) => x.id).sort()).toEqual([
      MISCLICK,
      "ticket.reduce-only",
    ]);

    const misclick = rows.find((x) => x.id === MISCLICK)!;
    expect(misclick.firedCount).toBe(2);
    expect(misclick.silenced).toBe(true);
    expect(misclick.silencedAt).toBe(30);
    expect(misclick.scope).toBe("ladder:ES");
  });

  test("a silenced warning still counts its suppressed firings, so it is auditable", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 1);
    r.silence(MISCLICK, "ladder:ES", 2);
    expect(r.fire(MISCLICK, "ladder:ES", 3)).toBe(false);

    const row = r.list().find((x) => x.id === MISCLICK)!;
    // Shown once, then suppressed once. The two counters are separate because
    // "how often did this nearly fire while muted" is the number that tells a
    // human they silenced something they should not have.
    expect(row.firedCount).toBe(1);
    expect(row.suppressedCount).toBe(1);
  });
});

describe("it survives a page reload without becoming a mute-all", () => {
  test("round-trips through JSON", () => {
    const r = new WarningRegistry();
    r.fire(MISCLICK, "ladder:ES", 1);
    r.silence(MISCLICK, "ladder:ES", 2);

    const revived = WarningRegistry.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    expect(revived.shouldShow(MISCLICK, "ladder:ES")).toBe(false);
    expect(revived.shouldShow(MISCLICK, "ladder:NQ")).toBe(true);
  });

  test("a hand-edited state claiming a silenced-but-never-fired warning is REFUSED", () => {
    // Persisted state is the back door into a mute-all: write
    // `{silenced: true}` for every id you can think of and the rule is gone.
    const forged = {
      version: 1 as const,
      records: [
        { id: MISCLICK, scope: "ladder:ES", firedAt: null, firedCount: 0, suppressedCount: 0, silenced: true, silencedAt: 5 },
      ],
    };
    const revived = WarningRegistry.fromJSON(forged);
    expect(revived.shouldShow(MISCLICK, "ladder:ES")).toBe(true);
  });
});
