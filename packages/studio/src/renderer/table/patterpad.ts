// ---------------------------------------------------------------------------
// Patterpad's Live Link, while the Board plays Patter scenes.
//
// The Board connects to Patterpad (ws://127.0.0.1:4471) as if it were a game: each save there
// pushes the scenes, which the Board applies as it plays (words in place, structure by hot swap),
// and the Board reports the line it is on, so Patterpad's playhead follows. Patter's own client
// (play-helpers `createDebugLink`) connects once, so the Board tries again every few seconds until
// Patterpad answers: it is usually opened after the Board, or not at all. Which socket counts as
// the link is patter-socket.ts's business.
// ---------------------------------------------------------------------------

import { toast } from "@wildwinter/app-shell";
import { createDebugLink } from "@patterkit/play-helpers";
import type { Board } from "./board-state.js";

function linkPatterpad(b: Board): void {
  const s = b.state;
  s.patterLink?.close();
  s.patterLink = undefined;
  s.patterSockets.forget();
  const t = s.table;
  if (!t?.patter || !t.performer) return;
  const link = createDebugLink({
    build: t.patterBuild ?? "", project: s.name, WebSocket: s.patterSockets.Socket,
    onBundle: ({ build, data }) => {
      if (s.table !== t) return;   // the Board rebuilt since: this link is on its way out
      let kind: "text" | "structure" | undefined;
      try { kind = t.applyPatterBundle(data); } catch { return; }
      if (kind === undefined) return;
      s.latestPatterPush = data;
      link.setBuild(build);
      toast(kind === "text" ? "Patter's lines updated from Patterpad" : "Patter's scenes updated from Patterpad", "ok");
      b.render();
    },
  });
  s.patterLink = link;
  t.performer.link = link;
}

/** Keep trying Patterpad while the Board plays Patter scenes; stop when it doesn't. */
export function watchPatterpad(b: Board): void {
  const s = b.state;
  if (s.patterRetry !== undefined) { clearInterval(s.patterRetry); s.patterRetry = undefined; }
  if (!s.table?.patter) { s.patterLink?.close(); s.patterLink = undefined; return; }
  linkPatterpad(b);
  s.patterRetry = setInterval(() => { if (!s.patterSockets.live()) linkPatterpad(b); }, 10_000);
}
