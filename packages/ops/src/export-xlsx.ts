// ---------------------------------------------------------------------------
// The readable export: the whole source project as an .xlsx workbook, for the
// lead who reviews in a meeting and the producer who filters (parity audit
// 9.5, ruled 2026-08-21: a spreadsheet, not a PDF).
//
// A renderer over the LOADED SOURCE, never the bundle, so titles and purposes
// are always there and a stripped-metadata project exports exactly like a full
// one. Sheets: Overview, one per deck (rows = cards), Outcomes, Hands, Tag
// groups. The one-to-many of card -> outcomes is flattened both ways Patter's
// sheets do it: newline-joined into one cell on the deck sheet (voice-script's
// comments column, for reading) AND one row each on an Outcomes sheet
// (report's own-sheet-per-entity, for filtering). exceljs is lazy-loaded,
// as in Patter's report-xlsx: heavy, and only this path needs it.
// ---------------------------------------------------------------------------

import { projectHash } from "@storylet-studio/compiler";
import type { SourceBox, SourceDeck, SourceProject } from "@storylet-studio/compiler";
import { byDisplayOrder, effectiveGameId, handBinding, PLACE_GROUP } from "@storylet-studio/model";
import type { Card, FieldDecl, Hand, HandTemplate, Outcome, PropertyDecl, ScalarValue, TagGroup } from "@storylet-studio/model";

export interface ExportXlsxCounts {
  boxes: number;
  decks: number;
  cards: number;
  outcomes: number;
  hands: number;
  tagGroups: number;
}

export interface ExportXlsxResult {
  buffer: Buffer;
  counts: ExportXlsxCounts;
  /** Sheet names in workbook order (Overview first). */
  sheets: string[];
}

export interface ExportXlsxOptions {
  /** The "Generated" stamp on the Overview sheet; defaults to now. */
  generated?: Date;
}

const RESERVED_SHEETS = ["Overview", "Outcomes", "Hands", "Tag groups"] as const;

/** exceljs forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
const cleanSheetName = (raw: string): string =>
  raw.replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31) || "Deck";

/** The suggested file name: the project's name, with path-hostile characters
 *  folded to spaces (Patterpad's safeStem). */
export function spreadsheetFileName(source: SourceProject): string {
  const stem = source.project.project.name.replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${stem || "project"}.xlsx`;
}

/** The authored display order: `order` where set, position otherwise (the
 *  editor's own rule, project.ts toDto), so the sheets read as the navigator does. */
const authored = <T>(items: T[], orderOf: (item: T) => number | undefined): T[] =>
  items.map((item, i) => ({ item, o: orderOf(item) ?? i })).sort((a, b) => a.o - b.o).map((x) => x.item);

const scalar = (value: ScalarValue | undefined): string | number | boolean => {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return value;
};

const label = (entity: { id: string; gameId?: string; title?: string }): string =>
  entity.title ?? effectiveGameId(entity);

const properties = (decls: PropertyDecl[] | undefined): string =>
  (decls ?? []).map((d) => `${d.name} = ${String(scalar(d.default))}`).join("; ");

const changes = (outcome: Outcome<string>): string =>
  Object.entries(outcome.changes).map(([target, expr]) => `${target} = ${expr}`).join("; ");

/** One outcome as a line of the deck sheet's Outcomes cell. */
const outcomeLine = (outcome: Outcome<string>): string => {
  const when = outcome.condition !== undefined && outcome.condition.trim() !== "" ? ` [when ${outcome.condition}]` : "";
  const what = changes(outcome);
  return `${label(outcome)}${when}: ${what === "" ? "(no changes)" : what}`;
};

/** Everything a box's rows need resolved once: tag ids to gameIds, hand ids
 *  to gameIds (the home group's values), templates by id. */
class BoxLookup {
  readonly title: string;
  readonly groups: TagGroup[];
  readonly fields: FieldDecl[];
  readonly templates: Map<string, HandTemplate<string>>;
  private readonly tagNames = new Map<string, string>();
  private readonly handNames = new Map<string, string>();

  constructor(readonly box: SourceBox) {
    this.title = label(box.box.box);
    this.groups = box.tags.groups;
    this.fields = box.box.box.fields ?? [];
    this.templates = new Map(box.hands.templates.map((t) => [t.id, t]));
    for (const group of this.groups) for (const tag of group.tags) this.tagNames.set(tag.id, effectiveGameId(tag));
    for (const hand of box.hands.hands) this.handNames.set(hand.id, effectiveGameId(hand));
  }

  tagName(id: string): string { return this.tagNames.get(id) ?? this.handNames.get(id) ?? id; }
  groupName(id: string): string {
    const group = this.groups.find((g) => g.id === id);
    return group ? effectiveGameId(group) : id;
  }
  tagList(ids: string[] | undefined): string { return (ids ?? []).map((id) => this.tagName(id)).join(", "); }
}

/** The hand's tags, every route in (template hole, own rule, template's fixed
 *  binding), as "group = tag" pairs. */
function handTags(lookup: BoxLookup, hand: Hand<string>, template: HandTemplate<string> | undefined): string {
  const groupIds = new Set<string>(lookup.groups.map((g) => g.id));
  for (const id of template?.chooses ?? []) groupIds.add(id);
  for (const id of Object.keys(template?.bindings ?? {})) groupIds.add(id);
  for (const id of Object.keys(hand.rule?.bindings ?? {})) groupIds.add(id);
  const pairs: string[] = [];
  for (const groupId of groupIds) {
    const binding = handBinding(hand, template, groupId);
    if (binding.kind === "none" || binding.tag === undefined) continue;
    pairs.push(`${lookup.groupName(groupId)} = ${lookup.tagName(binding.tag)}`);
  }
  return pairs.join("; ");
}

export async function runExportXlsx(source: SourceProject, opts: ExportXlsxOptions = {}): Promise<ExportXlsxResult> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "storyletengine";

  const boxes = authored(source.boxes, (b) => b.box.box.order).map((b) => new BoxLookup(b));
  const manyBoxes = boxes.length > 1;
  const boxColumn = manyBoxes ? [{ header: "Box", key: "box", width: 16 }] : [];
  const bold = (ws: import("exceljs").Worksheet): void => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  // Sheet names: the deck's title, the box added when two decks share one, a
  // number when even that collides. Excel treats names case-insensitively.
  const taken = new Set<string>(RESERVED_SHEETS.map((n) => n.toLowerCase()));
  const claim = (deckTitle: string, boxTitle: string): string => {
    const candidates = [deckTitle, `${deckTitle} (${boxTitle})`];
    for (let n = 2; ; n++) {
      const raw = candidates.shift() ?? `${deckTitle} (${n})`;
      const name = cleanSheetName(raw);
      if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
    }
  };

  const counts: ExportXlsxCounts = { boxes: boxes.length, decks: 0, cards: 0, outcomes: 0, hands: 0, tagGroups: 0 };
  const deckSheets: { name: string; box: string; deck: string; cards: number }[] = [];

  // Overview is the first sheet and is filled in last, once the counts exist.
  const overview = wb.addWorksheet("Overview");
  const outcomeRows: Record<string, string | number>[] = [];

  // --- one sheet per deck ---------------------------------------------------
  for (const lookup of boxes) {
    const decks: SourceDeck[] = authored(lookup.box.decks, (d) => d.shard.deck.order);
    for (const deck of decks) {
      counts.decks++;
      const deckTitle = label(deck.shard.deck);
      const name = claim(deckTitle, lookup.title);
      const ws = wb.addWorksheet(name);

      // Tag groups the cards actually use beyond the declared ones (the reserved
      // home group, whose values are hand names) get a column too.
      const extraGroups: string[] = [];
      for (const card of deck.shard.cards) {
        for (const key of Object.keys(card.tags ?? {})) {
          if (!lookup.groups.some((g) => g.id === key) && !extraGroups.includes(key)) extraGroups.push(key);
        }
      }

      ws.columns = [
        ...boxColumn,
        { header: "Title", key: "title", width: 32 },
        { header: "gameId", key: "gameId", width: 24 },
        { header: "When", key: "when", width: 36 },
        { header: "Priority", key: "priority", width: 9 },
        { header: "Redraw", key: "redraw", width: 9 },
        { header: "Copies", key: "copies", width: 8 },
        // Shared scarcity (design/shared-scarcity.md), which landed after this
        // sheet was written and had no column: the workbook advertises itself
        // as the whole project made readable, and a reviewer filtering on
        // "what is scarce" could not see it. "deck" says the card takes its
        // deck's flag, which is the third state the card page shows too - it
        // reads differently from a plain no, and an author needs to know why a
        // card in a shared pile is scarce.
        { header: "Shared", key: "shared", width: 10 },
        { header: "In the world", key: "sharedCopies", width: 12 },
        ...lookup.groups.map((g) => ({ header: effectiveGameId(g), key: `t:${g.id}`, width: 16 })),
        // The reserved group is headed "Place", capitalised like every other
        // column header rather than left as the bare group name.
        ...extraGroups.map((id) => ({ header: id === PLACE_GROUP ? "Place" : id, key: `t:${id}`, width: 16 })),
        ...lookup.fields.map((f) => ({ header: f.name, key: `f:${f.name}`, width: 14 })),
        { header: "Purpose", key: "purpose", width: 48 },
        { header: "Outcomes", key: "outcomes", width: 60 },
      ];
      bold(ws);

      const cards: Card<string>[] = authored(deck.shard.cards, (c) => c.order);
      for (const card of cards) {
        counts.cards++;
        const row = ws.addRow({
          box: lookup.title,
          title: label(card),
          gameId: effectiveGameId(card),
          when: card.condition ?? "",
          priority: card.priority,
          redraw: String(card.redraw),
          copies: card.copies ?? 1,
          shared: card.shared === undefined
            ? (deck.shard.deck.shared === true ? "deck (shared)" : "deck")
            : (card.shared ? "yes" : "no"),
          sharedCopies: (card.shared ?? deck.shard.deck.shared === true)
            ? (card.sharedCopies ?? card.copies ?? 1)
            : "",
          ...Object.fromEntries([...lookup.groups.map((g) => g.id), ...extraGroups]
            .map((id) => [`t:${id}`, lookup.tagList(card.tags?.[id])])),
          ...Object.fromEntries(lookup.fields.map((f) => [`f:${f.name}`, scalar(card.fields?.[f.name] ?? f.default)])),
          purpose: card.purpose ?? "",
          outcomes: byDisplayOrder(card.outcomes).map(outcomeLine).join("\n"),
        });
        for (const key of ["when", "purpose", "outcomes"]) row.getCell(key).alignment = { wrapText: true, vertical: "top" };

        for (const outcome of byDisplayOrder(card.outcomes)) {
          counts.outcomes++;
          outcomeRows.push({
            box: lookup.title, deck: deckTitle, card: label(card), outcome: label(outcome),
            gameId: effectiveGameId(outcome), when: outcome.condition ?? "", changes: changes(outcome),
            purpose: outcome.purpose ?? "",
          });
        }
      }
      deckSheets.push({ name, box: lookup.title, deck: deckTitle, cards: cards.length });
    }
  }

  // --- Outcomes ---------------------------------------------------------------
  const outcomes = wb.addWorksheet("Outcomes");
  outcomes.columns = [
    ...boxColumn,
    { header: "Deck", key: "deck", width: 20 },
    { header: "Card", key: "card", width: 32 },
    { header: "Outcome", key: "outcome", width: 32 },
    { header: "gameId", key: "gameId", width: 24 },
    { header: "When", key: "when", width: 36 },
    { header: "Changes", key: "changes", width: 60 },
    { header: "Purpose", key: "purpose", width: 48 },
  ];
  bold(outcomes);
  for (const r of outcomeRows) {
    const row = outcomes.addRow(r);
    for (const key of ["when", "changes", "purpose"]) row.getCell(key).alignment = { wrapText: true, vertical: "top" };
  }

  // --- Hands ------------------------------------------------------------------
  const hands = wb.addWorksheet("Hands");
  hands.columns = [
    ...boxColumn,
    { header: "Hand", key: "hand", width: 28 },
    { header: "gameId", key: "gameId", width: 24 },
    { header: "Template", key: "template", width: 24 },
    { header: "When", key: "when", width: 36 },
    { header: "Tags", key: "tags", width: 32 },
    { header: "Slots", key: "slots", width: 10 },
    { header: "Purpose", key: "purpose", width: 48 },
  ];
  bold(hands);
  for (const lookup of boxes) {
    for (const hand of authored(lookup.box.hands.hands, (h) => h.order)) {
      counts.hands++;
      const template = hand.template !== undefined ? lookup.templates.get(hand.template) : undefined;
      const row = hands.addRow({
        box: lookup.title,
        hand: label(hand),
        gameId: effectiveGameId(hand),
        template: template ? label(template) : (hand.template ?? "(own rule)"),
        when: template?.condition ?? hand.rule?.condition ?? "",
        tags: handTags(lookup, hand, template),
        slots: String(hand.slots ?? template?.slots ?? hand.rule?.slots ?? ""),
        purpose: hand.purpose ?? "",
      });
      for (const key of ["when", "tags", "purpose"]) row.getCell(key).alignment = { wrapText: true, vertical: "top" };
    }
  }

  // --- Tag groups -------------------------------------------------------------
  const tags = wb.addWorksheet("Tag groups");
  tags.columns = [
    ...boxColumn,
    { header: "Group", key: "group", width: 20 },
    { header: "Tag", key: "tag", width: 24 },
    { header: "Properties", key: "properties", width: 36 },
    { header: "Purpose", key: "purpose", width: 48 },
  ];
  bold(tags);
  for (const lookup of boxes) {
    for (const group of lookup.groups) {
      counts.tagGroups++;
      const groupName = effectiveGameId(group);
      if (group.tags.length === 0) {
        tags.addRow({ box: lookup.title, group: groupName, tag: "", properties: "", purpose: group.purpose ?? "" });
      }
      for (const tag of group.tags) {
        tags.addRow({
          box: lookup.title, group: groupName, tag: effectiveGameId(tag),
          properties: properties(tag.properties), purpose: group.purpose ?? "",
        });
      }
    }
  }

  // --- Overview ---------------------------------------------------------------
  const generated = opts.generated ?? new Date();
  overview.getColumn(1).width = 16;
  overview.getColumn(2).width = 40;
  overview.getColumn(3).width = 20;
  overview.getColumn(4).width = 10;
  const facts: [string, string | number][] = [
    ["Project", source.project.project.name],
    ["Version", source.project.project.version],
    ["Content hash", projectHash(source)],
    ["Generated", `${generated.toISOString().slice(0, 19).replace("T", " ")} UTC`],
    ["Boxes", counts.boxes],
    ["Decks", counts.decks],
    ["Cards", counts.cards],
    ["Outcomes", counts.outcomes],
    ["Hands", counts.hands],
    ["Tag groups", counts.tagGroups],
  ];
  for (const [k, v] of facts) overview.addRow([k, v]).getCell(1).font = { bold: true };
  overview.addRow([]);
  overview.addRow(["Sheet", "Deck", "Box", "Cards"]).font = { bold: true };
  for (const d of deckSheets) overview.addRow([d.name, d.deck, d.box, d.cards]);

  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    counts,
    sheets: wb.worksheets.map((ws) => ws.name),
  };
}
