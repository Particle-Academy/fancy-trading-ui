# Changelog

All notable changes to `@particle-academy/fancy-trading-ui` are documented here.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**This package is pre-1.0, so breaking changes land in MINOR releases.** A minor
bump is not a promise of compatibility until 1.0; read the entry before taking
one. Every breaking entry says what you have to DO, not just what moved.

## [Unreleased]

## [0.1.0] — unreleased

First release. Trading surfaces for the Fancy UI suite, built on the domain core
in [`@particle-academy/fancy-trading`](https://www.npmjs.com/package/@particle-academy/fancy-trading).

### Added

- **`/safety`, a React-free entry point** — the risk-limit mechanism, the
  warning registry, mode and liveness. Importable from a Node backend, because
  a quantity cap that only runs in the browser is decoration once an agent is
  placing orders through a bridge.
  - `checkLimits()` — per-order quantity, per-symbol and account position caps,
    daily net loss, minimum balance, price deviation, immediate-fill rejection
    for limits *and* stops (the direction inverts), the expiry guard, message
    rate, and liquidation-only. **No default policy values ship**: what counts
    as too big is the developer's decision.
  - `sizeByRisk()` — position sizing with the cost buffer and the margin
    feasibility clamp, returning `clampedBy` so the answer is honest.
  - `WarningRegistry` — a warning can only be silenced after it has fired, and
    only where it fired. There is no mute-all, and persisted state claiming
    otherwise is not honoured.
- **`<OrderTicket>`** — controlled, JSON-friendly, with named prices
  (`limitPrice` / `triggerPrice` / `trailOffset`, never an overloaded
  `auxPrice`), all seven time-in-force values, post-only and reduce-only as
  flags, and attached orders in a shape that expresses Alpaca's nested
  brackets, IBKR's `ocaGroup` / `ocaType` / `transmit`, and Sierra Chart's
  client-vs-venue OCO enforcement.
- **The agent asymmetry.** A human's own one-click stays available. An
  agent-originated order always requires a human `Approval`, enforced by the
  domain's `submittable()` rather than by a branch in a component — so there is
  no prop, flag or spread that relaxes it.
- **`<SurfaceChrome>` and `<ModeMarker>`** — a simulation marker whose
  visibility, colour and size are re-asserted with `!important`, so a
  consumer's stylesheet cannot hide it.
- **Limitation notices** that render where the withheld data would have been,
  naming the reason.
- Exact price display for fractional notation (Treasury 32nds, grain eighths),
  cents and percent, with a matching parser so a ticket accepts what it renders.
- Colour-blind-safe direction encoding: every direction carries a glyph and a
  label in every palette, so colour is never the only channel.
- Activity broadcasting for every mutation, through an optional
  `fancy-auto-common` emitter.

### Third-party

- `lightweight-charts` is an **optional peer dependency**, never bundled, and
  appears only in the `/chart` entry point. Installing this package for an order
  ticket costs you no charting engine.
- **Attribution is owed and it is inherited by you.** See `NOTICE` and the
  README — leave `attributionLogo` on, or display the notice plus a link to
  <https://www.tradingview.com/> on a user-facing page.
