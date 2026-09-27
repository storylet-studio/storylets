// ---------------------------------------------------------------------------
// The worked examples that ship with the app, in the order they are offered.
//
// ONE list, read by the welcome screen and by Help > Open an Example. The
// welcome held it alone until 2026-09-27, when the menu gained its door (the
// kit gallery brief, section 5): once a project was open, the only way back to
// the examples was File > Close Project, a detour for the thing a stuck author
// most wants. Two copies of the list would drift the way the kit lists did.
// ---------------------------------------------------------------------------

export interface ShippedExample {
  /** The folder under `examples/`, which is what `openExample` takes. */
  file: string;
  name: string;
  /** Its size first, then what it shows. */
  hint: string;
  /** A word or two drawn beside the name ("Start here"). */
  badge?: string;
  /** A shorter line for a tile, when the hint runs past three lines there. */
  tile?: string;
  /** What the game has, as a player meets it, as pills on its tile. */
  features?: readonly string[];
}

export const EXAMPLES: readonly ShippedExample[] = [
  { file: "the-hamlet.storylets", name: "The Hamlet",
    hint: "Small. Places, hands and a deck to deal.", badge: "Start here",
    features: ["Village life", "Character stories", "Night and day"] },
  { file: "the-village.storylets", name: "The Village",
    hint: "Full size. Thirteen decks, a drawn map, qualities at work.",
    features: ["Explorable map", "Many storylines", "Story acts"] },
  { file: "port-meridian.storylets", name: "Port Meridian",
    hint: "With a game attached. Five boxes driving contracts, encounters, items, codex and news.",
    tile: "With a game attached, driven by five boxes.",
    features: ["Contracts", "Street encounters", "Found items", "City news"] },
];
