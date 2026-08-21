/**
 * Rule 2 — Fancy Exclusive — plus the trap that comes with composing a
 * primitive that does not forward what you give it.
 *
 * > Anything we build is built from the Fancy suite's own components… They do
 * > not hand-roll HTML that a Fancy primitive already covers.
 *
 * The rule is easy to agree with and easy to break, because a `<table>` is
 * quicker to type than a `<Table>` and nothing complains. This complains.
 *
 * It caught three surfaces on the first run — the ladder, the book and the tape
 * all had hand-rolled `<table>` markup, and the ladder had a bare `<button>`.
 *
 * **A note on how these scanners are written.** The first version of the
 * drops-rest scan below built its pattern with `` new RegExp(`<${tag}\b…`) ``.
 * In a TEMPLATE LITERAL `\b` is the backspace character, not a word boundary,
 * so the pattern was `<Callout\x08…` and could never match. It passed cleanly
 * against a deliberately reintroduced offender. **Every scanner here is proven
 * to FIRE, not merely to pass** — see the fires-on-a-known-offender tests.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * Elements `react-fancy` already covers. Layout tags (`div`, `span`, `p`,
 * `section`, `header`, `dl`) are NOT here — the kit has no primitive for a flex
 * row, and pretending otherwise would make the rule absurd rather than useful.
 */
const COVERED: Record<string, string> = {
  table: "Table",
  thead: "Table.Head",
  tbody: "Table.Body",
  th: "Table.Column",
  td: "Table.Cell",
  tr: "Table.Row",
  button: "Button",
  input: "Input",
  select: "Select",
  textarea: "Textarea",
};

/**
 * `react-fancy` components that destructure their props and do NOT spread the
 * rest, so anything they do not name is dropped.
 *
 * `Callout` is the one this package uses. TypeScript does not object either,
 * because a hyphenated JSX attribute is always allowed and never checked —
 * accepted silently and dropped silently, which is the worst pair available.
 * Filed against react-fancy; until then the handle goes on a wrapper.
 */
const DROPS_REST = ["Callout"];

/** Hand-rolled elements the kit covers, in one file's text. */
function handRolled(text: string): string[] {
  const found: string[] = [];
  for (const [tag, primitive] of Object.entries(COVERED)) {
    // `<tag` followed by whitespace, `>` or `/`, so `<textarea` does not match
    // `<text`, and `<Table>` never matches `<table`.
    if (new RegExp("<" + tag + "[\\s>/]").test(text)) {
      found.push(`<${tag}> — use ${primitive}`);
    }
  }
  return found;
}

/**
 * Opening tags of prop-dropping primitives that carry a `data-*` attribute.
 *
 * Written with `indexOf` rather than a constructed regex on purpose: this is the
 * check whose first version silently could not match, and string scanning has
 * no escape-sequence trap to fall into.
 */
function droppedHandles(text: string): string[] {
  const found: string[] = [];
  for (const tag of DROPS_REST) {
    const open = `<${tag}`;
    let from = 0;
    for (;;) {
      const start = text.indexOf(open, from);
      if (start === -1) break;
      from = start + open.length;

      // `<Calloutish` is not `<Callout`.
      const next = text[start + open.length];
      if (next !== undefined && /[A-Za-z0-9]/.test(next)) continue;

      const end = text.indexOf(">", start);
      if (end === -1) continue;
      if (/\sdata-[a-z-]+=/.test(text.slice(start, end))) {
        found.push(`<${tag}> carries a data-* attribute it will drop`);
      }
    }
  }
  return found;
}

describe("every surface composes react-fancy", () => {
  const files = sources(SRC);

  test("there is source to scan — a passing empty scan proves nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no component hand-rolls an element react-fancy already covers", () => {
    const offenders = files.flatMap((file) =>
      handRolled(readFileSync(file, "utf8")).map((m) => `${file.split(/[\\/]/).pop()}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });

  test("no stable handle is put on a primitive that DROPS unknown props", () => {
    // Four handles in this package were going nowhere before this existed:
    // -break, -degraded, -ladder-refusal and -ticket-blocked. A stable handle
    // no selector can find is not a handle, and an agent addressing it finds
    // nothing.
    const offenders = files.flatMap((file) =>
      droppedHandles(readFileSync(file, "utf8")).map((m) => `${file.split(/[\\/]/).pop()}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the scanners fire on a known offender", () => {
  // Without these, a scanner that can never match reads exactly like a clean
  // codebase. That is not hypothetical here: the drops-rest scan shipped in
  // that state for one commit and had to be caught by hand.

  test("the hand-rolled scan catches a raw table", () => {
    expect(handRolled("<div><table className='x'>")).toEqual(["<table> — use Table"]);
  });

  test("…and does not fire on the primitive it is telling you to use", () => {
    expect(handRolled("<Table className='x'><Table.Row />")).toEqual([]);
  });

  test("the drops-rest scan catches a data attribute on a one-line Callout", () => {
    expect(droppedHandles('<Callout data-fancy-trading-degraded="x" color="amber">')).toHaveLength(1);
  });

  test("…and on a MULTI-LINE one, which is how they are actually written", () => {
    expect(
      droppedHandles('<Callout\n  data-fancy-trading-break={kind}\n  color="red"\n>'),
    ).toHaveLength(1);
  });

  test("…and leaves a clean Callout alone", () => {
    expect(droppedHandles('<Callout color="red">\n  <p data-x="1" />')).toEqual([]);
  });

  test("…and is not fooled by a component whose name merely starts the same", () => {
    expect(droppedHandles('<CalloutStack data-x="1">')).toEqual([]);
  });
});

describe("the one deliberate exception", () => {
  test("the mode marker is a bare span, and the file says why", () => {
    // `<ModeMarker>` is a `<span>` with forced inline styles rather than a
    // `Badge`, and that is the point: a Badge is themeable, and themeable is the
    // one property a safety marker must not have. A `<span>` is not on the
    // covered list, so nothing above catches it — this asserts the REASON is
    // written down, because an undocumented exception is how a rule erodes.
    const marker = readFileSync(join(SRC, "chrome", "ModeMarker.tsx"), "utf8");
    expect(marker).toContain("Badge");
    expect(marker.toLowerCase()).toContain("themeable is the property");
  });
});
