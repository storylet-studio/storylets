// ---------------------------------------------------------------------------
// The board itself: a cell per hand with the cards dealt to it, and the open
// card's play panel, floated where the eye already is (over the map, or over
// the list). A card from a box Patter performs plays its scene in that panel.
// ---------------------------------------------------------------------------

import { el, iconNode } from "@wildwinter/app-shell";
import type { Performance } from "@storylet-studio/with-patter";
import { colourIndex } from "../../shell/colour.js";
import { focusKey } from "../tool-window/focus.js";
import { playChoices } from "./play-choices.js";
import type { MarksSource } from "./run-marks.js";
import type { Board } from "./board-state.js";
import type { DealtView, Table } from "./model.js";
import { playOpen, playPending, revealCard } from "./session.js";
import { shownHands } from "./box-nav.js";

/** A tag, as a pill with its colour dot. */
const chip = (text: string): HTMLElement => {
  const dot = el("i");
  dot.style.background = `var(--char-${colourIndex(text)})`;
  return el("span", { className: "pill" }, dot, text);
};

/** A hand on the board, for a cell: the bundle's own, or (Live mode) a game's
 *  hand the bundle does not know, named by its gameId. */
export type CellHand = { id?: string; boxId?: string; gameId: string; title?: string; tags: Record<string, string> };

export function handCell(b: Board, hand: CellHand, cards: DealtView[], runs: MarksSource): HTMLElement {
  const s = b.state;
  // The running position (run-marks.ts): the hand the last play came from is
  // live, hands played from earlier keep a muted mark. Quiet by design - this
  // reports where the run is, it does not ask for anything. From the session
  // being shown: the local one's marks, and none on a game's run in Live mode.
  const here = runs.now() === hand.gameId;
  const been = runs.visitedHand(hand.gameId);
  const cell = el("div", { className: `hcell${here ? " here" : been ? " been" : ""}${s.pulsed.has(hand.gameId) ? " rippled" : ""}${s.selectedHand === hand.gameId ? " sel" : ""}` },
    el("div", { className: "hhead" },
      here || been
        ? el("span", {
            className: `runmark${here ? " now" : ""}`,
            tip: here ? "The last card was played from here." : "Played from here earlier this run.",
          })
        : null,
      el("span", { className: "hname", text: hand.title ?? hand.gameId, tip: "A hand on the board: where cards are dealt. Click to select it, and Why not? explains what did not come up here; double-click to open it in the editor." }),
      el("span", { className: "htags" }, ...Object.values(hand.tags).map(chip))));
  // Double-click the header reveals the hand in the editor, on what can come up
  // there: the gesture a pin and a card already use here. A hand the bundle does
  // not know (Live mode, a game's own) has no page to open.
  // A click selects the hand (never toggles it off, so the two clicks of a
  // double-click both select, and the reveal still lands). The keyboard reaches
  // it too: a button in all but tag name, Enter or Space selects.
  const head = focusKey(cell.querySelector<HTMLElement>(".hhead")!, `hand:${hand.gameId}`);
  const select = (): void => { if (s.selectedHand !== hand.gameId) { s.selectedHand = hand.gameId; b.render(); } };
  head.tabIndex = 0;
  head.setAttribute("role", "button");
  head.setAttribute("aria-pressed", String(s.selectedHand === hand.gameId));
  head.addEventListener("click", select);
  head.addEventListener("keydown", (e) => {
    if (e.target === head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(); }
  });
  const { id, boxId } = hand;
  if (id !== undefined && boxId !== undefined) {
    head.addEventListener("dblclick", () => { void b.studio.searchReveal({ kind: "hand", box: boxId, hand: id }); });
  }
  const row = el("div", { className: "hcards" });
  for (const c of cards) {
    const isOpen = s.open?.card === c.id && s.open.hand === hand.gameId;
    // A card played this run, come back round: the question an author asks of a
    // board is "have I seen this one already", and this is the answer.
    const seen = runs.visitedCard(c.id);
    const face = el("button", { className: `hcard${isOpen ? " on" : ""}${seen ? " seen" : ""}`, onClick: () => {
      // Live mode is observe-only: a card is not played here. Clicking it opens
      // it in the editor instead (the Board marks, it does not drive).
      if (s.liveMode) {
        revealCard(b, c.id);
        if (s.selectedHand !== hand.gameId) { s.selectedHand = hand.gameId; b.render(); }
        return;
      }
      // Opening a card selects its hand, so Why not? is about where it came from.
      s.selectedHand = hand.gameId;
      s.open = isOpen ? undefined : { card: c.id, hand: hand.gameId };
      s.pending = undefined;
      b.render();
    } },
      seen ? el("span", { className: "runmark", tip: "Played earlier this run." }) : null,
      el("h4", { text: c.title ?? c.gameId }));
    row.append(focusKey(face, `card:${hand.gameId}:${c.id}`));
  }
  if (cards.length === 0) row.append(el("span", { className: "empty", text: "Nothing here right now." }));
  cell.append(row);
  return cell;
}

/** The board in List view: every hand that matches the filters, with its
 *  cards. */
export function listCells(b: Board): HTMLElement {
  const s = b.state;
  const table = s.table!;
  const dealtBy = new Map(s.board.map((h) => [h.hand, h.cards]));
  const cells = el("div", { className: "board" });
  const { shown } = shownHands(s);
  const boxes = table.boxes();
  if (s.boxSel === undefined && boxes.length > 1) {
    // A multi-box project gets box sections (design/board-ripple.md piece 1):
    // you cannot perceive "another box reacted" if the boxes are not visible
    // as things. The header's quiet badge counts the LAST refresh's changes.
    for (const box of boxes) {
      const ours = shown.filter((h) => h.box === box.gameId);
      if (ours.length === 0) continue;
      const changed = ours.filter((h) => s.pulsed.has(h.gameId)).length;
      cells.append(el("div", { className: "boardbox-head" },
        el("span", { className: "bbname", text: box.title ?? box.gameId }),
        changed > 0 ? el("span", { className: "bbadge", text: `${changed} changed` }) : null));
      for (const h of ours) cells.append(handCell(b, h, dealtBy.get(h.gameId) ?? [], s.marks));
    }
  } else {
    for (const h of shown) cells.append(handCell(b, h, dealtBy.get(h.gameId) ?? [], s.marks));
  }
  if (shown.length === 0) {
    cells.append(el("span", { className: "empty", text: table.hands().length === 0 ? "No hands on this board yet. Seat one in the editor." : "No hands match these filters." }));
  }
  return cells;
}

/**
 * What is HERE, floated bottom-centre over the stage: the open card's play
 * panel in either view, or in Map view (`withHand`) the selected hand's cards
 * when no card is open.
 *
 * Over the map (the author's call, 2026-08-25), picking a site pops its cards
 * up where the eye already is, and an open card's play panel takes the same
 * spot. The side column keeps only what has HAPPENED (the journal); a panel
 * docked there made the reader's eye commute between the pin they clicked and
 * the far edge of the window.
 *
 * Over the list, the panel used to render at the bottom of the scrolled column,
 * where a first-timer read "clicking a card does nothing" and a blind second
 * click could hit Back (the antagonist review's worst stretch,
 * design/board-legibility.md piece 1). One grammar in both views: the stage
 * floats where the eye already is.
 */
export function stageFloat(b: Board, withHand: boolean): HTMLElement | null {
  const s = b.state;
  const panel = playPanel(b);
  if (panel) return el("div", { className: "stagefloat" }, panel);
  if (!withHand) return null;
  const hand = s.selectedHand === undefined ? undefined : s.table?.hands().find((h) => h.gameId === s.selectedHand);
  if (!hand) return null;
  return el("div", { className: "stagefloat" },
    handCell(b, hand, s.board.find((x) => x.hand === hand.gameId)?.cards ?? [], s.marks));
}

/** The open card: read it, choose an outcome, read what happens, Continue. */
function playPanel(b: Board): HTMLElement | null {
  const s = b.state;
  if (s.liveMode) return null;   // observe-only: nothing is played in Live mode
  const table = s.table;
  const open = s.open;
  if (!table || !open) return null;
  const held = s.board.find((h) => h.hand === open.hand)?.cards.find((c) => c.id === open.card);
  if (!held) return null;
  const outcomes = table.outcomes(held.id, open.hand);
  const panel = el("section", { className: "playpanel" },
    el("div", { className: "pp-head" },
      el("h3", { text: held.title ?? held.gameId }),
      el("span", { className: "pp-hand", text: `in ${open.hand}` }),
      el("button", { className: "btn ghost icon pp-close", tip: "Put it back", onClick: () => { s.open = undefined; s.pending = undefined; b.render(); } }, iconNode("close"))),
    held.purpose ? el("p", { className: "beat", text: held.purpose }) : null,
  );
  // A card from a box Patter performs plays its scene instead of offering its outcomes: the
  // scene decides. When it can't (no scene, or it ends without saying), the outcomes come back.
  const box = table.boxOf(held.id);
  if (table.performer && box !== undefined && table.performer.performs(box)) {
    if (s.performing?.card !== held.id) s.performing = table.performer.start({ id: held.id, gameId: held.gameId }, box, outcomes);
    const performing = s.performing!;
    panel.append(scenePane(b, performing, outcomes));
    if (!performing.problem) return panel;
  }
  const chosen = s.pending !== undefined ? outcomes.find((o) => o.gameId === s.pending) : undefined;
  if (chosen) {
    // Step two: what happens, then commit.
    panel.append(
      el("div", { className: "pp-outcome" },
        el("span", { className: "caption", text: "Outcome" }),
        el("p", { className: "pp-otitle", text: chosen.title ?? chosen.gameId }),
        chosen.purpose ? el("p", { className: "beat", text: chosen.purpose }) : null),
      el("div", { className: "pp-actions" },
        el("button", { className: "btn", text: "Back", onClick: () => { s.pending = undefined; b.render(); } }),
        el("button", { className: "btn primary", text: "Continue", onClick: () => playPending(b) })));
  } else {
    // A card with no outcomes gets one Done button that plays it with none.
    panel.append(playChoices(outcomes,
      (gameId) => { s.pending = gameId; s.focusPending = true; b.render(); },
      () => playOpen(b, "")));
  }
  return panel;
}

/** The Patter scene in the open card's panel: what has been said, then the choice, or the outcome
 *  the scene reached with Continue, or why it could not say. */
function scenePane(b: Board, p: Performance, outcomes: ReturnType<Table["outcomes"]>): HTMLElement {
  const s = b.state;
  const pane = el("div", { className: "pp-scene" },
    el("span", { className: "caption", text: "Patter scene" }),
    ...p.transcript.map((x) => x.kind === "chose"
      ? el("p", { className: "pp-chose", text: x.text })
      : el("p", { className: "pp-line" }, x.kind === "line" && x.who ? el("span", { className: "pp-who", text: x.who }) : null, x.text)));
  if (p.options) {
    pane.append(el("div", { className: "pp-options" }, ...p.options.map((o) => {
      const button = el("button", {
        className: "btn pp-option", text: o.text,
        tip: o.enabled ? (o.outcome ? `Reaches ${o.outcome}` : "") : "Not open: Patter's condition, or the outcome it leads to, is shut",
        onClick: () => { s.performing = s.table!.performer!.choose(p, o.id, outcomes); b.render(); },
      }) as HTMLButtonElement;
      // Shown greyed, not hidden: a player who can see the door they can't open is told something.
      button.disabled = !o.enabled;
      return button;
    })));
  } else if (p.outcome !== undefined) {
    const reached = outcomes.find((o) => o.gameId === p.outcome);
    pane.append(
      el("div", { className: "pp-outcome" },
        el("span", { className: "caption", text: "Outcome" }),
        // "" is a card with no outcomes, played with none.
        el("p", { className: "pp-otitle", text: p.outcome === "" ? "None: this card has no outcomes" : reached?.title ?? p.outcome }),
        reached?.purpose ? el("p", { className: "beat", text: reached.purpose }) : null),
      el("div", { className: "pp-actions" },
        el("button", { className: "btn primary", text: "Continue", onClick: () => playOpen(b, p.outcome!) })));
  } else if (p.problem) {
    pane.append(el("p", { className: "pp-problem", text: `${p.problem} Choose the outcome yourself:` }));
  }
  return pane;
}
