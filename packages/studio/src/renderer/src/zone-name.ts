// ---------------------------------------------------------------------------
// Name a zone as it is drawn (the sign-off round: all three personas met
// `new-zone`, and the immersive designer's eight rooms were eight renames).
//
// The shell's Game ID editor in its own clothes: a zone is a tag, and a tag's
// name IS its address (tags have no titles), so the field slugs what is typed
// exactly as that editor does. It differs in one way, which is why it is not
// that editor: closing it without a name still makes the zone, as
// "new-zone". The shape is the work; losing it to an Escape would be worse
// than the old default.
// ---------------------------------------------------------------------------

import { gameIdify, isValidGameId, openAnchoredPanel } from "@wildwinter/app-shell";
import { el } from "./dom.js";

/** Ask for the new zone's name; resolves with what was typed ("" for none). */
export function askZoneName(anchor: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    let answer = "";
    const panel = openAnchoredPanel({
      anchor, className: "shell-id-editor", title: "Name the zone", width: 260, prefer: "centre",
      onClose: () => resolve(answer),
    });
    if (!panel) { resolve(""); return; }
    const input = el("input", { className: "shell-id-input" }) as HTMLInputElement;
    input.type = "text";
    input.placeholder = "new-zone";
    input.spellcheck = false;
    const hint = el("div", { className: "shell-id-hint", text: "Lower case letters, digits, and hyphens. What it is called on the map and in every tag picker." });
    const set = el("button", { className: "shell-id-set", text: "Name it" }) as HTMLButtonElement;
    set.type = "button";
    const slug = (): string => gameIdify(input.value.trim());
    const sync = (): void => {
      const bad = input.value.trim() !== "" && !isValidGameId(slug());
      set.disabled = bad;
      hint.classList.toggle("bad", bad);
    };
    const commit = (): void => {
      if (set.disabled) return;
      answer = slug();
      panel.close();
    };
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(); }
    });
    set.addEventListener("click", commit);
    panel.body.append(input, hint, el("div", { className: "shell-id-actions" }, set));
    sync();
    setTimeout(() => input.focus(), 0);
  });
}
