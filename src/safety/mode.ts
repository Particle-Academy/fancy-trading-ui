/**
 * Mode and liveness — the two pieces of state every surface in this package
 * carries, and the two whose absence is silently dangerous.
 *
 * **Mode** answers "is this real money". §3.2 requires it to be visually
 * unmistakable and un-styleable-away; the chrome lives in
 * `../chrome/ModeBanner.tsx`, but the *data* lives here, because a marker that
 * exists only as decoration disappears the moment a surface is embedded
 * somewhere that restyles it. {@link decorateSymbol} puts it in the text.
 *
 * **Liveness** answers "is what I am looking at still true". On a disconnect,
 * private state freezes and is marked stale (§2.6) — it is never cleared,
 * because a blotter that empties on disconnect shows a trader no position and
 * no stop when both exist at the venue. While stale, one-click entry is off.
 *
 * Both are headless on purpose. {@link livenessSummary} is the sentence a human
 * reads AND the sentence an MCP bridge hands an agent, so the two cannot drift
 * apart and leave the agent acting on a book the human can see is broken.
 */

/**
 * `live` is real money. `sim` is a simulated account. `replay` is historical
 * data played back. The last two are both "not real", and nothing in this
 * package treats them differently for safety purposes.
 */
export type TradingMode = "live" | "sim" | "replay";

export type LivenessState =
  /** Connected, in sync, and current. */
  | "live"
  /** Frozen at the last known good state. It may no longer be true. */
  | "stale"
  /** Reconnected and repairing — a snapshot is in flight, or a gap is being filled. */
  | "resyncing"
  /** No transport at all. */
  | "disconnected";

export type Liveness = {
  readonly state: LivenessState;
  /** When it entered this state, so a surface can show "stale for 4s". */
  readonly since?: number;
  /** Why — surfaced verbatim to humans and agents alike. */
  readonly reason?: string;
};

export const LIVE: Liveness = { state: "live" };
export const DISCONNECTED: Liveness = { state: "disconnected" };

const PREFIX: Record<TradingMode, string> = {
  live: "",
  sim: "[SIM]",
  replay: "[REPLAY]",
};

const LABEL: Record<TradingMode, string> = {
  live: "LIVE",
  sim: "SIM",
  replay: "REPLAY",
};

export const isSimulated = (mode: TradingMode): boolean => mode !== "live";

/** `"LIVE"` / `"SIM"` / `"REPLAY"`. Every mode has one, including live. */
export const modeLabel = (mode: TradingMode): string => LABEL[mode];

/**
 * Prefix a symbol with its mode, Sierra Chart's convention.
 *
 * This is in the *text*, not the styling, which is the point: a consumer's
 * stylesheet can recolour a banner, and cannot recolour the characters `[SIM]`
 * out of a symbol. Idempotent — decorating an already-decorated symbol does not
 * stack prefixes.
 */
export function decorateSymbol(symbol: string, mode: TradingMode): string {
  const prefix = PREFIX[mode];
  if (!prefix) return symbol;
  return symbol.startsWith(prefix) ? symbol : `${prefix} ${symbol}`;
}

/** Strip any mode prefix — for the value sent to a venue, which never wants it. */
export function undecorateSymbol(symbol: string): string {
  for (const prefix of Object.values(PREFIX)) {
    if (prefix && symbol.startsWith(`${prefix} `)) return symbol.slice(prefix.length + 1);
  }
  return symbol;
}

export const isDegraded = (liveness: Liveness): boolean => liveness.state !== "live";

export type OneClickVerdict = {
  readonly allowed: boolean;
  /** `null` when allowed. Otherwise the sentence to put on the disabled control. */
  readonly reason: string | null;
};

const REFUSAL: Record<Exclude<LivenessState, "live">, string> = {
  stale: "state is stale",
  resyncing: "state is resyncing",
  disconnected: "disconnected",
};

/**
 * Whether one-click order entry may fire right now.
 *
 * A human's own one-click is a human decision and this kit does not second-guess
 * it (§3.1) — so mode is NOT a reason to refuse, and neither is anything about
 * the trader's own settings. The only thing that closes it is not knowing
 * whether what is on screen is true.
 */
export function oneClickVerdict(liveness: Liveness, _mode: TradingMode = "live"): OneClickVerdict {
  if (liveness.state === "live") return { allowed: true, reason: null };
  const base = REFUSAL[liveness.state];
  const detail = liveness.reason ? ` — ${liveness.reason}` : "";
  return {
    allowed: false,
    reason: `One-click entry is off because ${base}${detail}.`,
  };
}

/**
 * One sentence describing the trustworthiness of a surface's data.
 *
 * Used by the chrome AND by every bridge adapter's `readState()`. An agent that
 * cannot distinguish a stale blotter from a live one will act on the stale one,
 * so it gets the same words, not a boolean it has to interpret.
 */
export function livenessSummary(liveness: Liveness): string {
  const detail = liveness.reason ? ` (${liveness.reason})` : "";
  switch (liveness.state) {
    case "live":
      return `Live and in sync${detail}.`;
    case "stale":
      return `STALE — frozen at the last known good state and may not be true now${detail}. Do not act on it.`;
    case "resyncing":
      return `RESYNCING — repairing after a gap; this is not a trustworthy view yet${detail}. Do not act on it.`;
    case "disconnected":
      return `DISCONNECTED — there is no live data behind this${detail}. Do not act on it.`;
  }
}
