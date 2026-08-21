/**
 * The warning registry — a **re-enable console**, not a mute switch.
 *
 * Taken in spirit from IBKR's global message settings, which is the best design
 * found in the whole study (plan §12.2):
 *
 * > "This page can only be used to enable messages that you have turned off,
 * >  not to disable them. We want to ensure you have read each message at least
 * >  one time before you elect to disable it."
 *
 * Three properties follow, and all three are structural rather than advisory:
 *
 * 1. **A warning cannot be silenced before it has fired.** {@link
 *    WarningRegistry.silence} throws {@link WarningNeverFired}. There is no path
 *    that silences an unread message, including the persisted-state path — see
 *    {@link WarningRegistry.fromJSON}.
 * 2. **Silence is per-message AND per-place.** Silencing the immediate-fill
 *    guard on the ES ladder leaves it armed on the NQ ladder, because that is
 *    what "only where it fired" means.
 * 3. **There is no mute-all.** `reEnableAll()` exists; nothing silences in
 *    bulk. Re-enabling can only ever add messages back, so it needs no guard.
 *
 * This deliberately replaces the plain `pendingMode` boolean the rest of the
 * suite uses. A product catalogue can afford a global "stop asking me"; an
 * order ticket cannot.
 */

export type WarningId = string;

/**
 * Where the warning fired. A stable, human-meaningful string — `"ladder:ES"`,
 * `"ticket:AAPL"`, `"blotter"`. Silence is keyed on `(id, scope)` so that
 * turning a message off in one place cannot turn it off everywhere.
 */
export type WarningScope = string;

export type WarningRecord = {
  readonly id: WarningId;
  readonly scope: WarningScope;
  /** When it first fired. `null` means never read, so it cannot be silenced. */
  readonly firedAt: number | null;
  /** How many times it was actually SHOWN. */
  readonly firedCount: number;
  /** How many times it would have fired but was silenced. Kept for the audit. */
  readonly suppressedCount: number;
  readonly silenced: boolean;
  readonly silencedAt: number | null;
};

export type WarningRegistryState = {
  readonly version: 1;
  readonly records: readonly WarningRecord[];
};

export class WarningNeverFired extends Error {
  readonly id: WarningId;
  readonly scope: WarningScope;
  constructor(id: WarningId, scope: WarningScope) {
    super(
      `Warning "${id}" has never fired in "${scope}", so it cannot be silenced. ` +
        `A message must be read at least once before it can be turned off — ` +
        `silence it from the warning itself, not from a settings screen.`,
    );
    this.id = id;
    this.scope = scope;
    this.name = "WarningNeverFired";
  }
}

const key = (id: WarningId, scope: WarningScope): string => `${id} ${scope}`;

type MutableRecord = {
  id: WarningId;
  scope: WarningScope;
  firedAt: number | null;
  firedCount: number;
  suppressedCount: number;
  silenced: boolean;
  silencedAt: number | null;
};

export class WarningRegistry {
  private readonly records = new Map<string, MutableRecord>();

  private ensure(id: WarningId, scope: WarningScope): MutableRecord {
    const k = key(id, scope);
    let rec = this.records.get(k);
    if (!rec) {
      rec = {
        id,
        scope,
        firedAt: null,
        firedCount: 0,
        suppressedCount: 0,
        silenced: false,
        silencedAt: null,
      };
      this.records.set(k, rec);
    }
    return rec;
  }

  /**
   * Record that a warning condition occurred here, and answer whether it should
   * be shown. Call this at the point the warning would render — the "read it
   * once" rule is enforced by this call having happened, so a surface that only
   * checks {@link shouldShow} can never earn the right to silence.
   */
  fire(id: WarningId, scope: WarningScope, at: number = Date.now()): boolean {
    const rec = this.ensure(id, scope);
    if (rec.silenced) {
      rec.suppressedCount += 1;
      return false;
    }
    if (rec.firedAt === null) rec.firedAt = at;
    rec.firedCount += 1;
    return true;
  }

  /** Whether this warning would be shown, without recording a firing. */
  shouldShow(id: WarningId, scope: WarningScope): boolean {
    const rec = this.records.get(key(id, scope));
    return rec ? !rec.silenced : true;
  }

  /** Whether the "don't show this again" affordance may be offered at all. */
  canSilence(id: WarningId, scope: WarningScope): boolean {
    const rec = this.records.get(key(id, scope));
    return rec !== undefined && rec.firedAt !== null;
  }

  /**
   * Silence ONE message in ONE place, after it has fired there.
   *
   * Three parameters on purpose: an id, a scope, and a timestamp. There is no
   * overload meaning "all scopes", and `tests/safety-warnings.test.ts` pins the
   * arity so one cannot quietly appear later.
   */
  silence(id: WarningId, scope: WarningScope, at: number = Date.now()): void {
    if (!this.canSilence(id, scope)) throw new WarningNeverFired(id, scope);
    const rec = this.ensure(id, scope);
    rec.silenced = true;
    rec.silencedAt = at;
  }

  /** Turn one message back on. Always permitted. */
  reEnable(id: WarningId, scope: WarningScope): void {
    const rec = this.records.get(key(id, scope));
    if (!rec) return;
    rec.silenced = false;
    rec.silencedAt = null;
  }

  /**
   * Turn everything back on. Safe in bulk precisely because it only ever ADDS
   * messages back — the asymmetry is the whole design.
   */
  reEnableAll(): void {
    for (const rec of this.records.values()) {
      rec.silenced = false;
      rec.silencedAt = null;
    }
  }

  /** Everything a human can act on — i.e. everything that has actually fired. */
  list(): WarningRecord[] {
    return [...this.records.values()].filter((r) => r.firedAt !== null).map((r) => ({ ...r }));
  }

  toJSON(): WarningRegistryState {
    return { version: 1, records: this.list() };
  }

  /**
   * Revive persisted state.
   *
   * Persisted state is the back door a mute-all walks in through: hand-write
   * `{silenced: true}` for every id you can think of and the "read it once"
   * rule is gone without a single call to {@link silence}. So a record claiming
   * to be silenced without ever having fired is **not honoured** — it revives
   * un-silenced.
   */
  static fromJSON(state: WarningRegistryState | null | undefined): WarningRegistry {
    const reg = new WarningRegistry();
    if (!state || !Array.isArray(state.records)) return reg;
    for (const raw of state.records) {
      if (!raw || typeof raw.id !== "string" || typeof raw.scope !== "string") continue;
      const firedAt = typeof raw.firedAt === "number" ? raw.firedAt : null;
      const honourSilence = firedAt !== null && raw.silenced === true;
      reg.records.set(key(raw.id, raw.scope), {
        id: raw.id,
        scope: raw.scope,
        firedAt,
        firedCount: typeof raw.firedCount === "number" ? raw.firedCount : 0,
        suppressedCount: typeof raw.suppressedCount === "number" ? raw.suppressedCount : 0,
        silenced: honourSilence,
        silencedAt: honourSilence && typeof raw.silencedAt === "number" ? raw.silencedAt : null,
      });
    }
    return reg;
  }
}

/**
 * The warning ids the surfaces in this package raise. A consumer may add their
 * own — the registry does not validate against this list — but these are the
 * ones the re-enable console shows out of the box.
 */
export const TRADING_WARNINGS = {
  /** A chart/ladder order placed at a price that will fill instantly (§2.2). */
  ImmediateFill: "trading.order-will-fill-immediately",
  /** A stop placed on the wrong side of the market, so it triggers at once. */
  StopImmediateFill: "trading.stop-will-fill-immediately",
  /** Market order with no price protection. */
  MarketOrderUnprotected: "trading.market-order-unprotected",
  /** Order quantity is a large multiple of the displayed size. */
  OversizedRelativeToBook: "trading.oversized-relative-to-book",
  /** The instrument expires within the configured window (§2.2). */
  NearExpiry: "trading.near-expiry",
  /** A working order is being dragged to a new price — a cancel/replace (§2.2). */
  DragIsCancelReplace: "trading.drag-is-cancel-replace",
  /** Private state is stale; what you are looking at may not be true. */
  StaleState: "trading.state-is-stale",
  /** The order would increase a position already at a risk limit. */
  AtRiskLimit: "trading.at-risk-limit",
  /** A continuous futures symbol cannot be traded — it resolves to a contract. */
  ContinuousSymbol: "trading.continuous-symbol-not-tradable",
} as const;

export type TradingWarningId = (typeof TRADING_WARNINGS)[keyof typeof TRADING_WARNINGS];
