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
const settle = story.deal("the-inn").find((c) => c.gameId === "settle-at-the-inn");
const flow = patter.openFlow("performance", { scene: "settle-at-the-inn" });
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
    performing: { card: { id: settle.id, gameId: settle.gameId, title: settle.title }, shown, outcome: null }, _expect_choices: 2 }, null, 2));
  console.log(`wrote ${out}: mid-scene at the inn, 2 choices pending`); process.exit(0);
}
let outcome = null;
for (;;) { const s = flow.advance();
  if (s.type === "choice") { flow.choose(s.options.find((o) => o.prompt?.text?.includes("road north")).id); continue; }
  if (s.type === "gameEvent") outcome = s.gameData?.outcome;
  if (s.type === "end") break; }
story.play(settle.id, outcome, "the-inn"); story.dealMany();
const at = "the-mystic-tree"; const hand = story.deal(at).map((c) => c.gameId);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ storylets: serializeState(storylets), patter: patterSerialize(patter), world: Object.fromEntries(world), at, performing: null, _expect_hand: hand }, null, 2));
console.log(`wrote ${out}: at ${at}, hand [${hand}], knows_road ${world.get("knows_road")}`);
