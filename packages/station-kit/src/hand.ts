// ---------------------------------------------------------------------------
// The hand: cards, and their outcomes as buttons.
//
// THE RULE (spec 12): a gated outcome is DISABLED, never hidden. A performer
// who cannot see what is unavailable cannot tell a locked door from a missing
// one, and a party looking at a shorter list every time learns nothing about
// the world. The kit therefore renders every outcome the server returned and
// greys the ones whose `available` is false.
//
// Availability is evaluated at the moment of the ask, so outcomes are passed
// IN rather than fetched here: the app owns when to re-ask (after a play, on
// a board event), and the part owns how it looks. That also keeps the part
// synchronous, which is what makes it testable in four lines.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { DealtCardView, GameId, OutcomeViewWire } from "@storylet-studio/wire";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";
import { fieldRows } from "./fields.js";
import type { FieldTemplate } from "./fields.js";

export interface HandState {
  /** The hand's gameId, for the app that shows several at once. */
  hand: GameId;
  cards: DealtCardView[];
  /** By card gameId. A card with no entry shows no outcome row yet, which is
   *  the honest state while the ask is in flight. */
  outcomes?: Record<GameId, OutcomeViewWire[]>;
  /** Held: a command is queued or the connection is away, so every button is
   *  disabled rather than silently doing nothing. */
  busy?: boolean;
}

export interface HandOptions {
  /** Play a card. The part disables the whole hand until the next `update`,
   *  so a double tap on a slow network is one play. */
  onPlay(card: GameId, outcome: GameId, hand: GameId): void;
  /** A card came into view and its outcomes are not known yet. The app fetches
   *  them and calls `update` again. */
  onWantOutcomes?(card: GameId, hand: GameId): void;
  /** How a card's fields are drawn. The venue supplies this; the default shows
   *  the purpose and every field, which is right for a crew handset and wrong
   *  for nothing else that matters. */
  template?: FieldTemplate;
  /** What an empty hand says. A venue writes its own: "nothing here yet". */
  emptyText?: string;
}

export function handPart(opts: HandOptions): Part<HandState> {
  const root = el("div", { className: cls("part", "hand") });
  root.setAttribute("role", "list");
  let disposed = false;
  let pressed = false;
  const asked = new Set<string>();

  const draw = (state: HandState): void => {
    root.replaceChildren();
    if (state.cards.length === 0) {
      root.append(el("p", { className: cls("hand-empty"), text: opts.emptyText ?? "Nothing here just now." }));
      return;
    }
    for (const card of state.cards) {
      const outcomes = state.outcomes?.[card.id];
      if (outcomes === undefined && opts.onWantOutcomes && !asked.has(card.id)) {
        asked.add(card.id);
        opts.onWantOutcomes(card.id, state.hand);
      }
      const body = el("article", { className: cls("card"), attrs: { role: "listitem", "data-card": card.id } });
      body.append(el("h3", { className: cls("card-title"), text: card.title ?? card.id }));
      if (card.purpose !== undefined) {
        body.append(el("p", { className: cls("card-purpose"), text: card.purpose }));
      }
      const rows = fieldRows(card, opts.template);
      if (rows.length > 0) {
        const fields = el("div", { className: cls("fields") });
        for (const row of rows) {
          const line = el("div", { className: `${cls("field")} ${cls(`field-${row.key}`)}` });
          if (row.label !== undefined) line.append(el("span", { className: cls("field-label"), text: row.label }));
          line.append(el("span", { className: cls("field-value"), text: row.value }));
          fields.append(line);
        }
        body.append(fields);
      }
      const row = el("div", { className: cls("outcomes") });
      for (const outcome of outcomes ?? []) {
        const button = el("button", {
          className: `${cls("button")} ${cls("outcome")}`,
          type: "button",
          text: outcome.title ?? outcome.id,
          ...(outcome.purpose !== undefined ? { title: outcome.purpose } : {}),
          attrs: { "data-outcome": outcome.id },
          onClick: () => {
            if (pressed) return;
            pressed = true;
            root.querySelectorAll("button").forEach((b) => { (b as HTMLButtonElement).disabled = true; });
            opts.onPlay(card.id, outcome.id, state.hand);
          },
        }) as HTMLButtonElement;
        // Disabled, never hidden.
        button.disabled = !outcome.available || state.busy === true || pressed;
        row.append(button);
      }
      body.append(row);
      root.append(body);
    }
  };

  return {
    el: root,
    update(state) {
      if (disposed) return;
      pressed = false;
      draw(state);
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
      asked.clear();
    },
  };
}
