// ---------------------------------------------------------------------------
// The dialogs of the pack exchange: connecting, pushing, and the way out of a
// project the server has not seen the whole of.
//
// Connect to a server is one modal, two fields, and no explanation. It is for
// somebody who was given an address and a code and knows what they mean. There
// is nothing here about what is at the other end, nowhere to go and read about
// it, and nothing to sign up to: an address, a code, Connect.
//
// Push is a note and a look at where the project stands, and, when the far end
// has refused with things this change breaks, one tick per break in the far
// end's own words. Nothing here paraphrases a refusal.
//
// The shell's `confirm-*` classes, like the updater's prompt, so both wear the
// app's own typography rather than a second look invented for one dialog.
// ---------------------------------------------------------------------------

import { labelled } from "@wildwinter/app-shell";
import { el } from "./dom.js";
import type { LeavePromptDto, LeaveSettledDto } from "../../shared/api.js";

export interface ConnectAnswer {
  address: string;
  code: string;
}

export interface ConnectOptions {
  /** Filled in when we already know where this is going: the open project's
   *  address, or the one a pack came with. The code is always typed. */
  address?: string;
  /** Offer to forget the key held for the address. Only where there might be
   *  one, which is when an address arrived with the dialog. */
  offerForget?: boolean;
}

/** Show the dialog. Resolves to the answer, to a request to forget an address,
 *  or to null when the author backed out. */
export function askServer(opts: ConnectOptions = {}): Promise<ConnectAnswer | { forget: string } | null> {
  return new Promise((resolve) => {
    const dlg = el("dialog", "confirm-dialog server-dialog");
    dlg.append(el("div", "confirm-title", "Connect to a server"));

    const address = el("input", "insp-input");
    address.type = "text";
    address.value = opts.address ?? "";
    const code = el("input", "insp-input");
    code.type = "text";

    // The shell's captioned field, so this dialog has no look of its own.
    dlg.append(el("div", "confirm-body", labelled("Address", address), labelled("Code", code)));

    const actions = el("div", "confirm-actions");
    let done = false;
    const finish = (answer: ConnectAnswer | { forget: string } | null): void => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(answer);
    };

    if (opts.offerForget === true) {
      const forget = el("button", "confirm-btn cancel", "Forget this server");
      forget.addEventListener("click", () => finish({ forget: address.value.trim() }));
      actions.append(forget);
    }
    const cancel = el("button", "confirm-btn cancel", "Cancel");
    cancel.addEventListener("click", () => finish(null));
    const connect = el("button", "confirm-btn", "Connect");
    const submit = (): void => {
      const a = address.value.trim();
      const c = code.value.trim();
      if (a === "" || c === "") return;   // both, or nothing to do
      finish({ address: a, code: c });
    };
    connect.addEventListener("click", submit);
    for (const input of [address, code]) {
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    }
    actions.append(cancel, connect);
    dlg.append(actions);

    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    // The code is what an author has in their hand; the address is usually
    // already right when it is there at all.
    queueMicrotask(() => (opts.address ? code : address).focus());
  });
}

// --- Push ---------------------------------------------------------------------

/** One thing the far end says this push would break, and the word it knows it
 *  by. Shown as it stands; ticked, it goes back as an acknowledgement. */
export interface PushBreak {
  key: string;
  message: string;
}

export interface PushOptions {
  /** Where the project stands, in the Server menu's own words. */
  status: string;
  /** The note already typed, so a refusal does not cost the author their note. */
  note?: string;
  /** The far end's refusal, shown above the breaks it named. */
  refusal?: string;
  /** What it named. With any of these, Push is offered only once every one is
   *  ticked: acknowledging is per break, and there is no "all of them" button
   *  because there is no reading them in one. */
  breaks?: readonly PushBreak[];
}

export interface PushAnswer {
  note: string;
  /** The breaks ticked, by the far end's own key. Empty on a first attempt. */
  acknowledge: string[];
}

/** Show the push dialog. Resolves to what to send, or to null when the author
 *  backed out. */
export function askPush(opts: PushOptions): Promise<PushAnswer | null> {
  return new Promise((resolve) => {
    const dlg = el("dialog", "confirm-dialog server-dialog push-dialog");
    dlg.append(el("div", "confirm-title", "Push"));

    const note = el("input", "insp-input");
    note.type = "text";
    note.value = opts.note ?? "";

    const body = el("div", "confirm-body", labelled("Note", note));
    const breaks = opts.breaks ?? [];
    const ticks: HTMLInputElement[] = [];
    if (breaks.length > 0) {
      // The refusal first, verbatim, then the things it named: the author reads
      // why before they read what.
      if (opts.refusal !== undefined && opts.refusal !== "") {
        body.append(el("p", "push-refusal", opts.refusal));
      }
      const list = el("div", "push-breaks");
      for (const each of breaks) {
        const tick = el("input", "push-tick");
        tick.type = "checkbox";
        ticks.push(tick);
        const row = el("label", "push-break", tick, el("span", { text: each.message }));
        list.append(row);
      }
      body.append(list, el("p", "push-hint", "Tick each one to push it anyway."));
    }
    // The status is a fact about the project, not a field: it sits under what
    // is being asked, in the same words the Server menu uses.
    body.append(el("p", "push-status", opts.status));
    dlg.append(body);

    const actions = el("div", "confirm-actions");
    let done = false;
    const finish = (answer: PushAnswer | null): void => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(answer);
    };

    const cancel = el("button", "confirm-btn cancel", "Cancel");
    cancel.addEventListener("click", () => finish(null));
    const push = el("button", "confirm-btn", "Push");
    const acknowledged = (): boolean => ticks.every((t) => t.checked);
    const reflect = (): void => { push.disabled = !acknowledged(); };
    for (const tick of ticks) tick.addEventListener("change", reflect);
    reflect();
    const submit = (): void => {
      if (!acknowledged()) return;
      finish({
        note: note.value.trim(),
        acknowledge: breaks.filter((_, i) => ticks[i]!.checked).map((b) => b.key),
      });
    };
    push.addEventListener("click", submit);
    note.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    actions.append(cancel, push);
    dlg.append(actions);

    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    queueMicrotask(() => (breaks.length > 0 ? ticks[0]! : note).focus());
  });
}

// --- leaving with edits the server has not seen -------------------------------

/**
 * The way out: push, go anyway, or stay.
 *
 * The app's own dialog rather than the OS's, which is not a matter of taste.
 * Until 2026-09-07 this was a native `showMessageBox` attached to the editor
 * window, and on the close path that window's close had already been deferred:
 * dismissing the sheet let the deferred close through whatever button was
 * clicked, so Cancel closed the window and Push closed it without pushing. It
 * also wore the OS's typography beside two dialogs that wear the app's.
 *
 * Resolves the button INDEX, which is `showMessageBox`'s contract and the
 * updater prompt's: main knows what each index means, and nothing over here
 * has to.
 */
export function askLeave(opts: LeavePromptDto): Promise<number> {
  return new Promise((resolve) => {
    const dlg = el("dialog", "confirm-dialog server-dialog leave-dialog");
    // The status line is the headline, as it is on the push dialog: where the
    // project stands is the whole reason the question is being asked, and it
    // NAMES the project, because the moment it is asked is the moment a second
    // one is arriving.
    const title = el("div", "confirm-title", opts.message);
    const body = el("div", "confirm-body", opts.detail);
    dlg.append(title, body);

    const actions = el("div", "confirm-actions");
    let done = false;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const shut = (): void => {
      if (live?.dlg === dlg) live = undefined;
      if (guard !== undefined) clearTimeout(guard);
      dlg.close();
      dlg.remove();
    };
    const finish = (index: number): void => {
      if (done) return;
      done = true;
      // THE DIALOG STAYS UP. A push takes as long as the far end takes, and the
      // person who pressed Push to server is owed the sight of it landing, so
      // main answers this dialog rather than the click doing it: it turns into
      // "Pushed as revision N", or it is taken down with nothing to say. The
      // buttons go at once, because they have been used.
      actions.remove();
      // ...and if main never speaks again, it goes anyway. A modal nobody can
      // dismiss is worse than a dialog that closed a moment early.
      guard = setTimeout(shut, HOLD_LIMIT);
      resolve(index);
    };

    opts.buttons.forEach((label, i) => {
      // The way out reads as the quiet one, the default as the affirmative:
      // the pairing every other confirm in the app uses.
      const button = el("button", i === opts.cancelId ? "confirm-btn cancel" : "confirm-btn", label);
      button.addEventListener("click", () => finish(i));
      actions.append(button);
      if (i === opts.defaultId) queueMicrotask(() => button.focus());
    });
    dlg.append(actions);

    // Esc is Cancel, not a fourth answer: main is waiting on an index.
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(opts.cancelId); });
    live = {
      dlg,
      settle: (message) => {
        title.textContent = message;
        body.remove();
      },
      shut,
    };
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** The dialog waiting on main's last word, when there is one up. */
let live: { dlg: HTMLDialogElement; settle: (message: string) => void; shut: () => void } | undefined;

/** How long a dialog waits for main before it takes itself down. Longer than a
 *  push can take, because while a push is running this dialog IS the sign that
 *  something is happening. */
const HOLD_LIMIT = 60_000;

/**
 * Main's last word on the prompt it asked.
 *
 * With a message the dialog turns into it - no buttons, held for the beat main
 * is holding too - and without one it simply goes: cancelled, left, or refused,
 * where the refusal has its own prompt to follow. A renderer with nothing up
 * (main fell back to the native box) has nothing to do.
 */
export function settleLeave(opts: LeaveSettledDto): void {
  const held = live;
  if (held === undefined) return;
  if (opts.message === undefined || opts.message === "") { held.shut(); return; }
  held.settle(opts.message);
  setTimeout(() => held.shut(), Math.max(0, opts.holdMs));
}
