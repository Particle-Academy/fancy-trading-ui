# @particle-academy/fancy-trading-ui

[![Fancified](art/fancified.svg)](https://particle.academy)

Trading surfaces for the [Fancy UI suite](https://ui.particle.academy) — order
ticket, price ladder / DOM, order book, depth, time & sales, blotter, positions,
watchlist, alerts, and a session-aware trading chart.

Built on the headless domain core in
[`@particle-academy/fancy-trading`](https://www.npmjs.com/package/@particle-academy/fancy-trading):
exact decimal money, the FIX-derived order lifecycle, position and P&L
arithmetic. Nothing here re-declares money, orders or positions.

Every interactive surface is **controlled**, **JSON-friendly**, **agent-
bridgeable** and carries the safety floor described below.

---

## What installing this actually costs you

Worth stating plainly, because the chart lives in this package:

| you import | you need installed | what loads |
|---|---|---|
| `@particle-academy/fancy-trading-ui` | `react`, `react-dom`, `react-fancy`, `fancy-trading` | the surfaces. **No charting engine.** |
| `@particle-academy/fancy-trading-ui/chart` | …plus `lightweight-charts` | the chart |
| `@particle-academy/fancy-trading-ui/safety` | nothing | the limit checks, **React-free** |

`lightweight-charts` is an **optional peer dependency**. It is never bundled, it
appears nowhere in the root entry point's graph, and `tests/packaging.test.ts`
greps the built bundle to prove it — so a consumer who installs this package for
an order ticket does not pay for a charting engine they are not using.

The package's own `dependencies` are `{}`.

```sh
npm install @particle-academy/fancy-trading-ui @particle-academy/fancy-trading
# only if you use the chart:
npm install lightweight-charts
```

```css
@import "tailwindcss";
@source "../node_modules/@particle-academy/react-fancy/dist/**/*.js";
@source "../node_modules/@particle-academy/fancy-trading-ui/dist/**/*.js";
```

```ts
import "@particle-academy/react-fancy/styles.css";
import "@particle-academy/fancy-trading-ui/styles.css";
```

---

## Attribution — read this before you ship

**The chart is built on TradingView's `lightweight-charts`, and its attribution
obligation passes through to you.**

It is stock Apache-2.0, but **npm does not ship TradingView's `NOTICE` file** —
the published tarball contains ten files and the NOTICE is not among them, so
any compliance step built around "copy it out of `node_modules`" finds nothing.
We ship the text in **[`NOTICE`](./NOTICE)** in this package instead.

If you ship a commercial application that renders the chart, satisfy it in **one
of two ways**:

1. **Leave the on-chart attribution logo on.** `attributionLogo` defaults to
   `true` on `<TradingChart>` and is passed straight through to the engine.
   Doing nothing is the compliant path.
2. **Or, if you turn it off**, display the attribution notice from
   [`NOTICE`](./NOTICE) plus a link to <https://www.tradingview.com/> on a
   user-facing page of your site or app.

`<TradingChart>` renders a visible notice on the page when you pass
`attributionLogo={false}`, naming what you now owe. That is deliberate: silently
disabling it would transfer a licence obligation to someone who never saw it.

Consumers who never import `/chart` do not load `lightweight-charts` and this
section does not apply to them.

> Not legal advice. TradingView's own wording, from their README and TSDoc:
> *"This license requires specifying TradingView as the product creator. You
> shall add the 'attribution notice' from the NOTICE file and a link to
> https://www.tradingview.com/ to the page of your website or mobile application
> that is available to your users."*

---

## The safety floor

This kit places real orders with real money, and agents share these surfaces.
Safety here is a design property, not a disclaimer. Every surface owes all of
it, and several parts of it are deliberately not switchable.

### Agents propose; humans confirm — and nothing relaxes it

A trader's **own** one-click is a human decision about their own money with
their own hand on the mouse. It stays available, because a kit that refuses it
cannot build a futures ladder.

An **agent** has neither, so an agent-originated order mutation always requires
a human `Approval`. That is enforced by the domain's `submittable()`, which
takes the approval as a **required argument** — an unapproved agent order is not
"rejected at runtime", it is unrepresentable. There is no prop, flag or spread
that relaxes it, and there is a test that tries.

```tsx
<OrderTicket
  mode="live"
  origin="agent"        // stamped by the bridge, never by the caller
  onSubmit={place}      // not reached until a human approves
  …
/>
```

`TicketValue` has no `origin` field, so an agent-written value has nowhere to
claim it is human.

### Simulation mode cannot be styled away

`mode` is **required** on every surface and has no default. An absent or
unrecognised value throws: guessing `"live"` risks real money, guessing `"sim"`
risks someone believing an order was simulated when it was not, and neither
guess is defensible.

`<ModeMarker>` re-asserts every visibility-relevant property with `!important`
from a ref, so a stylesheet rule cannot hide it. `decorateSymbol()` also puts
`[SIM]` into the symbol text, so even a surface rendered without our chrome says
so in its own content.

### Stale state disables one-click — for humans and agents alike

On a disconnect, private state **freezes and is marked stale**; it is never
cleared, because a blotter that empties on disconnect shows a trader no position
and no stop when both exist at the venue. While degraded, one-click entry is off
and the surface says why.

An agent reading through a bridge gets **the same sentence**, from the same
function, because an agent that cannot distinguish a stale blotter from a live
one will act on the stale one.

### A warning can only be re-enabled, never mass-muted

Adopted from IBKR, which is the best design of its kind found anywhere:

> "This page can only be used to **enable** messages that you have turned off,
> **not to disable** them. We want to ensure you have read each message at least
> one time before you elect to disable it."

So `WarningRegistry.silence()` throws if the message has never fired, silencing
is keyed on `(message, place)` rather than being global, `<WarningConsole>` has
no mute-all, and persisted state claiming a silenced-but-never-fired warning is
**not honoured** — that being the back door a mute-all walks in through.

### A limited surface never silently renders less

When a delayed feed, an unsubscribed depth product or a venue outage reduces
what a surface can show, it says so **where the data would have been** and names
the reason. TWS degrades a ladder to top-of-book and hides its controls based on
commission volume, explaining nothing at the point of failure; this is the rule
that prevents repeating it.

### Aggregate destructive actions confirm separately

Cancel All, Flatten and Reverse each have **their own** confirmation, independent
of routine order entry. Confirming everything trains people to click through, at
which point the dialog is a keystroke and the protection is gone.

An **agent**-originated aggregate action always confirms, whatever the settings.

### Risk limits are a mechanism, and we ship no policy

`checkLimits(NO_LIMITS, …)` passes a one-million-lot order. What counts as too
big is your decision and your user's; what we guarantee is that the check exists,
runs in one place, and reports **which** limit stopped it.

```ts
import { checkLimits, sizeByRisk } from "@particle-academy/fancy-trading-ui/safety";
```

The `/safety` entry is React-free on purpose: guardrails have to run
**server-side as well as client-side**, because a client-side quantity cap is
decoration once an agent is placing orders through a bridge.

### No advice, ever

No component here produces a recommendation, a signal, a score, or anything
implying a prediction. `tests/no-advice.test.ts` scans the source for the
vocabulary such a feature would arrive wearing, and fails the build if it
appears. An alert is a field, an operator and a value **you** typed.

---

## The surfaces

### `<OrderTicket>`

Controlled, JSON-friendly. **Named prices** — `limitPrice`, `triggerPrice`,
`pegOffset` — never IBKR's overloaded `auxPrice`, which is mapped in an adapter.
All seven time-in-force values; post-only and reduce-only as normalised flags.

Attached orders are expressible in **all three venue shapes**: Alpaca's nested
declarative brackets, IBKR's `ocaGroup` / `ocaType` / `transmit` (including the
proportional-reduce types 2 and 3), and Sierra Chart's client-versus-venue OCO
enforcement — which the ticket displays, because it changes what a disconnect
means.

The margin / liquidation estimate is recomputed **on every keystroke**, not
behind a button.

### `<PriceLadder>`

**Column selects side; button selects order type.** The ladder does *not* derive
buy/sell from whether you clicked above or below the market. Because the
conventions genuinely differ between platforms, the click map is a
**configuration object** (`SIERRA_CLICK_MAP`, `JOIN_THE_BOOK_CLICK_MAP`,
`NO_CLICK_MAP`, or your own). An unmapped gesture does nothing; nothing guesses.

Dragging a working order is a **cancel-replace**, so the order renders at its
**confirmed** price with the request as a separate ghost, and a second drag
while one is in flight is refused with a sentence.

Event contracts work: set `outcomeFrame` on the instrument and a Kalshi ladder
viewed in its `NO` frame mirrors the prices and swaps the sides, emitting the
order in the venue's own frame. Polymarket's separate books are **not** mirrored,
because that would invent liquidity that is not there.

### `<OrderBook>` + `<DepthChart>`

Both take **one** `BookState`. Neither takes levels of its own — two views each
maintaining their own book from one stream drift after a gap, and then two
surfaces on screen disagree. The depth curve is `cumulativeDepth()` of that
state, and `marketImpact()` answers the question a depth chart is actually asked,
reporting `exceedsVisibleBook` rather than quietly stopping at the last level it
has.

### `<TimeAndSales>`

Every print carries `aggressor` **and** `aggressorSource`. Futures and crypto
venues report the aggressor; the US equities SIP does not, so for equities it is
inferred — and inferred prints render differently, `unknown` stays `unknown`, and
the cumulative delta reports how much of itself rests on inference.

### `<OrdersTable>` / `<FillsTable>` / `<PositionsTable>`

Three tables, because they are three different things. Orders are intent, fills
are immutable facts, positions are derived state.

An **untriggered stop presents as "Accepted — NOT working"**, because a trader
who believes otherwise believes they are protected when they are not. Cancelled
and Rejected are never merged. A bust adds a record and marks the original; it
never deletes it. `roundTrips()` groups fills flat-to-flat using the domain
package's own `applyFill`, so a blotter and a P&L report cannot disagree.

### `<TradingChart>` (`/chart`)

Session-aware axis with separators, extended-hours shading and halts drawn as
annotated bands rather than a flat line. Windowing (mandatory, not an
optimisation). A controlled drawing model. Group A primitives — volume profile
and depth heatmap — rendered as pane primitives that read `priceToCoordinate`
from the same scale the candles are drawn from, so alignment holds exactly under
zoom.

A profile computed from OHLCV is labelled `approximate`, because OHLCV records
where price went, not where the volume happened inside the bar.

`sessionKey()` is why this is not a thin wrapper: **the futures day starts at
18:00 ET, not midnight**, so a 19:00 bar on Monday belongs to Tuesday's session,
and a profile keyed on the calendar date is wrong every evening.

---

## Human+ / agent bridges

The MCP bridges live in `@particle-academy/agent-integrations` with the suite's
other twenty-one. What lives here is the contract they adapt to:

```ts
import { surfaceSnapshot, surfaceCapabilities, proposeAction } from "@particle-academy/fancy-trading-ui";
```

- `readState()` returns mode, liveness, the human-facing liveness sentence, and
  every limitation — never a bare boolean.
- `capabilities()` lets an agent ask *what can I do from here*, with
  `requiresApproval` and `available` per tool. Reads are always available;
  mutations always require approval.
- `propose()` returns a proposal. There is no `execute`.

Every mutation broadcasts an `AutoActivityEvent`, so presence, undo and coaching
compose for free. `@particle-academy/fancy-auto-common` is an optional peer and
is never hard-imported:

```ts
import { emitActivity } from "@particle-academy/fancy-auto-common";
import { setTradingActivityEmitter } from "@particle-academy/fancy-trading-ui";

setTradingActivityEmitter(emitActivity);
```

---

## Accessibility

Red/green as the sole encoding of direction fails for deuteranopia, roughly 1 in
12 men — a population heavily represented among traders. **Every direction and
side carries a glyph and a label in every palette**, so colour is an additional
channel and never the only one. `palette="blue-orange"` is deuteranopia-safe;
`palette="monochrome"` drops colour entirely and stays legible.

---

## Licence

MIT. See [`NOTICE`](./NOTICE) for the third-party attribution the `/chart` entry
point carries.
