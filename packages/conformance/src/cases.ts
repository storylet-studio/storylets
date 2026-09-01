// ---------------------------------------------------------------------------
// The authored conformance fixtures. `expected` / `expect` values are the
// CONTRACT - written by hand, never derived from the engine, with ONE caveat:
// where the seeded PRNG is involved, the expectation is computed from the
// contractual mulberry32 algorithm (design/conformance.md section 3), since
// hand-predicting draws is not meaningful. Those cases are marked
// PRNG-computed. New engine behaviour lands here first; buildCorpus compiles
// these into the portable corpus.json.
//
// Round 2 (2026-07-28): the corpus speaks the flat model - peek(box,
// criteria) and deal(hand); claims and copies replace the exclusive flag;
// tag groups replace dimensions; hand templates + hands replace queries +
// standing hands; each box has its own turn counter (turn.b_x); the place
// group pins cards to hands. The new families cite their SandboxStories
// ids.
// ---------------------------------------------------------------------------

import type { Fixtures } from "./types.js";

export const fixtures: Fixtures = {
  // --- Family X - expressions ------------------------------------------------
  expressions: [
    { name: "arithmetic precedence",
      src: "1 + 2 * 3", scopes: {}, expected: 7 },

    { name: "comparison and logic",
      src: "@story.gold >= 5 and not @story.banned",
      scopes: { story: { gold: 7, banned: false } }, expected: true },

    { name: "string equality against a hand arg",
      src: '@hand.npc == "elder"',
      scopes: { hand: { npc: "elder" } }, expected: true },

    { name: "division yields fractions",
      src: "@story.gold / 4", scopes: { story: { gold: 10 } }, expected: 2.5 },

    { name: "unary negation",
      src: "-@story.debt < 0", scopes: { story: { debt: 3 } }, expected: true },

    { name: "a name absent from the environment is an eval error",
      src: "@story.missing == 1", scopes: { story: {} }, expectError: true },

    { name: "check_flags: all deltas hold",
      src: "check_flags(@story.visited, +docks, -market)",
      scopes: { story: { visited: ["docks"] } }, expected: true },

    { name: "check_flags: a negative delta fails",
      src: "check_flags(@story.visited, +docks, -market)",
      scopes: { story: { visited: ["docks", "market"] } }, expected: false },

    { name: "set_flags applies deltas, result canonically sorted",
      src: "set_flags(@story.visited, +market, -docks)",
      scopes: { story: { visited: ["docks"] } }, expected: ["market"] },

    { name: "random(a, b) is the seeded inclusive integer range",  // PRNG-computed
      src: "random(1, 10)", scopes: {}, seed: 42, expected: 7 },
  ],

  // --- Family S - specificity ------------------------------------------------
  specificity: [
    { name: "matching atom scores 1",
      src: "@story.x == 5", scopes: { story: { x: 5 } }, expected: 1 },

    { name: "failing atom scores 0",
      src: "@story.x == 5", scopes: { story: { x: 4 } }, expected: 0 },

    { name: "and sums its branches",
      src: "@story.x == 5 and @story.y > 3",
      scopes: { story: { x: 5, y: 4 } }, expected: 2 },

    { name: "or takes the best matching branch",
      src: "@story.a == 1 or @story.b == 1",
      scopes: { story: { a: 1, b: 1 } }, expected: 1 },

    { name: "or with a strong branch matched scores the branch",
      src: "(@story.a and @story.b and @story.c) or @story.x",
      scopes: { story: { a: true, b: true, c: true, x: false } }, expected: 3 },

    { name: "same or matched only via the weak branch",
      src: "(@story.a and @story.b and @story.c) or @story.x",
      scopes: { story: { a: false, b: true, c: true, x: true } }, expected: 1 },

    { name: "not flips polarity (De Morgan): a held-false or sums",
      src: "not (@story.a or @story.b)",
      scopes: { story: { a: false, b: false } }, expected: 2 },

    { name: "check_flags counts its flag operands",
      src: "check_flags(@story.f, +a, +b, +c)",
      scopes: { story: { f: ["a", "b", "c"] } }, expected: 3 },
  ],

  // --- Family P - peek ---------------------------------------------------------
  // Every peek case is run TWICE by the runner and must return the identical
  // list: a peek registers nothing (schema 3.5; SandboxStories S3).
  peek: [
    { name: "a failing condition filters the card out",
      story: [{ name: "flag", type: "boolean", default: false }],
      cards: [
        { id: "c_yes", priority: 1 },
        { id: "c_no", priority: 0, condition: "@story.flag" },
      ],
      expect: ["c_yes"] },

    // Truthiness for a bare condition, aligned with Patterplay's `truthy` on
    // 2026-09-01. Until then a string or a flag list read as false here and as
    // its JS coercion there, so the same value in the same shared property
    // registry answered a condition differently depending on which engine
    // asked. Nothing in this corpus used a non-boolean bare condition, which is
    // exactly why the drift survived; these four cases are the pin.
    { name: "a non-empty string passes as a bare condition",
      story: [{ name: "title", type: "string", default: "onwards" }],
      cards: [
        { id: "c_named", condition: "@story.title" },
      ],
      expect: ["c_named"] },

    { name: "an empty string fails as a bare condition",
      story: [{ name: "title", type: "string", default: "" }],
      cards: [
        { id: "c_free" },
        { id: "c_named", condition: "@story.title" },
      ],
      expect: ["c_free"] },

    { name: "a non-empty flag list passes as a bare condition",
      story: [{ name: "marks", type: "flags", default: ["seen"] }],
      cards: [
        { id: "c_flagged", condition: "@story.marks" },
      ],
      expect: ["c_flagged"] },

    { name: "an empty flag list fails as a bare condition",
      story: [{ name: "marks", type: "flags", default: [] }],
      cards: [
        { id: "c_free" },
        { id: "c_flagged", condition: "@story.marks" },
      ],
      expect: ["c_free"] },

    { name: "a shut deck gate hides the whole deck",
      story: [{ name: "open", type: "boolean", default: false }],
      decks: [
        { id: "k_main", cards: [{ id: "c_free" }] },
        { id: "k_shut", condition: "@story.open", cards: [{ id: "c_locked" }] },
      ],
      expect: ["c_free"] },

    { name: "priority orders the stock, descending",
      cards: [
        { id: "c_low", priority: 1 },
        { id: "c_mid", priority: 5 },
        { id: "c_high", priority: 10 },
      ],
      expect: ["c_high", "c_mid", "c_low"] },

    { name: "an expression priority evaluates in the ask environment",
      story: [{ name: "boost", type: "number", default: 2 }],
      cards: [
        { id: "c_boosted", priority: "@story.boost * 10" },
        { id: "c_flat", priority: 5 },
      ],
      expect: ["c_boosted", "c_flat"] },

    { name: "specificity ranks equal priorities by matched constraints",
      story: [
        { name: "a", type: "boolean", default: true },
        { name: "b", type: "boolean", default: true },
      ],
      cards: [
        { id: "c_none" },
        { id: "c_one", condition: "@story.a" },
        { id: "c_two", condition: "@story.a and @story.b" },
      ],
      expect: ["c_two", "c_one", "c_none"] },

    // Tie run enters in id order [c_none, c_one, c_two]; seed-0 shuffle -> [1, 2, 0].
    { name: "specificity toggle off: conditions stop ranking, ties shuffle",  // PRNG-computed
      ranking: { specificity: false },
      story: [
        { name: "a", type: "boolean", default: true },
        { name: "b", type: "boolean", default: true },
      ],
      cards: [
        { id: "c_none" },
        { id: "c_one", condition: "@story.a" },
        { id: "c_two", condition: "@story.a and @story.b" },
      ],
      expect: ["c_one", "c_two", "c_none"] },

    { name: "full tie: the seeded shuffle is the contract",  // PRNG-computed
      cards: [{ id: "c_alpha" }, { id: "c_beta" }, { id: "c_gamma" }],
      expect: ["c_beta", "c_gamma", "c_alpha"] },

    { name: "criteria filter tags; an absent group is a wildcard",
      cards: [
        { id: "c_docks", priority: 2, tags: { zone: ["docks"] } },
        { id: "c_market", priority: 3, tags: { zone: ["market"] } },
        { id: "c_wild", priority: 1 },
      ],
      criteria: { zone: "docks" },
      expect: ["c_docks", "c_wild"] },

    { name: "criteria surface as @hand, by group name (matching)",
      cards: [
        { id: "c_dockside", priority: 1, condition: '@hand.zone == "docks"' },
        { id: "c_any", priority: 0 },
      ],
      criteria: { zone: "docks" },
      expect: ["c_dockside", "c_any"] },

    { name: "criteria surface as @hand, by group name (non-matching)",
      cards: [
        { id: "c_dockside", priority: 1, tags: { zone: ["docks", "market"] }, condition: '@hand.zone == "docks"' },
        { id: "c_any", priority: 0 },
      ],
      criteria: { zone: "market" },
      expect: ["c_any"] },

    { name: "tag properties compose into @hand",
      setup: { value: { v_docks: { danger: 3 } } },
      cards: [{ id: "c_risky", condition: "@hand.danger >= 2" }],
      criteria: { zone: "docks" },
      expect: ["c_risky"] },

    { name: "tag properties: default keeps the card out",
      cards: [{ id: "c_risky", condition: "@hand.danger >= 2" }],
      criteria: { zone: "docks" },
      expect: [] },

    { name: "the peek cap takes the top N after ordering",
      cards: [
        { id: "c_low", priority: 1 },
        { id: "c_mid", priority: 5 },
        { id: "c_high", priority: 10 },
      ],
      n: 2, expect: ["c_high", "c_mid"] },

    { name: "multi-tag cards match any bound tag",
      cards: [
        { id: "c_both", priority: 2, tags: { zone: ["docks", "market"] } },
        { id: "c_docks", priority: 1, tags: { zone: ["docks"] } },
      ],
      criteria: { zone: "market" },
      expect: ["c_both"] },

    { name: "a deck gate may read @hand (open)",
      setup: { value: { v_docks: { danger: 2 } } },
      decks: [{ id: "k_hot", condition: "@hand.danger >= 1", cards: [{ id: "c_g" }] }],
      criteria: { zone: "docks" },
      expect: ["c_g"] },

    { name: "a deck gate may read @hand (shut at the default)",
      decks: [{ id: "k_hot", condition: "@hand.danger >= 1", cards: [{ id: "c_g" }] }],
      criteria: { zone: "docks" },
      expect: [] },

    { name: "@box properties read in conditions",
      boxProperties: [{ name: "heat", type: "number", default: 2 }],
      cards: [
        { id: "c_hot", priority: 1, condition: "@box.heat >= 2" },
        { id: "c_cold", priority: 0, condition: "@box.heat < 2" },
      ],
      expect: ["c_hot"] },

    { name: "@deck properties read in conditions",
      decks: [{ id: "k_main", properties: [{ name: "visits", type: "number", default: 0 }],
        cards: [{ id: "c_first", condition: "@deck.visits == 0" }] }],
      expect: ["c_first"] },

    { name: "an eval error is never a silent pass",
      cards: [
        { id: "c_bad", priority: 5, condition: "@hand.nope > 1" },   // not composed in this ask
        { id: "c_ok", priority: 1 },
      ],
      expect: ["c_ok"] },

    { name: "a stripped bundle plays identically (metadata is not behaviour)",
      metadata: "stripped",
      cards: [
        { id: "c_named", priority: 1, title: "A secret name" },
        { id: "c_plain", priority: 0 },
      ],
      expect: ["c_named", "c_plain"] },

    // --- the place group (schema 2.4; the boundary of "exactly this hand") ---
    { name: "a placed card is invisible to a bare peek (inverted wildcard)",
      cards: [
        { id: "c_placed", priority: 2, tags: { place: ["h_stall"] } },
        { id: "c_free", priority: 1 },
      ],
      hands: [{ id: "h_stall", rule: {} }],
      expect: ["c_free"] },

    { name: "a place criterion opens the placed card to a peek",
      cards: [
        { id: "c_placed", priority: 2, tags: { place: ["h_stall"] } },
        { id: "c_free", priority: 1 },
      ],
      hands: [{ id: "h_stall", rule: {} }],
      criteria: { place: "stall" },
      expect: ["c_placed", "c_free"] },

    // --- group names are box-scoped (schema 1; boxes namespace them) --------
    // `otherBox` gives the bundle a second box whose own group ALSO carries
    // the gameId "zone". Two boxes naming a group the same way is ordinary
    // authoring, so each ask must resolve the name - and the tag under it -
    // in the box it is asking, never bundle-wide.
    { name: "a group name shared by two boxes resolves in the asked box",
      cards: [
        { id: "c_xdocks", priority: 2, tags: { zone: ["docks"] } },
        { id: "c_xmarket", priority: 1, tags: { zone: ["market"] } },
      ],
      otherBox: { cards: [{ id: "c_ydocks", tags: { zone: ["docks"] } }] },
      criteria: { zone: "docks" },
      expect: ["c_xdocks"] },

    { name: "the same criteria against the other box resolve that box's group",
      cards: [{ id: "c_xdocks", tags: { zone: ["docks"] } }],
      otherBox: {
        cards: [
          { id: "c_ydocks", priority: 2, tags: { zone: ["docks"] } },
          { id: "c_ymarket", priority: 1, tags: { zone: ["market"] } },
        ],
      },
      box: "other",
      criteria: { zone: "docks" },
      expect: ["c_ydocks"] },

    { name: "a tag bound by name binds the asked box's tag, not the other box's",
      // Only b_y's `v_docks_y` carries danger 3; b_x's `v_docks` keeps its
      // default 0. Asking b_x must compose b_x's tag properties.
      setup: { value: { v_docks_y: { danger: 3 } } },
      cards: [
        { id: "c_xcalm", priority: 1, condition: "@hand.danger == 0" },
        { id: "c_xwild", priority: 2, condition: "@hand.danger == 3" },
      ],
      otherBox: { cards: [{ id: "c_yplain", tags: { zone: ["docks"] } }] },
      criteria: { zone: "docks" },
      expect: ["c_xcalm"] },
  ],

  // --- Family SC - scripted ------------------------------------------------------
  // Plays go through hands: you never play a card from inside the deck
  // (schema 3.1, the look/use rule). `h_q` is the plain standalone hand.
  scripted: [
    { name: "outcome changes evaluate against pre-play state",
      story: [
        { name: "gold", type: "number", default: 5 },
        { name: "double", type: "number", default: 0 },
      ],
      cards: [{ id: "c_pay", outcomes: [{ id: "o_take", changes: {
        "@story.gold": "@story.gold + 1",
        "@story.double": "@story.gold * 2",     // pre-play gold: 5, not 6
      } }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_pay"] } },
        { op: "play", card: "c_pay", outcome: "take", from: "h_q" },
        { op: "assertState", expect: { "story.gold": 6, "story.double": 10 } },
      ] },

    { name: "redraw N: cooldown is turn-after-play plus N, on the box's clock",
      cards: [{ id: "c_patrol", redraw: 2, outcomes: [{ id: "o_done" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "assertState", expect: { "turn.b_x": 0 } },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_patrol"] } },
        { op: "play", card: "c_patrol", outcome: "done", from: "h_q" },   // turn -> 1; eligible at 1 + 2 = 3
        { op: "assertState", expect: { "turn.b_x": 1 } },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "advanceTurns", box: "b_x", n: 1 },                         // turn 2
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "advanceTurns", box: "b_x", n: 1 },                         // turn 3
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_patrol"] } },
      ] },

    { name: "redraw never survives any number of turns",
      cards: [{ id: "c_once", redraw: "never", outcomes: [{ id: "o_done" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_once"] } },
        { op: "play", card: "c_once", outcome: "done", from: "h_q" },
        { op: "advanceTurns", box: "b_x", n: 500 },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: [] } },
      ] },

    { name: "redraw always is immediately re-eligible",
      cards: [{ id: "c_greet", outcomes: [{ id: "o_hi" }] }],   // redraw defaults to "always"
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_greet"] } },
        { op: "play", card: "c_greet", outcome: "hi", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_greet"] } },
      ] },

    { name: "turn advance per play is configurable",
      settings: { playAdvancesTurns: 0 },
      cards: [{ id: "c_greet", outcomes: [{ id: "o_hi" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_greet"] } },
        { op: "play", card: "c_greet", outcome: "hi", from: "h_q" },
        { op: "assertState", expect: { "turn.b_x": 0 } },          // project default: no advance
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_greet"] } },
        { op: "play", card: "c_greet", outcome: "hi", from: "h_q", advanceTurns: 3 },  // per-call override
        { op: "assertState", expect: { "turn.b_x": 3 } },
      ] },

    { name: "a gated-shut outcome cannot be played",
      story: [{ name: "gold", type: "number", default: 5 }],
      cards: [{ id: "c_job", outcomes: [
        { id: "o_ok" },
        { id: "o_rich", condition: "@story.gold >= 10",
          changes: { "@story.gold": "@story.gold + 100" } },
      ] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_job"] } },
        { op: "play", card: "c_job", outcome: "rich", from: "h_q", expectError: true },
        { op: "assertState", expect: { "story.gold": 5, "turn.b_x": 0 } },  // error has no side effects
      ] },

    { name: "playing a card that is not on the board is an error (look/use)",
      cards: [{ id: "c_free", outcomes: [{ id: "o_done" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "peek", expect: ["c_free"] },
        // Peeked, never dealt: the world cannot remember what was only
        // looked at (SandboxStories S10).
        { op: "play", card: "c_free", outcome: "done", from: "h_q", expectError: true },
        { op: "assertState", expect: { "turn.b_x": 0 } },
      ] },

    { name: "outcome availability reads current truth, not a deal-time snapshot",
      story: [{ name: "gold", type: "number", default: 5 }],
      cards: [{ id: "c_job", outcomes: [
        { id: "o_ok" },
        { id: "o_rich", condition: "@story.gold >= 10",
          changes: { "@story.gold": "@story.gold - 10" } },
      ] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_job"] } },
        { op: "assertOutcomes", card: "c_job", from: "h_q", expect: { ok: true, rich: false } },
        { op: "setState", story: { gold: 12 } },     // no re-deal
        { op: "assertOutcomes", card: "c_job", from: "h_q", expect: { ok: true, rich: true } },
        { op: "play", card: "c_job", outcome: "rich", from: "h_q" },
        { op: "assertState", expect: { "story.gold": 2 } },
      ] },

    // The order a game offers a card's outcomes in is the order the designer
    // put them in, not the order their ids happen to sort in. Ids here sort
    // leave < pay < stand, and the author's order is the opposite of that for
    // two of the three, so an id-sorted bundle cannot accidentally pass.
    { name: "outcomes reach the game in display order, not id order",
      cards: [{ id: "c_debt", outcomes: [
        { id: "o_stand", order: 0 },
        { id: "o_pay", order: 1 },
        { id: "o_leave", order: 2 },
      ] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_debt"] } },
        { op: "assertOutcomeOrder", card: "c_debt", from: "h_q", expect: ["stand", "pay", "leave"] },
      ] },

    // --- quality: the ordered story-stage type (design/quality.md) -------------
    //
    // Stage names chosen to sort WRONGLY as strings throughout (alphabetically
    // confronted < resolved < troubled), so a port comparing lexicographically
    // cannot pass by accident. Every expectation hand-written first.

    { name: "a quality gates by ladder position, not by the alphabet",
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        { id: "c_mid", priority: 2, condition: '@story.debt >= "confronted"' },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any"] } },
        { op: "setState", story: { debt: "confronted" } },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any", "c_mid"] } },
        { op: "setState", story: { debt: "resolved" } },
        // still >= confronted: later stages stay past earlier gates
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any", "c_mid"] } },
      ] },

    // The chosen tag reads back as @hand.<group>, WHOEVER bound it. A hand
    // binding through a template got this; a hand binding through its own rule
    // did not, because only the template branch filled askNames, so the same
    // card worked at one hand and quietly failed at the other. Found while
    // typing @hand (design/hand-typing.md, the residues).
    { name: "a hand's own binding names its chosen tag, like a template's does",
      groups: [{ id: "d_mood", gameId: "mood", tags: [
        { id: "v_wood", gameId: "wood" }, { id: "v_moor", gameId: "moor" },
      ] }],
      cards: [
        // a seat for each hand that should qualify, so what is being tested is
        // the binding and never the claims ledger
        { id: "c_wood", priority: 2, copies: 2, condition: '@hand.mood == "wood"' },
        // one seat per hand, so the ungated card is about the gate and never
        // about the claims ledger
        { id: "c_any", priority: 1, copies: 3 },
      ],
      hands: [
        // bound by its own rule, the case that was missing
        { id: "h_rule", rule: { bindings: { mood: "wood" } } },
        // bound through a template, the case that already worked
        { id: "h_tpl", template: "t_mood", chosen: { mood: "wood" } },
        { id: "h_other", rule: { bindings: { mood: "moor" } } },
      ],
      templates: [{ id: "t_mood", chooses: ["mood"] }],
      script: [
        { op: "deal", hands: ["h_rule"], expectBoard: { h_rule: ["c_wood", "c_any"] } },
        { op: "deal", hands: ["h_tpl"], expectBoard: { h_tpl: ["c_wood", "c_any"] } },
        { op: "deal", hands: ["h_other"], expectBoard: { h_other: ["c_any"] } },
      ] },

    // A quality on a TAG, read and written through the composed @hand
    // (design/hand-typing.md step C). The ladder has to travel with the value:
    // @hand.peril is whichever bound tag supplied it, so the engine must ask
    // that tag for its stages, and a write has to land back on that same tag
    // and no other. Stage names sort wrongly as strings here too: alphabetical
    // order is calm < deadly < tense, so a lexicographic port fails the first
    // assertion.
    { name: "a quality on a tag gates through @hand by its ladder",
      groups: [{ id: "d_mood", gameId: "mood", tags: [
        { id: "v_wood", gameId: "wood", properties: [{ name: "peril", type: "quality", default: "deadly", stages: ["calm", "tense", "deadly"] }] },
        { id: "v_moor", gameId: "moor", properties: [{ name: "peril", type: "quality", default: "calm", stages: ["calm", "tense", "deadly"] }] },
      ] }],
      cards: [
        { id: "c_risky", priority: 2, condition: '@hand.peril >= "tense"' },
        // two copies, so the ungated card can sit in both hands at once and
        // the second deal is testing the GATE rather than the claims ledger
        { id: "c_any", priority: 1, copies: 2 },
      ],
      hands: [
        { id: "h_wood", rule: { bindings: { mood: "wood" } } },
        { id: "h_moor", rule: { bindings: { mood: "moor" } } },
      ],
      script: [
        // wood is "deadly", which is PAST "tense" on the ladder and BEFORE it
        // in the alphabet; moor is "calm" and fails the same gate. Board order
        // is rank order, so the priority-2 card leads.
        { op: "deal", hands: ["h_wood"], expectBoard: { h_wood: ["c_risky", "c_any"] } },
        { op: "deal", hands: ["h_moor"], expectBoard: { h_moor: ["c_any"] } },
      ] },

    { name: "advance through @hand moves the bound tag, and only that tag",
      groups: [{ id: "d_mood", gameId: "mood", tags: [
        { id: "v_wood", gameId: "wood", properties: [{ name: "peril", type: "quality", default: "calm", stages: ["calm", "tense", "deadly"] }] },
        { id: "v_moor", gameId: "moor", properties: [{ name: "peril", type: "quality", default: "calm", stages: ["calm", "tense", "deadly"] }] },
      ] }],
      cards: [{ id: "c_stir", priority: 1, redraw: "always",
        outcomes: [{ id: "o_up", changes: { "@hand.peril": "advance(@hand.peril)" } }] }],
      hands: [
        { id: "h_wood", rule: { bindings: { mood: "wood" } } },
        { id: "h_moor", rule: { bindings: { mood: "moor" } } },
      ],
      script: [
        { op: "deal", hands: ["h_wood"] },
        { op: "play", card: "c_stir", outcome: "up", from: "h_wood" },
        // the write routes to the tag the hand was bound to, and the other
        // tag's copy of the same name is untouched
        { op: "assertState", expect: { "value.v_wood.peril": "tense", "value.v_moor.peril": "calm" } },
        { op: "deal", hands: ["h_wood"] },
        { op: "play", card: "c_stir", outcome: "up", from: "h_wood" },
        { op: "assertState", expect: { "value.v_wood.peril": "deadly" } },
        { op: "deal", hands: ["h_wood"] },
        { op: "play", card: "c_stir", outcome: "up", from: "h_wood" },
        // saturates on the tag exactly as it does in any other scope
        { op: "assertState", expect: { "value.v_wood.peril": "deadly" } },
      ] },

    { name: "advance steps the ladder and saturates at the last stage",
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [{ id: "c_go", priority: 1, redraw: "always",
        outcomes: [{ id: "o_on", changes: { "@story.debt": "advance(@story.debt)" } }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_go"] } },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        { op: "assertState", expect: { "story.debt": "confronted" } },
        { op: "deal", hands: ["h_q"] },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        { op: "assertState", expect: { "story.debt": "resolved" } },
        { op: "deal", hands: ["h_q"] },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        // off the end: stays at the last rung rather than wrapping or erroring
        { op: "assertState", expect: { "story.debt": "resolved" } },
      ] },

    { name: "an ordering gate against a name that is no stage diagnoses, never silently passes",
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        { id: "c_bad", priority: 2, condition: '@story.debt >= "tpyo"' },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      // The condition errors, so the card is unavailable (the condition-error
      // rule) and the ask still deals what remains.
      script: [{ op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any"] } }],
    },

    { name: "comparing two different qualities diagnoses: their orders are unrelated",
      story: [
        { name: "debt", type: "quality", default: "confronted", stages: ["troubled", "confronted", "resolved"] },
        { name: "tree", type: "quality", default: "budding", stages: ["dormant", "budding", "blooming"] },
      ],
      cards: [
        { id: "c_bad", priority: 2, condition: "@story.debt >= @story.tree" },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [{ op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any"] } }],
    },

    { name: "a quality survives save and load as its stage name",
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        { id: "c_go", priority: 2, redraw: "always",
          outcomes: [{ id: "o_on", changes: { "@story.debt": "advance(@story.debt)" } }] },
        { id: "c_mid", priority: 1, condition: '@story.debt >= "confronted"' },
      ],
      hands: [{ id: "h_q", rule: {}, slots: 1 }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_go"] } },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        { op: "saveLoad" },
        { op: "assertState", expect: { "story.debt": "confronted" } },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_go"] } },
      ] },

    { name: "a stage inserted mid-ladder: old saves resolve, advance routes through it",
      story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "resolved"] }],
      cards: [
        { id: "c_go", priority: 2, redraw: "always",
          outcomes: [{ id: "o_on", changes: { "@story.debt": "advance(@story.debt)" } }] },
        { id: "c_late", priority: 1, condition: '@story.debt >= "confronted"' },
      ],
      hands: [{ id: "h_q", rule: {}, slots: 1 }],
      // The EDITED content inserts "negotiated" between confronted and
      // resolved. This is the design's whole point: outcomes that never name
      // their destination route play THROUGH the new stage, and the old >=
      // gates keep their truth values.
      bundleB: {
        story: [{ name: "debt", type: "quality", default: "troubled", stages: ["troubled", "confronted", "negotiated", "resolved"] }],
        cards: [
          { id: "c_go", priority: 2, redraw: "always",
            outcomes: [{ id: "o_on", changes: { "@story.debt": "advance(@story.debt)" } }] },
          { id: "c_late", priority: 1, condition: '@story.debt >= "confronted"' },
        ],
        hands: [{ id: "h_q", rule: {}, slots: 1 }],
      },
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_go"] } },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        { op: "saveLoad", into: "B" },
        // the old save's stage still resolves in the new ladder
        { op: "assertState", expect: { "story.debt": "confronted" } },
        { op: "deal", hands: ["h_q"] },
        { op: "play", card: "c_go", outcome: "on", from: "h_q" },
        // advance reached the INSERTED stage, not the one after it
        { op: "assertState", expect: { "story.debt": "negotiated" } },
        // and the pre-insertion gate keeps its truth value: c_late is eligible
        // (a peek, because c_go would win the one seat back on a deal - it has
        // the higher priority and redraw always, which is board mechanics, not
        // quality mechanics)
        { op: "peek", expect: ["c_go", "c_late"] },
      ] },

    { name: "a world quality is the host's to move, and deals re-gate on it",
      world: [{ name: "siege", type: "quality", default: "quiet", stages: ["quiet", "skirmish", "assault"] }],
      cards: [
        { id: "c_war", priority: 2, condition: '@world.siege >= "skirmish"' },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any"] } },
        { op: "setState", world: { siege: "assault" } },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any", "c_war"] } },
      ] },

    // --- state-bound and required groups (design/where-and-selectors.md B) ----
    //
    // The gap these close: only a HAND could bind a tag group, and `deal` takes
    // no criteria, so an axis driven by game state (acts, chapters) could not
    // gate at all without a condition on every card.

    { name: "a state-bound group binds itself from the property it names",
      story: [{ name: "act", type: "string", default: "act-1" }],
      groups: [{ id: "d_act", tags: [{ id: "v_act1", gameId: "act-1" }, { id: "v_act2", gameId: "act-2" }],
        boundBy: "@story.act" }],
      cards: [
        { id: "c_early", priority: 2, tags: { act: ["act-1"] } },
        { id: "c_late", priority: 2, tags: { act: ["act-2"] } },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        // act-1: the act-1 card and the untagged one; the act-2 card is filtered.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_early", "c_any"] } },
        { op: "setState", story: { act: "act-2" } },
        // A re-deal runs the eviction pass over what the hand already holds
        // BEFORE refilling, re-checking the hand condition, the card still
        // existing, the deck gate, cooldown, tags and the card's own condition.
        // So c_early goes (its tag no longer matches the bound act) while c_any
        // survives and KEEPS ITS SEAT: survivors are not re-ranked against the
        // newcomers, which is why the order reads "what survived, then what was
        // added" rather than a fresh ranking of the whole hand.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_any", "c_late"] } },
      ] },

    { name: "a hand's own binding beats the state-bound one",
      story: [{ name: "act", type: "string", default: "act-2" }],
      groups: [{ id: "d_act", tags: [{ id: "v_act1", gameId: "act-1" }, { id: "v_act2", gameId: "act-2" }],
        boundBy: "@story.act" }],
      cards: [
        { id: "c_early", priority: 2, tags: { act: ["act-1"] } },
        { id: "c_late", priority: 2, tags: { act: ["act-2"] } },
      ],
      // The hand pins act-1 although the story says act-2: the explicit
      // binding wins, the way a hand's chosen tag beats any default.
      hands: [{ id: "h_q", rule: { bindings: { act: "act-1" } } }],
      script: [{ op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_early"] } }],
    },

    { name: "a state-bound group whose value names no tag binds nothing",
      story: [{ name: "act", type: "string", default: "act-9" }],
      groups: [{ id: "d_act", tags: [{ id: "v_act1", gameId: "act-1" }, { id: "v_act2", gameId: "act-2" }],
        boundBy: "@story.act" }],
      cards: [
        { id: "c_early", priority: 2, tags: { act: ["act-1"] } },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      // "act-9" is not a tag, so the group goes UNBOUND rather than matching
      // nothing: an unbound group is a wildcard, so both cards are eligible.
      // Silently dealing nothing would look like content that does not exist.
      script: [{ op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_early", "c_any"] } }],
    },

    { name: "a required group refuses the cards that omit it",
      story: [{ name: "act", type: "string", default: "act-1" }],
      groups: [{ id: "d_act", tags: [{ id: "v_act1", gameId: "act-1" }, { id: "v_act2", gameId: "act-2" }],
        boundBy: "@story.act", required: true }],
      cards: [
        { id: "c_early", priority: 2, tags: { act: ["act-1"] } },
        { id: "c_any", priority: 1 },
      ],
      hands: [{ id: "h_q", rule: {} }],
      // Untagged is no longer a wildcard: c_any is refused because the group
      // is bound and it names nothing in it.
      script: [{ op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_early"] } }],
    },

    { name: "a state-bound group is re-evaluated after a load, not restored",
      story: [{ name: "act", type: "string", default: "act-1" }],
      groups: [{ id: "d_act", tags: [{ id: "v_act1", gameId: "act-1" }, { id: "v_act2", gameId: "act-2" }],
        boundBy: "@story.act" }],
      cards: [
        { id: "c_early", priority: 2, tags: { act: ["act-1"] } },
        { id: "c_late", priority: 2, tags: { act: ["act-2"] } },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_early"] } },
        { op: "setState", story: { act: "act-2" } },
        { op: "saveLoad" },
        // The binding is derived from state at ask time, so it needs no slot in
        // the save envelope and cannot go stale across a restore.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_late"] } },
      ] },

    // --- claims and copies (schema 3.5; SandboxStories S2, S5, S8) -------------
    { name: "one copy: two hands, one seat, and peeks respect the claim",  // PRNG-computed
      cards: [{ id: "c_rare", outcomes: [{ id: "o_done" }] }],
      hands: [
        { id: "h_a", rule: {}, slots: 1 },
        { id: "h_b", rule: {}, slots: 1 },
      ],
      script: [
        // the batch deal shuffles hand order with the session PRNG: seed 0
        // over [h_a, h_b] -> [h_b, h_a], so h_b seats the card
        { op: "deal", expectBoard: { h_b: ["c_rare"], h_a: [] } },
        // round 2: a peek RESPECTS claims - the seated card has no free copy
        { op: "peek", expect: [] },
        { op: "deal", expectBoard: { h_b: ["c_rare"], h_a: [] } },
      ] },

    { name: "copies 2: two seats, never three; playing releases a claim",
      cards: [{ id: "c_pair", copies: 2, outcomes: [{ id: "o_done" }] }],
      hands: [
        { id: "h_a", rule: {}, slots: 1 },
        { id: "h_b", rule: {}, slots: 1 },
        { id: "h_c", rule: {}, slots: 1 },
      ],
      script: [
        { op: "deal", hands: ["h_a"], expectBoard: { h_a: ["c_pair"] } },
        { op: "deal", hands: ["h_b"], expectBoard: { h_b: ["c_pair"] } },
        { op: "deal", hands: ["h_c"], expectBoard: { h_c: [] } },   // both copies claimed
        { op: "peek", expect: [] },
        { op: "play", card: "c_pair", outcome: "done", from: "h_a" },  // releases one claim
        { op: "deal", hands: ["h_c"], expectBoard: { h_c: ["c_pair"] } },  // redraw always: free copy again
      ] },

    { name: "a hand holds a card once, whatever its copies",
      cards: [{ id: "c_pair", copies: 2 }],
      hands: [{ id: "h_wide", rule: {}, slots: 3 }],
      script: [
        { op: "deal", hands: ["h_wide"], expectBoard: { h_wide: ["c_pair"] } },
      ] },

    { name: "dealMany returns the dealt slice: exactly the hands this call dealt",
      cards: [
        { id: "c_d", tags: { zone: ["docks"] } },
        { id: "c_m", tags: { zone: ["market"] } },
      ],
      hands: [
        { id: "h_d", rule: { bindings: { zone: "docks" } } },
        { id: "h_m", rule: { bindings: { zone: "market" } } },
      ],
      script: [
        { op: "deal", hands: ["h_d"], expectDealt: { h_d: ["c_d"] }, expectBoard: { h_d: ["c_d"] } },
        // h_d still sits on the board, but this call dealt only h_m: the
        // return holds h_m alone while board() shows both.
        { op: "deal", hands: ["h_m"], expectDealt: { h_m: ["c_m"] }, expectBoard: { h_d: ["c_d"], h_m: ["c_m"] } },
        // An omitted hand list deals every hand: the slice IS the board.
        { op: "deal", expectDealt: { h_d: ["c_d"], h_m: ["c_m"] } },
      ] },

    { name: "dealing evicts a card whose condition has lapsed",
      story: [{ name: "open", type: "boolean", default: true }],
      cards: [{ id: "c_cond", condition: "@story.open", outcomes: [{ id: "o_done" }] }],
      hands: [{ id: "h_gate", rule: {}, slots: 1 }],
      script: [
        { op: "deal", hands: ["h_gate"], expectBoard: { h_gate: ["c_cond"] } },
        { op: "setState", story: { open: false } },
        { op: "deal", hands: ["h_gate"], expectBoard: { h_gate: [] } },
      ] },

    // --- the place group on deals (schema 2.4) ---------------------------------
    { name: "a placed card is dealt only to its own place",
      cards: [
        { id: "c_placed", priority: 2, tags: { place: ["h_mine"] } },
        { id: "c_free", priority: 1 },
      ],
      hands: [
        { id: "h_mine", rule: {}, slots: 2 },
        { id: "h_other", rule: {}, slots: 2 },
      ],
      script: [
        { op: "deal", hands: ["h_mine"], expectBoard: { h_mine: ["c_placed", "c_free"] } },
        { op: "deal", hands: ["h_other"], expectBoard: { h_other: [] } },  // c_placed homed away, c_free claimed
      ] },

    // --- hand templates (schema 2.6; the reuse case) ----------------------------
    { name: "template instances: chosen tags bind and surface as @hand",
      cards: [
        { id: "c_d", priority: 1, tags: { zone: ["docks"] }, condition: '@hand.zone == "docks"' },
        { id: "c_m", priority: 1, tags: { zone: ["market"] } },
        { id: "c_w", priority: 0 },
      ],
      templates: [{ id: "t_stall", chooses: ["zone"], slots: 1 }],
      hands: [
        { id: "h_d", template: "t_stall", chosen: { zone: "docks" } },
        { id: "h_m", template: "t_stall", chosen: { zone: "market" } },
      ],
      script: [
        { op: "deal", hands: ["h_d"], expectBoard: { h_d: ["c_d"] } },
        { op: "deal", hands: ["h_m"], expectBoard: { h_m: ["c_m"] } },
        { op: "peek", expect: ["c_w"] },   // both zone cards claimed; the wildcard remains
      ] },

    { name: "a template's condition is shared: one edit governs every instance",
      story: [{ name: "open", type: "boolean", default: false }],
      cards: [{ id: "c_a" }],
      templates: [{ id: "t_shut", condition: "@story.open", slots: 1 }],
      hands: [{ id: "h_s", template: "t_shut" }],
      script: [
        { op: "deal", hands: ["h_s"], expectBoard: { h_s: [] } },
        { op: "setState", story: { open: true } },
        { op: "deal", hands: ["h_s"], expectBoard: { h_s: ["c_a"] } },
      ] },

    // --- the latch (SandboxStories S1: the canonical thread) --------------------
    { name: "the latch: a thread only moves forward",
      story: [{ name: "pressed", type: "boolean", default: false }],
      cards: [
        { id: "c_first", redraw: "never", outcomes: [
          { id: "o_press", changes: { "@story.pressed": "true" } },
        ] },
        { id: "c_second", redraw: "never", condition: "@story.pressed",
          outcomes: [{ id: "o_end" }] },
      ],
      hands: [{ id: "h_q", rule: {}, slots: 1 }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_first"] } },
        { op: "play", card: "c_first", outcome: "press", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_second"] } },   // c_first never returns
        { op: "play", card: "c_second", outcome: "end", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: [] } },
      ] },

    // --- persistence (schema 4; SandboxStories S9) -------------------------------
    { name: "save/load carries the PRNG state, not a reset",  // PRNG-computed
      seed: 1,
      cards: [{ id: "c_alpha" }, { id: "c_beta" }, { id: "c_gamma" }],
      script: [
        // seed-1 shuffle of the full tie -> [c_gamma, c_alpha, c_beta]
        { op: "peek", expect: ["c_gamma", "c_alpha", "c_beta"] },
        { op: "saveLoad" },
        // the CONTINUED stream gives a different permutation; an engine that
        // reseeded on load would repeat the first list and fail here
        { op: "peek", expect: ["c_alpha", "c_gamma", "c_beta"] },
      ] },

    { name: "save/load round-trips turns, cooldowns and the board",
      cards: [
        { id: "c_patrol", priority: 1, redraw: 4, outcomes: [{ id: "o_done" }] },
        { id: "c_still", priority: 0 },
      ],
      hands: [{ id: "h_q", rule: {}, slots: 1 }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_patrol"] } },
        { op: "play", card: "c_patrol", outcome: "done", from: "h_q" },   // turn 1; eligible at 5
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_still"] } },
        { op: "saveLoad" },
        { op: "assertState", expect: { "turn.b_x": 1 } },
        // the board survived the round-trip; the cooled card is still out
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_still"] } },
        { op: "advanceTurns", box: "b_x", n: 4 },                        // turn 5
        { op: "peek", expect: ["c_patrol"] },      // c_still is claimed; c_patrol is back
      ] },

    { name: "@hand writes route back to the tag",
      cards: [{ id: "c_riot", tags: { zone: ["docks"] }, outcomes: [
        { id: "o_escalate", changes: { "@hand.danger": "@hand.danger + 1" } },
      ] }],
      hands: [{ id: "h_docks", rule: { bindings: { zone: "docks" } } }],
      script: [
        { op: "deal", hands: ["h_docks"], expectBoard: { h_docks: ["c_riot"] } },
        { op: "play", card: "c_riot", outcome: "escalate", from: "h_docks" },
        { op: "assertState", expect: { "value.v_docks.danger": 1 } },
        { op: "deal", hands: ["h_docks"], expectBoard: { h_docks: ["c_riot"] } },
        { op: "play", card: "c_riot", outcome: "escalate", from: "h_docks" },
        { op: "assertState", expect: { "value.v_docks.danger": 2 } },
      ] },

    { name: "count_played feeds a condition from the play log",
      cards: [
        { id: "c_job", priority: 1, outcomes: [{ id: "o_done" }] },
        { id: "c_gossip", priority: 2, condition: 'count_played("job") >= 2' },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_job"] } },
        { op: "play", card: "c_job", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_job"] } },
        { op: "play", card: "c_job", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_gossip", "c_job"] } },
      ] },

    // The play history has to survive a save, and since 2026-08-29 that is a
    // claim about a DERIVED structure rather than about the log alone: the four
    // history functions read incremental indexes now (they used to scan the
    // whole log on every call, once per candidate card per ask, so dealing got
    // slower the longer a playthrough ran). A load REPLACES the log, so the
    // indexes have to be rebuilt from it, and nothing pinned that. Both halves
    // are checked here: a count carried over, and a turns-since answered from
    // the played card's box clock.
    { name: "play history survives a save and load",
      cards: [
        { id: "c_job", priority: 1, outcomes: [{ id: "o_done" }] },
        { id: "c_gossip", priority: 2, condition: 'count_played("job") >= 2' },
        { id: "c_lonely", priority: 3, condition: 'turns_since_played("nobody") == 9999' },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_lonely", "c_job"] } },
        { op: "play", card: "c_job", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_lonely", "c_job"] } },
        { op: "play", card: "c_job", outcome: "done", from: "h_q" },
        { op: "saveLoad" },
        // Two plays of "job" are still two after the round trip, so c_gossip
        // qualifies; "nobody" was never played, so c_lonely still reads 9999.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_lonely", "c_gossip", "c_job"] } },
      ] },

    { name: "turns_since_played reads 9999 before any play",
      cards: [
        { id: "c_lonely", priority: 1, condition: 'turns_since_played("job") == 9999' },
        { id: "c_job", priority: 0, outcomes: [{ id: "o_done" }] },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_lonely", "c_job"] } },
        { op: "play", card: "c_job", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_job"] } },   // 0 turns since; c_lonely evicted
      ] },

    { name: "changes write @box and @deck state",
      boxProperties: [{ name: "heat", type: "number", default: 0 }],
      decks: [{ id: "k_main", properties: [{ name: "visits", type: "number", default: 0 }],
        cards: [{ id: "c_a", outcomes: [{ id: "o_tag", changes: {
          "@box.heat": "@box.heat + 1",
          "@deck.visits": "@deck.visits + 1",
        } }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_a"] } },
        { op: "play", card: "c_a", outcome: "tag", from: "h_q" },
        { op: "assertState", expect: { "box.b_x.heat": 1, "deck.k_main.visits": 1 } },
      ] },

    { name: "hand properties compose into @hand and write back",
      cards: [{ id: "c_topic", condition: '@hand.owner == "elder"', outcomes: [
        { id: "o_chat", changes: { "@hand.uses": "@hand.uses + 1" } },
      ] }],
      hands: [{ id: "h_elder", rule: {}, slots: 1, properties: [
        { name: "owner", type: "string", default: "elder" },
        { name: "uses", type: "number", default: 0 },
      ] }],
      script: [
        { op: "deal", hands: ["h_elder"], expectBoard: { h_elder: ["c_topic"] } },
        { op: "play", card: "c_topic", outcome: "chat", from: "h_elder" },
        { op: "assertState", expect: { "hand.h_elder.uses": 1 } },
      ] },

    { name: "count_played_in counts plays of a tag's cards",
      cards: [
        { id: "c_dock1", priority: 1, tags: { zone: ["docks"] }, outcomes: [{ id: "o_done" }] },
        { id: "c_watch", priority: 2, condition: 'count_played_in("zone", "docks") >= 2' },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_dock1"] } },
        { op: "play", card: "c_dock1", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_dock1"] } },
        { op: "play", card: "c_dock1", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_watch", "c_dock1"] } },
      ] },

    { name: "turns_since_played_in reads 9999 before any play in the tag",
      cards: [
        { id: "c_fresh", priority: 2, condition: 'turns_since_played_in("zone", "docks") == 9999' },
        { id: "c_dock", priority: 1, tags: { zone: ["docks"] }, outcomes: [{ id: "o_done" }] },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_fresh", "c_dock"] } },
        { op: "play", card: "c_dock", outcome: "done", from: "h_q" },
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_dock"] } },   // 0 turns since; c_fresh evicted
      ] },

    { name: "a drifted save loads harmlessly: orphaned state drops, play goes on",
      cards: [
        { id: "c_gone", priority: 2, redraw: 5, outcomes: [{ id: "o_done" }] },
        { id: "c_stay", priority: 1, outcomes: [{ id: "o_done" }] },
      ],
      hands: [{ id: "h_a", rule: {}, slots: 1 }],
      // The EDITED content: the seated card, its cooldown's owner and the
      // hand have all been deleted.
      bundleB: {
        cards: [{ id: "c_stay", priority: 1, outcomes: [{ id: "o_done" }] }],
      },
      script: [
        { op: "deal", hands: ["h_a"], expectBoard: { h_a: ["c_gone"] } },
        { op: "play", card: "c_gone", outcome: "done", from: "h_a" },   // turn 1; cooldown at 6
        { op: "saveLoad", into: "B" },
        { op: "assertState", expect: { "turn.b_x": 1 } },
        { op: "peek", expect: ["c_stay"] },
      ] },

    // The eviction pass's "vanished" reason, which nothing here covered: the
    // drifted-save case above deletes the HAND as well, so a seated card whose
    // CARD alone was edited away, in a hand that survives, was pinned only by a
    // JS-side unit test and never replayed by the ports. A redeal must not hand
    // a game a card that no longer exists.
    { name: "a card edited away underneath a surviving hand is dropped, not dealt",
      cards: [
        { id: "c_gone", priority: 2, outcomes: [{ id: "o_done" }] },
        { id: "c_stay", priority: 1, outcomes: [{ id: "o_done" }] },
      ],
      hands: [{ id: "h_a", rule: {}, slots: 1 }],
      // Only the seated card is deleted; the hand is still there.
      bundleB: {
        cards: [{ id: "c_stay", priority: 1, outcomes: [{ id: "o_done" }] }],
        hands: [{ id: "h_a", rule: {}, slots: 1 }],
      },
      script: [
        { op: "deal", hands: ["h_a"], expectBoard: { h_a: ["c_gone"] } },
        { op: "saveLoad", into: "B" },
        // The seat is free again, and the next deal fills it from what exists.
        { op: "deal", hands: ["h_a"], expectBoard: { h_a: ["c_stay"] } },
      ] },

    // --- group names are box-scoped, in the play-history functions too ------
    // Both boxes declare a group named "zone". count_played_in and
    // turns_since_played_in take a BARE group name with no box, so they
    // resolve it in the box whose ask is being evaluated. A card's tags
    // reference its own box's group, so the counts stay box-local.
    { name: "count_played_in resolves its tag group in the asking box",
      cards: [
        { id: "c_xdocks", priority: 2, tags: { zone: ["docks"] }, outcomes: [{ id: "o_go" }] },
        { id: "c_xprobe", priority: 1, condition: 'count_played_in("zone", "docks") >= 1' },
      ],
      hands: [{ id: "h_q", rule: {} }],
      otherBox: {
        cards: [
          { id: "c_ydocks", priority: 2, tags: { zone: ["docks"] }, outcomes: [{ id: "o_leave" }] },
          { id: "c_yprobe", priority: 1, condition: 'count_played_in("zone", "docks") >= 1' },
        ],
        hands: [{ id: "h_qy", rule: {} }],
      },
      script: [
        { op: "deal", expectBoard: { h_q: ["c_xdocks"], h_qy: ["c_ydocks"] } },
        // A play in b_x alone. b_y's "zone"/"docks" is a DIFFERENT tag, so
        // b_y's probe must stay shut while b_x's opens.
        { op: "play", card: "c_xdocks", outcome: "go", from: "h_q" },
        { op: "deal", expectBoard: { h_q: ["c_xdocks", "c_xprobe"], h_qy: ["c_ydocks"] } },
        // Now the mirror play in b_y opens b_y's probe as well.
        { op: "play", card: "c_ydocks", outcome: "leave", from: "h_qy" },
        { op: "deal", expectBoard: {
          h_q: ["c_xdocks", "c_xprobe"], h_qy: ["c_ydocks", "c_yprobe"] } },
      ] },

    { name: "turns_since_played_in resolves its tag group in the asking box",
      cards: [
        { id: "c_xfresh", priority: 2, condition: 'turns_since_played_in("zone", "docks") == 9999' },
        { id: "c_xdocks", priority: 1, tags: { zone: ["docks"] }, outcomes: [{ id: "o_go" }] },
      ],
      hands: [{ id: "h_q", rule: {} }],
      // b_y exists to put a second "zone" group in the bundle; its own docks
      // tag is never played, so it can never be what b_x's ask reads.
      otherBox: {
        cards: [{ id: "c_ydocks", tags: { zone: ["docks"] }, outcomes: [{ id: "o_leave" }] }],
        hands: [{ id: "h_qy", rule: {} }],
      },
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_xfresh", "c_xdocks"] } },
        { op: "play", card: "c_xdocks", outcome: "go", from: "h_q" },
        // 0 turns since b_x's docks was played: c_xfresh is evicted. Reading
        // b_y's untouched docks tag instead would leave it seated at 9999.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_xdocks"] } },
      ] },

    { name: "a tag group name from another box is not a valid criterion here",
      // "weather" is b_y's group alone. Box scoping is a real scope, so the
      // ask is refused rather than reaching across into the other box.
      cards: [{ id: "c_xplain" }],
      otherBox: { cards: [{ id: "c_yplain" }] },
      script: [
        { op: "peek", box: "box", criteria: { weather: "rain" }, expectError: true },
        { op: "peek", box: "other", criteria: { weather: "rain" }, expect: ["c_yplain"] },
      ] },

    // --- the board's optional box filter (schema 5) -------------------------
    // "Give me this box's hands" is the common host query: boxes are how a
    // game separates its storylet systems, so a game with a barks box wants
    // the barks hands alone. The filter is an argument on the SAME
    // whole-board read, so these cases pin all three readings of it against
    // one two-box bundle: no argument (every hand), each box in turn (that
    // box's hands ONLY), and a box that does not exist (refused).
    //
    // Each hand binds a tag, so what lands where is fixed by content rather
    // than by the deal's hand-order shuffle: h_xdocks can only take
    // `c_xdocks` (`c_xmarket` carries the other tag of the same group), and
    // b_y's ask never reaches into b_x. Board order is bundle order: b_x's
    // hands by id, then b_y's.
    { name: "board with no box is every hand; board of a box is that box's hands",
      cards: [
        { id: "c_xdocks", tags: { zone: ["docks"] } },
        { id: "c_xmarket", tags: { zone: ["market"] } },
      ],
      hands: [
        { id: "h_xdocks", rule: { bindings: { zone: "docks" } } },
        { id: "h_xmarket", rule: { bindings: { zone: "market" } } },
      ],
      otherBox: {
        cards: [{ id: "c_ydocks", tags: { zone: ["docks"] } }],
        hands: [{ id: "h_ydocks", rule: { bindings: { zone: "docks" } } }],
      },
      script: [
        // Before any deal: every hand is on the board, empty. A filter is a
        // filter on HANDS, not on what happens to be sitting in them.
        { op: "assertBoard", expect: { h_xdocks: [], h_xmarket: [], h_ydocks: [] } },
        { op: "assertBoard", box: "box", expect: { h_xdocks: [], h_xmarket: [] } },
        { op: "assertBoard", box: "other", expect: { h_ydocks: [] } },
        { op: "deal", expectBoard: {
          h_xdocks: ["c_xdocks"], h_xmarket: ["c_xmarket"], h_ydocks: ["c_ydocks"] } },
        { op: "assertBoard", expect: {
          h_xdocks: ["c_xdocks"], h_xmarket: ["c_xmarket"], h_ydocks: ["c_ydocks"] } },
        { op: "assertBoard", box: "box", expect: {
          h_xdocks: ["c_xdocks"], h_xmarket: ["c_xmarket"] } },
        { op: "assertBoard", box: "other", expect: { h_ydocks: ["c_ydocks"] } },
      ] },

    { name: "board takes a box id as readily as its gameId",
      // Every other box-taking call on the host surface resolves gameId then
      // id (turn, peek, advanceTurns); the board filter is no exception.
      cards: [{ id: "c_xplain" }],
      hands: [{ id: "h_xq", rule: {} }],
      otherBox: {
        cards: [{ id: "c_yplain" }],
        hands: [{ id: "h_yq", rule: {} }],
      },
      script: [
        { op: "deal", expectBoard: { h_xq: ["c_xplain"], h_yq: ["c_yplain"] } },
        { op: "assertBoard", box: "b_x", expect: { h_xq: ["c_xplain"] } },
        { op: "assertBoard", box: "b_y", expect: { h_yq: ["c_yplain"] } },
      ] },

    { name: "board of a box that does not exist is refused, not empty",
      // The unknown-box answer is an error, exactly as turn() and peek()
      // answer it. Returning an empty board would read as "that box has
      // nothing out", which is a different and false statement.
      cards: [{ id: "c_xplain" }],
      hands: [{ id: "h_xq", rule: {} }],
      otherBox: {
        cards: [{ id: "c_yplain" }],
        hands: [{ id: "h_yq", rule: {} }],
      },
      script: [
        { op: "deal", expectBoard: { h_xq: ["c_xplain"], h_yq: ["c_yplain"] } },
        { op: "assertBoard", box: "barks", expectError: true },
        // The refusal changes nothing: the whole board still reads as it did.
        { op: "assertBoard", expect: { h_xq: ["c_xplain"], h_yq: ["c_yplain"] } },
      ] },

    // --- Family flows (design/flows.md): parallel personal playthroughs ------
    // over one world. Sharing is the per-property `shared` flag (@story
    // defaults shared, box/deck/hand/tag properties default per-flow);
    // boards, claims, cooldowns, clocks, play history and the PRNG are per
    // flow; @world is engine-level, always shared, never in the save.

    { name: "a shared @story property is one value: two flows both move it and both see the total",
      story: [{ name: "gold", type: "number", default: 0 }],   // shared by default
      cards: [{ id: "c_earn", outcomes: [{ id: "o_take", changes: { "@story.gold": "@story.gold + 1" } }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_earn"] } },
        { op: "play", flow: "alice", card: "c_earn", outcome: "take", from: "h_q" },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_earn"] } },
        { op: "play", flow: "bob", card: "c_earn", outcome: "take", from: "h_q" },
        { op: "assertState", flow: "alice", expect: { "story.gold": 2 } },
        { op: "assertState", flow: "bob", expect: { "story.gold": 2 } },
        // Shared state answers at the engine too - the tools' surface.
        { op: "assertEngineRead", path: "story.gold", expect: 2 },
      ] },

    { name: "a shared:false @story property is a copy per flow, and the engine refuses to guess",
      story: [{ name: "steps", type: "number", default: 0, shared: false }],
      cards: [{ id: "c_walk", outcomes: [{ id: "o_go", changes: { "@story.steps": "@story.steps + 1" } }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_walk"] } },
        { op: "play", flow: "alice", card: "c_walk", outcome: "go", from: "h_q" },
        { op: "assertState", flow: "alice", expect: { "story.steps": 1 } },
        { op: "assertState", flow: "bob", expect: { "story.steps": 0 } },
        // Engine-level read of a per-flow ref THROWS (the teaching rule):
        // silently answering with some flow's copy is the bug this pins out.
        { op: "assertEngineRead", path: "story.steps", expectError: true },
      ] },

    { name: "tag properties default per-flow, a shared:true box property is one value",
      boxProperties: [{ name: "heat", type: "number", default: 0, shared: true }],
      cards: [{ id: "c_plain" }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        // The scaffold's v_docks danger (a tag property): per-flow by default.
        { op: "setState", flow: "alice", value: { v_docks: { danger: 3 } } },
        { op: "assertState", flow: "alice", expect: { "value.v_docks.danger": 3 } },
        { op: "assertState", flow: "bob", expect: { "value.v_docks.danger": 0 } },
        { op: "assertEngineRead", path: "value.v_docks.danger", expectError: true },
        // The flagged box property: written through one flow, seen by the other.
        { op: "setState", flow: "alice", box: { b_x: { heat: 2 } } },
        { op: "assertState", flow: "bob", expect: { "box.b_x.heat": 2 } },
        { op: "assertEngineRead", path: "box.b_x.heat", expect: 2 },
      ] },

    { name: "each flow has its own clocks: there is deliberately no global turn",
      cards: [{ id: "c_plain" }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "advanceTurns", flow: "alice", box: "b_x", n: 3 },
        { op: "assertState", flow: "alice", expect: { "turn.b_x": 3 } },
        { op: "assertState", flow: "bob", expect: { "turn.b_x": 0 } },
      ] },

    { name: "cooldowns and play history are per flow: my redraw-never is still fresh to you",
      cards: [{ id: "c_once", redraw: "never", outcomes: [{ id: "o_done" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_once"] } },
        { op: "play", flow: "alice", card: "c_once", outcome: "done", from: "h_q" },
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: [] } },
        // Bob's playthrough never saw it: his ledger, his history.
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_once"] } },
      ] },

    { name: "claims are per flow: another flow holding a card is another playthrough, not a rival hand",
      cards: [{ id: "c_prop" }],   // copies defaults to 1
      hands: [{ id: "h_q1", rule: {} }, { id: "h_q2", rule: {} }],
      script: [
        // Within one flow the claim is physical, exactly as before...
        { op: "deal", flow: "alice", hands: ["h_q1"], expectBoard: { h_q1: ["c_prop"] } },
        { op: "deal", flow: "alice", hands: ["h_q2"], expectBoard: { h_q2: [] } },
        // ...and invisible to the next flow's board.
        { op: "deal", flow: "bob", hands: ["h_q2"], expectBoard: { h_q2: ["c_prop"] } },
      ] },

    { name: "conditions read the merged view: shared values arrive, per-flow values stay personal",
      boxProperties: [{ name: "heat", type: "number", default: 0, shared: true }],
      cards: [{ id: "c_hot", condition: "@box.heat >= 1 and @hand.danger == 0" }],
      hands: [{ id: "h_dock", rule: { bindings: { zone: "docks" } } }],
      script: [
        { op: "deal", flow: "bob", hands: ["h_dock"], expectBoard: { h_dock: [] } },   // heat 0 everywhere
        { op: "setState", flow: "alice", box: { b_x: { heat: 1 } } },                  // shared: bob sees it
        { op: "deal", flow: "bob", hands: ["h_dock"], expectBoard: { h_dock: ["c_hot"] } },
        { op: "setState", flow: "bob", value: { v_docks: { danger: 5 } } },            // bob's own docks
        { op: "deal", flow: "bob", hands: ["h_dock"], expectBoard: { h_dock: [] } },
        { op: "deal", flow: "alice", hands: ["h_dock"], expectBoard: { h_dock: ["c_hot"] } },   // alice's danger is still 0
      ] },

    { name: "saveLoad carries the shared blob once and every flow - and @world goes back to the host",
      world: [{ name: "alarm", type: "number", default: 0 }],
      story: [{ name: "gold", type: "number", default: 0 }],
      cards: [{ id: "c_heist", redraw: "never", outcomes: [{ id: "o_go", changes: {
        "@story.gold": "@story.gold + 1",
        "@world.alarm": "@world.alarm + 1",
      } }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_heist"] } },
        { op: "play", flow: "alice", card: "c_heist", outcome: "go", from: "h_q" },
        { op: "advanceTurns", flow: "bob", box: "b_x", n: 2 },
        { op: "assertEngineRead", path: "world.alarm", expect: 1 },
        { op: "saveLoad" },
        // The shared partition restored once; each flow's own state restored.
        { op: "assertState", flow: "alice", expect: { "story.gold": 1, "turn.b_x": 1 } },
        { op: "assertState", flow: "bob", expect: { "story.gold": 1, "turn.b_x": 2 } },
        // Alice's redraw-never survived the trip; Bob's fresh ledger did too.
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_heist"] } },
        // @world was NOT in the envelope: the fresh engine self-backs the
        // default. The host saves its container; each engine saves its own.
        { op: "assertEngineRead", path: "world.alarm", expect: 0 },
      ] },

    { name: "re-opening a flow name replaces it: per-flow state reseeds, shared state stands",
      story: [
        { name: "gold", type: "number", default: 0 },                    // shared
        { name: "steps", type: "number", default: 0, shared: false },    // per flow
      ],
      cards: [{ id: "c_plain" }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "setState", flow: "alice", story: { gold: 3, steps: 5 } },
        { op: "advanceTurns", flow: "alice", box: "b_x", n: 4 },
        { op: "openFlow", flow: "alice" },
        { op: "assertState", flow: "alice", expect: { "story.steps": 0, "turn.b_x": 0, "story.gold": 3 } },
      ] },

    { name: "a closed flow's handle is inert: every verb is refused",
      cards: [{ id: "c_plain" }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "peek", flow: "alice", expect: ["c_plain"] },
        { op: "closeFlow", flow: "alice" },
        { op: "peek", flow: "alice", expectError: true },
        { op: "play", flow: "alice", card: "c_plain", outcome: "o", from: "h_q", expectError: true },
        { op: "assertBoard", flow: "alice", expectError: true },
        // The rest of the world is untouched: a fresh flow still plays.
        { op: "peek", flow: "carol", expect: ["c_plain"] },
      ] },

    // --- shared scarcity (design/shared-scarcity.md) --------------------------
    //
    // The flag is on the DECK, with a per-card override, and it moves two
    // ledgers independently: claims always, and SPEND only for redraw "never",
    // because a finite cooldown is an absolute turn of a per-flow clock and
    // "3 turns of whose clock?" has no answer (9.3.2).

    { name: "a shared deck's card is claimed across flows: the first to be dealt it has it",
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        // Bob is refused, and told it is somebody else holding it - not his own
        // hand, which is what "claimed" would have said.
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] },
          expectVerdicts: { c_goblin: "claimed-elsewhere" } },
        // A peek respects the foreign claim too, and reports it the same way.
        { op: "peek", flow: "bob", expect: [], expectVerdicts: { c_goblin: "claimed-elsewhere" } },
      ] },

    { name: "a shared claim is released by a play, and the card goes to whoever is next",
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin", outcomes: [{ id: "o_done" }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] } },
        // redraw defaults to "always", so playing it puts it straight back in
        // the pool: alice keeps no hold on it and bob is dealt it next.
        { op: "play", flow: "alice", card: "c_goblin", outcome: "done", from: "h_q" },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
      ] },

    { name: "a shared claim is released by an evict: dropping it from your board frees it",
      boxProperties: [{ name: "open", type: "boolean", default: true, shared: false }],
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin", condition: "@box.open" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] } },
        // alice's own copy of the gate shuts, so her next deal evicts it; the
        // claim goes with it and bob can be dealt it.
        { op: "setState", flow: "alice", box: { b_x: { open: false } } },
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
      ] },

    { name: "sharedCopies is the world cap and copies the per-flow one: five tickets, one each",
      decks: [{ id: "k_rare", shared: true,
        cards: [{ id: "c_ticket", copies: 1, sharedCopies: 2 }] }],
      hands: [{ id: "h_q1", rule: {} }, { id: "h_q2", rule: {} }],
      script: [
        // One to a customer: alice's second hand is refused by her OWN copies
        // cap, which is the ordinary claim and says so.
        { op: "deal", flow: "alice", hands: ["h_q1"], expectBoard: { h_q1: ["c_ticket"] } },
        { op: "deal", flow: "alice", hands: ["h_q2"], expectBoard: { h_q2: [] },
          expectVerdicts: { c_ticket: "claimed" } },
        // Two in the world, so bob gets the second...
        { op: "deal", flow: "bob", hands: ["h_q1"], expectBoard: { h_q1: ["c_ticket"] } },
        // ...and the third participant gets nothing.
        { op: "deal", flow: "carol", hands: ["h_q1"], expectBoard: { h_q1: [] },
          expectVerdicts: { c_ticket: "claimed-elsewhere" } },
      ] },

    { name: "sharedCopies defaults to copies, so a shared card with no cap is one in the world",
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] } },
      ] },

    { name: "a card overrides its deck both ways: shared card in a plain deck, plain card in a shared one",
      decks: [
        { id: "k_plain", cards: [{ id: "c_unique", shared: true }] },
        { id: "k_rare", shared: true, cards: [{ id: "c_common", shared: false }] },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_common", "c_unique"] } },
        // c_unique is shared despite its plain deck, so bob cannot have it;
        // c_common is not, despite its shared deck, so he can.
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_common"] },
          expectVerdicts: { c_unique: "claimed-elsewhere" } },
      ] },

    { name: "shared redraw never is SPENT for everyone: the first to play it takes it out of the world",
      decks: [{ id: "k_rare", shared: true,
        cards: [{ id: "c_pixie", redraw: "never", outcomes: [{ id: "o_take" }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_pixie"] } },
        { op: "play", flow: "alice", card: "c_pixie", outcome: "take", from: "h_q" },
        // Not "cooldown": bob never played it, and his own clock says nothing.
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] },
          expectVerdicts: { c_pixie: "taken" } },
        // Alice is refused too, by the same shared ledger.
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: [] },
          expectVerdicts: { c_pixie: "taken" } },
      ] },

    { name: "the spent set rides the save: a shared one-shot stays spent across a round trip",
      decks: [{ id: "k_rare", shared: true,
        cards: [{ id: "c_pixie", redraw: "never", outcomes: [{ id: "o_take" }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_pixie"] } },
        { op: "play", flow: "alice", card: "c_pixie", outcome: "take", from: "h_q" },
        { op: "saveLoad" },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] },
          expectVerdicts: { c_pixie: "taken" } },
      ] },

    { name: "a finite redraw in a shared deck stays personal: back in the pool, but not for you yet",
      decks: [{ id: "k_rare", shared: true,
        cards: [{ id: "c_goblin", redraw: 3, outcomes: [{ id: "o_fight" }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "play", flow: "alice", card: "c_goblin", outcome: "fight", from: "h_q" },
        // The claim released, so the goblin is back in the world at once...
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        // ...but alice, who just fought it, waits three of HER OWN turns. The
        // verdict is the ordinary one: this cooldown really is hers.
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: [] },
          expectVerdicts: { c_goblin: "cooldown" } },
      ] },

    { name: "closing a flow releases its shared claims: a participant who leaves does not lock the world",
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "closeFlow", flow: "alice" },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
      ] },

    // Order is a contract because saveGame keys its flows in it: two runtimes
    // that disagree write different .storyletsave bytes for the same run. They
    // did until 2026-08-29 - re-opening an existing name moved it to the END in
    // the JS reference (a Map re-inserts a deleted key at the back) and kept its
    // slot on all three ports, which used ordered maps that say so explicitly.
    { name: "re-opening a flow keeps its place in the order",
      cards: [{ id: "c_a" }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        // "main" is opened EXPLICITLY and first, so this case says the same
        // thing on every harness: some open main up front and the JS runner
        // opens it lazily on first use, and the claim here is about ORDER, so
        // it must not depend on which.
        { op: "openFlow", flow: "main" },
        { op: "openFlow", flow: "alice" },
        { op: "openFlow", flow: "bob" },
        { op: "assertFlows", expect: ["main", "alice", "bob"] },
        { op: "openFlow", flow: "alice" },   // replaces, and stays where it was
        { op: "assertFlows", expect: ["main", "alice", "bob"] },
        { op: "closeFlow", flow: "alice" },
        { op: "assertFlows", expect: ["main", "bob"] },
      ] },

    { name: "re-opening a flow name releases what it held: replace is a fresh playthrough",
      decks: [{ id: "k_rare", shared: true, cards: [{ id: "c_goblin" }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: [] } },
        { op: "openFlow", flow: "alice" },   // replaces: the old board goes
        { op: "deal", flow: "bob", hands: ["h_q"], expectBoard: { h_q: ["c_goblin"] } },
      ] },

    { name: "reset clears the spent set: a fresh game does not start with the pixie gone",
      decks: [{ id: "k_rare", shared: true,
        cards: [{ id: "c_pixie", redraw: "never", outcomes: [{ id: "o_take" }] }] }],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_pixie"] } },
        { op: "play", flow: "alice", card: "c_pixie", outcome: "take", from: "h_q" },
        { op: "reset" },
        { op: "deal", flow: "alice", hands: ["h_q"], expectBoard: { h_q: ["c_pixie"] } },
      ] },

    { name: "a single flow cannot tell: shared and per-flow are the same thing until a second flow opens",
      decks: [
        { id: "k_rare", shared: true, cards: [{ id: "c_a", redraw: "never", outcomes: [{ id: "o_x" }] }] },
        { id: "k_plain", cards: [{ id: "c_b", redraw: "never", outcomes: [{ id: "o_x" }] }] },
      ],
      hands: [{ id: "h_q", rule: {} }],
      script: [
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: ["c_a", "c_b"] } },
        { op: "play", card: "c_a", outcome: "x", from: "h_q" },
        { op: "play", card: "c_b", outcome: "x", from: "h_q" },
        // Both gone, by different ledgers, indistinguishably from in here.
        { op: "deal", hands: ["h_q"], expectBoard: { h_q: [] } },
      ] },
  ],
};
