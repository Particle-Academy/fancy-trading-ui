/**
 * The jsdom harness. `createRoot` + `act`, the suite convention for React
 * packages, so effects and refs actually run — several of the rules under test
 * here (the forced inline styles on the mode marker, for one) live in a ref
 * callback and are invisible to `renderToStaticMarkup`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

export type Harness = {
  container: HTMLElement;
  root: Root;
  rerender: (element: ReactElement) => void;
  unmount: () => void;
  find: (selector: string) => HTMLElement | null;
  all: (selector: string) => HTMLElement[];
  text: () => string;
};

export function render(element: ReactElement): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    root,
    rerender(next) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    find: (selector) => container.querySelector<HTMLElement>(selector),
    all: (selector) => [...container.querySelectorAll<HTMLElement>(selector)],
    text: () => container.textContent ?? "",
  };
}

/** Click, inside `act`, so state updates flush before the assertion. */
export function click(el: Element | null): void {
  if (!el) throw new Error("click(): element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Right-click — the ladder's stop-order gesture (§2.2). */
export function rightClick(el: Element | null): void {
  if (!el) throw new Error("rightClick(): element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  });
}

/** Type into a controlled input. */
export function type(el: Element | null, value: string): void {
  if (!el) throw new Error("type(): element not found");
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
