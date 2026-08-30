// ---------------------------------------------------------------------------
// The Open chip over a canvas: the DOM affordance that follows the hovered node.
//
// Its own module, used by BOTH the node view and the canvas lab, because a copy
// in the lab is how the last two bugs in this thing hid (a cascade collision and
// a wiped element both looked fine in a lookalike).
//
// The awkward part it exists to solve: the chip is a sibling of Konva's content
// div, so moving the pointer ONTO the chip makes Konva fire mouseleave on the
// stage, the surface reports "no hover", and the chip vanishes from under the
// pointer - which also swallows the click. mouseout fires before mouseover, so a
// simple "am I over the chip" flag is always too late. Hence a grace period: a
// hide is scheduled, and arriving on the chip cancels it.
// ---------------------------------------------------------------------------

/** Long enough to cross the gap between canvas and chip, short enough that a
 *  deliberate move away still feels immediate. */
const GRACE_MS = 90;

export interface ChipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpenChip {
  /** Offer to open `id`, placed over its rectangle (canvas coordinates). */
  show: (id: string, rect: ChipRect) => void;
  /** Hide after the grace period. Cancelled by the pointer arriving on the chip,
   *  or by a fresh `show`. */
  hideSoon: () => void;
  /** Hide THIS INSTANT, no grace: for a drag, where the chip would otherwise hang
   *  in the air beside a card that has moved on. */
  hide: () => void;
  /** The card it is currently offering, if any. */
  target: () => string | undefined;
  destroy: () => void;
}

/**
 * Mount the chip into `host`. Call this AFTER a Konva stage is built in the same
 * container: Konva empties its container when it builds, which silently removes
 * anything added first.
 */
export function mountOpenChip(host: HTMLElement, onOpen: (id: string) => void): OpenChip {
  const chip = document.createElement("span");
  chip.className = "cardopen";
  chip.textContent = "Open";
  chip.dataset["tip"] = "Open this card (double-click)";
  chip.style.display = "none";

  let target: string | undefined;
  let timer: number | undefined;

  const cancel = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  };
  const hideNow = (): void => {
    cancel();
    target = undefined;
    chip.style.display = "none";
  };

  chip.addEventListener("mouseenter", cancel);
  chip.addEventListener("mouseleave", () => { hideSoon(); });
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = target;
    hideNow();
    if (id !== undefined) onOpen(id);
  });

  function hideSoon(): void {
    cancel();
    timer = window.setTimeout(hideNow, GRACE_MS);
  }

  host.append(chip);

  return {
    show(id, rect) {
      cancel();
      target = id;
      chip.style.display = "";
      // Bottom-right of the node, the corner the face itself leaves empty. Placed
      // from the LEFT and TOP; card-open.css releases right/bottom for exactly
      // this reason, or the chip would be pinned on all four edges.
      chip.style.left = `${Math.round(rect.x + rect.width - 62)}px`;
      chip.style.top = `${Math.round(rect.y + rect.height - 26)}px`;
    },
    hideSoon,
    hide: hideNow,
    target: () => target,
    destroy() { cancel(); chip.remove(); },
  };
}
