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
import type { ShardVcDto } from "../../shared/api.js";

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
  /** A box row: everything the box itself owns (its decks badge separately). */
  box: (boxId: string): string => `box:${boxId} tags:${boxId} hands:${boxId}`,
  boxShard: (boxId: string): string => `box:${boxId}`,
  tags: (boxId: string): string => `tags:${boxId}`,
  hands: (boxId: string): string => `hands:${boxId}`,
  deck: (deckId: string): string => `deck:${deckId}`,
};

// Containers list their INSIDES too, because a card face's condition preview is
// drawn from buttons (pills): disabling those would swallow the click that opens
// the card.
const LIVE_LEAVES = [".crumb-back", ".doc-tab", ".centre-step", ".viewbtn", ".doc-collapsed", ".camerabtn"];
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
  let system = "";
  let docLocked = false;
  /** Who holds what the open page writes (its own shard, or a frame's). */
  let docHolders: string[] = [];
  // The open document's version-control state, when it has one to report (quiet
  // chrome: hidden entirely on the clean, writable, up-to-date common case).
  const chip = el("span", { className: "vcstat" });
  chip.hidden = true;

  const vcOf = (keys: string | undefined): ShardVcDto | undefined => foldVc(shards, keys);
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
      if (docLocked || shapeReadOnly()) queueMicrotask(() => applyDoc());
    },
    /** Pull a fresh snapshot (one throttled, coalesced query in main) and repaint. */
    async refresh(): Promise<void> {
      if (!session.project) return;
      const dto = await session.studio.vcStatus();
      if (!dto || !session.project) return;   // the project may have closed while we awaited
      system = dto.system;
      shards = new Map(dto.shards.map((s) => [s.key, s]));
      apply();
    },
    /** No project, no version-control state. */
    clear(): void {
      shards = new Map();
      docLocked = false;
      docHolders = [];
      chip.hidden = true;
    },
  };
}
