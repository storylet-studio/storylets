// ---------------------------------------------------------------------------
// The Board window: the game, played by hand. The author sits in the
// player's chair: explore the dealt hands on the board (filtered by tag),
// pick a card, read its outcomes, play one and watch the world change; time
// passes on the turn dial. The journal keeps the story of the session
// (deals, plays, property changes, turns); snapshots save and restore the
// whole game. The diagnostics have rail tabs of their own: the raw state, and
// why the selected hand's near misses did not come up. You never play a card from inside
// the deck (schema 3.1): plays come from hands on the board.
//
// This file is the window's entry: it makes the one Board state
// (board-state.ts), mounts the head, wires main's messages, and composes the
// parts into the page on every render. The parts are their own modules:
//   session.ts        building the session, and everything done to it
//   session-strip.ts  the strip under the head, the snapshots, the stale bar
//   box-nav.ts        the box navigator and the filters
//   hand-cells.ts     the hands, their cards, and the open card's play panel
//   turn-dial.ts      the clocks
//   map-stage.ts      the Map view
//   rail.ts           the rail: the journal, and the tabs for
//   state-panel.ts      the State tab, and
//   why-panel.ts        the Why not? tab
//   live-mode.ts      watching a connected game (Live Link)
//   patterpad.ts      Patterpad's Live Link, for Patter scenes
//   head.ts           the head, and the layered Escape
// ---------------------------------------------------------------------------

import "../src/theme.css";
import "../tool-window/base.css";
import "./table.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/toast.css";
import { el } from "@wildwinter/app-shell";
import { bootToolWindow } from "../tool-window/boot.js";
import { keepFocus } from "../tool-window/focus.js";
import { createBoardState, effectiveView } from "./board-state.js";
import type { Board } from "./board-state.js";
import { build, checkStale, projectChanged } from "./session.js";
import { sessionStrip, snapshotPanel, staleNote } from "./session-strip.js";
import { boxNav, filterBar } from "./box-nav.js";
import { listCells, stageFloat } from "./hand-cells.js";
import { turnDial } from "./turn-dial.js";
import { mapPicker, showMap, viewSwitch } from "./map-stage.js";
import { rail, railTabShown } from "./rail.js";
import { liveBanner, liveCells, liveFrame, liveStatusChanged, liveTurnDial } from "./live-mode.js";
import { boardHead } from "./head.js";

const root = document.getElementById("table")!;
const board: Board = { studio: window.studio, state: createBoardState(), render };
const s = board.state;

board.studio.onProjectChanged(() => projectChanged(board));
board.studio.onLiveLinkStatus((status) => liveStatusChanged(board, status));
board.studio.onLiveLinkFrame((frame) => liveFrame(board, frame));

const head = boardHead(board);

/** Everything under the head, rebuilt by render(). `display: contents`, so the
 *  strip and the body lay out in the window's column as they always did. */
const content = el("div", { className: "tcontent" });

/** Draw the window. The head is mounted once, above everything this rebuilds,
 *  and the keyboard keeps its place across the rebuild (keepFocus). */
function render(): void {
  keepFocus(content, paint);
}

function paint(): void {
  if (s.noProject) {
    content.replaceChildren(el("p", { className: "empty tw-empty", text: "Open a project to play it on the Board." }));
    return;
  }
  if (s.loadError && !s.table) {
    content.replaceChildren(el("div", { className: "loaderr" },
      el("h2", { text: "The Board can't run yet" }),
      el("pre", { text: s.loadError }),
      el("button", { className: "btn primary", text: "Try again", onClick: () => void build(board) }),
    ));
    return;
  }
  if (!s.table) { content.replaceChildren(el("div", { className: "loaderr" }, el("p", { text: "Compiling…" }))); return; }

  const scroll = keepScroll();
  head.nameEl.textContent = s.name;
  const runErr = (): HTMLElement | null => (s.runError ? el("div", { className: "runerr", text: s.runError }) : null);
  content.replaceChildren(
    sessionStrip(board),
    s.liveMode
      // Live mode: the game's run, always as a list (its board, its journal,
      // its Why not?, in the rail). The List/Map switch, the box navigator and
      // the local controls step aside; the turn dial is read-only.
      ? el("div", { className: "tbody nonav" },
          el("main", { className: "tmain" },
            liveBanner(board),
            el("div", { className: "boardbar" }, liveTurnDial(board), filterBar(board)),
            liveCells(board)),
          rail(board),
        )
      : effectiveView(s) === "map"
      ? el("div", { className: "tbody mapbody" },
          boxNav(board),
          el("main", { className: "tmain mapmain" },
            staleNote(board),
            liveBanner(board),
            snapshotPanel(board),
            el("div", { className: "boardbar" }, turnDial(board), viewSwitch(board), mapPicker(board), filterBar(board)),
            s.mapData
              ? el("div", { className: "mapstage-wrap" }, s.mapHost, stageFloat(board, true))
              : el("div", { className: "empty", text: "This map has nothing drawn on it yet." }),
            runErr()),
          el("div", { className: "tside" }, rail(board)),
        )
      : el("div", { className: "tbody" },
          boxNav(board),
          el("main", { className: "tmain listmain" },
            el("div", { className: "tscroll" },
              staleNote(board),
              liveBanner(board),
              snapshotPanel(board),
              el("div", { className: "boardbar" }, turnDial(board), viewSwitch(board), filterBar(board)),
              listCells(board),
              runErr()),
            stageFloat(board, false)),
          rail(board),
        ),
  );
  // An outcome was just chosen: Continue takes focus, so Enter commits the
  // play and the keyboard never has to find the button.
  if (s.focusPending) {
    s.focusPending = false;
    content.querySelector<HTMLButtonElement>(".playpanel .pp-actions .primary")?.focus();
  }
  // Keep the journal reading like a story: newest visible.
  const journal = content.querySelector<HTMLElement>(".journal");
  if (journal) journal.scrollTop = journal.scrollHeight;
  scroll.restore();
  // The map is a live view of the same session: a play moves the running mark,
  // a deal changes what a pin holds. Never in Live mode, which is list-only.
  if (!s.liveMode && s.view === "map") showMap(board);
}

/** Read the list's and the rail panel's scroll before a render, and put it back
 *  after, when the render showed the same things in them (BoardState.scrollKeys). */
function keepScroll(): { restore: () => void } {
  const listKey = `${s.liveMode ? "live" : "local"}|${s.boxSel ?? ""}|${effectiveView(s)}`;
  const panelKey = `${railTabShown(s)}|${s.selectedHand ?? ""}`;
  const keepList = listKey === s.scrollKeys.list ? root.querySelector(".tscroll")?.scrollTop : undefined;
  const keepPanel = panelKey === s.scrollKeys.panel ? root.querySelector(".statepanel, .whypanel")?.scrollTop : undefined;
  s.scrollKeys = { list: listKey, panel: panelKey };
  return {
    restore: () => {
      if (keepList !== undefined) { const sc = root.querySelector(".tscroll"); if (sc) sc.scrollTop = keepList; }
      if (keepPanel !== undefined) { const sc = root.querySelector(".statepanel, .whypanel"); if (sc) sc.scrollTop = keepPanel; }
    },
  };
}

async function boot(): Promise<void> {
  const state = await bootToolWindow({ onPinned: (on) => head.pin.set(on) });
  head.pin.set(state.boardPinned);
  s.follow = state.boardFollow;
  head.followToggle.set(s.follow);
  // The remembered List | Map choice; "map" is the default and the Board shows
  // the list when the project has no map to show.
  s.view = state.boardView;
  s.rememberedBox = state.boardBox;
  root.replaceChildren(head.el, content);
  // Live Link: a game may already be connected when the Board opens.
  s.liveStatus = await board.studio.liveLinkStatus();
  await build(board);
}
// Re-check freshness whenever the Board regains focus (the moment you return
// from editing) - it flips to the out-of-date banner if the project changed.
window.addEventListener("focus", () => void checkStale(board));
void boot();
