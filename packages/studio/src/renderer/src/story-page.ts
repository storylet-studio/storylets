// ---------------------------------------------------------------------------
// The Story document: the project's @story properties as a first-class page
// (the author's ruling, 2026-08-26; the navigator row above the boxes is its
// address). Same list editor as Settings, saving through the save controller
// like every other document. @world stays behind Project Settings because it
// is the other kind of state: a contract with the game, set once by the
// principal designer, not working vocabulary.
// ---------------------------------------------------------------------------

import { el, plural } from "@wildwinter/app-shell";
import { crumbTrail } from "./views.js";
import { mountPropertyList } from "./prop-list.js";
import type { Focus, ViewActions } from "./views.js";
import type { Session } from "./session.js";
import type { OpenResult } from "../../shared/api.js";

export interface StoryPageContext {
  session: Session;
  actions: () => ViewActions;
  /** Is the Story page still the one open? Its contents arrive after a round trip. */
  focus: () => Focus | undefined;
  /** Queue the page's save through the save controller (save-queue.ts). */
  queue: (key: string, run: () => Promise<OpenResult | { error: string }>) => void;
  /** Project Settings, open on a section. */
  openSettings: (section?: string) => void;
}

/**
 * Draw the Story page into `host`. It fills in after a round trip, so the
 * place kept across a redraw of it (`restore`, keep-place.ts) is put back once
 * it has.
 */
export function renderStoryCentre(host: HTMLElement, ctx: StoryPageContext, restore?: () => void): void {
  const { session } = ctx;
  const studio = session.studio;
  host.classList.add("measured");
  const page = el("div", { className: "centre-editor" });
  host.replaceChildren(page);
  void (async () => {
    const dto = await studio.projectSettings();
    if (!dto || ctx.focus()?.kind !== "story" || !page.isConnected) return;
    const actions = ctx.actions();
    const trail = crumbTrail([{ label: session.project?.name ?? "Project", go: () => actions.focus({ kind: "project" }) }]);
    const head = el("div", { className: "master-head" },
      el("div", { className: "doc-head" },
        el("span", { className: "insp-label", text: "Project" }),
        el("h2", { className: "collection-title", text: "Story" }),
        el("p", { className: "master-sub", text: "The story's own memory. Cards read and write it as @story while a run unfolds." })));
    // Through the save controller, as every document saves: its own 400ms
    // debounce was unseen by the indicator, and by Play, Pack and Close, which
    // flush the controller. (The Settings dialog saves on close because it is a
    // dialog; this is a document.)
    const save = (): void => ctx.queue("story", () => studio.saveProjectSettings(dto));
    const list = el("div");
    // "Where do I see everything that reads or writes this?" - answered at
    // the property itself: a quiet uses chip per row, opening Find's property
    // mode. Counts fill in asynchronously (one usage scan per declaration).
    const useBtns = new Map<string, HTMLButtonElement>();
    mountPropertyList(list, dto.story, { onChange: save, sharedByDefault: true, shareScope: "story", rowExtras: (decl) => {
      const b = el("button", { className: "set-uses", text: "uses",
        tip: `Find every read and write of @story.${decl.name}`,
        onClick: () => void studio.openSearch({ mode: "property", query: `@story.${decl.name}` }) });
      if (decl.name) useBtns.set(decl.name, b);
      return b;
    } });
    // ONE call for the whole list. This was a loop awaiting one round trip per
    // property, and each of those recompiled the entire project in main, so a
    // project with forty declared story properties opened this page with forty
    // sequential compiles and the main process blocked throughout. The batch
    // compiles once and answers positionally.
    void (async () => {
      const props = [...useBtns.keys()];
      if (props.length === 0) return;
      const found = await studio.propertyUsageMany(props.map((p) => `@story.${p}`));
      props.forEach((prop, i) => {
        const b = useBtns.get(prop);
        const n = found[i]?.length ?? 0;
        if (b?.isConnected) b.textContent = `${plural(n, "use")}`;
      });
    })();
    const foot = el("p", { className: "set-note" },
      el("span", { text: "Your game’s own state (@world) is a contract the principal designer keeps. It lives in " }),
      el("button", { className: "linklike", text: "Project settings ▸ World", onClick: () => ctx.openSettings("world") }),
      el("span", { text: "." }));
    page.replaceChildren(trail, head, list, foot);
    restore?.();
  })();
}
