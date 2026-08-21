/**
 * The chrome every surface wears, and the three §3.2 rules it carries.
 *
 * Each test here fails against the implementation someone writes first:
 *
 * - a `mode` prop that defaults to something;
 * - a SIM banner that is an ordinary styled `<div>`, which a consumer's
 *   stylesheet can hide;
 * - a "delayed data" notice in the header, where the eye is not, instead of
 *   where the data would have been.
 */
import { describe, expect, test } from "vitest";
import { SurfaceChrome, Withheld } from "../src/chrome/SurfaceChrome.tsx";
import { render } from "./render.tsx";

describe("mode is required, and never defaulted", () => {
  test("a valid mode renders", () => {
    const h = render(
      <SurfaceChrome surface="ladder" mode="live">
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface='ladder']")).not.toBeNull();
    h.unmount();
  });

  test("an absent mode throws rather than guessing", () => {
    // TypeScript stops this at the boundary; a JS consumer, an untyped
    // `{...props}` spread, or a value off the wire does not go through
    // TypeScript. Guessing "live" risks real money; guessing "sim" risks
    // someone believing an order was simulated when it was not. Neither guess
    // is defensible, so there is no guess.
    expect(() =>
      render(
        // @ts-expect-error deliberately omitting a required prop
        <SurfaceChrome surface="ladder">
          <p>rows</p>
        </SurfaceChrome>,
      ),
    ).toThrow(/mode/i);
  });

  test("an unrecognised mode throws too", () => {
    expect(() =>
      render(
        // @ts-expect-error deliberately passing a bad value
        <SurfaceChrome surface="ladder" mode="paper">
          <p>rows</p>
        </SurfaceChrome>,
      ),
    ).toThrow(/mode/i);
  });

  test("live renders a marker too — 'no banner' must not mean 'unwired'", () => {
    const h = render(
      <SurfaceChrome surface="ladder" mode="live">
        <p>rows</p>
      </SurfaceChrome>,
    );
    const marker = h.find("[data-fancy-trading-mode]");
    expect(marker?.dataset.fancyTradingMode).toBe("live");
    expect(marker?.textContent).toContain("LIVE");
    h.unmount();
  });
});

describe("the simulation marker cannot be styled away", () => {
  const forced = ["display", "visibility", "opacity"];

  test("the visibility properties are set with !important, beating any stylesheet", () => {
    const h = render(
      <SurfaceChrome surface="ticket" mode="sim">
        <p>ticket</p>
      </SurfaceChrome>,
    );
    const marker = h.find("[data-fancy-trading-mode='sim']")!;
    for (const prop of forced) {
      expect(marker.style.getPropertyPriority(prop)).toBe("important");
    }
    expect(marker.style.getPropertyValue("display")).not.toBe("none");
    expect(marker.style.getPropertyValue("visibility")).toBe("visible");
    expect(marker.style.getPropertyValue("opacity")).toBe("1");
    h.unmount();
  });

  test("colour is forced too, so it cannot be made invisible against the page", () => {
    const h = render(
      <SurfaceChrome surface="ticket" mode="sim">
        <p>ticket</p>
      </SurfaceChrome>,
    );
    const marker = h.find("[data-fancy-trading-mode='sim']")!;
    expect(marker.style.getPropertyPriority("color")).toBe("important");
    expect(marker.style.getPropertyPriority("background-color")).toBe("important");
    h.unmount();
  });

  test("a consumer className reaches the wrapper and NOT the marker", () => {
    const h = render(
      <SurfaceChrome surface="ticket" mode="sim" className="hidden opacity-0">
        <p>ticket</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.className).toContain("hidden");
    const marker = h.find("[data-fancy-trading-mode='sim']")!;
    expect(marker.className).not.toContain("hidden");
    expect(marker.className).not.toContain("opacity-0");
    h.unmount();
  });

  test("replay is marked too — it is not live money either", () => {
    const h = render(
      <SurfaceChrome surface="chart" mode="replay">
        <p>chart</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-mode='replay']")!.textContent).toContain("REPLAY");
    h.unmount();
  });

  test("the wrapper carries the mode as a data attribute, for CSS and for tests", () => {
    const h = render(
      <SurfaceChrome surface="ladder" mode="sim">
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.mode).toBe("sim");
    h.unmount();
  });
});

describe("liveness is visible, and one-click follows it", () => {
  test("live: one-click is on and no degradation notice appears", () => {
    const h = render(
      <SurfaceChrome surface="ladder" mode="live">
        <p>rows</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("on");
    expect(h.find("[data-fancy-trading-liveness]")?.dataset.fancyTradingLiveness).toBe("live");
    h.unmount();
  });

  test("stale: one-click is off, and the reason is on the page verbatim", () => {
    const h = render(
      <SurfaceChrome
        surface="blotter"
        mode="live"
        liveness={{ state: "stale", since: 1, reason: "websocket closed at 14:02:11" }}
      >
        <p>orders</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("off");
    expect(h.text()).toContain("websocket closed at 14:02:11");
    h.unmount();
  });

  test("the degradation notice's handle actually reaches the DOM", () => {
    // It did not, for a while: it was a `data-*` on a Callout, which drops
    // unknown props. A stable handle that no selector can find is not a handle,
    // and an agent addressing it would have found nothing.
    const h = render(
      <SurfaceChrome surface="blotter" mode="live" liveness={{ state: "stale" }}>
        <p>orders</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-degraded='stale']")).not.toBeNull();
    h.unmount();
  });

  test("resyncing is degraded too — a book being repaired is not a book", () => {
    const h = render(
      <SurfaceChrome surface="book" mode="live" liveness={{ state: "resyncing" }}>
        <p>book</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-surface]")!.dataset.oneclick).toBe("off");
    h.unmount();
  });
});

describe("a limited surface says so WHERE THE DATA WOULD HAVE BEEN", () => {
  const limitation = {
    reason: "depth-unavailable" as const,
    withheld: "Market depth beyond the top of book",
    detail: "this session is not receiving the depth product.",
  };

  test("the notice is inside the body region, not tucked into the header", () => {
    // TWS hides the Deep Button panel and silently degrades to top-of-book
    // based on commission volume, explaining nothing at the point of failure
    // (§12.5). Putting the notice in the header repeats that in a politer font.
    const h = render(
      <SurfaceChrome surface="book" mode="live" limitations={[limitation]}>
        <p>book</p>
      </SurfaceChrome>,
    );
    const body = h.find("[data-fancy-trading-body]")!;
    const notice = h.find("[data-fancy-trading-withheld]")!;
    expect(notice).not.toBeNull();
    expect(body.contains(notice)).toBe(true);

    const header = h.find("[data-fancy-trading-chrome]")!;
    expect(header.contains(notice)).toBe(false);
    h.unmount();
  });

  test("it names the reason and what is missing — not just 'unavailable'", () => {
    const h = render(
      <SurfaceChrome surface="book" mode="live" limitations={[limitation]}>
        <p>book</p>
      </SurfaceChrome>,
    );
    const text = h.find("[data-fancy-trading-withheld]")!.textContent ?? "";
    expect(text).toContain("Market depth beyond the top of book");
    expect(text).toContain("not receiving the depth product");
    h.unmount();
  });

  test("no limitations, no notice — the marker means something", () => {
    const h = render(
      <SurfaceChrome surface="book" mode="live">
        <p>book</p>
      </SurfaceChrome>,
    );
    expect(h.find("[data-fancy-trading-withheld]")).toBeNull();
    h.unmount();
  });

  test("<Withheld> works standalone, for a single column or cell", () => {
    const h = render(<Withheld limitation={{ ...limitation, withheld: "Aggressor side" }} />);
    expect(h.text()).toContain("Aggressor side");
    h.unmount();
  });

  test("a delayed feed states the delay rather than implying real time", () => {
    const h = render(
      <SurfaceChrome
        surface="tape"
        mode="live"
        limitations={[
          {
            reason: "delayed-feed",
            withheld: "Real-time prints",
            detail: "this session receives a delayed feed.",
            delayMs: 900_000,
          },
        ]}
      >
        <p>tape</p>
      </SurfaceChrome>,
    );
    expect(h.text()).toContain("900s");
    h.unmount();
  });
});
