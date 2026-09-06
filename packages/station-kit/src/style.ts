// ---------------------------------------------------------------------------
// The kit's stylesheet, and the tokens a venue restyles it with.
//
// TOKEN NAMES ARE THE FAMILY'S. `--bg`, `--surface`, `--card`, `--ink`,
// `--muted`, `--line`, `--line-soft`, `--accent`, `--accent-soft`,
// `--danger`, `--warn`, `--ok`, `--radius-sm/md/lg/pill`, `--font-ui`,
// `--font-read`, `--font-mono` are Storyletter's own (its theme.css, which
// takes them in turn from Patterpad, and its grammar from the shared app-shell
// tokens). A station styled with these looks like the family without
// importing a line of the editor, which it must not: the editor is Electron
// and this runs on a kiosk.
//
// THE VALUES HERE ARE DEFAULTS, set with `var(--token, fallback)` at every use
// so a venue supplies its own `:root` block and gets its own look without
// touching a rule. That is RESTYLE, the first of the three routes (section
// 12), and it is the one a venue reaches for first.
//
// A STRING rather than a `.css` file on purpose. These pages are bundled with
// esbuild and served off a memory stick in a cupboard; a stylesheet that is a
// second request is a stylesheet that can be missing, and a kiosk with no
// styles reads as a broken kiosk rather than a plain one.
// ---------------------------------------------------------------------------

/** The kit's stylesheet. Inject it once, into the document or a shadow root:
 *
 *  ```ts
 *  document.head.append(Object.assign(document.createElement("style"),
 *    { textContent: KIT_CSS }));
 *  ``` */
export const KIT_CSS = `
.sk-root, .sk-part { box-sizing: border-box; }
.sk-part *, .sk-part *::before, .sk-part *::after { box-sizing: border-box; }

/* --- the surfaces ---------------------------------------------------------- */
.sk-part {
  font-family: var(--font-ui, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--ink, #161e28);
}
.sk-panel {
  background: var(--surface, #f4f6f9);
  border: 1px solid var(--line, #c6ceda);
  border-radius: var(--radius-md, 10px);
  padding: 14px 16px;
}
.sk-label {
  font: 600 0.66rem/1 var(--font-ui, system-ui, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted, #4d5b6b);
}
.sk-quiet { color: var(--muted, #4d5b6b); font-size: 0.85rem; }

/* --- buttons --------------------------------------------------------------- */
.sk-button {
  font: inherit;
  color: var(--muted, #4d5b6b);
  background: var(--card, #fbfcfe);
  border: 1px solid var(--line, #c6ceda);
  border-radius: var(--radius-sm, 6px);
  /* A performer taps this one-handed, in the dark, at speed, so the target is
     a finger's worth rather than a mouse's (spec 12: the crew app is the one
     most worth finishing properly). */
  min-height: 44px;
  padding: 10px 16px;
  cursor: pointer;
}
.sk-button:hover:enabled { background: var(--accent-soft, #2d5c861f); color: var(--accent, #2d5c86); }
.sk-button:focus-visible { outline: 2px solid var(--accent, #2d5c86); outline-offset: 1px; }
.sk-button.sk-primary { background: var(--accent, #2d5c86); color: var(--surface, #f4f6f9); font-weight: 500; }
.sk-button:disabled { opacity: 0.45; cursor: not-allowed; }

/* --- the hand -------------------------------------------------------------- */
.sk-hand { display: flex; flex-direction: column; gap: 12px; }
.sk-cards { display: flex; flex-direction: column; gap: 12px; }
/* What the hand is called, in words rather than in shouted capitals: a
   visitor reads "The door", never the gameId behind it. */
.sk-hand-title { font: 600 1rem var(--font-read, Georgia, serif); margin: 0; }
.sk-hand-empty { color: var(--muted, #4d5b6b); font-style: italic; padding: 12px 0; }
.sk-card {
  background: var(--card, #fbfcfe);
  border: 1px solid var(--line, #c6ceda);
  border-radius: var(--radius-md, 10px);
  padding: 14px 16px;
}
.sk-card-title { font: 600 1.05rem var(--font-read, Georgia, serif); margin: 0 0 4px; }
.sk-card-purpose { color: var(--muted, #4d5b6b); font-size: 0.85rem; line-height: 1.45; margin: 0 0 8px; }
/* The story, as prose. No label and no colon in front of it: a visitor is
   reading, not consulting the venue's vocabulary. */
.sk-card-text { font: 1.05rem/1.55 var(--font-read, Georgia, serif); margin: 0 0 4px; }
.sk-outcomes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
/* A gated outcome is DISABLED, never hidden (spec 12): a performer who cannot
   see what is unavailable cannot tell a locked door from a missing one. */
.sk-outcome[disabled] { text-decoration: line-through; }
/* A crew handset only: the outcome's purpose BESIDE the button, never inside
   it, so the button's accessible name stays the title. */
.sk-outcome-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 16rem; }
.sk-outcome-hint { color: var(--muted, #4d5b6b); font-size: 0.8rem; line-height: 1.4; }

/* --- fields ---------------------------------------------------------------- */
.sk-fields { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.sk-field { display: flex; gap: 8px; align-items: baseline; }
.sk-field-label {
  font: 600 0.62rem var(--font-ui, system-ui, sans-serif);
  text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted, #4d5b6b); flex: 0 0 auto; min-width: 5.5rem;
}
.sk-field-value { font-size: 0.95rem; line-height: 1.45; }
.sk-field-prompt .sk-field-value { font-family: var(--font-read, Georgia, serif); font-size: 1.05rem; }

/* --- the zone strip -------------------------------------------------------- */
.sk-zones { display: flex; flex-wrap: wrap; gap: 8px; }
.sk-zone[aria-pressed="true"] { background: var(--accent, #2d5c86); color: var(--surface, #f4f6f9); }
.sk-zone-derived { align-self: center; color: var(--muted, #4d5b6b); font-size: 0.85rem; font-style: italic; }

/* --- messages -------------------------------------------------------------- */
.sk-tray { display: flex; flex-direction: column; gap: 8px; }
.sk-message {
  display: flex; gap: 10px; align-items: flex-start;
  border-left: 3px solid var(--line, #c6ceda);
  background: var(--card, #fbfcfe);
  border-radius: var(--radius-sm, 6px);
  padding: 10px 12px;
}
.sk-message-cue { border-left-color: var(--warn, #a9772b); }
.sk-message-urgent { border-left-color: var(--danger, #b0402f); }
.sk-message-body { flex: 1; line-height: 1.4; }
.sk-message-at { color: var(--muted, #4d5b6b); font: 0.72rem var(--font-mono, ui-monospace, monospace); }
.sk-tray-empty { color: var(--muted, #4d5b6b); font-style: italic; }

/* --- the clock ------------------------------------------------------------- */
.sk-clock { display: flex; gap: 14px; align-items: baseline; font-family: var(--font-mono, ui-monospace, monospace); }
.sk-clock-show { font-size: 1.4rem; font-variant-numeric: tabular-nums; }
.sk-clock-phase { font-family: var(--font-ui, system-ui, sans-serif); color: var(--muted, #4d5b6b); }

/* --- the connection banner ------------------------------------------------- */
/* Quiet when live, and it says nothing at all: a banner that is always there
   is a banner nobody reads. */
.sk-banner {
  display: flex; gap: 10px; align-items: center;
  padding: 8px 14px; border-radius: var(--radius-sm, 6px);
  background: var(--warn, #a9772b); color: #fff; font-size: 0.9rem;
}
.sk-banner-live { display: none; }
.sk-banner-connecting { background: var(--muted, #4d5b6b); }
.sk-banner-disconnected { background: var(--danger, #b0402f); }
.sk-banner-queued { font-variant-numeric: tabular-nums; opacity: 0.85; }

/* --- the handshake --------------------------------------------------------- */
.sk-handshake { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }
.sk-scanner { position: relative; background: #000; border-radius: var(--radius-md, 10px); overflow: hidden; }
.sk-scanner video { display: block; width: 100%; height: auto; }
.sk-code-entry { display: flex; gap: 8px; }
.sk-code-entry input {
  flex: 1; font: inherit; min-height: 44px; padding: 8px 12px;
  background: var(--card, #fbfcfe); color: var(--ink, #161e28);
  border: 1px solid var(--line, #c6ceda); border-radius: var(--radius-sm, 6px);
}
.sk-callsigns { display: flex; flex-direction: column; gap: 6px; max-height: 15rem; overflow: auto; }
.sk-error { color: var(--danger, #b0402f); font-size: 0.9rem; }

/* --- the QR ---------------------------------------------------------------- */
.sk-qr { display: inline-block; background: #fff; padding: 12px; border-radius: var(--radius-md, 10px); }
.sk-qr svg { display: block; width: 100%; height: auto; }
.sk-qr-caption { color: var(--muted, #4d5b6b); font-size: 0.8rem; text-align: center; margin-top: 8px; }

/* --- the map --------------------------------------------------------------- */
.sk-map { display: block; width: 100%; height: auto; background: var(--bg, #e6eaef); border-radius: var(--radius-md, 10px); }
.sk-map-zone { fill-opacity: 0.1; stroke-opacity: 0.65; stroke-width: 2; }
.sk-map-zone-label { font: 600 13px var(--font-ui, system-ui, sans-serif); fill: var(--muted, #4d5b6b); opacity: 0.8; }
.sk-map-pin { cursor: pointer; }
.sk-map-pin-ring { fill: var(--card, #fbfcfe); stroke: var(--muted, #4d5b6b); stroke-width: 2; }
.sk-map-pin.sk-here .sk-map-pin-ring { stroke: var(--accent, #2d5c86); stroke-width: 4; }
.sk-map-pin.sk-waiting .sk-map-pin-ring { fill: var(--accent-soft, #2d5c861f); }
.sk-map-pin-count { font: 700 12px var(--font-ui, system-ui, sans-serif); fill: var(--ink, #161e28); text-anchor: middle; }
.sk-map-pin-name {
  font: 12px var(--font-ui, system-ui, sans-serif); fill: var(--ink, #161e28); text-anchor: middle;
  paint-order: stroke; stroke: var(--surface, #f4f6f9); stroke-width: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .sk-part * { transition: none !important; animation: none !important; }
}
`;
