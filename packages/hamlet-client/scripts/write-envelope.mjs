// Write a save envelope from the JS side at a known point, for the other hosts'
// cross-host tests: the same key-for-key shape main.ts writes to localStorage.
// Point: asked Mira about the road, standing at the tree with the ambient dealt.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine as StoryletEngine } from "@storylet-studio/runtime";
import { serializeState } from "@storylet-studio/play-helpers";
import { Engine as PatterEngine } from "@patterkit/runtime";
import { serializeState as patterSerialize } from "@patterkit/play-helpers";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mid = process.argv.includes("--mid");
const out = process.argv.find((a) => a.endsWith(".json")) ?? join(pkg, `../../ports/godot/HamletDemo/test/fixtures/envelope-from-js${mid ? "-mid" : ""}.json`);
const world = new Map([["time_of_day", "day"], ["knows_road", false]]);
const resolver = { get: (n) => world.get(n), set: (n, v) => { world.set(n, v); } };
const sb = JSON.parse(readFileSync(join(pkg, "dist/hamlet.storyletsc"), "utf8"));
const pb = JSON.parse(readFileSync(join(pkg, "dist/hamlet.patterc"), "utf8"));
const storylets = new StoryletEngine(sb, { seed: 7, world: resolver });
const patter = new PatterEngine(pb, { seed: 7, world: resolver });
const story = storylets.openFlow("main"); story.dealMany();
// The demo opens with one card: arrive at the gate, which moves the act and deals the village.
const gate = story.deal("the-inn").find((c) => c.gameId === "arrive-at-the-gate");
if (!gate) throw new Error("the inn did not deal arrive-at-the-gate");
story.play(gate.id, "step-through", "the-inn"); story.dealMany();
const settle = story.deal("the-inn").find((c) => c.gameId === "settle-at-the-inn");
const flow = patter.openFlow("village"); if (!flow.goto("settle-at-the-inn")) throw new Error("no scene settle-at-the-inn");   // ONE flow per performed box; a card is a goto
if (mid) {
  // Stop at the choice: a save taken MID-SCENE. Loading this elsewhere must bring
  // the conversation back with its options, which only Patter's half can do.
  const shown = [];
  for (;;) { const s = flow.advance();
    if (s.type === "text") shown.push({ kind: "text", text: s.text });
    if (s.type === "line") shown.push({ kind: "line", character: s.characterName ?? s.character ?? "", text: s.text });
    if (s.type === "choice") break; }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ storylets: serializeState(storylets), patter: patterSerialize(patter), world: Object.fromEntries(world), at: "the-inn",
    performing: { card: { id: settle.id, gameId: settle.gameId, title: settle.title }, shown, outcome: null, labelled: null }, _expect_choices: 2 }, null, 2));
  console.log(`wrote ${out}: mid-scene at the inn, 2 choices pending`); process.exit(0);
}
// The resolution rule, as the client has it: an event wins, else the outcome
// named on the option taken, else the card's only outcome (performance.js).
let outcome = null, labelled = null;
for (;;) { const s = flow.advance();
  if (s.type === "choice") {
    const picked = s.options.find((o) => o.prompt?.text?.includes("road north"));
    labelled = picked.gameData?.outcome ?? labelled;
    flow.choose(picked.id); continue;
  }
  if (s.type === "gameEvent") outcome = s.gameData?.outcome;
  if (s.type === "end") break; }
const declared = story.outcomes(settle.id, "the-inn").map((o) => o.gameId);
story.play(settle.id, outcome ?? labelled ?? (declared.length === 1 ? declared[0] : null), "the-inn"); story.dealMany();
const at = "the-mystic-tree"; const hand = story.deal(at).map((c) => c.gameId);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ storylets: serializeState(storylets), patter: patterSerialize(patter), world: Object.fromEntries(world), at, performing: null, _expect_hand: hand }, null, 2));
console.log(`wrote ${out}: at ${at}, hand [${hand}], knows_road ${world.get("knows_road")}`);
