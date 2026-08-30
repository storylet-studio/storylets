// ---------------------------------------------------------------------------
// The new-thing picker: one component, two scales.
//
// Making a PROJECT and making a BOX are the same moment - choose a starting
// shape, give it a name - and they were about to be drawn two different ways:
// a hand-rolled overlay for boxes and a form for projects (design review
// 2026-08, A5 and A15). Two drawings of one idea teach an author that they are
// unrelated features.
//
// ON `<dialog>`, which is A15's actual complaint. The box picker was the one
// modal in the family off the native dialog stack: its own overlay div, its own
// capture-phase Escape listener, a backdrop click, and NO FOCUS TRAP - in the
// first modal a new author ever sees. `showModal()` brings the trap, Escape and
// the inert background for nothing, which is exactly why the shell's
// confirmDialog was rebuilt onto it.
//
// KIT AT BOTH SCALES, and the word was chosen rather than defaulted to. The
// alternative was "template", and it is already taken twice over by domain
// entities an author meets early: a HAND template and a CARD template. A third
// meaning at project scale would collide with the two concepts the copy pass
// has just finished explaining in plain words.
//
// A shell candidate rather than shell code, for now: it passes "would a third
// app want it" easily, but the shell is a published dependency and this wants
// using in anger first.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";

export interface KitChoice<T extends string> {
  id: T;
  name: string;
  blurb: string;
}

export interface KitPickerOptions<T extends string> {
  /** The dialog's heading: "New project", "New box". */
  title: string;
  /** What the thing being made IS, in concrete terms. The picker is where an
   *  author first meets the concept, and it was one line short of teaching it. */
  what: string;
  /** What a kit is. The same sentence at both scales, which is the point. */
  sub: string;
  kits: KitChoice<T>[];
  /** Ask for a name too, with this placeholder. Absent = the kit is the whole
   *  choice, which is how making a box works: it is named after the fact. */
  namePlaceholder?: string;
  /** Chosen. `name` is present only when `namePlaceholder` was. */
  onPick: (kit: T, name?: string) => void;
}

export function openKitPicker<T extends string>(opts: KitPickerOptions<T>): void {
  const dialog = el("dialog", { className: "kit-dialog" }) as HTMLDialogElement;
  // Removed on the native CLOSE event, not only from our own close().
  // `<dialog>` gives Escape for free, but Escape calls close() without removing
  // the element - so every dismissal left a closed dialog in the document, and
  // the next open would find the stale one first. Hooking the event catches
  // every route out: Escape, close(), and the form-method-dialog path.
  dialog.addEventListener("close", () => dialog.remove());
  const close = (): void => { dialog.close(); };

  const placeholder = opts.namePlaceholder;
  const nameInput = placeholder === undefined ? undefined : el("input", { className: "kit-name" }) as HTMLInputElement;
  if (nameInput !== undefined && placeholder !== undefined) {
    nameInput.placeholder = placeholder;
    // Enter picks the first kit, which is the one an author who typed a name and
    // pressed Enter meant: they have said what they want it called, not that
    // they want the fourth starting shape.
    nameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      e.preventDefault();
      const first = opts.kits[0];
      if (first && nameInput.value.trim() !== "") { close(); opts.onPick(first.id, nameInput.value.trim()); }
    });
  }

  const pick = (kit: T): void => {
    const name = nameInput?.value.trim();
    // A name is required when one is asked for: making a project without one
    // would have to invent a folder name, which is the slug-typing habit A5
    // removed from the welcome screen.
    if (nameInput && (name === undefined || name === "")) { nameInput.focus(); return; }
    close();
    opts.onPick(kit, name);
  };

  dialog.append(
    el("h2", { className: "kit-title", text: opts.title }),
    el("p", { className: "kit-what", text: opts.what }),
    ...(nameInput ? [nameInput] : []),
    el("p", { className: "kit-sub", text: opts.sub }),
    ...opts.kits.map((k) =>
      el("button", { className: "kit-card", onClick: () => pick(k.id) },
        el("h3", { text: k.name }),
        el("p", { text: k.blurb }))),
    el("div", { className: "kit-actions" },
      el("button", { className: "kit-cancel", text: "Cancel", onClick: close })),
  );

  // The backdrop closes, as it did before; `<dialog>` gives Escape for free.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  if (nameInput) nameInput.focus();
}
