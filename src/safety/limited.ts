/**
 * "A surface that is limited never silently renders less."
 *
 * §3.2, and it is the same rule as the stale-state requirement arriving from a
 * different direction. The failure it prevents is documented rather than
 * hypothetical: TWS allocates deep-book windows by commission volume, and once
 * you exceed your allocation *"additional windows will display aggregated top
 * level data, and the Deep Button panel will be hidden"* — a ladder quietly
 * degrades to top-of-book and its controls vanish, with no explanation at the
 * point of failure (§12.5).
 *
 * Note what this is NOT. We build no entitlement system and no gate (§11.5).
 * This is a **rendering** contract: when something else — a delayed feed, an
 * unsubscribed depth product, a venue outage — reduces what a surface can show,
 * the surface says so *where the data would have been* and names the reason.
 *
 * Headless on purpose, so the same sentence reaches a human through
 * `../chrome/Withheld.tsx` and an agent through a bridge's `readState()`.
 */

export type LimitationReason =
  /** The feed is real but behind. Carry `delayMs`. */
  | "delayed-feed"
  /** Depth exists at the venue; this session is not receiving it. */
  | "depth-unavailable"
  /** A data licence or subscription does not cover this. */
  | "not-subscribed"
  /** The venue is down or the product is halted at source. */
  | "venue-outage"
  /** The signed-in user is not permitted to see it. */
  | "no-permission"
  /** The connected venue adapter does not implement it. */
  | "unsupported"
  | (string & {});

export type Limitation = {
  readonly reason: LimitationReason;
  /** What is missing, named in the words the surface would have used. */
  readonly withheld: string;
  /** Why, in a sentence a human can act on. */
  readonly detail: string;
  /** Optional: what would restore it. */
  readonly remedy?: string;
  /** For `delayed-feed`, how far behind the data is. */
  readonly delayMs?: number;
};

/**
 * One sentence naming the withheld thing and the reason. Used by the chrome and
 * by every bridge adapter, so a human and an agent are told the same thing.
 */
export function limitationSummary(limitation: Limitation): string {
  const delay =
    limitation.delayMs !== undefined
      ? ` Delayed by ${Math.round(limitation.delayMs / 1000)}s.`
      : "";
  const remedy = limitation.remedy ? ` ${limitation.remedy}` : "";
  return `${limitation.withheld} is not shown: ${limitation.detail}${delay}${remedy}`;
}

/** Several at once, for a surface missing more than one thing. */
export function limitationsSummary(limitations: readonly Limitation[]): string | null {
  if (limitations.length === 0) return null;
  return limitations.map(limitationSummary).join(" ");
}

/** Convenience for the commonest case, so the delay is never left unstated. */
export function delayedFeed(withheld: string, delayMs: number): Limitation {
  return {
    reason: "delayed-feed",
    withheld,
    detail: "this session receives a delayed feed rather than real-time data.",
    delayMs,
  };
}
