/**
 * Rule 2 — Fancy Exclusive.
 *
 * > Anything we build is built from the Fancy suite's own components… They do
 * > not hand-roll HTML that a Fancy primitive already covers.
 * >
 * > Two reasons, and the second is the one that bites: a hand-rolled card is a
 * > card the kit never gets asked to support, so the gap never surfaces; and a
 * > surface built from something else is a surface that quietly stops being a
 * > demonstration of the thing we sell.
 *
 * The rule is easy to agree with and easy to break, because a `<table>` is
 * quicker to type than a `<Table>` and nothing complains. This complains.
 *
 * It caught three surfaces on the first run — the ladder, the book and the tape
 * all had hand-rolled `<table>` markup, and the ladder had a bare `<button>`.
 * `react-fancy`'s `Table` forwards `onClick`, `onContextMenu`, `onMouseUp` and
 * every `data-*` onto the underlying `<tr>` / `<td>`, so there was no reason
 * beyond haste; converting them changed no test.
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
 * `section`, `header`, `dl`) are NOT here — the kit has no primitive for a
 * flex row, and pretending otherwise would make the rule absurd rather than
 * useful.
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

describe("every surface composes react-fancy", () => {
  const files = sources(SRC);

  test("there is source to scan — a passing empty scan proves nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no component hand-rolls an element react-fancy already covers", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [tag, primitive] of Object.entries(COVERED)) {
        // `<tag` followed by whitespace, `>` or `/`, so `<textarea` does not
        // match `<text`, and a `<Table>` never matches `<table`.
        if (new RegExp(`<${tag}[\\s>/]`).test(text)) {
          offenders.push(`${file.split(/[\\/]/).pop()}: <${tag}> — use ${primitive}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the ONE deliberate exception is the mode marker, and it says why", () => {
    // `<ModeMarker>` is a bare `<span>` with forced inline styles rather than a
    // `Badge`, and that is the point: a Badge is themeable, and themeable is the
    // one property a safety marker must not have. A `<span>` is not on the
    // covered list, so nothing above catches it — this asserts the REASON is
    // written down, because an undocumented exception is how a rule erodes.
    const marker = readFileSync(join(SRC, "chrome", "ModeMarker.tsx"), "utf8");
    expect(marker).toContain("Badge");
    expect(marker.toLowerCase()).toContain("themeable is the property");
  });
});
