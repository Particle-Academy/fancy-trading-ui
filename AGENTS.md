# Using @particle-academy/fancy-trading-ui — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

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

- **Peers:** `react ^19`, `react-dom ^19`, `@particle-academy/react-fancy >=5.20.0`,
  `@particle-academy/fancy-trading`. Optional: `lightweight-charts >=5.2 <6`
  (only for `/chart`), `@particle-academy/fancy-auto-common`, `tailwindcss ^4`.
- `dependencies` is empty.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). The registry entry is slug `fancy-trading-ui`. Find it
with `search-components`, get the exact commands with `install-instructions`.
The headless core is slug `fancy-trading-js`.

## API essentials

- **Entry points:** the root (the surfaces, no charting engine), `/chart`
  (`<TradingChart>`, needs `lightweight-charts`), `/safety` (React-free limit
  checks: `checkLimits`, `sizeByRisk`, `NO_LIMITS`, to run server-side too).
- **Surfaces:** `<OrderTicket>`, `<PriceLadder>` (with a click map:
  `SIERRA_CLICK_MAP`, `JOIN_THE_BOOK_CLICK_MAP`, `NO_CLICK_MAP` or your own),
  `<OrderBook>` + `<DepthChart>` (both take one `BookState`),
  `<TimeAndSales>`, `<OrdersTable>`, `<FillsTable>`, `<PositionsTable>`,
  `<WatchList>`, `<ModeMarker>`, `<WarningConsole>`.
- **Every surface is controlled and JSON-friendly**, and takes a required
  `mode` (`"live"` or `"sim"`).
- **Agent contract:** `surfaceSnapshot`, `surfaceCapabilities`, `proposeAction`
  (read state, ask what is possible, propose; there is no execute).
  `setTradingActivityEmitter(emitActivity)` (from fancy-auto-common) broadcasts
  every mutation as an `AutoActivityEvent`.
- Money, orders and positions are `@particle-academy/fancy-trading` types; this
  package re-declares none of them.

## Traps

- **`mode` is required and has no default.** An absent or unknown value throws.
- **Agent orders always need a human approval.** `origin="agent"` is stamped by
  the bridge, never the caller; `onSubmit` is not reached until a human
  approves, and no prop relaxes it. Agent-originated Cancel All / Flatten /
  Reverse always confirm.
- **Stale state disables one-click** for humans and agents; the same liveness
  sentence reaches an agent through the surface snapshot.
- **`WarningRegistry.silence()` throws** for a warning that has never fired; there
  is no mute-all.
- **`checkLimits(NO_LIMITS, ...)` passes anything.** The risk policy is the
  app's; the package ships the mechanism.
- **Chart attribution:** `lightweight-charts` is Apache-2.0 with a TradingView
  attribution duty. Leave `attributionLogo` on (the default), or show the text
  from this package's `NOTICE` plus a link to https://www.tradingview.com/ on a
  user-facing page.
- **`OrderBook` and `DepthChart` must share one `BookState`**; never feed each
  its own levels.
- **Futures sessions start at 18:00 ET**, so key per-session data with
  `sessionKey()`, not the calendar date.
- **No advice, signals or scores** ship here, by design.
- **Pre-1.0:** breaking changes land in MINOR releases.
