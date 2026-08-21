/**
 * The frame every surface in this package wears.
 *
 * It exists so three §3.2 rules are carried in ONE place rather than
 * re-implemented nine times with eight subtly different outcomes:
 *
 * 1. **Simulation mode is visually unmistakable and cannot be styled away** —
 *    delegated to `<ModeMarker>`, which is the only element here a consumer's
 *    stylesheet cannot reach.
 * 2. **Stale state is visible, and one-click follows it.** The surface carries
 *    `data-oneclick="on" | "off"` so CSS, tests and bridges all read one source.
 * 3. **A limited surface never silently renders less** — it says so *where the
 *    data would have been* and names the reason, which here means inside the
 *    body region and never in the header.
 */

import type { ReactNode } from "react";
import { Badge, Callout } from "@particle-academy/react-fancy";
import type { TradingSurface } from "../activity.ts";
import { LIVE, livenessSummary, oneClickVerdict, type Liveness, type TradingMode } from "../safety/mode.ts";
import { limitationSummary, type Limitation } from "../safety/limited.ts";
import {
  describeBreak,
  reconciliationVerdict,
  type ReconciliationBreak,
} from "../safety/reconciliation.ts";
import { ModeMarker, assertMode } from "./ModeMarker.tsx";

export type SurfaceChromeProps = {
  /** Which surface this is. Used for the stable handle and for activity events. */
  surface: TradingSurface;
  /**
   * Real money, or not. **Required, and never defaulted.**
   *
   * Guessing `"live"` risks real money; guessing `"sim"` risks someone
   * believing an order was simulated when it was not. Neither guess is
   * defensible, so an absent or unrecognised value throws.
   */
  mode: TradingMode;
  /** Defaults to live. Anything else disables one-click and shows the reason. */
  liveness?: Liveness;
  /** What this surface cannot show right now, and why. */
  limitations?: readonly Limitation[];
  /**
   * Disagreements between this client and the venue (§2.6).
   *
   * A break turns one-click off even when the feed is live: staleness and
   * wrongness are different problems, and the live-and-wrong case is the more
   * dangerous because nothing looks broken.
   */
  breaks?: readonly ReconciliationBreak[];
  id?: string;
  title?: ReactNode;
  /** Right-hand header slot. */
  actions?: ReactNode;
  /** Reaches the outer wrapper ONLY. It cannot touch the mode marker. */
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function SurfaceChrome({
  surface,
  mode,
  liveness = LIVE,
  limitations,
  breaks,
  id,
  title,
  actions,
  className,
  bodyClassName,
  children,
}: SurfaceChromeProps) {
  assertMode(mode);

  const oneClick = oneClickVerdict(liveness, mode);
  const reconciled = reconciliationVerdict(breaks ?? []);
  const degraded = liveness.state !== "live";
  const actionable = oneClick.allowed && reconciled.allowed;

  return (
    <section
      id={id}
      data-fancy-trading-surface={surface}
      data-mode={mode}
      data-liveness={liveness.state}
      data-oneclick={actionable ? "on" : "off"}
      data-reconciliation={reconciled.allowed ? "ok" : "break"}
      className={className}
    >
      <header
        data-fancy-trading-chrome=""
        className="flex items-center gap-2 border-b border-secondary-200 px-2 py-1 dark:border-secondary-800"
      >
        <ModeMarker mode={mode} />

        {title ? (
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
        ) : (
          <div className="flex-1" />
        )}

        <Badge
          data-fancy-trading-liveness={liveness.state}
          color={degraded ? "amber" : "green"}
          variant={degraded ? "solid" : "soft"}
          size="sm"
          dot
          title={livenessSummary(liveness)}
        >
          {degraded ? liveness.state : "live"}
        </Badge>

        {actions}
      </header>

      <div data-fancy-trading-body="" className={bodyClassName}>
        {/*
          The break goes FIRST and in red. It outranks staleness: a stale
          surface is out of date, a broken one is wrong, and only the second can
          be wrong while looking perfectly healthy.
        */}
        {(breaks ?? []).map((candidate, i) => (
          // Wrapped, not passed through: `Callout` does not forward unknown
          // props, and TypeScript does not complain because a hyphenated JSX
          // attribute is always allowed and never checked. Accepted silently
          // and dropped silently is the worst pair, so the handle goes on an
          // element that keeps it. Filed against react-fancy.
          <div key={`${candidate.kind}-${i}`} data-fancy-trading-break={candidate.kind} className="m-2">
            <Callout color="red">
              <p className="text-sm font-medium">{describeBreak(candidate)}</p>
            </Callout>
          </div>
        ))}

        {!reconciled.allowed && reconciled.reason ? (
          <p className="mx-2 text-xs text-red-700 dark:text-red-400">{reconciled.reason}</p>
        ) : null}

        {degraded && (
          <div data-fancy-trading-degraded={liveness.state} className="m-2">
            <Callout color="amber">
              <p className="text-sm">{livenessSummary(liveness)}</p>
              {!oneClick.allowed && oneClick.reason ? (
                <p className="mt-1 text-xs opacity-80">{oneClick.reason}</p>
              ) : null}
            </Callout>
          </div>
        )}

        {limitations?.map((limitation, i) => (
          <Withheld key={`${limitation.reason}-${i}`} limitation={limitation} className="m-2" />
        ))}

        {children}
      </div>
    </section>
  );
}

export type WithheldProps = {
  limitation: Limitation;
  className?: string;
};

/**
 * "This is not shown, and here is why."
 *
 * Render it **in the place the data would have occupied** — a cell, a column, a
 * pane — never in a corner. TWS degrades a ladder to top-of-book and hides its
 * controls with no explanation at the point of failure (§12.5); a notice in the
 * header repeats that failure in a politer font.
 */
export function Withheld({ limitation, className }: WithheldProps) {
  return (
    <div data-fancy-trading-withheld={limitation.reason} className={className}>
      <Callout color="zinc">
        <p className="text-sm">{limitationSummary(limitation)}</p>
      </Callout>
    </div>
  );
}
