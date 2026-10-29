// Where a Save dialog's answer actually lands (storylets#5, 2026-10-29).
//
// A Linux report: Export as Storyletpack, Save, and no file. Two Linux habits
// met two of ours. A bare `defaultPath` ("Saltmarsh.storyletpack") opens the
// GTK or portal picker wherever the process was started, not beside the
// project, so the pack landed in a folder nobody looked in; and that picker
// does not add the filter's extension when the author types a name, so it
// could land as plain "Saltmarsh". macOS and Windows hide both. So every save
// starts beside the project folder, and a name with no extension of the
// filter's gets one.

import type { FileFilter } from "electron";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** The suggested path for a delivery: `fileName` beside the project folder,
 *  never inside it (a delivery is not a shard), so every platform's picker
 *  opens there. */
export function besideProject(projectDir: string, fileName: string): string {
  return join(dirname(projectDir), basename(fileName));
}

/** The path the author meant: the picked one, with the first filter's
 *  extension added when the name carries none of the filters' own. */
export function withFilterExtension(picked: string, filters: FileFilter[] | undefined): string {
  const allowed = (filters ?? []).flatMap((f) => f.extensions).filter((e) => e !== "*");
  if (allowed.length === 0) return picked;
  const ext = extname(picked).slice(1).toLowerCase();
  return allowed.some((e) => e.toLowerCase() === ext) ? picked : `${picked}.${allowed[0]}`;
}

/** The picked path made whole, or a refusal when adding the extension would
 *  land on a file the picker never asked to replace (it confirmed the name
 *  the author typed, not the one we made of it). */
export function savePathFor(picked: string, filters: FileFilter[] | undefined): { path: string } | { error: string } {
  const path = withFilterExtension(picked, filters);
  if (path !== picked && existsSync(path)) {
    return { error: `${path} already exists. Save again and choose that name to replace it` };
  }
  return { path };
}
