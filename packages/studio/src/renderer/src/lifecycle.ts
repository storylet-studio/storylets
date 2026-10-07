// ---------------------------------------------------------------------------
// A project arrives, changes under us, or goes; and the welcome screen that is
// showing when none is open.
//
// `adopt` is the one way a project becomes the open one (opened, created,
// unpacked, connected, or handed over by the OS), and `closeProject` the one
// way it stops being. Between them, the project changes on disk (a revalidate
// on window focus, a merge, a quick fix) and the open page has to keep its
// place, or fall back up the tree when its document has gone.
// ---------------------------------------------------------------------------

import { mountWelcome } from "@wildwinter/app-shell";
import { forgetBoxColours, setBoxColours } from "./box-tint.js";
import { baseName } from "./paths.js";
import { setCanvasProject } from "./canvas-memory.js";
import { askMapUpgrade } from "./map-upgrade-dialog.js";
import { resetDocTabMemory } from "./inspector.js";
import { setCameFrom } from "./views.js";
import { setPlayRung } from "./play-ladder.js";
import { setGameScopes } from "./expr-panels.js";
import { flash, ok } from "./results.js";
import { placeUsable } from "./navigation.js";
import { EXAMPLE_KITS, PROJECT_KITS, openNewProject } from "./kits.js";
import type { ProjectStart } from "./kits.js";
import type { Navigation } from "./navigation.js";
import type { SaveQueue } from "./save-queue.js";
import type { Comments } from "./comments.js";
import type { Problems } from "./problems.js";
import type { VcView } from "./vc-view.js";
import type { Catalogues } from "./catalogues.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import type { OpenResult } from "../../shared/api.js";

export interface LifecycleContext {
  session: Session;
  nav: Navigation;
  saves: SaveQueue;
  comments: Comments;
  problems: Problems;
  vc: VcView;
  catalogues: Catalogues;
  actions: () => ViewActions;
  applyResult: (r: OpenResult) => void;
  applied: (r: OpenResult | { error: string }) => boolean;
  /** Draw the workspace, the navigator, the centre (renderer.ts). */
  render: () => void;
  renderNavPane: () => void;
  renderCentre: () => void;
  /** The welcome screen's host, and which of it and the workspace shows. */
  welcomeHost: HTMLElement;
  showWorkspace: (on: boolean) => void;
  /** Reveal the window, once (renderer.ts). */
  signalReady: () => void;
  tellDeckFocused: (on: boolean) => void;
  /** Live Link's chip: shown (re-reading its status) or hidden. */
  liveLink: (on: boolean) => void;
  /** Re-read the coverage overlay for the project now open. */
  gatherCoverage: () => Promise<void>;
}

export type Lifecycle = ReturnType<typeof createLifecycle>;

export function createLifecycle(ctx: LifecycleContext) {
  const { session, nav, saves, comments, problems, vc, catalogues } = ctx;
  const studio = session.studio;
  /** The welcome screen's error line: the last open that failed, until the next. */
  let welcomeError = "";

  // --- welcome -----------------------------------------------------------------
  //
  // Three jobs, kept apart (2026-08-29, the author: "a sea of text", and "some
  // separation between the various functions of that entrypoint page"). They are
  // START (open or make one), LEARN (the shipped examples) and RETURN (recents),
  // and before this pass they were one centred column of eleven stacked things
  // with a theme picker on the end.
  //
  // The drawing is the shell's `mountWelcome` since the 2026-09 review: a CARD
  // centred in the space the panes would take, a title, one sub, two
  // dialog-opening buttons, captioned groups of rows, and recents as two-line
  // items. What stays here is the words and the three shipped examples.
  //
  // Two things came OFF, both duplicates rather than losses:
  //   - the theme row: five buttons of app settings, on the first screen, and
  //     already in the menu (as they are in Patterpad, which has no theme control
  //     on its welcome at all)
  //   - the inline name box: it called createProject DIRECTLY, so the welcome's
  //     Create was the one New Project path that never saw the kit picker. With
  //     project kits arriving that would have been the path that silently offered
  //     none of them. Now both routes are New Project's.

  /** New Project: the kit gallery, on `initial` when a welcome tile chose one. */
  function newProject(initial?: ProjectStart): void {
    openNewProject(initial, {
      openExample: (file) => void adopt(studio.openExample(file)),
      create: (name, kit) => void adopt(studio.createProject(name, kit)),
    });
  }

  function renderWelcome(): void {
    ctx.signalReady();   // the welcome screen is up: safe to reveal the window
    ctx.tellDeckFocused(false);
    ctx.liveLink(false);   // Live Link: no project, no control
    // THREE JOBS, kept apart (2026-08-29): START, LEARN, RETURN. Since the kit
    // gallery brief (section 6, 2026-09-27) the first two are the gallery's own
    // tiles, so the welcome shows what the app is FOR before anything is chosen:
    // the game kits to start from, and the worked examples to learn from (a kit
    // gives you a starting shape; an example shows you a finished one, and the
    // concepts are learned from the finished one). A tile opens New Project on
    // that choice, so its full description and its button are one click on,
    // never a surprise. The screen is the shell's (welcome.ts); what is ours is
    // the words and what each click does.
    ctx.showWorkspace(false);
    mountWelcome(ctx.welcomeHost, {
      title: "Storyletter",
      sub: "Which story beat happens next? Open a project and deal a hand.",
      actions: [
        { label: "Open a project…", primary: true, onClick: () => void adopt(studio.openProjectDialog()) },
        { label: "New project…", onClick: () => newProject() },
      ],
      groups: [
        { caption: "Start from a kit", tiles: true,
          items: PROJECT_KITS.map((k) => ({ name: k.name, hint: k.tile ?? k.blurb, ...(k.features ? { features: k.features } : {}), onOpen: () => newProject(k.id) })) },
        // An example is never opened in place (it lives inside the installed app,
        // which is read-only and replaced by the next update), so opening one asks
        // for a folder. Say so BEFORE the click.
        { caption: "Learn from a finished project", note: "Each opens as your own copy, in a folder you choose.", tiles: true,
          items: EXAMPLE_KITS.map((k) => ({ name: k.name, hint: k.tile ?? k.blurb, ...(k.features ? { features: k.features } : {}), ...(k.badge !== undefined ? { badge: k.badge } : {}), onOpen: () => newProject(k.id) })) },
      ],
      // What the project CALLS itself, with the folder stem as the fallback for
      // an entry recorded before names were stored (app-shell 0.25.0). The path
      // stays beside it: two projects may legitimately share a name, and the
      // folder is how you tell them apart.
      // The store keeps eight and the File menu shows eight; so does this.
      maxRecents: 8,
      recents: session.state.recents.map((recent) => ({
        name: recent.name ?? baseName(recent.path).replace(/\.storylets$/, ""),
        path: recent.path,
        onOpen: () => void adopt(studio.openProjectPath(recent.path)),
      })),
      ...(welcomeError ? { error: welcomeError } : {}),
    });
  }

  /** Close Project: flush what's pending, tell main (which tears the session
   *  down and closes the tool windows), then return this window to the welcome
   *  screen - the same no-project rendering boot uses. */
  async function closeProject(): Promise<void> {
    await saves.flush();
    // False when the author was asked about unpushed edits and said no.
    if (!(await studio.closeProject())) return;
    session.project = undefined;
    session.remote = undefined;
    nav.focus = undefined;
    nav.inspected = undefined;
    nav.detail = undefined;
    nav.clearHistory();
    catalogues.forgetDeck();
    setCameFrom(undefined);
    ctx.liveLink(false);
    vc.clear();
    session.state = await studio.getState();   // recents may have changed; welcome reads them
    welcomeError = "";
    renderWelcome();
  }

  /** File ▸ Open Recent ▸ Clear Recents: the list empties in the store and the
   *  menu (main), and on the welcome screen if that is what is showing. */
  async function clearRecents(): Promise<void> {
    await studio.clearRecents();
    session.state = await studio.getState();
    if (!session.project) renderWelcome();
  }

  /** Take a project main has opened (or say on the welcome screen why it could
   *  not), and land on the page it was last left on. */
  async function adopt(pending: Promise<OpenResult | { error: string } | null>): Promise<void> {
    const result = await pending;
    if (result === null) return;
    if (!ok(result, (error) => { welcomeError = error; })) {
      session.project = undefined; vc.clear(); session.state = await studio.getState(); renderWelcome(); return;
    }
    welcomeError = "";
    // A different project is a different sitting: tab choices do not carry over,
    // and NEITHER DOES ANY SERVER CHROME (2026-09-07). The status and the server's
    // own problems belong to the project being left, so they go before the new
    // one's are read rather than being overwritten a line at a time.
    if (session.project !== undefined && session.project.dir !== result.project.dir) {
      resetDocTabMemory();
      forgetBoxColours();
      nav.clearHistory();
      session.remote = undefined;
      problems.reset([]);
    }
    session.project = result.project;
    // Cameras and the picture cache are scoped by project: two projects' ids are
    // not two places, and their pictures can share a file name.
    setCanvasProject(result.project.dir);
    setBoxColours(result.project.boxes);
    session.remote = result.remote;
    setGameScopes(result.project.gameScopes);
    setPlayRung(result.project.play);
    problems.reset(result.problems);
    ctx.liveLink(true);   // Live Link: the control is available once a project is open
    session.state = await studio.getState();
    nav.expanded = new Set(session.state.navExpanded ?? []);
    // A remembered walk comes back with the project, not with the app: its list is
    // this project's comments.
    comments.restartReview();
    void ctx.gatherCoverage();
    const restored = nav.restoredPlace();
    const focus = restored?.focus ?? nav.defaultFocus();
    nav.focus = focus;
    nav.inspected = restored
      ? restored.inspected
      : focus && focus.kind === "deck" ? { kind: "deck", box: focus.box, deck: focus.deck }
      : focus && focus.kind === "box" ? { kind: "box", box: focus.box } : undefined;
    vc.clear();
    ctx.render();
    // A restored setup document has to fetch its detail, as the action that opened
    // it did: without this a hand reopened to its box's Hands list (found checking
    // the hand page's restore, 2026-10-01).
    nav.loadDetail();
    // A `--at` launch: the item named on the command line, over the remembered place.
    if (result.at) nav.goTo(result.at);
    void vc.refresh();   // badge the shards + apply read-only from the VC snapshot
    // A project from before the project map is asked about once, as it opens:
    // otherwise it opens on errors and a map that has vanished.
    void offerMapUpgrade(false);
  }

  /**
   * Upgrade a project from before the project map (main `map-upgrade.ts`): the
   * planner `storyletengine format` runs, shown first, refused in its own
   * sentences, one undo step when it runs. `asked` is the problems bar's button,
   * which deserves an answer even when there turns out to be nothing to do.
   */
  async function offerMapUpgrade(asked: boolean): Promise<void> {
    if (!session.project) return;
    await saves.flush();
    const plan = await studio.planMapUpgrade();
    if (plan === null) {
      if (asked) { flash("This project is already on the project map.", "ok"); await refreshProject(); }
      return;
    }
    if (!(await askMapUpgrade(plan))) return;
    const result = await studio.upgradeProjectMap();
    if ("refused" in result) { await askMapUpgrade({ report: [], warnings: [], refusals: result.refused }); return; }
    if (!ctx.applied(result)) return;
    repaintReplacedProject();
    void vc.refresh();
    flash("Moved the map to the project", "ok");
    // To the map, which is the thing that had vanished.
    if (session.project?.map !== undefined) ctx.actions().focus({ kind: "map" });
  }

  /**
   * Take the project as it now stands, after an action that changed it (a quick
   * fix, a Replace, a publish that pinned addresses): re-read from disk when a
   * file changed there, and otherwise the session's own project, since main's
   * re-read answers null whenever the disk matches what it last read, which is
   * exactly the case after a write that went through main. The window-focus path
   * (onWindowFocus) is the one that takes null as "nothing to do".
   */
  async function refreshProject(): Promise<void> {
    if (!session.project) return;
    const result = (await studio.revalidate()) ?? (await studio.project());
    if (!result) return;   // no project open after all
    ctx.applyResult(result);
    repaintReplacedProject();
    void vc.refresh();
  }

  /**
   * What the open document is drawn from, as one string: compared across a
   * re-read, so the document is redrawn only when its own data changed. The
   * whole box for a box page or its masters (Contents draws every card), the
   * item itself for a card or a setup document, the project's boxes for the
   * project page, and the map for the map.
   */
  function openDocData(): string {
    const project = session.project;
    if (!project) return "";
    const box = nav.currentBox();
    const ins = nav.inspected;
    if (ins?.kind === "card") return JSON.stringify(box?.decks.find((d) => d.id === ins.deck)?.cards.find((c) => c.id === ins.card));
    if (ins?.kind === "template") return JSON.stringify(box?.templates.find((t) => t.id === ins.template));
    if (ins?.kind === "hand") return JSON.stringify(box?.hands.find((x) => x.id === ins.hand));
    if (ins?.kind === "tagGroup") return JSON.stringify(box?.tagGroups.find((g) => g.id === ins.group));
    const f = nav.focus;
    if (f?.kind === "deck") return JSON.stringify(box?.decks.find((d) => d.id === f.deck));
    if (f?.kind === "box" || f?.kind === "decks" || f?.kind === "hands") return JSON.stringify(box);
    if (f?.kind === "map") return JSON.stringify([project.map, project.boxes.map((b) => [b.id, b.usesMap, b.hands.length])]);
    if (f?.kind === "story") return String(project.storyPropertyCount);
    return JSON.stringify(project.boxes.map((b) => [b.id, b.title, b.gameId, b.decks.length, b.hands.length]));
  }

  /**
   * The window came back to the front. Patterpad refreshes version-control
   * status here and nothing else; this also re-reads the project, because files
   * are the truth and a VCS update or a hand edit lands while the window is away.
   * But QUIETLY: nothing repaints when nothing changed on disk, the navigator and
   * the problems bar repaint when something did, and the open document is
   * redrawn only when its own data changed, so an alt-tab never takes the caret,
   * the scroll or a canvas's camera (the October 2026 review, finding 3).
   */
  async function onWindowFocus(): Promise<void> {
    if (!session.project) return;
    void vc.refresh();
    const before = openDocData();
    const result = await studio.revalidate();
    if (!result || !session.project) return;
    ctx.applyResult(result);   // the problems bar, the lead
    // The open document went with a merge or an update: fall back up the tree.
    const place = nav.capturePlace();
    const focus = nav.focus;
    if (!focus || (focus.box !== undefined && !nav.currentBox()) || (place !== undefined && !placeUsable(session.project, place))) {
      repaintReplacedProject();
      return;
    }
    ctx.renderNavPane();
    if (openDocData() === before) return;
    // A setup document draws from its detail, which is fetched rather than sent.
    if (!nav.loadDetail()) ctx.renderCentre();
  }

  /**
   * Repaint everything after a project arrives that may differ in SHAPE from the
   * one on screen: a revalidate, or a merged pack, either of which can rename,
   * add or remove boxes, decks and cards. `applyResult` repaints the lead and the
   * problems bar and leaves the rest to its caller, which is right for a keystroke
   * and wrong for these: a merge left the navigation on its pre-merge names until
   * the window next regained focus (the Patter side's brief after patter #73,
   * confirmed live 2026-09-15).
   *
   * Falls back only when the focus POINTS INTO a box that no longer resolves.
   * The project page and the Story document carry no box, and treating that as
   * dangling threw the author onto the first deck on every window focus, which
   * is what made the Story restore look flaky: boot restored it, and the first
   * revalidate stomped it (reported 2026-08-27).
   */
  function repaintReplacedProject(): void {
    const place = nav.capturePlace();
    const box = nav.currentBox();
    const focus = nav.focus;
    if (!focus || (focus.box !== undefined && !box)) {
      nav.focus = nav.defaultFocus();
      const f = nav.focus;
      nav.inspected = f?.kind === "deck" ? { kind: "deck", box: f.box, deck: f.deck } : f?.kind === "box" ? { kind: "box", box: f.box } : undefined;
      nav.detail = undefined;
    } else if (box && place && !placeUsable(session.project, place)) {
      // The box is still there but the open document is not: its container.
      if (focus.kind === "deck" && box.decks.some((d) => d.id === focus.deck)) nav.inspected = { kind: "deck", box: box.id, deck: focus.deck };
      else if (focus.kind === "deck") { nav.focus = { kind: "box", box: box.id }; nav.inspected = { kind: "box", box: box.id }; }
      else nav.inspected = focus.kind === "box" ? { kind: "box", box: box.id } : undefined;
      nav.detail = undefined;
    }
    ctx.render();
  }

  return {
    adopt, closeProject, clearRecents, offerMapUpgrade, refreshProject, onWindowFocus, repaintReplacedProject,
    renderWelcome, newProject,
  };
}
