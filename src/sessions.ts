/**
 * Sessions — the part of a trading chart that a professional judges instantly,
 * and the part no charting engine provides.
 *
 * §2.7's list, and every item is a rule this module exists to make possible:
 *
 * 1. **Never plot bars on a wall-clock axis.** Use an ordinal, session-aware
 *    axis that collapses non-session time. lightweight-charts' index axis
 *    already is one, which is a point in its favour.
 * 2. **But do not collapse it silently** — a session boundary gets a visible
 *    separator, because a gap across a break carries information.
 * 3. **Shade extended hours differently, and let it be toggled** — that changes
 *    the OHLC values, not just the shading.
 * 4. **Render halts as an annotated band**, not a flat line. A horizontal line
 *    at the last price during a halt implies a market trading flat.
 * 5. **Never interpolate across a break.**
 * 6. **Volume profile and delta reset per session**, and "session" is
 *    instrument-specific — the futures day starts at 18:00 ET, not midnight.
 *
 * Point 6 is why {@link sessionKey} exists rather than a call to
 * `toISOString().slice(0, 10)`. A 19:00 ET bar on Monday belongs to TUESDAY's
 * session, and a profile keyed on the calendar date puts it in the wrong day
 * every single evening.
 *
 * **No time-zone database.** The calendar carries a fixed UTC offset, because a
 * tz database is a third-party dependency and a large one; a host that needs
 * DST correctness computes the offset for the range it is charting and passes
 * it in. That is stated in the type rather than left to be discovered.
 */

export type SessionWindow = {
  /** Minutes from local midnight. 09:30 is 570. */
  openMinute: number;
  /**
   * Minutes from local midnight. A value less than or equal to `openMinute`
   * means the window WRAPS past midnight — which is how a futures session that
   * runs 18:00 to 17:00 the next day is expressed.
   */
  closeMinute: number;
};

export type SessionCalendar = {
  /**
   * Minutes to ADD to UTC to reach the exchange's local time. US Eastern
   * standard time is `-300`; daylight time is `-240`.
   *
   * Fixed on purpose. Resolving a real time zone needs a tz database, which is
   * a dependency this package does not carry — so a host charting across a DST
   * boundary passes the offset for the range it is drawing.
   */
  utcOffsetMinutes: number;
  core: SessionWindow;
  preMarket?: SessionWindow;
  afterHours?: SessionWindow;
  /**
   * The minute at which a NEW session begins, when that is not midnight.
   *
   * `1080` (18:00) for CME equity index futures: a bar at 19:00 on Monday is
   * part of Tuesday's session. Omit for anything whose session is the calendar
   * day.
   */
  sessionStartMinute?: number;
  /** Weekdays the market trades. `0` is Sunday. Defaults to Monday-Friday. */
  tradingDays?: readonly number[];
  /** Local `YYYY-MM-DD` dates the market is closed. */
  holidays?: readonly string[];
  /** 24/7 — crypto. Everything is `core`, and only `sessionStartMinute` divides days. */
  continuous?: boolean;
  /** A daily maintenance break, e.g. CME's. */
  maintenance?: SessionWindow;
};

/** US equities, standard time. Core 09:30-16:00, pre from 04:00, after to 20:00. */
export const US_EQUITIES_EST: SessionCalendar = {
  utcOffsetMinutes: -300,
  core: { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
  preMarket: { openMinute: 4 * 60, closeMinute: 9 * 60 + 30 },
  afterHours: { openMinute: 16 * 60, closeMinute: 20 * 60 },
};

/**
 * CME equity index futures, standard time. The session starts at 18:00 the
 * PREVIOUS evening and runs to 17:00, with a maintenance break.
 *
 * The CME specifics are marked UNVERIFIED in the plan (§2.7) because
 * cmegroup.com could not be reached to confirm them. Treat this constant as a
 * worked example of the shape, not as an authority on the schedule.
 */
export const CME_EQUITY_INDEX_EST: SessionCalendar = {
  utcOffsetMinutes: -300,
  core: { openMinute: 18 * 60, closeMinute: 17 * 60 },
  sessionStartMinute: 18 * 60,
  maintenance: { openMinute: 17 * 60, closeMinute: 18 * 60 },
  tradingDays: [0, 1, 2, 3, 4, 5],
};

/** Crypto. No sessions at all; days divide at UTC midnight. */
export const CRYPTO_24_7: SessionCalendar = {
  utcOffsetMinutes: 0,
  core: { openMinute: 0, closeMinute: 0 },
  continuous: true,
};

export type BarPhase = "core" | "pre" | "after" | "closed" | "maintenance";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/** Local calendar fields for an epoch-seconds timestamp. */
export function localParts(timeSec: number, calendar: SessionCalendar): {
  date: string;
  minute: number;
  weekday: number;
} {
  const shifted = new Date((timeSec * 1000) + calendar.utcOffsetMinutes * MINUTE_MS);
  const date = shifted.toISOString().slice(0, 10);
  const minute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minute, weekday: shifted.getUTCDay() };
}

function inWindow(minute: number, window: SessionWindow): boolean {
  const { openMinute, closeMinute } = window;
  return closeMinute > openMinute
    ? minute >= openMinute && minute < closeMinute
    : // Wraps past midnight.
      minute >= openMinute || minute < closeMinute;
}

/** Which part of the trading day a bar falls in. */
export function phaseOf(timeSec: number, calendar: SessionCalendar): BarPhase {
  if (calendar.continuous) return "core";
  const { date, minute, weekday } = localParts(timeSec, calendar);

  if (calendar.holidays?.includes(date)) return "closed";
  const days = calendar.tradingDays ?? [1, 2, 3, 4, 5];
  if (!days.includes(weekday)) return "closed";

  if (calendar.maintenance && inWindow(minute, calendar.maintenance)) return "maintenance";
  if (inWindow(minute, calendar.core)) return "core";
  if (calendar.preMarket && inWindow(minute, calendar.preMarket)) return "pre";
  if (calendar.afterHours && inWindow(minute, calendar.afterHours)) return "after";
  return "closed";
}

/**
 * Which SESSION a bar belongs to.
 *
 * Not the calendar date. When `sessionStartMinute` is set, everything at or
 * after it belongs to the NEXT day's session — so an ES bar at 19:00 on Monday
 * is part of Tuesday's session, and a volume profile keyed on the calendar date
 * would put it in the wrong day every evening.
 */
export function sessionKey(timeSec: number, calendar: SessionCalendar): string {
  const { date, minute } = localParts(timeSec, calendar);
  const start = calendar.sessionStartMinute;
  if (start === undefined || minute < start) return date;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export type SessionSegment = {
  key: string;
  /** Index of the first bar of this session in the input array. */
  fromIndex: number;
  /** Index of the last bar, inclusive. */
  toIndex: number;
  startTime: number;
  endTime: number;
};

/** Split a series into sessions, preserving the input order. */
export function sessionSegments(
  times: readonly number[],
  calendar: SessionCalendar,
): SessionSegment[] {
  const out: SessionSegment[] = [];
  let current: SessionSegment | null = null;

  times.forEach((time, index) => {
    const key = sessionKey(time, calendar);
    if (!current || current.key !== key) {
      if (current) out.push(current);
      current = { key, fromIndex: index, toIndex: index, startTime: time, endTime: time };
    } else {
      current.toIndex = index;
      current.endTime = time;
    }
  });

  if (current) out.push(current);
  return out;
}

/**
 * The bar indices at which a new session begins — where a separator goes.
 *
 * The first bar is never a boundary: a separator before the first candle marks
 * nothing.
 */
export function sessionBoundaryIndices(
  times: readonly number[],
  calendar: SessionCalendar,
): number[] {
  return sessionSegments(times, calendar)
    .slice(1)
    .map((s) => s.fromIndex);
}

/**
 * What kind of interruption this is. Absent means "a halt, cause unstated" —
 * which is what every caller wrote before this existed and is still valid.
 *
 * The distinction that earns the field is `luld-limit-state` versus
 * `luld-pause`. **A Limit State is not a pause**: the market is still trading,
 * it simply cannot print outside the band, and it lasts 15 seconds before it
 * either resolves or becomes a five-minute pause. Rendering the two identically
 * tells a trader the market stopped when it did not, and that it returns in
 * five minutes when it may return in fifteen seconds.
 */
export type HaltKind =
  /** LULD Limit State — 15 seconds, still trading, capped at the band. */
  | "luld-limit-state"
  /** LULD trading pause — five minutes, nothing trades. */
  | "luld-pause"
  /** Market-wide circuit breaker (7% / 13% / 20%). Not about this symbol. */
  | "market-wide"
  /** Scheduled: CME's daily break, Kalshi's weekly window. Not an event. */
  | "maintenance"
  /** News pending / regulatory. */
  | "news"
  | (string & {});

export type Halt = {
  /** Epoch seconds. */
  from: number;
  to: number;
  reason?: string;
  kind?: HaltKind;
  /**
   * The price band in force, when the host knows it.
   *
   * **Never computed here.** The LULD reference price is a five-minute rolling
   * mean updated only on a 1%-or-greater move, the percentage depends on tier
   * and price band and DOUBLES in the closing 25 minutes, and every input is
   * market data. Computing it in a UI package would be inventing a number and
   * printing it beside real ones.
   */
  band?: { lower: string; upper: string };
};

/**
 * The label a halt renders with — one sentence, and the same one wherever it
 * appears.
 */
export function describeHalt(halt: Halt): string {
  const band = halt.band ? ` Band ${halt.band.lower}–${halt.band.upper}.` : "";
  const reason = halt.reason ? ` ${halt.reason}.` : "";

  switch (halt.kind) {
    case "luld-limit-state":
      return `LULD LIMIT STATE — still trading, capped at the band; 15 seconds before it resolves or becomes a pause.${band}${reason}`;
    case "luld-pause":
      return `HALTED — LULD trading pause, five minutes.${band}${reason}`;
    case "market-wide":
      return `HALTED — market-wide circuit breaker. Not specific to this symbol.${reason}`;
    case "maintenance":
      return `Scheduled maintenance break — the market is closed, not halted.${reason}`;
    case "news":
      return `HALTED — news pending.${reason}`;
    default:
      return `HALTED.${reason}`;
  }
}

export type ExtendedRange = {
  fromIndex: number;
  toIndex: number;
  phase: Exclude<BarPhase, "core">;
};

/**
 * Contiguous runs of non-core bars, so the chart can shade them.
 *
 * The shading is not decoration: extended-hours bars have different OHLC values
 * from a core-only series, so a trader needs to know which they are looking at
 * before reading a level off the chart.
 */
export function extendedRanges(
  times: readonly number[],
  calendar: SessionCalendar,
): ExtendedRange[] {
  const out: ExtendedRange[] = [];
  let run: ExtendedRange | null = null;

  times.forEach((time, index) => {
    const phase = phaseOf(time, calendar);
    if (phase === "core") {
      if (run) {
        out.push(run);
        run = null;
      }
      return;
    }
    if (run && run.phase === phase) run.toIndex = index;
    else {
      if (run) out.push(run);
      run = { fromIndex: index, toIndex: index, phase };
    }
  });

  if (run) out.push(run);
  return out;
}

/**
 * The bar-index range a halt covers, so it can be drawn as an annotated band.
 *
 * Returns `null` when no bar falls inside the halt — which is the usual case,
 * because a halted market produces no prints. The band is then anchored to the
 * gap between the surrounding bars, and the caller is told so rather than
 * being handed an empty range that renders as nothing.
 */
export function haltRange(
  times: readonly number[],
  halt: Halt,
): { fromIndex: number; toIndex: number; inclusive: boolean } | null {
  const inside: number[] = [];
  times.forEach((t, i) => {
    if (t >= halt.from && t <= halt.to) inside.push(i);
  });
  if (inside.length > 0) {
    return { fromIndex: inside[0]!, toIndex: inside[inside.length - 1]!, inclusive: true };
  }

  // No prints during the halt — anchor to the surrounding bars.
  let before = -1;
  let after = -1;
  times.forEach((t, i) => {
    if (t < halt.from) before = i;
    if (after === -1 && t > halt.to) after = i;
  });
  if (before === -1 || after === -1) return null;
  return { fromIndex: before, toIndex: after, inclusive: false };
}

/** Minutes of trading in one session, for a bar-count sanity check. */
export function sessionMinutes(calendar: SessionCalendar, includeExtended = false): number {
  if (calendar.continuous) return DAY_MINUTES;
  const span = (w: SessionWindow): number =>
    w.closeMinute > w.openMinute
      ? w.closeMinute - w.openMinute
      : DAY_MINUTES - w.openMinute + w.closeMinute;
  let total = span(calendar.core);
  if (includeExtended) {
    if (calendar.preMarket) total += span(calendar.preMarket);
    if (calendar.afterHours) total += span(calendar.afterHours);
  }
  return total;
}
