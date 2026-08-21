/**
 * `<TradingChart>` — the trading chart, on lightweight-charts, with no engine
 * abstraction (§1.10).
 *
 * What this component owns, and what makes it ours rather than a thin wrapper:
 * the session-aware axis, windowing, the drawing and overlay model, the Group A
 * primitives, and the agent bridge. The rasterisation is TradingView's, and it
 * lives behind `engine.ts` — one module, one seam.
 *
 * **Attribution.** `attributionLogo` defaults to `true` and is passed through.
 * Never set it `false` on a consumer's behalf: doing so transfers a licence
 * obligation to someone who never saw it. See `NOTICE` and the README for the
 * two ways to satisfy it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@particle-academy/react-fancy";
import { SurfaceChrome, Withheld } from "../chrome/SurfaceChrome.tsx";
import { LIVE, type Liveness, type TradingMode } from "../safety/mode.ts";
import type { Limitation } from "../safety/limited.ts";
import { TRADING_ACTIONS, emitTradingActivity, type TradingActivityEmitter } from "../activity.ts";
import { windowBars, type Bar } from "./bars.ts";
import {
  extendedRanges,
  haltRange,
  sessionBoundaryIndices,
  type Halt,
  type SessionCalendar,
} from "./sessions.ts";
import {
  EMPTY_OVERLAYS,
  type ChartBand,
  type ChartMarker,
  type ChartOverlayState,
  type Drawing,
} from "./drawings.ts";
import { depthHeatmap, volumeProfileFromBars, volumeProfileFromPrints } from "./profile.ts";
import type { DepthSnapshot, VolumeProfile } from "./profile.ts";
import {
  DARK_THEME,
  LIGHT_THEME,
  NO_DECORATIONS,
  createChartEngine,
  type ChartEngine,
  type ChartTheme,
  type SessionDecorations,
} from "./engine.ts";

/**
 * Resolve the options the engine is created with.
 *
 * Pulled out as a pure function so the ONE rule that must never regress is
 * testable without a canvas: `attributionLogo` is `true` unless a consumer
 * deliberately passed `false`, and no code path here can flip it.
 */
export function resolveChartOptions(props: {
  attributionLogo?: boolean;
  theme?: "light" | "dark" | ChartTheme;
  showVolume?: boolean;
}): { attributionLogo: boolean; theme: ChartTheme; showVolume: boolean } {
  return {
    // `?? true` and nothing else. Not `|| true`, which would ignore a
    // deliberate `false`; not a variable, which could be reassigned.
    attributionLogo: props.attributionLogo ?? true,
    theme:
      props.theme === undefined || props.theme === "light"
        ? LIGHT_THEME
        : props.theme === "dark"
          ? DARK_THEME
          : props.theme,
    showVolume: props.showVolume ?? true,
  };
}

/** Whether this environment can rasterise at all. False under SSR and in jsdom. */
export function canRenderCanvas(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

export type TradingChartProps = {
  mode: TradingMode;
  /** OHLCV, oldest first. Prices are decimal strings; times are epoch SECONDS. */
  bars: readonly Bar[];
  symbol: string;
  displaySymbol?: string;
  /** Bar interval in seconds — used for the live tick path. */
  intervalSeconds?: number;
  /**
   * How many bars to keep. §1.6 measured this: the cost of updating the forming
   * bar scales with what the series holds, so an unbounded series degrades
   * gradually until it drops frames.
   */
  maxBars?: number;
  /** Sessions, separators, extended-hours shading. Omit for a plain axis. */
  calendar?: SessionCalendar;
  /** Shade pre-market and after-hours. Defaults on when a calendar is given. */
  showExtendedHours?: boolean;
  /** Trading halts, drawn as annotated bands rather than a flat line. */
  halts?: readonly Halt[];
  /** Controlled drawings. */
  drawings?: readonly Drawing[];
  onDrawingsChange?: (drawings: Drawing[]) => void;
  /** Live markers: working orders, position, alerts, fills. */
  markers?: readonly ChartMarker[];
  /** Extra labelled bands — events, news windows. */
  bands?: readonly ChartBand[];
  /**
   * Volume profile. Pass prints for a measurement; pass nothing and set
   * `volumeProfileFromBars` to get a labelled reconstruction.
   */
  profilePrints?: readonly { price: string; size: string }[];
  approximateProfileFromBars?: boolean;
  profileBucketSize?: string;
  /** Depth-over-time heatmap snapshots — the Bookmap-style liquidity cloud. */
  depthSnapshots?: readonly DepthSnapshot[];
  priceExp?: number;
  qtyExp?: number;
  /**
   * TradingView's on-chart attribution. **Defaults to `true` and should stay
   * that way** unless you display the notice and a tradingview.com link on a
   * user-facing page yourself. See `NOTICE`.
   */
  attributionLogo?: boolean;
  theme?: "light" | "dark" | ChartTheme;
  showVolume?: boolean;
  liveness?: Liveness;
  limitations?: readonly Limitation[];
  activity?: TradingActivityEmitter | null;
  origin?: "human" | "agent";
  height?: number;
  className?: string;
  id?: string;
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  onCrosshair?: (point: { time: number | null; price: number | null }) => void;
};

export function TradingChart(props: TradingChartProps) {
  const {
    mode,
    bars,
    symbol,
    displaySymbol,
    maxBars = 5000,
    calendar,
    halts,
    drawings = EMPTY_OVERLAYS.drawings,
    markers = EMPTY_OVERLAYS.markers,
    bands = EMPTY_OVERLAYS.bands,
    profilePrints,
    approximateProfileFromBars,
    profileBucketSize,
    depthSnapshots,
    priceExp = 2,
    qtyExp = 0,
    liveness = LIVE,
    limitations,
    activity,
    origin = "human",
    height = 420,
    className,
    id,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const [renderable] = useState(canRenderCanvas);
  const [engineError, setEngineError] = useState<string | null>(null);

  const options = resolveChartOptions(props);
  const showExtended = props.showExtendedHours ?? Boolean(calendar);

  const windowed = useMemo(() => windowBars(bars, maxBars), [bars, maxBars]);
  const times = useMemo(() => windowed.map((b) => b.time), [windowed]);

  const decorations = useMemo<SessionDecorations>(() => {
    if (!calendar) return { ...NO_DECORATIONS, bands };
    const separators = sessionBoundaryIndices(times, calendar).map((i) => times[i]!);
    const extended = showExtended
      ? extendedRanges(times, calendar).map((r) => ({
          from: times[r.fromIndex]!,
          to: times[r.toIndex]!,
          phase: r.phase,
        }))
      : [];
    const haltBands: ChartBand[] = (halts ?? [])
      .map((halt, index) => {
        const range = haltRange(times, halt);
        if (!range) return null;
        return {
          id: `halt-${index}`,
          from: times[range.fromIndex]!,
          to: times[range.toIndex]!,
          // Never a flat line at the last price: that implies a market trading
          // flat, when in fact nothing traded at all (§2.7.4).
          label: halt.reason ? `HALTED — ${halt.reason}` : "HALTED",
        } satisfies ChartBand;
      })
      .filter((b): b is ChartBand => b !== null);
    return { separators, extended, bands: [...bands, ...haltBands] };
  }, [calendar, times, showExtended, halts, bands]);

  const profile = useMemo<VolumeProfile | null>(() => {
    const bucketSize = profileBucketSize;
    if (!bucketSize) return null;
    const scales = { priceExp, qtyExp, bucketSize };
    if (profilePrints) return volumeProfileFromPrints(profilePrints, scales);
    if (approximateProfileFromBars) return volumeProfileFromBars(windowed, scales);
    return null;
  }, [profilePrints, approximateProfileFromBars, profileBucketSize, priceExp, qtyExp, windowed]);

  const heatmap = useMemo(
    () =>
      depthSnapshots && profileBucketSize
        ? depthHeatmap(depthSnapshots, { priceExp, qtyExp, bucketSize: profileBucketSize })
        : null,
    [depthSnapshots, profileBucketSize, priceExp, qtyExp],
  );

  // Create once. Everything after is an imperative update, because re-creating
  // the chart on every prop change is exactly the render-the-world cost the
  // engine was chosen to avoid.
  useEffect(() => {
    if (!renderable || !containerRef.current) return;
    try {
      engineRef.current = createChartEngine({
        container: containerRef.current,
        attributionLogo: options.attributionLogo,
        theme: options.theme,
        showVolume: options.showVolume,
        onVisibleRangeChange: props.onVisibleRangeChange,
        onCrosshair: props.onCrosshair,
      });
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error));
      return;
    }
    const engine = engineRef.current;
    return () => {
      engine?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderable]);

  useEffect(() => {
    engineRef.current?.setBars(windowed);
  }, [windowed]);

  useEffect(() => {
    engineRef.current?.setDecorations(decorations);
  }, [decorations]);

  useEffect(() => {
    const state: ChartOverlayState = { drawings, markers, bands: decorations.bands };
    engineRef.current?.setOverlays(state);
  }, [drawings, markers, decorations]);

  useEffect(() => {
    engineRef.current?.setVolumeProfile(profile);
  }, [profile]);

  useEffect(() => {
    engineRef.current?.setHeatmap(heatmap);
  }, [heatmap]);

  useEffect(() => {
    engineRef.current?.setTheme(options.theme);
  }, [options.theme]);

  useEffect(() => {
    engineRef.current?.setAttributionLogo(options.attributionLogo);
  }, [options.attributionLogo]);

  const chartLimitations = useMemo<Limitation[]>(() => {
    const out = [...(limitations ?? [])];
    if (!renderable) {
      out.push({
        reason: "unsupported",
        withheld: "The price chart",
        detail:
          "this environment has no 2D canvas, so nothing can be rasterised here. Server-rendered output and test environments hit this; a browser does not.",
      });
    }
    if (engineError) {
      out.push({
        reason: "unsupported",
        withheld: "The price chart",
        detail: `the chart engine could not start: ${engineError}`,
      });
    }
    if (profile?.approximate) {
      out.push({
        reason: "unsupported",
        withheld: "A measured volume profile",
        detail:
          "this profile is reconstructed from OHLCV by spreading each bar's volume uniformly across its range. A measured profile needs trade prints.",
      });
    }
    if (bars.length > maxBars) {
      out.push({
        reason: "unsupported",
        withheld: `${bars.length - maxBars} older bar(s)`,
        detail: `the series is windowed to the most recent ${maxBars} bars, so updating the forming bar stays cheap.`,
        remedy: "Raise `maxBars` if you need more history on screen at once.",
      });
    }
    return out;
  }, [limitations, renderable, engineError, profile, bars.length, maxBars]);

  return (
    <SurfaceChrome
      surface="chart"
      mode={mode}
      liveness={liveness}
      limitations={chartLimitations}
      id={id}
      className={className}
      title={
        <span className="flex items-center gap-2">
          <span>{displaySymbol ?? symbol}</span>
          <Badge size="sm" color="zinc" variant="outline">
            {windowed.length} bars
          </Badge>
          {profile ? (
            <Badge
              data-fancy-trading-chart-profile={profile.approximate ? "approximate" : "measured"}
              size="sm"
              color={profile.approximate ? "amber" : "zinc"}
              variant="outline"
            >
              profile {profile.approximate ? "approximated" : "measured"}
            </Badge>
          ) : null}
        </span>
      }
      actions={
        <Button
          data-fancy-trading-chart-fit=""
          size="xs"
          variant="ghost"
          onClick={() => {
            engineRef.current?.fitContent();
            emitTradingActivity({
              action: TRADING_ACTIONS.ChartSetRange,
              surface: "chart",
              elementId: symbol,
              actor: { source: origin },
              emitter: activity,
              meta: { fit: true },
            });
          }}
        >
          Fit
        </Button>
      }
    >
      <div
        ref={containerRef}
        data-fancy-trading-chart={symbol}
        data-attribution-logo={options.attributionLogo ? "on" : "off"}
        data-bars={windowed.length}
        style={{ height }}
      />

      {!options.attributionLogo ? (
        <Withheld
          limitation={{
            reason: "unsupported",
            withheld: "TradingView's on-chart attribution",
            detail:
              "you disabled it, so YOU must display the attribution notice and a link to https://www.tradingview.com/ on a user-facing page. See this package's NOTICE file.",
          }}
          className="m-2"
        />
      ) : null}
    </SurfaceChrome>
  );
}
