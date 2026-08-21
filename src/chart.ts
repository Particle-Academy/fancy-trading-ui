/**
 * `@particle-academy/fancy-trading-ui/chart` — the trading chart.
 *
 * **This is the only entry point that touches `lightweight-charts`**, and it is
 * a separate entry point for exactly that reason: a consumer who installs this
 * package for an order ticket never loads a charting engine, and
 * `tests/packaging.test.ts` greps the built bundles to prove it.
 *
 * ## Attribution — read this before shipping
 *
 * `lightweight-charts` is Apache-2.0 **with an attribution obligation that
 * passes through to you**, and npm does not ship TradingView's NOTICE file. We
 * ship the text in ours. Satisfy it in one of two ways:
 *
 * 1. **Leave `attributionLogo` on.** It defaults to `true`. Doing nothing is
 *    the compliant path.
 * 2. **Or display the notice yourself** — the text in `NOTICE`, plus a link to
 *    <https://www.tradingview.com/> — on a user-facing page.
 *
 * Never pass `attributionLogo={false}` on a consumer's behalf.
 *
 * ## Installing
 *
 * ```sh
 * npm install lightweight-charts
 * ```
 *
 * It is an OPTIONAL peer dependency: nothing bundles it, and importing this
 * entry point without it installed is the only place that fails.
 */

export {
  TradingChart,
  canRenderCanvas,
  resolveChartOptions,
  type TradingChartProps,
} from "./chart/TradingChart.tsx";

export {
  applyTick,
  groupBySession,
  priceRange,
  windowBars,
  type ApplyTickResult,
  type Bar,
  type Tick,
} from "./chart/bars.ts";

export {
  CME_EQUITY_INDEX_EST,
  CRYPTO_24_7,
  US_EQUITIES_EST,
  extendedRanges,
  haltRange,
  localParts,
  phaseOf,
  sessionBoundaryIndices,
  sessionKey,
  sessionMinutes,
  sessionSegments,
  type BarPhase,
  type ExtendedRange,
  type Halt,
  type SessionCalendar,
  type SessionSegment,
  type SessionWindow,
} from "./chart/sessions.ts";

export {
  EMPTY_OVERLAYS,
  addDrawing,
  removeDrawing,
  resolveLevels,
  updateDrawing,
  type ChartBand,
  type ChartMarker,
  type ChartOverlayState,
  type ChartPoint,
  type Drawing,
  type DrawingKind,
  type DrawingStyle,
} from "./chart/drawings.ts";

export {
  depthHeatmap,
  volumeProfileFromBars,
  volumeProfileFromPrints,
  type DepthSnapshot,
  type Heatmap,
  type HeatmapCell,
  type ProfileBin,
  type ProfileScales,
  type VolumeProfile,
} from "./chart/profile.ts";

export {
  DARK_THEME,
  LIGHT_THEME,
  NO_DECORATIONS,
  createChartEngine,
  type ChartEngine,
  type ChartEngineOptions,
  type ChartTheme,
  type SessionDecorations,
} from "./chart/engine.ts";
