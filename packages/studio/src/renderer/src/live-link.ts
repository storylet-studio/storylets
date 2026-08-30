// ---------------------------------------------------------------------------
// Live Link control (design/live-link.md): Patterpad's debug-panel, lifted. A
// compact status chip in the bottom-right corner that controls the loopback
// server a running game connects to. All the state collapses to one coloured
// "connect" icon (grey off, amber listening, green connected and in sync, red
// connected on a different build); click it to toggle the link (off ->
// listening -> stop), and while the link is up the copiable ws:// address sits
// beside it. What the game sends is the Board's business (table/live.ts);
// this is purely the control and the status.
// ---------------------------------------------------------------------------

import type { LiveLinkStatus } from "../../shared/api.js";
import { el } from "./dom.js";

export interface LiveLinkChip {
  /** Show / hide the control (shown when a project is open). Re-queries the
   *  current status when shown, so a chip that was hidden while the server
   *  kept running comes back telling the truth. */
  setVisible(on: boolean): void;
  /** Toggle the link on / off (Play > Live Link and the icon click route here). */
  toggle(): void;
}

// A plug glyph: two prongs up, the body, a cord down. Patterpad's markup, since
// the shell's icon table has no connect glyph (yet): two apps, one shape.
const PLUG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6"/><path d="M7 8h10v3a5 5 0 0 1-10 0V8z"/><path d="M12 16v6"/></svg>`;

/** The tooltip, spelling the state out. Patterpad's sentences, with "boxes"
 *  for what it says about flows. */
export function liveLinkTip(s: LiveLinkStatus): string {
  switch (s.state) {
    case "off": return "Live link: off. Click to start listening.";
    case "error": return `Live link error: ${s.message}. Click to retry.`;
    case "listening": return "Live link: listening, waiting for a game. Click to stop.";
    case "connected": {
      const who = s.project !== undefined ? ` to ${s.project}` : "";
      const build = s.build === "stale" ? " (different build; save to re-sync)" : s.build === "match" ? " (in sync)" : "";
      const boxes = s.boxes.length > 0 ? ` Boxes: ${s.boxes.join(", ")}.` : "";
      return `Live link: connected${who}${build}.${boxes} Click to stop.`;
    }
  }
}

/** The chip's colour class for a state: Patterpad's four. */
export function liveLinkClass(s: LiveLinkStatus): "off" | "listening" | "live" | "stale" {
  if (s.state === "off" || s.state === "error") return "off";
  if (s.state === "listening") return "listening";
  return s.build === "stale" ? "stale" : "live";
}

export function mountLiveLinkChip(studio: {
  liveLinkStart(): Promise<LiveLinkStatus>;
  liveLinkStop(): Promise<LiveLinkStatus>;
  liveLinkStatus(): Promise<LiveLinkStatus>;
  onLiveLinkStatus(handler: (status: LiveLinkStatus) => void): void;
}): LiveLinkChip {
  const wrap = el("div", "livelink"); wrap.hidden = true;
  // The chip wears its name: a bottom-corner mystery plug was the audit's
  // last undecodable element, and the word costs almost nothing.
  const word = el("span", "livelink-word"); word.textContent = "Live link";
  const url = el("button", "livelink-url"); url.type = "button"; url.hidden = true;
  const toggle = el("button", "livelink-toggle off"); toggle.type = "button"; toggle.innerHTML = PLUG;
  wrap.append(word, url, toggle);
  document.body.append(wrap);

  let status: LiveLinkStatus = { state: "off" };

  const render = (): void => {
    toggle.className = `livelink-toggle ${liveLinkClass(status)}`;
    toggle.dataset.tip = liveLinkTip(status);
    toggle.setAttribute("aria-label", liveLinkTip(status));
    // The copiable address means something once the server is up.
    if (status.state === "listening" || status.state === "connected") {
      url.textContent = `ws://127.0.0.1:${status.port}`;
      url.dataset.tip = "Click to copy the live link address";
      url.hidden = false;
    } else url.hidden = true;
  };
  const apply = (s: LiveLinkStatus): void => { status = s; render(); };

  toggle.addEventListener("click", () => {
    if (status.state === "off" || status.state === "error") void studio.liveLinkStart().then(apply);
    else void studio.liveLinkStop().then(apply);
  });
  url.addEventListener("click", () => {
    const addr = url.textContent ?? "";
    if (!addr) return;
    void navigator.clipboard.writeText(addr);
    url.classList.add("copied"); setTimeout(() => url.classList.remove("copied"), 1000);
  });
  studio.onLiveLinkStatus(apply);

  return {
    setVisible(on: boolean): void { wrap.hidden = !on; if (on) void studio.liveLinkStatus().then(apply); },
    toggle(): void { toggle.click(); },
  };
}
