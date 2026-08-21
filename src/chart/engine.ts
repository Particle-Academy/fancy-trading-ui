/**
 * **The only file in this package that imports `lightweight-charts`.**
 *
 * That is the seam §1.10 promised, and it is deliberately a seam rather than an
 * abstraction:
 *
 * > An engine-agnostic `<Chart>` would have **exactly one real implementation**.
 * > … The renderer sits behind one internal module, so a consumer with a
 * > licensed TradingView Advanced Charts grant — or their own WebGL renderer —
 * > replaces that module. That is a documented seam, not a shipped adapter
 * > layer, and it costs nothing until someone needs it.
 *
 * `tests/chart-seam.test.ts` scans the source and fails if a second file
 * imports the engine, because the seam is only worth anything while it holds.
 *
 * Two other things happen here and nowhere else:
 *
 * - **Decimal strings become floats.** A canvas takes numbers; there is no way
 *   around that. Doing it in one place means nothing upstream of the pixels has
 *   quietly been through a double, and the order path never touches these
 *   values at all.
 * - **`attributionLogo` is passed through.** It defaults to `true` upstream and
 *   is never coerced. Silently disabling it transfers a licence obligation to a
 *   consumer who never saw it (see `NOTICE`).
 */

import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "./bars.ts";
import type { ChartBand, ChartMarker, ChartOverlayState, Drawing } from "./drawings.ts";
import type { Heatmap, VolumeProfile } from "./profile.ts";
import type { BarPhase } from "./sessions.ts";

/** Everything the chart decorates the axis with, expressed in epoch seconds. */
export type SessionDecorations = {
  /** Times at which a new session begins — one separator each. */
  separators: readonly number[];
  /** Non-core ranges to shade, so a trader knows which OHLC they are reading. */
  extended: readonly { from: number; to: number; phase: Exclude<BarPhase, "core"> }[];
  /** Halts and maintenance breaks, drawn as annotated bands, never as a flat line. */
  bands: readonly ChartBand[];
};

export const NO_DECORATIONS: SessionDecorations = { separators: [], extended: [], bands: [] };

/**
 * The canvas target a primitive draws onto.
 *
 * Derived from lightweight-charts' own interface rather than imported from
 * `fancy-canvas`. `fancy-canvas` is a TRANSITIVE dependency — importing it
 * directly would make it a direct one, which the third-party allowlist would
 * (correctly) fail, since nobody approved it on its own merits.
 */
type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/**
 * Which visual layer each session decoration is drawn on.
 *
 * The separator being on a DIFFERENT layer from the shading is a fix, not a
 * detail. Drawn in the same `bottom` layer, a dashed grey separator over an
 * extended-hours block is technically drawn and practically invisible — which
 * is exactly the failure §2.7.2 exists to prevent: *"do not collapse it
 * SILENTLY — session boundaries get a visible separator, because gaps across a
 * break carry information."*
 *
 * Found by looking at a real render in a browser, not by reading the code. The
 * test on this constant is the tripwire against it being moved back.
 */
export const DECORATION_LAYERS = {
  extendedHours: "bottom",
  haltBand: "bottom",
  sessionSeparator: "normal",
} as const;

export type ChartTheme = {
  background: string;
  text: string;
  grid: string;
  up: string;
  down: string;
  /** Shading for pre-market / after-hours / maintenance. */
  extended: string;
  separator: string;
  band: string;
  profile: string;
  heat: string;
};

export const LIGHT_THEME: ChartTheme = {
  background: "#ffffff",
  text: "#3f3f46",
  grid: "#e4e4e7",
  up: "#16a34a",
  down: "#dc2626",
  extended: "rgba(113,113,122,0.10)",
  separator: "rgba(63,63,70,0.85)",
  band: "rgba(217,119,6,0.18)",
  profile: "rgba(59,130,246,0.35)",
  heat: "59,130,246",
};

export const DARK_THEME: ChartTheme = {
  background: "#09090b",
  text: "#d4d4d8",
  grid: "#27272a",
  up: "#22c55e",
  down: "#ef4444",
  extended: "rgba(161,161,170,0.12)",
  separator: "rgba(212,212,216,0.85)",
  band: "rgba(245,158,11,0.20)",
  profile: "rgba(96,165,250,0.35)",
  heat: "96,165,250",
};

export type ChartEngineOptions = {
  container: HTMLElement;
  /**
   * TradingView's on-chart attribution. **Never pass `false` on a consumer's
   * behalf** — see `NOTICE`. It reaches here already resolved.
   */
  attributionLogo: boolean;
  theme: ChartTheme;
  showVolume: boolean;
  onVisibleRangeChange?: (range: { from: number; to: number } | null) => void;
  onCrosshair?: (point: { time: number | null; price: number | null }) => void;
};

export type ChartEngine = {
  setBars(bars: readonly Bar[]): void;
  /** The dominant live op. One bar in, one `series.update()` out (§1.5). */
  updateBar(bar: Bar): void;
  setOverlays(state: ChartOverlayState): void;
  setDecorations(decorations: SessionDecorations): void;
  setVolumeProfile(profile: VolumeProfile | null): void;
  setHeatmap(heatmap: Heatmap | null): void;
  setTheme(theme: ChartTheme): void;
  setAttributionLogo(on: boolean): void;
  fitContent(): void;
  resize(width: number, height: number): void;
  destroy(): void;
};

const toCandle = (bar: Bar): CandlestickData<Time> => ({
  time: bar.time as UTCTimestamp,
  open: Number(bar.open),
  high: Number(bar.high),
  low: Number(bar.low),
  close: Number(bar.close),
});

/** Create the chart. Throws in an environment with no 2D canvas — see the component. */
export function createChartEngine(options: ChartEngineOptions): ChartEngine {
  let theme = options.theme;

  const chart: IChartApi = createChart(options.container, {
    layout: {
      background: { color: theme.background },
      textColor: theme.text,
      // Passed straight through. The default upstream is `true`.
      attributionLogo: options.attributionLogo,
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid },
    },
    timeScale: {
      // An ORDINAL, session-aware axis: non-session time is collapsed rather
      // than drawn as a flat line across a weekend (§2.7.1).
      timeVisible: true,
      secondsVisible: false,
      borderColor: theme.grid,
    },
    rightPriceScale: { borderColor: theme.grid },
    autoSize: true,
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: theme.up,
    downColor: theme.down,
    borderUpColor: theme.up,
    borderDownColor: theme.down,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
  });

  let volume: ISeriesApi<"Histogram"> | null = null;
  if (options.showVolume) {
    volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, priceScaleId: "" },
      1,
    );
  }

  const decorations = new DecorationsPrimitive(() => theme);
  const overlays = new OverlayPrimitive(() => theme);
  const markers = new MarkersPrimitive(() => theme);
  const profile = new ProfilePrimitive(() => theme);
  const heatmap = new HeatmapPrimitive(() => theme);

  for (const primitive of [heatmap, decorations, profile, overlays, markers]) {
    candles.attachPrimitive(primitive as ISeriesPrimitive<Time>);
  }

  if (options.onVisibleRangeChange) {
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      options.onVisibleRangeChange?.(
        range ? { from: Number(range.from), to: Number(range.to) } : null,
      );
    });
  }

  if (options.onCrosshair) {
    chart.subscribeCrosshairMove((param) => {
      const price = param.seriesData.get(candles) as { close?: number } | undefined;
      options.onCrosshair?.({
        time: param.time === undefined ? null : Number(param.time),
        price: price?.close ?? null,
      });
    });
  }

  return {
    setBars(bars) {
      candles.setData(bars.map(toCandle));
      volume?.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: Number(b.volume ?? "0"),
          color: Number(b.close) >= Number(b.open) ? theme.up : theme.down,
        })),
      );
    },
    updateBar(bar) {
      candles.update(toCandle(bar));
      volume?.update({
        time: bar.time as UTCTimestamp,
        value: Number(bar.volume ?? "0"),
        color: Number(bar.close) >= Number(bar.open) ? theme.up : theme.down,
      });
    },
    setOverlays(state) {
      overlays.setDrawings(state.drawings);
      markers.setMarkers(state.markers);
      decorations.setBands([...decorations.bands, ...state.bands]);
    },
    setDecorations(next) {
      decorations.set(next);
    },
    setVolumeProfile(next) {
      profile.set(next);
    },
    setHeatmap(next) {
      heatmap.set(next);
    },
    setTheme(next) {
      theme = next;
      chart.applyOptions({
        layout: { background: { color: next.background }, textColor: next.text },
        grid: { vertLines: { color: next.grid }, horzLines: { color: next.grid } },
      });
      candles.applyOptions({
        upColor: next.up,
        downColor: next.down,
        borderUpColor: next.up,
        borderDownColor: next.down,
        wickUpColor: next.up,
        wickDownColor: next.down,
      });
    },
    setAttributionLogo(on) {
      chart.applyOptions({ layout: { attributionLogo: on } });
    },
    fitContent() {
      chart.timeScale().fitContent();
    },
    resize(width, height) {
      chart.resize(width, height);
    },
    destroy() {
      chart.remove();
    },
  };
}

// ─── Primitives ──────────────────────────────────────────────────────────────
//
// Group A lives here: surfaces that MUST share the chart's coordinate space.
// Each reads `priceToCoordinate` / `timeToCoordinate` from the same scales the
// candles are drawn from, which is why alignment holds exactly under zoom
// rather than approximately (§1.10 measured the round-trip drift at zero).

type Ctx = {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick", Time>;
  requestUpdate: () => void;
};

abstract class Primitive implements ISeriesPrimitive<Time> {
  protected ctx: Ctx | null = null;
  protected readonly view: IPrimitivePaneView;

  constructor(
    protected readonly getTheme: () => ChartTheme,
    zOrder: "bottom" | "normal" | "top",
  ) {
    this.view = this.makeView(zOrder, (target) => this.draw(target));
  }

  /**
   * A pane view at one z-order. Exposed so a primitive can publish MORE than
   * one — the session decorations need to, because shading belongs behind the
   * candles and a separator drawn behind the shading is invisible.
   */
  protected makeView(
    zOrder: "bottom" | "normal" | "top",
    draw: (target: RenderTarget) => void,
  ): IPrimitivePaneView {
    return {
      zOrder: () => zOrder,
      renderer: (): IPrimitivePaneRenderer => ({ draw }),
    };
  }

  attached(param: SeriesAttachedParameter<Time, "Candlestick">): void {
    this.ctx = {
      chart: param.chart,
      series: param.series as ISeriesApi<"Candlestick", Time>,
      requestUpdate: param.requestUpdate,
    };
  }

  detached(): void {
    this.ctx = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  protected x(time: number): number | null {
    const c = this.ctx?.chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    return c === null || c === undefined ? null : Number(c);
  }

  protected y(price: string | number): number | null {
    const c = this.ctx?.series.priceToCoordinate(Number(price));
    return c === null || c === undefined ? null : Number(c);
  }

  protected redraw(): void {
    this.ctx?.requestUpdate();
  }

  protected abstract draw(target: RenderTarget): void;
}

/**
 * Session separators, extended-hours shading and halt bands.
 *
 * Drawn at `bottom` so candles sit on top of the shading rather than under it.
 * A halt is a labelled band across the gap — never a horizontal line at the
 * last price, which would imply a market trading flat (§2.7.4).
 */
class DecorationsPrimitive extends Primitive {
  private decorations: SessionDecorations = NO_DECORATIONS;
  private readonly separatorView: IPrimitivePaneView;

  constructor(getTheme: () => ChartTheme) {
    super(getTheme, DECORATION_LAYERS.extendedHours);
    // Separators sit ABOVE the shading. Drawn in the same bottom layer they
    // were invisible against an extended-hours block, which is the exact
    // failure the rule exists to prevent: "do not collapse non-session time
    // SILENTLY" (section 2.7.2). Found by looking at a real render, not by
    // reading the code.
    this.separatorView = this.makeView(DECORATION_LAYERS.sessionSeparator, (target) =>
      this.drawSeparators(target),
    );
  }

  override paneViews(): readonly IPrimitivePaneView[] {
    return [this.view, this.separatorView];
  }

  get bands(): readonly ChartBand[] {
    return this.decorations.bands;
  }

  set(next: SessionDecorations): void {
    this.decorations = next;
    this.redraw();
  }

  setBands(bands: readonly ChartBand[]): void {
    this.decorations = { ...this.decorations, bands };
    this.redraw();
  }

  protected draw(target: RenderTarget): void {
    const theme = this.getTheme();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      for (const range of this.decorations.extended) {
        const x1 = this.x(range.from);
        const x2 = this.x(range.to);
        if (x1 === null || x2 === null) continue;
        context.fillStyle = theme.extended;
        context.fillRect(x1, 0, Math.max(1, x2 - x1), mediaSize.height);
      }

      for (const band of this.decorations.bands) {
        const x1 = this.x(band.from);
        const x2 = this.x(band.to);
        if (x1 === null || x2 === null) continue;
        context.fillStyle = band.style?.fill ?? theme.band;
        context.fillRect(x1, 0, Math.max(2, x2 - x1), mediaSize.height);
        context.fillStyle = theme.text;
        context.font = "11px sans-serif";
        context.fillText(band.label, x1 + 4, 14);
      }

    });
  }

  /**
   * The session separator, on its own layer.
   *
   * Two strokes: a light halo and the line itself, so it reads against both the
   * page background and an extended-hours block. A single grey dash on grey
   * shading is technically drawn and practically absent.
   */
  private drawSeparators(target: RenderTarget): void {
    if (this.decorations.separators.length === 0) return;
    const theme = this.getTheme();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      for (const time of this.decorations.separators) {
        const x = this.x(time);
        if (x === null) continue;

        context.save();
        context.strokeStyle = theme.background;
        context.globalAlpha = 0.9;
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, mediaSize.height);
        context.stroke();

        context.globalAlpha = 1;
        context.strokeStyle = theme.separator;
        context.lineWidth = 1;
        context.setLineDash([4, 3]);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, mediaSize.height);
        context.stroke();
        context.restore();
      }
    });
  }
}

/** User drawings. `normal` z-order: above the shading, below the markers. */
class OverlayPrimitive extends Primitive {
  private drawings: readonly Drawing[] = [];

  constructor(getTheme: () => ChartTheme) {
    super(getTheme, "normal");
  }

  setDrawings(drawings: readonly Drawing[]): void {
    this.drawings = drawings;
    this.redraw();
  }

  protected draw(target: RenderTarget): void {
    const theme = this.getTheme();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      for (const d of this.drawings) {
        if (d.visible === false) continue;
        context.save();
        context.strokeStyle = d.style?.color ?? theme.text;
        context.lineWidth = d.style?.width ?? 1;
        context.globalAlpha = d.style?.opacity ?? 1;
        if (d.style?.dashed) context.setLineDash([4, 4]);

        switch (d.kind) {
          case "horizontal": {
            const y = this.y(d.price);
            if (y !== null) line(context, 0, y, mediaSize.width, y);
            if (y !== null && d.label) label(context, theme, d.label, 4, y - 4);
            break;
          }
          case "vertical": {
            const x = this.x(d.time);
            if (x !== null) line(context, x, 0, x, mediaSize.height);
            if (x !== null && d.label) label(context, theme, d.label, x + 4, 14);
            break;
          }
          case "trendline":
          case "ray": {
            const x1 = this.x(d.from.time);
            const y1 = this.y(d.from.price);
            const x2 = this.x(d.to.time);
            const y2 = this.y(d.to.price);
            if (x1 === null || y1 === null || x2 === null || y2 === null) break;
            if (d.kind === "trendline") line(context, x1, y1, x2, y2);
            else {
              // Extend past the second point to the edge of the pane.
              const dx = x2 - x1;
              const dy = y2 - y1;
              const scale = dx === 0 ? mediaSize.height : (mediaSize.width - x1) / dx;
              line(context, x1, y1, x1 + dx * scale, y1 + dy * scale);
            }
            break;
          }
          case "rect": {
            const x1 = this.x(d.from.time);
            const y1 = this.y(d.from.price);
            const x2 = this.x(d.to.time);
            const y2 = this.y(d.to.price);
            if (x1 === null || y1 === null || x2 === null || y2 === null) break;
            if (d.style?.fill) {
              context.fillStyle = d.style.fill;
              context.fillRect(x1, y1, x2 - x1, y2 - y1);
            }
            context.strokeRect(x1, y1, x2 - x1, y2 - y1);
            break;
          }
          case "text": {
            const x = this.x(d.at.time);
            const y = this.y(d.at.price);
            if (x !== null && y !== null) label(context, theme, d.text, x, y);
            break;
          }
          case "levels": {
            const x1 = this.x(d.from.time);
            const x2 = this.x(d.to.time);
            const from = Number(d.from.price);
            const to = Number(d.to.price);
            if (x1 === null || x2 === null) break;
            for (const ratio of d.ratios) {
              const y = this.y(from + (to - from) * ratio);
              if (y === null) continue;
              line(context, Math.min(x1, x2), y, mediaSize.width, y);
              label(context, theme, `${(ratio * 100).toFixed(1)}%`, Math.min(x1, x2) + 4, y - 3);
            }
            break;
          }
        }
        context.restore();
      }
    });
  }
}

/**
 * Order, position, alert and fill markers.
 *
 * `top` z-order, because these are the things a trader most needs to see and
 * they are worthless behind a candle. A pending replace draws as a dashed ghost
 * at the requested price with the solid marker still at the CONFIRMED one —
 * the same rule the ladder follows, for the same reason (§2.5).
 */
class MarkersPrimitive extends Primitive {
  private markers: readonly ChartMarker[] = [];

  constructor(getTheme: () => ChartTheme) {
    super(getTheme, "top");
  }

  setMarkers(markers: readonly ChartMarker[]): void {
    this.markers = markers;
    this.redraw();
  }

  protected draw(target: RenderTarget): void {
    const theme = this.getTheme();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      for (const m of this.markers) {
        context.save();
        switch (m.kind) {
          case "order": {
            const y = this.y(m.price);
            if (y === null) break;
            context.strokeStyle = m.side === "buy" ? theme.up : theme.down;
            context.lineWidth = 1;
            line(context, 0, y, mediaSize.width, y);
            label(
              context,
              theme,
              m.label ?? `${m.side === "buy" ? "B" : "S"} ${m.qty} ${m.orderType}`,
              4,
              y - 4,
            );
            if (m.pendingPrice) {
              const py = this.y(m.pendingPrice);
              if (py !== null) {
                context.setLineDash([4, 4]);
                context.globalAlpha = 0.6;
                line(context, 0, py, mediaSize.width, py);
                label(context, theme, "requested, not confirmed", 4, py - 4);
              }
            }
            break;
          }
          case "position": {
            const y = this.y(m.price);
            if (y === null) break;
            context.strokeStyle = theme.text;
            context.setLineDash([2, 2]);
            line(context, 0, y, mediaSize.width, y);
            label(
              context,
              theme,
              m.label ??
                `position ${m.qty} @ ${m.price}${m.avgPriceSource === "calculated" ? " (calc)" : ""}`,
              4,
              y - 4,
            );
            break;
          }
          case "alert": {
            const y = this.y(m.price);
            if (y === null) break;
            context.strokeStyle = theme.text;
            context.setLineDash([1, 3]);
            line(context, 0, y, mediaSize.width, y);
            label(context, theme, m.label ?? `alert ${m.price}`, 4, y - 4);
            break;
          }
          case "fill": {
            const x = this.x(m.time);
            const y = this.y(m.price);
            if (x === null || y === null) break;
            context.fillStyle = m.side === "buy" ? theme.up : theme.down;
            context.beginPath();
            context.arc(x, y, 3, 0, Math.PI * 2);
            context.fill();
            break;
          }
        }
        context.restore();
      }
    });
  }
}

/**
 * Volume profile — Group A, price-axis aligned.
 *
 * Horizontal bars locked to the price scale, drawn inward from the right edge.
 * The point of control gets a brighter bar; an APPROXIMATE profile (one
 * reconstructed from OHLCV rather than measured from prints) is drawn hatched
 * and labelled, because a reconstruction that looks like a measurement is the
 * tape's inferred-aggressor problem again.
 */
class ProfilePrimitive extends Primitive {
  private profile: VolumeProfile | null = null;

  constructor(getTheme: () => ChartTheme) {
    super(getTheme, "normal");
  }

  set(profile: VolumeProfile | null): void {
    this.profile = profile;
    this.redraw();
  }

  protected draw(target: RenderTarget): void {
    const profile = this.profile;
    if (!profile || profile.bins.length === 0) return;
    const theme = this.getTheme();

    const max = profile.bins.reduce((m, b) => Math.max(m, Number(b.volume)), 0);
    if (max === 0) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const width = mediaSize.width * 0.22;
      context.save();
      context.globalAlpha = profile.approximate ? 0.5 : 0.8;

      for (const bin of profile.bins) {
        const y = this.y(bin.price);
        if (y === null) continue;
        const w = (Number(bin.volume) / max) * width;
        context.fillStyle =
          profile.pointOfControl === bin.price ? theme.separator : theme.profile;
        context.fillRect(mediaSize.width - w, y - 1, w, 3);
      }

      if (profile.approximate) {
        context.globalAlpha = 1;
        label(
          context,
          theme,
          "profile approximated from bars, not measured from prints",
          mediaSize.width - width,
          mediaSize.height - 6,
        );
      }
      context.restore();
    });
  }
}

/** Depth-over-time heatmap — Group A on BOTH axes. Bookmap's liquidity cloud. */
class HeatmapPrimitive extends Primitive {
  private heatmap: Heatmap | null = null;

  constructor(getTheme: () => ChartTheme) {
    super(getTheme, "bottom");
  }

  set(heatmap: Heatmap | null): void {
    this.heatmap = heatmap;
    this.redraw();
  }

  protected draw(target: RenderTarget): void {
    const heatmap = this.heatmap;
    if (!heatmap || heatmap.cells.length === 0) return;
    const theme = this.getTheme();

    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      for (const cell of heatmap.cells) {
        const x = this.x(cell.time);
        const y = this.y(cell.price);
        if (x === null || y === null) continue;
        context.fillStyle = `rgba(${theme.heat},${(cell.intensity * 0.7).toFixed(3)})`;
        context.fillRect(x - 2, y - 1, 4, 3);
      }
      context.restore();
    });
  }
}

function line(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function label(
  context: CanvasRenderingContext2D,
  theme: ChartTheme,
  text: string,
  x: number,
  y: number,
): void {
  context.font = "11px sans-serif";
  context.fillStyle = theme.text;
  context.fillText(text, x, y);
}
