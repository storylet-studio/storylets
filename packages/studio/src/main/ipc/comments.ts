// ---------------------------------------------------------------------------
// Threaded comments over the bridge, and the Review Feedback walk. What each
// answer reads is read/comments.ts; what each write does is mutate/comments.ts.
// ---------------------------------------------------------------------------

import { deleteCommentMessage, moveComment, postComment, setCommentResolved } from "../mutate/comments.js";
import { commentMarkers, commentsFor, reviewFeedback } from "../read/comments.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";

export function registerComments(ipc: Ipc, deps: Pick<MainContext, "session" | "store">): void {
  const { project } = sessionGuards(deps.session);

  ipc.handle("comments:for", (_event, anchor) => commentsFor(deps.session(), anchor));
  ipc.handle("comments:markers", (_event, canvas) => commentMarkers(deps.session(), canvas));
  ipc.handle("review:feedback", (_event, showResolved) => reviewFeedback(deps.session(), showResolved));

  ipc.write("comments:post", project((open, anchor: string, threadId: string, body: string, mark?: { canvas: string; x: number; y: number }) => {
    // The author comes from the app's identity HERE rather than from the
    // renderer, so every message in a project agrees about who wrote it even if
    // a window has been open since before the name was set.
    const who = deps.store().get().identity?.name?.trim();
    return postComment(open, anchor, threadId, who && who !== "" ? who : "Someone", body, mark);
  }));
  ipc.write("comments:resolve", project(setCommentResolved));
  ipc.write("comments:delete", project(deleteCommentMessage));
  ipc.write("comments:move", project(moveComment));
}
