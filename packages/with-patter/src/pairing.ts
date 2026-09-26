// ---------------------------------------------------------------------------
// Cards against their scenes, on the two PUBLISHED bundles: the build-time
// check a game runs so the naming convention is safe (lifted from the Hamlet's
// scripts/pairing.mjs, whose messages it keeps). Nothing declares the links, so
// nothing else validates them: the failure it catches is a card that performs
// no dialogue, or a branch that ends without saying what happened, and both
// look exactly like content somebody meant to write.
//
// A card finds its scene as Patter's runtime resolves a reference: an internal
// id first, else an address (a pinned gameId, else the name's slug). Storyletter
// runs the same analysis on the project as you edit (ops `patter-link.ts`, which
// takes the two walkers below from here); this is the game's copy, on what ships.
// ---------------------------------------------------------------------------

import { gameIdify } from "@storylet-studio/model";

/** Every gameEvent outcome id anywhere under a compiled node, in document order. */
export function outcomesReported(node: unknown): string[] {
  const found: string[] = [];
  (function walk(n: unknown): void {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as { kind?: unknown; gameData?: { outcome?: unknown } };
    if (o.kind === "gameEvent" && typeof o.gameData?.outcome === "string") found.push(o.gameData.outcome);
    for (const v of Object.values(n)) walk(v);
  })(node);
  return found;
}

/** One choice option in a compiled scene, as the pairing reads it. */
export interface BundleOption {
  id: string;
  /** The string id of the words the player picks, when the option has any. */
  promptId?: string;
  /** The outcome the option labels itself with, if any. */
  outcome: string | null;
  /** The gameEvent outcomes its branch fires, which win over the label. */
  overrides: string[];
}

/** Every choice option in a compiled scene (a group carrying a prompt). */
export function optionsOf(scene: unknown): BundleOption[] {
  const found: BundleOption[] = [];
  (function walk(n: unknown): void {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const o = n as { type?: unknown; prompt?: { id?: unknown }; id?: unknown; gameData?: { outcome?: unknown }; children?: unknown };
    if (o.type === "group" && o.prompt !== undefined) {
      found.push({
        id: String(o.id),
        ...(typeof o.prompt?.id === "string" ? { promptId: o.prompt.id } : {}),
        outcome: typeof o.gameData?.outcome === "string" ? o.gameData.outcome : null,
        overrides: outcomesReported(o.children ?? []),
      });
    }
    // The prompt is text, never structure: walking it could mistake a nested group for an option.
    for (const [k, v] of Object.entries(n)) if (k !== "prompt") walk(v);
  })(scene);
  return found;
}

interface BundleCard { id: string; gameId?: string; outcomes?: { gameId?: string; id: string }[] }
interface BundleScene { name?: string; gameId?: string; [key: string]: unknown }

/**
 * Compare a compiled storylet bundle with a compiled Patter bundle. Returns the problems, one
 * readable line each; empty means they line up.
 *
 * `boxes` (box gameIds) limits the check to the boxes the game performs through Patter: in those,
 * a card with no scene is a problem, and so is a scene no card plays. Without it, every card that
 * has a scene is checked and none is required to have one.
 *
 * The rule enforced is the one the Performer plays by: a gameEvent wins, else the label on the
 * option taken, else the card's only outcome. So a scene whose card has one outcome need say
 * nothing, and one whose card has several must leave no path that says nothing.
 */
export function checkPairing(storyletBundle: unknown, patterBundle: unknown, boxes?: readonly string[]): string[] {
  const problems: string[] = [];
  const scenes = ((patterBundle as { scenes?: Record<string, BundleScene> }).scenes) ?? {};
  const address = (s: BundleScene): string => s.gameId?.trim() || gameIdify(s.name ?? "");
  const byAddress = new Map(Object.entries(scenes).map(([id, s]) => [address(s), id]));
  const sceneFor = (ref: string): string | undefined => (scenes[ref] ? ref : byAddress.get(ref));
  const played = new Set<string>();

  const allBoxes = ((storyletBundle as { boxes?: { gameId?: string; id: string; decks?: { cards?: BundleCard[] }[] }[] }).boxes) ?? [];
  for (const box of allBoxes) {
    if (boxes && !boxes.includes(box.gameId ?? box.id)) continue;
    for (const deck of box.decks ?? []) {
      for (const card of deck.cards ?? []) {
        const name = card.gameId ?? card.id;
        const id = sceneFor(name);
        if (id === undefined) {
          if (boxes) problems.push(`card "${name}" has no scene of that name`);
          continue;
        }
        played.add(id);
        const scene = scenes[id];
        const declared = (card.outcomes ?? []).map((o) => o.gameId ?? o.id);
        const options = optionsOf(scene);
        const events = outcomesReported(scene);
        const named = [...new Set([...events, ...options.flatMap((o) => (o.outcome ? [o.outcome] : []))])];

        for (const n of named) {
          if (!declared.includes(n)) {
            problems.push(`scene "${name}" names outcome "${n}", which that card does not declare (it declares: ${declared.join(", ") || "none"})`);
          }
        }
        if (declared.length > 1) {
          if (options.length === 0 && events.length === 0) {
            problems.push(`scene "${name}" says nothing about its outcome, and its card declares ${declared.length} (${declared.join(", ")}): label its options, or fire a gameEvent`);
          }
          for (const o of options) {
            if (!o.outcome && o.overrides.length === 0) {
              problems.push(`option "${o.id}" in scene "${name}" names no outcome and fires no gameEvent, so taking it leaves the host guessing between ${declared.join(", ")}`);
            }
          }
          for (const d of declared) {
            if (!named.includes(d)) problems.push(`outcome "${d}" of card "${name}" is named by no option and no gameEvent`);
          }
        }
      }
    }
  }
  if (boxes) {
    for (const [id, scene] of Object.entries(scenes)) {
      if (!played.has(id)) problems.push(`scene "${scene.gameId?.trim() || id}" belongs to no card, so nothing can ever play it`);
    }
  }
  return problems;
}
