// ---------------------------------------------------------------------------
// The Extensions window (patterkit design/extensions-window.md): what the open
// project takes and what this machine has installed, drawn by the shell's
// `extensionsPanel`. Main builds the rows and sends them again whenever they
// change; every button only says what was clicked. Add, Install and Remove are
// project steps, so main hands them to the editor, which runs them as the menu
// would; Uninstall is this machine's, and main asks and does it. Patterpad's
// Extensions window, on the same shared parts.
// ---------------------------------------------------------------------------

import "../src/fonts.css"; // every face the windows draw, declared once
import "../src/theme.css";
import "../tool-window/base.css";
import "@wildwinter/app-shell/extensions-window.css";
import "./extensions.css";
import "@wildwinter/app-shell/tooltip.css";
import { el, extensionsPanel, pinButton, toolWindowHead } from "@wildwinter/app-shell";
import { bootToolWindow } from "../tool-window/boot.js";
import type { ExtensionsWinState } from "../../shared/api.js";

const studio = window.studio;
const root = document.getElementById("extensions")!;
const body = el("main", { className: "xbody" });
const panel = extensionsPanel({
  add: () => { void studio.extensionsAsk({ do: "add" }); },
  install: (extension) => { void studio.extensionsAsk({ do: "install", extension }); },
  remove: (extension) => { void studio.extensionsAsk({ do: "remove", extension }); },
  uninstall: (id, version) => { void studio.uninstallExtension(id, version); },
});
body.append(panel.el);
const render = (state: ExtensionsWinState): void => panel.render({ ...state, app: "Storyletter" });

/** The pin, built once and driven with `set`: main re-pins the window on Reset View and tells it after. */
const pin = pinButton({ pinned: true, onToggle: (on) => { void studio.setExtensionsPinned(on); } });
const head = toolWindowHead({ title: "Extensions", pin, onClose: () => void studio.closeExtensions() });

// A state can land before the boot read does: the newer one wins.
let fresh = false;
studio.onExtensionsState((state) => { fresh = true; render(state); });
// A different project under the window: it lists the old one's until it reads the rows again.
studio.onProjectChanged(() => { void studio.extensionsState().then(render); });

async function boot(): Promise<void> {
  const state = await bootToolWindow({ onPinned: (on) => pin.set(on) });
  pin.set(state.extensionsPinned);
  root.replaceChildren(head, body);
  const shown = await studio.extensionsState();
  if (!fresh) render(shown);
}
void boot();
