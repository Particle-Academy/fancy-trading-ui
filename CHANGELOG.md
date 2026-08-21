# Changelog

All notable changes to `@particle-academy/fancy-trading-ui` are documented here.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**This package is pre-1.0, so breaking changes land in MINOR releases.** A minor
bump is not a promise of compatibility until 1.0; read the entry before taking
one. Every breaking entry says what you have to DO, not just what moved.

## [Unreleased]

## [0.1.0] — 2026-08-21

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

- **`<TradingChart>`** on `@particle-academy/fancy-trading-ui/chart` — the only
  entry point that touches `lightweight-charts`. Session-aware axis with
  separators, extended-hours shading and halts drawn as annotated bands;
  windowing; a controlled drawing model; and Group A primitives (volume profile,
  depth heatmap) rendered into the candles' own coordinate space.
  - `sessionKey()` knows the **futures day starts at 18:00 ET**, so a 19:00 bar
    on Monday belongs to Tuesday's session.
  - `applyTick()` never interpolates across a session break.
  - A profile computed from OHLCV is labelled `approximate`, because OHLCV
    records where price went, not where the volume happened inside the bar.
  - In an environment with no 2D canvas — SSR, jsdom — the chart renders a
    limitation notice instead of throwing.
- **The agent-bridge contract** (`surfaceSnapshot`, `surfaceCapabilities`,
  `proposeAction`). Every snapshot carries mode, liveness and limitations in the
  same words a human reads; every mutation is a proposal; there is no `execute`.
  Capability discovery answers "what can I do from here", which the study found
  to be a real gap in agent affordances.

### Fixed

- **`roundTrips()` priced an INVERSE contract with the linear formula.** It
  hardcoded `contractType: "linear"` when calling the domain's `applyFill`, so a
  coin-margined round trip reported a number nine orders of magnitude out — the
  worked case in the test is `0.00181818 BTC` against `5000000.00`, and the
  wrong one looks like a fortune. `RoundTripOptions.contractType` is now
  **required with no default**, because there is no default that could be right;
  `<FillsTable view="roundTrips">` says so where the number would have been
  rather than guessing.
- **`tickSize` was declared on `TicketInstrument` and read by nothing** — the
  suite's most common defect shape, and invisible precisely because a field that
  is never read never misbehaves. The ticket now warns when a typed limit or
  trigger price is off the instrument's grid and names the nearest valid price.
  It **warns rather than snapping**: a trader's number is not edited under them.
  Ranged tick structures work, so Kalshi's `price_ranges` is expressible.
  `tickSizeAt()` is exported for hosts and ladders.
- **Three surfaces hand-rolled `<table>` markup that `react-fancy`'s `Table`
  already covers**, and the ladder had a bare `<button>`. Converted; no test
  changed, because `Table` forwards `onClick`, `onContextMenu`, `onMouseUp` and
  every `data-*` onto the underlying `<tr>` / `<td>`. `tests/fancy-exclusive.test.ts`
  now fails the build on a hand-rolled element the kit already has a primitive
  for — the rule is easy to agree with and easy to break, because a `<table>` is
  quicker to type than a `<Table>` and nothing complained.
- **A session separator drawn in the same layer as the extended-hours shading is
  invisible against it.** Separators now render on their own layer with a halo
  stroke. Found by looking at a real browser render — jsdom has no canvas and
  could never have caught it — so `DECORATION_LAYERS` pins the decision instead.

### Third-party

- `lightweight-charts` is an **optional peer dependency**, never bundled, and
  appears only in the `/chart` entry point. Installing this package for an order
  ticket costs you no charting engine.
- **Attribution is owed and it is inherited by you.** See `NOTICE` and the
  README — leave `attributionLogo` on, or display the notice plus a link to
  <https://www.tradingview.com/> on a user-facing page.
