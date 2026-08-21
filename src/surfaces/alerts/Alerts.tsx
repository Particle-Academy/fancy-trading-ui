/**
 * `<Alerts>` — conditions the USER asked to be told about.
 *
 * This is the surface a trading kit most easily turns into a signal service, so
 * the boundary is worth stating rather than assuming. An alert here is:
 *
 *   *a field, an operator, and a value the user typed.*
 *
 * It has no strength, no confidence, no score and no suggested level. Those
 * fields are what a recommendation looks like when it is trying to pass as a
 * feature, and §3.2 forbids them: *"No component or backend produces a
 * recommendation, a signal, a score, or anything implying a prediction. We show
 * data and take instructions."* `tests/no-advice.test.ts` scans this file for
 * them by name.
 *
 * Evaluation is the HOST's, not ours. {@link evaluateAlert} is offered as a
 * convenience for the plain comparisons, and a host with its own engine ignores
 * it. We do not decide when an alert fires any more than we decide what a
 * strategy is (§0).
 */

import { useState } from "react";
import { Button, Input, Select, Switch, Table } from "@particle-academy/react-fancy";
import { cmp, parseDecimal } from "@particle-academy/fancy-trading";
import { SurfaceChrome, Withheld } from "../../chrome/SurfaceChrome.tsx";
import { LIVE, type Liveness, type TradingMode } from "../../safety/mode.ts";
import type { Limitation } from "../../safety/limited.ts";
import { TRADING_ACTIONS, emitTradingActivity, type TradingActivityEmitter } from "../../activity.ts";

/** What the alert watches. Facts a venue reports, and nothing derived. */
export type AlertField = "last" | "bid" | "ask" | "mark" | "volume" | "change" | "changePercent";

export type AlertOperator = "above" | "below" | "crossesUp" | "crossesDown";

export type Alert = {
  id: string;
  symbol: string;
  field: AlertField;
  op: AlertOperator;
  /** Decimal string. The user typed it. */
  value: string;
  enabled: boolean;
  /** The user's own words. Not ours. */
  note?: string;
  /** When it last fired, if it has. */
  lastFiredAt?: number;
  /** Fire once and disable, or keep firing. */
  once?: boolean;
};

export type AlertObservation = {
  /** Current value of the watched field. */
  current: string;
  /** The value at the previous observation, for the crossing operators. */
  previous?: string;
};

/**
 * Whether the condition the user wrote is true right now.
 *
 * Deliberately dull: four comparisons on a decimal. The crossing operators need
 * a previous value and return `false` without one, rather than pretending a
 * first observation can be a crossing.
 */
export function evaluateAlert(alert: Alert, obs: AlertObservation, exp = 2): boolean {
  if (!alert.enabled) return false;
  const value = parseDecimal(alert.value, exp);
  const current = parseDecimal(obs.current, exp);

  switch (alert.op) {
    case "above":
      return cmp(current, value) > 0;
    case "below":
      return cmp(current, value) < 0;
    case "crossesUp":
    case "crossesDown": {
      if (obs.previous === undefined) return false;
      const previous = parseDecimal(obs.previous, exp);
      return alert.op === "crossesUp"
        ? cmp(previous, value) <= 0 && cmp(current, value) > 0
        : cmp(previous, value) >= 0 && cmp(current, value) < 0;
    }
  }
}

const FIELDS: { value: AlertField; label: string }[] = [
  { value: "last", label: "Last" },
  { value: "bid", label: "Bid" },
  { value: "ask", label: "Ask" },
  { value: "mark", label: "Mark" },
  { value: "volume", label: "Volume" },
  { value: "change", label: "Change" },
  { value: "changePercent", label: "Change %" },
];

const OPS: { value: AlertOperator; label: string }[] = [
  { value: "above", label: "is above" },
  { value: "below", label: "is below" },
  { value: "crossesUp", label: "crosses up through" },
  { value: "crossesDown", label: "crosses down through" },
];

export type AlertsProps = {
  mode: TradingMode;
  /** Controlled. */
  alerts: readonly Alert[];
  onChange: (alerts: Alert[]) => void;
  /** Symbols offered in the new-alert form. Free text when absent. */
  symbols?: readonly string[];
  liveness?: Liveness;
  limitations?: readonly Limitation[];
  activity?: TradingActivityEmitter | null;
  origin?: "human" | "agent";
  /** Generates ids for new alerts. Injected so tests and SSR are deterministic. */
  makeId?: () => string;
  className?: string;
  id?: string;
};

export function Alerts({
  mode,
  alerts,
  onChange,
  symbols,
  liveness = LIVE,
  limitations,
  activity,
  origin = "human",
  makeId,
  className,
  id,
}: AlertsProps) {
  const [draft, setDraft] = useState<Omit<Alert, "id" | "enabled">>({
    symbol: symbols?.[0] ?? "",
    field: "last",
    op: "above",
    value: "",
  });
  const [seq, setSeq] = useState(1);

  const actor = { source: origin };

  const add = (): void => {
    const alertId = makeId ? makeId() : `alert-${seq}`;
    setSeq((n) => n + 1);
    const next: Alert = { ...draft, id: alertId, enabled: true };
    emitTradingActivity({
      action: TRADING_ACTIONS.AlertCreate,
      surface: "alerts",
      elementId: alertId,
      actor,
      emitter: activity,
      meta: { symbol: next.symbol, field: next.field, op: next.op, value: next.value },
    });
    onChange([...alerts, next]);
    setDraft({ ...draft, value: "" });
  };

  return (
    <SurfaceChrome
      surface="alerts"
      mode={mode}
      liveness={liveness}
      limitations={limitations}
      id={id}
      className={className}
      title="Alerts"
    >
      <div data-fancy-trading-alerts="" className="space-y-2 p-2">
        <div data-fancy-trading-alert-new="" className="grid grid-cols-5 items-end gap-2">
          {symbols ? (
            <Select
              label="Symbol"
              list={symbols.map((s) => ({ value: s, label: s }))}
              value={draft.symbol}
              onChange={(e) => setDraft({ ...draft, symbol: e.currentTarget.value })}
            />
          ) : (
            <Input
              label="Symbol"
              value={draft.symbol}
              onChange={(e) => setDraft({ ...draft, symbol: e.currentTarget.value })}
            />
          )}
          <Select
            label="When"
            list={FIELDS}
            value={draft.field}
            onChange={(e) => setDraft({ ...draft, field: e.currentTarget.value as AlertField })}
          />
          <Select
            label="Condition"
            list={OPS}
            value={draft.op}
            onChange={(e) => setDraft({ ...draft, op: e.currentTarget.value as AlertOperator })}
          />
          <div data-fancy-trading-alert-value="">
            <Input
              label="Value"
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => setDraft({ ...draft, value: e.currentTarget.value })}
            />
          </div>
          <Button
            data-fancy-trading-alert-add=""
            disabled={draft.symbol.trim() === "" || draft.value.trim() === ""}
            onClick={add}
          >
            Add alert
          </Button>
        </div>

        {alerts.length === 0 ? (
          <Withheld
            limitation={{
              reason: "unsupported",
              withheld: "Alerts",
              detail: "you have not set any.",
            }}
          />
        ) : (
          <Table data-fancy-trading-alert-list="">
            <Table.Head>
              <Table.Row>
                <Table.Column label="Symbol" />
                <Table.Column label="Condition" />
                <Table.Column label="Last fired" />
                <Table.Column label="On" />
                <Table.Column label="" />
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {alerts.map((a) => (
                <Table.Row key={a.id} data-fancy-trading-alert={a.id} data-enabled={a.enabled ? "true" : "false"}>
                  <Table.Cell>{a.symbol}</Table.Cell>
                  <Table.Cell>
                    {FIELDS.find((f) => f.value === a.field)?.label ?? a.field}{" "}
                    {OPS.find((o) => o.value === a.op)?.label ?? a.op} {a.value}
                    {a.note ? (
                      <span className="ml-1 text-[0.6875rem] text-secondary-500">— {a.note}</span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums">
                    {a.lastFiredAt ? new Date(a.lastFiredAt).toISOString().slice(11, 19) : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    <Switch
                      data-fancy-trading-alert-toggle={a.id}
                      label="Enabled"
                      labelHidden
                      checked={a.enabled}
                      onCheckedChange={(checked) => {
                        emitTradingActivity({
                          action: TRADING_ACTIONS.AlertToggle,
                          surface: "alerts",
                          elementId: a.id,
                          actor,
                          emitter: activity,
                          meta: { enabled: checked },
                        });
                        onChange(alerts.map((x) => (x.id === a.id ? { ...x, enabled: checked } : x)));
                      }}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <Button
                      data-fancy-trading-alert-remove={a.id}
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        emitTradingActivity({
                          action: TRADING_ACTIONS.AlertRemove,
                          surface: "alerts",
                          elementId: a.id,
                          actor,
                          emitter: activity,
                        });
                        onChange(alerts.filter((x) => x.id !== a.id));
                      }}
                    >
                      Remove
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        <p className="text-[0.6875rem] text-secondary-500">
          An alert tells you when a condition you wrote became true. It is not a recommendation, and
          nothing here suggests a level.
        </p>
      </div>
    </SurfaceChrome>
  );
}
