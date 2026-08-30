// ---------------------------------------------------------------------------
// Builds the corpus from the authored fixtures, sanity-checks its internal
// references, file-snapshots corpus.json (the portable artifact), and
// REPLAYS every case through the reference runtime - the expectations were
// hand-written before the engine existed (contract-first), so this is the
// engine being held to the contract, not the other way round.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { buildCorpus } from "../src/build.js";
import { fixtures } from "../src/cases.js";
import { runExpressionCase, runPeekCase, runScriptedCase, runSpecificityCase } from "../src/runner.js";
import type { Bundle, Card, Expression } from "@storylet-studio/model";

const corpus = buildCorpus(fixtures);

const allCards = (bundle: Bundle): Card<Expression>[] =>
  bundle.boxes.flatMap((box) => box.decks.flatMap((deck) => deck.cards));

describe("corpus", () => {
  it("case names are unique within each family", () => {
    for (const family of ["expressions", "specificity", "peek", "scripted"] as const) {
      const names = corpus[family].map((c) => c.name);
      expect(new Set(names).size, family).toBe(names.length);
    }
  });

  it("every expression case carries a compiled ast", () => {
    for (const c of [...corpus.expressions, ...corpus.specificity]) {
      expect(Array.isArray(c.ast), c.name).toBe(true);
    }
  });

  it("expression cases carry exactly one of expected / expectError", () => {
    for (const c of corpus.expressions) {
      expect(c.expectError === true || c.expected !== undefined, c.name).toBe(true);
      expect(c.expectError === true && c.expected !== undefined, c.name).toBe(false);
    }
  });

  it("peek expectations reference cards present in their bundle", () => {
    for (const c of corpus.peek) {
      const cardIds = new Set(allCards(c.bundle).map((card) => card.id));
      for (const id of c.expect) expect(cardIds.has(id), `${c.name}: ${id}`).toBe(true);
    }
  });

  it("scripted ops reference hands and cards present in their bundle", () => {
    for (const c of corpus.scripted) {
      const cardIds = new Set(allCards(c.bundle).map((card) => card.id));
      const handIds = new Set(c.bundle.boxes.flatMap((b) => b.hands.map((h) => h.id)));
      for (const op of c.script) {
        if (op.op === "peek") {
          for (const id of op.expect ?? []) expect(cardIds.has(id), `${c.name}: ${id}`).toBe(true);
        }
        if (op.op === "play" || op.op === "assertOutcomes") {
          expect(cardIds.has(op.card), `${c.name}: card ${op.card}`).toBe(true);
        }
        if (op.op === "deal") {
          for (const id of [...(op.hands ?? []), ...Object.keys(op.expectBoard ?? {})]) {
            expect(handIds.has(id), `${c.name}: hand ${id}`).toBe(true);
          }
        }
        if (op.op === "assertBoard") {
          for (const id of Object.keys(op.expect ?? {})) {
            expect(handIds.has(id), `${c.name}: hand ${id}`).toBe(true);
          }
        }
      }
    }
  });

  it("every hand carries exactly one of template / rule", () => {
    for (const c of corpus.scripted) {
      for (const box of c.bundle.boxes) {
        const templateIds = new Set(box.handTemplates.map((t) => t.id));
        for (const hand of box.hands) {
          expect((hand.template === undefined) !== (hand.rule === undefined), `${c.name}: ${hand.id}`).toBe(true);
          if (hand.template !== undefined) {
            expect(templateIds.has(hand.template), `${c.name}: ${hand.id} -> ${hand.template}`).toBe(true);
          }
        }
      }
    }
  });

  it("corpus.json is the built corpus (regenerate with `npx vitest run packages/conformance -u`)", async () => {
    await expect(JSON.stringify(corpus, null, 2) + "\n").toMatchFileSnapshot("../corpus.json");
  });
});

describe("reference runtime vs corpus", () => {
  describe("expressions", () => {
    for (const c of corpus.expressions) {
      it(c.name, () => {
        const result = runExpressionCase(c);
        if (c.expectError) {
          expect(result.error, "expected an eval error").toBeDefined();
        } else {
          expect(result.error).toBeUndefined();
          expect(result.value).toEqual(c.expected);
        }
      });
    }
  });

  describe("specificity", () => {
    for (const c of corpus.specificity) {
      it(c.name, () => {
        expect(runSpecificityCase(c)).toBe(c.expected);
      });
    }
  });

  describe("peek", () => {
    for (const c of corpus.peek) {
      it(c.name, () => {
        expect(runPeekCase(c)).toEqual([]);
      });
    }
  });

  describe("scripted", () => {
    for (const c of corpus.scripted) {
      it(c.name, () => {
        expect(runScriptedCase(c)).toEqual([]);
      });
    }
  });
});
