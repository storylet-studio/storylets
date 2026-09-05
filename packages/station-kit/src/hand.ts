// ---------------------------------------------------------------------------
// The hand: cards, and their outcomes as buttons.
//
// THE OTHER RULE (spec 5.7, and the defect of 2026-09-05): a card face is
// built by the station KIND, not by one template for all. A party's screen
// shows the title, the story and the outcome titles; a performer's shows the
// purpose, the prompt and the cue as well. So the part's DEFAULT face is the
// party's, and a crew face is asked for by name. The other way round is how
// the author's notes reached a visitor's phone: a default that showed
// everything was right for the one screen that wanted everything and wrong
// for the three that did not, and only one of the four was written by
// somebody thinking about it.
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
import { planTemplate } from "./fields.js";
import type { CardFace, FieldTemplate } from "./fields.js";

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
  /** What this station's cards show. Absent is the PARTY's face: the title,
   *  the story, and the outcome titles. A crew handset asks for the rest. */
  face?: CardFace;
  /** What to call this hand on screen, above its cards. The wire carries no
   *  hand titles, so whoever knows what a hand is called says so here; absent
   *  draws no heading, for an app that heads its own sections. */
  heading?: string;
  /** How a card's fields are drawn, for a venue that has outgrown the plan:
   *  supplying this replaces the face's rows and nothing else. */
  template?: FieldTemplate;
  /** What an empty hand says. A venue writes its own: "nothing here yet". */
  emptyText?: string;
}

export function handPart(opts: HandOptions): Part<HandState> {
  const root = el("div", { className: cls("part", "hand") });
  const face: CardFace = opts.face ?? {};
  const template = opts.template ?? planTemplate(face);
  const cards = el("div", { className: cls("cards") });
  cards.setAttribute("role", "list");
  // The heading is TEXT, and a heading: the gameId shouted in small capitals
  // was a label for a thing a visitor never sees the name of (2026-09-05).
  if (opts.heading !== undefined) {
    root.append(el("h2", { className: cls("hand-title"), text: opts.heading }));
  }
  root.append(cards);
  let disposed = false;
  let pressed = false;
  const asked = new Set<string>();

  const draw = (state: HandState): void => {
    cards.replaceChildren();
    if (state.cards.length === 0) {
      cards.append(el("p", { className: cls("hand-empty"), text: opts.emptyText ?? "Nothing here just now." }));
      return;
    }
    for (const card of state.cards) {
      const outcomes = state.outcomes?.[card.id];
      if (outcomes === undefined && opts.onWantOutcomes && !asked.has(card.id)) {
        asked.add(card.id);
        opts.onWantOutcomes(card.id, state.hand);
      }
      const body = el("article", { className: cls("card"), attrs: { role: "listitem", "data-card": card.id } });
      if (face.title !== false) {
        body.append(el("h3", { className: cls("card-title"), text: card.title ?? card.id }));
      }
      // The purpose is the AUTHOR's note about what the beat is for. It goes
      // on a performer's screen and on no other (5.7).
      if (face.purpose === true && card.purpose !== undefined) {
        body.append(el("p", { className: cls("card-purpose"), text: card.purpose }));
      }
      const rows = template(card);
      const fields = el("div", { className: cls("fields") });
      for (const row of rows) {
        if (row.prose === true) {
          body.append(el("p", { className: `${cls("card-text")} ${cls(`field-${row.key}`)}`, text: row.value }));
          continue;
        }
        const line = el("div", { className: `${cls("field")} ${cls(`field-${row.key}`)}` });
        if (row.label !== undefined) line.append(el("span", { className: cls("field-label"), text: row.label }));
        line.append(el("span", { className: cls("field-value"), text: row.value }));
        fields.append(line);
      }
      if (fields.childElementCount > 0) body.append(fields);
      const row = el("div", { className: cls("outcomes") });
      for (const outcome of outcomes ?? []) {
        // The button SAYS the title and nothing else. An outcome's purpose as
        // a `title` or an `aria-label` is author-facing material in the
        // accessible name, which a party's screen reader reads out (the
        // defect of 2026-09-05); a crew handset gets it as a hint beside.
        const button = el("button", {
          className: `${cls("button")} ${cls("outcome")}`,
          type: "button",
          text: outcome.title ?? outcome.id,
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
        if (face.outcomePurpose === true && outcome.purpose !== undefined) {
          row.append(el("div", { className: cls("outcome-wrap") },
            button,
            el("span", { className: cls("outcome-hint"), text: outcome.purpose })));
        } else {
          row.append(button);
        }
      }
      body.append(row);
      cards.append(body);
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
      // The heading goes with the cards: a hand that is gone leaves nothing
      // behind, and `update` after this is a no-op rather than a redraw.
      root.replaceChildren();
      cards.replaceChildren();
      asked.clear();
    },
  };
}
