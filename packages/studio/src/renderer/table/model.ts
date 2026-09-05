// ---------------------------------------------------------------------------
// The Board's non-DOM logic: driving the reference Engine (one "main" Flow;
// the flow tools come later, design/flows.md) and shaping its results for
// display. Pure over a live engine, so it is testable headlessly
// against a compiled bundle (the DOM layer in table.ts is the thin shell).
// ---------------------------------------------------------------------------

import { Engine } from "@storylet-studio/runtime";
import type { Flow, LogEntry, TraceEvent, TraceVerdict } from "@storylet-studio/runtime";
import { SAVEFILE_SCHEMA, effectiveGameId } from "@storylet-studio/model";
import type { Bundle, PropertyBag, PropertyDecl, SaveFile, ScalarValue } from "@storylet-studio/model";

export type { LogEntry, TraceEvent } from "@storylet-studio/runtime";

/** Plain-language reason a considered card did not make the list (from its
 *  ask-trace verdict). "dealt"/"capped" cover the ranking cut; the rest are
 *  eligibility gates, in schema 3.1 ask order. */
const VERDICT_REASON: Record<TraceVerdict, string> = {
  dealt: "dealt",
  capped: "hand full (lower priority)",
  cooldown: "on cooldown",
  "deck-gate": "deck condition not met",
  tags: "its tags don't match this slice",
  condition: "condition not met",
  priority: "priority did not resolve to a number",
  claimed: "no free copy - held elsewhere on the board",
  // The two shared-scarcity reasons (design/shared-scarcity.md). They exist
  // BECAUSE "claimed" and "on cooldown" would point the reader at their own
  // board and their own clock, neither of which has anything to do with it.
  "claimed-elsewhere": "another playthrough is holding it",
  taken: "taken out of the world by another playthrough",
};

/** The plain-language reason for a verdict (Live mode reads the game's deals
 *  with the same words the Board's own peek uses). */
export const verdictReason = (verdict: TraceVerdict): string => VERDICT_REASON[verdict] ?? verdict;

export interface BoxInfo {
  gameId: string;
  title?: string;
  /** Tag group gameId -> tag gameIds, for the peek criteria pickers. */
  groups: { gameId: string; values: string[] }[];
}

/** A listed card annotated with its ranking keys from the ask trace. */
export interface DealtView {
  id: string;
  gameId: string;
  title?: string;
  purpose?: string;
  priority?: number;
  specificity?: number;
  /** from = the hand's gameId; undefined for a peeked list. */
  from?: string;
}

/** A hand declared in the bundle: what can sit on this board, whether or not
 *  it has been dealt yet. */
export interface HandView {
  id: string;
  gameId: string;
  title?: string;
  /** The template it instances, as a gameId; absent = standalone. */
  template?: string;
  /** Slot cap override; absent = the template's / rule's slots. */
  slots?: number;
  /** Chosen tags, e.g. "area = docks". */
  chosen: string[];
  /** Every tag the hand binds (fixed + chosen), group gameId -> tag gameId:
   *  the board's filter key ("show all hands in the forest"). */
  tags: Record<string, string>;
  box: string;
}

/** A card the ask considered but did not list, with why (the "not dealt"
 *  panel - the authoring aid lifted from the old Simulate). */
export interface NotDealt {
  gameId: string;
  title?: string;
  reason: string;
}

/** An ask's outcome: the list, plus the considered-but-not-listed cards. */
export interface DealResult {
  dealt: DealtView[];
  notDealt: NotDealt[];
}

export interface StateRow {
  path: string;
  label: string;
  scope: string;
  value: ScalarValue;
  editable: boolean;
  /** A quality's ladder, in order. Present iff the declaration is a quality;
   *  the strip renders these rows as the ladder with the current rung marked
   *  (design/quality.md section 4) instead of a free-text input, which would
   *  invite the exact stage typos the compiler exists to refuse. */
  stages?: string[];
}

/**
 * Every declared property that outlives a run, as the path `getProperty` takes
 * (design/engine-server.md 4.2). `@world` is never here: it carries no flag,
 * and it is the host's anyway.
 *
 * The path shapes are the engine's own: "story.x", "box.<id>.x",
 * "deck.<id>.x", "hand.<id>.x", "value.<tagId>.x". Hands take their
 * template's declarations where they have one, exactly as the engine's bags do.
 */
export function durablePropertyPaths(bundle: Bundle): string[] {
  const out: string[] = [];
  const push = (prefix: string, decls: readonly PropertyDecl[] | undefined): void => {
    for (const d of decls ?? []) if (d.durable === true) out.push(`${prefix}${d.name}`);
  };
  push("story.", bundle.story.properties);
  for (const box of bundle.boxes) {
    push(`box.${box.id}.`, box.properties);
    for (const deck of box.decks) push(`deck.${deck.id}.`, deck.properties);
    for (const hand of box.hands) {
      const decls = hand.template !== undefined
        ? box.handTemplates.find((t) => t.id === hand.template)?.properties
        : hand.properties;
      push(`hand.${hand.id}.`, decls);
    }
    for (const group of box.tagGroups) {
      for (const tag of group.tags) push(`value.${tag.id}.`, tag.properties);
    }
  }
  return out;
}

/** Every card whose spend outlives a run, by id, with whether that spend is
 *  one person's or the whole world's. The card's flags, else its deck's, which
 *  is the inheritance both axes have (4.2). */
export function durableCardIds(bundle: Bundle): Map<string, { shared: boolean }> {
  const out = new Map<string, { shared: boolean }>();
  for (const box of bundle.boxes) {
    for (const deck of box.decks) {
      for (const card of deck.cards) {
        if ((card.durable ?? deck.durable) !== true) continue;
        out.set(card.id, { shared: (card.shared ?? deck.shared) === true });
      }
    }
  }
  return out;
}

export class Table {
  readonly engine: Engine;
  session: Flow;
  /** Card id -> display label, for naming non-dealt cards from their trace id. */
  private readonly cardLabels = new Map<string, { gameId: string; title?: string }>();
  /** Where each card lives, for a surface that wants to open it in the editor.
   *  Bundle ids ARE source ids (the compiler carries them through), so these
   *  address the editor's own entities. */
  private readonly cardHomes = new Map<string, { box: string; deck: string; card: string }>();
  /** Card id -> its box's gameId, for the journal's box-qualified stamps. */
  private readonly cardBoxes = new Map<string, string>();

  constructor(readonly bundle: Bundle, readonly seed: number) {
    // The flow keeps its own retained log (the game-engine introspection
    // seam) - the window reads it rather than buffering the trace itself.
    // The Board is a HOST: one engine, one "main" flow (the flow tools come
    // later, design/flows.md), the engine self-backing @world.
    this.engine = new Engine(bundle, { seed, log: { cap: 200 } });
    this.session = this.engine.openFlow("main");
    for (const box of bundle.boxes) {
      for (const deck of box.decks) {
        for (const card of deck.cards) {
          this.cardLabels.set(card.id, { gameId: card.gameId ?? card.id, ...(card.title !== undefined ? { title: card.title } : {}) });
          this.cardHomes.set(card.id, { box: box.id, deck: deck.id, card: card.id });
          this.cardBoxes.set(card.id, box.gameId ?? box.id);
        }
      }
    }
  }

  turn(boxGameId: string): number {
    return this.session.turn(boxGameId);
  }

  /** The Board's @world values (the engine self-backs the container; the
   *  Board is the host, so saving them is the Board's job). */
  worldValues(): PropertyBag {
    const out: PropertyBag = {};
    for (const d of this.bundle.world.properties) {
      try { out[d.name] = this.engine.getProperty(`world.${d.name}`); } catch { /* default only */ }
    }
    return out;
  }

  /** The .storyletsave FILE: the engine's envelope plus the Board's @world
   *  container - the host-saves-its-container rule in one file (schema 4). */
  saveFile(): SaveFile {
    return { schema: SAVEFILE_SCHEMA, engine: this.engine.saveGame(), world: this.worldValues() };
  }

  /** Restore from a save file: the envelope first (loadGame rebuilds every
   *  flow, so the "main" handle is re-taken), then the file's @world values
   *  over the reseeded container. The retained journal starts afresh - it
   *  belongs to the flow, and the flow is new. */
  loadFile(file: SaveFile): void {
    this.engine.loadGame(file.engine);
    this.session = this.engine.getFlow("main") ?? this.engine.openFlow("main");
    this.meddles = [];
    for (const [name, value] of Object.entries(file.world ?? {})) {
      try { this.engine.setProperty(`world.${name}`, value); } catch { /* an orphaned key: dropped */ }
    }
  }

  /**
   * A NEW RUN (design/engine-server.md 4.2): the world restarts, and the
   * durable half comes with it.
   *
   * What a designer is testing here is a returning player, which is the
   * ordinary daily event in a venue and not a recovery path: at run end the
   * server lifts the durable values and spends out of the engine, and at run
   * start it writes them back into a fresh one. This does exactly that, on the
   * public surface and nothing else, because the RUNTIME IS INERT about
   * durability and must stay so: saveGame to read what is there, reset,
   * openFlow with a restore for the durable cooldowns, setProperty for the
   * values and markTaken for the shared spends.
   *
   * @world is untouched. It is the host's container, not the engine's, and
   * neither this nor Forget everyone is the game's business (4.2).
   */
  newRun(): void {
    // Read everything durable BEFORE the reset, while it still exists.
    const kept: [string, ScalarValue][] = [];
    for (const path of durablePropertyPaths(this.bundle)) {
      try { kept.push([path, this.session.getProperty(path)]); } catch { /* not readable: dropped */ }
    }
    const durableCards = durableCardIds(this.bundle);
    const before = this.engine.saveGame();
    const cooldowns: Record<string, number> = {};
    for (const [cardId, until] of Object.entries(before.flows["main"]?.cooldowns ?? {})) {
      // Only a `never` spend crosses the run boundary, and only a per-flow one
      // is the flow's to carry: a shared spend lives in the engine's set below.
      const card = durableCards.get(cardId);
      if (card !== undefined && !card.shared && until === Number.MAX_SAFE_INTEGER) cooldowns[cardId] = until;
    }
    const spent = before.shared.spent.filter((id) => durableCards.get(id)?.shared === true);
    const world = this.worldValues();

    this.engine.reset();
    // A fresh flow first, to take its blob: the run's seed, its zeroed clocks
    // and its default state, which is what a new run starts from. The durable
    // cooldowns go back on top of that, and openFlow REPLACES the name, which
    // is the one door that restores into a flow (4.1).
    this.engine.openFlow("main");
    const blank = this.engine.saveFlow("main");
    this.session = this.engine.openFlow("main", { restore: { ...blank, cooldowns } });
    for (const id of spent) this.engine.markTaken(id);
    // setProperty routes to whichever half the declaration put the value in,
    // so the pocket and the installation's memory are written the same way.
    for (const [path, value] of kept) {
      try { this.session.setProperty(path, value); } catch { /* the declaration moved: dropped */ }
    }
    for (const [name, value] of Object.entries(world)) {
      try { this.engine.setProperty(`world.${name}`, value); } catch { /* an orphaned key: dropped */ }
    }
    this.meddles = [];
  }

  /** The author's pokes (State tab), interleaved into the record. */
  private meddles: MeddleEntry[] = [];

  /** The session's retained event log, oldest first, with the author's own
   *  pokes interleaved where they happened - the journal must not silently
   *  lie about who wrote what. */
  get log(): readonly BoardLogEntry[] {
    if (this.meddles.length === 0) return this.session.log();
    return [...this.session.log(), ...this.meddles].sort((a, b) => a.seq - b.seq);
  }

  /** Poke a property AS THE AUTHOR, on the record: sets it and journals a
   *  meddle entry (a Board-side synthetic - the game never did this, so it is
   *  never a trace event). `label` is the state strip's display name. */
  meddle(path: string, value: ScalarValue, label: string): void {
    let prev: ScalarValue | undefined;
    try { prev = this.session.getProperty(path); } catch { /* undeclared: no prev */ }
    this.session.setProperty(path, value);
    // A seq between the last logged event and the next: fractional, and each
    // further poke halves the remaining gap so a run of pokes stays ordered
    // without ever reaching the next integer seq.
    const logged = this.session.log();
    const base = logged.length > 0 ? logged[logged.length - 1]!.seq : 0;
    const prevSeq = this.meddles[this.meddles.length - 1]?.seq ?? 0;
    const seq = prevSeq > base ? prevSeq + (Math.ceil(prevSeq) - prevSeq) / 2 : base + 0.5;
    this.meddles.push({ type: "meddle", seq, label, ...(prev !== undefined ? { prev } : {}), value });
  }

  /** Every box in the bundle with its tag groups, for the peek runner. */
  boxes(): BoxInfo[] {
    return this.bundle.boxes.map((box) => ({
      gameId: box.gameId ?? box.id,
      ...(box.title !== undefined ? { title: box.title } : {}),
      groups: box.tagGroups.map((g) => ({
        gameId: g.gameId ?? g.id,
        values: g.tags.map((t) => t.gameId ?? t.id),
      })),
    }));
  }

  /** Diagnostics that fired during a peek. They belong to the peek's own
   *  results, never the journal's ⚠ rows: a box-wide peek binds no hand, so a
   *  condition reading composed @hand state faults THERE without the content
   *  being wrong anywhere - the false alarm design/board-legibility.md
   *  records. The journal's warnings stay the ones a real deal or play made. */
  private readonly peekDiagSeqs = new Set<number>();
  isPeekDiagnostic(seq: number): boolean {
    return this.peekDiagSeqs.has(seq);
  }

  /** Peek a box through raw tag criteria; the list carries each card's
   *  ranking keys, and the considered-but-not-listed cards a plain reason. */
  peek(boxGameId: string, criteria: Record<string, string>): DealResult {
    let peekEvent: Extract<TraceEvent, { type: "peek" }> | undefined;
    const diags: { where: string; message: string }[] = [];
    const before = this.session.log();
    const beforeLast = before.length > 0 ? before[before.length - 1]!.seq : -1;
    const unsub = this.session.subscribeTrace((e) => {
      if (e.type === "peek" && e.box === boxGameId) peekEvent = e;
      if (e.type === "diagnostic") diags.push({ where: e.where, message: e.message });
    });
    const list = this.session.peek(boxGameId, criteria);
    unsub();
    for (const e of this.session.log()) {
      if (e.seq > beforeLast && e.type === "diagnostic") this.peekDiagSeqs.add(e.seq);
    }
    const keys = new Map(peekEvent?.cards.map((c) => [c.id, c]));
    const dealt = list.cards.map((card) => ({
      id: card.id,
      gameId: card.gameId,
      ...(card.title !== undefined ? { title: card.title } : {}),
      ...(card.purpose !== undefined ? { purpose: card.purpose } : {}),
      ...(keys.get(card.id)?.priority !== undefined ? { priority: keys.get(card.id)!.priority } : {}),
      ...(keys.get(card.id)?.specificity !== undefined ? { specificity: keys.get(card.id)!.specificity } : {}),
    }));
    // A condition that faulted on a composed @hand name is not "condition not
    // met" and not an authoring error: this peek simply asked without a hand.
    const diagByCard = new Map<string, string>();
    for (const d of diags) {
      const m = /^card (\S+) condition$/.exec(d.where);
      if (m !== null) diagByCard.set(m[1]!, d.message);
    }
    const notDealt: NotDealt[] = (peekEvent?.cards ?? [])
      .filter((c) => c.verdict !== "dealt")
      .map((c) => {
        const label = this.cardLabels.get(c.id);
        const gameId = label?.gameId ?? c.id;
        const msg = diagByCard.get(gameId) ?? diagByCard.get(c.id);
        const handRef = msg !== undefined ? /@hand\.[a-z0-9_-]+/i.exec(msg)?.[0] : undefined;
        const reason = msg === undefined ? VERDICT_REASON[c.verdict]
          : handRef !== undefined ? `depends on the asking hand (reads ${handRef})`
          : `condition errored: ${msg}`;
        return { gameId, ...(label?.title !== undefined ? { title: label.title } : {}), reason };
      });
    return { dealt, notDealt };
  }

  /** Every hand the bundle declares - the valid hands for this board,
   *  listable before anything is dealt. */
  hands(): HandView[] {
    const out: HandView[] = [];
    for (const box of this.bundle.boxes) {
      const templatesById = new Map(box.handTemplates.map((t) => [t.id, t]));
      const tagNames = new Map(box.tagGroups.flatMap((g) => g.tags.map((t) => [t.id, t.gameId ?? t.id] as const)));
      const groupNames = new Map(box.tagGroups.map((g) => [g.id, g.gameId ?? g.id]));
      for (const hand of box.hands) {
        const template = hand.template !== undefined ? templatesById.get(hand.template) : undefined;
        // The hand's whole slice, by name: the template's fixed bindings (or
        // the rule's) overlaid with the instance's chosen tags.
        const bound: Record<string, string> = {};
        for (const [g, t] of Object.entries({
          ...(template?.bindings ?? hand.rule?.bindings ?? {}),
          ...(hand.chosen ?? {}),
        })) {
          bound[groupNames.get(g) ?? g] = tagNames.get(t) ?? t;
        }
        out.push({
          id: hand.id,
          gameId: hand.gameId ?? hand.id,
          ...(hand.title !== undefined ? { title: hand.title } : {}),
          ...(template !== undefined ? { template: template.gameId ?? template.id } : {}),
          ...(hand.slots !== undefined ? { slots: hand.slots } : {}),
          chosen: Object.entries(hand.chosen ?? {}).map(([g, t]) =>
            `${groupNames.get(g) ?? g} = ${tagNames.get(t) ?? t}`),
          tags: bound,
          box: box.gameId ?? box.id,
        });
      }
    }
    return out;
  }

  /** Every box's clock (schema 3.4), for the Board's turn drill-down.
   *  `seconds` comes with a TIMED box (design/engine-server.md 4.8), which is
   *  what lets the dial say the unit and offer steps of time. */
  clocks(): { box: string; turn: number; seconds?: number }[] {
    return this.bundle.boxes.map((box) => {
      const gameId = box.gameId ?? box.id;
      return {
        box: gameId, turn: this.session.turn(gameId),
        ...(box.turn !== undefined ? { seconds: box.turn.seconds } : {}),
      };
    });
  }

  /** The Board's Next Turn: every box's clock advances together (concept A);
   *  plays advance their own box's clock as configured. */
  nextTurn(): void {
    for (const box of this.bundle.boxes) this.session.advanceTurns(box.gameId ?? box.id, 1);
  }

  /** A card's box and deck, for revealing it in the editor. */
  home(cardId: string): { box: string; deck: string; card: string } | undefined {
    return this.cardHomes.get(cardId);
  }

  /** A card's box, as the gameId the clocks and journal speak. */
  boxOf(cardId: string): string | undefined {
    return this.cardBoxes.get(cardId);
  }

  /** A card's display label from its id (log rows, why-panels). */
  label(cardId: string): { gameId: string; title?: string } {
    return this.cardLabels.get(cardId) ?? { gameId: cardId };
  }

  /** A card face from its gameId, which is how a game's board snapshot names
   *  what a hand holds (Live mode). A gameId this bundle does not know (the
   *  game is on a different build) still gets a face, named by the gameId. */
  faceByGameId(gameId: string, from: string): DealtView {
    for (const [id, label] of this.cardLabels) {
      if (label.gameId === gameId) return { id, gameId, ...(label.title !== undefined ? { title: label.title } : {}), from };
    }
    return { id: gameId, gameId, from };
  }

  /** Deal every hand, returning each hand's contents (the board: an
   *  all-hands dealMany's dealt slice IS the whole board). */
  dealAll(): { hand: string; cards: DealtView[] }[] {
    const board = this.session.dealMany();
    return Object.entries(board).map(([hand, cards]) => ({
      hand,
      cards: cards.map((c) => ({
        id: c.id, gameId: c.gameId,
        ...(c.title !== undefined ? { title: c.title } : {}),
        ...(c.purpose !== undefined ? { purpose: c.purpose } : {}),
        from: hand,
      })),
    }));
  }

  /** cardId -> everything its condition (and its deck's gate) reads, from the
   *  compiled ASTs. Built once; the ripple's attribution key. */
  private reads?: Map<string, Set<string>>;
  private readsOf(cardId: string): Set<string> {
    if (!this.reads) {
      this.reads = new Map();
      for (const box of this.bundle.boxes) {
        for (const deck of box.decks) {
          const gate = astRefs((deck.condition as { ast?: unknown } | undefined)?.ast);
          for (const card of deck.cards) {
            const refs = astRefs((card.condition as { ast?: unknown } | undefined)?.ast);
            for (const r of gate) refs.add(r);
            this.reads.set(card.id, refs);
          }
        }
      }
    }
    return this.reads.get(cardId) ?? new Set();
  }

  /** seq of a play entry -> the hand it was played out of, recorded at the
   *  callsite (see attributeRipple's note on why the trace cannot carry it).
   *  Session-lifetime, like the log it annotates. */
  private playedFrom = new Map<number, string>();

  /** Play through the Table so the ripple learns the hand. */
  play(cardId: string, outcomeGameId: string, from: string): void {
    this.session.play(cardId, outcomeGameId, from);
    const last = [...this.log].reverse().find((e) => e.type === "play");
    if (last !== undefined) this.playedFrom.set(last.seq, from);
  }

  /** The consequences of the play at `index` in `entries` (the ripple). */
  rippleFor(entries: readonly BoardLogEntry[], index: number): RippleItem[] {
    const entry = entries[index];
    const from = entry !== undefined ? this.playedFrom.get(entry.seq) : undefined;
    return attributeRipple(entries, index, (c) => this.readsOf(c), from);
  }

  outcomes(cardId: string, from: string): { gameId: string; title?: string; purpose?: string; available: boolean }[] {
    return this.session.outcomes(cardId, from).map((o) => ({
      gameId: o.gameId,
      ...(o.title !== undefined ? { title: o.title } : {}),
      ...(o.purpose !== undefined ? { purpose: o.purpose } : {}),
      available: o.available,
    }));
  }

  /** The declared state a writer pokes: @world, @story, and tag properties
   *  (the ones that visibly change an ask). Read live. */
  stateRows(): StateRow[] {
    const rows: StateRow[] = [];
    const readable = (path: string): ScalarValue | undefined => {
      try { return this.session.getProperty(path); } catch { return undefined; }
    };
    const push = (path: string, label: string, scope: string, decl: { type: string; stages?: string[] }): void => {
      const value = readable(path);
      if (value === undefined) return;
      rows.push({
        path, label, scope, value, editable: decl.type !== "flags",
        ...(decl.type === "quality" && decl.stages !== undefined ? { stages: decl.stages } : {}),
      });
    };
    for (const decl of this.bundle.world.properties) push(`world.${decl.name}`, decl.name, "world", decl);
    for (const decl of this.bundle.story.properties) push(`story.${decl.name}`, decl.name, "story", decl);
    for (const box of this.bundle.boxes) {
      for (const group of box.tagGroups) {
        for (const tag of group.tags) {
          for (const decl of tag.properties ?? []) {
            push(`value.${tag.id}.${decl.name}`, `${tag.gameId}.${decl.name}`, group.gameId ?? group.id, decl);
          }
        }
      }
      // Deck QUALITIES join the strip: a spine is exactly the state a tester
      // jumps around ("what do the late cards look like at 'resolved'?"),
      // where a deck's booleans are latches that play sets, and listing all
      // of those would bury the strip. The full deck state stays visible
      // through the trace when a play writes it.
      for (const deck of box.decks) {
        for (const decl of deck.properties ?? []) {
          if (decl.type !== "quality") continue;
          push(`deck.${deck.id}.${decl.name}`, `${effectiveGameId(deck)}.${decl.name}`, effectiveGameId(box), decl);
        }
      }
    }
    return rows;
  }
}

/** Parse a poked value from text: JSON5-ish scalar, else the raw string. */
export function coerceStateInput(raw: string): ScalarValue {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return raw;
}

// --- the ripple (design/board-ripple.md) -------------------------------------
// Cross-box causality derived FROM THE LOG at render time: a play's writes are
// the contiguous write entries logged just before it, its candidates are the
// deal/evict entries of the refresh just after it, and attribution is the
// intersection of a candidate's read-set with those writes - plus the one
// honest non-read rule, the freed slot.

/** Every `scope.name` a compact compiled AST reads: `["sv", scope, name]`
 *  nodes, collected recursively. Tolerant of shapes it does not know. */
export function astRefs(ast: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node[0] === "sv" && typeof node[1] === "string" && typeof node[2] === "string") {
      out.add(`${node[1]}.${node[2]}`.toLowerCase());
      return;
    }
    for (const part of node) walk(part);
  };
  walk(ast);
  return out;
}

export interface RippleItem {
  kind: "dealt" | "left";
  card: string;
  hand: string;
  why: "reads" | "slot";
  /** The seq of the deal/evict entry this item came from: the journal uses it
   *  to suppress the flat row that would tell the same event twice. */
  seq: number;
}

/** The consequences of the play at `playIndex` in `entries` (its position,
 *  not its seq). `playedFrom` is the hand the card was played out of - the
 *  HOST records it at the play() callsite, because the cross-runtime trace
 *  format does not carry it (adding it there is a four-runtime fixture
 *  change, the noted upgrade path if live mode ever wants slot attribution).
 *  Pure: the log in, the attributed items out. */
export function attributeRipple(
  entries: readonly BoardLogEntry[], playIndex: number, readsOf: (cardId: string) => Set<string>,
  playedFrom?: string,
): RippleItem[] {
  const play = entries[playIndex];
  if (play === undefined || play.type !== "play") return [];

  // The play's writes: contiguous write entries immediately before it.
  const writes = new Set<string>();
  for (let i = playIndex - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.type !== "write") break;
    writes.add(e.path.toLowerCase());
  }

  const reads = (card: string): boolean => {
    for (const ref of readsOf(card)) if (writes.has(ref)) return true;
    return false;
  };

  // The refresh: deal/evict entries after the play, up to the next boundary
  // (a meddle - the author's own poke - is a boundary too: what follows it is
  // the poke's doing, not this play's).
  const items: RippleItem[] = [];
  for (let i = playIndex + 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.type === "play" || e.type === "write" || e.type === "turns" || e.type === "meddle") break;
    if (e.type === "deal") {
      for (const c of e.cards) {
        if (c.verdict !== "dealt") continue;
        if (reads(c.id)) items.push({ kind: "dealt", card: c.id, hand: e.hand, why: "reads", seq: e.seq });
        else if (playedFrom !== undefined && e.hand === playedFrom) items.push({ kind: "dealt", card: c.id, hand: e.hand, why: "slot", seq: e.seq });
      }
    } else if (e.type === "evict") {
      // An eviction is a consequence only through reads: a claim moving or a
      // hand condition is the board reshuffling, not this play speaking.
      if (reads(e.card)) items.push({ kind: "left", card: e.card, hand: e.hand, why: "reads", seq: e.seq });
    }
  }
  return items;
}

// --- the journal plan (design/board-legibility.md piece 3) ---------------------
// The log is the record; the journal is a TELLING of it. One play narrated
// itself two or three times - the "and so" rows under the play AND flat
// dealt/left rows for the same events, with the play's writes printed above
// the play that caused them. The plan regroups at render time: a play carries
// its writes and its consequences; an attributed deal/evict never renders
// flat again; a full every-box turn advance collapses to one row. The stored
// log is untouched (its order is the four-runtime trace contract).

/** The author's own poke from the State tab, as a journal entry. Board-side
 *  and synthetic - never a trace event, because the game never did this - so
 *  the journal stays a complete causal record instead of silently lying. */
export interface MeddleEntry {
  type: "meddle";
  seq: number;
  /** The state strip's own label for the property ("heat", "docks.patrolled"). */
  label: string;
  prev?: ScalarValue;
  value: ScalarValue;
}

export type BoardLogEntry = LogEntry | MeddleEntry;

type WriteE = Extract<LogEntry, { type: "write" }>;
type TurnsE = Extract<LogEntry, { type: "turns" }>;

export type JournalItem =
  | { kind: "entry"; entry: BoardLogEntry }
  | { kind: "play"; index: number; entry: Extract<LogEntry, { type: "play" }>; writes: WriteE[]; ripple: RippleItem[] }
  | { kind: "turns"; entries: TurnsE[]; uniform?: number };

export function journalPlan(
  entries: readonly BoardLogEntry[],
  rippleFor: (index: number) => RippleItem[],
  boxCount: number,
): JournalItem[] {
  // First pass: every play's ripple, and which deal/evict entries it covers.
  const ripples = new Map<number, RippleItem[]>();
  const coveredDeal = new Map<number, Set<string>>();
  const coveredEvict = new Set<number>();
  entries.forEach((e, i) => {
    if (e.type !== "play") return;
    const ripple = rippleFor(i);
    ripples.set(i, ripple);
    for (const item of ripple) {
      if (item.kind === "dealt") {
        const set = coveredDeal.get(item.seq) ?? new Set<string>();
        set.add(item.card);
        coveredDeal.set(item.seq, set);
      } else {
        coveredEvict.add(item.seq);
      }
    }
  });

  const items: JournalItem[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    switch (e.type) {
      case "write": {
        // Contiguous writes running straight into a play are the play's: the
        // play item tells them, indented under their cause.
        let j = i;
        while (j < entries.length && entries[j]!.type === "write") j++;
        if (entries[j]?.type !== "play") items.push({ kind: "entry", entry: e });
        break;
      }
      case "play": {
        const writes: WriteE[] = [];
        for (let j = i - 1; j >= 0 && entries[j]!.type === "write"; j--) writes.unshift(entries[j] as WriteE);
        items.push({ kind: "play", index: i, entry: e, writes, ripple: ripples.get(i) ?? [] });
        break;
      }
      case "turns": {
        // A full every-box advance is one beat, not one per clock. A partial
        // run (a lone per-box +1, or a game advancing some clocks) keeps its
        // own rows; a single-box project has nothing to collapse.
        const run: TurnsE[] = [];
        let j = i;
        while (j < entries.length && entries[j]!.type === "turns") { run.push(entries[j] as TurnsE); j++; }
        if (run.length === boxCount && boxCount > 1) {
          const uniform = run.every((t) => t.turn === run[0]!.turn) ? run[0]!.turn : undefined;
          items.push({ kind: "turns", entries: run, ...(uniform !== undefined ? { uniform } : {}) });
        } else {
          for (const t of run) items.push({ kind: "entry", entry: t });
        }
        i = j - 1;
        break;
      }
      case "deal": {
        const covered = coveredDeal.get(e.seq);
        if (covered === undefined) { items.push({ kind: "entry", entry: e }); break; }
        // Attributed cards were told under their play; only coincidences keep
        // a flat row. A deal fully told falls away.
        const rest = e.cards.filter((c) => c.verdict !== "dealt" || !covered.has(c.id));
        if (rest.some((c) => c.verdict === "dealt")) items.push({ kind: "entry", entry: { ...e, cards: rest } });
        break;
      }
      case "evict": {
        if (!coveredEvict.has(e.seq)) items.push({ kind: "entry", entry: e });
        break;
      }
      default:
        items.push({ kind: "entry", entry: e });
    }
  }
  return items;
}

/** The hands whose contents changed between two boards: what pulses. */
export function diffBoards(
  before: readonly { hand: string; cards: readonly { id: string }[] }[],
  after: readonly { hand: string; cards: readonly { id: string }[] }[],
): Set<string> {
  const key = (cards: readonly { id: string }[]): string => cards.map((c) => c.id).sort().join("|");
  const was = new Map(before.map((b) => [b.hand, key(b.cards)]));
  const changed = new Set<string>();
  for (const b of after) {
    if ((was.get(b.hand) ?? "") !== key(b.cards)) changed.add(b.hand);
    was.delete(b.hand);
  }
  for (const [hand, k] of was) if (k !== "") changed.add(hand);
  return changed;
}
