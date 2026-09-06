// ---------------------------------------------------------------------------
// Connect to a server: one modal, two fields, and no explanation.
//
// It is for somebody who was given an address and a code and knows what they
// mean. There is nothing here about what is at the other end, nowhere to go and
// read about it, and nothing to sign up to: an address, a code, Connect.
//
// The shell's `confirm-*` classes, like the updater's prompt, so it wears the
// app's own typography rather than a second look invented for one dialog.
// ---------------------------------------------------------------------------

import { labelled } from "@wildwinter/app-shell";
import { el } from "./dom.js";

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
