// ---------------------------------------------------------------------------
// The clash resolver over the bridge (step 6, ruling Q21): the list is a read,
// and each decision a write through the one queue. What each does is
// ../clashes.ts.
// ---------------------------------------------------------------------------

import { listClashes, markClashResolved, resolveClash } from "../clashes.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";

export function registerClashes(ipc: Ipc, deps: Pick<MainContext, "session">): void {
  const { project, read } = sessionGuards(deps.session);
  ipc.handle("clashes:list", read((open) => listClashes(open.loaded), []));
  ipc.write("clashes:resolve", project(resolveClash));
  ipc.write("clashes:markResolved", project(markClashResolved));
}
