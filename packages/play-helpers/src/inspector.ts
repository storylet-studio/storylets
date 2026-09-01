// ---------------------------------------------------------------------------
// The property examiner/editor, JS idiom: a self-styled DOM panel (the
// parity member Unity renders as an EditorWindow, Unreal as a Slate tab,
// Godot as an in-game panel). Rows come from live().listProperties() and
// are built once (declared properties are fixed for a bundle); values
// refresh on a poll that SKIPS the focused widget; every row has a
// reset-to-default that disables itself at the default. Edits commit via
// flow.setProperty, which is a silent host write under the firing rule.
// Save state / Load state carry the whole run over the .storyletsave string
// boundary (save.ts); a filter narrows the property rows; the read-only
// turns and board sections mirror the engine examiners (design 2.4).
// The JS game runs in-process, so the engine and a flow are passed directly
// (no debug registry needed here).
//
// The log panel (design 2.3: the flow's retained log surfaced in every
// examiner; the old port's Unreal log panel is the high-water mark): the
// lines of live().log() behind per-kind filters (a peek files under Deal -
// both are asks), with Autoscroll, Copy and Clear. Empty until the engine
// is created with the log option.
// ---------------------------------------------------------------------------
/// <reference lib="dom" />

import type { Engine, EngineLogEntry, Flow, LogEntry, PropertyRow } from "@storylet-studio/runtime";
import type { ScalarValue } from "@storylet-studio/model";
import { serializeState, deserializeState } from "./save.js";

export interface PropertyInspectorOptions {
  /** Mount point; defaults to document.body. */
  container?: HTMLElement;
  title?: string;
  /** Value-refresh poll; 0 disables polling. */
  pollMs?: number;
}

export interface PropertyInspector {
  el: HTMLElement;
  refresh(): void;
  destroy(): void;
}

const STYLE_ID = "sl-inspector-style";
const CSS = `
.sl-insp { font: 12px system-ui, sans-serif; color: var(--ink, #222); background: var(--surface, #fafafa);
  border: 1px solid var(--line, #ccc); border-radius: 8px; padding: 10px 12px; max-width: 26rem; }
.sl-insp h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted, #666); }
.sl-insp .sl-head { display: flex; align-items: baseline; gap: 6px; }
.sl-insp .sl-head h3 { flex: 1; }
.sl-insp .sl-save, .sl-insp .sl-load { font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.sl-insp .sl-filter { display: block; width: 100%; box-sizing: border-box; margin: 0 0 6px; }
.sl-insp .sl-group { margin: 8px 0 2px; font-weight: 600; font-size: 11px; color: var(--muted, #666); }
.sl-insp .sl-section { margin: 10px 0 2px; font-weight: 600; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted, #666); }
.sl-insp .sl-line { padding: 1px 0; }
.sl-insp .sl-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.sl-insp .sl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-insp input[type="text"], .sl-insp input[type="number"], .sl-insp select {
  font: inherit; width: 9rem; padding: 1px 4px; }
.sl-insp .sl-reset { border: 0; background: none; cursor: pointer; color: var(--muted, #666); }
.sl-insp .sl-reset:disabled { opacity: 0.3; cursor: default; }
.sl-insp .sl-logbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 0; }
.sl-insp .sl-logbar label { display: inline-flex; align-items: center; gap: 2px; }
.sl-insp .sl-logbar button { font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.sl-insp .sl-log { font-family: ui-monospace, monospace; font-size: 11px; max-height: 12rem;
  overflow: auto; white-space: pre; border: 1px solid var(--line, #ccc); padding: 4px 6px; }
.sl-insp details.sl-fold > summary { cursor: pointer; margin: 10px 0 2px; font-weight: 600;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #666); }
.sl-insp .sl-ident { font-family: ui-monospace, monospace; font-size: 11px; }
.sl-insp .sl-ident b { font-weight: 600; }
.sl-insp .sl-note { color: var(--muted, #666); }
`;

/** Inject the shared panel stylesheet once. Exported so the bundle inspector
 *  (bundle-inspector.ts) renders in the same CSS grammar. */
export function ensureInspectorStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const eq = (a: ScalarValue | undefined, b: ScalarValue | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// --- the log panel (design 2.3) ---------------------------------------------

/** The filterable kinds; a peek files under "deal" (both are asks). */
const LOG_KINDS = ["deal", "play", "write", "evict", "turns", "diagnostic"] as const;
const LOG_KIND_LABELS: Record<(typeof LOG_KINDS)[number], string> = {
  deal: "Deal", play: "Play", write: "Write", evict: "Evict", turns: "Turns", diagnostic: "Diag",
};

const logKindOf = (e: LogEntry): (typeof LOG_KINDS)[number] =>
  e.type === "peek" ? "deal" : e.type;

const showVal = (v: ScalarValue | undefined): string =>
  v === undefined ? "<unset>" : JSON.stringify(v);

/** One line per entry, `[turn]`-stamped where the event has a box context
 *  (write lines share the state logger's `path: from -> to` reading). */
export function formatLogEntry(e: LogEntry | EngineLogEntry): string {
  // The run's log names the flow that acted, after the turn stamp and in the
  // same place all four examiners put it; a flow's own log omits it, because
  // its section heading already says whose it is.
  return formatLogBody(e, "flow" in e && e.flow ? `${e.flow} ` : "");
}

function formatLogBody(e: LogEntry, flow: string): string {
  const stamp = (e.turn !== undefined ? `[${e.turn}] ` : "[-] ") + flow;
  switch (e.type) {
    case "deal": {
      const dealt = e.cards.filter((c) => c.verdict === "dealt").map((c) => c.id);
      return `${stamp}deal ${e.hand}: ${dealt.length > 0 ? dealt.join(", ") : "(none)"} (${e.cards.length} considered)`;
    }
    case "peek": {
      const crit = Object.entries(e.criteria).map(([g, t]) => `${g}=${t}`).join(", ");
      const listed = e.cards.filter((c) => c.verdict === "dealt").map((c) => c.id);
      return `${stamp}peek ${e.box}${crit ? ` [${crit}]` : ""}: `
        + `${listed.length > 0 ? listed.join(", ") : "(none)"} (${e.cards.length} considered)`;
    }
    case "evict": return `${stamp}evict ${e.card} from ${e.hand} (${e.reason})`;
    case "play": return `${stamp}play ${e.card} -> ${e.outcome}`;
    case "write": return `${stamp}write ${e.path}: ${showVal(e.prev)} -> ${showVal(e.value)}`;
    case "turns": return `${stamp}turns ${e.box} -> ${e.turn}`;
    default: return `${stamp}diagnostic ${e.where}: ${e.message}`;
  }
}

/** The group label a row files under ("world", "story", "box <id>", ...). */
const groupOf = (path: string): string => {
  const parts = path.split(".");
  return parts.length === 3 ? `${parts[0]} ${parts[1]}` : parts[0]!;
};

export function createPropertyInspector(engine: Engine, flow: Flow, opts: PropertyInspectorOptions = {}): PropertyInspector {
  ensureInspectorStyle();

  // loadGame rebuilds every flow and the handle we were given goes inert
  // (the runtime's stale-handle rule), so every read goes through this
  // accessor and Load state re-takes the same-named flow.
  let liveFlow = flow;
  const live = (): Flow => liveFlow;

  const el = document.createElement("div");
  el.className = "sl-insp";

  // Header: the title plus Save state / Load state (the .storyletsave
  // string boundary, in every examiner - the parity rule, design 2.4).
  const head = document.createElement("div");
  head.className = "sl-head";
  const h = document.createElement("h3");
  h.textContent = opts.title ?? "Runtime state";
  head.append(h);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "sl-save";
  saveBtn.textContent = "Save state";
  saveBtn.addEventListener("click", () => {
    const blob = new Blob([serializeState(engine)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "save.storyletsave";
    a.click();
    URL.revokeObjectURL(url);
  });
  head.append(saveBtn);

  const filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.accept = ".storyletsave,application/json";
  filePicker.hidden = true;
  filePicker.addEventListener("change", () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // A foreign or malformed blob is refused by deserializeState, never applied.
      try {
        deserializeState(engine, String(reader.result));
        liveFlow = engine.getFlow(flow.id) ?? engine.openFlow(flow.id);
        refresh();
      } catch (e) {
        console.error("storylets inspector: load failed:", e instanceof Error ? e.message : e);
      }
      filePicker.value = "";
    };
    reader.readAsText(file);
  });

  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.className = "sl-load";
  loadBtn.textContent = "Load state";
  loadBtn.addEventListener("click", () => filePicker.click());
  head.append(loadBtn, filePicker);
  el.append(head);

  // The property filter (name/path substring, case-blind - the parity
  // member Unreal renders as an SSearchBox).
  const filter = document.createElement("input");
  filter.type = "text";
  filter.className = "sl-filter";
  filter.placeholder = "Filter properties";
  el.append(filter);

  // Rows are built once: the declared surface is fixed for a bundle. The
  // filter only toggles visibility (a group hides with its last row).
  const editors: { row: PropertyRow; read: () => void }[] = [];
  const groups: { el: HTMLElement; rows: { el: HTMLElement; text: string }[] }[] = [];
  let lastGroup = "";
  for (const row of live().listProperties()) {
    const group = groupOf(row.path);
    if (group !== lastGroup) {
      const g = document.createElement("div");
      g.className = "sl-group";
      g.textContent = group;
      el.append(g);
      groups.push({ el: g, rows: [] });
      lastGroup = group;
    }
    const rowEl = buildRow(live, row, editors);
    groups[groups.length - 1]!.rows.push({ el: rowEl, text: `${row.name} ${row.path}`.toLowerCase() });
    el.append(rowEl);
  }

  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (const group of groups) {
      let any = false;
      for (const row of group.rows) {
        const show = q === "" || row.text.includes(q);
        row.el.style.display = show ? "" : "none";
        any = any || show;
      }
      group.el.style.display = any ? "" : "none";
    }
  });

  // Read-only: each box's clock, then the board's current hands (title or
  // gameId, never internal ids) - the same sections as the engine examiners.
  const turnsHead = document.createElement("div");
  turnsHead.className = "sl-section";
  turnsHead.textContent = "Turns (per box)";
  const turnsBody = document.createElement("div");
  turnsBody.className = "sl-turns";
  const boardHead = document.createElement("div");
  boardHead.className = "sl-section";
  boardHead.textContent = "Board";
  const boardBody = document.createElement("div");
  boardBody.className = "sl-board";
  el.append(turnsHead, turnsBody, boardHead, boardBody);

  // A retained log (design 2.3), behind per-kind filters, with Autoscroll,
  // Copy and Clear - the JS rendering of the engine examiners' log panel.
  // Built twice: once for the RUN (every flow's events in one order, each line
  // naming its flow) and once for this flow's own. Both exist because a flow's
  // log cannot show a story action in another flow moving shared state
  // (design/shared-scarcity.md 8.2). Empty until the engine had the log option.
  const check = (text: string, onChange: (on: boolean) => void, cls: string): HTMLLabelElement => {
    const label = document.createElement("label");
    label.className = cls;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => onChange(box.checked));
    label.append(box, text);
    return label;
  };

  interface LogPanel { render: (force?: boolean) => void }
  const buildLogPanel = (
    which: "flow" | "run",
    caption: string,
    entriesOf: () => readonly (LogEntry | EngineLogEntry)[],
    clear: () => void,
    empty: string,
  ): LogPanel => {
    // Both panels carry the same controls, so each element takes a `sl-flow` /
    // `sl-run` modifier: without one, a selector for "the Clear button" is
    // ambiguous, which is exactly what the inspector test caught.
    const head = document.createElement("div");
    head.className = `sl-section sl-${which}`;
    head.textContent = caption;
    const bar = document.createElement("div");
    bar.className = `sl-logbar sl-${which}`;
    const body = document.createElement("div");
    body.className = `sl-log sl-${which}`;

    const kindOn = new Map<string, boolean>();
    const visibleLines = (): string[] =>
      entriesOf().filter((e) => kindOn.get(logKindOf(e)) !== false).map(formatLogEntry);
    let autoscroll = true;
    let stampSeen = "";
    const render = (force = false): void => {
      const entries = entriesOf();
      const stamp = `${entries.length}:${entries.length > 0 ? entries[entries.length - 1]!.seq : -1}`;
      if (!force && stamp === stampSeen) return;
      stampSeen = stamp;
      const lines = visibleLines();
      body.textContent = lines.length > 0 ? lines.join("\n") : empty;
      if (autoscroll) body.scrollTop = body.scrollHeight;
    };

    for (const kind of LOG_KINDS) {
      kindOn.set(kind, true);
      bar.append(check(LOG_KIND_LABELS[kind], (on) => {
        kindOn.set(kind, on);
        render(true);
      }, "sl-logkind"));
    }
    bar.append(check("Autoscroll", (on) => { autoscroll = on; }, "sl-logscroll"));
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "sl-logcopy";
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy the visible (filtered) log to the clipboard";
    copyBtn.addEventListener("click", () => { void navigator.clipboard?.writeText(visibleLines().join("\n")); });
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "sl-logclear";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Drop the retained log entries (cosmetic - no game state changes)";
    clearBtn.addEventListener("click", () => { clear(); render(true); });
    bar.append(copyBtn, clearBtn);
    el.append(head, bar, body);
    return { render };
  };

  // This flow's own log first: it is what the panel was mounted on. The run's
  // log follows, because it is the wider view and it only earns its space once
  // a second flow exists.
  const flowLog = buildLogPanel("flow", "Log", () => live().log(), () => live().clearLog(),
    "(empty - new Engine(bundle, { log: true }) retains the flow log)");
  const runLog = buildLogPanel("run", "Run log (every flow)", () => engine.log(), () => engine.clearLog(),
    "(empty - new Engine(bundle, { log: true }) retains the run log)");
  const renderLog = (force = false): void => { runLog.render(force); flowLog.render(force); };

  const line = (parent: HTMLElement, text: string): void => {
    const div = document.createElement("div");
    div.className = "sl-line";
    div.textContent = text;
    parent.append(div);
  };
  const readLive = (): void => {
    turnsBody.textContent = "";
    for (const box of live().listBoxes()) {
      line(turnsBody, `${box.title ?? box.gameId}: turn ${box.turn}`);
    }
    boardBody.textContent = "";
    for (const [hand, cards] of Object.entries(live().board())) {
      const names = cards.map((c) => c.title ?? c.gameId);
      line(boardBody, `${hand}: ${names.length > 0 ? names.join(", ") : "(empty)"}`);
    }
  };

  const refresh = (): void => {
    for (const e of editors) e.read();
    readLive();
    renderLog();
  };
  readLive();
  renderLog(true);

  let timer: ReturnType<typeof setInterval> | undefined;
  const pollMs = opts.pollMs ?? 250;
  if (pollMs > 0) timer = setInterval(refresh, pollMs);

  (opts.container ?? document.body).append(el);
  return {
    el,
    refresh,
    destroy(): void {
      if (timer !== undefined) clearInterval(timer);
      el.remove();
    },
  };
}

function buildRow(
  live: () => Flow,
  row: PropertyRow,
  editors: { row: PropertyRow; read: () => void }[],
): HTMLElement {
  const div = document.createElement("div");
  div.className = "sl-row";
  const name = document.createElement("span");
  name.className = "sl-name";
  name.textContent = row.name;
  name.title = row.path;

  const current = (): ScalarValue | undefined => {
    try { return live().getProperty(row.path); } catch { return undefined; }
  };
  // Forward-declared so commit can refresh the whole row (widget + reset
  // state) once everything below is built.
  let sync: () => void = () => {};
  const commit = (value: ScalarValue): void => { live().setProperty(row.path, value); sync(); };

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "sl-reset";
  reset.textContent = "↺";
  reset.title = "Reset to default";
  reset.addEventListener("click", () => commit(row.default));

  let widget: HTMLElement;
  let read: () => void;
  const focused = (w: HTMLElement): boolean => document.activeElement === w;

  switch (row.type) {
    case "boolean": {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => commit(input.checked));
      widget = input;
      read = () => { if (!focused(input)) input.checked = current() === true; };
      break;
    }
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.addEventListener("change", () => commit(Number(input.value)));
      widget = input;
      read = () => { if (!focused(input)) input.value = String(current() ?? 0); };
      break;
    }
    case "enum":
    case "quality": {
      // A quality edits as a dropdown of its STAGE LADDER, closed exactly like an
      // enum's values. It fell to the string branch until 2026-09-01, so a free-text
      // box accepted any stage name at all - and an unknown stage is not a harmless
      // typo: the evaluator refuses it ("X is not a stage of this quality"), so a
      // slip here broke play rather than being corrected. listProperties has carried
      // `stages` for this since it was written; nothing consumed it.
      const select = document.createElement("select");
      for (const v of (row.type === "quality" ? row.stages : row.values) ?? []) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = v;
        select.append(o);
      }
      select.addEventListener("change", () => commit(select.value));
      widget = select;
      read = () => { if (!focused(select)) select.value = String(current() ?? ""); };
      break;
    }
    case "flags": {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "comma, separated, flags";
      input.addEventListener("change", () =>
        commit(input.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)));
      widget = input;
      read = () => { if (!focused(input)) input.value = ((current() as string[] | undefined) ?? []).join(", "); };
      break;
    }
    default: {   // string
      const input = document.createElement("input");
      input.type = "text";
      input.addEventListener("change", () => commit(input.value));
      widget = input;
      read = () => { if (!focused(input)) input.value = String(current() ?? ""); };
    }
  }

  const readAll = (): void => { read(); reset.disabled = eq(current(), row.default); };
  sync = readAll;
  readAll();
  editors.push({ row, read: readAll });
  div.append(name, widget, reset);
  return div;
}
