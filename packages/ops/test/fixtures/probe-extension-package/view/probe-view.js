// The probe view: Storyletter's internal test view (never published, documented,
// or shipped), app-shell's probe view adapted to the Storylets host. Plain JS
// that speaks the view protocol itself, so it needs no bundle. It shows the
// selection, reads the deck the selection is in with its cards, writes probe's
// own `note` on the selected card or on every card of the deck as one undo
// step, and passes Mod+Z and Mod+Shift+Z on to the editor.
const API = 1;
const PORT = "wildwinter-view:port";
let port = null;
let nextId = 1;
const waiting = new Map();

const request = (op, args) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, { resolve, reject });
  port.postMessage({ t: "request", id, op, args });
});

class ProbeView extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p data-probe=\"status\">Waiting for the app...</p>"
      + "<p data-probe=\"path\"></p><p data-probe=\"label\"></p><p data-probe=\"note\"></p><p data-probe=\"held\"></p>"
      + "<p data-probe=\"deck\"></p><ul data-probe=\"cards\"></ul>"
      + "<button data-probe=\"write\" disabled>Write a note</button> "
      + "<button data-probe=\"write-deck\" disabled>Note every card</button> "
      + "<button data-probe=\"undo\">Undo</button> <button data-probe=\"select\" disabled>Select the deck</button>"
      + "<p data-probe=\"result\"></p>";
    this.on("write", () => this.write());
    this.on("write-deck", () => this.writeDeck());
    this.on("undo", () => port?.postMessage({ t: "key", combo: "Mod+Z" }));
    this.on("select", () => this.deck && request("select", { id: this.deck.id }));
  }

  on(name, fn) { this.querySelector(`[data-probe=${name}]`).addEventListener("click", () => void fn()); }
  set(name, text) { this.querySelector(`[data-probe=${name}]`).textContent = text; }
  enable(name, on) { this.querySelector(`[data-probe=${name}]`).disabled = !on || this.readOnly; }

  async show() {
    const sel = await request("selection", {});
    this.set("path", sel.path.map((n) => `${n.kind}:${n.id}`).join(" < "));
    const inner = sel.path[0] ?? null;
    const node = inner && await request("node", { id: inner.id });
    this.card = node && node.kind === "card" ? node : null;
    this.set("label", node ? `${node.kind} ${node.label}` : "Nothing selected");
    this.set("note", node?.ext?.probe?.note ?? "");
    this.set("held", node?.held ?? "");
    const deckAt = sel.path.find((n) => n.kind === "deck");
    this.deck = deckAt ? await request("node", { id: deckAt.id, children: true }) : null;
    this.set("deck", this.deck ? `Deck ${this.deck.label}: ${this.deck.children.length} cards` : "");
    const list = this.querySelector("[data-probe=cards]");
    list.replaceChildren(...(this.deck?.children ?? []).map((c) => {
      const li = document.createElement("li");
      li.textContent = `${c.label}: ${c.ext?.probe?.note ?? ""}`;
      return li;
    }));
    this.enable("write", this.card !== null && !this.card.held);
    this.enable("write-deck", this.deck !== null && this.deck.children.length > 0);
    this.enable("select", this.deck !== null);
  }

  async write() {
    if (!this.card) return;
    try {
      const done = await request("write", { label: "Probe note", edits: [{ node: this.card.id, field: "note", value: `probed ${new Date().toISOString()}` }] });
      this.set("result", `Wrote ${done.written}`);
    } catch (e) { this.set("result", e.message); }
  }

  async writeDeck() {
    if (!this.deck) return;
    const deck = await request("node", { id: this.deck.id, children: true });
    try {
      const done = await request("write", { label: "Probe every note", edits: deck.children.map((c, i) => ({ node: c.id, field: "note", value: `card ${i + 1} of ${deck.children.length}` })) });
      this.set("result", `Wrote ${done.written}`);
    } catch (e) { this.set("result", e.message); }
  }

  welcome(msg) {
    this.set("status", `${msg.host}: ${msg.extension.id} ${msg.extension.version}, ${msg.theme.scheme}`);
    this.readOnly = msg.writable.readOnly;
    for (const [k, v] of Object.entries(msg.theme.tokens)) document.documentElement.style.setProperty(k, v);
    void this.show();
  }
}
customElements.define("probe-view", ProbeView);

// The editor's undo and redo, as view-client passes on a combination the page didn't take.
window.addEventListener("keydown", (e) => {
  if (!port || !(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  const combo = k === "z" ? (e.shiftKey ? "Mod+Shift+Z" : "Mod+Z") : k === "y" && !e.shiftKey ? "Mod+Y" : null;
  if (!combo) return;
  e.preventDefault();
  port.postMessage({ t: "key", combo });
});

window.addEventListener("message", (e) => {
  // The preload posts `{ type }` (a bare string from app-shell before 0.58's last change).
  const type = typeof e.data === "string" ? e.data : e.data?.type;
  if (e.source !== window || type !== PORT || !e.ports[0]) return;
  port = e.ports[0];
  port.onmessage = ({ data }) => {
    const view = document.querySelector("probe-view");
    if (data.t === "welcome") view.welcome(data);
    else if (data.t === "refused") view.set("status", data.message);
    else if (data.t === "reply") {
      const p = waiting.get(data.id);
      waiting.delete(data.id);
      if (p) data.ok ? p.resolve(data.value) : p.reject(new Error(`${data.refusal.code}: ${data.refusal.message}`));
    } else if (data.t === "event" && (data.name === "changed" || data.name === "selection")) void view.show();
    else if (data.t === "event" && data.name === "writable") { view.readOnly = data.value.readOnly; void view.show(); }
    else if (data.t === "event" && data.name === "theme") view.set("status", `theme ${data.value.scheme}`);
  };
  port.postMessage({ t: "hello", api: API });
});
