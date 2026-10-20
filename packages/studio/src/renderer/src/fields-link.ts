// ---------------------------------------------------------------------------
// The editor's half of the Fields window (Pattershot's brief, "a map of records
// edited in a helper window", H1 to H5). The window shows an item's maps of
// records as grids and follows the selection; this side owns the document, so
// it says what to show (after every draw and every version-control poll, sent
// only when it changed) and applies each edit the window makes through the
// page's own save, so it is one undo step as the page's edits are.
// ---------------------------------------------------------------------------

import { fieldsState, followTarget, selectedNodes } from "./fields-state.js";
import type { FieldsNode, FieldsSelection } from "./fields-state.js";
import { commitExtensionValue, extensionOwner } from "./extension-rows.js";
import type { ExtensionHost } from "./extension-rows.js";
import { extensionLockMessage } from "./vc-view.js";
import { extensionVcKey } from "../../shared/api.js";
import type { StudioApi } from "../../shared/api.js";

export interface FieldsLinkContext {
  studio: StudioApi;
  /** The pages' extension host: the project, and the save an edit goes through. */
  host: ExtensionHost;
  /** What the editor has selected. */
  selection(): FieldsSelection;
  /** Who holds an extension shard (`ext:<owner>:<id>`), when somebody else does. */
  lockedBy(key: string): readonly string[] | undefined;
  /** The remembered Follow selection, as the app's state says it (default on). */
  follow(): boolean;
  /** Redraw the open page, which then pushes: an edit from the window changes what the page summarises, and a
   *  save doesn't repaint the open document (it is a live editor, kept as typed). */
  redraw(): void;
}

export interface FieldsLink {
  /** Say what the window should show now (nothing is sent when it hasn't changed). */
  push(): void;
  /** A page's Edit button: show that item in the window, and bring the window forward. */
  openOn(kind: string, id: string): void;
}

export function createFieldsLink(ctx: FieldsLinkContext): FieldsLink {
  /** Following the selection, once the window has said; until then the remembered setting. */
  let follow: boolean | undefined;
  /** The item the window stays on with Follow selection off. */
  let held: FieldsNode | null = null;
  /** The item an Edit button named, shown until the selection moves on. */
  let focus: (FieldsNode & { from: string }) | null = null;
  /** The item last shown, and the state last sent. */
  let shown: FieldsNode | null = null;
  let sent = "";

  const following = (): boolean => follow ?? ctx.follow();
  const selectionKey = (): string => { const s = ctx.selection(); return JSON.stringify([s.focus, s.inspected, s.cursor]); };

  function push(): void {
    const project = ctx.host.project();
    let node: FieldsNode | null;
    const pinned = !following() ? held : focus !== null && focus.from === selectionKey() ? focus : null;
    if (pinned !== null) node = { kind: pinned.kind, id: pinned.id };
    else {
      focus = null;
      node = followTarget(selectedNodes(ctx.selection()), project?.extensions ?? []);
    }
    shown = node;
    const state = fieldsState({
      host: ctx.host, node,
      lock: (extension, n) => {
        const by = ctx.lockedBy(extensionVcKey(extensionOwner(project, n.kind, n.id), extension.id));
        return by?.length ? extensionLockMessage(extension.name, by) : null;
      },
    });
    const sig = JSON.stringify(state);
    if (sig === sent) return;
    sent = sig;
    void ctx.studio.sendFieldsState(state);
  }

  ctx.studio.onFieldsCommit((edit) => {
    commitExtensionValue(ctx.host, edit.extension, edit.nodeId, edit.field, edit.value);
    // Sent again whatever happens: a refused edit changes nothing, and the window then puts its cell back.
    sent = "";
    ctx.redraw();
  });
  ctx.studio.onFieldsFollow((on) => {
    follow = on;
    held = on ? null : shown;
    push();
  });

  return {
    push,
    openOn(kind, id) {
      if (following()) focus = { kind, id, from: selectionKey() };
      else held = { kind, id };
      push();
      void ctx.studio.openFields();
    },
  };
}
