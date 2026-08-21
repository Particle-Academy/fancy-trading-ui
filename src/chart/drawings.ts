/**
 * The drawing and overlay model.
 *
 * We build this ourselves because **neither engine ships usable drawing tools**
 * (§1.8), and TradingView's are not available to us at any price we should pay:
 * they live in *Advanced Charts*, which is proprietary, company-only and
 * approval-gated — *"we don't provide the Advanced Charts and the Trading
 * Platform libraries for personal use, hobbies, studies, or testing"* — with a
 * mandatory, non-removable logo. It is a different product with a different
 * licence, not an upgrade path.
 *
 * Everything here is **data**, not canvas state:
 *
 * - **Controlled.** `drawings` + `onDrawingsChange`. There is no internal store,
 *   so an agent reading through a bridge sees exactly what the human sees.
 * - **JSON-friendly.** Prices are decimal strings, times are epoch seconds. A
 *   drawing survives `JSON.stringify` and can be emitted by an agent verbatim,
 *   persisted to a database, or diffed.
 * - **Stable ids.** Every drawing has one; agents never guess geometry.
 */

export type ChartPoint = {
  /** Epoch seconds. */
  time: number;
  /** Decimal string. */
  price: string;
};

export type DrawingStyle = {
  /** CSS colour. The host's palette, not ours. */
  color?: string;
  width?: number;
  dashed?: boolean;
  /** Fill for the shapes that have an interior. */
  fill?: string;
  opacity?: number;
};

type Base = {
  id: string;
  label?: string;
  style?: DrawingStyle;
  /** `false` hides it without deleting it — the drawing equivalent of a toggle. */
  visible?: boolean;
  /** Set by the surface, never by the drawing: who put it there. */
  createdBy?: "human" | "agent";
};

export type Drawing =
  /** Two points, drawn between them. */
  | (Base & { kind: "trendline"; from: ChartPoint; to: ChartPoint })
  /** Two points, extended past the second one forever. */
  | (Base & { kind: "ray"; from: ChartPoint; to: ChartPoint })
  /** A price level across the whole chart. */
  | (Base & { kind: "horizontal"; price: string })
  /** A time marker down the whole chart. */
  | (Base & { kind: "vertical"; time: number })
  /** A box. */
  | (Base & { kind: "rect"; from: ChartPoint; to: ChartPoint })
  /** Free text anchored to a point. */
  | (Base & { kind: "text"; at: ChartPoint; text: string })
  /**
   * Retracement levels between two points. The levels are the CALLER's — we
   * ship no default set, because "the usual Fibonacci levels" is a convention
   * with several versions and picking one is not our decision.
   */
  | (Base & { kind: "levels"; from: ChartPoint; to: ChartPoint; ratios: readonly number[] });

export type DrawingKind = Drawing["kind"];

/**
 * Markers the chart draws from live state rather than from user gestures:
 * working orders, position entries, alert levels.
 *
 * Separate from {@link Drawing} on purpose. A drawing belongs to the user and
 * persists; a marker belongs to the account and disappears when the order does.
 * Storing an order marker as a drawing is how a chart ends up showing a line
 * for an order that was cancelled an hour ago.
 */
export type ChartMarker =
  | {
      id: string;
      kind: "order";
      price: string;
      side: "buy" | "sell";
      qty: string;
      orderType: string;
      /** A requested price the venue has not confirmed. Drawn as a ghost. */
      pendingPrice?: string;
      label?: string;
    }
  | {
      id: string;
      kind: "position";
      price: string;
      /** Signed. */
      qty: string;
      avgPriceSource?: "service" | "calculated";
      label?: string;
    }
  | { id: string; kind: "alert"; price: string; label?: string }
  | { id: string; kind: "fill"; time: number; price: string; side: "buy" | "sell"; qty: string };

/** A band across a time range — a halt, a maintenance break, an event window. */
export type ChartBand = {
  id: string;
  /** Epoch seconds. */
  from: number;
  to: number;
  label: string;
  style?: DrawingStyle;
};

// ─── Controlled mutation helpers ─────────────────────────────────────────────

export function addDrawing(drawings: readonly Drawing[], drawing: Drawing): Drawing[] {
  return [...drawings, drawing];
}

export function removeDrawing(drawings: readonly Drawing[], id: string): Drawing[] {
  return drawings.filter((d) => d.id !== id);
}

export function updateDrawing(
  drawings: readonly Drawing[],
  id: string,
  patch: Partial<Drawing>,
): Drawing[] {
  return drawings.map((d) => (d.id === id ? ({ ...d, ...patch } as Drawing) : d));
}

/**
 * The prices a `levels` drawing resolves to, exactly.
 *
 * `ratios` are plain numbers because they are ratios rather than money; the
 * resulting PRICES are decimal strings, computed on the exact `from`/`to`
 * values rather than on a float round trip.
 */
export function resolveLevels(
  drawing: Extract<Drawing, { kind: "levels" }>,
  priceExp: number,
): { ratio: number; price: string }[] {
  const from = BigInt(Math.round(Number(drawing.from.price) * 10 ** priceExp));
  const to = BigInt(Math.round(Number(drawing.to.price) * 10 ** priceExp));
  const span = to - from;
  return drawing.ratios.map((ratio) => {
    const v = from + BigInt(Math.round(Number(span) * ratio));
    const negative = v < 0n;
    const abs = (negative ? -v : v).toString().padStart(priceExp + 1, "0");
    const whole = abs.slice(0, abs.length - priceExp);
    const frac = priceExp === 0 ? "" : `.${abs.slice(abs.length - priceExp)}`;
    return { ratio, price: `${negative ? "-" : ""}${whole}${frac}` };
  });
}

/** Everything a chart is currently showing, as one serialisable object. */
export type ChartOverlayState = {
  drawings: readonly Drawing[];
  markers: readonly ChartMarker[];
  bands: readonly ChartBand[];
};

export const EMPTY_OVERLAYS: ChartOverlayState = { drawings: [], markers: [], bands: [] };
