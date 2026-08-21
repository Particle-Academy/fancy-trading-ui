/**
 * `@particle-academy/fancy-trading-ui` — trading surfaces for the Fancy UI
 * suite.
 *
 * **`lightweight-charts` appears nowhere in this entry point's graph.** The
 * chart lives on `@particle-academy/fancy-trading-ui/chart`, so a consumer who
 * installs this package for an order ticket never loads a charting engine.
 * `tests/packaging.test.ts` greps the built bundle to prove it, and
 * `tests/chart.test.tsx` proves the source never re-introduces it.
 *
 * The safety floor is re-exported here for convenience and also lives on
 * `/safety`, React-free, so a Node backend can run the same checks the UI runs.
 *
 * ```tsx
 * import { OrderTicket, PriceLadder } from "@particle-academy/fancy-trading-ui";
 * import { TradingChart } from "@particle-academy/fancy-trading-ui/chart";
 * import { checkLimits } from "@particle-academy/fancy-trading-ui/safety";
 * import "@particle-academy/fancy-trading-ui/styles.css";
 * ```
 */

// ─── The safety floor (also on /safety, without React) ───────────────────────
export * from "./safety.ts";

// ─── Shared substrate ────────────────────────────────────────────────────────
export {
  TRADING_ACTIONS,
  emitTradingActivity,
  setTradingActivityEmitter,
  type EmitTradingActivityArgs,
  type TradingAction,
  type TradingActivityEmitter,
  type TradingActivityEvent,
  type TradingActor,
  type TradingSurface,
} from "./activity.ts";

export {
  formatMoney,
  formatPrice,
  formatQty,
  formatSignedMoney,
  parsePrice,
  type PriceDisplay,
} from "./format.ts";

export {
  directionOf,
  encodeDirection,
  encodeSide,
  type Direction,
  type DirectionEncoding,
  type DirectionPalette,
  type SideEncoding,
} from "./direction.ts";

// ─── Chrome ──────────────────────────────────────────────────────────────────
export {
  SurfaceChrome,
  Withheld,
  type SurfaceChromeProps,
  type WithheldProps,
} from "./chrome/SurfaceChrome.tsx";

export { ModeMarker, type ModeMarkerProps } from "./chrome/ModeMarker.tsx";

export {
  ConfirmAggregate,
  WarningConsole,
  WarningNotice,
  needsConfirmation,
  type AggregateAction,
  type ConfirmAggregateProps,
  type ConfirmSettings,
  type WarningConsoleProps,
  type WarningNoticeProps,
} from "./chrome/Confirm.tsx";

// ─── Order ticket ────────────────────────────────────────────────────────────
export { OrderTicket, type OrderTicketProps, type SubmitExtras } from "./surfaces/ticket/OrderTicket.tsx";

export {
  approveIntent,
  attemptSubmit,
  buildIntent,
  useApprovalGate,
  useOrderTicket,
  type SubmitOutcome,
  type TicketMarketContext,
  type TicketWarning,
  type UseOrderTicketArgs,
  type UseOrderTicketResult,
} from "./surfaces/ticket/useOrderTicket.ts";

export type {
  AttachedOrders,
  OrderType,
  Side,
  TicketEstimate,
  TicketInstrument,
  TicketValue,
  TimeInForce,
} from "./surfaces/ticket/types.ts";

// ─── Ladder ──────────────────────────────────────────────────────────────────
export { PriceLadder, type PriceLadderProps } from "./surfaces/ladder/PriceLadder.tsx";
export {
  JOIN_THE_BOOK_CLICK_MAP,
  NO_CLICK_MAP,
  SIERRA_CLICK_MAP,
  complement,
  isMirrored,
  projectRows,
  resolveClick,
  toVenueIntent,
  type LadderClickAction,
  type LadderClickMap,
  type LadderColumn,
  type LadderGesture,
  type LadderIntent,
  type LadderPosition,
  type LadderRow,
  type LadderWorkingOrder,
  type ProjectedRow,
} from "./surfaces/ladder/ladder.ts";

// ─── Book + depth ────────────────────────────────────────────────────────────
export {
  DepthChart,
  OrderBook,
  completenessLimitation,
  type DepthChartProps,
  type OrderBookProps,
} from "./surfaces/book/OrderBook.tsx";
export {
  EMPTY_BOOK,
  bookLiveness,
  cumulativeDepth,
  marketImpact,
  type BookCompleteness,
  type BookLevel,
  type BookState,
  type BookSyncState,
  type DepthPoint,
  type ImpactResult,
} from "./surfaces/book/book.ts";

// ─── Tape ────────────────────────────────────────────────────────────────────
export {
  TimeAndSales,
  cumulativeDelta,
  type AggressorSource,
  type TapeDelta,
  type TapePrint,
  type TimeAndSalesProps,
} from "./surfaces/tape/TimeAndSales.tsx";

// ─── Blotter, positions ──────────────────────────────────────────────────────
export {
  Blotter,
  FillsTable,
  OrdersTable,
  PositionsTable,
  type BlotterProps,
  type FillsTableProps,
  type OrdersTableProps,
  type PositionsTableProps,
} from "./surfaces/blotter/Blotter.tsx";
export {
  CUSHION_LABEL,
  presentOrder,
  reconcileFills,
  roundTrips,
  type BlotterFill,
  type BlotterOrder,
  type BlotterPosition,
  type FillExecType,
  type FillRow,
  type MarginCushion,
  type OrderHeldBy,
  type OrderPresentation,
  type PresentedOrder,
  type RoundTrip,
} from "./surfaces/blotter/model.ts";

// ─── Watchlist, alerts ───────────────────────────────────────────────────────
export { WatchList, type WatchListProps, type WatchRow } from "./surfaces/watchlist/WatchList.tsx";
export {
  Alerts,
  evaluateAlert,
  type Alert,
  type AlertField,
  type AlertObservation,
  type AlertOperator,
  type AlertsProps,
} from "./surfaces/alerts/Alerts.tsx";

// ─── Agent bridge contract ───────────────────────────────────────────────────
export * from "./bridge.ts";
