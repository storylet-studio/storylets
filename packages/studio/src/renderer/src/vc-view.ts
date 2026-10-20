// ---------------------------------------------------------------------------
// The version-control surface: the shell's, plus the one thing only this app
// knows - WHAT STAYS LIVE in a document somebody else holds.
//
// The grammar moved to @wildwinter/app-shell (2026-08-09). Reading a shard
// somebody else holds must remain fully possible, so navigation, disclosure and
// view switches keep working while the writing stops; these selectors are how
// that reads in OUR markup, which is why they did not travel.
// ---------------------------------------------------------------------------

import { el, foldVc, iconNode, lockNotice, lockControls as shellLockControls, paintVcBadges } from "@wildwinter/app-shell";
import type { IconName } from "@wildwinter/app-shell";
import type { Focus } from "./views.js";
import type { Inspected } from "./inspector.js";
import type { Session } from "./session.js";
import type { ShardVcDto, VcStatusDto } from "../../shared/api.js";

export { foldVc, vcBadgeFor, paintVcBadges, lockNotice } from "@wildwinter/app-shell";
export type { VcMap } from "@wildwinter/app-shell";

/** The shard key(s) whose version-control state an item shows (see
 *  ShardVcDto in shared/api.ts). Space-separated when an item spans shards:
 *  a box row stands for its box + tags + hands shards, so its badge folds all
 *  three. Rows carry them as `data-vc`; `paintVcBadges` walks that attribute,
 *  so a poll can re-badge without re-rendering (and without disturbing a
 *  document mid-edit). */
export const vcKeys = {
  project: "project",
  /** The Story row: the project shard and the project's own extension shards. */
  projectRow: "project ext:@project",
  /** A box row: everything the box itself owns, its extension shards included
   *  (its decks badge separately). */
  box: (boxId: string): string => `box:${boxId} tags:${boxId} hands:${boxId} ext:${boxId}`,
  boxShard: (boxId: string): string => `box:${boxId}`,
  tags: (boxId: string): string => `tags:${boxId}`,
  hands: (boxId: string): string => `hands:${boxId}`,
  deck: (deckId: string): string => `deck:${deckId}`,
};

// Containers list their INSIDES too, because a card face's condition preview is
// drawn from buttons (pills): disabling those would swallow the click that opens
// the card.
// A map of records' Edit (extension-rows.ts) only opens the Fields window, which is then read-only.
const LIVE_LEAVES = [".crumb-back", ".doc-tab", ".centre-step", ".viewbtn", ".doc-collapsed", ".camerabtn", ".ext-edit"];
const LIVE_CONTAINERS = [
  ".outcome-row", ".scard:not(.ghost)", ".listrow:not(.ghost)", ".deck-card:not(.ghost)",
  ".cardwhen", ".ct-when",   // read-only condition previews (pills, not controls)
];
export const VC_STAYS_LIVE = [
  ...LIVE_LEAVES, ...LIVE_CONTAINERS, ...LIVE_CONTAINERS.map((s) => `${s} *`),
].join(", ");

/** Turn a frame's editing controls off, or back on. This app's live-selector
 *  list, the shell's mechanism. */
export function lockControls(host: HTMLElement, off: boolean): void {
  shellLockControls(host, off, VC_STAYS_LIVE);
}

// --- extension shards ----------------------------------------------------------
//
// Each extension's data in a box is a shard of its own (Patterpad's model, its
// tier 1): somebody else holding one locks THAT extension's rows wherever they
// are drawn, with a sentence naming the extension and the holder, and leaves
// the box and its other extensions alone. The rows say which shard they write
// as `data-ext-vc` (extension-rows.ts), so a poll locks and unlocks them in
// place, as it does the documents.

/** The sentence a locked extension's rows open with: "Probe's data here is
 *  locked by bob." Patterpad's words (patterpad-surface `extensionLockMessage`). */
export function extensionLockMessage(name: string, by: readonly string[] | undefined): string {
  const who = by?.filter((b) => b).join(", ");
  return `${name}'s data here is locked by ${who || "someone else"}.`;
}

/** The extension states by key (`ext:<owner>:<id>`), from the snapshot. */
export function extensionStates(extensions: VcStatusDto["extensions"]): Map<string, Omit<ShardVcDto, "key">> {
  const out = new Map<string, Omit<ShardVcDto, "key">>();
  for (const [owner, byId] of Object.entries(extensions ?? {})) {
    for (const [id, st] of Object.entries(byId)) out.set(`ext:${owner}:${id}`, st);
  }
  return out;
}

/** What a row badges for each owner's extension shards together, as `ext:<owner>`
 *  (a box row and the Story row fold it beside their own shards). Untracked is
 *  left out: a box whose first extension value was written today is an edited
 *  box, not a new one, which is what `primary` means for the shards in main. */
export function extensionRowStates(extensions: VcStatusDto["extensions"]): ShardVcDto[] {
  return Object.entries(extensions ?? {}).map(([owner, byId]) => {
    const keyed = new Map(Object.entries(byId).map(([id, { untracked: _new, ...st }]) => [id, { key: id, ...st }]));
    return { ...foldVc(keyed, [...keyed.keys()].join(" "))!, key: `ext:${owner}` };
  });
}

/**
 * Lock every extension group under `root` whose shard somebody else holds, with
 * the sentence at its head, and hand back the rest. A group inside a region
 * locked for its own reasons (the whole document held, a role's read-only) is
 * left for that region to hand back. Returns the holders of what it locked.
 */
export function applyExtensionLocks(root: ParentNode, states: ReadonlyMap<string, Omit<ShardVcDto, "key">>): string[] {
  const holders: string[] = [];
  root.querySelectorAll<HTMLElement>("[data-ext-vc]").forEach((group) => {
    const by = states.get(group.dataset["extVc"]!)?.lockedBy;
    const said = group.querySelector<HTMLElement>(":scope > .ext-lock");
    if (by?.length) {
      holders.push(...by);
      lockControls(group, true);
      // In place when it already says so: a poll that changes nothing moves nothing.
      const text = extensionLockMessage(group.dataset["extName"] ?? "This extension", by);
      if (said?.textContent === text) return;
      said?.remove();
      const line = el("p", { className: "ext-lock" },
        el("span", { className: "vc-lock-glyph" }, iconNode("locked")), el("span", { text }));
      // Under a folded section's caption (extension-rows.ts `extensionSection`), where opening the fold, which
      // redraws only the rows, leaves it; else at the top.
      const caption = group.querySelector(":scope > .shell-fold-cap");
      if (caption) caption.after(line); else group.prepend(line);
    } else {
      said?.remove();
      if (!group.parentElement?.closest(".vc-readonly")) lockControls(group, false);
    }
  });
  return holders;
}

// --- the role's own read-only, which is not version control at all ------------
// The same mechanism and the same look, for a different reason: under an
// author's key the shape shards are the designer's, so the editor says so
// BEFORE the edit rather than refusing it after (design/engine-server.md 9.1).

/** The line a document opens with when the shape is not this key's to change:
 *  the far end's own sentence, said before the edit instead of after it. */
export const shapeNotice = (): HTMLElement => el("div", { className: "vc-lock" },
  el("span", { className: "vc-lock-glyph" }, iconNode("readOnly")),
  el("span", { text: "Read-only. You can pull as designer to change the shape." }));

// THE ARRANGING RULE MOVED, and left nothing behind here (2026-09-06,
// design/engine-server.md 9.1 point 5).
//
// `arrangingLocked` and `canvasLocked` used to grey a deck's node canvas under an
// author's key, because where a card sat landed in the same shard as where a
// hand stood, and a hand's position is the shape: it ships in the bundle and is
// where a venue's kiosk stands. One file, so the stricter reading governed both.
//
// The map now has a shard of its own. What is left of the view shard is the
// author's working drawing, and greying it would refuse them something no
// designer cares about. The map is shape: the box pages that show it are read
// as the designer's by `docIsShape` below, and every map write, from the
// project map's own page too, is refused by `refuseWrite` in main/remote.ts
// with the same sentence. So both halves of the old rule are still enforced, by
// rules that were already there.

// --- the open document's state ------------------------------------------------
//
// Writes already go through @wildwinter/simple-vc-lib, so a locked shard fails
// its save cleanly. This is the surfacing half (Patterpad's #145, on our
// shards): a per-shard snapshot from main (throttled there - a remote read is a
// server hit) drives a quiet badge on every item that names a shard, a topbar
// chip for the open document, and, when somebody ELSE holds the shard, a
// read-only document rather than a doomed edit.
//
// The snapshot arrives on a poll, so it must NEVER re-render: it paints badges
// onto the existing rows (via their data-vc keys) and toggles the open
// document's controls, leaving a mid-edit document alone.

/** Which shard the OPEN document's edits land in (see vcKeys). Masters (the
 *  decks list, the project's boxes) edit nothing themselves: their items badge. */
export function docVcKeys(focus: Focus | undefined, inspected: Inspected | undefined): string | undefined {
  if (inspected?.kind === "card") return vcKeys.deck(inspected.deck);
  if (inspected?.kind === "template" || inspected?.kind === "hand") return vcKeys.hands(inspected.box);
  if (inspected?.kind === "tagGroup") return vcKeys.tags(inspected.box);
  if (focus?.kind === "deck") return vcKeys.deck(focus.deck);
  if (focus?.kind === "box") return vcKeys.boxShard(focus.box);
  if (focus?.kind === "hands") return vcKeys.hands(focus.box);
  if (focus?.kind === "project") return vcKeys.project;
  return undefined;
}

/**
 * Does the OPEN document write one of the shape shards?
 *
 * The same discriminants `docVcKeys` uses, asked of the shard rather than of
 * the lock: cards and their decks are the writer's, and everything else on the
 * list - a box, its tags, its hands, its templates, the project's own page - is
 * the shape, which under an author's key is the designer's to change (9.1).
 */
export function docIsShape(focus: Focus | undefined, inspected: Inspected | undefined): boolean {
  if (inspected?.kind === "card" || inspected?.kind === "deck") return false;
  if (inspected?.kind === "template" || inspected?.kind === "hand" || inspected?.kind === "tagGroup") return true;
  if (focus?.kind === "deck") return false;
  return focus?.kind === "box" || focus?.kind === "hands" || focus?.kind === "project";
}

export interface VcViewContext {
  session: Session;
  /** Where the author is standing (navigation.ts). */
  place: () => { focus: Focus | undefined; inspected: Inspected | undefined };
  /** The centre pane, which holds the open document. */
  centre: () => HTMLElement;
  /** Told after the document's controls are shut or opened (the address chips
   *  repaint their click hint, inspector.ts `refreshGameIds`). */
  afterLock: (host: HTMLElement) => void;
}

export type VcView = ReturnType<typeof createVcView>;

export function createVcView(ctx: VcViewContext) {
  const { session } = ctx;
  let shards = new Map<string, ShardVcDto>();
  /** The extension shards' states, by `ext:<owner>:<id>`. */
  let extensions = new Map<string, Omit<ShardVcDto, "key">>();
  let system = "";
  let docLocked = false;
  /** Who holds what the open page writes (its own shard, or a frame's). */
  let docHolders: string[] = [];
  // The open document's version-control state, when it has one to report (quiet
  // chrome: hidden entirely on the clean, writable, up-to-date common case).
  const chip = el("span", { className: "vcstat" });
  chip.hidden = true;

  const vcOf = (keys: string | undefined): ShardVcDto | undefined => foldVc(shards, keys);
  const extensionHeld = (): boolean => [...extensions.values()].some((s) => (s.lockedBy?.length ?? 0) > 0);
  const openKeys = (): string | undefined => { const p = ctx.place(); return docVcKeys(p.focus, p.inspected); };

  /** The shape is read-only under an author's key. Never under a designer's,
   *  and never for a project that did not come from a server. */
  const shapeReadOnly = (): boolean => {
    const p = ctx.place();
    return session.remote?.role === "author" && docIsShape(p.focus, p.inspected);
  };

  /** Apply the open document's version-control state: read-only + a notice
   *  naming the holder when somebody else has it. */
  function applyDoc(): void {
    const host = ctx.centre();
    const holders = new Set(vcOf(openKeys())?.lockedBy ?? []);
    // The role's rule rides the same mechanism as a held shard, because it is
    // the same thing to the author: this page does not type, and here is why.
    const shape = shapeReadOnly();
    lockControls(host, holders.size > 0 || shape);
    // A frame of the page that writes a DIFFERENT shard (the box page's Hand
    // templates and Tags tabs) takes its state from that shard instead.
    host.querySelectorAll<HTMLElement>("[data-vc-scope]").forEach((frame) => {
      const st = vcOf(frame.dataset["vcScope"]);
      if (st?.lockedBy?.length) { for (const who of st.lockedBy) holders.add(who); lockControls(frame, true); }
      else if (holders.size === 0) lockControls(frame, false);
    });
    // The address chips were painted before any of this ran, so the ones that
    // have just been shut still offer the click that opens their editor. Told
    // here, which is the only place that knows they are shut.
    // Last, so neither the document's hand-back nor a frame's undoes them.
    applyExtensionLocks(host, extensions);
    ctx.afterLock(host);
    docHolders = [...holders];
    docLocked = docHolders.length > 0;
    host.querySelector(":scope > .vc-lock")?.remove();
    if (docLocked) host.prepend(lockNotice(docHolders));
    else if (shape) host.prepend(shapeNotice());
  }

  /** The topbar chip: the open page's state, in the same words as the badge and
   *  the notice (so a locked SETUP TAB of an otherwise-writable box says so too). */
  function renderChip(): void {
    const s = vcOf(openKeys());
    // From the vocabulary, all three: the same words the badge and the notice
    // draw, so the chip cannot drift from them.
    const state: { name: IconName; text: string } | undefined = docHolders.length ? { name: "locked", text: `Locked by ${docHolders.join(", ")}` }
      : s?.outOfDate ? { name: "down", text: "Out of date" }
      : s && !s.writable ? { name: "readOnly", text: "Read-only" } : undefined;
    chip.replaceChildren(...(state ? [iconNode(state.name, 12), state.text] : []));
    chip.hidden = state === undefined;
    const tip = state ? `${state.text} (${system})` : "";
    if (tip === "") { delete chip.dataset["tip"]; chip.removeAttribute("aria-label"); }
    else { chip.dataset["tip"] = tip; chip.setAttribute("aria-label", tip); }
    chip.classList.toggle("locked", docHolders.length > 0);
  }

  /** Repaint everything the snapshot drives. Cheap + render-free, so it is safe
   *  to call from a poll or after any render. */
  function apply(): void {
    if (!session.project) return;
    paintVcBadges(document, shards);
    applyDoc();
    // Anything else drawing an extension's rows: Project Settings.
    applyExtensionLocks(document, extensions);
    renderChip();
  }

  return {
    /** The topbar chip. */
    chip,
    apply,
    applyDoc,
    /** Badge a freshly drawn subtree (the navigator) from the snapshot in hand. */
    paint(root: ParentNode): void { paintVcBadges(root, shards); },
    /**
     * A locked document redraws itself in place on the controls that stay live
     * (a tab switch, an outcome opening), which would hand back editable
     * fields: after a click on one, put the guard back once the redraw has
     * settled.
     */
    guardAfterClick(): void {
      // Any held extension shard counts, drawn yet or not: the click may be the
      // tab switch that draws its rows (a card's Fields tab redraws in place).
      if (docLocked || extensionHeld() || shapeReadOnly()) queueMicrotask(() => applyDoc());
    },
    /** Pull a fresh snapshot (one throttled, coalesced query in main) and repaint. */
    async refresh(): Promise<void> {
      if (!session.project) return;
      const dto = await session.studio.vcStatus();
      if (!dto || !session.project) return;   // the project may have closed while we awaited
      system = dto.system;
      shards = new Map([...dto.shards, ...extensionRowStates(dto.extensions)].map((s) => [s.key, s]));
      extensions = extensionStates(dto.extensions);
      apply();
    },
    /** Lock the extension groups a surface outside the centre has just drawn
     *  (Project Settings re-mounts its sections on every open). */
    applyExtensionLocks(root: ParentNode): void { applyExtensionLocks(root, extensions); },
    /** Who holds an extension shard (`ext:<owner>:<id>`), when somebody else does: the Fields window's lock. */
    lockedBy(key: string): readonly string[] | undefined { return extensions.get(key)?.lockedBy; },
    /** No project, no version-control state. */
    clear(): void {
      shards = new Map();
      extensions = new Map();
      docLocked = false;
      docHolders = [];
      chip.hidden = true;
    },
  };
}
