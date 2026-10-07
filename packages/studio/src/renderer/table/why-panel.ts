// ---------------------------------------------------------------------------
// The rail's Why not? tab: the selected hand's latest deal, read back. Every
// card that could have come up there and did not, with the reason, nearest
// misses first (a full hand); the box's cards that were never meant for this
// hand folded away beneath. From the session's own record locally, from the
// game's trace in Live mode: the same reading either way (model `whyNotOf`).
// ---------------------------------------------------------------------------

import { el, iconNode, plural } from "@wildwinter/app-shell";
import type { Board } from "./board-state.js";
import type { NotDealt } from "./model.js";
import { revealCard } from "./session.js";

/** Where a reason leads in the editor: a failed condition to that When, the
 *  card's own or its deck's, and the rest (a full hand, a cooldown, a copy held
 *  elsewhere) to the card's Dealing tab, where priority, redraw and copies are
 *  set. Nowhere for a card that is not for this hand: its tags are the whole
 *  reason. */
export function reasonTarget(v: NotDealt["verdict"]): { section: "when" | "dealing"; deck: boolean; tip: string } | undefined {
  if (v === undefined || v === "tags") return undefined;
  if (v === "condition") return { section: "when", deck: false, tip: "Open its When condition" };
  if (v === "deck-gate") return { section: "when", deck: true, tip: "Open the deck's When condition" };
  return { section: "dealing", deck: false, tip: "Open its dealing settings: priority, redraw and copies" };
}

export function whyPanel(b: Board): HTMLElement {
  const s = b.state;
  const panel = el("div", { className: "whypanel" });
  const selected = s.selectedHand;
  if (selected === undefined) {
    panel.append(el("p", { className: "empty", text: "Select a hand to see why the cards that could have come up there didn't. Click a hand's name, or its pin on the map." }));
    return panel;
  }
  const name = s.table?.hands().find((h) => h.gameId === selected)?.title ?? selected;
  const why = s.liveMode ? s.liveRun?.whyNot[selected] : s.table?.whyNot(selected);
  // The hand as a heading, and when its deal was underneath: the two lines that
  // say what everything below is about.
  const head = el("div", { className: "whyhead" }, el("span", { className: "whyhand", text: name }));
  panel.append(head);
  if (why === undefined) {
    head.append(el("span", { className: "whymeta", text: s.liveMode ? "The game hasn't dealt this hand yet." : "Nothing has been dealt here yet." }));
    return panel;
  }
  const when = `Its latest deal${why.turn !== undefined ? `, on turn ${why.turn}` : ""}`;
  if (why.looked === 0) {
    // An empty deal is not "every card came up": nothing was looked at.
    head.append(el("span", { className: "whymeta", text: `${when} looked at no cards: the hand's own condition wasn't met, or its box has no cards.` }));
    return panel;
  }
  head.append(el("span", { className: "whymeta", text: `${when}. ${plural(why.here, "card")} here now.` }));
  // One block per card: its name, and the reason indented beneath it, so the
  // list reads as cards with their reasons rather than as one run of text.
  // Both are ways into the editor (the author's ask, 2026-10-02): the name
  // opens the card, and the reason opens where it lives (reasonTarget). A card
  // the build doesn't know (a game's own, in Live mode) has nowhere to go, and
  // stays plain text.
  const link = (text: string, className: string, tip: string, go: () => void): HTMLElement =>
    el("button", { className: `whylink ${className}`, text, tip, onClick: go });
  const item = (n: NotDealt | { gameId: string; title?: string }): HTMLElement => {
    const cardName = n.title ?? n.gameId;
    const reason = "reason" in n ? n.reason : undefined;
    const home = s.table?.home(n.gameId);
    if (home === undefined) {
      return el("div", { className: "whyitem" },
        el("span", { className: "whycard", text: cardName }),
        reason !== undefined ? el("span", { className: "whyreason", text: reason }) : null);
    }
    const target = "verdict" in n ? reasonTarget(n.verdict) : undefined;
    return el("div", { className: "whyitem" },
      link(cardName, "whycard", "Open the card in the editor", () => revealCard(b, n.gameId)),
      reason === undefined ? null
        : target === undefined ? el("span", { className: "whyreason", text: reason })
        : link(reason, "whyreason", target.tip, () => {
          void b.studio.searchReveal(target.deck
            ? { kind: "deck", box: home.box, deck: home.deck, section: target.section }
            : { kind: "card", box: home.box, deck: home.deck, card: home.card, section: target.section });
        }));
  };
  const could = el("section", { className: "whysection" },
    el("span", { className: "caption", text: `Could have come up here (${why.couldHave.length})` }));
  if (why.couldHave.length === 0) could.append(el("span", { className: "empty", text: "Every card that could come up here did." }));
  else could.append(el("div", { className: "whylist" }, ...why.couldHave.map(item)));
  panel.append(could);
  if (why.notHere.length > 0) {
    // Folded: the box's other cards are an inventory, not an explanation, and
    // listing them open under every hand buried the near misses. Names only:
    // their reason is the same for all of them, said once above the list.
    const rest = el("details", { className: "curtain whyrest" }) as HTMLDetailsElement;
    rest.append(el("summary", {}, iconNode("collapsed", 12), `Not for this hand (${why.notHere.length})`));
    rest.append(el("span", { className: "whymeta", text: "Their tags don't fit it." }));
    rest.append(el("div", { className: "whylist tight" }, ...why.notHere.map((n) => item({ gameId: n.gameId, ...(n.title !== undefined ? { title: n.title } : {}) }))));
    panel.append(rest);
  }
  return panel;
}
