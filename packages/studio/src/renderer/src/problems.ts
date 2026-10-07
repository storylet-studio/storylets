// ---------------------------------------------------------------------------
// The problems bar, its topbar chip, and where a problem takes you.
//
// Patterpad's one-at-a-time model: the bar shows one problem, with a count and
// a pair of steppers, and stepping navigates (views.ts `renderProblems` says
// why). What is the editor's own lives here: which problem the bar is on, the
// names a problem is spoken in, which page and tab hold the thing it is about,
// and what a quick fix does.
//
// The reading of a problem is pure (`problemNames`, `cardTabFor`,
// `problemTarget`, `problemChip`), so it is tested without a window; the bar
// and the jumps are the half that needs one.
// ---------------------------------------------------------------------------

import { el, iconNode, plural } from "@wildwinter/app-shell";
import { openContextMenu } from "@wildwinter/app-shell/context-menu";
import { baseName } from "./paths.js";
import { boxForPath } from "./problem-copy.js";
import { expandOutcome, setDocTab } from "./inspector.js";
import { renderProblems } from "./views.js";
import { flash, ok, quietly } from "./results.js";
import type { ProblemNames } from "./problem-copy.js";
import type { ViewActions } from "./views.js";
import type { Session } from "./session.js";
import type { BoxDto, OpenResult, Problem, ReviewAt } from "../../shared/api.js";
import { showInPatterpad } from "./show-in-patterpad.js";

type Boxes = readonly BoxDto[];

/** The deck / card / outcome a deck-shard problem names: `where` may be a
 *  bare card ("burner-rig") or card/outcome ("burner-rig/continue") - the
 *  slash form used to fall through to the deck, one hop short. */
export function resolveDeckProblem(p: Problem, box: BoxDto) {
  if (!p.path.endsWith(".storyletdeck")) return undefined;
  const stem = baseName(p.path).replace(/\.storyletdeck$/, "");
  const deck = box.decks.find((d) => d.gameId === stem);
  if (!deck) return undefined;
  const [cardRef, outcomeRef] = (p.where ?? "").split("/");
  const card = cardRef ? deck.cards.find((c) => c.gameId === cardRef) : undefined;
  const outcome = card && outcomeRef ? card.outcomes.find((o) => o.gameId === outcomeRef) : undefined;
  return { deck, card, outcome };
}

/** The problem bar's voice: titles, never storage paths, wherever the project
 *  can resolve them. `title` is the thing the problem is about, which the
 *  sentence names; `where` is the container it sits in (the deck for a card,
 *  the card for an outcome, the box for the rest), which the bar's mono
 *  segment shows. One name each, so nothing here joins a trail. */
export function problemNames(p: Problem, boxes: Boxes): ProblemNames | undefined {
  const box = boxForPath(boxes, p.path);
  if (!box) return p.path.endsWith(".storyletproj") ? { where: "Project settings" } : undefined;
  const boxName = box.title ?? box.gameId;
  const named = resolveDeckProblem(p, box);
  if (named?.card) {
    const cardName = named.card.title ?? named.card.gameId;
    if (named.outcome) return { title: named.outcome.title ?? named.outcome.gameId, where: cardName };
    return { title: cardName, where: named.deck.title ?? named.deck.gameId };
  }
  if (named) return { title: named.deck.title ?? named.deck.gameId, where: boxName };
  if (p.path.endsWith(".storylethands")) {
    const hand = box.hands.find((h) => h.gameId === p.where);
    const template = box.templates.find((t) => t.gameId === p.where);
    return { where: boxName, ...(hand ? { title: hand.title ?? hand.gameId } : template ? { title: template.title ?? template.gameId } : p.where ? { title: p.where } : {}) };
  }
  if (p.path.endsWith(".storylettags")) {
    // `where` is the group, or "group/tag" for a problem on one of its tags.
    const [groupRef, tagRef] = (p.where ?? "").split("/");
    const group = box.tagGroups.find((g) => g.gameId === groupRef);
    if (group && tagRef) return { title: tagRef, where: group.gameId };
    return { where: boxName, ...(group ? { title: group.gameId } : p.where ? { title: p.where } : {}) };
  }
  if (p.path.endsWith(".storyletbox")) return { title: boxName };
  // The box's map shard (compile.ts W2 and W3): the box is what it is about.
  if (p.path.endsWith("/map")) return { title: boxName };
  return undefined;
}

/** Which of a card's tabs holds a given shard field (`Issue.field`). The
 *  compiler names the field; this is the half that knows the editor's own
 *  layout, so the two can change independently. */
export function cardTabFor(field: string | undefined): string | undefined {
  switch (field) {
    case "condition": case "priority": case "copies": case "sharedCopies": case "tags": return "dealing";
    case "fields": return "fields";
    // An outcome's fields are edited inside the outcome, so the box's outcome
    // template sends the author to the Outcomes tab rather than to Fields,
    // which is the CARD's half of the same template.
    case "changes": case "outcomeFields": return "outcomes";
    default: return undefined;
  }
}

/** Where a problem takes the author: the page, and for a card the tab and the
 *  outcome to open. */
export type ProblemTarget =
  | { kind: "card"; box: string; deck: string; card: string; tab?: string; outcome?: string }
  | { kind: "deck"; box: string; deck: string }
  | { kind: "template"; box: string; template: string }
  | { kind: "hand"; box: string; hand: string }
  | { kind: "tagGroup"; box: string; group: string }
  /** A box page on one of its setup tabs, when the item itself is not found. */
  | { kind: "boxTab"; box: string; tab: "templates" | "tags" }
  /** The box page's Card template tab (actions.editBox). */
  | { kind: "boxTemplate"; box: string }
  | { kind: "settings" }
  | { kind: "box"; box: string };

/**
 * Best-effort: from a problem's path + where to the offending entity. A problem
 * in no box falls back to the first box; a project with no boxes has nowhere to go.
 */
export function problemTarget(p: Problem, boxes: Boxes): ProblemTarget | undefined {
  const box = boxForPath(boxes, p.path) ?? boxes[0];
  if (!box) return undefined;
  const named = resolveDeckProblem(p, box);
  if (named) {
    const { deck, card, outcome } = named;
    if (card) {
      // Land INSIDE the problem, not one hop short: the card, the TAB the
      // problem is on, and - when it names an outcome - that outcome expanded.
      //
      // The tab used to move only for an outcome, so every other problem landed
      // on whichever tab was last used: clicking a condition error opened
      // Outcomes and said nothing about why (the author's report, 2026-08-30).
      // The tab now follows `field`, which the compiler raises with the
      // diagnostic rather than the editor reading it back out of the message.
      // An unknown field leaves the sticky tab alone, deliberately: the card's
      // name, gameId and purpose sit ABOVE the tabs and are on every one of
      // them, so moving for those would be motion without an answer.
      const tab = outcome ? "outcomes" : cardTabFor(p.field);
      return { kind: "card", box: box.id, deck: deck.id, card: card.id, ...(tab ? { tab } : {}), ...(outcome ? { outcome: outcome.id } : {}) };
    }
    return { kind: "deck", box: box.id, deck: deck.id };
  }
  if (p.path.endsWith(".storylethands")) {
    const template = p.where ? box.templates.find((t) => t.gameId === p.where) : undefined;
    if (template) return { kind: "template", box: box.id, template: template.id };
    const hand = p.where ? box.hands.find((h) => h.gameId === p.where) : undefined;
    if (hand) return { kind: "hand", box: box.id, hand: hand.id };
    return { kind: "boxTab", box: box.id, tab: "templates" };
  }
  if (p.path.endsWith(".storylettags")) {
    const group = p.where ? box.tagGroups.find((d) => d.gameId === p.where) : undefined;
    if (group) return { kind: "tagGroup", box: box.id, group: group.id };
    return { kind: "boxTab", box: box.id, tab: "tags" };
  }
  if (p.path.endsWith(".storyletbox")) return { kind: "boxTemplate", box: box.id };
  if (p.path.endsWith(".storyletproj")) return { kind: "settings" };
  return { kind: "box", box: box.id };
}

/** The topbar's quiet health chip: a tick when clean, the count when not, in
 *  the worst severity's colour, and a tip saying what a click does. */
export function problemChip(problems: readonly Problem[]): { className: string; count?: number; tip: string } {
  const errs = problems.filter((p) => p.severity === "error").length;
  return {
    className: `probstat ${problems.length === 0 ? "ok" : errs > 0 ? "err" : "warn"}`,
    ...(problems.length > 0 ? { count: problems.length } : {}),
    tip: problems.length === 0 ? "No problems" : `${plural(problems.length, "problem")}. Click to step through them.`,
  };
}

export interface ProblemsContext {
  session: Session;
  actions: () => ViewActions;
  /** Draw the workspace (renderWorkspace). */
  render: () => void;
  applied: (r: OpenResult | { error: string }) => boolean;
  applyResult: (r: OpenResult) => void;
  refreshProject: () => Promise<void>;
  flushSaves: () => Promise<void>;
  /** May an ambient surface move the document now (save-queue.ts)? */
  mayStepAway: () => boolean;
  goTo: (at: ReviewAt) => void;
  /** The project map upgrade's prompt, as the problems bar's button asks it. */
  offerMapUpgrade: (asked: boolean) => Promise<void>;
  /** Project Settings, open on a section. */
  openSettings: (section?: string) => void;
}

export type Problems = ReturnType<typeof createProblems>;

export function createProblems(ctx: ProblemsContext) {
  const { session } = ctx;
  const studio = session.studio;
  let problems: Problem[] = [];
  /** Which problem the bar is showing, Patterpad's one-at-a-time model. */
  let at = 0;
  const bar = el("div", { className: "stepbar problembar" });
  const chip = el("button", { className: "probstat ok" }, iconNode("tick", 12));

  const names = (p: Problem): ProblemNames | undefined => problemNames(p, session.project?.boxes ?? []);

  function renderBar(): void {
    renderProblems(bar, problems, at,
      (next) => {
        at = next;
        renderBar();
        // A2: STEPPING NAVIGATES, reversing a departure this app had argued for.
        //
        // The old reasoning was that a jump here swaps the open document where
        // Patterpad only moves a caret, so stepping should change what the bar
        // says and nothing else. It is true and it was still the wrong call:
        // identical chrome must not mean different things, and a family user
        // pressing the arrow got nothing. This app had already solved the actual
        // problem twice - in the Board and in the review walk - and the answer is
        // that an ambient surface moves the view, never the focus, and never over
        // an uncommitted edit (design-language.md, the ambient-versus-mode rule).
        const landed = problems[next];
        if (landed && ctx.mayStepAway()) jump(landed);
      },
      (p) => jump(p),
      (p, fix, anchor) => applyFix(p, fix, anchor),
      names);
    renderChip();
  }

  function renderChip(): void {
    const state = problemChip(problems);
    chip.className = state.className;
    // The vocabulary's tick, not a hand-typed one. This chip was BUILT with the
    // table's tick and then overwritten with a literal on every update, which is
    // the icon table being bypassed in the file that imports it (design review
    // 2026-08, A9).
    if (state.count === undefined) chip.replaceChildren(iconNode("tick", 12));
    else chip.textContent = String(state.count);
    chip.dataset["tip"] = state.tip;
    chip.setAttribute("aria-label", state.tip);
  }

  // The health chip goes to the FIRST problem, as Patterpad's does: it is a
  // count, so what it promises is "show me them", and a click is the author
  // asking, so it navigates.
  chip.addEventListener("click", () => {
    if (problems.length > 0) { at = 0; renderBar(); void (async () => { await ctx.flushSaves(); jump(problems[0]!); })(); return; }
    // The clean state answers instead of doing nothing: a dead control is
    // how the audit spent three clicks learning what this even was.
    flash(`No problems in ${session.project?.name ?? "this project"}`, "ok");
  });

  /** Go to what a problem is about (problemTarget), through the views' actions. */
  function jump(p: Problem): void {
    const t = problemTarget(p, session.project?.boxes ?? []);
    if (!t) return;
    const actions = ctx.actions();
    switch (t.kind) {
      case "card":
        actions.inspectCard(t.box, t.deck, t.card);
        if (t.tab) {
          setDocTab(`card:${t.deck}/${t.card}`, t.tab);
          if (t.outcome) expandOutcome(t.deck, t.card, t.outcome);
          ctx.render();
        }
        return;
      case "deck": actions.focus({ kind: "deck", box: t.box, deck: t.deck }); return;
      case "template": actions.inspectTemplate(t.box, t.template); return;
      case "hand": actions.inspectHand(t.box, t.hand); return;
      case "tagGroup": actions.inspectTagGroup(t.box, t.group); return;
      case "boxTab": setDocTab(`box:${t.box}`, t.tab); actions.focus({ kind: "box", box: t.box }); return;
      case "boxTemplate": actions.editBox(t.box); return;
      case "settings": actions.openProjectSettings(); return;
      case "box": actions.focus({ kind: "box", box: t.box }); return;
    }
  }

  /** Where a freshly declared property now lives, so the author can retype it. */
  function goToDeclaration(fix: { scope: string; owner: string }): void {
    const actions = ctx.actions();
    if (fix.scope === "story") { actions.focus({ kind: "story" }); return; }
    if (fix.scope === "world") { ctx.openSettings(fix.scope); return; }
    const project = session.project;
    if (!project) return;
    if (fix.scope === "box") {
      actions.focus({ kind: "box", box: fix.owner });
      setDocTab(`box:${fix.owner}`, "properties");
    } else if (fix.scope === "deck") {
      const box = project.boxes.find((b) => b.decks.some((d) => d.id === fix.owner));
      if (!box) return;
      actions.focus({ kind: "deck", box: box.id, deck: fix.owner });
      setDocTab(`deck:${fix.owner}`, "properties");
    }
    ctx.render();
  }

  /**
   * A quick-fix, applied (storyletter.md section 4).
   *
   * Each ends in a re-validate, because the bar's whole job is to be current: a
   * repair that left the problem sitting there until something else refreshed
   * would read as having failed. And each then JUMPS to what was changed, which
   * is the difference between a fix and a silent edit somewhere off-screen.
   */
  function applyFix(_problem: Problem, fix: NonNullable<Problem["fix"]>, anchor: HTMLElement): void {
    if (fix.kind === "declare-property") {
      void (async () => {
        const result = await studio.declareProperty(fix.scope, fix.name, fix.owner,
          fix.declType !== undefined ? { type: fix.declType, default: fix.declDefault! } : undefined);
        if (!ctx.applied(result)) return;
        await ctx.refreshProject();
        // To the DECLARATION, not back to the problem site. The type is READ off
        // the value being written where that is readable (`= true` is a boolean),
        // and falls back to a number where it is not, so the author still lands
        // where they can change it. This is what the button's tooltip promised.
        goToDeclaration(fix);
      })();
      return;
    }
    // The Patter repair just happens, like the declaration: the scene already
    // says what the outcome is called, so there is nothing to ask. Then to the
    // new outcome, open.
    if (fix.kind === "add-outcome") {
      void (async () => {
        const result = await studio.addOutcome(fix.card, fix.gameId);
        if (!ok(result)) return;
        ctx.applyResult(result.result);
        await ctx.refreshProject();
        ctx.goTo({ kind: "outcome", box: result.box, deck: result.deck, card: fix.card, outcome: result.outcome });
      })();
      return;
    }
    // The stub scene: written into the Patter project, then opened in Patterpad
    // for the writing. Patter publishes it; until then the problem becomes a
    // reminder to. Whether Patterpad opened is said in passing, never as an error.
    if (fix.kind === "create-scene") {
      void (async () => {
        const made = await studio.createPatterScene(fix.card);
        if (!ok(made)) return;
        await ctx.refreshProject();
        const opened = await showInPatterpad(studio, fix.card);
        const tail = opened !== null && ok(opened, quietly) ? " Opening it in Patterpad." : "";
        flash(`Created the scene “${made.address}” in the Patter project.${tail} Publish it from Patterpad to play it.`, "ok");
      })();
      return;
    }
    // A project from before the project map: the same prompt it opened with,
    // which says what will change before anything does (the ellipsis promised it).
    if (fix.kind === "upgrade-project") { void ctx.offerMapUpgrade(true); return; }
    // The tag repair ASKS, because there is no single right answer: the group
    // has several tags and only the author knows which was meant. The ellipsis
    // on the button already promised this.
    const rect = anchor.getBoundingClientRect();
    openContextMenu(rect.left, rect.top, fix.options.map((option) => ({
      label: option.label,
      onClick: () => void (async () => {
        const result = await studio.repointTag(fix.holder, fix.group, fix.bad, option.id);
        if (!ctx.applied(result)) return;
        await ctx.refreshProject();
      })(),
    })));
  }

  return {
    bar,
    chip,
    /** The problems as last validated. */
    get list(): readonly Problem[] { return problems; },
    /**
     * Take a validation's problems. Stay on the same problem where that still
     * makes sense; a shorter list clamps rather than jumping to the start. The
     * bar is painted here, because taking the new list and leaving the old one
     * on screen is the same bug written twenty times.
     */
    take(next: Problem[]): void {
      problems = next;
      at = Math.min(at, Math.max(0, problems.length - 1));
      renderBar();
    },
    /** A different project's problems, from its first. Not painted: the
     *  workspace render that follows does that. */
    reset(next: Problem[]): void {
      problems = next;
      at = 0;
    },
    renderBar,
    jump,
    goToDeclaration,
  };
}
