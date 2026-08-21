/**
 * `<WatchList>` — a list of symbols the user chose, with the numbers the venue
 * reported.
 *
 * Note what a watchlist is NOT, because this is where a trading kit most easily
 * drifts across the line in §3.2: it is not a screener, it does not rank, it
 * does not surface "movers to watch", and it holds no field this package fills
 * in with an opinion. Sorting is the user's; the data is the venue's.
 */

import { useState } from "react";
import { Button, Input, Table } from "@particle-academy/react-fancy";
import { parseDecimal } from "@particle-academy/fancy-trading";
import { SurfaceChrome, Withheld } from "../../chrome/SurfaceChrome.tsx";
import { LIVE, type Liveness, type TradingMode } from "../../safety/mode.ts";
import type { Limitation } from "../../safety/limited.ts";
import { TRADING_ACTIONS, emitTradingActivity, type TradingActivityEmitter } from "../../activity.ts";
import { directionOf, encodeDirection, type DirectionPalette } from "../../direction.ts";
import { formatSignedMoney } from "../../format.ts";

export type WatchRow = {
  symbol: string;
  displaySymbol?: string;
  last?: string;
  /** Change against the session's reference, as reported. */
  change?: string;
  changePercent?: string;
  bid?: string;
  ask?: string;
  volume?: string;
  /** Per-row limitation — a delayed symbol in an otherwise real-time list. */
  limitation?: Limitation;
};

export type WatchListProps = {
  mode: TradingMode;
  /** Controlled. The host owns the list. */
  rows: readonly WatchRow[];
  /** Controlled selection, so an agent and a human point at the same row. */
  selected?: string | null;
  onSelect?: (symbol: string) => void;
  onAdd?: (symbol: string) => void;
  onRemove?: (symbol: string) => void;
  liveness?: Liveness;
  limitations?: readonly Limitation[];
  palette?: DirectionPalette;
  activity?: TradingActivityEmitter | null;
  origin?: "human" | "agent";
  moneyExp?: number;
  title?: string;
  className?: string;
  id?: string;
};

export function WatchList({
  mode,
  rows,
  selected = null,
  onSelect,
  onAdd,
  onRemove,
  liveness = LIVE,
  limitations,
  palette,
  activity,
  origin = "human",
  moneyExp = 2,
  title = "Watchlist",
  className,
  id,
}: WatchListProps) {
  const [draft, setDraft] = useState("");

  return (
    <SurfaceChrome
      surface="watchlist"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title={title}
      actions={
        onAdd ? (
          <span className="flex items-center gap-1">
            <Input
              data-fancy-trading-watchlist-add-input=""
              label="Add symbol"
              labelHidden
              size="xs"
              value={draft}
              placeholder="symbol"
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <Button
              data-fancy-trading-watchlist-add=""
              size="xs"
              disabled={draft.trim() === ""}
              onClick={() => {
                const symbol = draft.trim();
                setDraft("");
                emitTradingActivity({
                  action: TRADING_ACTIONS.WatchlistAdd,
                  surface: "watchlist",
                  elementId: symbol,
                  actor: { source: origin },
                  emitter: activity,
                });
                onAdd(symbol);
              }}
            >
              Add
            </Button>
          </span>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Withheld
          limitation={{
            reason: "unsupported",
            withheld: "Symbols",
            detail: "this watchlist is empty.",
          }}
          className="p-2"
        />
      ) : (
        <Table data-fancy-trading-watchlist="">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Symbol" />
              <Table.Column label="Last" />
              <Table.Column label="Change" />
              <Table.Column label="Bid" />
              <Table.Column label="Ask" />
              <Table.Column label="Volume" />
              <Table.Column label="" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((r) => {
              const change = r.change ? parseDecimal(r.change, moneyExp) : null;
              const enc = change ? encodeDirection(directionOf(change), palette) : null;
              return (
                <Table.Row
                  key={r.symbol}
                  data-fancy-trading-watch-row={r.symbol}
                  data-selected={selected === r.symbol ? "true" : "false"}
                  onClick={() => onSelect?.(r.symbol)}
                >
                  <Table.Cell>{r.displaySymbol ?? r.symbol}</Table.Cell>
                  <Table.Cell className="tabular-nums">{r.last ?? "—"}</Table.Cell>
                  <Table.Cell className={`tabular-nums ${enc?.className ?? ""}`}>
                    {change ? (
                      <span title={`${enc!.label} ${r.changePercent ?? ""}`}>
                        {enc!.glyph} {formatSignedMoney(change)}
                        {r.changePercent ? ` (${r.changePercent}%)` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">{r.bid ?? "—"}</Table.Cell>
                  <Table.Cell className="tabular-nums">{r.ask ?? "—"}</Table.Cell>
                  <Table.Cell className="tabular-nums">{r.volume ?? "—"}</Table.Cell>
                  <Table.Cell>
                    {r.limitation ? (
                      <span
                        data-fancy-trading-watch-limited={r.symbol}
                        className="text-[0.625rem] text-secondary-500"
                        title={r.limitation.detail}
                      >
                        {r.limitation.withheld} withheld
                      </span>
                    ) : null}
                    {onRemove ? (
                      <Button
                        data-fancy-trading-watchlist-remove={r.symbol}
                        size="xs"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          emitTradingActivity({
                            action: TRADING_ACTIONS.WatchlistRemove,
                            surface: "watchlist",
                            elementId: r.symbol,
                            actor: { source: origin },
                            emitter: activity,
                          });
                          onRemove(r.symbol);
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}
    </SurfaceChrome>
  );
}
