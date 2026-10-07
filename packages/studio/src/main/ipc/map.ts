// ---------------------------------------------------------------------------
// The map over the bridge (#55, the spatial template of play): the project
// map page, a box's map, its zones, pictures and sites. The map is the tag data
// seen from above: zones ARE the tags of a spatial group, sites come from the
// box's map shard.
// ---------------------------------------------------------------------------

import { dialog } from "electron";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  addBackground, boxMap, createZone, editBackground, moveSitesOnMap, projectMapView, removeBackground, removeSitesFromMap,
  restackBackground, restackZone, setBoxColour, setGroupSpatial, setZonePolygon, useProjectMap,
} from "../mutate/map.js";
import { serialised } from "../mutate/write-path.js";
import { mapZoneDetail, projectMaps } from "../read/map.js";
import type { MainContext } from "../context.js";
import type { Ipc } from "./registrar.js";
import { sessionGuards } from "./registrar.js";

export function registerMap(ipc: Ipc, deps: Pick<MainContext, "session" | "editor">): void {
  const { project, read } = sessionGuards(deps.session);

  // In the write queue: drawing a box for the first time stores its colour.
  ipc.write("map:box", (_event, boxId, groupId) => boxMap(deps.session(), boxId, groupId));
  ipc.handle("map:project", () => projectMaps(deps.session()));
  // The project map page (the surfacing review's plan item 2): zones and
  // pictures once, every box on the map a layer. In the write queue for the
  // same reason as `map:box`.
  ipc.write("map:view", () => projectMapView(deps.session()));
  ipc.handle("map:zone", read(mapZoneDetail, null));
  ipc.write("map:use", project((open, boxId: string, on: boolean, confirmed?: boolean) =>
    useProjectMap(open, boxId, on, confirmed === true)));
  ipc.write("map:colour", project(setBoxColour));

  ipc.write("map:setSpatial", project(setGroupSpatial));
  ipc.write("map:createZone", project((open, boxId: string, groupId: string, polygon: { x: number; y: number }[], name?: string) =>
    createZone(open, boxId, groupId, polygon, typeof name === "string" ? name : undefined)));
  ipc.write("map:setPolygon", project(setZonePolygon));
  ipc.write("map:restack", project(restackZone));

  ipc.handle("map:addBackground", async (_event, boxId, groupId, place) => {
    if (!deps.session()) return { error: "no project open" };
    // The picker is the one legitimately native seam (design-language: dialogs
    // themed, pickers OS), same as every other file choice in this app.
    const picked = await dialog.showOpenDialog(deps.editor()!, {
      title: "Add a background",
      message: "A picture of the place, to map the content onto.",
      buttonLabel: "Add",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (picked.canceled || picked.filePaths[0] === undefined) return null;
    const from = picked.filePaths[0];
    let bytes: Buffer;
    try {
      bytes = readFileSync(from);
    } catch (e) {
      return { error: `couldn't read ${basename(from)}: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Into the write queue after the picker, so a dialog left open holds up no
    // other window's saves.
    return serialised(() => {
      const open = deps.session();
      return open ? addBackground(open, boxId, groupId, { name: basename(from), bytes }, place) : { error: "no project open" };
    });
  });
  ipc.write("map:editBackground", project(editBackground));
  ipc.write("map:restackBackground", project(restackBackground));
  ipc.write("map:removeBackground", project(removeBackground));

  ipc.write("map:removeSites", project(removeSitesFromMap));
  ipc.write("map:moveSites", project(moveSitesOnMap));
}
