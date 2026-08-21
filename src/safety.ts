/**
 * `@particle-academy/fancy-trading-ui/safety` — the safety floor, headless.
 *
 * **Zero React.** §3.2 requires guardrails to be enforced server-side as well as
 * client-side, because a client-side quantity cap is decoration once an agent is
 * placing orders through a bridge. A rule you cannot import into a Node backend
 * is a rule that runs in exactly one of the two places it has to.
 *
 * Everything here is also re-exported from the package root, so a React app
 * imports it once from `@particle-academy/fancy-trading-ui`.
 */

export {
  DISCONNECTED,
  LIVE,
  decorateSymbol,
  isDegraded,
  isSimulated,
  livenessSummary,
  modeLabel,
  oneClickVerdict,
  undecorateSymbol,
  type Liveness,
  type LivenessState,
  type OneClickVerdict,
  type TradingMode,
} from "./safety/mode.ts";

export {
  TRADING_WARNINGS,
  WarningNeverFired,
  WarningRegistry,
  type TradingWarningId,
  type WarningId,
  type WarningRecord,
  type WarningRegistryState,
  type WarningScope,
} from "./safety/warnings.ts";

export {
  NO_LIMITS,
  checkLimits,
  sizeByRisk,
  type DailyLossAction,
  type LimitBreach,
  type LimitContext,
  type LimitIntent,
  type LimitName,
  type LimitVerdict,
  type RiskLimits,
  type SizeByRiskInput,
  type SizeByRiskResult,
  type SizeClamp,
} from "./safety/limits.ts";

export {
  delayedFeed,
  limitationSummary,
  limitationsSummary,
  type Limitation,
  type LimitationReason,
} from "./safety/limited.ts";

export {
  describeBreak,
  findUnknownFate,
  reconcileOrder,
  reconcilePositions,
  reconciliationVerdict,
  type ReconciliationBreak,
  type ReconciliationScales,
  type ReconciliationVerdict,
  type VenueOrderState,
  type VenuePosition,
} from "./safety/reconciliation.ts";
