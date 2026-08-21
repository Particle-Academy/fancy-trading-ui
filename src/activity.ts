/**
 * Observable activity — every mutation on every surface in this package
 * broadcasts an `AutoActivityEvent`, so presence, undo and coaching layers
 * compose for free, exactly as elsewhere in the suite.
 *
 * `@particle-academy/fancy-auto-common` is an **optional peer** and is never
 * hard-imported, matching `fancy-diff`: the host injects an emitter, or
 * registers a global one, and emitting is a no-op if nothing is wired. That
 * keeps this package's runtime dependency count at zero.
 *
 * ```ts
 * import { emitActivity } from "@particle-academy/fancy-auto-common";
 * import { setTradingActivityEmitter } from "@particle-academy/fancy-trading-ui";
 * setTradingActivityEmitter(emitActivity);
 * ```
 *
 * Every event uses `target.kind = "trading"` so one filter subscribes to the
 * whole group; the specific surface is in `target.label` and `meta.surface`.
 */

/** The subset of fancy-auto-common's `AutoActivityEvent` we depend on. */
export interface TradingActivityEvent {
  agentId: string;
  agentName?: string;
  agentColor?: string;
  target: {
    kind: string;
    elementId?: string;
    label?: string;
    screenId?: string;
  };
  action: string;
  timestamp: number;
  meta?: Record<string, unknown>;
  source?: string;
}

export type TradingActivityEmitter = (event: TradingActivityEvent) => void;

let globalEmitter: TradingActivityEmitter | null = null;

/** Wire a global emitter once at app startup. Pass `null` to unwire. */
export function setTradingActivityEmitter(emitter: TradingActivityEmitter | null): void {
  globalEmitter = emitter;
}

/** Who did it. `source: "agent"` is stamped by the bridge, never by a caller. */
export interface TradingActor {
  /** `"human"` | `"agent"` | `"flow"`. Defaults to `"human"`. */
  source?: string;
  id?: string;
  name?: string;
  color?: string;
}

/** The surfaces in this package, as they appear in `meta.surface`. */
export type TradingSurface =
  | "ticket"
  | "ladder"
  | "book"
  | "depth"
  | "tape"
  | "blotter"
  | "positions"
  | "watchlist"
  | "alerts"
  | "chart";

export interface EmitTradingActivityArgs {
  /** Snake-case verb, e.g. `trading_order_submit`. */
  action: string;
  surface: TradingSurface;
  /** Stable handle of the element touched — an order id, a price level, a row. */
  elementId?: string;
  label?: string;
  screenId?: string;
  actor?: TradingActor;
  /** Per-instance emitter, taking precedence over the global one. */
  emitter?: TradingActivityEmitter | null;
  meta?: Record<string, unknown>;
}

/** Emit through the per-instance or global emitter. A no-op if neither exists. */
export function emitTradingActivity({
  action,
  surface,
  elementId,
  label,
  screenId,
  actor,
  emitter,
  meta,
}: EmitTradingActivityArgs): void {
  const sink = emitter ?? globalEmitter;
  if (!sink) return;
  const a = actor ?? {};
  sink({
    agentId: a.id ?? (a.source === "agent" ? "agent" : "human"),
    agentName: a.name,
    agentColor: a.color,
    target: {
      kind: "trading",
      elementId,
      label: label ?? `${surface}${elementId ? ` ${elementId}` : ""}`,
      screenId,
    },
    action,
    timestamp: Date.now(),
    source: a.source ?? "human",
    meta: { ...meta, surface, elementId },
  });
}

/**
 * The action verbs the surfaces emit. Listed rather than inlined so a consumer
 * filtering on them has one place to read, and so an agent bridge can enumerate
 * what it will see.
 */
export const TRADING_ACTIONS = {
  TicketChange: "trading_ticket_change",
  OrderPropose: "trading_order_propose",
  OrderSubmit: "trading_order_submit",
  OrderCancel: "trading_order_cancel",
  OrderReplace: "trading_order_replace",
  LadderClick: "trading_ladder_click",
  CancelAll: "trading_cancel_all",
  Flatten: "trading_flatten",
  Reverse: "trading_reverse",
  WatchlistAdd: "trading_watchlist_add",
  WatchlistRemove: "trading_watchlist_remove",
  AlertCreate: "trading_alert_create",
  AlertRemove: "trading_alert_remove",
  AlertToggle: "trading_alert_toggle",
  ChartDraw: "trading_chart_draw",
  ChartRemoveDrawing: "trading_chart_remove_drawing",
  ChartSetRange: "trading_chart_set_range",
  WarningSilence: "trading_warning_silence",
  WarningReEnable: "trading_warning_re_enable",
} as const;

export type TradingAction = (typeof TRADING_ACTIONS)[keyof typeof TRADING_ACTIONS];
