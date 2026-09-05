// ---------------------------------------------------------------------------
// The message tray, and the help button (spec 6.7).
//
// The people running a show need to talk to the people performing it, and a
// producer watching "4 of 5 in the forest have seen it" needs the fifth to be
// able to say so with one thumb. So: newest first, priority on the left edge
// in colour, and an Acknowledge button on anything that asked for one.
//
// A help call is the first thing a crew view needs after the prompt list, and
// it is the same route in the other direction, so it lives here beside the
// tray rather than in an app.
// ---------------------------------------------------------------------------

/// <reference lib="dom" />

import type { MessageId, MessageView } from "@storylet-studio/wire";
import { cls, el } from "./part.js";
import type { Part } from "./part.js";

export interface MessageTrayState {
  messages: MessageView[];
  /** Ids this device has already acked, so the button goes away without
   *  waiting for the server to say so. */
  acked?: MessageId[];
  busy?: boolean;
}

export interface MessageTrayOptions {
  onAck(id: MessageId): void;
  emptyText?: string;
  /** How many to show. A handset with a two-hour run behind it does not want
   *  all of it. */
  limit?: number;
}

/** Wall time, to the minute: a performer reads "14:32" and not an ISO string. */
const atTime = (iso: string): string => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
};

export function messageTrayPart(opts: MessageTrayOptions): Part<MessageTrayState> {
  const root = el("div", { className: cls("part", "tray"), attrs: { role: "log", "aria-live": "polite" } });
  let disposed = false;

  return {
    el: root,
    update(state) {
      if (disposed) return;
      root.replaceChildren();
      const acked = new Set(state.acked ?? []);
      const shown = [...state.messages].reverse().slice(0, opts.limit ?? 20);
      if (shown.length === 0) {
        root.append(el("p", { className: cls("tray-empty"), text: opts.emptyText ?? "Nothing from the control room." }));
        return;
      }
      for (const message of shown) {
        const row = el("div", {
          className: `${cls("message")} ${cls(`message-${message.priority}`)}`,
          attrs: { "data-message": message.id },
        });
        row.append(el("span", { className: cls("message-at"), text: atTime(message.at) }));
        row.append(el("span", { className: cls("message-body"), text: message.body }));
        if (message.ackRequired === true && !acked.has(message.id)) {
          const button = el("button", {
            className: cls("button"),
            type: "button",
            text: "Seen",
            onClick: () => opts.onAck(message.id),
          }) as HTMLButtonElement;
          button.disabled = state.busy === true;
          row.append(button);
        }
        root.append(row);
      }
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
    },
  };
}

export interface HelpButtonState {
  /** True once the call has gone: the button says so rather than inviting a
   *  performer to press it four more times. */
  sent?: boolean;
  busy?: boolean;
}

export interface HelpButtonOptions {
  onHelp(): void;
  text?: string;
  sentText?: string;
}

/** One button, one job: tell the control room. It sends a message with
 *  `priority: "urgent"` and `audience: { to: "producers" }`, which the app
 *  does through the client; the part is the thumb-sized target. */
export function helpButtonPart(opts: HelpButtonOptions): Part<HelpButtonState> {
  const root = el("div", { className: cls("part", "help") });
  const button = el("button", {
    className: `${cls("button")} ${cls("help-button")}`,
    type: "button",
    text: opts.text ?? "Call for help",
    onClick: () => opts.onHelp(),
  }) as HTMLButtonElement;
  root.append(button);
  let disposed = false;

  return {
    el: root,
    update(state) {
      if (disposed) return;
      button.disabled = state.busy === true || state.sent === true;
      button.textContent = state.sent === true
        ? (opts.sentText ?? "Help is called")
        : (opts.text ?? "Call for help");
    },
    dispose() {
      disposed = true;
      root.replaceChildren();
    },
  };
}
