/**
 * The mode marker — the one element in this package that a consumer's
 * stylesheet cannot touch.
 *
 * §3.2: *"Simulation mode is visually unmistakable. Sierra prefixes `[SIM]`; we
 * carry `mode` on every surface and render it as chrome that cannot be styled
 * away. The failure being prevented — trading live believing you are in sim —
 * is the one that ends accounts."*
 *
 * Two mechanisms, because either alone is defeatable:
 *
 * 1. **Forced inline styles.** Every visibility-relevant property is re-asserted
 *    with `!important` from a ref, and an inline `!important` declaration
 *    outranks every author stylesheet rule. `[data-fancy-trading-mode] {
 *    display: none }` in a consumer's CSS does not take.
 * 2. **The text.** `decorateSymbol()` in `../safety/mode.ts` puts `[SIM]` into
 *    the symbol itself, so even a surface rendered without this component says
 *    so in its own content.
 *
 * There is deliberately no `className` and no colour prop. A `Badge` would have
 * been the `react-fancy` primitive to reach for, and it is exactly the wrong
 * one: a Badge is themeable, and themeable is the property a safety marker must
 * not have.
 */

import { useCallback } from "react";
import { modeLabel, type TradingMode } from "../safety/mode.ts";

const VALID_MODES: readonly string[] = ["live", "sim", "replay"];

/**
 * Covers the ways an element is made to disappear without being removed:
 * hidden, transparent, zero-sized, clipped, moved off-screen, or shrunk until
 * the text is unreadable.
 */
function forcedStyles(color: string, background: string): Record<string, string> {
  return {
    display: "inline-flex",
    "align-items": "center",
    visibility: "visible",
    opacity: "1",
    position: "static",
    color,
    "background-color": background,
    "font-size": "0.6875rem",
    "line-height": "1rem",
    "font-weight": "700",
    "letter-spacing": "0.06em",
    "font-family": "inherit",
    padding: "0.0625rem 0.375rem",
    "border-radius": "0.25rem",
    width: "auto",
    height: "auto",
    "min-width": "0",
    "max-width": "none",
    "max-height": "none",
    overflow: "visible",
    "white-space": "nowrap",
    "text-indent": "0",
    "text-transform": "none",
    transform: "none",
    "clip-path": "none",
    filter: "none",
  };
}

/**
 * Live is red because the dangerous mistake runs in that direction: someone who
 * believes they are simulating and is not. Sim and replay are loud in their own
 * right, but "am I live?" is the question that has to answer itself.
 */
const FORCED: Record<TradingMode, Record<string, string>> = {
  live: forcedStyles("#ffffff", "#b91c1c"),
  sim: forcedStyles("#1c1917", "#f59e0b"),
  replay: forcedStyles("#ffffff", "#6d28d9"),
};

const TITLE: Record<TradingMode, string> = {
  live: "LIVE — real money. Orders placed here reach the venue.",
  sim: "SIM — a simulated account. Nothing here reaches a venue.",
  replay: "REPLAY — historical data played back. Nothing here reaches a venue.",
};

export type ModeMarkerProps = {
  /** Required, and never defaulted. An unrecognised value throws. */
  mode: TradingMode;
};

export function ModeMarker({ mode }: ModeMarkerProps) {
  if (!mode || !VALID_MODES.includes(mode)) {
    throw new TypeError(
      `mode is required and must be one of ${VALID_MODES.join(" | ")} — received ${JSON.stringify(mode)}. ` +
        `A trading surface that does not know whether it is real money has no safe default.`,
    );
  }

  const forced = FORCED[mode];
  const applyForced = useCallback(
    (el: HTMLSpanElement | null) => {
      if (!el) return;
      for (const [property, value] of Object.entries(forced)) {
        el.style.setProperty(property, value, "important");
      }
    },
    [forced],
  );

  return (
    <span
      ref={applyForced}
      data-fancy-trading-mode={mode}
      // A fallback for the first paint before the ref runs. The forced inline
      // styles are the guarantee; these classes are only politeness.
      className="inline-flex items-center rounded px-1.5 py-px text-[0.6875rem] font-bold tracking-wider"
      title={TITLE[mode]}
    >
      {modeLabel(mode)}
    </span>
  );
}

/** Exported for the chrome, which needs the same validation before it renders. */
export function assertMode(mode: TradingMode): void {
  if (!mode || !VALID_MODES.includes(mode)) {
    throw new TypeError(
      `<SurfaceChrome mode> is required and must be one of ${VALID_MODES.join(" | ")} — received ${JSON.stringify(mode)}. ` +
        `A trading surface that does not know whether it is real money has no safe default.`,
    );
  }
}
