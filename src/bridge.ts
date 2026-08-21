/**
 * The agent-bridge contract.
 *
 * The MCP bridges themselves live in `@particle-academy/agent-integrations`
 * alongside the suite's other twenty-one (§4.3 — a new bridge package would
 * fork a convention that already works). What lives HERE is the shape those
 * bridges adapt to, so `registerLadderBridge` / `registerOrderTicketBridge` /
 * `registerChartBridge` are mechanical rather than inventive.
 *
 * Three properties are non-negotiable, and each is a §3 rule arriving at the
 * agent boundary:
 *
 * 1. **Every snapshot carries mode, liveness and limitations**, in the SAME
 *    words a human reads. An agent that cannot distinguish a stale blotter from
 *    a live one will act on the stale one, and a boolean it has to interpret is
 *    not the same as a sentence.
 * 2. **An agent proposes; it does not act.** {@link TradingSurfaceAdapter.propose}
 *    returns a proposal for a human to confirm. There is no `execute`.
 * 3. **Capability discovery.** §12.6 found this to be a real gap: an agent that
 *    can call `ladder_place_order` should also be able to ask *what can I do
 *    from here* and *what did I just do*. The suite's bridges already have the
 *    second half through `AgentActivity`; {@link TradingSurfaceAdapter.capabilities}
 *    is the first.
 */

import type { TradingActivityEvent, TradingSurface } from "./activity.ts";
import { livenessSummary, oneClickVerdict, type Liveness, type TradingMode } from "./safety/mode.ts";
import { limitationSummary, type Limitation } from "./safety/limited.ts";
import {
  describeBreak,
  reconciliationVerdict,
  type ReconciliationBreak,
} from "./safety/reconciliation.ts";

export type AgentLimitation = {
  reason: string;
  /** The same sentence rendered where the data would have been. */
  summary: string;
};

export type TradingSurfaceSnapshot<TData = unknown> = {
  surface: TradingSurface;
  symbol?: string;
  /**
   * Real money or not. Present on EVERY snapshot: an agent reasoning about
   * whether to propose an order needs to know which it is, for the same reason
   * a human does.
   */
  mode: TradingMode;
  liveness: Liveness;
  /** The human-facing sentence, verbatim. Not a boolean. */
  livenessSummary: string;
  /** Whether an action may be taken right now, and why not. */
  actionable: { allowed: boolean; reason: string | null };
  /** What this surface cannot currently show, and why. Never omitted silently. */
  limitations: AgentLimitation[];
  /**
   * Disagreements between this client and the venue (§2.6), as the SAME
   * sentences a human reads. Empty rather than absent when there are none, so
   * "no breaks" and "this bridge does not report breaks" cannot be confused.
   */
  breaks: string[];
  /** Surface-specific state — the ladder's rows, the ticket's value, and so on. */
  data: TData;
  /** When the snapshot was taken. */
  at: number;
};

export type TradingCapability = {
  /** The tool name a bridge exposes for it, e.g. `ladder_place_order`. */
  name: string;
  description: string;
  /**
   * Whether a human `Approval` is required. For any order mutation this is
   * `true` and cannot be otherwise — the domain's `submittable()` enforces it
   * below every surface (§3.1).
   */
  requiresApproval: boolean;
  /** Whether it can be invoked right now. */
  available: boolean;
  /** Why not, when it cannot. `null` when it can. */
  unavailableReason: string | null;
};

export type TradingProposal = {
  proposalId: string;
  /** Always `true`. There is no proposal that skips a human. */
  requiresApproval: true;
  /** What a human is being asked to approve, in a sentence. */
  summary: string;
  /** The structured action, for the confirmation UI to render in full. */
  action: unknown;
};

/**
 * What a bridge needs from a surface.
 *
 * Note the absence: there is no `execute`, `apply` or `commit`. A bridge can
 * read, it can enumerate what it could do, and it can propose. Turning a
 * proposal into an order is a human's click.
 */
export interface TradingSurfaceAdapter<TData = unknown, TAction = unknown> {
  readState(): TradingSurfaceSnapshot<TData>;
  capabilities(): TradingCapability[];
  propose(action: TAction): TradingProposal;
  /**
   * Recent activity on this surface — "what did I just do", the half of §12.6's
   * escape-hatch stack the suite already had.
   */
  recent(limit?: number): TradingActivityEvent[];
}

/**
 * Build the common half of a snapshot.
 *
 * Every adapter should use this rather than assembling the fields by hand: the
 * point of the sentences being identical for humans and agents is lost the
 * moment one surface writes its own.
 */
export function surfaceSnapshot<TData>(input: {
  surface: TradingSurface;
  symbol?: string;
  mode: TradingMode;
  liveness: Liveness;
  limitations?: readonly Limitation[];
  /** §2.6 breaks. A break makes the surface non-actionable on its own. */
  breaks?: readonly ReconciliationBreak[];
  data: TData;
  at?: number;
  /** An extra reason the surface is not actionable, beyond liveness. */
  blockedReason?: string | null;
}): TradingSurfaceSnapshot<TData> {
  const verdict = oneClickVerdict(input.liveness, input.mode);
  const reconciled = reconciliationVerdict(input.breaks ?? []);
  const blocked = input.blockedReason ?? null;
  return {
    surface: input.surface,
    symbol: input.symbol,
    mode: input.mode,
    liveness: input.liveness,
    livenessSummary: livenessSummary(input.liveness),
    actionable: {
      // A break outranks staleness in the REASON, because a live-and-wrong
      // surface is the one an agent is most likely to act on: nothing about it
      // looks broken.
      allowed: verdict.allowed && reconciled.allowed && blocked === null,
      reason: reconciled.reason ?? blocked ?? verdict.reason,
    },
    limitations: (input.limitations ?? []).map((l) => ({
      reason: String(l.reason),
      summary: limitationSummary(l),
    })),
    breaks: (input.breaks ?? []).map(describeBreak),
    data: input.data,
    at: input.at ?? Date.now(),
  };
}

/**
 * The capabilities each surface offers, and whether they are live right now.
 *
 * The `requiresApproval` column is the interesting one: reads never do, and
 * every mutation always does. A bridge that publishes this honestly gives an
 * agent a reason to propose rather than to try.
 */
export function surfaceCapabilities(
  surface: TradingSurface,
  snapshot: Pick<TradingSurfaceSnapshot, "actionable">,
): TradingCapability[] {
  const gate = (name: string, description: string, mutating: boolean): TradingCapability => ({
    name,
    description,
    requiresApproval: mutating,
    available: mutating ? snapshot.actionable.allowed : true,
    unavailableReason: mutating ? snapshot.actionable.reason : null,
  });

  switch (surface) {
    case "ticket":
      return [
        gate("ticket_read", "Read the current order ticket, its limits verdict and its estimate.", false),
        gate("ticket_set", "Change a field on the ticket. Does not place anything.", false),
        gate("ticket_propose", "Propose the order for a human to approve and place.", true),
      ];
    case "ladder":
      return [
        gate("ladder_read", "Read the visible price levels, working orders and position.", false),
        gate("ladder_propose_order", "Propose an order at a price level.", true),
        gate("ladder_propose_move", "Propose moving a working order — a cancel-replace.", true),
        gate("ladder_propose_cancel", "Propose cancelling a working order.", true),
      ];
    case "book":
    case "depth":
      return [
        gate("book_read", "Read the reconciled book and its sync state.", false),
        gate("book_impact", "Compute what would fill sweeping to a price.", false),
      ];
    case "tape":
      return [
        gate("tape_read", "Read recent prints, with each aggressor side's provenance.", false),
      ];
    case "blotter":
      return [
        gate("blotter_read_orders", "Read working and completed orders.", false),
        gate("blotter_read_fills", "Read fills, including corrections and busts.", false),
        gate("blotter_propose_cancel", "Propose cancelling one order.", true),
        gate("blotter_propose_cancel_all", "Propose cancelling every working order.", true),
      ];
    case "positions":
      return [
        gate("positions_read", "Read open positions, P&L and margin state.", false),
        gate("positions_propose_flatten", "Propose closing every position at market.", true),
        gate("positions_propose_reverse", "Propose reversing one position at market.", true),
      ];
    case "watchlist":
      return [
        gate("watchlist_read", "Read the watchlist.", false),
        gate("watchlist_add", "Add a symbol to the watchlist.", false),
        gate("watchlist_remove", "Remove a symbol from the watchlist.", false),
      ];
    case "alerts":
      return [
        gate("alerts_read", "Read the alerts the user has set.", false),
        gate("alerts_create", "Create an alert on a condition.", false),
        gate("alerts_remove", "Remove an alert.", false),
      ];
    case "chart":
      return [
        gate("chart_read", "Read the visible range, bars and overlays.", false),
        gate("chart_set_range", "Change the visible range.", false),
        gate("chart_draw", "Add a drawing.", false),
        gate("chart_remove_drawing", "Remove a drawing.", false),
      ];
    default:
      return [];
  }
}

let proposalSeq = 0;

/**
 * Wrap an action as a proposal.
 *
 * `requiresApproval` is a literal `true` rather than a computed boolean, so a
 * future change that tried to make it conditional would not typecheck.
 */
export function proposeAction(summary: string, action: unknown, id?: string): TradingProposal {
  proposalSeq += 1;
  return {
    proposalId: id ?? `proposal-${proposalSeq}`,
    requiresApproval: true,
    summary,
    action,
  };
}

/** Reset the proposal counter. For tests and for a fresh session. */
export function resetProposalIds(): void {
  proposalSeq = 0;
}
