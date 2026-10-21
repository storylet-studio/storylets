// ---------------------------------------------------------------------------
// The editor's half of a view extension (patterkit design/view-extensions.md,
// app-shell README v0.58): Storyletter's adapter for the shell's `hostView`,
// which answers a view in its own sandboxed window over the MessagePort main
// hands this window. The Fields window's ownership again: this side holds the
// document, so the view reads it from here and every write it makes comes back
// through main as one undo step.
//
// What a view reads is what the writer sees: the project as main last sent it,
// with the edits still waiting for the autosave laid over it (a card's edit,
// and every extension value typed but not yet written). A structural edit (a
// box's name, a deck's settings, a hand) isn't laid over: a read that finds
// one waiting writes it first, which is rare and quick, where laying every
// kind of edit over the project would be a second copy of main's edit rules.
//
// Each node kind is the manifest's (`project`, `box`, `tagGroup`, `tag`,
// `deck`, `card`, `outcome`, `handTemplate`, `hand`), and its `host` fields are
// the model's own names for what the editor shows (`hostFields` below; the
// list is the one Storyletter documents for view authors).
// ---------------------------------------------------------------------------

import { hostViews } from "@wildwinter/app-shell";
import type { HostViewsSetup } from "@wildwinter/app-shell";
import type {
  ViewAdapter, ViewEdit, ViewJson, ViewNode, ViewPortMeta, ViewRefusal, ViewSelection, ViewWritable,
} from "@wildwinter/app-shell/view-protocol";
import { selectedNodes } from "./fields-state.js";
import type { FieldsSelection } from "./fields-state.js";
import { extensionOwner, shownEntry } from "./extension-rows.js";
import { extensionLockMessage } from "./vc-view.js";
import type { Session } from "./session.js";
import { extensionVcKey } from "../../shared/api.js";
import type {
  BoxDto, CardDto, CardEdit, DeckDto, ExtensionWriteResult, OpenResult, OutcomeDto, ProjectDto, ReviewAt,
} from "../../shared/api.js";

export interface ViewHostContext {
  session: Session;
  /** The save queue's waiting edits, as a view reads them. */
  saves: {
    pendingCard(cardId: string): CardEdit | undefined;
    readonly structuralPending: boolean;
    flush(): Promise<void>;
  };
  /** What the editor has selected. */
  selection(): FieldsSelection;
  /** Reveal a node: open its page (navigation.ts `goTo`). */
  goTo(at: ReviewAt): void;
  /** Open the project's own page. */
  focusProject(): void;
  /** Select cards in their deck's views, as a click does. */
  selectCards(ids: string[]): void;
  /** Take main's answer: the project, and its problems (renderer.ts `applyResult`). */
  applyResult(result: OpenResult): void;
  /** Redraw the open page after a view's write, as a Fields edit does: a save doesn't repaint a live document. */
  redraw(): void;
  /** Edit > Undo or Redo, on the project's history (a view has no typing of the editor's to undo). */
  undoRedo(which: "undo" | "redo"): void;
  /** Who holds an extension shard (`ext:<owner>:<id>`), when somebody else does (vc-view.ts). */
  lockedBy?(key: string): readonly string[] | undefined;
}

/** A node as the project has it: its kind, the containing node, and where it is in the DTO. */
interface Found {
  kind: string;
  parent: string | null;
  box?: BoxDto;
  deck?: DeckDto;
  card?: CardDto;
  outcome?: OutcomeDto;
}

const or = <T extends ViewJson>(v: T | undefined): T | null => (v === undefined ? null : v);
const fieldMap = (fields: readonly { name: string; value: string }[]): { [k: string]: ViewJson } =>
  Object.fromEntries(fields.map((f) => [f.name, f.value]));

/** A card with its edit still waiting laid over it: only the keys the edit carries, as main applies it. */
export function cardAsTyped(card: CardDto, edit: CardEdit | undefined): CardDto {
  if (edit === undefined) return card;
  const out: CardDto = { ...card };
  if (edit.title !== undefined) out.title = edit.title;
  if (edit.purpose !== undefined) out.purpose = edit.purpose;
  if (edit.gameId !== undefined) out.gameId = edit.gameId;
  if (edit.condition !== undefined) { if (edit.condition.trim() === "") delete out.condition; else out.condition = edit.condition; }
  if (edit.priority !== undefined) out.priority = edit.priority;
  if (edit.redraw !== undefined) out.redraw = edit.redraw;
  if (edit.copies !== undefined) out.copies = edit.copies;
  if (edit.tags !== undefined) out.tags = edit.tags;
  if (edit.fields !== undefined) out.fields = edit.fields.filter((f) => f.value.trim() !== "");
  if (edit.outcomes !== undefined) {
    out.outcomes = edit.outcomes.map((o): OutcomeDto => {
      const was = card.outcomes.find((x) => x.id === o.id);
      return {
        ...(was ?? { changes: [] }), id: o.id, gameId: o.gameId,
        ...(o.title !== undefined ? { title: o.title } : {}),
        ...(o.purpose !== undefined ? { purpose: o.purpose } : {}),
        ...(o.gate !== undefined && o.gate.trim() !== "" ? { gate: o.gate } : {}),
        fields: (o.fields ?? []).filter((f) => f.value.trim() !== ""),
      } as OutcomeDto;
    });
  }
  return out;
}

/** The editor's selection as a view reads it, innermost first: a card, its deck, its box (fields-state.ts
 *  `selectedNodes`); a hand template, a hand or a tag group, then its box; the project on its own page. An
 *  outcome or a tag is never in it: the editor selects neither on its own (it has no focus kind for them). */
export function selectionOf(ctx: Pick<ViewHostContext, "session" | "selection">): ViewSelection {
  const p = ctx.session.project;
  if (!p) return { path: [] };
  const sel = ctx.selection();
  const known = new Set(Object.values(p.extensionNodes ?? {}).flatMap((ns) => ns.map((n) => n.id)));
  for (const b of p.boxes) for (const d of b.decks) for (const c of d.cards) known.add(c.id);
  const path = selectedNodes(sel).filter((n) => known.has(n.id)).map((n) => ({ id: n.id, kind: n.kind }));
  if (path.length === 0 && sel.focus?.kind === "project") return { path: [{ id: p.projectNode ?? "project", kind: "project" }] };
  return { path };
}

/**
 * The adapter `hostView` answers a view from: Storyletter's project as the writer sees it. Every method reads
 * the session as it stands when asked. With `extension` (the view's), a node whose data for it somebody else holds
 * says so (`held`, the page's lock sentence), as the page locks its rows.
 */
export function viewAdapter(ctx: ViewHostContext, extension?: string): ViewAdapter {
  const { session } = ctx;
  const project = (): ProjectDto | undefined => session.project;
  const projectId = (p: ProjectDto): string => p.projectNode ?? "project";
  const nodesOf = (p: ProjectDto, kind: string) => p.extensionNodes?.[kind] ?? [];
  /** A card as the author has it now. */
  const typed = (card: CardDto): CardDto => cardAsTyped(card, ctx.saves.pendingCard(card.id));

  function find(p: ProjectDto, id: string): Found | null {
    if (id === projectId(p)) return { kind: "project", parent: null };
    for (const box of p.boxes) {
      if (box.id === id) return { kind: "box", parent: projectId(p), box };
      if (box.templates.some((t) => t.id === id)) return { kind: "handTemplate", parent: box.id, box };
      if (box.hands.some((h) => h.id === id)) return { kind: "hand", parent: box.id, box };
      for (const deck of box.decks) {
        if (deck.id === id) return { kind: "deck", parent: box.id, box, deck };
        for (const saved of deck.cards) {
          const card = typed(saved);
          if (card.id === id) return { kind: "card", parent: deck.id, box, deck, card };
          const outcome = card.outcomes.find((o) => o.id === id);
          if (outcome) return { kind: "outcome", parent: card.id, box, deck, card, outcome };
        }
      }
    }
    for (const kind of ["tagGroup", "tag"]) {
      const n = nodesOf(p, kind).find((x) => x.id === id);
      if (n) return { kind, parent: n.parent ?? projectId(p), ...(n.box !== undefined ? { box: p.boxes.find((b) => b.id === n.box)! } : {}) };
    }
    return null;
  }

  /** A tag group's or tag's game id, from the label the editor names it by ("group/tag" for a tag). */
  const gameIdOf = (p: ProjectDto, kind: string, id: string): string => {
    const label = nodesOf(p, kind).find((x) => x.id === id)?.label ?? id;
    return kind === "tag" ? label.slice(label.indexOf("/") + 1) : label;
  };

  function hostFields(p: ProjectDto, id: string, f: Found): { [k: string]: ViewJson } {
    switch (f.kind) {
      case "project": return { name: p.name };
      case "box": {
        const b = f.box!;
        return { gameId: b.gameId, title: or(b.title), purpose: or(b.purpose) };
      }
      case "deck": {
        const d = f.deck!;
        return { gameId: d.gameId, title: or(d.title), purpose: or(d.purpose), gate: or(d.gate), box: f.box!.id };
      }
      case "card": {
        const c = f.card!;
        return {
          gameId: c.gameId, title: or(c.title), purpose: or(c.purpose), condition: or(c.condition),
          priority: c.priority, redraw: c.redraw, copies: c.copies,
          tags: Object.fromEntries(c.tags.map((t) => [t.group, [...t.values]])),
          fields: fieldMap(c.fields), deck: f.deck!.id, box: f.box!.id,
        };
      }
      case "outcome": {
        const o = f.outcome!;
        return {
          gameId: o.gameId, title: or(o.title), purpose: or(o.purpose), gate: or(o.gate), fields: fieldMap(o.fields),
          card: f.card!.id, deck: f.deck!.id, box: f.box!.id,
        };
      }
      case "tagGroup": {
        const g = f.box?.tagGroups.find((x) => x.id === id);
        return {
          gameId: gameIdOf(p, "tagGroup", id),
          tags: nodesOf(p, "tag").filter((t) => t.parent === id).map((t) => gameIdOf(p, "tag", t.id)),
          spatial: g?.spatial === true || (f.box === undefined && p.map?.groupId === id), box: f.box?.id ?? null,
        };
      }
      case "tag": return { gameId: gameIdOf(p, "tag", id), group: f.parent };
      case "handTemplate": {
        const t = f.box!.templates.find((x) => x.id === id)!;
        return { gameId: t.gameId, title: or(t.title), purpose: or(t.purpose), slots: t.slots, bindings: [...t.bindings], box: f.box!.id };
      }
      case "hand": {
        const h = f.box!.hands.find((x) => x.id === id)!;
        // The template by its id, as the hands shard names it (the DTO carries its game id, for the page).
        const template = h.template === undefined ? undefined : f.box!.templates.find((t) => t.gameId === h.template)?.id;
        return {
          gameId: h.gameId, title: or(h.title), template: or(template), slots: or(h.slots), tags: { ...h.tags }, box: f.box!.id,
        };
      }
      default: return {};
    }
  }

  function label(p: ProjectDto, id: string, f: Found): string {
    switch (f.kind) {
      case "project": return p.name;
      case "box": return f.box!.title ?? f.box!.gameId;
      case "deck": return f.deck!.title ?? f.deck!.gameId;
      case "card": return f.card!.title ?? f.card!.gameId;
      case "outcome": return f.outcome!.title ?? f.outcome!.gameId;
      case "handTemplate": { const t = f.box!.templates.find((x) => x.id === id)!; return t.title ?? t.gameId; }
      case "hand": { const h = f.box!.hands.find((x) => x.id === id)!; return h.title ?? h.gameId; }
      default: return gameIdOf(p, f.kind, id);
    }
  }

  /** Every extension's values for the node, as typed (`hostView` keeps the view's own and its reads). */
  function extOf(p: ProjectDto, id: string): ViewNode["ext"] {
    const out: { [x: string]: { [field: string]: ViewJson } } = {};
    for (const x of p.extensions ?? []) {
      const entry = shownEntry(x, id);
      if (entry !== undefined) out[x.id] = entry as { [field: string]: ViewJson };
    }
    return out;
  }

  /** The node's children in order: a project's boxes (then the map's group), a box's decks, tag groups, hand
   *  templates and hands, a deck's cards, a card's outcomes, a tag group's tags. */
  function childIds(p: ProjectDto, id: string, f: Found): string[] {
    switch (f.kind) {
      case "project": return [...p.boxes.map((b) => b.id), ...nodesOf(p, "tagGroup").filter((g) => g.box === undefined).map((g) => g.id)];
      case "box": {
        const b = f.box!;
        return [
          ...b.decks.map((d) => d.id), ...nodesOf(p, "tagGroup").filter((g) => g.parent === b.id).map((g) => g.id),
          ...b.templates.map((t) => t.id), ...b.hands.map((h) => h.id),
        ];
      }
      case "deck": return f.deck!.cards.map((c) => c.id);
      case "card": return f.card!.outcomes.map((o) => o.id);
      case "tagGroup": return nodesOf(p, "tag").filter((t) => t.parent === id).map((t) => t.id);
      default: return [];
    }
  }

  /** The lock sentence when somebody else holds this node's data for the view's extension: its box's shard, or
   *  the project's. */
  function heldOf(p: ProjectDto, id: string, kind: string): string | undefined {
    if (extension === undefined || !ctx.lockedBy) return undefined;
    const x = p.extensions?.find((e) => e.id === extension);
    const by = ctx.lockedBy(extensionVcKey(extensionOwner(p, kind, id), extension));
    return by?.length ? extensionLockMessage(x?.name ?? extension, by) : undefined;
  }

  function nodeOf(p: ProjectDto, id: string, children: boolean): ViewNode | null {
    const f = find(p, id);
    if (f === null) return null;
    const held = heldOf(p, id, f.kind);
    const node: ViewNode = {
      id, kind: f.kind, parent: f.parent, label: label(p, id, f), host: hostFields(p, id, f), ext: extOf(p, id),
      ...(held !== undefined ? { held } : {}),
    };
    if (!children) return node;
    return { ...node, children: childIds(p, id, f).map((c) => nodeOf(p, c, false)).filter((n): n is ViewNode => n !== null) };
  }

  /** A structural edit isn't laid over the project: written first, so the read sees it. */
  const settled = async (): Promise<void> => { if (ctx.saves.structuralPending) await ctx.saves.flush(); };

  return {
    host: "storylets",
    async project() {
      await settled();
      const p = project();
      if (!p) throw new Error("No project is open.");
      return nodeOf(p, projectId(p), true)!;
    },
    async node(id, children) {
      await settled();
      const p = project();
      return p ? nodeOf(p, id, children) : null;
    },
    selection: () => selectionOf(ctx),
    async write(extension, label, edits): Promise<ViewRefusal | void> {
      if (!project()) return { code: "failed", message: "No project is open." };
      // Whatever the author typed lands first, so the write builds on it and Undo takes them back in order.
      await ctx.saves.flush();
      const result: ExtensionWriteResult = await session.studio.setExtensionValues(extension, label, edits.map((e: ViewEdit) =>
        ("value" in e && e.value !== undefined ? { node: e.node, field: e.field, value: e.value } : { node: e.node, field: e.field })));
      if ("error" in result) return { code: result.code, message: result.error };
      ctx.applyResult(result);
      ctx.redraw();
    },
    select(id) {
      const p = project();
      const f = p && find(p, id);
      if (!p || !f) return false;
      const box = f.box?.id;
      const groupAt = (group: string, inBox: string | undefined): ReviewAt =>
        (inBox === undefined ? { kind: "map" } : { kind: "tagGroup", box: inBox, group });
      switch (f.kind) {
        case "project": ctx.focusProject(); return true;
        case "box": ctx.goTo({ kind: "box", box: box! }); return true;
        case "deck": ctx.goTo({ kind: "deck", box: box!, deck: id }); return true;
        case "card": ctx.goTo({ kind: "card", box: box!, deck: f.deck!.id, card: id }); ctx.selectCards([id]); return true;
        case "outcome": ctx.goTo({ kind: "outcome", box: box!, deck: f.deck!.id, card: f.card!.id, outcome: id }); return true;
        case "handTemplate": ctx.goTo({ kind: "template", box: box!, template: id }); return true;
        case "hand": ctx.goTo({ kind: "hand", box: box!, hand: id }); return true;
        case "tagGroup": ctx.goTo(groupAt(id, box)); return true;
        case "tag": ctx.goTo(groupAt(f.parent!, box)); return true;
        default: return false;
      }
    },
    writable(): ViewWritable {
      if (!project()) return { readOnly: true, why: "No project is open." };
      if (session.remote?.role === "author") {
        return { readOnly: true, why: "This project came from a server with an author's key, and an extension's data is the designer's to change." };
      }
      return { readOnly: false };
    },
    key(combo) {
      if (combo === "Mod+Z") ctx.undoRedo("undo");
      else if (combo === "Mod+Shift+Z" || combo === "Mod+Y") ctx.undoRedo("redo");
      else if (combo === "Mod+S") void ctx.saves.flush();
    },
  };
}

/** What `hostViews` hosts a view with: an adapter for its extension (so its nodes say when that extension's data
 *  is held), its manifest's reads, and the names a refusal says it by. Null, refusing it, when the open project
 *  doesn't take its extension. */
export function viewSetup(ctx: ViewHostContext, meta: ViewPortMeta): HostViewsSetup | null {
  const x = ctx.session.project?.extensions?.find((e) => e.id === meta.extension);
  if (!x) return null;
  const view = x.views?.find((v) => v.id === meta.view);
  return {
    adapter: viewAdapter(ctx, meta.extension), reads: x.reads ?? [],
    names: { extension: x.name, ...(view ? { view: view.name } : {}) },
  };
}

export interface ViewHosting {
  /** The project changed: these nodes, or anything. */
  changed(nodes: readonly string[] | "all"): void;
  /** The page drew: tell the views if the selection moved. */
  selectionMoved(): void;
  /** A lock poll came back. */
  writable(): void;
  /** How many views are open. */
  readonly open: number;
}

/**
 * Host every view main opens on this window, through the shell's `hostViews`: one handle per view window, a new
 * port replacing it, and the window's closing dropping it. The theme is told when the palette changes, by the
 * root's `data-theme` or the OS's light or dark.
 */
export function createViewHosting(ctx: ViewHostContext): ViewHosting {
  const views = hostViews((meta) => viewSetup(ctx, meta));
  let shownSelection = "";

  const theme = (): void => views.theme();
  new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
  if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);

  return {
    changed: (nodes) => views.changed(nodes),
    selectionMoved() {
      if (views.size === 0) return;
      const key = JSON.stringify(selectionOf(ctx));
      if (key === shownSelection) return;
      shownSelection = key;
      views.selection();
    },
    // A lock poll can move what's held: the views read their nodes again, and their writability.
    writable: () => { views.writable(); views.changed("all"); },
    get open() { return views.size; },
  };
}
