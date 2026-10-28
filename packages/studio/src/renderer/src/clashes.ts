// ---------------------------------------------------------------------------
// The clash resolver (patterkit hands-on step 6, ruling Q21): the shell's
// dialog and banner (app-shell 0.72), over Storyletter's adapter. Main reads
// the `unresolved` marks a pack merge or a pull left and writes each decision
// as one undoable step (main/clashes.ts); this side opens the dialog, keeps the
// banner's count, and takes each answer as any write's answer is taken, so the
// open page redraws from the fresh project.
//
// The banner is fed from every result main sends (`OpenResult.clashes`): an
// open, a merge, a pull, an undo or redo, and the resolver's own decisions all
// arrive that way, so it's never a beat behind.
// ---------------------------------------------------------------------------

import { clashBanner, openClashResolver } from "@wildwinter/app-shell";
import type { Clash, ClashAdapter, ClashResolver } from "@wildwinter/app-shell";
import type { ClashDto, ClashGoto, ClashesAnswer, OpenResult, StudioApi } from "../../shared/api.js";

export interface ClashesContext {
  studio: Pick<StudioApi, "listClashes" | "resolveClash" | "markClashResolved">;
  /** Is a project open? */
  open: () => boolean;
  /** Land pending edits first: a decision reads the shard off disk. */
  flushSaves: () => Promise<void>;
  /** Take a decision's fresh project, as any write's is taken (renderer.ts `applied`). */
  applied: (r: OpenResult | { error: string }) => boolean;
  /** Show the project as main has just read it again (a write refused because a file changed outside). */
  refreshProject: () => Promise<void>;
  /** Edit: go to the place, and focus it. */
  goTo: (at: ClashGoto) => void;
}

export type Clashes = ReturnType<typeof createClashes>;

export function createClashes(ctx: ClashesContext) {
  /** The last list main sent, by id, for Edit to find its place in. */
  let known = new Map<string, ClashDto>();
  let resolver: ClashResolver | undefined;

  const banner = clashBanner({ onResolve: () => open() });

  const remember = (list: ClashDto[]): Clash[] => {
    known = new Map(list.map((c) => [c.id, c]));
    return list;
  };

  /** A decision's answer: the project taken, the clashes left answered; a refusal thrown, which the dialog shows
   *  in a toast, leaving the clash there. */
  async function take(pending: Promise<ClashesAnswer>): Promise<Clash[]> {
    const answer = await pending;
    if ("error" in answer) {
      // A write refused because the shard changed outside Storyletter: main has read it again, so show that.
      if ((answer as { reread?: true }).reread === true) void ctx.refreshProject();
      throw new Error(answer.error);
    }
    ctx.applied(answer.result);
    return remember(answer.clashes);
  }

  const adapter: ClashAdapter = {
    list: async () => remember(ctx.open() ? await ctx.studio.listClashes() : []),
    resolve: (id, side) => take(ctx.flushSaves().then(() => ctx.studio.resolveClash(id, side))),
    markResolved: (id) => take(ctx.flushSaves().then(() => ctx.studio.markClashResolved(id))),
    edit: (id) => {
      const at = known.get(id)?.goto;
      if (at !== undefined) ctx.goTo(at);
    },
  };

  /** Project ▸ Resolve Clashes…, or the banner's Resolve…. One dialog at a time. */
  function open(): void {
    if (!ctx.open()) return;
    if (resolver?.isOpen() === true) return;
    resolver = openClashResolver({
      adapter,
      onChange: (left) => banner.update(left.length),
      onClose: () => { resolver = undefined; },
    });
  }

  return {
    /** The condition bar, mounted at the top of the workspace. */
    banner: banner.el,
    open,
    /** A result arrived from main: the banner says its count. */
    take: (result: OpenResult) => banner.update(result.clashes ?? 0),
    /** After an undo or redo: the open dialog asks again, since the step may have put a clash back or taken one. */
    refresh: () => { if (resolver?.isOpen() === true) void resolver.refresh(); },
  };
}
