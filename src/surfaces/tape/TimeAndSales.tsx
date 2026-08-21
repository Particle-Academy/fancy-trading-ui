/**
 * `<TimeAndSales>` — the tape.
 *
 * The finding that shapes this component, verbatim from §2.3:
 *
 * > Aggressor side is **provided natively by futures and crypto venues and is
 * > NOT provided by the US equities SIP.** For equities it must be *inferred*
 * > (quote rule, tick test, Lee-Ready) and inference is wrong a meaningful
 * > fraction of the time… **A tape that presents inferred sides as fact is
 * > lying to the trader.**
 *
 * So every print carries `aggressor` AND `aggressorSource`, an inferred print
 * renders visibly differently from a reported one, and the cumulative delta
 * says how much of itself rests on inference. That last part is not decoration:
 * a delta built mostly from guesses is a different number from one built from
 * venue-reported sides, and nothing else on screen would tell you which you
 * have.
 */

import { useMemo } from "react";
import { formatDecimal, parseDecimal, add, sub } from "@particle-academy/fancy-trading";
import { Badge, Table } from "@particle-academy/react-fancy";
import { SurfaceChrome, Withheld } from "../../chrome/SurfaceChrome.tsx";
import type { Limitation } from "../../safety/limited.ts";
import { LIVE, type Liveness, type TradingMode } from "../../safety/mode.ts";
import { encodeSide, type DirectionPalette } from "../../direction.ts";
import { formatPrice } from "../../format.ts";
import type { TicketInstrument } from "../ticket/types.ts";

/** Where the aggressor side came from. Never omitted, never assumed. */
export type AggressorSource = "venue" | "inferred";

export type TapePrint = {
  id: string;
  /**
   * Epoch **milliseconds at minimum**; futures want microseconds, so this is a
   * number of ms and `microseconds` carries the sub-ms remainder when a venue
   * provides it.
   */
  at: number;
  /** Sub-millisecond remainder, 0-999. Futures venues provide it; equities do not. */
  microseconds?: number;
  price: string;
  size: string;
  venue?: string;
  /** Top of book at the moment of the print, for the quote rule. */
  bidAtPrint?: string;
  askAtPrint?: string;
  /**
   * Which side crossed the spread. A print at the ask means a buyer lifted the
   * offer. `"unknown"` is a real and common answer — it is not a bug to be
   * papered over with a guess.
   */
  aggressor: "buy" | "sell" | "unknown";
  /**
   * REQUIRED. There is no default, because the whole point is that a reported
   * side and an inferred side are different claims.
   */
  aggressorSource: AggressorSource;
  /** Venue condition codes, verbatim. */
  conditions?: readonly string[];
};

export type TapeDelta = {
  /** Buy-aggressor size minus sell-aggressor size. */
  delta: string;
  /** How many prints contributed. */
  prints: number;
  /** How many of those had an INFERRED aggressor. */
  inferredPrints: number;
  /** How much of the absolute contributing volume was inferred. */
  inferredVolume: string;
};

/**
 * Cumulative delta, with its provenance attached.
 *
 * A delta of +1,200 built from venue-reported sides and a delta of +1,200 built
 * from the tick test are not the same number, and a component that renders them
 * identically has thrown away the difference.
 */
export function cumulativeDelta(prints: readonly TapePrint[], qtyExp: number): TapeDelta {
  let delta = parseDecimal("0", qtyExp);
  let inferredVolume = parseDecimal("0", qtyExp);
  let inferredPrints = 0;

  for (const p of prints) {
    if (p.aggressor === "unknown") continue;
    const size = parseDecimal(p.size, qtyExp);
    delta = p.aggressor === "buy" ? add(delta, size) : sub(delta, size);
    if (p.aggressorSource === "inferred") {
      inferredPrints += 1;
      inferredVolume = add(inferredVolume, size);
    }
  }

  return {
    delta: formatDecimal(delta),
    prints: prints.filter((p) => p.aggressor !== "unknown").length,
    inferredPrints,
    inferredVolume: formatDecimal(inferredVolume),
  };
}

export type TimeAndSalesProps = {
  mode: TradingMode;
  instrument: TicketInstrument;
  /** Newest first. */
  prints: readonly TapePrint[];
  liveness?: Liveness;
  limitations?: readonly Limitation[];
  /** Show the microsecond column. Defaults to on when any print has one. */
  microseconds?: boolean;
  palette?: DirectionPalette;
  maxRows?: number;
  className?: string;
  id?: string;
};

export function TimeAndSales({
  mode,
  instrument,
  prints,
  liveness = LIVE,
  limitations,
  microseconds,
  palette,
  maxRows = 200,
  className,
  id,
}: TimeAndSalesProps) {
  const rows = prints.slice(0, maxRows);
  const delta = useMemo(() => cumulativeDelta(rows, instrument.qtyExp), [rows, instrument.qtyExp]);
  const showMicros = microseconds ?? rows.some((p) => p.microseconds !== undefined);

  const buy = encodeSide("buy", palette);
  const sell = encodeSide("sell", palette);

  return (
    <SurfaceChrome
      surface="tape"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title={
        <span className="flex items-center gap-2">
          <span>{instrument.displaySymbol ?? instrument.symbol}</span>
          <Badge
            data-fancy-trading-tape-delta={delta.delta}
            size="sm"
            color="zinc"
            variant="outline"
            title={
              delta.inferredPrints > 0
                ? `${delta.inferredPrints} of ${delta.prints} prints had an INFERRED aggressor side (${delta.inferredVolume} of the volume). This delta is partly a guess.`
                : `All ${delta.prints} prints had a venue-reported aggressor side.`
            }
          >
            delta {delta.delta}
            {delta.inferredPrints > 0 ? " *" : ""}
          </Badge>
        </span>
      }
    >
      {rows.length === 0 ? (
        <Withheld
          limitation={{
            reason: "unsupported",
            withheld: "Prints",
            detail: "no trades have arrived on this session yet.",
          }}
          className="p-2"
        />
      ) : (
        <Table data-fancy-trading-tape={instrument.symbol} className="text-xs tabular-nums">
          <Table.Head>
            <Table.Row>
              {["time", "price", "size", "aggressor", "venue", "cond"].map((c) => (
                <Table.Column key={c} scope="col" className="px-1 py-0.5 text-xs" label={c} />
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((p) => {
              const enc = p.aggressor === "buy" ? buy : p.aggressor === "sell" ? sell : null;
              const inferred = p.aggressorSource === "inferred";
              return (
                <Table.Row
                  key={p.id}
                  data-fancy-trading-tape-print={p.id}
                  data-aggressor={p.aggressor}
                  data-aggressor-source={p.aggressorSource}
                  className={inferred ? "opacity-70 [font-style:italic]" : undefined}
                >
                  <Table.Cell className="px-1 py-0.5 text-xs">
                    {new Date(p.at).toISOString().slice(11, 23)}
                    {showMicros ? (
                      <span
                        data-fancy-trading-tape-micros=""
                        className="text-secondary-400"
                      >
                        {String(p.microseconds ?? 0).padStart(3, "0")}
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="px-1 py-0.5 text-right text-xs">
                    {formatPrice(parseDecimal(p.price, instrument.priceExp), instrument.priceDisplay)}
                  </Table.Cell>
                  <Table.Cell className="px-1 py-0.5 text-right text-xs">{p.size}</Table.Cell>
                  <Table.Cell
                    className={`px-1 py-0.5 text-xs ${enc?.className ?? "text-secondary-500"}`}
                    title={
                      p.aggressor === "unknown"
                        ? "The aggressor side is not known for this print, and has not been guessed."
                        : inferred
                          ? "INFERRED from the quote at the time of the print. Inference is wrong a meaningful fraction of the time."
                          : "Reported by the venue."
                    }
                  >
                    {p.aggressor === "unknown" ? (
                      "? unknown"
                    ) : (
                      <>
                        {enc?.glyph} {p.aggressor}
                        {inferred ? " (inferred)" : ""}
                      </>
                    )}
                  </Table.Cell>
                  <Table.Cell className="px-1 py-0.5 text-xs text-secondary-500">{p.venue ?? ""}</Table.Cell>
                  <Table.Cell className="px-1 py-0.5 text-xs text-secondary-500">{(p.conditions ?? []).join(" ")}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {delta.inferredPrints > 0 ? (
        <p data-fancy-trading-tape-inference-note="" className="px-2 py-1 text-[0.6875rem] text-secondary-500">
          {delta.inferredPrints} of {delta.prints} prints have an <strong>inferred</strong> aggressor
          side, covering {delta.inferredVolume} of the volume. Inferred sides are shown in italics.
          The US equities SIP does not report the aggressor, so for equities this is a
          reconstruction, not a fact.
        </p>
      ) : null}
    </SurfaceChrome>
  );
}
