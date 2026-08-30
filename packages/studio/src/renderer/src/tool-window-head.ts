// The tool window's title bar, in one place.
//
// Four windows draw the same header - a title, a spacer, whatever that window
// needs, the pin, the close - and until 2026-08-29 each hand-built it. The
// close button in particular was written out four times, tip and all, which is
// four chances for one of them to say something slightly different.
//
// It stays HERE rather than in @wildwinter/app-shell, beside the pinButton and
// the .swin-* CSS it composes, because the duplication is ours: Patterpad has
// one tool window and we have four. If it grows more, this is the obvious
// thing to move over.
import { el } from "./dom.js";
import { icon, pinButton } from "@wildwinter/app-shell";

export interface ToolWindowHeadOptions {
  /** The window's own name. Constant: it says which window this is, so it must
   *  not change as projects open and close.
   *
   *  Omitted by Find, whose mode tabs stand where the title would be
   *  (Patterpad's bar: modes left, pin and close right). */
  title?: string;
  /** A pin BUILT ALREADY, for a window that mounts its chrome once and drives
   *  the button with `pin.set(on)` rather than rebuilding the bar. That is
   *  Find's shape and the better one - it has no re-entrancy question and it
   *  survives a partial repaint - so the helper takes either. */
  pin?: { el: HTMLElement };
  pinned?: boolean;
  onPin?: (on: boolean) => void;
  onClose: () => void;
  /** Between the title and the spacer - a subtitle, the project name. */
  lead?: (Node | string | null)[];
  /** Between the spacer and the pin - this window's own controls. */
  trail?: (Node | string | null)[];
  /** An extra class beside `swin-head`, for a window that styles its own bar
   *  (Coverage's `cbar`). */
  className?: string;
}

/** The `.swin-head` bar every tool window wears. */
export function toolWindowHead(opts: ToolWindowHeadOptions): HTMLElement {
  const keep = (parts: (Node | string | null)[] | undefined): (Node | string)[] =>
    (parts ?? []).filter((p): p is Node | string => p !== null);
  const pin = opts.pin
    ?? pinButton({ pinned: opts.pinned ?? true, onToggle: opts.onPin ?? (() => {}) });
  return el("header", { className: `swin-head${opts.className ? ` ${opts.className}` : ""}` },
    ...(opts.title !== undefined ? [el("span", { className: "swin-title", text: opts.title })] : []),
    ...keep(opts.lead),
    el("span", { className: "swin-spacer" }),
    ...keep(opts.trail),
    pin.el,
    el("button", {
      className: "swin-close", text: icon.close, tip: "Close (Esc)",
      onClick: opts.onClose,
    }),
  );
}
