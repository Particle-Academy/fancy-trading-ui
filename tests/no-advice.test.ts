/**
 * "No advice, ever." (§3.2)
 *
 * > No component or backend produces a recommendation, a signal, a score, or
 * > anything implying a prediction. We show data and take instructions.
 *
 * That is a rule about what the package does NOT contain, so no ordinary unit
 * test can hold it — the failure mode is a helpful-looking addition six months
 * from now, not a wrong answer today. This scans the source for the vocabulary
 * such an addition would arrive wearing, and fails the build if it appears.
 *
 * It is deliberately a vocabulary check rather than a semantic one. It cannot
 * prove the absence of advice; it can make adding advice require deleting a
 * test that explains why it is forbidden, which is the point.
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
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * Words an advice feature cannot avoid using in its own API. `prediction` is
 * absent on purpose: "prediction market" is an ASSET CLASS this kit supports
 * (Kalshi, Polymarket, §2.8), and banning the word would ban the domain.
 */
const FORBIDDEN = [
  "signal",
  "recommend",
  "recommendation",
  "forecast",
  "advice",
  "advise",
  "buyRating",
  "sellRating",
  "priceTarget",
  "fairValue",
  "overbought",
  "oversold",
  "bullishScore",
  "bearishScore",
  "conviction",
  "shouldBuy",
  "shouldSell",
];

const EXPORT_NAME =
  /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm;

describe("the package exports no advice vocabulary", () => {
  const files = sources(SRC);

  test("there is source to scan at all — a passing empty scan proves nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no exported symbol is named for a recommendation, signal or score", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(EXPORT_NAME)) {
        const name = match[1]!;
        for (const word of FORBIDDEN) {
          if (name.toLowerCase().includes(word.toLowerCase())) {
            offenders.push(`${file}: ${name} (contains "${word}")`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no user-visible string tells anyone what to do with their money", () => {
    // Phrases, not words: "buy" and "sell" are the two sides of every order and
    // appear everywhere legitimately. What cannot appear is the imperative.
    const phrases = [
      /\byou should (buy|sell|short|close|hold)\b/i,
      /\bwe recommend\b/i,
      /\bstrong (buy|sell)\b/i,
      /\b(good|great|best) time to (buy|sell)\b/i,
      /\bexpected to (rise|fall|go up|go down)\b/i,
      /\blikely to (rise|fall|profit)\b/i,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const phrase of phrases) {
        const hit = phrase.exec(text);
        if (hit) offenders.push(`${file}: ${JSON.stringify(hit[0])}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the alert model carries a condition, never a verdict", () => {
    // An alert is a thing the USER asked to be told about. The moment it grows
    // a field the package fills in with an opinion, it is a signal service.
    const alerts = files.filter((f) => /alerts?\.tsx?$/i.test(f));
    expect(alerts.length).toBeGreaterThan(0);
    for (const file of alerts) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/\bstrength\s*[?:]/);
      expect(text).not.toMatch(/\bconfidence\s*[?:]/);
    }
  });
});
