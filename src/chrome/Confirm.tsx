/**
 * Confirmations and warnings — the two places a human is asked something.
 *
 * The design rule that shapes both, and it is an asymmetry rather than a
 * setting: **confirm the irreversible aggregate actions, and only those.**
 * Confirming everything trains people to click through, at which point the
 * dialog is a keystroke and the protection is gone. Sierra Chart gives Cancel
 * All, Flatten and Reverse each their own setting, and that is what we copy.
 *
 * Warnings work the other way round: they fire in context, they are silenced in
 * context, and they can only ever be turned back ON from a settings screen
 * (§12.2, IBKR).
 */

import { useState, type ReactNode } from "react";
import { Button, Callout, Modal, Table } from "@particle-academy/react-fancy";
import { WarningRegistry, type WarningId, type WarningScope } from "../safety/warnings.ts";
import type { TradingMode } from "../safety/mode.ts";
import { ModeMarker } from "./ModeMarker.tsx";

/**
 * An action that affects many orders or positions at once and cannot be undone.
 * Open-ended, because a consumer's platform may have its own.
 */
export type AggregateAction = "cancel-all" | "flatten" | "reverse" | (string & {});

/**
 * Per-action confirmation settings. Omitted means "confirm", which is the floor
 * rather than a policy value — §3.3 is about *limit thresholds*, and this is
 * about whether an irreversible action gets a sentence of warning.
 *
 * There is no key that turns them all off. A `{ all: false }` escape hatch
 * would undo the asymmetry in one line, so it is not honoured — see the test.
 */
export type ConfirmSettings = Record<string, boolean>;

const ALWAYS_CONFIRM: readonly AggregateAction[] = ["cancel-all", "flatten", "reverse"];

/**
 * Whether this action needs a confirmation right now.
 *
 * An `agent` origin ALWAYS confirms, whatever the settings say. §3.1: a
 * trader's own one-click is a human decision about their own money with their
 * own hand on the mouse; an agent has neither, and the confirmation is what
 * makes its participation legitimate at all.
 */
export function needsConfirmation(
  action: AggregateAction,
  settings: ConfirmSettings = {},
  origin: "human" | "agent" = "human",
): boolean {
  if (origin === "agent") return true;
  const explicit = settings[action];
  if (typeof explicit === "boolean") return explicit;
  return ALWAYS_CONFIRM.includes(action) ? true : false;
}

const ACTION_TITLE: Record<string, string> = {
  "cancel-all": "Cancel all working orders",
  flatten: "Flatten — close every position",
  reverse: "Reverse — flip every position",
};

export type ConfirmAggregateProps = {
  action: AggregateAction;
  open: boolean;
  /** Real money or not. Shown on the dialog with the un-styleable marker. */
  mode: TradingMode;
  /**
   * What will actually happen, in specifics: counts, symbols, sizes. "Are you
   * sure?" is not a confirmation, it is a speed bump.
   */
  impact: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
};

export function ConfirmAggregate({
  action,
  open,
  mode,
  impact,
  onConfirm,
  onCancel,
  confirmLabel,
}: ConfirmAggregateProps) {
  const title = ACTION_TITLE[action] ?? action;
  return (
    <Modal open={open} onClose={onCancel} size="sm" data-fancy-trading-confirm={action}>
      <Modal.Header>
        <span className="flex items-center gap-2">
          <ModeMarker mode={mode} />
          <span>{title}</span>
        </span>
      </Modal.Header>
      <Modal.Body>
        <Callout color="red">
          <p className="text-sm">{impact}</p>
        </Callout>
        <p className="mt-3 text-xs text-secondary-600 dark:text-secondary-400">
          This cannot be undone. Orders already filled are not affected.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button data-fancy-trading-confirm-cancel="" onClick={onCancel}>
          Keep everything
        </Button>
        <Button data-fancy-trading-confirm-accept="" color="red" onClick={onConfirm}>
          {confirmLabel ?? title}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export type WarningNoticeProps = {
  registry: WarningRegistry;
  id: WarningId;
  /** Where this warning is firing. Silencing is keyed on it. */
  scope: WarningScope;
  message: ReactNode;
  /** Extra detail, shown under the message. */
  detail?: ReactNode;
  className?: string;
  onSilenced?: (id: WarningId, scope: WarningScope) => void;
};

/**
 * One warning, in the place it applies.
 *
 * Rendering this IS the "you have read it at least once" event — it calls
 * {@link WarningRegistry.fire}, which is what earns the right to silence. That
 * is why the "don't show this again" affordance lives here and nowhere else.
 */
export function WarningNotice({
  registry,
  id,
  scope,
  message,
  detail,
  className,
  onSilenced,
}: WarningNoticeProps) {
  const [, force] = useState(0);
  const show = registry.fire(id, scope);
  if (!show) return null;

  return (
    <div data-fancy-trading-warning={id} data-scope={scope} className={className}>
      <Callout color="amber">
        <p className="text-sm font-medium">{message}</p>
        {detail ? <p className="mt-1 text-xs opacity-80">{detail}</p> : null}
        <Button
          data-fancy-trading-warning-silence=""
          size="xs"
          variant="ghost"
          className="mt-2"
          onClick={() => {
            registry.silence(id, scope);
            onSilenced?.(id, scope);
            force((n) => n + 1);
          }}
        >
          Don&apos;t show this again here
        </Button>
      </Callout>
    </div>
  );
}

export type WarningConsoleProps = {
  registry: WarningRegistry;
  className?: string;
  onChange?: () => void;
};

/**
 * The settings surface — a **re-enable console**.
 *
 * > "This page can only be used to enable messages that you have turned off,
 * >  not to disable them. We want to ensure you have read each message at least
 * >  one time before you elect to disable it." — IBKR
 *
 * So there is no control here that silences anything, in bulk or singly. The
 * only buttons add messages back.
 */
export function WarningConsole({ registry, className, onChange }: WarningConsoleProps) {
  const [, force] = useState(0);
  const rows = registry.list();
  const bump = () => {
    onChange?.();
    force((n) => n + 1);
  };

  return (
    <div data-fancy-trading-warning-console="" className={className}>
      <Callout color="blue">
        <p className="text-sm">
          This page can only be used to <strong>enable</strong> messages you have turned off, not
          to disable them. A message can only be silenced from the message itself, so you have
          read each one at least one time before you elect to disable it.
        </p>
      </Callout>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-secondary-600 dark:text-secondary-400">
          No messages have fired yet. Nothing can be turned off until it has.
        </p>
      ) : (
        <Table className="mt-3">
          <Table.Head>
            <Table.Row>
              <Table.Column label="Message" />
              <Table.Column label="Where" />
              <Table.Column label="Seen" />
              <Table.Column label="State" />
              <Table.Column label="" />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row
                key={`${row.id} ${row.scope}`}
                data-fancy-trading-warning-row={row.id}
                data-scope={row.scope}
              >
                <Table.Cell>{row.id}</Table.Cell>
                <Table.Cell>{row.scope}</Table.Cell>
                <Table.Cell>{row.firedCount}</Table.Cell>
                <Table.Cell>
                  {row.silenced ? `silenced (${row.suppressedCount} suppressed since)` : "showing"}
                </Table.Cell>
                <Table.Cell>
                  {row.silenced ? (
                    <Button
                      data-fancy-trading-warning-reenable=""
                      size="xs"
                      onClick={() => {
                        registry.reEnable(row.id, row.scope);
                        bump();
                      }}
                    >
                      Turn back on
                    </Button>
                  ) : null}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      <Button
        data-fancy-trading-warning-reenable-all=""
        className="mt-3"
        onClick={() => {
          registry.reEnableAll();
          bump();
        }}
      >
        Turn every message back on
      </Button>
    </div>
  );
}
