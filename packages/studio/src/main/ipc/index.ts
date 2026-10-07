// ---------------------------------------------------------------------------
// Every handler main registers, domain by domain. The composition root calls
// this once with the real `Ipc`; the contract test calls it with a recording
// one, which is how it knows the whole list without starting Electron.
// ---------------------------------------------------------------------------

import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { registerCards } from "./cards.js";
import { registerComments } from "./comments.js";
import { registerFind } from "./find.js";
import { registerMap } from "./map.js";
import { registerProject } from "./project.js";
import type { ProjectIpcDeps } from "./project.js";
import { registerPublish } from "./publish.js";
import { registerState } from "./state.js";
import type { StateIpcDeps } from "./state.js";
import { registerStructure } from "./structure.js";

/** A domain that keeps state of its own registers itself. */
interface Registers { register(ipc: Ipc): void }

export interface IpcDeps extends MainContext,
  Pick<ProjectIpcDeps, "mayLeaveProject" | "isKnownPath" | "closeProject">, Pick<StateIpcDeps, "setDeckFocused"> {
  /** The stateful domains: the exchange, Live Link, coverage, the launch, the tool windows. */
  hosts: Registers[];
}

export function registerAll(ipc: Ipc, deps: IpcDeps): void {
  registerState(ipc, deps);
  registerProject(ipc, deps);
  registerStructure(ipc, deps);
  registerCards(ipc, deps);
  registerMap(ipc, deps);
  registerComments(ipc, deps);
  registerFind(ipc, deps);
  registerPublish(ipc, deps);
  for (const host of deps.hosts) host.register(ipc);
}
