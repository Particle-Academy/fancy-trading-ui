# Changelog

All notable changes to `@particle-academy/fancy-trading-ui` are documented here.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**This package is pre-1.0, so breaking changes land in MINOR releases.** A minor
bump is not a promise of compatibility until 1.0; read the entry before taking
one. Every breaking entry says what you have to DO, not just what moved.

## [Unreleased]

### Security

- `source-map-js` is pinned forward to `^1.2.2` via `overrides`. Versions up to
  1.2.1 allow an event-loop denial of service through indexed source-map section
  offsets, and it arrives here transitively through the build toolchain.
  **Nothing for a consumer to do, and no runtime change**: an npm package does
  not ship a lockfile, so this governs builds OF this repo, not anything
  installed FROM it. Recorded rather than left silent because the override it
  sits beside — `shell-quote` `^1.9.0`, added for an earlier advisory — was
  carried with no note of why, and had drifted back inside the vulnerable range
  before anyone looked.

## [0.1.0] — 2026-08-25

FIRST RELEASE, and it is dated the day it actually shipped.

The notes below were written on 2026-08-21 and the tag was never cut; four
days of further work then accumulated under `[Unreleased]` above them. The
tag cut today contains BOTH, so both are here. An entry dated before the
release it describes, with later work filed as unreleased above it, is how a
consumer reads a changelog that does not match the tarball they installed.

First release. Trading surfaces for the Fancy UI suite, built on the domain core
in [`@particle-academy/fancy-trading`](https://www.npmjs.com/package/@particle-academy/fancy-trading).

### Added

- **§2.7 point 6 is wired: the volume profile and the cumulative delta reset per
  session.** The primitives were correct and nothing called them — a correct
  primitive nothing calls reads as done, which is worse than absent.
  - `<TradingChart profileScope>` defaults to `"session"` whenever a `calendar`
    is given. Yesterday's volume under today's profile drags the point of
    control toward a level nobody traded today, quietly and cumulatively.
    `"window"` remains available; what is not available is that behaviour
    unlabelled, so the badge states which is in force and names the session.
  - `cumulativeDelta(prints, qtyExp, calendar?)` covers the latest session when
    given a calendar, and reports which in `session`. Without one it sums
    everything and does **not** claim a session it cannot define.
  - The futures boundary is respected throughout: 19:00 ET Monday and 10:00 ET
    Tuesday are one session, so one profile.
- **Halts have a vocabulary (§2.7).** `Halt` gains `kind` and an optional
  `band`, and `describeHalt()` is the one label they render with.
  - **A LULD Limit State is not a pause.** The market is still trading, capped
    at the band, for 15 seconds before it resolves or becomes a five-minute
    pause. Rendering the two identically tells a trader they cannot get out when
    they can.
  - `market-wide` says the cause is not this symbol; `maintenance` says
    scheduled rather than halted, so a futures chart stops looking like it
    breaks nightly.
  - **Bands are never computed here.** The LULD reference price is a
    five-minute rolling mean updated only on a 1%-or-greater move and the
    percentage doubles in the closing 25 minutes; a host with the feed passes
    them in, and absent means absent.
- **Sessions moved out of `chart/`** to the package root and are exported from
  both entry points. They are a domain concept the tape needs as much as the
  chart, and burying them under the chart was why the tape had no session to
  reset on.

- **Reconciliation breaks (§2.6), on the `/safety` entry point.**
  `reconcilePositions()` recomputes positions from this client's own fills and
  compares them with what the venue reports; `reconcileOrder()` compares one
  order's cumulative state, delegating the predicate to the domain's
  `isReconciliationBreak()` so a blotter and a risk daemon cannot disagree about
  what counts as a break; `findUnknownFate()` surfaces `pendingNew` orders the
  venue does not report.
  - **A break turns one-click off even when the feed is perfectly live.**
    Staleness and wrongness are different problems and only one of them is about
    the socket — the live-and-wrong case is the more dangerous, because nothing
    looks broken. `<SurfaceChrome breaks={…}>` renders it in red, in the body,
    above the staleness notice, and sets `data-reconciliation="break"`.
  - **The venue is authoritative, and the sentence says so.** Both numbers and
    the difference are on screen, because a surface showing only its own number
    cannot be argued with.
  - **An order of unknown fate is never guessed.** It may have been rejected, or
    accepted with the ack lost; it is surfaced as needing a human and is neither
    cancelled nor working until one checks.
  - Snapshots carry `breaks` as the same sentences a human reads, and are not
    actionable while one stands.

### Fixed

- **Four stable handles were going nowhere.** `data-*` on `react-fancy`'s
  `Callout` is dropped — it destructures its props and does not spread the rest
  — and TypeScript does not object, because a hyphenated JSX attribute is always
  allowed and never checked. `-break`, `-degraded`, `-ladder-refusal` and
  `-ticket-blocked` were all accepted silently and dropped silently. The handles
  now sit on a wrapper, and a scanner fails the build on the next one.
  **Filed against `react-fancy`**, since every other primitive forwards.

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
