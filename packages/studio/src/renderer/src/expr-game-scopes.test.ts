// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The expression editors and the game's shared scopes folder (patterkit
// design/shared-scopes.md). What an author sees on a pill:
//
//   - another tool's property the folder declares: an ordinary pill whose tip
//     says whose it is, and a misspelt one marked, as any unknown name is;
//   - a game's own token (`@player`) parses at all, which the plain dialect
//     cannot do;
//   - a token nobody declares: the shared vocabulary's ordinary pill, as before;
//   - no folder: exactly the pills of before.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { previewCondition, setGameScopes } from "./expr-panels.js";
import { catalogueFrom, purposeWithOwner } from "./expr-shared.js";
import type { ConditionProperty } from "../../shared/api.js";

const catalogue: ConditionProperty[] = [
  { scope: "story", name: "act", type: "number" },
  { scope: "patter", name: "visits", type: "number", purpose: "How often the guard has shouted", owner: "Patter" },
  { scope: "player", name: "hp", type: "number", owner: "Game" },
];
const FOLDER = { dir: "/game/game-scopes", tokens: ["patter", "player", "weather"], opaque: ["weather"], sharedWorld: false };

/** Each property pill in a condition's preview: its label, whether it is marked, and its tip. */
const pills = (src: string, cat: ConditionProperty[] = catalogue): { label: string; err: boolean; title: string }[] =>
  [...previewCondition(src, cat).querySelectorAll<HTMLElement>(".exed-pill-var")].map((b) => ({
    label: b.textContent ?? "", err: b.classList.contains("exed-pill-err"), title: b.title,
  }));

afterEach(() => setGameScopes(undefined));

describe("the owner, in the tip", () => {
  it("joins the purpose, or stands alone when there is none", () => {
    expect(purposeWithOwner({ purpose: "How often", owner: "Patter" })).toBe("How often (Patter)");
    expect(purposeWithOwner({ owner: "Game" })).toBe("Declared by Game");
    expect(purposeWithOwner({ purpose: "Ours" })).toBe("Ours");
    expect(catalogueFrom(catalogue).find((e) => e.name === "hp")!.purpose).toBe("Declared by Game");
    expect(catalogueFrom(catalogue).find((e) => e.name === "act")!.purpose).toBeUndefined();
  });
});

describe("pills, with the folder", () => {
  it("another tool's declared property is ordinary, and says whose it is", () => {
    setGameScopes(FOLDER);
    expect(pills("@patter.visits >= 1")).toEqual([{ label: "patter.visits", err: false, title: "How often the guard has shouted (Patter)" }]);
  });

  it("a name the folder's owner doesn't declare is marked", () => {
    setGameScopes(FOLDER);
    const [p] = pills("@patter.vists >= 1");
    expect(p!.err).toBe(true);
  });

  it("a game's own token parses and draws", () => {
    setGameScopes(FOLDER);
    expect(pills("@player.hp > 0")).toEqual([{ label: "player.hp", err: false, title: "Declared by Game" }]);
  });

  it("an opaque scope takes any name", () => {
    setGameScopes(FOLDER);
    expect(pills("@weather.rain == true")[0]!.err).toBe(false);
  });
});

describe("pills, with no folder", () => {
  it("Patter's names are the other engine's to check, unmarked, and a game token doesn't parse", () => {
    // With no folder the catalogue carries only the project's own properties.
    const own = catalogue.filter((p) => p.owner === undefined);
    expect(pills("@patter.vists >= 1", own)[0]!.err).toBe(false);
    expect(pills("@player.hp > 0", own)).toEqual([]);
  });
});
