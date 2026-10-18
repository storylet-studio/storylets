// ---------------------------------------------------------------------------
// Storylet extension values, written: one field on one node, into the
// extension's shard for the node's box (or the project's own, at the root), as
// one undo step per node, so typing into one node's fields coalesces.
// ---------------------------------------------------------------------------

import { planExtensionValue } from "@storylet-studio/ops";
import { commit, refuse } from "./write-path.js";
import type { Written } from "./write-path.js";
import type { ProjectSession } from "../project.js";

export async function setExtensionValue(
  session: ProjectSession, extension: string, nodeId: string, field: string, value: unknown,
): Promise<Written> {
  const source = session.loaded.source;
  if (source === undefined) return refuse(session, "the project did not load");
  const write = planExtensionValue(session.loaded.dir, source, extension, nodeId, field, value);
  if (write === undefined) return refuse(session, `there is nothing with the id ${nodeId} to set a value on`);
  const name = session.dto.extensions?.find((e) => e.id === extension)?.name ?? extension;
  return commit(session, `Edit ${name}`, `ext:${extension}:${nodeId}`, [write]);
}
