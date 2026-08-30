// The placeholder convention, enforced rather than remembered
// (design/storyletter.md section 2, adopted from Patterpad 2026-08-29).
//
//   <like this>   a placeholder PROMPTING for a value
//   Like this…    a placeholder naming an ACTION (search, replace, filter),
//                 optionally followed by (parenthesised, examples)
//   0 / 1 / N     a numeric field showing the default you get by leaving it
//
// Written as a source scan because the alternative is a UI review that nobody
// runs: a new placeholder is one line in one file, and it is exactly the kind
// of thing that drifts back to bare text without a gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../..", import.meta.url).pathname;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|html)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });

/** Every literal placeholder in the renderer, with where it came from.
 *
 *  TWO shapes, because one was not enough. The direct `placeholder = "..."` is
 *  the common form; the Find window instead holds a `PLACEHOLDER` record keyed
 *  by mode and assigns `placeholder = PLACEHOLDER[mode]`, so three of its four
 *  placeholders were invisible to this gate until 2026-08-29 - a convention
 *  enforced everywhere except the one window that keeps its strings in a
 *  table. They were correct as it happens, which is luck, not a check. */
const placeholders = (): { file: string; text: string }[] => {
  const found: { file: string; text: string }[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    const where = file.slice(SRC.length);
    for (const m of src.matchAll(/placeholder\s*[:=]\s*"([^"]*)"/g)) {
      found.push({ file: where, text: m[1]! });
    }
    // A lookup table: `const SOMETHING_PLACEHOLDER... = { key: "text", ... }`.
    for (const table of src.matchAll(/const\s+\w*PLACEHOLDER\w*[^=]*=\s*\{([^}]*)\}/gi)) {
      for (const entry of table[1]!.matchAll(/:\s*"([^"]*)"/g)) {
        found.push({ file: where, text: entry[1]! });
      }
    }
  }
  return found;
};

const NUMERIC_DEFAULT = /^[0-9N]$/;

describe("placeholder style", () => {
  it("finds the placeholders at all (the scan is the test's own load-bearing part)", () => {
    expect(placeholders().length).toBeGreaterThan(15);
  });

  it("prompts for a value in angle brackets, or names an action with an ellipsis", () => {
    const wrong = placeholders().filter(({ text }) => {
      if (text.startsWith("<") && text.endsWith(">")) return false;   // a value prompt
      if (text.endsWith("…")) return false;                          // an action
      // ...or an action followed by parenthesised EXAMPLES, which is
      // Patterpad's own shape ("Search… (text, title, Game ID, or paste an
      // id)", "Property usage… (@gold, world.threat)"). The rule said
      // endsWith("…") and so refused it, which only surfaced when the scan
      // learned to read lookup tables (2026-08-29) and met the Find window's
      // property placeholder. The examples are the useful half: they teach the
      // syntax of the thing being asked for.
      if (/…\s*\([^)]*\)$/.test(text)) return false;
      if (NUMERIC_DEFAULT.test(text)) return false;                  // a shown default
      return true;
    });
    expect(wrong.map((w) => `${w.file}: ${JSON.stringify(w.text)}`)).toEqual([]);
  });

  it("keeps the brackets lower case, so an example value is the only capital", () => {
    const shouty = placeholders().filter(({ text }) =>
      text.startsWith("<") && /^<[A-Z]/.test(text) && !text.startsWith("<e.g."));
    expect(shouty.map((w) => w.text)).toEqual([]);
  });
});
