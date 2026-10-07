// ---------------------------------------------------------------------------
// What the editor has open, as one object the modules are handed.
//
// The renderer used to keep this as module-level variables beside forty others,
// and every function read whichever it wanted. The composition root
// (renderer.ts) makes one Session and passes it to each module that needs to
// know the project, the server it came from, or the author's remembered app
// state; nothing reaches for it any other way.
// ---------------------------------------------------------------------------

import type { ProjectDto, RemoteDto, StudioApi, StudioState } from "../../shared/api.js";

export interface Session {
  readonly studio: StudioApi;
  /** The open project, or none (the welcome screen). */
  project: ProjectDto | undefined;
  /** Where the open project came from, when it came from a server (9.1). Absent
   *  for an ordinary project, which is what makes every server-shaped thing in
   *  the editor quiet by default. */
  remote: RemoteDto | undefined;
  /** The author's remembered app state (main's store), as last read. */
  state: StudioState;
}

/** The state before main has answered: what boot starts from. */
export const INITIAL_STATE: StudioState = { theme: "system", recents: [], panes: { nav: true, inspector: true }, autoRebuild: false, viewMode: "node", boardPinned: true, boardFollow: false, boardView: "map", searchPinned: true, coveragePinned: true, coverageOrder: "least", linksPinned: true, showResolved: false, reviewWalk: false, coverageOverlay: false };

/**
 * Change a remembered state field, and persist it, in one act.
 *
 * Every one of these was two lines - `state.x = v` and a matching
 * `void studio.setX(v)` - paired by convention and nothing else, in six places
 * across a 2,600-line file. Naming the pairing here makes "change it and
 * forget to save it" a missing table entry rather than a silent bug that only
 * shows up after a restart.
 *
 * Returns the persist promise, for the two callers that wait on it.
 */
export function remember<K extends keyof StudioState>(session: Session, key: K, value: StudioState[K]): Promise<unknown> {
  const studio = session.studio;
  const persist: { [P in keyof StudioState]?: (value: StudioState[P]) => Promise<unknown> } = {
    theme: (v) => studio.setTheme(v),
    viewMode: (v) => studio.setViewMode(v),
    coverageOverlay: (v) => studio.setCoverageOverlay(v),
    reviewWalk: (v) => studio.setReviewWalk(v),
    showResolved: (v) => studio.setShowResolved(v),
    autoRebuild: (v) => studio.setAutoRebuild(v),
  };
  session.state[key] = value;
  const save = persist[key] as ((v: StudioState[K]) => Promise<unknown>) | undefined;
  return save ? save(value) : Promise.resolve();
}
