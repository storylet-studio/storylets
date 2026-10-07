// ---------------------------------------------------------------------------
// The Board's head, mounted once, and its layered Escape.
//
// TWO BARS, because there were two kinds of thing in one (A16). The window's
// chrome - what this window IS and how it sits beside the editor - is the
// shell's swin-head, the same as Find, Links and Coverage. The session's
// controls are about the game being played and get a strip of their own
// (session-strip.ts), which render() rebuilds under it. The head is built ONCE,
// as Find's is: a render never takes the keyboard off the pin, the follow
// toggle or the close button.
// ---------------------------------------------------------------------------

import { el, followButton, pinButton, toolWindowHead } from "@wildwinter/app-shell";
import { escapeSnapshot } from "../tool-window/escape.js";
import type { Board, BoardState } from "./board-state.js";
import { mapZoneGroup } from "./map-stage.js";
import { closeBoard } from "./session.js";

/** What Escape found as it went down: the selected hand, and the map's
 *  selected zone as the tag group it filters. */
export interface EscapedFrom {
  hand: string | undefined;
  zoneGroup: string | undefined;
}

/** What one Escape takes, innermost first. */
export type EscapeStep =
  | { take: "dialog" | "pending" | "open" | "snapshots" | "hand" | "close" }
  | { take: "zone"; group: string };

/**
 * Escape is LAYERED, the way it is everywhere else in this app: innermost
 * first, the pending outcome, then the open card, then the snapshot panel,
 * then the selected hand and the map's selection (ruling Q), and the window
 * only when nothing smaller is left. A play session is a thing an author is in
 * the middle of, so the window is the last thing Escape should take. While a
 * confirm is up, the dialog answers its own Escape.
 *
 * `at` is what the key went down on (escape.ts): the map hears the same key and
 * drops its selection, and the layers below must answer from before.
 */
export function escapeStep(
  s: Pick<BoardState, "asking" | "pending" | "open" | "snapPanel" | "selectedHand">,
  at: EscapedFrom | undefined,
): EscapeStep {
  if (s.asking) return { take: "dialog" };
  if (s.pending !== undefined) return { take: "pending" };
  if (s.open !== undefined) return { take: "open" };
  if (s.snapPanel !== undefined) return { take: "snapshots" };
  if (at?.hand !== undefined || s.selectedHand !== undefined) return { take: "hand" };
  if (at?.zoneGroup !== undefined) return { take: "zone", group: at.zoneGroup };
  return { take: "close" };
}

export interface BoardHead {
  el: HTMLElement;
  /** The project's name, beside the title. */
  nameEl: HTMLElement;
  /** Always-on-top over the editor (Patterpad's Play pin); remembered. */
  pin: ReturnType<typeof pinButton>;
  /** Follow in the editor (BoardState.follow); remembered. */
  followToggle: ReturnType<typeof followButton>;
}

export function boardHead(b: Board): BoardHead {
  const s = b.state;
  const nameEl = el("span", { className: "tname" });
  const pin = pinButton({ pinned: true, onToggle: (on) => { void b.studio.setBoardPinned(on); } });
  // The shell's toggle, worded once for the family ("card" is what this editor
  // opens as the run goes; Patterpad's is "line").
  const followToggle = followButton({ on: false, what: "card",
    onToggle: (on) => { s.follow = on; void b.studio.setBoardFollow(on); } });
  const escapedFrom = escapeSnapshot<EscapedFrom>(() => ({ hand: s.selectedHand, zoneGroup: mapZoneGroup(s) }));
  // A close the Board did not start (Ctrl+W, Alt+F4, the window menu) comes
  // back here from main, so it asks exactly as Escape and the close button do.
  b.studio.onBoardAskClose(() => closeBoard(b));
  const head = toolWindowHead({
    title: "The Board",
    pin,
    onClose: () => closeBoard(b),
    onEscape: () => {
      const step = escapeStep(s, escapedFrom());
      switch (step.take) {
        case "dialog": return true;
        case "pending": s.pending = undefined; break;
        case "open": s.open = undefined; break;
        case "snapshots": s.snapPanel = undefined; break;
        case "hand": s.selectedHand = undefined; break;
        case "zone": delete s.filters[step.group]; break;
        case "close":
          // The window's own close, which asks when there is a session to lose.
          // After the key has been handled: a modal opened while Escape is still
          // going down is closed again by that same Escape's default action (the
          // dialog's own close watcher), so the question flashed and answered
          // itself "Cancel".
          setTimeout(() => closeBoard(b), 0);
          return true;
      }
      b.render();
      return true;
    },
    lead: [nameEl],
    trail: [followToggle.el],
  });
  return { el: head, nameEl, pin, followToggle };
}
