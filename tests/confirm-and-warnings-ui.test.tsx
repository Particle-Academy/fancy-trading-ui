/**
 * Two more §3.2 rules, at the point a user meets them.
 *
 * - **Destructive and irreversible AGGREGATE actions get their own
 *   confirmation, independent of routine order entry.** Confirming everything
 *   trains people to click through, which is how a confirmation dialog becomes
 *   a keystroke.
 * - **A warning can only be silenced after it has fired, and only where it
 *   fired.** The settings surface is a re-enable console with no mute-all.
 */
import { describe, expect, test, vi } from "vitest";
import {
  ConfirmAggregate,
  WarningConsole,
  WarningNotice,
  needsConfirmation,
} from "../src/chrome/Confirm.tsx";
import { TRADING_WARNINGS, WarningRegistry } from "../src/safety/warnings.ts";
import { click, render } from "./render.tsx";

describe("aggregate confirmations are per-action", () => {
  test("all three are on by default — the floor, not a policy value", () => {
    for (const action of ["cancel-all", "flatten", "reverse"] as const) {
      expect(needsConfirmation(action, {})).toBe(true);
    }
  });

  test("turning one off leaves the others on", () => {
    // Sierra Chart gives Cancel All, Flatten and Reverse each their own
    // setting, and that asymmetry is the correct design (§2.2).
    const settings = { "cancel-all": false };
    expect(needsConfirmation("cancel-all", settings)).toBe(false);
    expect(needsConfirmation("flatten", settings)).toBe(true);
    expect(needsConfirmation("reverse", settings)).toBe(true);
  });

  test("an AGENT-originated aggregate action always confirms, whatever the settings", () => {
    // §3.1: a human's own one-click is a human decision. An agent has no hand
    // and no accountability, so this is structural rather than a setting.
    const settings = { "cancel-all": false, flatten: false, reverse: false };
    for (const action of ["cancel-all", "flatten", "reverse"] as const) {
      expect(needsConfirmation(action, settings, "agent")).toBe(true);
    }
  });

  test("there is no settings key that switches them all off", () => {
    // A `{ all: false }` escape hatch would undo the asymmetry in one line.
    expect(needsConfirmation("flatten", { all: false } as Record<string, boolean>)).toBe(true);
  });
});

describe("the confirmation states what will actually happen", () => {
  test("it renders the specific impact, not 'Are you sure?'", () => {
    const h = render(
      <ConfirmAggregate
        action="flatten"
        open
        mode="live"
        impact="12 working orders will be cancelled and 3 positions closed at market."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(h.container.ownerDocument.body.textContent).toContain("12 working orders");
    expect(h.container.ownerDocument.body.textContent).toContain("3 positions");
    h.unmount();
  });

  test("the mode is on the dialog — you must not confirm a live flatten thinking it is sim", () => {
    const h = render(
      <ConfirmAggregate
        action="flatten"
        open
        mode="live"
        impact="everything"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const marker = h.container.ownerDocument.body.querySelector<HTMLElement>(
      "[data-fancy-trading-mode]",
    );
    expect(marker?.dataset.fancyTradingMode).toBe("live");
    expect(marker?.style.getPropertyPriority("display")).toBe("important");
    h.unmount();
  });

  test("confirming calls back exactly once", () => {
    const onConfirm = vi.fn();
    const h = render(
      <ConfirmAggregate
        action="cancel-all"
        open
        mode="sim"
        impact="4 orders"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    click(
      h.container.ownerDocument.body.querySelector("[data-fancy-trading-confirm-accept]"),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});

describe("a warning offers 'don't show again' only where it fired", () => {
  test("rendering the notice IS the reading, so the affordance is available", () => {
    const registry = new WarningRegistry();
    const h = render(
      <WarningNotice
        registry={registry}
        id={TRADING_WARNINGS.ImmediateFill}
        scope="ladder:ES"
        message="This order will fill immediately."
      />,
    );
    expect(h.text()).toContain("fill immediately");
    expect(h.find("[data-fancy-trading-warning-silence]")).not.toBeNull();
    h.unmount();
  });

  test("silencing it hides it HERE and leaves it armed elsewhere", () => {
    const registry = new WarningRegistry();
    const h = render(
      <WarningNotice
        registry={registry}
        id={TRADING_WARNINGS.ImmediateFill}
        scope="ladder:ES"
        message="This order will fill immediately."
      />,
    );
    click(h.find("[data-fancy-trading-warning-silence]"));
    expect(h.find("[data-fancy-trading-warning]")).toBeNull();
    expect(registry.shouldShow(TRADING_WARNINGS.ImmediateFill, "ladder:NQ")).toBe(true);
    h.unmount();
  });

  test("an already-silenced warning renders nothing at all", () => {
    const registry = new WarningRegistry();
    registry.fire(TRADING_WARNINGS.NearExpiry, "ticket:ESU6", 1);
    registry.silence(TRADING_WARNINGS.NearExpiry, "ticket:ESU6", 2);

    const h = render(
      <WarningNotice
        registry={registry}
        id={TRADING_WARNINGS.NearExpiry}
        scope="ticket:ESU6"
        message="This contract expires tomorrow."
      />,
    );
    expect(h.find("[data-fancy-trading-warning]")).toBeNull();
    h.unmount();
  });
});

describe("the console can only turn warnings back ON", () => {
  const registry = () => {
    const r = new WarningRegistry();
    r.fire(TRADING_WARNINGS.ImmediateFill, "ladder:ES", 1);
    r.silence(TRADING_WARNINGS.ImmediateFill, "ladder:ES", 2);
    r.fire(TRADING_WARNINGS.NearExpiry, "ticket:ESU6", 3);
    return r;
  };

  test("it lists what has fired, silenced and not", () => {
    const h = render(<WarningConsole registry={registry()} />);
    expect(h.all("[data-fancy-trading-warning-row]").length).toBe(2);
    h.unmount();
  });

  test("a silenced row offers re-enable; a live row offers NOTHING that silences it", () => {
    const h = render(<WarningConsole registry={registry()} />);
    expect(h.all("[data-fancy-trading-warning-reenable]").length).toBe(1);
    expect(h.all("[data-fancy-trading-warning-silence]").length).toBe(0);
    h.unmount();
  });

  test("there is no mute-all control anywhere in the rendered console", () => {
    const h = render(<WarningConsole registry={registry()} />);
    const text = h.text().toLowerCase();
    for (const phrase of ["silence all", "mute all", "disable all", "turn all off"]) {
      expect(text).not.toContain(phrase);
    }
    h.unmount();
  });

  test("re-enable all IS offered, because it can only add messages back", () => {
    const r = registry();
    const h = render(<WarningConsole registry={r} />);
    click(h.find("[data-fancy-trading-warning-reenable-all]"));
    expect(r.shouldShow(TRADING_WARNINGS.ImmediateFill, "ladder:ES")).toBe(true);
    h.unmount();
  });

  test("the console explains WHY it cannot disable anything", () => {
    // IBKR's own sentence, and the reason the design survives contact with a
    // user asking where the off switch is.
    const h = render(<WarningConsole registry={registry()} />);
    expect(h.text().toLowerCase()).toContain("at least one time");
    h.unmount();
  });
});
