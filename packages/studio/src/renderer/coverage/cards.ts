// ---------------------------------------------------------------------------
// The Coverage window's summary and card table, on their own so they can be
// rendered headlessly: coverage.ts wires a live window at import time.
//
// The window leads with CARDS, the least reached first, the way Patterpad's
// leads with lines (patter 72c625f; the author's ruling, 2026-09-29). The rows
// worth a look come first, and a switch puts the table back in deck order.
//
// A card has two stages where a Patter line has one: dealt, then played. A card
// dealt and never played (every outcome's condition stayed shut) is a fault of
// its own, so it is counted at the top and tinted apart from the never dealt.
// A card with no outcomes is dealt-only by design (the news and codex pattern)
// and its played column says so rather than showing a 0 that reads as a gap.
//
// The order and the Runs dealt figure come from ops, through the one file of
// it a renderer can load, so this table and `storyletengine coverage` cannot
// disagree about which card leads.
// ---------------------------------------------------------------------------

import { el, formatCount, metaLine, plural } from "@wildwinter/app-shell";
import { leastReachedFirst, sharePct } from "@storylet-studio/ops/coverage-order";
import type { CoverageOrder, CoverageReport, SearchSelection } from "../../shared/api.js";

type CardRow = CoverageReport["cards"][number];

/** Give an element a themed rollover without making it the accessible name
 *  (`tip` on `el` does both, which suits an icon button, not a heading). The
 *  one copy: the window's own run line uses it too. */
export function withTip<T extends HTMLElement>(node: T, tip: string): T {
  node.dataset["tip"] = tip;
  return node;
}

/** The headline and the three counts under it. The big count is cards dealt
 *  out of cards total; the quiet stats say how many of them want a look. */
export function summaryBlock(r: CoverageReport, partial: boolean): HTMLElement {
  const t = r.totals;
  const stat = (n: number, label: string, tone: string, tip?: string): HTMLElement => {
    const node = el("span", { className: `cstat${n > 0 ? ` ${tone}` : ""}` },
      el("span", { className: "cstat-n", text: formatCount(n) }),
      el("span", { className: "cstat-l", text: label }));
    return tip !== undefined ? withTip(node, tip) : node;
  };
  return el("div", { className: "csum" },
    el("div", { className: "summary" },
      el("span", { className: "big", text: `${t.dealt}/${t.cards}` }),
      el("span", { className: "sublabel" },
        metaLine([`${sharePct(t.dealt, t.cards)} of cards dealt`, plural(r.runs, "run"), `seed ${r.seed}`])),
      partial ? el("span", { className: "partial", text: "stopped early" }) : null,
    ),
    el("div", { className: "cstats" },
      stat(t.neverDealt, "Never dealt", "bad"),
      stat(t.rare, "Rarely dealt", "warn", `Dealt, but in fewer than ${r.rareThresholdPct}% of runs`),
      stat(t.dealtNeverPlayed, "Dealt, never played", "warn",
        "Dealt at least once, but no outcome of it was ever played. Cards with no outcomes are not counted."),
    ),
  );
}

/** What the card table needs from the window around it. */
export interface CardTableOptions {
  /** The order it opens in. */
  order: CoverageOrder;
  /** Told when the author switches, so the window can remember it. */
  onOrderChange: (order: CoverageOrder) => void;
  /** Open a card in the editor. */
  onOpen: (selection: SearchSelection) => void;
  /** Open Find on a property a never-dealt card is gated on. */
  onFindUsage: (ref: string) => void;
}

const ORDERS: { value: CoverageOrder; label: string; tip: string }[] = [
  { value: "least", label: "Least reached first", tip: "The cards the test reached least come first, since they are the ones worth a look" },
  { value: "deck", label: "Deck order", tip: "Every card box by box and deck by deck, as you wrote them" },
];

/**
 * The card table under its caption and the order switch. Switching re-draws
 * the table in place and tells `onOrderChange`; the rest of the window is left
 * alone.
 */
export function cardsBlock(r: CoverageReport, opts: CardTableOptions): HTMLElement {
  let order = opts.order;
  const playable = new Set(r.outcomes.map((o) => o.card));
  const boxes = new Set(r.cards.map((c) => c.box));
  const nameOf = (id: string): string => {
    const c = r.cards.find((x) => x.id === id);
    return c ? c.title ?? c.gameId : id;
  };

  const seg = el("div", { className: "seg corder" });
  seg.setAttribute("role", "tablist");
  const buttons = ORDERS.map(({ value, label, tip }) => {
    const b = withTip(el("button", { className: "seg-opt", text: label }), tip);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset["order"] = value;
    b.addEventListener("click", () => {
      if (order === value) return;
      order = value;
      paint();
      opts.onOrderChange(value);
    });
    seg.append(b);
    return b;
  });

  const table = el("table", { className: "ctable" });
  const paint = (): void => {
    for (const b of buttons) {
      const on = b.dataset["order"] === order;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    const rows = order === "least" ? leastReachedFirst(r.cards) : r.cards;
    table.replaceChildren(head(), el("tbody", undefined, ...rows.map((c) => cardRow(c))));
  };

  /** The column headings, each numeric one explaining itself on hover. */
  const head = (): HTMLElement => el("thead", undefined, el("tr", undefined,
    el("th", { text: "Card" }),
    el("th", { text: "Deck" }),
    withTip(el("th", { className: "n", text: "Runs dealt" }), "The share of runs that dealt this card at least once"),
    withTip(el("th", { className: "n", text: "Times dealt" }),
      "How many times it was dealt across all runs. A card that stays in a hand counts again each turn, so this can be more than the number of runs."),
    withTip(el("th", { className: "n", text: "Times played" }),
      "How many times an outcome of it was played across all runs. It can be more than the number of runs, when a card comes round again."),
  ));

  const cardRow = (c: CardRow): HTMLElement => {
    const never = c.dealtRuns === 0;
    const hasOutcomes = playable.has(c.id);
    const unplayed = !never && hasOutcomes && c.playedRuns === 0;
    const tone = never ? " never" : unplayed ? " unplayed" : c.rare ? " rare" : "";

    const name = el("td", { className: "ccard" },
      el("span", { className: c.title !== undefined ? "ctitle" : "cid", text: c.title ?? c.gameId }));
    if (c.rare) {
      name.append(withTip(el("span", { className: "rtag", text: "Rare" }),
        `Dealt in fewer than ${r.rareThresholdPct}% of runs. It can come up, just not easily. ` +
        "Worth a look, unless it is one of many random picks by design."));
    }
    // Why a never-dealt card never came up, where the honesty net knows.
    if (c.unwrittenRefs && c.unwrittenRefs.length > 0) name.append(gateRefs(c.unwrittenRefs, opts.onFindUsage));
    // The second hop: the gate IS written, just never by anything that
    // happened. Naming the culprit turns two never-dealt cards from two
    // mysteries into one.
    for (const d of c.refsWrittenOnlyByNeverDealtCards ?? []) {
      name.append(el("span", { className: "cwhy hint",
        text: `${d.ref} is only written by ${d.by.map(nameOf).join(", ")}, which never came up either` }));
    }
    if (unplayed) name.append(el("span", { className: "cwhy hint", text: "Dealt, but no outcome of it was ever played" }));

    const deck = el("td", { className: "cdeck" }, el("span", { text: c.deckName }));
    if (boxes.size > 1) deck.append(el("span", { className: "cbox", text: c.boxName }));

    const tr = el("tr", { className: `crow${tone}` },
      name,
      deck,
      el("td", { className: "n creach", text: sharePct(c.dealtRuns, r.runs) }),
      el("td", { className: "n", text: formatCount(c.dealt) }),
      hasOutcomes
        ? el("td", { className: "n", text: formatCount(c.played) })
        : withTip(el("td", { className: "n cnone", text: "no outcomes" }),
            "Being dealt is its whole job, so it is never counted as unplayed"),
    );
    // A row is a way back into the editor, as every row in this window is.
    withTip(tr, "Open in the editor");
    tr.tabIndex = 0;
    const open = (): void => opts.onOpen({ kind: "card", box: c.box, deck: c.deck, card: c.id });
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    return tr;
  };

  paint();
  return el("section", { className: "block cards" },
    el("div", { className: "cardbar" },
      el("span", { className: "caption", text: `How often each card came up, over ${plural(r.runs, "run")}` }),
      seg),
    r.cards.length > 0 ? table : el("p", { className: "hint", text: "No cards to measure yet." }),
  );
}

/** A gate ref as a link into Find: "gated on @world.raining, where else is
 *  that used?" is the question a reader has the moment they read the flag. */
function gateRefs(refs: string[], onFindUsage: (ref: string) => void): HTMLElement {
  const span = el("span", { className: "cwhy hint" }, "gated on ");
  refs.forEach((ref, i) => {
    if (i > 0) span.append(", ");
    const link = withTip(el("button", { className: "reflink", text: ref }), `Find where ${ref} is used`);
    link.type = "button";
    // Not also the row's own click, which would open the card instead.
    link.addEventListener("click", (event) => { event.stopPropagation(); onFindUsage(ref); });
    link.addEventListener("keydown", (event) => event.stopPropagation());
    span.append(link);
  });
  // "or drives" only when a driver could actually help: drivers feed @world,
  // where @story and @hand state is the content's own to write.
  span.append(refs.some((r) => r.startsWith("@world.")) ? ", which nothing writes or drives" : ", which nothing writes");
  return span;
}
