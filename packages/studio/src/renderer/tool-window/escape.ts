// ---------------------------------------------------------------------------
// Escape, read as it was pressed.
//
// A tool window layers Escape (the shell's `onEscape`): drop the smallest thing
// first, close the window last. The trouble is that a canvas in the window
// listens for the same key on the same target and drops its own selection, so
// what `onEscape` sees depended on which listener the window happened to
// register first. Registered the other way round, one Escape cleared the
// selection AND closed the window, because by the time the window asked "is
// anything selected?" the canvas had already said no.
//
// This takes the reading in the CAPTURE phase, before any bubbling listener has
// run, so `onEscape` answers from the state the key was pressed in, whatever the
// order of everything else.
// ---------------------------------------------------------------------------

/** Take `read()` whenever Escape goes down, before anything else hears it, and
 *  hand back the latest reading. Undefined until the first Escape. */
export function escapeSnapshot<T>(read: () => T, target: Window = window): () => T | undefined {
  let last: T | undefined;
  target.addEventListener("keydown", (e) => {
    if (e.key === "Escape") last = read();
  }, { capture: true });
  return () => last;
}

/** Whether a pointer is held down in `host` right now: a marquee or a drag in
 *  progress, which Escape abandons and which must not close the window. */
export function pointerHeld(host: HTMLElement, target: Window = window): () => boolean {
  let down = false;
  // Mouse events, as the canvas surface itself listens for.
  host.addEventListener("mousedown", () => { down = true; }, { capture: true });
  const up = (): void => { down = false; };
  target.addEventListener("mouseup", up, { capture: true });
  target.addEventListener("blur", up);
  return () => down;
}
