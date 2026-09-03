// openFlow after a load: the trap, pinned, and the hook that names it.
//
// A load rebuilds every flow and restores each one's dealt hand. `openFlow` on
// an id that exists REPLACES it - deliberately, and the same in Patter - so a
// host that calls openFlow to "re-take" its handle after a load silently throws
// the restored hand away, and finds out later when `play()` refuses the card as
// not dealt. This happened while building the joint demo, was mis-diagnosed as
// an engine gap, and was "fixed" by re-dealing, which passed its test.
//
// So: the trap is pinned here as behaviour (nobody should "fix" replace into
// silent reuse), `getFlow` is pinned as the right call, and `onReplacedFlow`
// is pinned as the diagnostic that would have caught it on the first run.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/index.js";

// The shipped Hamlet: real hands, deterministic, and the very bundle the
// mistake was made against.
const bundle = () => JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../examples/the-hamlet.storylets/dist/the-hamlet.storyletsc", import.meta.url)), "utf8"));
const ids = (cards: { gameId: string }[]) => cards.map((c) => c.gameId);

describe("openFlow after a load", () => {
  it("REPLACES the restored flow, and the dealt hand goes with it (the trap, pinned)", () => {
    const a = new Engine(bundle(), { seed: 7 });
    const dealt = ids(a.openFlow("main").deal("the-inn"));
    expect(dealt.length).toBeGreaterThan(0);
    const save = a.saveGame();

    const b = new Engine(bundle(), { seed: 7 });
    b.loadGame(save);
    const replaced = b.openFlow("main");
    expect(() => replaced.play(dealt[0]!, "any", "the-inn")).toThrow(/not dealt/);
  });

  it("getFlow keeps the restored hand, which is the call a host wants", () => {
    const a = new Engine(bundle(), { seed: 7 });
    const dealt = ids(a.openFlow("main").deal("the-inn"));
    const save = a.saveGame();

    const b = new Engine(bundle(), { seed: 7 });
    b.loadGame(save);
    const restored = b.getFlow("main")!;
    expect(restored).toBeDefined();
    expect(ids(restored.board()["the-inn"] ?? [])).toEqual(dealt);
  });

  it("onReplacedFlow names the flow and how many cards it was holding", () => {
    const seen: [string, number][] = [];
    const e = new Engine(bundle(), { seed: 7, onReplacedFlow: (id, n) => seen.push([id, n]) });
    const hand = e.openFlow("main").deal("the-inn");
    e.openFlow("main");
    expect(seen).toEqual([["main", hand.length]]);
  });

  it("stays silent when the replaced flow held nothing, and when unset", () => {
    const seen: unknown[] = [];
    const e = new Engine(bundle(), { seed: 7, onReplacedFlow: (...a) => seen.push(a) });
    e.openFlow("main");        // nothing dealt yet
    e.openFlow("main");        // replacing an empty flow is routine, not a warning
    expect(seen).toEqual([]);
    const quiet = new Engine(bundle(), { seed: 7 });
    quiet.openFlow("main").deal("the-inn");
    expect(() => quiet.openFlow("main")).not.toThrow();   // unset hook: zero cost, no effect
  });
});
